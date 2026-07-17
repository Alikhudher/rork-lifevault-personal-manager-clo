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
