import {
  differenceInCalendarDays,
  format,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
  startOfDay,
} from "date-fns";
import type { BillingFrequency, DocumentStatus, VaultDocument } from "./types";

/** Formats an amount using the user's chosen currency (AUD by default). */
export function formatCurrency(amount: number, currency: string = "AUD", compact: boolean = false): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    minimumFractionDigits: compact && Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(iso: string): string {
  return format(parseISO(iso), "d MMM yyyy");
}

export function formatDateShort(iso: string): string {
  return format(parseISO(iso), "d MMM");
}

export function formatTime12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return format(d, "h:mm a");
}

/** Friendly relative label: Today, Tomorrow, Yesterday, or "12 Mar". */
export function relativeDayLabel(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, d MMM");
}

export function daysUntil(iso: string): number {
  return differenceInCalendarDays(parseISO(iso), startOfDay(new Date()));
}

/** "in 5 days" / "today" / "3 days ago" */
export function daysUntilLabel(iso: string): string {
  const days = daysUntil(iso);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export function documentStatus(doc: Pick<VaultDocument, "expiryDate" | "reminderDays">): DocumentStatus {
  if (!doc.expiryDate) return "active";
  const days = daysUntil(doc.expiryDate);
  if (days < 0) return "expired";
  if (days <= Math.max(doc.reminderDays, 30)) return "expiring";
  return "active";
}

/** Converts a subscription price to its monthly equivalent. */
export function monthlyEquivalent(price: number, frequency: BillingFrequency): number {
  switch (frequency) {
    case "weekly":
      return (price * 52) / 12;
    case "monthly":
      return price;
    case "quarterly":
      return price / 3;
    case "yearly":
      return price / 12;
  }
}

export function frequencyLabel(frequency: BillingFrequency): string {
  switch (frequency) {
    case "weekly":
      return "week";
    case "monthly":
      return "month";
    case "quarterly":
      return "quarter";
    case "yearly":
      return "year";
  }
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

let idCounter = 0;

export function uid(prefix: string = "id"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}
