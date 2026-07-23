/**
 * Premium subscription infrastructure.
 *
 * Everything here is designed so that activating real in-app purchases
 * (Apple App Store / Google Play) later requires only swapping the
 * `purchasePlan` / `restorePurchases` stubs for the native StoreKit /
 * Billing Bridge calls — no UI or state-management changes needed.
 *
 * For now every feature stays completely free: `isPremium` defaults to
 * `true` and no screen checks a paywall. The feature-flag map exists so
 * that when Premium is activated, gating a feature is a one-liner.
 */

/** Identifiers for features that may be gated behind Premium in the future. */
export type PremiumFeature =
  | "unlimitedDocuments"
  | "unlimitedExpenses"
  | "unlimitedScans"
  | "cloudBackup"
  | "aiAssistant"
  | "customThemes"
  | "exportData"
  | "prioritySupport";

/**
 * Feature-flag map. `true` = available to everyone (free).
 * When Premium is activated, set the relevant flags to `false` and the
 * corresponding screens will show an upgrade prompt instead.
 *
 * Until then, every flag is `true` so nothing is locked.
 */
export const FREE_FEATURE_FLAGS: Record<PremiumFeature, boolean> = {
  unlimitedDocuments: true,
  unlimitedExpenses: true,
  unlimitedScans: true,
  cloudBackup: true,
  aiAssistant: true,
  customThemes: true,
  exportData: true,
  prioritySupport: true,
};

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
    icon: "FileText",
    title: "Unlimited documents",
    description: "Store as many documents as you need — no limits.",
  },
  {
    icon: "ScanLine",
    title: "Unlimited AI scans",
    description: "Scan and extract data from documents without restrictions.",
  },
  {
    icon: "Cloud",
    title: "Encrypted cloud backup",
    description: "Sync securely across all your devices with end-to-end encryption.",
  },
  {
    icon: "Sparkles",
    title: "AI Assistant",
    description: "Ask questions about your vault in natural language.",
  },
  {
    icon: "Palette",
    title: "Custom themes",
    description: "Personalise LifeVault with exclusive colour themes.",
  },
  {
    icon: "Headphones",
    title: "Priority support",
    description: "Get faster responses from our support team.",
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
