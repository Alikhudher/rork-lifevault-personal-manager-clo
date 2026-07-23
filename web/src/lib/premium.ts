/**
 * Premium subscription infrastructure.
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
 * For now every feature stays free: `isPremium` defaults to `true`
 * and no screen checks a paywall. The feature-flag map and free-tier
 * limits exist so that when Premium is activated, gating a feature
 * or enforcing a limit is a one-liner change.
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
 * When Premium is activated, these flags control which features show
 * an upgrade prompt for free users. For now `isPremium` is `true` for
 * everyone, so no flag is actually enforced.
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
 * Free-tier usage limits. When Premium is activated, free users are
 * subject to these limits; Premium users have no limits.
 *
 * For now these are not enforced (isPremium = true for all users),
 * but they're defined here so enforcement is a one-liner later.
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
  /** Localised price label (placeholder until StoreKit / Billing supplies the real value). */
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

/** Subscription status as tracked locally. */
export type SubscriptionStatus = "active" | "expired" | "none";

export interface PremiumState {
  /** Whether the user currently has Premium. Defaults to `true` (everything free for now). */
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

export const DEFAULT_PREMIUM_STATE: PremiumState = {
  isPremium: true,
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
 * While everything is free, this always returns `true`.
 * When Premium is activated, it returns `true` for premium users and
 * falls back to the feature-flag map for free users.
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
 *
 * While everything is free (isPremium = true), always returns `true`.
 */
export function isWithinFreeLimit(
  limitType: keyof typeof FREE_TIER_LIMITS,
  currentCount: number,
  isPremium: boolean,
): boolean {
  if (isPremium) return true;
  return currentCount < FREE_TIER_LIMITS[limitType];
}

/**
 * Purchase a plan.
 *
 * STUB — replace with StoreKit (iOS) / Billing Bridge (Android) call
 * when in-app purchases are activated. The signature mirrors what a
 * real implementation would need: it returns a promise that resolves
 * to the updated PremiumState.
 */
export async function purchasePlan(
  _planId: PlanId,
): Promise<PremiumState> {
  // When IAP is activated:
  // 1. Call the native purchase flow (Capacitor plugin or custom bridge).
  // 2. Verify the receipt server-side.
  // 3. Update the persisted PremiumState.
  // 4. Return the new state.
  throw new Error(
    "In-app purchases are not yet activated. Premium is currently free for all users.",
  );
}

/**
 * Restore previous purchases.
 *
 * STUB — replace with StoreKit / Billing restore when IAP is activated.
 */
export async function restorePurchases(): Promise<PremiumState> {
  throw new Error(
    "In-app purchases are not yet activated. Premium is currently free for all users.",
  );
}
