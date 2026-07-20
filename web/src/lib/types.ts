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
  /** 24h time (HH:mm) */
  time: string;
  location: string;
  notes: string;
  /** e.g. "1 hour before" */
  reminder: string;
}

export const APPOINTMENT_REMINDERS: string[] = [
  "At time of event",
  "1 hour before",
  "3 hours before",
  "1 day before",
  "2 days before",
  "3 days before",
  "7 days before",
  "14 days before",
  "30 days before",
  "60 days before",
  "90 days before",
];

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
 * Maps legacy stored values (e.g. "1 week before") to their canonical form
 * so old appointments select the right picker option. Unknown values pass
 * through untouched so no stored data is ever lost.
 */
export function normalizeAppointmentReminder(reminder: string): string {
  const days = parseAppointmentReminderDays(reminder);
  if (days !== null) return appointmentReminderForDays(days);
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
 * Stored only for the local mock auth flow — never do this in production.
 */
export interface RegisteredAccount {
  email: string;
  name: string;
  /** Optional profile photo as a data URL or remote URL. */
  photo: string | null;
  /** Stored only for the local mock auth flow — never do this in production. */
  password: string;
  /** ISO datetime the account was created. */
  createdAt: string;
  /** Whether the email has been verified (mock). */
  emailVerified: boolean;
}

export interface UserProfile {
  name: string;
  email: string;
  /** Optional profile photo as a data URL or remote URL. */
  photo: string | null;
  /** ISO datetime the account was created. */
  createdAt: string;
  /** Stored only for the local mock auth flow — never do this in production. */
  password: string | null;
  /** Whether the email has been verified (mock). */
  emailVerified: boolean;
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
