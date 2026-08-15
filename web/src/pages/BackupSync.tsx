import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BatteryCharging,
  CalendarClock,
  CheckCircle2,
  Clock,
  Cloud,
  CloudDownload,
  Database,
  FileText,
  HardDrive,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, SectionTitle } from "@/components/lifevault/PageHeader";
import { useApp } from "@/context/AppContext";
import { useSync } from "@/context/SyncContext";
import { supabaseConfigured } from "@/lib/supabase";
import { formatBytes, type BackupHistoryEntry, type BackupPreferences } from "@/lib/sync";
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

/**
 * True once `busy` has been active for a while — used to reassure the
 * user that the operation is still running and WILL end with a result.
 */
function useSlowHint(busy: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [busy]);
  return slow;
}

export default function BackupSync() {
  const navigate = useNavigate();
  const { user } = useApp();
  const sync = useSync();
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Show success banner briefly after a backup/sync completes.
  const prevStatusRef = useRef(sync.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev === "syncing" && sync.status === "idle" && sync.metadata?.lastBackupAt) {
      setShowSuccessBanner(true);
      const t = setTimeout(() => setShowSuccessBanner(false), 5000);
      return () => clearTimeout(t);
    }
    prevStatusRef.current = sync.status;
  }, [sync.status, sync.metadata?.lastBackupAt]);

  const prefs = sync.backupPrefs;
  const usage = sync.storageUsage;

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
      return { label: "Syncing", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: Loader2 };
    if (sync.status === "preparing")
      return { label: "Connecting…", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", icon: Cloud };
    if (sync.status === "restoring")
      return { label: "Restoring…", cls: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", icon: CloudDownload };
    if (sync.status === "offline")
      return { label: "Waiting for internet", cls: "bg-muted text-muted-foreground", icon: WifiOff };
    if (sync.status === "error")
      return { label: "Sync failed", cls: "bg-destructive/15 text-destructive", icon: AlertTriangle };
    if (!sync.cloudUnlocked && !sync.autoRestoreComplete)
      return { label: "Connecting…", cls: "bg-muted text-muted-foreground", icon: Cloud };
    if (sync.cloudUnlocked && !sync.isOnline)
      return { label: "Offline", cls: "bg-muted text-muted-foreground", icon: WifiOff };
    if (sync.metadata?.lastBackupAt)
      return { label: "Connected", cls: "bg-success/15 text-success", icon: CheckCircle2 };
    if (sync.cloudUnlocked)
      return { label: "Connected", cls: "bg-success/15 text-success", icon: CheckCircle2 };
    return { label: "Ready", cls: "bg-muted text-muted-foreground", icon: Cloud };
  })();

  const busy = sync.status === "syncing" || sync.status === "preparing" || sync.status === "restoring";

  return (
    <div className="animate-fade-in">
      <PageHeader title="Backup & Sync" subtitle="Secure cloud backup" back />

      {/* Success banner */}
      {showSuccessBanner && (
        <section className="px-4 pt-4">
          <div className="flex items-center gap-3 rounded-2xl bg-success/15 p-4 ring-1 ring-success/30 animate-fade-in">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
            <div>
              <p className="text-[14px] font-bold text-success">Sync completed successfully</p>
              <p className="text-[12px] text-success/80">Your vault is securely backed up.</p>
            </div>
          </div>
        </section>
      )}

      {/* Cloud status hero */}
      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(219,60%,15%)] to-[hsl(216,55%,28%)] p-5 text-white shadow-lg shadow-primary/15">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="relative flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Cloud className="h-6 w-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-extrabold">
                {user?.email ?? "Cloud account"}
              </p>
              <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-white/15 text-white")}>
                {(() => {
                  const Icon = statusPill.icon;
                  return <Icon className={cn("h-3 w-3", busy && "animate-spin")} />;
                })()}
                Cloud: {statusPill.label}
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

      {/* Storage usage */}
      <section className="px-4 pt-5">
        <SectionTitle>Storage</SectionTitle>
        <SettingsCard>
          <Row
            icon={FileText}
            bubble="bg-blue-500/12 text-blue-600 dark:text-blue-400"
            title="Documents"
            subtitle="Items in your vault"
            right={<StatValue value={usage?.documentCount?.toString() ?? "0"} />}
            isLast={false}
          />
          <Row
            icon={Database}
            bubble="bg-violet-500/12 text-violet-600 dark:text-violet-400"
            title="Total records"
            subtitle="All synced data records"
            right={<StatValue value={(usage?.totalRecords ?? 0).toString()} />}
            isLast={false}
          />
          <Row
            icon={HardDrive}
            bubble="bg-teal-500/12 text-teal-600 dark:text-teal-400"
            title="Cloud backup size"
            subtitle="Estimated encrypted size"
            right={<StatValue value={usage?.cloudSizeLabel ?? "0 B"} />}
            isLast
          />
        </SettingsCard>
      </section>

      {/* Progress bar while syncing */}
      {busy && (
        <section className="px-4 pt-5">
          <div className="overflow-hidden rounded-2xl bg-card p-4 ring-1 ring-border">
            <div className="mb-2 flex items-center justify-between text-[13px] font-bold">
              <span>{sync.progress >= 100 ? "Finishing…" : "Syncing…"}</span>
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
              if (!busy) void sync.backupNow();
            }}
            disabled={busy}
            className="h-[52px] rounded-2xl text-[14px] font-bold shadow-sm"
          >
            <Cloud className={cn("mr-2 h-5 w-5", busy && "animate-spin")} /> Backup Now
          </Button>
          <Button
            onClick={() => navigate("/restore")}
            disabled={busy}
            variant="outline"
            className="h-[52px] rounded-2xl text-[14px] font-bold"
          >
            <CloudDownload className="mr-2 h-5 w-5" /> Restore from Cloud
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <Button
            onClick={() => {
              if (!busy) void sync.syncNow();
            }}
            disabled={busy}
            variant="ghost"
            className="h-[44px] rounded-2xl text-[13px] font-bold"
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", busy && "animate-spin")} /> Sync Changes (Incremental)
          </Button>
        </div>
        {!sync.cloudUnlocked && !sync.autoRestoreComplete && (
          <p className="mt-3 text-center text-[12px] text-muted-foreground">
            Cloud backup connects automatically when you sign in with your password. Sync will
            start once the connection is established.
          </p>
        )}
        {sync.cloudUnlocked && (
          <p className="mt-3 text-center text-[12px] text-muted-foreground">
            Changes are backed up automatically. Use Backup Now for a full backup, or Sync Changes
            for an incremental sync.
          </p>
        )}
        {sync.status === "offline" && (
          <p className="mt-3 text-center text-[12px] text-muted-foreground">
            You're offline. Changes will sync automatically when you reconnect.
          </p>
        )}
      </section>

      {/* Backup history */}
      <section className="px-4 pt-6">
        <SectionTitle
          action={
            sync.backupHistory.length > 0 ? (
              <button
                type="button"
                onClick={() => sync.clearHistory()}
                className="text-[12px] font-bold text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear
              </button>
            ) : undefined
          }
        >
          Backup history
        </SectionTitle>
        {sync.backupHistory.length === 0 ? (
          <div className="rounded-2xl bg-card p-5 text-center ring-1 ring-border">
            <History className="mx-auto h-6 w-6 text-muted-foreground/50" />
            <p className="mt-2 text-[13px] text-muted-foreground">
              No backups yet. Your backup history will appear here.
            </p>
          </div>
        ) : (
          <SettingsCard>
            {sync.backupHistory.slice(0, historyOpen ? 50 : 5).map((entry, i, arr) => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                isLast={historyOpen ? i === arr.length - 1 : i === Math.min(arr.length, 5) - 1}
              />
            ))}
          </SettingsCard>
        )}
        {sync.backupHistory.length > 5 && !historyOpen && (
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="mt-2 w-full rounded-xl py-2 text-[13px] font-bold text-primary transition-colors hover:bg-primary/5"
          >
            Show all {sync.backupHistory.length} entries
          </button>
        )}
        {historyOpen && sync.backupHistory.length > 5 && (
          <button
            type="button"
            onClick={() => setHistoryOpen(false)}
            className="mt-2 w-full rounded-xl py-2 text-[13px] font-bold text-muted-foreground transition-colors hover:bg-secondary"
          >
            Show less
          </button>
        )}
      </section>

      {/* Backup preferences */}
      <section className="px-4 pt-6">
        <SectionTitle>Backup preferences</SectionTitle>
        <SettingsCard>
          <Row
            icon={Wifi}
            bubble="bg-blue-500/12 text-blue-600 dark:text-blue-400"
            title="Back up on Wi-Fi only"
            subtitle="Skip backups on cellular data"
            right={
              <Switch
                checked={prefs.wifiOnly}
                onCheckedChange={(v) => sync.setBackupPrefs({ wifiOnly: v })}
                aria-label="Toggle Wi-Fi only backup"
              />
            }
            isLast={false}
          />
          <Row
            icon={BatteryCharging}
            bubble="bg-green-500/12 text-green-600 dark:text-green-400"
            title="Back up while charging"
            subtitle="Only run backups when plugged in"
            right={
              <Switch
                checked={prefs.chargingOnly}
                onCheckedChange={(v) => sync.setBackupPrefs({ chargingOnly: v })}
                aria-label="Toggle charging only backup"
              />
            }
            isLast={false}
          />
          <Row
            icon={CalendarClock}
            bubble="bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
            title="Automatic daily backup"
            subtitle="Back up once a day automatically"
            right={
              <Switch
                checked={prefs.autoDailyBackup}
                onCheckedChange={(v) => sync.setBackupPrefs({ autoDailyBackup: v })}
                aria-label="Toggle automatic daily backup"
              />
            }
            isLast
          />
        </SettingsCard>
      </section>

      {/* Encryption info */}
      <section className="px-4 pt-6">
        <SectionTitle>Security</SectionTitle>
        <SettingsCard>
          <div className="flex items-start gap-3 px-4 py-4">
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success/12 text-success")}>
              <ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold">End-to-end encrypted</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                Your data is encrypted on this device before upload using your account password.
                Cloud backup is enabled automatically when you sign in — no separate password needed.
                We cannot read your documents, even if we wanted to.
              </p>
            </div>
          </div>
        </SettingsCard>
      </section>

      <section className="px-4 pb-6 pt-8">
        <p className="text-center text-[12px] text-muted-foreground">
          End-to-end encrypted · Powered by Supabase
        </p>
      </section>
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

