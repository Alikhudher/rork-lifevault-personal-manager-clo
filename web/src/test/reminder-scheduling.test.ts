/**
 * Tests for the pure reminder-scheduling logic behind native
 * notifications: reminder-string parsing, appointment expiry/retention,
 * per-entity notification computation, and deterministic ids.
 */
import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_REMINDERS,
  appointmentReminderForCustom,
  normalizeAppointmentReminder,
  parseAppointmentReminderDays,
  parseAppointmentReminderMinutes,
  type Appointment,
  type Subscription,
  type VaultDocument,
} from "@/lib/types";
import {
  APPOINTMENT_RETENTION_MS,
  appointmentEventDate,
  appointmentStaleAt,
  computeAllNotifications,
  computeAppointmentNotifications,
  computeDocumentNotifications,
  computeSubscriptionNotifications,
  findStaleAppointments,
  isAppointmentExpired,
  notificationIdFor,
} from "@/lib/reminder-scheduling";

const PREFS = {
  documents: true,
  subscriptions: true,
  bills: true,
  appointments: true,
  budget: false,
};

/** 2026-06-15T10:30 local time. */
function at(y: number, m: number, d: number, hh = 0, mm = 0): Date {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function makeDoc(overrides: Partial<VaultDocument> = {}): VaultDocument {
  return {
    id: "doc_1",
    name: "Passport",
    category: "Passport",
    issueDate: null,
    expiryDate: "2026-07-01",
    notes: "",
    reminderDays: 7,
    fileName: null,
    fileKind: "image",
    fileData: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1",
    name: "Netflix",
    price: 15,
    frequency: "monthly",
    nextPaymentDate: "2026-07-01",
    category: "Entertainment",
    paymentMethod: "Debit Card",
    reminderDays: 3,
    status: "active",
    ...overrides,
  };
}

function makeApt(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "apt_1",
    title: "Dentist",
    date: "2026-06-20",
    time: "09:00",
    location: "City Dental",
    notes: "",
    reminder: "1 hour before",
    ...overrides,
  };
}

describe("parseAppointmentReminderMinutes", () => {
  it("parses every preset including at-event-time", () => {
    expect(parseAppointmentReminderMinutes("At event time")).toBe(0);
    expect(parseAppointmentReminderMinutes("5 minutes before")).toBe(5);
    expect(parseAppointmentReminderMinutes("45 minutes before")).toBe(45);
    expect(parseAppointmentReminderMinutes("1 hour before")).toBe(60);
    expect(parseAppointmentReminderMinutes("12 hours before")).toBe(720);
    expect(parseAppointmentReminderMinutes("1 day before")).toBe(1440);
    expect(parseAppointmentReminderMinutes("90 days before")).toBe(129600);
  });

  it("parses legacy strings and rejects unknown values", () => {
    expect(parseAppointmentReminderMinutes("1 week before")).toBe(10080);
    expect(parseAppointmentReminderMinutes("2 minutes before")).toBe(2);
    expect(parseAppointmentReminderMinutes("custom gibberish")).toBeNull();
    expect(parseAppointmentReminderMinutes("")).toBeNull();
  });

  it("every shipped preset is parseable", () => {
    for (const preset of APPOINTMENT_REMINDERS) {
      expect(parseAppointmentReminderMinutes(preset)).not.toBeNull();
    }
  });
});

describe("appointmentReminderForCustom", () => {
  it("builds canonical custom strings for any unit", () => {
    expect(appointmentReminderForCustom(20, "minutes")).toBe("20 minutes before");
    expect(appointmentReminderForCustom(90, "minutes")).toBe("90 minutes before");
    expect(appointmentReminderForCustom(1, "hours")).toBe("1 hour before");
    expect(appointmentReminderForCustom(5, "days")).toBe("5 days before");
  });

  it("round-trips through the parser", () => {
    for (const unit of ["minutes", "hours", "days"] as const) {
      const s = appointmentReminderForCustom(7, unit);
      expect(parseAppointmentReminderMinutes(s)).toBeGreaterThan(0);
    }
  });
});

describe("normalizeAppointmentReminder", () => {
  it("maps legacy values so old appointments keep working", () => {
    expect(normalizeAppointmentReminder("At time of event")).toBe("At event time");
    expect(normalizeAppointmentReminder("1 week before")).toBe("7 days before");
    expect(normalizeAppointmentReminder("3 days before")).toBe("3 days before");
    expect(normalizeAppointmentReminder("15 minutes before")).toBe("15 minutes before");
  });
});

describe("appointment expiry & retention", () => {
  it("uses the exact date AND time for expiry", () => {
    const apt = makeApt();
    expect(isAppointmentExpired(apt, at(2026, 6, 20, 8, 59))).toBe(false);
    expect(isAppointmentExpired(apt, at(2026, 6, 20, 9, 0))).toBe(false);
    expect(isAppointmentExpired(apt, at(2026, 6, 20, 9, 1))).toBe(true);
  });

  it("keeps expired appointments for 48h then flags them stale", () => {
    const apt = makeApt();
    const event = appointmentEventDate(apt).getTime();
    expect(appointmentStaleAt(apt)).toBe(event + APPOINTMENT_RETENTION_MS);
    expect(findStaleAppointments([apt], new Date(event + APPOINTMENT_RETENTION_MS - 1))).toHaveLength(0);
    expect(findStaleAppointments([apt], new Date(event + APPOINTMENT_RETENTION_MS + 1))).toHaveLength(1);
  });
});

