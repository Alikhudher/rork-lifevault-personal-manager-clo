export type DocumentCategory =
  | "ID"
  | "Passport"
  | "Driver Licence"
  | "Insurance"
  | "Employment"
  | "Education"
  | "Warranty"
  | "Vehicle"
  | "Home"
  | "Other";

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  "ID",
  "Passport",
  "Driver Licence",
  "Insurance",
  "Employment",
  "Education",
  "Warranty",
  "Vehicle",
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

export type ReminderDays = 7 | 14 | 30 | 60 | 90;

export const REMINDER_OPTIONS: ReminderDays[] = [7, 14, 30, 60, 90];

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
  "1 week before",
];

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
