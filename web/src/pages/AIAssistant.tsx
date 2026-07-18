import React, { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  CalendarPlus,
  Camera,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  Receipt,
  Search as SearchIcon,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import {
  Camera as CameraCap,
  CameraPermissionState,
  CameraResultType,
  CameraSource,
} from "@capacitor/camera";
import { PageHeader } from "@/components/lifevault/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context/AppContext";
import { formatCurrency } from "@/lib/format";
import {
  naturalLanguageSearch,
  scanDocument,
  SCAN_KIND_LABEL,
  type ScanResult,
  type SearchResults,
  type SuggestedAction,
} from "@/lib/ai";
import type {
  Appointment,
  Expense,
  VaultDocument,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "scan" | "search";

const SCAN_SUGGESTED_PROMPTS = [
  "Show my passport.",
  "Find all electricity bills.",
  "Show receipts from last month.",
  "When does my driver's licence expire?",
  "What subscriptions am I paying for?",
  "How much did I spend on food this month?",
];

/* ------------------------- helpers ------------------------- */

function userFacingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "AI_NOT_CONFIGURED") {
    return "AI features aren't configured for this build.";
  }
  if (message.startsWith("AI_HTTP_")) {
    const code = message.replace(/^AI_HTTP_/, "").split(":")[0];
    if (code === "401" || code === "403")
      return "AI Cloud access was denied. Please try again later.";
    if (code === "429") return "Too many requests. Please wait a moment and retry.";
    if (code === "413") return "That image is too large to scan.";
    return `AI service returned an error (${code}).`;
  }
  if (message === "AI_EMPTY") return "The AI returned an empty response. Please retry.";
  if (message === "AI_PARSE_FAILED") return "Couldn't parse the AI response. Please try again.";
  if (message === "IMAGE_TOO_LARGE") return "That image is too large to scan. Try a clearer, smaller photo.";
  if (/denied|permission/i.test(message)) return "Camera or photo access was denied.";
  if (/cancel/i.test(message)) return ""; // silent
  return "Something went wrong. Please try again.";
}

/* ------------------------- image capture ------------------------- */

type CaptureSource = "camera" | "photos";

const isNativePlatform = (): boolean =>
  typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();

/**
 * Show a permission-denied toast with a one-tap shortcut to the system
 * Settings page (Apple's `app-settings:` URL scheme). Only on native.
 */
function showPermissionDeniedToast(source: CaptureSource): void {
  const what = source === "camera" ? "Camera" : "Photo library";
  toast.error(`${what} access denied`, {
    description: "Enable it in Settings to use this feature.",
    action: {
      label: "Open settings",
      onClick: () => {
        try {
          window.location.href = "app-settings:";
        } catch {
          /* ignore */
        }
      },
    },
  });
}

/**
 * Get the current permission state for the requested source without
 * triggering a system prompt. Returns "granted" | "limited" | "denied" |
 * "prompt" | "unknown".
 */
async function getPermissionState(
  source: CaptureSource,
): Promise<CameraPermissionState | "unknown"> {
  try {
    const status = await CameraCap.checkPermissions();
    return source === "camera" ? status.camera : status.photos;
  } catch {
    return "unknown";
  }
}

/**
 * Trigger the iOS system permission dialog for the requested source.
 * Returns the resulting state, or "unknown" if the call throws (older
 * runtimes / missing plugin).
 */
async function requestPermission(
  source: CaptureSource,
): Promise<CameraPermissionState | "unknown"> {
  try {
    const result = await CameraCap.requestPermissions({
      permissions: [source],
    });
    return source === "camera" ? result.camera : result.photos;
  } catch {
    return "unknown";
  }
}

