import { CalendarClock, FileWarning, PiggyBank, Receipt, RefreshCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/lifevault/PageHeader";
import { useApp } from "@/context/AppContext";
import type { NotificationPrefs } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROWS: { key: keyof NotificationPrefs; title: string; subtitle: string; icon: typeof FileWarning; bubble: string }[] = [
  {
    key: "documents",
    title: "Document expiry",
    subtitle: "Passports, licences, insurance and more",
    icon: FileWarning,
    bubble: "bg-warning/12 text-warning",
  },
  {
    key: "subscriptions",
    title: "Subscription renewals",
    subtitle: "Before a recurring payment is charged",
    icon: RefreshCcw,
    bubble: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
  },
  {
    key: "bills",
    title: "Bill reminders",
    subtitle: "Utilities, rent and one-off bills",
    icon: Receipt,
    bubble: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  },
  {
    key: "appointments",
    title: "Appointments",
    subtitle: "Based on each appointment's reminder",
    icon: CalendarClock,
    bubble: "bg-success/12 text-success",
  },
  {
    key: "budget",
    title: "Budget warnings",
    subtitle: "When you approach your monthly budget",
    icon: PiggyBank,
    bubble: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  },
];

export default function NotificationSettings() {
  const { settings, updateSettings } = useApp();

  const setPref = (key: keyof NotificationPrefs, value: boolean) => {
    updateSettings({ notifications: { ...settings.notifications, [key]: value } });
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Notification Settings" subtitle="Choose your reminders" back />
      <div className="px-4 pt-4">
        <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
          {ROWS.map((row, i) => (
            <div
              key={row.key}
              className={cn("flex items-center gap-3 px-4 py-3.5", i < ROWS.length - 1 && "border-b border-border/70")}
            >
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", row.bubble)}>
                <row.icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold">{row.title}</p>
                <p className="text-[12px] text-muted-foreground">{row.subtitle}</p>
              </div>
              <Switch
                checked={settings.notifications[row.key]}
                onCheckedChange={(value) => setPref(row.key, value)}
                aria-label={`Toggle ${row.title}`}
              />
            </div>
          ))}
        </div>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-muted-foreground">
          Reminder timing is set individually on each document, subscription and appointment.
        </p>
      </div>
    </div>
  );
}
