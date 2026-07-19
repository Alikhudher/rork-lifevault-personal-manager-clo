import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CloudDownload, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/lifevault/PageHeader";
import { useApp, type RestoredRecord } from "@/context/AppContext";
import { useSync } from "@/context/SyncContext";
import { cn } from "@/lib/utils";

type Phase = "idle" | "restoring" | "done" | "error";

export default function Restore() {
  const navigate = useNavigate();
  const app = useApp();
  const sync = useSync();
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(0);

  const handleRestore = async () => {
    setPhase("restoring");
    const result = await sync.restoreNow();
    if (!result.ok) {
      setPhase("error");
      toast.error(result.error ?? "Restore failed");
      return;
    }
    app.applyRestoredRecords(result.records as RestoredRecord[]);
    const total = result.records.filter((r) => !r.deletedAt).length;
    setCount(total);
    setPhase("done");
    toast.success(`Restored ${total} records from the cloud`);
  };

  const localCount =
    app.documents.length +
    app.expenses.length +
    app.subscriptions.length +
    app.appointments.length;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Restore from cloud" subtitle="One-tap restore" back />

      <section className="px-4 pt-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(219,60%,15%)] to-[hsl(216,55%,28%)] p-6 text-white shadow-lg shadow-primary/15">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="relative">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
              <CloudDownload className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-[20px] font-extrabold tracking-tight">Restore everything</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/70">
              Download and decrypt your encrypted cloud backup. This replaces the local data on this
              device with what's stored in the cloud.
            </p>
          </div>
        </div>
      </section>

      {/* Local-vs-cloud summary */}
      <section className="px-4 pt-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-card p-4 text-center ring-1 ring-border">
            <p className="text-[20px] font-extrabold tabular">{localCount}</p>
            <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              On this device
            </p>
          </div>
          <div className="rounded-2xl bg-card p-4 text-center ring-1 ring-border">
            <p className="text-[20px] font-extrabold tabular">
              {sync.metadata?.cloudRecordCount ?? "—"}
            </p>
            <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              In the cloud
            </p>
          </div>
        </div>
      </section>

      {/* Progress / result */}
      {(phase === "restoring" || phase === "done") && (
        <section className="px-4 pt-5">
          <div className="overflow-hidden rounded-2xl bg-card p-4 ring-1 ring-border">
            <div className="mb-2 flex items-center justify-between text-[13px] font-bold">
              <span className="flex items-center gap-2">
                {phase === "done" ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <RotateCcw className="h-4 w-4 animate-spin text-primary" />
                )}
                {phase === "done" ? "Restore complete" : "Restoring…"}
              </span>
              <span className="tabular">{sync.progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  phase === "done" ? "bg-success" : "bg-primary",
                )}
                style={{ width: `${phase === "done" ? 100 : sync.progress}%` }}
              />
            </div>
            {phase === "done" && (
              <p className="mt-3 text-[12.5px] text-muted-foreground">
                {count} records restored. Your vault is back in sync.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Warning + action */}
      <section className="px-4 pt-5">
        <div className="flex items-start gap-3 rounded-2xl bg-warning/10 p-4 ring-1 ring-warning/25">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Restoring replaces the data currently on this device with your cloud backup. If you have
            unsynced local changes, back them up first.
          </p>
        </div>
      </section>

      <section className="px-4 pt-6 pb-10">
        {phase === "done" ? (
          <Button
            onClick={() => navigate("/")}
            className="h-[52px] w-full rounded-2xl text-[15px] font-bold"
          >
            Done — back to home
          </Button>
        ) : (
          <Button
            onClick={handleRestore}
            disabled={phase === "restoring" || !sync.cloudUnlocked}
            className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25"
          >
            {phase === "restoring" ? "Restoring…" : "Restore everything"}
          </Button>
        )}
        {!sync.cloudUnlocked && (
          <p className="mt-3 text-center text-[12px] text-muted-foreground">
            Unlock cloud backup first from the Backup &amp; Sync screen.
          </p>
        )}
      </section>
    </div>
  );
}
