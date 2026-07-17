import { useMemo, useState } from "react";
import { BellOff, CalendarClock, CheckCheck, FileWarning, PiggyBank, Receipt, RefreshCcw } from "lucide-react";
import { PageHeader } from "@/components/lifevault/PageHeader";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { relativeDayLabel } from "@/lib/format";
import type { NotificationType } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_META: Record<NotificationType, { label: string; icon: typeof FileWarning; bubble: string }> = {
  document: { label: "Documents", icon: FileWarning, bubble: "bg-warning/12 text-warning" },
  subscription: { label: "Subscriptions", icon: RefreshCcw, bubble: "bg-blue-500/12 text-blue-600 dark:text-blue-400" },
  bill: { label: "Bills", icon: Receipt, bubble: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  appointment: { label: "Appointments", icon: CalendarClock, bubble: "bg-success/12 text-success" },
  budget: { label: "Budget", icon: PiggyBank, bubble: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
};

const FILTERS: { value: "all" | NotificationType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "document", label: "Documents" },
  { value: "subscription", label: "Subscriptions" },
  { value: "bill", label: "Bills" },
  { value: "appointment", label: "Appointments" },
  { value: "budget", label: "Budget" },
];

export default function Notifications() {
  const { notifications, markNotificationRead, markAllNotificationsRead, unreadCount } = useApp();
  const [filter, setFilter] = useState<"all" | NotificationType>("all");

  const filtered = useMemo(
    () =>
      notifications
        .filter((n) => filter === "all" || n.type === filter)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [notifications, filter],
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
        back
        actions={
          unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllNotificationsRead}
              className="rounded-full text-[13px] font-bold text-primary dark:text-foreground"
            >
              <CheckCheck className="mr-1 h-4 w-4" /> Mark all read
            </Button>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pt-4">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-all active:scale-95",
              filter === f.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-2.5 px-4 pt-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl bg-card py-14 text-center shadow-sm ring-1 ring-border">
            <BellOff className="h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-[15px] font-bold">No notifications</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Reminders will appear here.</p>
          </div>
        ) : (
          filtered.map((n) => {
            const meta = TYPE_META[n.type];
            const Icon = meta.icon;
            return (
              <button
                key={n.id}
                onClick={() => markNotificationRead(n.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-2xl p-3.5 text-left shadow-sm ring-1 ring-border transition-all active:scale-[0.99]",
                  n.read ? "bg-card" : "bg-accent",
                )}
              >
                <span className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", meta.bubble)}>
                  <Icon className="h-5 w-5" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn("text-[14px] leading-snug", n.read ? "font-semibold" : "font-extrabold")}>
                      {n.title}
                    </p>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-info" />}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{n.message}</p>
                  <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {relativeDayLabel(n.date)}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