/**
 * Ensure the requested source has permission before launching the picker /
 * camera. This is CRITICAL on iOS because of the camera permission race
 * condition: if `getPhoto` is called for the camera while the permission
 * is still "prompt", iOS shows the system dialog *while* the camera tries
 * to initialize. The camera preview fails to start (permission not yet
 * granted), so the first call fails silently. On the second attempt the
 * permission is already "granted" and it works. Pre-requesting eliminates
 * the race: by the time `getPhoto` runs, the permission is already granted.
 *
 * For the Photo Library (CameraSource.Photos), some iOS versions silently
 * fail `getPhoto` when the state is "prompt" instead of showing the dialog,
 * so pre-requesting is equally important there.
 *
 * Flow:
 *  1. checkPermissions → read current state (no prompt).
 *  2. "denied" → show Settings toast (iOS won't re-prompt).
 *  3. "prompt" → requestPermissions (triggers system dialog), proceed only
n *     on "granted" / "limited".
 *  4. "granted" / "limited" / "unknown" → proceed to getPhoto.
 */
async function ensurePermission(
  source: CaptureSource,
): Promise<boolean> {
  const state = await getPermissionState(source);

  if (state === "denied") {
    showPermissionDeniedToast(source);
    return false;
  }

  if (state === "prompt") {
    const after = await requestPermission(source);
    if (after === "denied") {
      showPermissionDeniedToast(source);
      return false;
    }
    // granted | limited | unknown → proceed
    return true;
  }

  // granted | limited | unknown → proceed
  return true;
}

/**
 * Launch the native camera or photo picker via Capacitor. Assumes
 * permissions are already handled by `ensurePermission`.
 */
async function getPhotoFromNative(
  source: CaptureSource,
): Promise<string | null> {
  try {
    const photo = await CameraCap.getPhoto({
      quality: 90,
      // allowEditing is only supported for CameraSource.Camera on iOS.
      // Setting it for Photos causes a native crash, so gate it.
      allowEditing: source === "camera",
      resultType: CameraResultType.DataUrl,
      source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
      width: 1600,
      height: 1600,
      correctOrientation: true,
      saveToGallery: false,
    });
    return photo.dataUrl ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // User dismissed the picker / camera — silent.
    if (/cancel/i.test(msg)) return null;
    // Permission denied at runtime — offer a shortcut to Settings.
    if (/denied|permission/i.test(msg)) {
      showPermissionDeniedToast(source);
      return null;
    }
    toast.error(userFacingError(err));
    return null;
  }
}

/**
 * Capture an image from the camera or photo library. On native iOS this
 * pre-requests permissions to avoid the camera race condition and silent
 * photo-library failures. On web it falls back to a file input.
 */
