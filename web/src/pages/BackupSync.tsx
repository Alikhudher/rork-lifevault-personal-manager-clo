import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Cloud,
  CloudDownload,
  CloudUpload,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader, SectionTitle } from "@/components/lifevault/PageHeader";
import { Field, FormSheet } from "@/components/lifevault/FormSheet";
import { useApp } from "@/context/AppContext";
import { useSync } from "@/context/SyncContext";
import { supabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">{children}</div>
  );
}

function Row({
  icon: Icon,
  bubble,
  title,
  subtitle,
  right,
  onClick,
  danger,
  isLast,
}: {
  icon: typeof Cloud;
  bubble: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  isLast?: boolean;
}) {
  const content = (
    <>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", bubble)}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className={cn("block text-[14px] font-bold", danger && "text-destructive")}>{title}</span>
        {subtitle && <span className="block text-[12px] text-muted-foreground">{subtitle}</span>}
      </span>
      {right}
    </>
  );
  const className = cn(
    "flex w-full items-center gap-3 px-4 py-3.5",
    !isLast && "border-b border-border/70",
    onClick && "transition-colors hover:bg-secondary/40 active:bg-secondary/60",
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function formatTime(ms: number | null | undefined): string {
  if (!ms) return "Never";
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BackupSync() {
  const navigate = useNavigate();
  const { user } = useApp();
  const sync = useSync();
  const [setupOpen, setSetupOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [autoSync, setAutoSync] = useState(true);

  // If Supabase env vars are missing, show a single setup-required card.
  if (!supabaseConfigured) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Backup & Sync" subtitle="Secure cloud backup" back />
        <section className="px-4 pt-6">
          <div className="rounded-2xl bg-amber-500/10 p-5 text-center ring-1 ring-amber-500/30">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-600 dark:text-amber-400" />
            <p className="mt-3 text-[15px] font-extrabold">Cloud backup not configured</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              Add your Supabase project URL and anon key to the app environment variables
              (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) to enable secure encrypted cloud
              backup and sync across devices.
            </p>
          </div>
        </section>
      </div>
    );
  }

  const statusPill = (() => {
    if (sync.status === "syncing")
      return { label: "Syncing…", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" };
    if (sync.status === "error")
      return { label: "Last sync failed", cls: "bg-destructive/15 text-destructive" };
    if (!sync.cloudUnlocked)
      return { label: "Cloud locked", cls: "bg-muted text-muted-foreground" };
    if (sync.metadata?.lastBackupAt)
      return { label: "Up to date", cls: "bg-success/15 text-success" };
    return { label: "Not backed up yet", cls: "bg-muted text-muted-foreground" };
  })();

  const busy = sync.status === "syncing";

  return (
    <div className="animate-fade-in">
      <PageHeader title="Backup & Sync" subtitle="Secure cloud backup" back />

      {/* Cloud status hero */}
      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(219,60%,15%)] to-[hsl(216,55%,28%)] p-5 text-white shadow-lg shadow-primary/15">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="relative flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <Cloud className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-extrabold">
                {sync.cloudSignedIn ? user?.email ?? "Cloud account" : "Not connected"}
              </p>
              <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold", statusPill.cls, "bg-white/15 text-white")}>
                <ShieldCheck className="h-3 w-3" /> {statusPill.label}
              </span>
            </div>
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
            <Stat label="Last backup" value={formatTime(sync.metadata?.lastBackupAt)} />
            <Stat label="Last sync" value={formatTime(sync.metadata?.lastSyncedAt)} />
            <Stat label="Records" value={sync.metadata?.cloudRecordCount ?? 0} />
          </div>
        </div>
      </section>

      {/* Encryption explainer */}
      <section className="px-4 pt-5">
        <div className="flex items-start gap-3 rounded-2xl bg-success/10 p-4 ring-1 ring-success/25">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Your data is <span className="font-bold text-foreground">encrypted on this device</span> before
            upload. Your backup password derives the encryption key — we cannot read your documents,
            even if we wanted to.
          </p>
        </div>
      </section>

      {/* Progress bar while syncing */}
      {busy && (
        <section className="px-4 pt-5">
          <div className="overflow-hidden rounded-2xl bg-card p-4 ring-1 ring-border">
            <div className="mb-2 flex items-center justify-between text-[13px] font-bold">
              <span>{sync.progress >= 100 ? "Finishing…" : "Working…"}</span>
              <span className="tabular">{sync.progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${sync.progress}%` }}
              />
            </div>
          </div>
        </section>
      )}

      {/* Primary actions */}
      <section className="px-4 pt-6">
        <SectionTitle>Actions</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={() => {
              if (!sync.cloudUnlocked) {
                setUnlockOpen(true);
              } else {
                void sync.backupNow();
              }
            }}
            disabled={busy}
            className="h-[52px] rounded-2xl text-[14px] font-bold shadow-sm"
          >
            <CloudUpload className="mr-2 h-5 w-5" /> Back up now
          </Button>
          <Button
            onClick={() => {
              if (!sync.cloudUnlocked) {
                setUnlockOpen(true);
              } else {
                navigate("/restore");
              }
            }}
            disabled={busy}
            variant="outline"
            className="h-[52px] rounded-2xl text-[14px] font-bold"
          >
            <CloudDownload className="mr-2 h-5 w-5" /> Restore
          </Button>
        </div>
      </section>

      {/* Cloud account management */}
      <section className="px-4 pt-6">
        <SectionTitle>Cloud account</SectionTitle>
        <SettingsCard>
          {!sync.cloudUnlocked && (
            <>
              <Row
                icon={Cloud}
                bubble="bg-info/12 text-info"
                title={sync.hasExistingBackup ? "Unlock cloud backup" : "Enable cloud backup"}
                subtitle={
                  sync.hasExistingBackup
                    ? "Enter your backup password to decrypt"
                    : "Set a backup password to start secure sync"
                }
                onClick={() => (sync.hasExistingBackup ? setUnlockOpen(true) : setSetupOpen(true))}
                isLast={false}
              />
            </>
          )}
          {sync.cloudUnlocked && (
            <>
              <Row
                icon={RefreshCw}
                bubble="bg-info/12 text-info"
                title="Sync now"
                subtitle="Push & pull latest changes"
                onClick={() => void sync.syncNow()}
                isLast={false}
              />
              <Row
                icon={Lock}
                bubble="bg-violet-500/12 text-violet-600 dark:text-violet-400"
                title="Lock cloud"
                subtitle="Forget the encryption key on this device"
                onClick={() => {
                  sync.lockCloud();
                  toast.success("Cloud access locked");
                }}
                isLast={false}
              />
              <Row
                icon={KeyRound}
                bubble="bg-warning/12 text-warning"
                title="Change backup password"
                subtitle="Re-encrypts all your data with the new password"
                onClick={() => setChangePwOpen(true)}
                isLast={false}
              />
              <Row
                icon={Trash2}
                bubble="bg-destructive/12 text-destructive"
                title="Disable cloud backup"
                subtitle="Wipe all cloud data and sign out"
                danger
                onClick={() => setDisableOpen(true)}
                isLast
              />
            </>
          )}
        </SettingsCard>
      </section>

      {/* Preferences */}
      <section className="px-4 pt-6">
        <SectionTitle>Preferences</SectionTitle>
        <SettingsCard>
          <Row
            icon={RefreshCw}
            bubble="bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
            title="Automatic sync"
            subtitle="Keep devices in sync automatically"
            right={
              <Switch
                checked={autoSync}
                onCheckedChange={setAutoSync}
                aria-label="Toggle automatic sync"
              />
            }
            isLast
          />
        </SettingsCard>
        {!autoSync && (
          <p className="px-1 pt-2 text-[12px] text-muted-foreground">
            You'll need to back up manually after each change.
          </p>
        )}
      </section>

      <section className="px-4 pb-6 pt-8">
        <p className="text-center text-[12px] text-muted-foreground">
          End-to-end encrypted · Powered by Supabase
        </p>
      </section>

      {/* Setup sheet */}
      <SetupSheet open={setupOpen} onOpenChange={setSetupOpen} defaultEmail={user?.email ?? ""} />
      {/* Unlock sheet */}
      <UnlockSheet open={unlockOpen} onOpenChange={setUnlockOpen} defaultEmail={user?.email ?? ""} />
      {/* Change password sheet */}
      <ChangePasswordSheet open={changePwOpen} onOpenChange={setChangePwOpen} />
      {/* Disable confirm */}
      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent className="mx-auto max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Disable cloud backup?</AlertDialogTitle>
            <AlertDialogDescription>
              All your encrypted data will be permanently deleted from the cloud. Your local data on
              this device stays intact. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const ok = await sync.disableCloud();
                setDisableOpen(false);
                if (ok) toast.success("Cloud backup disabled");
                else toast.error("Could not disable cloud backup");
              }}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disable & wipe
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="truncate text-[13px] font-extrabold tabular">{value}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-white/55">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sheets                                                              */
/* ------------------------------------------------------------------ */

function SetupSheet({
  open,
  onOpenChange,
  defaultEmail,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultEmail: string;
}) {
  const sync = useSync();
  const [email, setEmail] = useState(defaultEmail);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const ranEmail = useRef(defaultEmail);

  useEffect(() => {
    if (open && ranEmail.current !== defaultEmail) {
      setEmail(defaultEmail);
      ranEmail.current = defaultEmail;
    }
  }, [open, defaultEmail]);

  const submit = async () => {
    if (!email.trim()) return toast.error("Enter your email");
    if (pw.length < 8) return toast.error("Backup password must be at least 8 characters");
    if (pw !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    const ok = await sync.setupCloud(email.trim().toLowerCase(), pw);
    setBusy(false);
    if (ok) {
      onOpenChange(false);
      setPw("");
      setConfirm("");
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Enable cloud backup"
      description="Set a backup password — it encrypts your data and is never sent to us."
    >
      <div className="space-y-4">
        <Field label="Email" hint="Used as your cloud identity. Can be the same as your LifeVault email.">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>
        <Field label="Backup password" hint="At least 8 characters. You'll need this to restore on a new device.">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>
        <Field label="Confirm backup password">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>
        <div className="flex items-start gap-2 rounded-xl bg-warning/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            If you forget this password, your cloud backup cannot be recovered.
          </p>
        </div>
        <Button
          onClick={submit}
          disabled={busy}
          className="h-[52px] w-full rounded-2xl text-[15px] font-bold"
        >
          {busy ? "Setting up…" : "Enable backup"}
        </Button>
      </div>
    </FormSheet>
  );
}

function UnlockSheet({
  open,
  onOpenChange,
  defaultEmail,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultEmail: string;
}) {
  const sync = useSync();
  const [email, setEmail] = useState(defaultEmail);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const ranEmail = useRef(defaultEmail);

  useEffect(() => {
    if (open && ranEmail.current !== defaultEmail) {
      setEmail(defaultEmail);
      ranEmail.current = defaultEmail;
    }
  }, [open, defaultEmail]);

  const submit = async () => {
    if (!email.trim() || !pw) return toast.error("Enter your email and backup password");
    setBusy(true);
    const ok = await sync.unlockCloud(email.trim().toLowerCase(), pw);
    setBusy(false);
    if (ok) {
      onOpenChange(false);
      setPw("");
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Unlock cloud backup"
      description="Enter your backup password to decrypt your data."
    >
      <div className="space-y-4">
        <Field label="Email">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>
        <Field label="Backup password">
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="h-12 rounded-xl"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </Field>
        <Button
          onClick={submit}
          disabled={busy}
          className="h-[52px] w-full rounded-2xl text-[15px] font-bold"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </div>
    </FormSheet>
  );
}

function ChangePasswordSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const sync = useSync();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!current || !next) return toast.error("Fill in both passwords");
    if (next.length < 8) return toast.error("New password must be at least 8 characters");
    if (next !== confirm) return toast.error("New passwords do not match");
    setBusy(true);
    const ok = await sync.changeBackupPassword(current, next);
    setBusy(false);
    if (ok) {
      onOpenChange(false);
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Change backup password"
      description="Your data will be re-encrypted and re-uploaded with the new password."
    >
      <div className="space-y-4">
        <Field label="Current backup password">
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>
        <Field label="New backup password">
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>
        <Button
          onClick={submit}
          disabled={busy}
          className="h-[52px] w-full rounded-2xl text-[15px] font-bold"
        >
          {busy ? "Re-encrypting…" : "Change password"}
        </Button>
      </div>
    </FormSheet>
  );
}
