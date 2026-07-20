import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  CalendarPlus,
  Camera,
  Check,
  ChevronRight,
  Clock,
  FileText,
  Hash,
  Image as ImageIcon,
  Languages,
  Loader2,
  Mail,
  MapPin,
  MessageCircleQuestion,
  Phone,
  Plus,
  Receipt,
  Search as SearchIcon,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/lifevault/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/context/AppContext";
import { useI18n } from "@/context/I18nContext";
import { formatCurrency } from "@/lib/format";
import {
  askAboutScan,
  naturalLanguageSearch,
  scanDocuments,
  SCAN_GROUP_LABEL,
  SCAN_KIND_LABEL,
  type AskContext,
  type DocGroup,
  type ExtractedEntity,
  type EntityType,
  type ScanOutcome,
  type ScanResult,
  type SearchResults,
  type SuggestedAction,
} from "@/lib/ai";
import { captureImage } from "@/lib/native-camera";
import { ChipPicker, Field, FormSheet } from "@/components/lifevault/FormSheet";
import { DOCUMENT_META } from "@/components/lifevault/category-meta";
import type {
  Appointment,
  DocumentCategory,
  Expense,
  VaultDocument,
} from "@/lib/types";
import { DOCUMENT_CATEGORIES, REMINDER_OPTIONS, type ReminderDays } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "scan" | "search";

const SEARCH_SUGGESTED_PROMPTS = [
  "Show my passport.",
  "Find all electricity bills.",
  "Show receipts from last month.",
  "When does my driver's licence expire?",
  "What subscriptions am I paying for?",
  "How much did I spend on food this month?",
];

const FOLLOWUP_PROMPTS = [
  "What is this document for?",
  "When does it expire?",
  "Summarise the key points",
  "What should I do next?",
];

/* ------------------------- helpers ------------------------- */

function userFacingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "AI_NOT_CONFIGURED") {
    return "AI features aren't configured for this build.";
  }
  if (message === "AI_NO_PAGES") return "Capture at least one page first.";
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

const GROUP_ICON: Record<DocGroup, typeof Sparkles> = {
  Identity: ShieldCheck,
  Medical: ShieldCheck,
  Money: Receipt,
  Legal: FileText,
  Travel: CalendarPlus,
  Work: FileText,
  Education: FileText,
  Notes: FileText,
  Other: FileText,
};

const GROUP_TONE: Record<DocGroup, string> = {
  Identity: "from-indigo-500/20 to-indigo-500/5 text-indigo-600 dark:text-indigo-300",
  Medical: "from-rose-500/20 to-rose-500/5 text-rose-600 dark:text-rose-300",
  Money: "from-emerald-500/20 to-emerald-500/5 text-emerald-600 dark:text-emerald-300",
  Legal: "from-red-500/20 to-red-500/5 text-red-600 dark:text-red-300",
  Travel: "from-sky-500/20 to-sky-500/5 text-sky-600 dark:text-sky-300",
  Work: "from-amber-500/20 to-amber-500/5 text-amber-600 dark:text-amber-300",
  Education: "from-violet-500/20 to-violet-500/5 text-violet-600 dark:text-violet-300",
  Notes: "from-yellow-500/20 to-yellow-500/5 text-yellow-600 dark:text-yellow-300",
  Other: "from-slate-500/20 to-slate-500/5 text-slate-600 dark:text-slate-300",
};

