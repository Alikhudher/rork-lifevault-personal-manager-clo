/**
 * Universal document taxonomy. Covers every category the AI engine can
 * classify an uploaded document into — from government IDs to handwritten
 * sticky notes. Order matters: most-common-first for picker display.
 */
export type DocumentCategory =
  | "ID"
  | "Passport"
  | "Driver Licence"
  | "Vehicle"
  | "Medical"
  | "Insurance"
  | "Tax"
  | "Legal"
  | "Immigration"
  | "Banking"
  | "Bill"
  | "Receipt"
  | "Invoice"
  | "Payslip"
  | "Employment"
  | "Education"
  | "Certificate"
  | "Warranty"
  | "Manual"
  | "Travel"
  | "Event"
  | "Business Card"
  | "Note"
  | "Form"
  | "Screenshot"
  | "Home"
  | "Other";

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  "ID",
  "Passport",
  "Driver Licence",
  "Vehicle",
  "Medical",
  "Insurance",
  "Tax",
  "Legal",
  "Immigration",
  "Banking",
  "Bill",
  "Receipt",
  "Invoice",
  "Payslip",
  "Employment",
  "Education",
  "Certificate",
  "Warranty",
  "Manual",
  "Travel",
  "Event",
  "Business Card",
  "Note",
  "Form",
  "Screenshot",
  "Home",
  "Other",
];

export type ExpenseCategory =
  | "Food"
  | "Fuel"
  | "Rent"
  | "Bills"
  | "Shopping"
  | "Transport"
  | "Health"
  | "Entertainment"
  | "Subscriptions"
  | "Other";

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Food",
  "Fuel",
  "Rent",
  "Bills",
  "Shopping",
  "Transport",
  "Health",
  "Entertainment",
  "Subscriptions",
  "Other",
];

export type PaymentMethod = "Cash" | "Debit Card" | "Credit Card" | "Bank Transfer";

export const PAYMENT_METHODS: PaymentMethod[] = ["Cash", "Debit Card", "Credit Card", "Bank Transfer"];

export type BillingFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

export const BILLING_FREQUENCIES: BillingFrequency[] = ["weekly", "monthly", "quarterly", "yearly"];

/**
 * Days before an expiry/renewal/event to remind the user. Preset choices
 * live in REMINDER_OPTIONS; any whole number between MIN_REMINDER_DAYS and
 * MAX_REMINDER_DAYS is valid via the "Custom" picker option.
 */
export type ReminderDays = number;

export const REMINDER_OPTIONS: ReminderDays[] = [1, 2, 3, 7, 14, 30, 60, 90];

export const MIN_REMINDER_DAYS = 1;
export const MAX_REMINDER_DAYS = 365;

/** Clamps arbitrary input to a valid whole number of reminder days. */
export function clampReminderDays(days: number, fallback: ReminderDays = 30): ReminderDays {
  if (!Number.isFinite(days)) return fallback;
  return Math.min(MAX_REMINDER_DAYS, Math.max(MIN_REMINDER_DAYS, Math.round(days)));
}

export type DocumentStatus = "active" | "expiring" | "expired";

export type FileKind = "pdf" | "image" | "doc";

export interface VaultDocument {
  id: string;
  name: string;
  category: DocumentCategory;
  issueDate: string | null;
  expiryDate: string | null;
  notes: string;
  reminderDays: ReminderDays;
  fileName: string | null;
  fileKind: FileKind;
  /** File content as a data URL (base64). Populated when the user uploads
   *  a file through the Add/Edit form so the View screen can display it.
   *  Older documents created before this field may have null here. */
  fileData?: string | null;
  createdAt: string;
}

export interface Expense {
  id: string;
  amount: number;
  /** ISO datetime */
  date: string;
  category: ExpenseCategory;
  merchant: string;
  notes: string;
  paymentMethod: PaymentMethod;
}

export type SubscriptionStatus = "active" | "cancelled";

export interface Subscription {
  id: string;
  name: string;
  price: number;
  frequency: BillingFrequency;
  nextPaymentDate: string;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  reminderDays: ReminderDays;
  status: SubscriptionStatus;
}

export interface Appointment {
  id: string;
  title: string;
  /** ISO date (yyyy-MM-dd) */
  date: string;
  /** 24h time (HH:mm) — exact hour & minute of the event */
  time: string;
  location: string;
  notes: string;
  /** Canonical reminder string, e.g. "At event time", "15 minutes before",
   *  "1 hour before", "2 days before", or a custom "N minutes/hours/days before". */
  reminder: string;
}

