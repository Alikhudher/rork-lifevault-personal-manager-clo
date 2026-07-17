import {
  Banknote,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Clapperboard,
  CreditCard,
  FileText,
  Fuel,
  HandCoins,
  HeartPulse,
  Home,
  IdCard,
  Landmark,
  Plane,
  Receipt,
  RefreshCcw,
  ShieldCheck,
  ShoppingBag,
  UtensilsCrossed,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { DocumentCategory, ExpenseCategory, PaymentMethod } from "@/lib/types";

interface CategoryMeta {
  icon: LucideIcon;
  /** Tailwind classes for the icon bubble */
  bubble: string;
}

export const EXPENSE_META: Record<ExpenseCategory, CategoryMeta> = {
  Food: { icon: UtensilsCrossed, bubble: "bg-orange-500/12 text-orange-600 dark:text-orange-400" },
  Fuel: { icon: Fuel, bubble: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  Rent: { icon: Landmark, bubble: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400" },
  Bills: { icon: Receipt, bubble: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  Shopping: { icon: ShoppingBag, bubble: "bg-pink-500/12 text-pink-600 dark:text-pink-400" },
  Transport: { icon: Bus, bubble: "bg-teal-500/12 text-teal-600 dark:text-teal-400" },
  Health: { icon: HeartPulse, bubble: "bg-rose-500/12 text-rose-600 dark:text-rose-400" },
  Entertainment: { icon: Clapperboard, bubble: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
  Subscriptions: { icon: RefreshCcw, bubble: "bg-blue-500/12 text-blue-600 dark:text-blue-400" },
  Other: { icon: Wallet, bubble: "bg-slate-500/12 text-slate-600 dark:text-slate-400" },
};

export const DOCUMENT_META: Record<DocumentCategory, CategoryMeta> = {
  ID: { icon: IdCard, bubble: "bg-blue-500/12 text-blue-600 dark:text-blue-400" },
  Passport: { icon: Plane, bubble: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400" },
  "Driver Licence": { icon: Car, bubble: "bg-teal-500/12 text-teal-600 dark:text-teal-400" },
  Insurance: { icon: ShieldCheck, bubble: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  Employment: { icon: Briefcase, bubble: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  Education: { icon: BookOpen, bubble: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
  Warranty: { icon: Wrench, bubble: "bg-orange-500/12 text-orange-600 dark:text-orange-400" },
  Vehicle: { icon: Car, bubble: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-400" },
  Home: { icon: Home, bubble: "bg-rose-500/12 text-rose-600 dark:text-rose-400" },
  Other: { icon: FileText, bubble: "bg-slate-500/12 text-slate-600 dark:text-slate-400" },
};

export const PAYMENT_META: Record<PaymentMethod, LucideIcon> = {
  Cash: Banknote,
  "Debit Card": Wallet,
  "Credit Card": CreditCard,
  "Bank Transfer": HandCoins,
};

export function CategoryBubble({
  meta,
  size = "md",
}: {
  meta: CategoryMeta;
  size?: "sm" | "md" | "lg";
}) {
  const Icon = meta.icon;
  const box = size === "sm" ? "h-9 w-9 rounded-xl" : size === "lg" ? "h-12 w-12 rounded-2xl" : "h-11 w-11 rounded-2xl";
  const icon = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <span className={`flex shrink-0 items-center justify-center ${box} ${meta.bubble}`}>
      <Icon className={icon} strokeWidth={2.2} />
    </span>
  );
}