async function captureImage(source: CaptureSource): Promise<string | null> {
  if (isNativePlatform()) {
    // Pre-request permission BEFORE calling getPhoto. This fixes two bugs:
    //  1. Camera race condition: first call fails because the permission
    //     dialog is shown while the camera tries to init.
    //  2. Photo library silent failure: some iOS versions don't show the
    //     permission dialog from inside getPhoto(Photos).
    const granted = await ensurePermission(source);
    if (!granted) return null;
    return getPhotoFromNative(source);
  }

  // Web fallback: trigger a file input.
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = source === "camera" ? "environment" : undefined;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => {
        toast.error("Couldn't read that image.");
        resolve(null);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

/* ------------------------- Scan panel ------------------------- */

interface ScanPanelProps {
  onScanComplete: (r: ScanResult) => void;
}

function ScanPanel({ onScanComplete }: ScanPanelProps) {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCapture = useCallback(
    async (source: "camera" | "photos") => {
      const dataUrl = await captureImage(source);
      if (!dataUrl) return;
      setImage(dataUrl);
      setLoading(true);
      try {
        const result = await scanDocument(dataUrl);
        onScanComplete(result);
      } catch (err) {
        const msg = userFacingError(err);
        if (msg) toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [onScanComplete],
  );

  const handleFilePick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        setImage(dataUrl);
        setLoading(true);
        try {
          const result = await scanDocument(dataUrl);
          onScanComplete(result);
        } catch (err) {
          const msg = userFacingError(err);
          if (msg) toast.error(msg);
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(file);
    },
    [onScanComplete],
  );

  return (
    <div className="space-y-5 px-4 pt-4">
      {/* Hero capture card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(219,60%,15%)] via-[hsl(218,57%,20%)] to-[hsl(215,55%,30%)] p-6 text-white shadow-xl shadow-primary/20">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/5" aria-hidden />
        <div className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-info/15 blur-2xl" aria-hidden />
        <div className="relative">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-[22px] font-extrabold tracking-tight">
            Scan a document
          </h2>
          <p className="mt-1 text-[14px] leading-relaxed text-white/70">
            Point your camera at a receipt, ID, passport, contract, or any
            document. LifeVault will detect what it is and pull out the
            important details for you.
          </p>

          {/* Preview / actions */}
          <div className="mt-5">
            {image ? (
              <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/15">
                <img
                  src={image}
                  alt="Captured document"
                  className="max-h-[260px] w-full object-cover"
                />
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-7 w-7 animate-spin text-white" />
                      <p className="text-[13px] font-semibold text-white/90">
                        Analyzing…
                      </p>
                    </div>
                  </div>
                )}
                {!loading && (
                  <button
                    onClick={() => setImage(null)}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"
                    aria-label="Clear photo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleCapture("camera")}
                  className="flex flex-col items-center gap-2 rounded-2xl bg-white/10 px-4 py-5 text-center ring-1 ring-white/15 transition-all active:scale-[0.98] hover:bg-white/15"
                >
                  <Camera className="h-6 w-6" />
                  <span className="text-[13px] font-bold">Take photo</span>
                </button>
                <button
                  onClick={() => handleCapture("photos")}
                  className="flex flex-col items-center gap-2 rounded-2xl bg-white/10 px-4 py-5 text-center ring-1 ring-white/15 transition-all active:scale-[0.98] hover:bg-white/15"
                >
                  <ImageIcon className="h-6 w-6" />
                  <span className="text-[13px] font-bold">Add photo</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden file input for web */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFilePick}
        aria-hidden
        tabIndex={-1}
        className="hidden"
      />

      {/* Tips */}
      <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <p className="text-[13px] font-bold">Works great with</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(SCAN_KIND_LABEL).map(([key, label]) => (
            <span
              key={key}
              className="rounded-full bg-secondary px-3 py-1.5 text-[12px] font-semibold text-secondary-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Scan result sheet ------------------------- */

const ACTION_META: Record<
  SuggestedAction["kind"],
  { icon: typeof Receipt; label: string; color: string }
> = {
  expense: {
    icon: Receipt,
    label: "Add expense",
    color: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  },
  appointment: {
    icon: CalendarPlus,
    label: "Add to calendar",
    color: "bg-info/12 text-info",
  },
  document: {
    icon: FileText,
    label: "Save in documents",
    color: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  },
  reminder: {
    icon: BellRing,
    label: "Set reminder",
    color: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  },
};

function ScanResultCard({
  result,
  onClose,
}: {
  result: ScanResult;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { addDocument, addExpense, addAppointment } = useApp();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const handleAccept = useCallback(
    (action: SuggestedAction, key: string) => {
      try {
        if (action.kind === "expense") {
          const expense: Omit<Expense, "id"> = {
            amount: action.amount ?? 0,
            date: new Date(`${action.date ?? new Date().toISOString().slice(0, 10)}T${new Date().toISOString().slice(11, 16)}`).toISOString(),
            category: action.category,
            merchant: action.merchant,
            notes: action.notes,
            paymentMethod: action.paymentMethod,
          };
          addExpense(expense);
          toast.success("Expense added");
        } else if (action.kind === "appointment") {
          const apt: Omit<Appointment, "id"> = {
            title: action.title,
            date: action.date ?? new Date().toISOString().slice(0, 10),
            time: action.time,
            location: action.location,
            notes: action.notes,
            reminder: action.reminder,
          };
          addAppointment(apt);
          toast.success("Appointment added");
        } else if (action.kind === "document") {
          const doc: Omit<VaultDocument, "id" | "createdAt"> = {
            name: action.name,
            category: action.category,
            issueDate: action.issueDate,
            expiryDate: action.expiryDate,
            notes: action.notes,
            reminderDays: action.reminderDays,
            fileName: null,
            fileKind: "image",
          };
          addDocument(doc);
          toast.success("Document saved");
        } else if (action.kind === "reminder") {
          // Save as a document with the expiry date so it surfaces in
          // notifications + reminders, since LifeVault has no standalone
          // reminder type.
          const doc: Omit<VaultDocument, "id" | "createdAt"> = {
            name: action.title,
            category: "Other",
            issueDate: null,
            expiryDate: action.date,
            notes: action.notes,
            reminderDays: 30,
            fileName: null,
            fileKind: "image",
          };
          addDocument(doc);
          toast.success("Reminder created");
        }
        setAccepted((s) => new Set(s).add(key));
      } catch (err) {
        toast.error("Could not save. Please try again.");
      }
    },
    [addAppointment, addDocument, addExpense],
  );

  const handleView = useCallback(
    (action: SuggestedAction) => {
      if (action.kind === "expense") navigate("/expenses");
      else if (action.kind === "appointment") navigate("/calendar");
      else if (action.kind === "document" || action.kind === "reminder")
        navigate("/documents");
    },
    [navigate],
  );

  return (
    <div className="animate-fade-in space-y-4 px-4 pt-4">
      {/* Header */}
      <div className="overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border">
        <div className="flex items-start gap-3 border-b border-border/70 p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:text-foreground">
            <Wand2 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {SCAN_KIND_LABEL[result.kind]}
            </p>
            <h3 className="truncate text-[17px] font-extrabold tracking-tight">
              {result.title}
            </h3>
            {result.summary && (
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                {result.summary}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Extracted fields */}
        {result.fields.length > 0 && (
          <dl className="divide-y divide-border/70">
            {result.fields.map((f, i) => (
              <div
                key={`${f.label}-${i}`}
                className="flex items-baseline justify-between gap-4 px-4 py-2.5"
              >
                <dt className="text-[13px] font-semibold text-muted-foreground">
                  {f.label}
                </dt>
                <dd className="min-w-0 flex-1 truncate text-right text-[14px] font-bold">
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* Suggested actions */}
      {result.suggestedActions.length > 0 && (
        <div className="space-y-2.5">
          <p className="px-1 text-[13px] font-bold text-muted-foreground">
            Suggested actions
          </p>
          {result.suggestedActions.map((action, i) => {
            const key = `${action.kind}-${i}`;
            const meta = ACTION_META[action.kind];
            const Icon = meta.icon;
            const done = accepted.has(key);
            return (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-3 rounded-2xl bg-card p-3.5 shadow-sm ring-1 ring-border transition-opacity",
                  done && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    meta.color,
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">{meta.label}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {describeAction(action)}
                  </p>
                </div>
                {done ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleView(action)}
                    className="h-9 rounded-xl px-3 text-[12.5px] font-bold"
                  >
                    View <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleAccept(action, key)}
                    className="h-9 rounded-xl px-3.5 text-[12.5px] font-bold shadow-sm"
                  >
                    Add
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function describeAction(action: SuggestedAction): string {
  switch (action.kind) {
    case "expense":
      return `${action.merchant} · ${action.amount != null ? formatCurrency(action.amount, "AUD") : "—"}`;
    case "appointment":
      return `${action.date ?? "—"} · ${action.time}${action.location ? ` · ${action.location}` : ""}`;
    case "document":
      return `${action.category}${action.expiryDate ? ` · expires ${action.expiryDate}` : ""}`;
    case "reminder":
      return `Remind on ${action.date}`;
  }
}

/* ------------------------- Search panel ------------------------- */

interface SearchHit {
  id: string;
  type: "document" | "expense" | "subscription" | "appointment";
  label: string;
  sub: string;
}

function SearchPanel() {
  const { documents, expenses, subscriptions, appointments } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [answer, setAnswer] = useState<string>("");
  const [matches, setMatches] = useState<SearchHit[]>([]);
  const [asked, setAsked] = useState<boolean>(false);

  const ask = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setLoading(true);
      setAsked(true);
      setAnswer("");
      setMatches([]);
      try {
        const results: SearchResults = await naturalLanguageSearch(trimmed, {
          documents,
          expenses,
          subscriptions,
          appointments,
        });
        setAnswer(results.answer);
        setMatches(results.matches as SearchHit[]);
      } catch (err) {
        const msg = userFacingError(err);
        if (msg) toast.error(msg);
        setAnswer("I couldn't complete that search. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [appointments, documents, expenses, subscriptions],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void ask(query);
  };

  return (
    <div className="space-y-4 px-4 pt-4">
      {/* Search bar */}
      <form onSubmit={handleSubmit} className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything about your vault…"
          className="h-12 rounded-2xl bg-card pl-11 pr-24 text-[15px] shadow-sm ring-1 ring-border"
          autoCapitalize="none"
          autoCorrect="off"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-20 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-label="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <Button
          type="submit"
          disabled={loading || !query.trim()}
          className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-xl px-3.5 text-[13px] font-bold"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Ask <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </form>

      {/* Suggested prompts */}
      {!asked && (
        <div className="space-y-2.5">
          <p className="px-1 text-[13px] font-bold text-muted-foreground">
            Try asking
          </p>
          <div className="flex flex-wrap gap-2">
            {SCAN_SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setQuery(p);
                  void ask(p);
                }}
                className="rounded-full border border-border bg-card px-3.5 py-2 text-[13px] font-semibold text-foreground shadow-sm transition-all active:scale-95 hover:border-primary/40"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Answer */}
      {asked && (
        <div className="animate-fade-in space-y-3">
          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
              <Loader2 className="h-5 w-5 animate-spin text-primary dark:text-foreground" />
              <p className="text-[14px] font-semibold text-muted-foreground">
                Searching your vault…
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[hsl(218,57%,27%)] p-4 text-primary-foreground shadow-md shadow-primary/20">
              <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-primary-foreground/70">
                <Sparkles className="h-3.5 w-3.5" />
                AI answer
              </div>
              <p className="mt-1.5 text-[14px] leading-relaxed">{answer}</p>
            </div>
          )}

          {/* Matches */}
          {!loading && matches.length > 0 && (
            <div className="space-y-2">
              <p className="px-1 text-[13px] font-bold text-muted-foreground">
                {matches.length} match{matches.length === 1 ? "" : "es"}
              </p>
              <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
                {matches.map((m, i) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      if (m.type === "document") navigate("/documents");
                      else if (m.type === "expense") navigate("/expenses");
                      else if (m.type === "subscription") navigate("/subscriptions");
                      else if (m.type === "appointment") navigate("/calendar");
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40",
                      i > 0 && "border-t border-border/70",
                    )}
                  >
                    <MatchIcon type={m.type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold">{m.label}</p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {m.sub}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {!loading && matches.length === 0 && answer && (
            <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-border">
              <p className="text-[13px] text-muted-foreground">
                No matching items in your vault.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MatchIcon({ type }: { type: SearchHit["type"] }) {
  const map = {
    document: { icon: FileText, cls: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
    expense: { icon: Receipt, cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
    subscription: { icon: Receipt, cls: "bg-blue-500/12 text-blue-600 dark:text-blue-400" },
    appointment: { icon: CalendarPlus, cls: "bg-info/12 text-info" },
  } as const;
  const { icon: Icon, cls } = map[type];
  return (
    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", cls)}>
      <Icon className="h-4.5 w-4.5" />
    </span>
  );
}

/* ------------------------- Page ------------------------- */

export default function AIAssistant() {
  const [tab, setTab] = useState<Tab>("scan");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="AI Assistant"
        subtitle="Scan & search your vault"
      />

      {/* Tab switcher */}
      <div className="px-4 pt-3">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
          <button
            onClick={() => setTab("scan")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-bold transition-all",
              tab === "scan"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
          >
            <Camera className="h-4 w-4" /> Scan
          </button>
          <button
            onClick={() => setTab("search")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-bold transition-all",
              tab === "search"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
          >
            <SearchIcon className="h-4 w-4" /> Search
          </button>
        </div>
      </div>

      {/* Panels */}
      {tab === "scan" ? (
        scanResult ? (
          <ScanResultCard
            result={scanResult}
            onClose={() => setScanResult(null)}
          />
        ) : (
          <ScanPanel onScanComplete={setScanResult} />
        )
      ) : (
        <SearchPanel />
      )}
    </div>
  );
}