describe("computeAppointmentNotifications", () => {
  it("schedules at the exact lead time before the exact event time", () => {
    const now = at(2026, 6, 19, 12, 0);
    const notifs = computeAppointmentNotifications(makeApt(), PREFS, now);
    expect(notifs).toHaveLength(1);
    const fireAt = notifs[0].at.getTime();
    expect(fireAt).toBe(appointmentEventDate(makeApt()).getTime() - 60 * 60_000);
  });

  it("supports minute-level custom leads", () => {
    const now = at(2026, 6, 20, 8, 0);
    const notifs = computeAppointmentNotifications(makeApt({ reminder: "30 minutes before" }), PREFS, now);
    expect(notifs[0].at.getTime()).toBe(appointmentEventDate(makeApt()).getTime() - 30 * 60_000);
  });

  it("never schedules a fire time in the past", () => {
    const now = at(2026, 6, 20, 9, 30); // event already passed
    expect(computeAppointmentNotifications(makeApt(), PREFS, now)).toHaveLength(0);
  });

  it("at-event-time fires exactly at the event", () => {
    const now = at(2026, 6, 20, 8, 0);
    const notifs = computeAppointmentNotifications(makeApt({ reminder: "At event time" }), PREFS, now);
    expect(notifs[0].at.getTime()).toBe(appointmentEventDate(makeApt()).getTime());
  });

  it("respects the appointments preference", () => {
    const now = at(2026, 6, 19, 12, 0);
    expect(
      computeAppointmentNotifications(makeApt(), { ...PREFS, appointments: false }, now),
    ).toHaveLength(0);
  });
});

describe("computeDocumentNotifications", () => {
  it("fires 09:00 local, reminderDays before expiry", () => {
    const now = at(2026, 6, 1);
    const notifs = computeDocumentNotifications(makeDoc({ expiryDate: "2026-07-01", reminderDays: 7 }), PREFS, now);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].at.getTime()).toBe(at(2026, 6, 24, 9, 0).getTime());
  });

  it("skips docs without expiry and past fire times", () => {
    const now = at(2026, 6, 1);
    expect(computeDocumentNotifications(makeDoc({ expiryDate: null }), PREFS, now)).toHaveLength(0);
    expect(
      computeDocumentNotifications(makeDoc({ expiryDate: "2026-06-02", reminderDays: 7 }), PREFS, now),
    ).toHaveLength(0);
  });
});

describe("computeSubscriptionNotifications", () => {
  it("fires 09:00 local, reminderDays before the renewal", () => {
    const now = at(2026, 6, 1);
    const notifs = computeSubscriptionNotifications(makeSub(), PREFS, now);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].at.getTime()).toBe(at(2026, 6, 28, 9, 0).getTime());
  });

  it("bill-categorised subscriptions honour the bills preference", () => {
    const now = at(2026, 6, 1);
    const bill = makeSub({ category: "Bills" });
    expect(computeSubscriptionNotifications(bill, { ...PREFS, subscriptions: false, bills: true }, now)).toHaveLength(1);
    expect(computeSubscriptionNotifications(bill, { ...PREFS, subscriptions: false, bills: false }, now)).toHaveLength(0);
  });
});

describe("notificationIdFor & computeAllNotifications", () => {
  it("ids are deterministic and idempotent", () => {
    const a = notificationIdFor("appointment", "apt_1", 1_000_000);
    const b = notificationIdFor("appointment", "apt_1", 1_000_000);
    const c = notificationIdFor("appointment", "apt_1", 2_000_000);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(2 ** 31);
  });

  it("collects future notifications from every entity type and de-dupes by id", () => {
    const now = at(2026, 6, 1);
    const all = computeAllNotifications(
      {
        documents: [makeDoc()],
        subscriptions: [makeSub()],
        appointments: [makeApt()],
        prefs: PREFS,
      },
      now,
    );
    expect(all).toHaveLength(3);
    const ids = new Set(all.map((n) => n.id));
    expect(ids.size).toBe(3);
    // Sorted soonest-first.
    expect(all[0].at <= all[1].at).toBe(true);
  });

  it("recomputing the same state yields the identical set (no duplicates)", () => {
    const now = at(2026, 6, 1);
    const input = {
      documents: [makeDoc()],
      subscriptions: [makeSub()],
      appointments: [makeApt()],
      prefs: PREFS,
    };
    const first = computeAllNotifications(input, now);
    const second = computeAllNotifications(input, now);
    expect(first.map((n) => n.id)).toEqual(second.map((n) => n.id));
  });

  it("edited appointments produce a different id (old one gets cancelled by reconcile)", () => {
    const now = at(2026, 6, 1);
    const before = computeAllNotifications(
      { documents: [], subscriptions: [], appointments: [makeApt()], prefs: PREFS },
      now,
    );
    const after = computeAllNotifications(
      { documents: [], subscriptions: [], appointments: [makeApt({ time: "14:00" })], prefs: PREFS },
      now,
    );
    expect(before[0].id).not.toBe(after[0].id);
  });

  it("a past reminder time is never allowed even when the event is upcoming", () => {
    // Event tomorrow 09:00 with "2 days before" → fire time is yesterday (past).
    const now = at(2026, 6, 20, 12, 0);
    const notifs = computeAppointmentNotifications(
      makeApt({ date: "2026-06-21", reminder: "2 days before" }),
      PREFS,
      now,
    );
    expect(notifs).toHaveLength(0);
  });
});
