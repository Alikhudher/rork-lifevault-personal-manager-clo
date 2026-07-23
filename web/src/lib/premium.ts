/**
 * Premium subscription infrastructure — connected to real Apple/Google IAP.
 *
 * Design philosophy: the free version is genuinely useful so users
 * love the app and choose to upgrade naturally — no forced paywalls.
 *
 * Free tier includes: document storage, basic reminders, expense
 * tracking, calendar, limited AI scans, and basic cloud backup.
 *
 * Premium adds: unlimited AI scans, unlimited cloud backup, AI
 * Assistant, document export (ZIP/PDF), advanced reminders &
 * automation, family sharing, and priority support.
 *
 * Premium is unlocked ONLY when Apple/Google confirms a successful
 * purchase and RevenueCat's server-side receipt validation returns
 * an active entitlement. On web (no IAP), all features remain free.
 *
 * The actual purchase/restore/status-check logic lives in
 * `@/lib/iap.ts` which wraps the RevenueCat Capacitor plugin.
 * This file defines the types, plan metadata, feature flags, and
 * free-tier limits that the IAP layer and UI share.
 */

/** Identifiers for features that may be gated behind Premium in the future. */
export type PremiumFeature =
  | "unlimitedScans"
  | "unlimitedCloudBackup"
  | "aiAssistant"
  | "exportData"
  | "advancedReminders"
  | "familySharing"
  | "prioritySupport";

/**
 * Feature-flag map. `true` = available to free users. `false` = Premium only.
 *
 * Free tier (always available, no flag needed):
 *   - Save & organise documents
 *   - Basic reminders
 *   - Expense tracking
 *   - Calendar
 *   - Basic AI scanning (up to FREE_TIER_LIMITS.monthlyAiScans per month)
 *   - Basic cloud backup (up to FREE_TIER_LIMITS.cloudBackupItems items)
 *
 * These flags control which features show an upgrade prompt for free
 * users. On native platforms with IAP configured, `hasFeature()` in
 * PremiumContext checks these flags for non-premium users. On web
 * (no IAP), `isPremium` defaults to `false` but `hasFeature()` still
 * returns `true` for all features so the web preview stays fully
 * functional.
 */
export const FREE_FEATURE_FLAGS: Record<PremiumFeature, boolean> = {
  unlimitedScans: false,
  unlimitedCloudBackup: false,
  aiAssistant: false,
  exportData: false,
  advancedReminders: false,
  familySharing: false,
  prioritySupport: false,
};

/**
 * Free-tier usage limits. Free users are subject to these limits;
 * Premium users have no limits.
 *
 * These are not currently enforced in the UI — they're defined here
 * so enforcement can be added per-screen when ready.
 */
export const FREE_TIER_LIMITS = {
  /** Maximum AI document scans per month for free users. */
  monthlyAiScans: 10,
  /** Maximum items in cloud backup for free users. */
  cloudBackupItems: 50,
} as const;

/** Plan identifiers — must match the product IDs configured in App Store Connect / Google Play. */
export type PlanId = "monthly" | "yearly";

export interface PremiumPlan {
  id: PlanId;
  /** Product ID for App Store Connect / Google Play. */
  productId: string;
  /** Fallback price label — replaced with the store's localized price when available. */
  priceLabel: string;
  /** Price per period, numeric — used for savings calculation only. */
  price: number;
  /** Billing period label, e.g. "per month". */
  periodLabel: string;
  /** Whether this is the default / recommended plan. */
  recommended?: boolean;
  /** Human-readable savings vs monthly, or undefined for the monthly plan. */
  savingsLabel?: string;
}

/** The two plans the Upgrade screen offers. */
export const PREMIUM_PLANS: PremiumPlan[] = [
  {
    id: "monthly",
    productId: "com.lifevault.premium.monthly",
    priceLabel: "$4.99",
    price: 4.99,
    periodLabel: "per month",
  },
  {
    id: "yearly",
    productId: "com.lifevault.premium.yearly",
    priceLabel: "$39.99",
    price: 39.99,
    periodLabel: "per year",
    recommended: true,
    savingsLabel: "Save 33%",
  },
];

/** Subscription status as reported by RevenueCat's server-side validation. */
export type SubscriptionStatus = "active" | "expired" | "none";

