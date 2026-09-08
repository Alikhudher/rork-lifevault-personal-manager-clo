/**
 * @vitest-environment jsdom
 *
 * Native notification engine tests.
 *
 * Prove:
 *  1. Every scheduled notification carries `sound: "default"` — on iOS a
 *     notification WITHOUT an explicit sound is delivered SILENTLY (no
 *     sound, no vibration). This is a regression test for the silent
 *     notification bug found in TestFlight Build 31.
 *  2. Permission is requested (alert/badge/sound) when the status is "prompt".
 *  3. Nothing is scheduled unless permission is granted (`scheduled: 0`).
 *  4. Pending notifications are cancelled before the desired set is
 *     scheduled (the reconcile contract that makes edits/deletes cancel
 *     old notifications).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DesiredNotification } from "../lib/reminder-scheduling";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  },
}));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    getPending: vi.fn(async () => ({ notifications: [] })),
    cancel: vi.fn(async () => undefined),
    schedule: vi.fn(async () => undefined),
  },
}));

import { LocalNotifications } from "@capacitor/local-notifications";
import { reconcileNotifications } from "../lib/native-notifications";
import { computeAppointmentNotifications } from "../lib/reminder-scheduling";
import { APPOINTMENT_REMINDERS, type Appointment } from "../lib/types";

type PermissionDisplay = "granted" | "denied" | "prompt";

function mockPermission(display: PermissionDisplay, requestResult?: PermissionDisplay): void {
  vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display });
  vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({
    display: requestResult ?? display,
  });
}

function notif(
  kind: "appointment" | "document" | "subscription",
  itemId: string,
  minutesFromNow: number,
): DesiredNotification {
  return {
    id: 4242,
    title: "Test reminder",
    body: "Test body",
    at: new Date(Date.now() + minutesFromNow * 60_000),
    data: { kind, itemId },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reconcileNotifications — sound + permission contract", () => {
  it("schedules every notification with the default iOS sound (all kinds)", async () => {
    mockPermission("granted");
    const desired = [
      notif("appointment", "apt-1", 60),
      notif("document", "doc-1", 120),
      notif("subscription", "sub-1", 240),
    ];

    const result = await reconcileNotifications(desired);

    expect(result.scheduled).toBe(3);
    expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(LocalNotifications.schedule).mock.calls[0][0] as {
      notifications: Array<{ sound?: string; id: number }>;
    };
    expect(payload.notifications).toHaveLength(3);
    for (const n of payload.notifications) {
      // A missing sound = SILENT delivery on iOS. Must always be set.
      expect(n.sound).toBe("default");
    }
  });

  it("requests permission (alert/badge/sound) when the status is prompt", async () => {
    mockPermission("prompt", "granted");

    const result = await reconcileNotifications([notif("appointment", "apt-1", 30)]);

    expect(LocalNotifications.requestPermissions).toHaveBeenCalledTimes(1);
    expect(result.permission).toBe("granted");
    expect(result.scheduled).toBe(1);
  });

  it("never schedules when permission is denied (scheduled: 0)", async () => {
    mockPermission("denied");

    const result = await reconcileNotifications([notif("appointment", "apt-1", 30)]);

    expect(result.scheduled).toBe(0);
    expect(result.permission).toBe("denied");
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });

  it("filters out past fire times — only future notifications are scheduled", async () => {
    mockPermission("granted");

    await reconcileNotifications([
      notif("appointment", "past-1", -10),
      notif("appointment", "future-1", 45),
    ]);

    const payload = vi.mocked(LocalNotifications.schedule).mock.calls[0][0] as {
      notifications: Array<{ id: number }>;
    };
    expect(payload.notifications).toHaveLength(1);
  });

  it("schedules the default sound for EVERY appointment reminder option", async () => {
    // "At event time", every minute/hour/day preset, and a custom value —
    // all must carry sound: "default" (a missing sound = silent delivery).
    const reminders = [...APPOINTMENT_REMINDERS, "3 days before"];
    const d = new Date(Date.now() + 10 * 86_400_000);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const desired = reminders.flatMap((reminder) =>
      computeAppointmentNotifications(
        {
          id: `apt-${reminder}`,
          title: "Dentist",
          date,
          time: "23:30",
          location: "",
          notes: "",
          reminder,
        } as Appointment,
        { appointments: true, documents: false, subscriptions: false, bills: false, budget: false },
      ),
    );

    // Every option (including "At event time") produced exactly one reminder.
    expect(desired).toHaveLength(reminders.length);

    mockPermission("granted");
    const result = await reconcileNotifications(desired);

    expect(result.scheduled).toBe(reminders.length);
    const payload = vi.mocked(LocalNotifications.schedule).mock.calls[0][0] as {
      notifications: Array<{ sound?: string }>;
    };
    expect(payload.notifications).toHaveLength(reminders.length);
    for (const n of payload.notifications) {
      expect(n.sound).toBe("default");
    }
  });

  it("cancels all pending notifications before scheduling the desired set", async () => {
    mockPermission("granted");
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({
      notifications: [
        { id: 111, title: "old", body: "", schedule: { at: new Date() }, extra: {} },
        { id: 222, title: "old2", body: "", schedule: { at: new Date() }, extra: {} },
      ] as never,
    });

    await reconcileNotifications([notif("document", "doc-1", 90)]);

    expect(LocalNotifications.cancel).toHaveBeenCalledTimes(1);
    const cancelArg = vi.mocked(LocalNotifications.cancel).mock.calls[0][0] as {
      notifications: Array<{ id: number }>;
    };
    expect(cancelArg.notifications.map((n) => n.id).sort()).toEqual([111, 222]);
  });
});
