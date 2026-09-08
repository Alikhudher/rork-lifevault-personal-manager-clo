import { useCallback, useEffect, useState } from "react";
import { BellOff, BellRing, ChevronRight, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/lifevault/PageHeader";
import { useApp } from "@/context/AppContext";
import { useI18n } from "@/context/I18nContext";
import {
  areNativeNotificationsAvailable,
  ensureNotificationPermission,
  getNotificationPermissionStatus,
  openSystemNotificationSettings,
  type NativePermissionStatus,
} from "@/lib/native-notifications";
import type { NotificationPrefs } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROWS: { key: keyof NotificationPrefs; title: string; subtitle: string; icon: typeof BellRing; bubble: string }[] = [
  {
    key: "documents",
    title: "Document expiry",
    subtitle: "Passports, licences, insurance and more",
    icon: BellOff,
    bubble: "bg-warning/12 text-warning",
  },
  {
    key: "subscriptions",
    title: "Subscription renewals",
    subtitle: "Before a recurring payment is charged",
    icon: BellRing,
    bubble: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
  },
  {
    key: "bills",
    title: "Bill reminders",
    subtitle: "Utilities, rent and one-off bills",
    icon: BellRing,
    bubble: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  },
  {
    key: "appointments",
    title: "Appointments",
    subtitle: "Based on each appointment's reminder",
    icon: BellRing,
    bubble: "bg-success/12 text-success",
  },
  {
    key: "budget",
    title: "Budget warnings",
    subtitle: "When you approach your monthly budget",
    icon: BellOff,
    bubble: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  },
];

/**
 * Notification settings: per-category reminder toggles plus the native
 * iOS/Android notification permission controls (status, enable button,
 * and an "Open Settings" path when the OS permission was denied).
 */
export default function NotificationSettings() {
  const { settings, updateSettings } = useApp();
  const { t } = useI18n();
  const [nativeStatus, setNativeStatus] = useState<NativePermissionStatus>("unavailable");
  const [requesting, setRequesting] = useState<boolean>(false);

  const refreshStatus = useCallback(async () => {
    setNativeStatus(await getNotificationPermissionStatus());
  }, []);

  useEffect(() => {
    void refreshStatus();
    // Re-check when the user returns from the system Settings app.
    const onVisible = () => {
      if (!document.hidden) void refreshStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshStatus]);

  const setPref = (key: keyof NotificationPrefs, value: boolean) => {
    updateSettings({ notifications: { ...settings.notifications, [key]: value } });
  };

  const handleEnable = async () => {
    setRequesting(true);
    try {
      const status = await ensureNotificationPermission();
      setNativeStatus(status);
      if (status === "granted") {
        toast.success(t("nativeNotif.enabledToast"));
      } else if (status === "denied") {
        toast.error(t("nativeNotif.deniedToast"));
      }
    } finally {
      setRequesting(false);
    }
  };

  const nativeAvailable = areNativeNotificationsAvailable();
  const granted = nativeStatus === "granted";
  const denied = nativeStatus === "denied";

  return (
    <div className="animate-fade-in">
      <PageHeader title="Notification Settings" subtitle="Choose your reminders" back />
      <div className="space-y-4 px-4 pt-4">
        {/* Native iOS/Android notification permission */}
        <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                granted
                  ? "bg-success/12 text-success"
                  : denied
                    ? "bg-destructive/12 text-destructive"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {granted ? <BellRing className="h-[18px] w-[18px]" /> : <BellOff className="h-[18px] w-[18px]" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold">{t("nativeNotif.title")}</p>
              <p className="text-[12px] text-muted-foreground">
                {!nativeAvailable
                  ? t("nativeNotif.unavailable")
                  : granted
                    ? t("nativeNotif.grantedSubtitle")
                    : denied
                      ? t("nativeNotif.deniedSubtitle")
                      : t("nativeNotif.promptSubtitle")}
              </p>
            </div>
            {nativeAvailable && granted && (
              <Switch checked disabled aria-label={t("nativeNotif.title")} />
            )}
          </div>

          {nativeAvailable && !granted && (
            <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3 sm:flex-row">
              {!denied && (
                <Button
                  onClick={handleEnable}
                  disabled={requesting}
                  className="h-10 flex-1 rounded-xl text-[13.5px] font-bold"
                >
                  {requesting ? t("nativeNotif.requesting") : t("nativeNotif.enable")}
                </Button>
              )}
              {denied && (
                <>
                  <p className="flex-1 text-[12px] leading-relaxed text-muted-foreground">
                    {t("nativeNotif.deniedExplanation")}
                  </p>
                  <Button
                    onClick={openSystemNotificationSettings}
                    variant="outline"
                    className="h-10 shrink-0 rounded-xl text-[13.5px] font-bold"
                  >
                    <Settings2 className="mr-1.5 h-4 w-4" />
                    {t("nativeNotif.openSettings")}
                  </Button>
                </>
              )}
            </div>
          )}

          {nativeAvailable && (
            <button
              type="button"
              onClick={openSystemNotificationSettings}
              className="mt-3 flex w-full items-center justify-between rounded-xl bg-secondary/50 px-3 py-2.5 text-left transition-colors hover:bg-secondary"
            >
              <span className="text-[12.5px] font-semibold text-muted-foreground">
                {t("nativeNotif.systemSettingsHint")}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Per-category toggles */}
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
        <p className="px-1 pb-4 text-[12px] leading-relaxed text-muted-foreground">
          Reminder timing is set individually on each document, subscription and appointment.
          Reminders are delivered as native notifications at the exact selected date, time and
          timezone — even when the app is closed.
        </p>
      </div>
    </div>
  );
}