export interface PremiumState {
  /** Whether the user has an active Premium subscription (verified by Apple/Google). */
  isPremium: boolean;
  /** Which plan is active, if any. */
  plan: PlanId | null;
  /** Current status. */
  status: SubscriptionStatus;
  /** ISO datetime the subscription was purchased, if any. */
  purchaseDate: string | null;
  /** ISO datetime the subscription expires or renews, if any. */
  expiryDate: string | null;
}

/**
 * Default state: no Premium. On native platforms, the PremiumContext
 * checks RevenueCat on launch and updates this. On web (no IAP),
 * `hasFeature()` returns `true` for everything so the app stays
 * fully functional without a subscription.
 */
export const DEFAULT_PREMIUM_STATE: PremiumState = {
  isPremium: false,
  plan: null,
  status: "none",
  purchaseDate: null,
  expiryDate: null,
};

/**
 * List of Premium perks shown on the Upgrade screen.
 * Each has a lucide icon name and a short description.
 */
export interface PremiumPerk {
  icon: string;
  title: string;
  description: string;
}

export const PREMIUM_PERKS: PremiumPerk[] = [
  {
    icon: "ScanLine",
    title: "Unlimited AI scans",
    description: "Scan and extract data from unlimited documents — no monthly cap.",
  },
  {
    icon: "Cloud",
    title: "Unlimited cloud backup",
    description: "Back up unlimited documents and sync across all your devices.",
  },
  {
    icon: "Sparkles",
    title: "AI Assistant",
    description: "Ask questions about your vault and get instant AI-powered answers.",
  },
  {
    icon: "Download",
    title: "Export all documents",
    description: "Download everything as ZIP or PDF in one tap.",
  },
  {
    icon: "BellRing",
    title: "Advanced reminders & automation",
    description: "Smart recurring reminders, auto-renew alerts, and custom rules.",
  },
  {
    icon: "Users",
    title: "Family sharing",
    description: "Share selected documents with family members securely.",
  },
  {
    icon: "Headphones",
    title: "Priority support",
    description: "Get faster responses from our dedicated support team.",
  },
];

/**
 * Free-tier features shown on the Upgrade screen to highlight what
 * users already enjoy — builds trust and shows the value of upgrading.
 */
export interface FreeFeature {
  icon: string;
  title: string;
  description: string;
}

export const FREE_FEATURES: FreeFeature[] = [
  {
    icon: "FileText",
    title: "Document storage",
    description: "Save and organise all your important documents.",
  },
  {
    icon: "Bell",
    title: "Basic reminders",
    description: "Never miss a renewal or appointment deadline.",
  },
  {
    icon: "Receipt",
    title: "Expense tracking",
    description: "Track spending and manage your budget effortlessly.",
  },
  {
    icon: "CalendarDays",
    title: "Calendar",
    description: "View appointments and reminders in one place.",
  },
  {
    icon: "ScanLine",
    title: "Basic AI scanning",
    description: `Up to ${FREE_TIER_LIMITS.monthlyAiScans} AI document scans per month.`,
  },
  {
    icon: "Cloud",
    title: "Basic cloud backup",
    description: `Back up up to ${FREE_TIER_LIMITS.cloudBackupItems} items to the cloud securely.`,
  },
];

/**
 * Check whether a feature is available for the current user.
 *
 * Premium users get everything. Free users get features listed in
 * `FREE_FEATURE_FLAGS`. The PremiumContext's `hasFeature()` wraps
 * this with an additional web fallback so the web preview stays
 * fully functional even without IAP.
 */
export function isFeatureAvailable(
  feature: PremiumFeature,
  isPremium: boolean,
): boolean {
  if (isPremium) return true;
  return FREE_FEATURE_FLAGS[feature];
}

/**
 * Check whether a free-tier usage limit has been exceeded.
 *
 * Returns `true` if the user can still perform the action (under the
 * limit), `false` if they've hit the cap and need Premium.
 */
export function isWithinFreeLimit(
  limitType: keyof typeof FREE_TIER_LIMITS,
  currentCount: number,
  isPremium: boolean,
): boolean {
  if (isPremium) return true;
  return currentCount < FREE_TIER_LIMITS[limitType];
}

// Purchase and restore logic now lives in `@/lib/iap.ts` which wraps
// the RevenueCat Capacitor plugin for real Apple/Google IAP.
// Import `purchasePlan` and `restoreIAPPurchases` from there.
