/**
 * Native local-notification engine (iOS + Android) built on
 * @capacitor/local-notifications. Never uses browser notifications.
 *
 * Responsibilities:
 *  - Permission lifecycle: request on first reminder creation; report a
 *    clear denied state so UIs can offer "Open iPhone Settings".
 *  - Reconciliation: the app owns its entire local-notification space, so
 *    every reconcile cancels ALL pending notifications and schedules the
 *    exact desired set. This makes edits, deletes and completions cancel
 *    their old notifications automatically and makes scheduling
 *    idempotent — duplicates are impossible.
 *  - Tap routing: notifications carry { kind, itemId } and listeners can
 *    deep-link to the exact item.
 *
 * On web this module is a no-op (no browser Notification APIs are used).
 */
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import type { DesiredNotification } from "./reminder-scheduling";

export type NativePermissionStatus = "granted" | "denied" | "prompt" | "unavailable";

/** Outcome of a reconcile pass — `scheduled: 0` means nothing was scheduled. */
export interface ReconcileResult {
  platform: "ios" | "android" | "web";
  permission: NativePermissionStatus;
  cancelled: number;
  scheduled: number;
}

/** True only on real native builds — web never schedules anything. */
export function areNativeNotificationsAvailable(): boolean {
  return (
    typeof Capacitor !== "undefined" &&
    Capacitor.isNativePlatform() &&
    (Capacitor.getPlatform() === "ios" || Capacitor.getPlatform() === "android")
  );
}

/** Read the current native permission status without prompting. */
export async function getNotificationPermissionStatus(): Promise<NativePermissionStatus> {
  if (!areNativeNotificationsAvailable()) return "unavailable";
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display === "granted") return "granted";
    if (display === "denied") return "denied";
    return "prompt";
  } catch {
    return "unavailable";
  }
}

/**
 * Ensure permission before scheduling. Prompts the OS dialog the first
 * time ("prompt"), returns the resulting status. Callers must NOT report
 * a notification as scheduled unless this returned "granted".
 */
export async function ensureNotificationPermission(): Promise<NativePermissionStatus> {
  if (!areNativeNotificationsAvailable()) return "unavailable";
  const status = await getNotificationPermissionStatus();
  if (status === "granted" || status === "unavailable") return status;
  try {
    const { display } = await LocalNotifications.requestPermissions();
    return display === "granted" ? "granted" : display === "denied" ? "denied" : "prompt";
  } catch {
    return "denied";
  }
}

/** Throttle for the denied toast so background reconcile loops can't spam. */
let lastDeniedNoticeAt = 0;
let onDeniedHandler: (() => void) | null = null;

/** Register a callback fired (max once/60s) when scheduling is blocked because permission is denied. */
export function setOnNotificationsDenied(handler: (() => void) | null): void {
  onDeniedHandler = handler;
}

/**
 * Open this app's page in the iOS/Android system Settings so the user can
 * re-enable notifications after a denial. Uses the platform settings URL
 * scheme via window.open("_system"), which Capacitor routes through
 * UIApplication.openURL on iOS.
 */
export function openSystemNotificationSettings(): void {
  const platform = Capacitor.getPlatform();
  if (platform === "ios") {
    window.open("app-settings:", "_system");
  } else if (platform === "android") {
    // Android: deep-link to this app's notification settings page.
    window.open(
      `android-app://com.aliomer.lifevault`,
      "_system",
    );
  }
}

/**
 * Reconcile native pending notifications with the desired set.
 *
 * Always: cancel every pending notification, then schedule exactly the
 * desired future notifications. If permission is missing we first prompt
 * (this is what triggers the native iOS dialog on the user's first
 * reminder). If denied, nothing is scheduled and `scheduled` is 0 —
 * callers must treat that as NOT scheduled.
 */
export async function reconcileNotifications(
  desired: DesiredNotification[],
): Promise<ReconcileResult> {
  if (!areNativeNotificationsAvailable()) {
    return { platform: "web", permission: "unavailable", cancelled: 0, scheduled: 0 };
  }

  const permission = await ensureNotificationPermission();
  if (permission !== "granted") {
    if (permission === "denied" && Date.now() - lastDeniedNoticeAt > 60_000) {
      lastDeniedNoticeAt = Date.now();
      onDeniedHandler?.();
    }
    return { platform: Capacitor.getPlatform() as ReconcileResult["platform"], permission, cancelled: 0, scheduled: 0 };
  }

  // Cancel EVERYTHING pending first — the desired set is the full truth.
  let cancelled = 0;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
      cancelled = pending.notifications.length;
    }
  } catch (err) {
    console.warn("[Notif] Failed to read/cancel pending notifications:", err);
  }

  // Schedule the desired future notifications (iOS is wall-clock local
  // time — `at` already carries the device timezone).
  const future = desired
    .filter((n) => n.at.getTime() > Date.now())
    .slice(0, 60); // iOS keeps a limited pending queue; stay well inside it.

  let scheduled = 0;
  if (future.length > 0) {
    try {
      await LocalNotifications.schedule({
        notifications: future.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          schedule: { at: n.at, allowWhileIdle: true },
          // Attach routing data; Android needs an id string.
          extra: { kind: n.data.kind, itemId: n.data.itemId },
          actionTypeId: "",
          attachments: [],
        })),
      });
      scheduled = future.length;
      console.log(
        `[Notif] Scheduled ${scheduled} notification(s) (cancelled ${cancelled} stale) — ` +
          future.map((n) => `${n.data.kind}:${n.data.itemId}@${n.at.toISOString()}`).join(", "),
      );
    } catch (err) {
      console.error("[Notif] Scheduling failed:", err);
    }
  } else {
    console.log(`[Notif] Reconciled — cancelled ${cancelled} stale, nothing future to schedule`);
  }

  return { platform: Capacitor.getPlatform() as ReconcileResult["platform"], permission, cancelled, scheduled };
}

/** Data payload attached to every notification we schedule. */
export interface NotificationTapData {
  kind: "appointment" | "document" | "subscription";
  itemId: string;
}

/**
 * Listen for taps on delivered notifications (fires while the app runs,
 * including cold starts after a tap while fully closed). Returns a
 * disposer. Web is a no-op.
 */
export function addNotificationTapListener(
  handler: (data: NotificationTapData) => void,
): () => void {
  if (!areNativeNotificationsAvailable()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let disposed = false;
  void LocalNotifications.addListener(
    "localNotificationActionPerformed",
    (action) => {
      const extra = action.notification.extra as Partial<NotificationTapData> | undefined;
      if (extra && (extra.kind === "appointment" || extra.kind === "document" || extra.kind === "subscription") && typeof extra.itemId === "string") {
        handler({ kind: extra.kind, itemId: extra.itemId });
      }
    },
  ).then((h) => {
    if (disposed) void h.remove();
    else handle = h;
  });
  return () => {
    disposed = true;
    if (handle) void handle.remove();
  };
}

/** Convenience: cancel every pending notification (e.g. on sign-out). */
export async function cancelAllPendingNotifications(): Promise<void> {
  if (!areNativeNotificationsAvailable()) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }
  } catch (err) {
    console.warn("[Notif] cancelAllPending failed:", err);
  }
}