/** Right-aligned stat value for use inside Row components. */
function StatValue({ value }: { value: string }) {
  return (
    <span className="shrink-0 text-[14px] font-extrabold tabular text-foreground">{value}</span>
  );
}

/** One entry in the backup history list. */
function HistoryRow({ entry, isLast }: { entry: BackupHistoryEntry; isLast: boolean }) {
  const icon =
    entry.status === "success" ? CheckCircle2 : entry.status === "failed" ? XCircle : Loader2;
  const Icon = icon;
  const bubble =
    entry.status === "success"
      ? "bg-success/12 text-success"
      : entry.status === "failed"
        ? "bg-destructive/12 text-destructive"
        : "bg-amber-500/12 text-amber-600 dark:text-amber-400";
  const statusLabel =
    entry.status === "success" ? "Success" : entry.status === "failed" ? "Failed" : "In progress";
  return (
    <div className={cn("flex w-full items-center gap-3 px-4 py-3.5", !isLast && "border-b border-border/70")}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", bubble)}>
        <Icon className={cn("h-[18px] w-[18px]", entry.status === "in_progress" && "animate-spin")} strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold">{statusLabel}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatTime(entry.timestamp)}
          {entry.recordCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{entry.recordCount} records</span>
            </>
          )}
          {entry.sizeBytes > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{formatBytes(entry.sizeBytes)}</span>
            </>
          )}
        </span>
        {entry.error && entry.status === "failed" && (
          <span className="mt-1 block truncate text-[11px] text-destructive/80">{entry.error}</span>
        )}
      </span>
    </div>
  );
}