const ENTITY_META: Record<EntityType, { icon: typeof Hash; tone: string; label: string }> = {
  date: { icon: Clock, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-400", label: "Date" },
  appointment: { icon: CalendarPlus, tone: "bg-info/12 text-info", label: "Appointment" },
  expiry: { icon: BellRing, tone: "bg-amber-500/12 text-amber-600 dark:text-amber-400", label: "Expiry" },
  due: { icon: BellRing, tone: "bg-amber-500/12 text-amber-600 dark:text-amber-400", label: "Due" },
  reminder: { icon: BellRing, tone: "bg-amber-500/12 text-amber-600 dark:text-amber-400", label: "Reminder" },
  name: { icon: User, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-400", label: "Name" },
  address: { icon: MapPin, tone: "bg-teal-500/12 text-teal-600 dark:text-teal-400", label: "Address" },
  email: { icon: Mail, tone: "bg-blue-500/12 text-blue-600 dark:text-blue-400", label: "Email" },
  phone: { icon: Phone, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", label: "Phone" },
  id_number: { icon: Hash, tone: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400", label: "ID" },
  reference: { icon: Hash, tone: "bg-slate-500/12 text-slate-600 dark:text-slate-400", label: "Reference" },
  money: { icon: Receipt, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", label: "Amount" },
  medicine: { icon: ShieldCheck, tone: "bg-rose-500/12 text-rose-600 dark:text-rose-400", label: "Medicine" },
  legal_clause: { icon: FileText, tone: "bg-red-500/12 text-red-600 dark:text-red-400", label: "Clause" },
  education: { icon: FileText, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-400", label: "Education" },
  banking: { icon: Receipt, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", label: "Banking" },
  travel: { icon: CalendarPlus, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-400", label: "Travel" },
  url: { icon: Hash, tone: "bg-slate-500/12 text-slate-600 dark:text-slate-400", label: "Link" },
  other: { icon: Hash, tone: "bg-slate-500/12 text-slate-600 dark:text-slate-400", label: "Detail" },
};

/* ------------------------- Scan capture panel ------------------------- */

interface ScanPanelProps {
  pages: string[];
  setPages: (pages: string[]) => void;
  onScanComplete: (outcome: ScanOutcome) => void;
}

function ScanPanel({ pages, setPages, onScanComplete }: ScanPanelProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState<boolean>(false);
  const [analyzed, setAnalyzed] = useState<boolean>(false);

  const handleCapture = useCallback(
    async () => {
      const dataUrl = await captureImage("camera", 1600);
      if (!dataUrl) return;
      setPages([...pages, dataUrl]);
      setAnalyzed(false);
    },
    [pages, setPages],
  );

  const handleRemovePage = (idx: number) => {
    const next = pages.filter((_, i) => i !== idx);
    setPages(next);
    setAnalyzed(false);
  };

  const handleAnalyze = useCallback(
    async () => {
      if (pages.length === 0) return;
      setLoading(true);
      setAnalyzed(false);
      try {
        const outcome = await scanDocuments(pages);
        onScanComplete(outcome);
        setAnalyzed(true);
      } catch (err) {
        const msg = userFacingError(err);
        if (msg) toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [pages, onScanComplete],
  );

  return (
    <div className="space-y-5 px-4 pt-4">
      {/* Hero card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(219,60%,15%)] via-[hsl(218,57%,20%)] to-[hsl(215,55%,30%)] p-6 text-white shadow-xl shadow-primary/20">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/5" aria-hidden />
        <div className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-info/15 blur-2xl" aria-hidden />
        <div className="relative">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-[22px] font-extrabold tracking-tight">
            Universal document AI
          </h2>
          <p className="mt-1 text-[14px] leading-relaxed text-white/70">
            Point your camera at any document — a receipt, prescription, handwritten
            note, contract, ID, or boarding pass. LifeVault reads, understands, and
            organises it for you. English & Arabic supported.
          </p>

          {/* Page thumbnails */}
          {pages.length > 0 && (
            <div className="mt-5 flex gap-2.5 overflow-x-auto scrollbar-none pb-1">
              {pages.map((p, i) => (
                <div
                  key={`${i}-${p.slice(0, 20)}`}
                  className="relative shrink-0 overflow-hidden rounded-xl ring-1 ring-white/15"
                >
                  <img
                    src={p}
                    alt={`Page ${i + 1}`}
                    className="h-20 w-16 object-cover"
                  />
                  <button
                    onClick={() => handleRemovePage(i)}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                    aria-label={`Remove page ${i + 1}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <span className="absolute bottom-0 left-0 right-0 bg-black/55 py-0.5 text-center text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                </div>
              ))}
              {/* Add page tile */}
              <button
                onClick={() => void handleCapture()}
                className="flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/25 bg-white/5 text-white/70 transition-colors hover:bg-white/10"
                aria-label="Add another page"
              >
                <Plus className="h-5 w-5" />
                <span className="text-[9px] font-bold uppercase tracking-wide">Page</span>
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="mt-5 space-y-2.5">
            {pages.length === 0 ? (
              <button
                onClick={() => void handleCapture()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-5 text-center ring-1 ring-white/15 transition-all active:scale-[0.98] hover:bg-white/15"
              >
                <Camera className="h-6 w-6" />
                <span className="text-[15px] font-bold">{t("assistant.takePhoto")}</span>
              </button>
            ) : (
              <div className="flex gap-2.5">
                <button
                  onClick={() => void handleCapture()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-3.5 text-center text-[14px] font-bold ring-1 ring-white/15 transition-all active:scale-[0.98] hover:bg-white/15"
                >
                  <Camera className="h-5 w-5" />
                  <span>{t("assistant.addPage")}</span>
                </button>
                <button
                  onClick={() => void handleAnalyze()}
                  disabled={loading || analyzed}
                  className="flex flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3.5 text-center text-[14px] font-extrabold text-[hsl(218,57%,21%)] shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" /> {t("assistant.analyzing")}
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-5 w-5" />{" "}
                      {pages.length > 1
                        ? t("assistant.analyzePages", { count: pages.length })
                        : t("assistant.analyzeDoc")}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Capabilities */}
      <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <p className="text-[13px] font-bold">Understands almost anything</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            "Passports & IDs",
            "Medical & prescriptions",
            "Receipts & invoices",
            "Bank statements",
            "Bills & utilities",
            "Contracts & legal",
            "Handwritten notes",
            "Tickets & boarding passes",
            "Business cards",
            "QR & barcodes",
            "Screenshots",
            "Forms",
          ].map((label) => (
            <span
              key={label}
              className="rounded-full bg-secondary px-3 py-1.5 text-[12px] font-semibold text-secondary-foreground"
            >
              {label}
            </span>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-info/8 px-3 py-2 text-[12px] text-info">
          <Languages className="h-3.5 w-3.5" />
          <span>English, Arabic & multilingual documents supported.</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Suggested action row ------------------------- */

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

/* ------------------------- Entity chip ------------------------- */

function EntityChip({ entity }: { entity: ExtractedEntity }) {
  const meta = ENTITY_META[entity.type] ?? ENTITY_META.other;
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-secondary/60 px-2.5 py-1.5 ring-1 ring-border/60">
      <span className={cn("flex h-6 w-6 items-center justify-center rounded-lg", meta.tone)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {meta.label}
        </p>
        <p className="truncate text-[12.5px] font-bold">{entity.value}</p>
      </div>
    </div>
  );
}

/* ------------------------- Follow-up Q&A ------------------------- */

interface FollowUpProps {
  result: ScanResult;
}

interface QaItem {
  question: string;
  answer: string;
  actions: SuggestedAction[];
  loading?: boolean;
}

function FollowUpQa({ result }: FollowUpProps) {
  const ctxRef = useRef<AskContext>({
    text: result.text,
    kind: result.kind,
    title: result.title,
    summary: result.summary,
    entities: result.entities,
  });
  // Keep context fresh if the result changes.
  ctxRef.current = {
    text: result.text,
    kind: result.kind,
    title: result.title,
    summary: result.summary,
    entities: result.entities,
  };

  const [history, setHistory] = useState<QaItem[]>([]);
  const [input, setInput] = useState<string>("");
  const [pending, setPending] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Reset history when the result id changes.
    setHistory([]);
    setInput("");
  }, [result.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, pending]);

  const ask = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || pending) return;
    setInput("");
    setPending(true);
    setHistory((h) => [...h, { question: trimmed, answer: "", actions: [], loading: true }]);
    try {
      const res = await askAboutScan(trimmed, ctxRef.current);
      setHistory((h) =>
        h.map((item, i) =>
          i === h.length - 1
            ? { ...item, answer: res.answer, actions: res.actions, loading: false }
            : item,
        ),
      );
    } catch (err) {
      const msg = userFacingError(err);
      if (msg) toast.error(msg);
      setHistory((h) =>
        h.map((item, i) =>
          i === h.length - 1
            ? { ...item, answer: "I couldn't answer that. Please try again.", loading: false }
            : item,
        ),
      );
    } finally {
      setPending(false);
    }
  }, [pending]);

  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-info/12 text-info">
          <MessageCircleQuestion className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-extrabold">Ask about this document</p>
          <p className="truncate text-[12px] text-muted-foreground">
            Follow-up questions answered from what the AI read.
          </p>
        </div>
      </div>

      {/* Conversation */}
      {history.length > 0 && (
        <div
          ref={scrollRef}
          className="mt-3 max-h-[220px] space-y-2.5 overflow-y-auto scrollbar-none"
        >
          {history.map((item, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground">
                  {item.question}
                </p>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-secondary px-3 py-2">
                  {item.loading ? (
                    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                      {item.answer}
                    </p>
                  )}
                  {!item.loading && item.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.actions.map((a, j) => (
                        <ActionInline key={`qa-${i}-${j}`} action={a} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Suggested prompts */}
      {history.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {FOLLOWUP_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => void ask(p)}
              className="rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-[12px] font-semibold transition-all active:scale-95 hover:border-info/40 hover:text-info"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="mt-3 flex items-center gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="h-11 rounded-xl bg-secondary/40 text-[14px]"
        />
        <Button
          type="submit"
          disabled={pending || !input.trim()}
          size="icon"
          className="h-11 w-11 shrink-0 rounded-xl"
          aria-label="Ask"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}

/** Inline action chip rendered in Q&A replies (one-tap add). */
function ActionInline({ action }: { action: SuggestedAction }) {
  const { addDocument, addExpense, addAppointment } = useApp();
  const meta = ACTION_META[action.kind];
  const Icon = meta.icon;
  const handle = () => {
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
    } catch {
      toast.error("Could not save. Please try again.");
    }
  };
  return (
    <button
      onClick={handle}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold transition-transform active:scale-95",
        meta.color,
      )}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </button>
  );
}

/* ------------------------- Scan result card ------------------------- */

function ScanResultCard({
  result,
  onClose,
  autoOpenReview,
  onReviewOpened,
}: {
  result: ScanResult;
  onClose: () => void;
  /** Open the editable review sheet automatically (fresh analysis). */
  autoOpenReview?: boolean;
  /** Called once the auto-opened review has been shown for this result. */
  onReviewOpened?: () => void;
}) {
  const navigate = useNavigate();
  const { addDocument, addExpense, addAppointment } = useApp();
  const { t } = useI18n();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [showText, setShowText] = useState<boolean>(false);
  const [saveOpen, setSaveOpen] = useState<boolean>(false);
  const [saveName, setSaveName] = useState<string>("");
  const [saveCategory, setSaveCategory] = useState<DocumentCategory>("Other");
  const [saveReminderDays, setSaveReminderDays] = useState<ReminderDays>(30);
  const [saveNotes, setSaveNotes] = useState<string>("");
  const [saveIssueDate, setSaveIssueDate] = useState<string>("");
  const [saveExpiryDate, setSaveExpiryDate] = useState<string>("");
  const [draftFields, setDraftFields] = useState<{ label: string; value: string }[]>([]);
  const [savedDocId, setSavedDocId] = useState<string | null>(null);

  // Pre-fill the review sheet with everything the AI extracted — title,
  // category, dates, summary and every field — whenever the result changes.
  useEffect(() => {
    setSaveName(result.title);
    setSaveCategory(result.category);
    setSaveReminderDays(30);
    setSaveNotes(result.summary);
    setSaveIssueDate(result.issueDate ?? "");
    setSaveExpiryDate(result.expiryDate ?? "");
    setDraftFields(result.fields.map((f) => ({ label: f.label, value: f.value })));
    setSavedDocId(null);
  }, [result.id, result.title, result.category, result.summary, result.issueDate, result.expiryDate, result.fields]);

  // After the AI finishes analyzing, open the editable review automatically
  // so the user checks and corrects the extraction BEFORE saving.
  const autoOpenedRef = useRef<boolean>(false);
  useEffect(() => {
    if (autoOpenReview && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setSaveOpen(true);
      onReviewOpened?.();
    }
  }, [autoOpenReview, onReviewOpened]);

  const updateField = useCallback((idx: number, key: "label" | "value", val: string) => {
    setDraftFields((fields) => fields.map((f, i) => (i === idx ? { ...f, [key]: val } : f)));
  }, []);

  const removeField = useCallback((idx: number) => {
    setDraftFields((fields) => fields.filter((_, i) => i !== idx));
  }, []);

  const addField = useCallback(() => {
    setDraftFields((fields) => [...fields, { label: "", value: "" }]);
  }, []);

  const suggestedCatMeta = DOCUMENT_META[result.category];
  const SuggestedCatIcon = suggestedCatMeta.icon;

  const GroupIcon = GROUP_ICON[result.group];
  const confidencePct = Math.round(result.confidence * 100);

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
      } catch {
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

  const handleSaveToVault = useCallback(() => {
    const name = saveName.trim();
    if (!name) {
      toast.error(t("review.nameRequired"));
      return;
    }
    // Keep only fields that still carry content after the user's review, and
    // persist them as readable lines in the notes so they stay visible and
    // editable everywhere in the app.
    const cleanFields = draftFields
      .map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
      .filter((f) => f.label.length > 0 || f.value.length > 0);
    const fieldLines = cleanFields
      .map((f) => (f.label && f.value ? `${f.label}: ${f.value}` : f.label || f.value))
      .join("\n");
    const notes = [saveNotes.trim(), fieldLines].filter(Boolean).join("\n\n");
    const doc: Omit<VaultDocument, "id" | "createdAt"> = {
      name,
      category: saveCategory,
      issueDate: saveIssueDate || null,
      expiryDate: saveExpiryDate || null,
      notes,
      reminderDays: saveReminderDays,
      fileName: null,
      fileKind: "image",
    };
    addDocument(doc);
    setSavedDocId("saved");
    setSaveOpen(false);
    toast.success(t("review.savedTo", { category: t(`documentCategories.${saveCategory}`) }), {
      description: t("review.savedDesc", { name }),
    });
  }, [saveName, saveCategory, saveNotes, saveReminderDays, saveIssueDate, saveExpiryDate, draftFields, addDocument, t]);

  return (
    <div className="animate-fade-in space-y-4 px-4 pt-4">
      {/* Header card */}
      <div className="overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border">
        <div
          className={cn(
            "flex items-start gap-3 border-b border-border/70 bg-gradient-to-br p-4",
            GROUP_TONE[result.group],
          )}
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/70 dark:bg-white/10">
            <GroupIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-white/70 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-foreground/80 dark:bg-white/10 dark:text-foreground">
                {SCAN_GROUP_LABEL[result.group]}
              </span>
              {result.language && (
                <span className="flex items-center gap-1 rounded-md bg-white/70 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-foreground/80 dark:bg-white/10 dark:text-foreground">
                  <Languages className="h-2.5 w-2.5" /> {result.language}
                </span>
              )}
              <span className="rounded-md bg-white/70 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-foreground/80 dark:bg-white/10 dark:text-foreground">
                {confidencePct}% confident
              </span>
            </div>
            <h3 className="mt-1.5 truncate text-[17px] font-extrabold tracking-tight text-foreground">
              {result.title}
            </h3>
            <p className="text-[11.5px] font-semibold text-foreground/60">
              {SCAN_KIND_LABEL[result.kind]}
            </p>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 flex h-9 w-9 items-center justify-center rounded-full text-foreground/70 hover:bg-white/40 dark:hover:bg-white/10"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {result.summary && (
          <div className="border-b border-border/70 p-4">
            <p className="text-[13.5px] leading-relaxed text-foreground/90">
              {result.summary}
            </p>
          </div>
        )}

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

      {/* Entity chips */}
      {result.entities.length > 0 && (
        <div className="space-y-2.5">
          <p className="px-1 text-[13px] font-bold text-muted-foreground">
            Detected details
          </p>
          <div className="grid grid-cols-2 gap-2">
            {result.entities.map((e, i) => (
              <EntityChip key={`ent-${i}`} entity={e} />
            ))}
          </div>
        </div>
      )}

      {/* Follow-up Q&A */}
      <FollowUpQa result={result} />

      {/* Captured text (collapsible) */}
      {result.text && (
        <div className="rounded-2xl bg-card p-3.5 shadow-sm ring-1 ring-border">
          <button
            onClick={() => setShowText((v) => !v)}
            className="flex w-full items-center justify-between"
          >
            <span className="flex items-center gap-2 text-[13px] font-bold">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Captured text
            </span>
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                showText && "rotate-90",
              )}
            />
          </button>
          {showText && (
            <pre className="mt-3 max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-secondary/50 p-3 text-[12px] leading-relaxed text-foreground/80 scrollbar-none">
              {result.text}
            </pre>
          )}
        </div>
      )}

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

      {/* Save to vault — AI suggests a file name + folder, user confirms/edits */}
      <div className="space-y-2.5">
        <p className="px-1 text-[13px] font-bold text-muted-foreground">
          {t("review.saveToVault")}
        </p>
        <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
          {/* AI suggestion preview */}
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                suggestedCatMeta.bubble,
              )}
            >
              <SuggestedCatIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("review.aiSuggestion")}
              </p>
              <p className="truncate text-[14.5px] font-extrabold text-foreground">
                {result.title}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[12.5px] font-semibold text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-success" />
                {t(`documentCategories.${result.category}`)}
                {result.expiryDate && ` · ${t("review.expires", { date: result.expiryDate })}`}
              </p>
            </div>
          </div>

          <Button
            onClick={() => setSaveOpen(true)}
            disabled={!!savedDocId}
            className="mt-3.5 h-12 w-full rounded-2xl text-[15px] font-extrabold shadow-md shadow-primary/20 transition-transform active:scale-[0.98]"
          >
            {savedDocId ? (
              <>
                <Check className="mr-1.5 h-4 w-4" />{" "}
                {t("review.savedTo", { category: t(`documentCategories.${saveCategory}`) })}
              </>
            ) : (
              <>
                <FileText className="mr-1.5 h-4 w-4" /> {t("review.reviewAndSave")}
              </>
            )}
          </Button>
          {savedDocId && (
            <button
              onClick={() => navigate("/documents")}
              className="mt-2 flex w-full items-center justify-center gap-1 text-[12.5px] font-bold text-primary dark:text-foreground"
            >
              {t("review.viewInDocuments")} <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
            </button>
          )}
        </div>
      </div>

      {/* Review & save — every extracted value is editable before anything
          is stored. Opens automatically right after analysis. */}
      <FormSheet
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title={t("review.title")}
        description={t("review.description")}
      >
        <div className="space-y-4">
          {/* AI suggestion banner */}
          <div className="flex items-start gap-3 rounded-2xl bg-info/8 p-3.5">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                suggestedCatMeta.bubble,
              )}
            >
              <SuggestedCatIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-info">
                {t("review.aiSuggestion")}
              </p>
              <p className="truncate text-[14px] font-extrabold">
                {result.title}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[12.5px] font-semibold text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-success" />
                {t(`documentCategories.${result.category}`)}
              </p>
            </div>
          </div>

          <Field label={t("review.docName")}>
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t("review.docNamePh")}
              className="h-12 rounded-xl"
            />
          </Field>

          <Field label={t("review.folder")} hint={t("review.folderHint")}>
            <ChipPicker
              options={DOCUMENT_CATEGORIES}
              value={saveCategory}
              onChange={(cat) => setSaveCategory(cat)}
              render={(cat) => t(`documentCategories.${cat}`)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("review.issueDate")}>
              <Input
                type="date"
                value={saveIssueDate}
                onChange={(e) => setSaveIssueDate(e.target.value)}
                className="h-12 rounded-xl"
              />
            </Field>
            <Field label={t("review.expiryDate")}>
              <Input
                type="date"
                value={saveExpiryDate}
                onChange={(e) => setSaveExpiryDate(e.target.value)}
                className="h-12 rounded-xl"
              />
            </Field>
          </div>

          {/* Extracted fields — fully editable: fix, remove, or add */}
          <Field
            label={t("review.details")}
            hint={t("review.detailsHint")}
          >
            <div className="space-y-2">
              {draftFields.length === 0 && (
                <p className="rounded-xl bg-secondary/50 px-3.5 py-3 text-[12.5px] text-muted-foreground">
                  {t("review.noDetails")}
                </p>
              )}
              {draftFields.map((f, i) => (
                <div key={`field-${i}`} className="flex items-center gap-2">
                  <Input
                    value={f.label}
                    onChange={(e) => updateField(i, "label", e.target.value)}
                    placeholder={t("review.labelPh")}
                    aria-label={`Detail ${i + 1} label`}
                    className="h-11 w-[38%] shrink-0 rounded-xl bg-secondary/40 font-semibold"
                  />
                  <Input
                    value={f.value}
                    onChange={(e) => updateField(i, "value", e.target.value)}
                    placeholder={t("review.valuePh")}
                    aria-label={`Detail ${i + 1} value`}
                    className="h-11 min-w-0 flex-1 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    aria-label={`Remove detail ${i + 1}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addField}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-secondary/30 py-2.5 text-[13px] font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Plus className="h-4 w-4" /> {t("review.addField")}
              </button>
            </div>
          </Field>

          <Field label={t("review.remind")}>
            <ChipPicker
              options={REMINDER_OPTIONS}
              value={saveReminderDays}
              onChange={(days) => setSaveReminderDays(days)}
              render={(days) => t("common.daysCount", { count: days })}
            />
          </Field>

          <Field label={t("common.notes")}>
            <Textarea
              value={saveNotes}
              onChange={(e) => setSaveNotes(e.target.value)}
              placeholder={t("review.notesPh")}
              className="min-h-[88px] rounded-xl"
            />
          </Field>

          <Button
            onClick={handleSaveToVault}
            className="h-[52px] w-full rounded-2xl text-[15px] font-extrabold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
          >
            <FileText className="mr-1.5 h-4 w-4" />{" "}
            {t("review.saveTo", { category: t(`documentCategories.${saveCategory}`) })}
          </Button>
        </div>
      </FormSheet>
    </div>
  );
}

/* ------------------------- Multi-doc result list ------------------------- */

interface ScanResultsProps {
  outcome: ScanOutcome;
  onReset: () => void;
}

function ScanResultsView({ outcome, onReset }: ScanResultsProps) {
  const [activeIdx, setActiveIdx] = useState<number>(0);
  // Result ids whose review sheet has already been auto-shown, so switching
  // between documents doesn't keep reopening it.
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());

  // If the user scans again and gets a single doc, default to it.
  useEffect(() => {
    setActiveIdx(0);
    setReviewedIds(new Set());
  }, [outcome]);

  const active = outcome.documents[activeIdx] ?? outcome.documents[0];
  if (!active) {
    return (
      <div className="space-y-4 px-4 pt-4">
        <div className="rounded-2xl bg-card p-6 text-center shadow-sm ring-1 ring-border">
          <p className="text-[14px] font-bold">No documents detected</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Try a clearer photo or better lighting.
          </p>
          <Button onClick={onReset} className="mt-4 rounded-xl">
            Scan again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 pt-4">
      {/* Multi-doc switcher (only when >1) */}
      {outcome.documents.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {outcome.documents.map((d, i) => {
            const Icon = GROUP_ICON[d.group];
            const isActive = i === activeIdx;
            return (
              <button
                key={d.id}
                onClick={() => setActiveIdx(i)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-left ring-1 transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground ring-primary"
                    : "bg-card text-foreground ring-border",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="max-w-[140px] truncate text-[13px] font-bold">
                  {d.title}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Page thumbnails */}
      {outcome.pages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {outcome.pages.map((p, i) => (
            <div
              key={`page-${i}`}
              className="shrink-0 overflow-hidden rounded-xl ring-1 ring-border"
            >
              <img src={p} alt={`Page ${i + 1}`} className="h-14 w-12 object-cover" />
            </div>
          ))}
        </div>
      )}

      <ScanResultCard
        key={active.id}
        result={active}
        onClose={onReset}
        autoOpenReview={!reviewedIds.has(active.id)}
        onReviewOpened={() =>
          setReviewedIds((prev) => {
            const next = new Set(prev);
            next.add(active.id);
            return next;
          })
        }
      />
    </div>
  );
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
            {SEARCH_SUGGESTED_PROMPTS.map((p) => (
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
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("scan");
  const [pages, setPages] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);

  const handleReset = useCallback(() => {
    setOutcome(null);
    setPages([]);
  }, []);

  // Keep the active scan tab visible when a result is set.
  const showResults = tab === "scan" && outcome && outcome.documents.length > 0;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t("assistant.title")}
        subtitle={t("assistant.subtitle")}
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
            <Camera className="h-4 w-4" /> {t("assistant.scanTab")}
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
            <SearchIcon className="h-4 w-4" /> {t("assistant.searchTab")}
          </button>
        </div>
      </div>

      {/* Panels */}
      {tab === "scan" ? (
        showResults ? (
          <ScanResultsView outcome={outcome} onReset={handleReset} />
        ) : (
          <ScanPanel
            pages={pages}
            setPages={setPages}
            onScanComplete={setOutcome}
          />
        )
      ) : (
        <SearchPanel />
      )}
    </div>
  );
}