/**
 * Preset appointment reminders shown as chips. Any further interval is
 * expressible through the Custom option (any number of Minutes, Hours or
 * Days). Stored strings are parsed by `parseAppointmentReminderMinutes`.
 */
export const APPOINTMENT_REMINDERS: string[] = [
  "At event time",
  "5 minutes before",
  "10 minutes before",
  "15 minutes before",
  "30 minutes before",
  "45 minutes before",
  "1 hour before",
  "2 hours before",
  "3 hours before",
  "6 hours before",
  "12 hours before",
  "1 day before",
];

/** Unit for a custom appointment reminder interval. */
export type ReminderUnit = "minutes" | "hours" | "days";

export const REMINDER_UNITS: ReminderUnit[] = ["minutes", "hours", "days"];

/** Bounds for a custom appointment reminder value (per unit). */
export const REMINDER_UNIT_LIMITS: Record<ReminderUnit, { min: number; max: number }> = {
  minutes: { min: 1, max: 60 * 24 * 30 }, // up to 30 days worth of minutes
  hours: { min: 1, max: 24 * 60 }, // up to 60 days
  days: { min: 1, max: 365 },
};

/** Canonical "N unit before" reminder string for a custom interval. */
export function appointmentReminderForCustom(value: number, unit: ReminderUnit): string {
  const { min, max } = REMINDER_UNIT_LIMITS[unit];
  const n = Math.min(max, Math.max(min, Math.round(value)));
  const label = unit === "minutes" ? (n === 1 ? "minute" : "minutes")
    : unit === "hours" ? (n === 1 ? "hour" : "hours")
    : (n === 1 ? "day" : "days");
  return `${n} ${label} before`;
}

/** Canonical "N day(s) before" reminder string for a custom day count. */
export function appointmentReminderForDays(days: number): string {
  const d = clampReminderDays(days, 1);
  return d === 1 ? "1 day before" : `${d} days before`;
}

/**
 * Parses a day-based appointment reminder ("3 days before", legacy
 * "1 week before") into a day count. Time-of-day options return null.
 */
export function parseAppointmentReminderDays(reminder: string): number | null {
  const norm = reminder.trim().toLowerCase();
  if (norm === "1 week before") return 7;
  const match = norm.match(/^(\d+)\s+days?\s+before$/);
  if (!match) return null;
  const days = Number.parseInt(match[1], 10);
  return Number.isFinite(days) && days >= MIN_REMINDER_DAYS
    ? Math.min(days, MAX_REMINDER_DAYS)
    : null;
}

/**
 * Parses any canonical appointment reminder string into a lead time in
 * minutes before the event. Returns null for unrecognised values.
 *
 *   "At event time"        → 0
 *   "15 minutes before"    → 15
 *   "1 hour before"        → 60
 *   "12 hours before"      → 720
 *   "2 days before"        → 2880
 *   "1 week before" (legacy) → 10080
 */
export function parseAppointmentReminderMinutes(reminder: string): number | null {
  const norm = reminder.trim().toLowerCase();
  if (norm === "at event time" || norm === "at time of event" || norm === "at the time of event") return 0;
  const match = norm.match(/^(\d+)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)\s+before$/);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = match[2].startsWith("m")
    ? 1
    : match[2].startsWith("h")
      ? 60
      : match[2].startsWith("d")
        ? 1440
        : 10080; // weeks (legacy)
  return n * unit;
}

/**
 * Maps legacy stored values (e.g. "1 week before", "At time of event",
 * "3 days before") to their canonical form so old appointments select the
 * right picker option. Unknown values pass through untouched so no stored
 * data is ever lost.
 */
export function normalizeAppointmentReminder(reminder: string): string {
  const norm = reminder.trim().toLowerCase();
  if (norm === "at time of event" || norm === "at the time of event") return "At event time";
  const days = parseAppointmentReminderDays(reminder);
  if (days !== null) {
    // Time-of-day presets (5 min … 12 h) win over a day-based chip when the
    // stored value maps onto one (e.g. "1 day before" stays a day chip).
    return appointmentReminderForDays(days);
  }
  return reminder.trim() || "1 day before";
}

export type NotificationType = "document" | "subscription" | "bill" | "appointment" | "budget";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** ISO datetime */
  date: string;
  read: boolean;
}

