/**
 * Pure reminder-scheduling logic shared by the native notification engine
 * and the UI. No Capacitor imports here — everything is testable plain
 * TypeScript that works on the exact device-local dates and times the
 * user selected.
 */
import type { Appointment, ReminderUnit, Subscription, VaultDocument } from "./types";
import {
  REMINDER_UNIT_LIMITS,
  parseAppointmentReminderMinutes,
} from "./types";

export type NotificationKind = "appointment" | "document" | "subscription";

/** One future native notification the app should have scheduled. */
export interface DesiredNotification {
  /** Deterministic numeric id (required by the native scheduler). */
  id: number;
  title: string;
  body: string;
  /** Exact fire time in the device timezone. */
  at: Date;
  data: {
    kind: NotificationKind;
    itemId: string;
  };
}

export interface NotificationPrefsLike {
  documents: boolean;
  subscriptions: boolean;
  bills: boolean;
  appointments: boolean;
  budget: boolean;
}

/** The event date+time of an appointment as a Date in device-local time. */
export function appointmentEventDate(apt: Pick<Appointment, "date" | "time">): Date {
  const [h, m] = apt.time.split(":").map(Number);
  const d = new Date(`${apt.date}T00:00:00`);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

/** True once the appointment's exact date+time has passed. */
export function isAppointmentExpired(apt: Pick<Appointment, "date" | "time">, now: Date = new Date()): boolean {
  return appointmentEventDate(apt).getTime() < now.getTime();
}

/**
 * Expired appointments are kept for 48 hours, then automatically deleted.
 * This cleanup applies ONLY to appointments — documents, expenses,
 * purchases, subscriptions, payments and bills are never auto-deleted.
 */
export const APPOINTMENT_RETENTION_MS = 48 * 60 * 60 * 1000;

/** When a past appointment should be auto-deleted (event time + 48h). */
export function appointmentStaleAt(apt: Pick<Appointment, "date" | "time">): number {
  return appointmentEventDate(apt).getTime() + APPOINTMENT_RETENTION_MS;
}

/** Appointments whose 48-hour retention window has fully elapsed. */
export function findStaleAppointments(
  appointments: Appointment[],
  now: Date = new Date(),
): Appointment[] {
  return appointments.filter((a) => appointmentStaleAt(a) < now.getTime());
}

/**
 * Deterministic 31-bit numeric notification id for an item + fire time.
 * iOS requires numeric ids; deriving them from stable inputs keeps ids
 * idempotent (re-scheduling the same reminder never duplicates).
 */
export function notificationIdFor(kind: NotificationKind, itemId: string, atMs: number): number {
  const str = `${kind}:${itemId}:${Math.floor(atMs / 60000)}`;
  // FNV-1a 32-bit, then fold into a positive 31-bit int.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

/** The default time-of-day a date-only reminder fires at (09:00 local). */
const DATE_ONLY_HOUR = 9;

function dateOnlyFireAt(isoDate: string, daysBefore: number): Date {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() - Math.max(0, Math.round(daysBefore)));
  d.setHours(DATE_ONLY_HOUR, 0, 0, 0);
  return d;
}

/** Documents: one native reminder `reminderDays` before the expiry date. */
export function computeDocumentNotifications(
  doc: VaultDocument,
  prefs: NotificationPrefsLike,
  now: Date = new Date(),
): DesiredNotification[] {
  if (!prefs.documents || !doc.expiryDate) return [];
  const at = dateOnlyFireAt(doc.expiryDate, doc.reminderDays);
  if (at.getTime() <= now.getTime()) return [];
  return [
    {
      id: notificationIdFor("document", doc.id, at.getTime()),
      title: "Document expiring",
      body: `${doc.name} expires ${doc.expiryDate}.`,
      at,
      data: { kind: "document", itemId: doc.id },
    },
  ];
}

/**
 * Subscriptions & bills: one native reminder `reminderDays` before the
 * next payment/renewal date. Subscription reminders use the
 * "subscriptions" preference; subscriptions categorised as Bills also
 * honour the "bills" preference (either one enables the notification).
 */
export function computeSubscriptionNotifications(
  sub: Subscription,
  prefs: NotificationPrefsLike,
  now: Date = new Date(),
): DesiredNotification[] {
  const isBill = sub.category === "Bills";
  const enabled = isBill
    ? prefs.subscriptions || prefs.bills
    : prefs.subscriptions;
  if (!enabled) return [];
  const at = dateOnlyFireAt(sub.nextPaymentDate, sub.reminderDays);
  if (at.getTime() <= now.getTime()) return [];
  return [
    {
      id: notificationIdFor("subscription", sub.id, at.getTime()),
      title: isBill ? "Bill due soon" : "Subscription renewal",
      body: `${sub.name} renews ${sub.nextPaymentDate}.`,
      at,
      data: { kind: "subscription", itemId: sub.id },
    },
  ];
}

/**
 * Appointments: one native notification at the exact reminder lead time
 * before the appointment's exact date+time (device timezone). Past fire
 * times are never scheduled.
 */
export function computeAppointmentNotifications(
  apt: Appointment,
  prefs: NotificationPrefsLike,
  now: Date = new Date(),
): DesiredNotification[] {
  if (!prefs.appointments) return [];
  const minutes = parseAppointmentReminderMinutes(apt.reminder);
  if (minutes === null) return [];
  const at = new Date(appointmentEventDate(apt).getTime() - minutes * 60_000);
  if (at.getTime() <= now.getTime()) return [];
  return [
    {
      id: notificationIdFor("appointment", apt.id, at.getTime()),
      title: minutes === 0 ? "Upcoming appointment" : "Appointment reminder",
      body:
        minutes === 0
          ? `${apt.title} is starting now${apt.location ? ` — ${apt.location}` : ""}.`
          : `${apt.title} in ${formatLead(minutes)}${apt.location ? ` — ${apt.location}` : ""}.`,
      at,
      data: { kind: "appointment", itemId: apt.id },
    },
  ];
}

/** Human lead-time fragment, e.g. "5 minutes", "2 hours", "1 day". */
export function formatLead(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes < 1440) {
    const h = minutes / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? "" : "s"}`;
  }
  const d = minutes / 1440;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} day${d === 1 ? "" : "s"}`;
}

/** All desired notifications for the current vault state, future only. */
export function computeAllNotifications(
  input: {
    documents: VaultDocument[];
    subscriptions: Subscription[];
    appointments: Appointment[];
    prefs: NotificationPrefsLike;
  },
  now: Date = new Date(),
): DesiredNotification[] {
  const all = [
    ...input.documents.flatMap((d) => computeDocumentNotifications(d, input.prefs, now)),
    ...input.subscriptions.flatMap((s) => computeSubscriptionNotifications(s, input.prefs, now)),
    ...input.appointments.flatMap((a) => computeAppointmentNotifications(a, input.prefs, now)),
  ];
  // Defensive de-dup by id — same id must never be scheduled twice.
  const byId = new Map<number, DesiredNotification>();
  for (const n of all) if (!byId.has(n.id)) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Clamp helper re-exported for UI custom inputs. */
export function clampReminderValue(value: number, unit: ReminderUnit): number {
  const { min, max } = REMINDER_UNIT_LIMITS[unit];
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