/** Represents one signed-in device session. */
export interface DeviceSession {
  id: string;
  device: string;
  location: string;
  /** Short browser/platform label, e.g. "iOS Safari" */
  app: string;
  /** ISO datetime of last activity */
  lastActive: string;
  /** Whether this is the current device. */
  current?: boolean;
}

/**
 * A registered account record stored in the account registry.
 * Survives logout so credentials can always be validated.
 *
 * Passwords are stored ONLY as a salted PBKDF2-SHA256 hash (see
 * lib/password.ts) — never in plaintext. The legacy `password` field
 * from older builds is migrated to a hash on load and then removed.
 */
export interface RegisteredAccount {
  email: string;
  name: string;
  /** Optional profile photo as a data URL or remote URL. */
  photo: string | null;
  /** Base64 PBKDF2-SHA256 hash of the account password. */
  passwordHash?: string;
  /** Base64 per-account random salt for the password hash. */
  passwordSalt?: string;
  /** ms timestamp of the last password change — drives cross-device sign-out. */
  passwordChangedAt?: number;
  /** Legacy plaintext password from pre-hashing builds. Migrated + removed on load. */
  password?: string;
  /** ISO datetime the account was created. */
  createdAt: string;
  /** Whether the email has been verified. */
  emailVerified: boolean;
}

export interface UserProfile {
  name: string;
  email: string;
  /** Optional profile photo as a data URL or remote URL. */
  photo: string | null;
  /** ISO datetime the account was created. */
  createdAt: string;
  /** Whether the email has been verified. */
  emailVerified: boolean;
}

/**
 * Credentials snapshot synced through the end-to-end encrypted cloud
 * backup (record id "__account__"). Contains only the salted hash —
 * never a password. Other devices apply it and force a re-login when
 * the password changed elsewhere.
 */
export interface SyncedAccountCredentials {
  email: string;
  passwordHash: string;
  passwordSalt: string;
  passwordChangedAt: number;
}

export interface NotificationPrefs {
  documents: boolean;
  subscriptions: boolean;
  bills: boolean;
  appointments: boolean;
  budget: boolean;
}

export interface Settings {
  currency: string;
  darkMode: boolean;
  /** Legacy biometric toggle (kept for backwards compat). Real config lives in SecuritySettings. */
  biometric: boolean;
  monthlyBudget: number;
  /** App display language code (validated against the i18n registry). */
  language: string;
  notifications: NotificationPrefs;
}

export const CURRENCIES: { code: string; label: string }[] = [
  { code: "AUD", label: "Australian Dollar (A$)" },
  { code: "USD", label: "US Dollar ($)" },
  { code: "EUR", label: "Euro (€)" },
  { code: "GBP", label: "British Pound (£)" },
  { code: "NZD", label: "New Zealand Dollar (NZ$)" },
  { code: "CAD", label: "Canadian Dollar (C$)" },
];

/* ------------------------------------------------------------------ */
/* Security settings                                                   */
/* ------------------------------------------------------------------ */

/** PIN length: 4 or 6 digits. */
export type PinLength = 4 | 6;

/**
 * Delay before the app re-locks after being backgrounded.
 * `0` = lock immediately, `null` = never auto-lock.
 */
export type AutoLockDelay = 0 | 60 | 300 | 900 | null;

export interface SecuritySettings {
  /** Whether Face ID / Touch ID unlock is enabled. */
  biometricEnabled: boolean;
  /** Whether a numeric PIN is configured. */
  pinEnabled: boolean;
  /** PIN length (4 or 6). Only meaningful when `pinEnabled`. */
  pinLength: PinLength;
  /** Auto-lock delay in seconds, or `null` for never. */
  autoLockDelay: AutoLockDelay;
  /** Hide app content in the iOS App Switcher (privacy screen). */
  hideInAppSwitcher: boolean;
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  biometricEnabled: false,
  pinEnabled: false,
  pinLength: 4,
  autoLockDelay: 0,
  hideInAppSwitcher: false,
};

export const AUTO_LOCK_OPTIONS: { value: AutoLockDelay; label: string }[] = [
  { value: 0, label: "Immediately" },
  { value: 60, label: "After 1 minute" },
  { value: 300, label: "After 5 minutes" },
  { value: 900, label: "After 15 minutes" },
  { value: null, label: "Never" },
];

export const PIN_LENGTH_OPTIONS: PinLength[] = [4, 6];
