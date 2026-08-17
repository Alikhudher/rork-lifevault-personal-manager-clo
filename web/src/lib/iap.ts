/**
 * In-App Purchase service — wraps RevenueCat's Capacitor plugin to provide
 * real Apple App Store and Google Play Billing integration.
 *
 * On native platforms (iOS/Android), this configures RevenueCat, fetches
 * real store products, initiates native purchase sheets, restores purchases,
 * and checks subscription status via RevenueCat's server-side receipt
 * validation.
 *
 * On web (browser/preview), IAP is unavailable — all methods return
 * gracefully so the app doesn't crash. The PremiumContext handles the
 * web fallback by keeping features free.
 */

import { Capacitor } from "@capacitor/core";
import {
  Purchases,
  STOREKIT_VERSION,
} from "@revenuecat/purchases-capacitor";
import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
  PurchasesStoreProduct,
} from "@revenuecat/purchases-capacitor";
import type { PlanId, PremiumState, PeriodType } from "@/lib/premium";
import { DEFAULT_PREMIUM_STATE } from "@/lib/premium";
import type { IntroEligibility, PurchasesIntroPrice } from "@revenuecat/purchases-capacitor";
import { INTRO_ELIGIBILITY_STATUS } from "@revenuecat/purchases-capacitor";

/** Introductory offer details extracted from a RevenueCat product. */
export interface IntroOfferInfo {
  /** Localized duration label, e.g. "7-day" or "1-month". */
  durationLabel: string;
  /** True when the intro price is zero (a free trial). */
  isFreeTrial: boolean;
  /** Formatted intro price string (e.g. "Free" or "$0.00"). */
  priceString: string;
  /** Number of billing cycles the intro price lasts. */
  cycles: number;
  /** Period unit: DAY, WEEK, MONTH, or YEAR. */
  periodUnit: string;
  /** Number of period units (e.g. 7 for a 7-day trial). */
  periodNumberOfUnits: number;
}

/**
 * Build a human-readable duration from a RevenueCat intro price.
 * e.g. { periodUnit: "DAY", periodNumberOfUnits: 7 } → "7-day"
 *      { periodUnit: "WEEK", periodNumberOfUnits: 1 } → "1-week"
 *      { periodUnit: "MONTH", periodNumberOfUnits: 3 } → "3-month"
 */
function formatIntroDuration(introPrice: PurchasesIntroPrice): string {
  const { periodUnit, periodNumberOfUnits } = introPrice;
  const unitLower = periodUnit.toLowerCase();
  // singular for 1, plural otherwise
  const unit = periodNumberOfUnits === 1
    ? unitLower
    : `${unitLower}s`;
  // e.g. "7-day", "1-week", "3-months"
  // "day" stays singular even for 7 ("7-day" is idiomatic)
  if (unitLower === "day") {
    return `${periodNumberOfUnits}-day`;
  }
  if (unitLower === "week") {
    return periodNumberOfUnits === 1 ? "1-week" : `${periodNumberOfUnits}-weeks`;
  }
  if (unitLower === "month") {
    return periodNumberOfUnits === 1 ? "1-month" : `${periodNumberOfUnits}-months`;
  }
  if (unitLower === "year") {
    return periodNumberOfUnits === 1 ? "1-year" : `${periodNumberOfUnits}-years`;
  }
  return `${periodNumberOfUnits} ${unit}`;
}

/**
 * Extract introductory offer info from a RevenueCat product, or return null
 * if the product has no introductory price configured.
 */
export function getIntroOfferInfo(introPrice: PurchasesIntroPrice | null): IntroOfferInfo | null {
  if (!introPrice) return null;
  return {
    durationLabel: formatIntroDuration(introPrice),
    isFreeTrial: introPrice.price === 0,
    priceString: introPrice.priceString,
    cycles: introPrice.cycles,
    periodUnit: introPrice.periodUnit,
    periodNumberOfUnits: introPrice.periodNumberOfUnits,
  };
}

/**
 * Check whether the user is eligible for an introductory free trial or
 * intro pricing for the given product IDs.
 *
 * RevenueCat's server checks the user's Apple ID purchase history to
 * determine eligibility. A user who has already used a free trial for
 * any product in the same subscription group is ineligible.
 *
 * Returns a map of productId → IntroEligibility. On web or when IAP
 * is unavailable, returns an empty map.
 */
export async function checkIntroEligibility(
  productIds: string[] = ALL_PRODUCT_IDS,
): Promise<Record<string, IntroEligibility>> {
  if (!(await ensureConfigured())) return {};
  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility({
      productIdentifiers: productIds,
    });
    // Log detailed eligibility info for each product to aid on-device debugging.
    for (const [pid, elig] of Object.entries(result)) {
      console.log(
        `[IAP] Intro eligibility for "${pid}": status=${elig.status} ` +
        `(ELIGIBLE=2, UNKNOWN=0, INELIGIBLE=1, NO_INTRO_OFFER=3)`,
      );
    }
    return result;
  } catch (err) {
    console.warn("[IAP] Failed to check intro eligibility:", err);
    return {};
  }
}

/**
 * Check if a user is eligible for an intro offer on a specific plan.
 *
 * Returns true when RevenueCat confirms eligibility OR when the status is
 * unknown. This is the standard approach because:
 *
 * - ELIGIBLE: user hasn't used their intro offer → show trial.
 * - UNKNOWN: RevenueCat couldn't determine eligibility (common in sandbox,
 *   new subscription groups, or on Android). Show the trial optimistically;
 *   StoreKit handles the actual eligibility check at the purchase sheet.
 *   If the user turns out to be ineligible, Apple's purchase sheet shows
 *   the regular price instead of the trial.
 * - Not in map (check hasn't completed or failed): show trial optimistically
 *   to prevent the trial UI from flickering off while the async check runs.
 *
 * Returns false only when explicitly INELIGIBLE (user already used their
 * trial) or NO_INTRO_OFFER_EXISTS.
 */
export function isEligibleForIntro(
  eligibilityMap: Record<string, IntroEligibility>,
  planId: PlanId,
): boolean {
  const productId = PRODUCT_IDS[planId];
  const elig = eligibilityMap[productId];

  // Eligibility hasn't been checked yet (empty map or missing entry).
  // Be optimistic — show the trial. StoreKit handles eligibility at purchase.
  if (!elig) return true;

  const status = elig.status;

  // ELIGIBLE — user hasn't used their intro offer yet.
  if (status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE) return true;

  // UNKNOWN — RevenueCat couldn't determine eligibility (common in sandbox).
  // Show the trial optimistically; StoreKit handles the real check at purchase.
  if (status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_UNKNOWN) return true;

  // INELIGIBLE — user has already used their intro offer. Don't show trial.
  // NO_INTRO_OFFER_EXISTS — no intro offer configured. Don't show trial.
  if (status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE) {
    console.warn(`[IAP] User is INELIGIBLE for intro offer on "${planId}" (${productId})`);
  }
  if (status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS) {
    console.warn(`[IAP] No intro offer exists for "${planId}" (${productId}) — check App Store Connect`);
  }
  return false;
}

/**
 * RevenueCat API keys.
 *
 * These are PUBLIC client-side keys (prefixed with "appl_" / "goog_"),
 * safe to ship in the app bundle — they are NOT server secrets.
 * RevenueCat uses them to identify your project; all purchase validation
 * happens server-side via Apple/Google receipts.
 *
 * Set via environment variables or replace with your actual keys.
 * Get them from: RevenueCat Dashboard → Project Settings → API Keys.
 */

const RC_IOS_API_KEY = import.meta.env.VITE_RC_IOS_API_KEY || "";
const RC_ANDROID_API_KEY = import.meta.env.VITE_RC_ANDROID_API_KEY || "";

/** The entitlement identifier configured in RevenueCat dashboard. */
export const PREMIUM_ENTITLEMENT_ID = "premium";

/** Product IDs — must match App Store Connect / Google Play / RevenueCat config. */
export const PRODUCT_IDS: Record<PlanId, string> = {
  monthly: "com.lifevault.premium.monthly",
  yearly: "com.lifevault.premium.yearly",
};

/** All product IDs for bulk fetching. */
export const ALL_PRODUCT_IDS = Object.values(PRODUCT_IDS);

/** Whether IAP is available on this platform (native iOS/Android only). */
export function isIAPAvailable(): boolean {
  return (
    Capacitor.isNativePlatform() &&
    ((Capacitor.getPlatform() === "ios" && !!RC_IOS_API_KEY) ||
      (Capacitor.getPlatform() === "android" && !!RC_ANDROID_API_KEY))
  );
}

// ─── Configuration with race-condition protection ──────────────────────

/** Whether RevenueCat.configure() has completed successfully. */
let configured = false;

/** In-flight configure() promise so concurrent callers share one call. */
let configurePromise: Promise<void> | null = null;

/**
 * Configure RevenueCat with the appropriate API key for the current platform.
 * Must be called before any other IAP method. Safe to call multiple times.
 */
export async function configureIAP(appUserID?: string | null): Promise<void> {
  if (configured) return;
  if (!Capacitor.isNativePlatform()) return;

  // Deduplicate: if a configure() is already in flight, await it.
  if (configurePromise) {
    await configurePromise;
    return;
  }

  configurePromise = doConfigure(appUserID);
  try {
    await configurePromise;
  } finally {
    configurePromise = null;
  }
}

async function doConfigure(appUserID?: string | null): Promise<void> {
  const platform = Capacitor.getPlatform();
  const apiKey = platform === "ios" ? RC_IOS_API_KEY : RC_ANDROID_API_KEY;

  if (!apiKey) {
    console.warn(
      `[IAP] No RevenueCat API key for platform "${platform}". ` +
        "Set VITE_RC_IOS_API_KEY / VITE_RC_ANDROID_API_KEY. " +
        "IAP will be unavailable — features remain free.",
    );
    return;
  }

  try {
    await Purchases.configure({
      apiKey,
      appUserID: appUserID || undefined,
      storeKitVersion: STOREKIT_VERSION.STOREKIT_2,
    });
    configured = true;
    console.log(`[IAP] RevenueCat configured for ${platform}, key=${apiKey.slice(0, 12)}…`);
  } catch (err) {
    console.error("[IAP] Failed to configure RevenueCat:", err);
  }
}

/**
 * Ensure RevenueCat is configured before performing an IAP operation.
 * If IAP is not available (web / missing key), returns false.
 * If a configure() is in flight, awaits it first.
 */
async function ensureConfigured(): Promise<boolean> {
  if (!isIAPAvailable()) return false;
  if (configured) return true;
  // Trigger configure if it hasn't been called yet (safety net).
  await configureIAP();
  return configured;
}

// ─── Product / Offering fetching ───────────────────────────────────────

/**
 * Fetch store products for the given product IDs.
 * Returns localized pricing from the App Store / Google Play.
 *
 * Used as a fallback when the RevenueCat Offering can't be loaded.
 * Prefer {@link fetchOffering} which returns Packages from the current
 * Offering (the source of truth configured in the RevenueCat dashboard).
 */
export async function fetchProducts(
  productIds: string[] = ALL_PRODUCT_IDS,
): Promise<PurchasesStoreProduct[]> {
  if (!(await ensureConfigured())) return [];
  try {
    const result = await Purchases.getProducts({
      productIdentifiers: productIds,
    });
    console.log(
      `[IAP] StoreKit returned ${result.products.length} product(s):`,
      result.products.map((p) => ({
        id: p.identifier,
        price: p.priceString,
        title: p.title,
        desc: p.description,
      })),
    );
    return result.products;
  } catch (err) {
    console.error("[IAP] Failed to fetch products — StoreKit error:", err);
    return [];
  }
}

/**
 * Fetch the current RevenueCat Offering.
 *
 * The Offering is configured in the RevenueCat dashboard and groups the
 * Monthly / Yearly packages. Returns `null` on web or if no current
 * offering is set.
 */
export async function fetchOffering(): Promise<PurchasesOffering | null> {
  if (!(await ensureConfigured())) return null;
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (current) {
      console.log(
        `[IAP] Current offering "${current.identifier}" has ${current.availablePackages.length} package(s):`,
        current.availablePackages.map((pkg) => ({
          packageId: pkg.identifier,
          productId: pkg.product.identifier,
          price: pkg.product.priceString,
        })),
      );
    } else {
      console.warn(
        "[IAP] No current offering returned by RevenueCat. " +
          "Check the RevenueCat dashboard: Offerings → ensure one is marked Current.",
      );
    }
    return current ?? null;
  } catch (err) {
    console.error("[IAP] Failed to fetch offerings:", err);
    return null;
  }
}

/**
 * Find the package for a plan in the current Offering.
 *
 * Monthly maps to the Offering's `monthly` package, Yearly to `annual`.
 * Falls back to matching by product identifier so custom package
 * identifiers still work.
 */
export function findPackageForPlan(
  offering: PurchasesOffering | null,
  planId: PlanId,
): PurchasesPackage | null {
  if (!offering) return null;
  if (planId === "monthly" && offering.monthly) return offering.monthly;
  if (planId === "yearly" && offering.annual) return offering.annual;
  const productId = PRODUCT_IDS[planId];
  return (
    offering.availablePackages.find(
      (pkg) => pkg.product.identifier === productId,
    ) ?? null
  );
}

// ─── Purchase / Restore ────────────────────────────────────────────────

/**
 * Get the current RevenueCat App User ID (or null if not configured).
 * Used by the pre-purchase/restore identity check to verify the RC
 * appUserID exactly matches the authenticated Supabase user.id.
 */
export async function getRCAppUserID(): Promise<string | null> {
  if (!(await ensureConfigured())) return null;
  try {
    const { appUserID } = await Purchases.getAppUserID();
    return appUserID;
  } catch {
    return null;
  }
}

/**
 * Verify that the current RevenueCat App User ID exactly matches the
 * expected Supabase user.id. If they don't match, the purchase or restore
 * is BLOCKED — the receipt would be linked to the wrong RevenueCat user,
 * causing RECEIPT_ALREADY_IN_USE errors and cross-account contamination.
 *
 * Returns `true` when IDs match (or when IAP is unavailable on web).
 * Returns `false` with an error message when there's a mismatch —
 * the caller should show the error and NOT proceed.
 */
export async function verifyRCIdentity(
  expectedUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isIAPAvailable()) return { ok: true };
  if (!(await ensureConfigured())) return { ok: true };
  const rcUid = await getRCAppUserID();
  if (!rcUid) {
    return {
      ok: false,
      error: "RevenueCat is not initialized. Please restart the app and try again.",
    };
  }
  if (rcUid !== expectedUserId) {
    console.warn(
      `[IAP] Identity mismatch: RC appUserID="${rcUid}" vs Supabase user.id="${expectedUserId}" — blocking purchase/restore`,
    );
    return {
      ok: false,
      error:
        "Your subscription identity needs to be synchronised. Please sign out and sign back in, then try again.",
    };
  }
  return { ok: true };
}

/**
 * Initiate a purchase for the given plan.
 * Displays Apple's / Google's native purchase sheet.
 *
 * Prefers purchasing the Package from the current RevenueCat Offering
 * (so offering-level config like paywall placement is honored). Falls
 * back to a direct product purchase if no Offering is configured.
 *
 * Returns the updated PremiumState if the purchase succeeds and the
 * entitlement is active. Throws if the user cancels or the purchase fails.
 */
export async function purchasePlan(
  planId: PlanId,
): Promise<PremiumState> {
  if (!(await ensureConfigured())) {
    throw new Error(
      "In-app purchases are not available on this platform. " +
        "Premium is currently free for all users.",
    );
  }

  const productId = PRODUCT_IDS[planId];
  console.log(`[IAP] Starting purchase for plan="${planId}" productId="${productId}"`);

  // Try the Offering first — it's the source of truth in RevenueCat.
  const offering = await fetchOffering();
  const pkg = findPackageForPlan(offering, planId);
  if (pkg) {
    console.log(`[IAP] Purchasing via offering package: ${pkg.identifier}`);
    try {
      const result = await Purchases.purchasePackage({ aPackage: pkg });
      console.log("[IAP] Purchase completed, checking entitlement…");
      const state = customerInfoToPremiumState(result.customerInfo);
      if (!state.isPremium) {
        await logPremiumNotActivated(pkg.product.identifier, result.customerInfo);
      }
      return state;
    } catch (err) {
      throw wrapPurchaseError(err, planId);
    }
  }

  // Fallback: direct product purchase (no Offering configured).
  console.warn(
    `[IAP] No offering package for plan="${planId}". ` +
      "Falling back to direct product fetch + purchase.",
  );
  const products = await fetchProducts([productId]);
  const product = products.find((p) => p.identifier === productId);

  if (!product) {
    // Fetch ALL products to log what StoreKit actually returned — helps
    // diagnose "Product not found" in TestFlight.
    const allProducts = await fetchProducts(ALL_PRODUCT_IDS);
    const foundIds = allProducts.map((p) => p.identifier);
    throw new Error(
      `Product "${productId}" not found in the store. ` +
        `StoreKit returned ${allProducts.length} product(s)` +
        (foundIds.length ? `: ${foundIds.join(", ")}` : " (zero products).") +
        ". Verify the product ID matches App Store Connect, the product is " +
        "in 'Ready to Submit' or 'Approved' status, and your Offerings are " +
        "active in the RevenueCat dashboard.",
    );
  }

  try {
    const result = await Purchases.purchaseStoreProduct({ product });
    console.log("[IAP] Direct purchase completed, checking entitlement…");
    const state = customerInfoToPremiumState(result.customerInfo);
    if (!state.isPremium) {
      await logPremiumNotActivated(product.identifier, result.customerInfo);
    }
    return state;
  } catch (err) {
    throw wrapPurchaseError(err, planId);
  }
}

/**
 * Wrap a raw purchase error in a user-friendly message while preserving
 * the underlying StoreKit error in the logs. User cancellations are
 * re-thrown as-is (handled silently by the UI).
 *
 * Special cases:
 * - RECEIPT_ALREADY_IN_USE (error code 7): the Apple Account already has
 *   an active LifeVault subscription linked to a different RevenueCat
 *   appUserID (a different LifeVault account). Because Restore Behavior
 *   is set to "Keep with Original App User ID", the receipt stays bound
 *   to the original account. We surface a clear, specific message.
 * - RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER (error code 13): same scenario.
 */
function wrapPurchaseError(err: unknown, planId: PlanId): Error {
  const raw = err instanceof Error ? err.message : String(err);
  console.error(`[IAP] Purchase failed for plan="${planId}":`, err);

  // User cancelled — pass through; UI handles this silently.
  if (/cancel|user.*cancell|user.*dismiss/i.test(raw)) {
    return new Error("Purchase cancelled by user.");
  }

  // Receipt already in use — the Apple Account has an active subscription
  // linked to a different LifeVault account. This is NOT a generic error.
  // With "Keep with Original App User ID" restore behavior, the receipt
  // cannot be transferred; it stays bound to the original account until
  // the subscription expires.
  //
  // RevenueCat error codes:
  //   7 = RECEIPT_ALREADY_IN_USE_ERROR
  //  13 = RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR
  // We check the numeric code property (RC throws errors with a `code`
  // field matching the PURCHASES_ERROR_CODE enum) and also match known
  // textual patterns. We do NOT match bare "7"/"13" in the message body
  // to avoid false positives (e.g. "7 days" or "product 13").
  const rcErr = err as { code?: string };
  const rcCode = rcErr?.code ?? "";
  if (
    rcCode === "7" ||
    rcCode === "13" ||
    /RECEIPT_ALREADY_IN_USE/.test(raw) ||
    /RECEIPT_IN_USE_BY_OTHER/.test(raw) ||
    /receipt.*(already|in.use|other.subscriber)/i.test(raw)
  ) {
    return new Error(
      "This Apple Account already has an active LifeVault subscription linked to another LifeVault account. " +
        "Sign in to the original LifeVault account, or use a different Apple Account.",
    );
  }

  // StoreKit configuration issues — surface actionable detail.
  if (/product.*not.*found|cannot connect|invalid/i.test(raw)) {
    return new Error(
      `The subscription could not be found in the store. ` +
        `Please try again later. (StoreKit: ${raw})`,
    );
  }

  // Generic — include the raw error for support diagnosis.
  return new Error(`Purchase failed: ${raw}`);
}

/**
 * Restore previous purchases — called by the user-facing "Restore Purchases"
 * button. Calls `Purchases.restorePurchases()` (NOT `syncPurchases()`),
 * then uses the returned CustomerInfo immediately to activate Premium only
 * if the exact "premium" entitlement is active.
 *
 * This is the correct API for user-initiated restore: it fetches the latest
 * receipt from Apple/Google, sends it to RevenueCat's backend for validation,
 * and returns the updated CustomerInfo with fresh entitlement data.
 */
export async function restoreIAPPurchases(): Promise<PremiumState> {
  if (!(await ensureConfigured())) {
    throw new Error(
      "In-app purchases are not available on this platform.",
    );
  }

  console.log("[IAP] Restoring purchases (restorePurchases)…");
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    console.log("[IAP] Restore completed, checking entitlement…");
    const state = customerInfoToPremiumState(customerInfo);
    if (!state.isPremium) {
      const activeIds = Object.keys(customerInfo.entitlements.active);
      const allIds = Object.keys(customerInfo.entitlements.all);
      console.warn(
        `[IAP] Restore completed but no active Premium entitlement. ` +
          `activeEntitlements=[${activeIds.join(",") || "none"}], ` +
          `allEntitlements=[${allIds.join(",") || "none"}], ` +
          `expected="${PREMIUM_ENTITLEMENT_ID}"`,
      );
    }
    return state;
  } catch (err) {
    console.error("[IAP] Restore failed:", err);
    // Handle RECEIPT_ALREADY_IN_USE in the restore path too — the same
    // error can occur when the Apple Account's receipt is bound to a
    // different RevenueCat appUserID (a different LifeVault account).
    const wrapped = wrapPurchaseError(err, "yearly");
    throw wrapped;
  }
}

/**
 * Check current subscription status without purchasing.
 * Called on app launch to sync entitlement state.
 */
export async function checkSubscriptionStatus(): Promise<PremiumState> {
  if (!(await ensureConfigured())) {
    return DEFAULT_PREMIUM_STATE;
  }

  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return customerInfoToPremiumState(customerInfo);
  } catch (err) {
    console.error("[IAP] Failed to check subscription status:", err);
    return DEFAULT_PREMIUM_STATE;
  }
}

/**
 * Register a listener that fires whenever CustomerInfo is updated
 * (e.g. subscription renews, expires, or is purchased on another device).
 * Returns a callback ID for later removal.
 */
export async function onCustomerInfoUpdate(
  listener: (info: CustomerInfo) => void,
): Promise<string | null> {
  if (!(await ensureConfigured())) return null;
  try {
    const callbackId = await Purchases.addCustomerInfoUpdateListener(listener);
    return callbackId;
  } catch (err) {
    console.error("[IAP] Failed to add customer info listener:", err);
    return null;
  }
}

/** Remove a previously registered customer info listener. */
export async function removeCustomerInfoListener(
  callbackId: string,
): Promise<void> {
  if (!(await ensureConfigured())) return;
  try {
    await Purchases.removeCustomerInfoUpdateListener({
      listenerToRemove: callbackId,
    });
  } catch (err) {
    console.error("[IAP] Failed to remove listener:", err);
  }
}

// ─── State conversion ──────────────────────────────────────────────────

/**
 * Convert RevenueCat CustomerInfo to our PremiumState.
 *
 * Premium only unlocks if the "premium" entitlement is ACTIVE.
 * This is the single source of truth — no local spoofing.
 *
 * Trial detection uses RevenueCat's `periodType` field (not a local countdown):
 *   - periodType === "TRIAL" → the user is in a free trial period.
 *   - periodType === "INTRO" → introductory pricing period.
 *   - periodType === "NORMAL" → regular paid subscription.
 *
 * `willRenew` comes directly from RevenueCat:
 *   - true → auto-renew is on (subscription will continue).
 *   - false → user cancelled but entitlement may still be active until expiry.
 *
 * Sandbox/TestFlight use Apple's accelerated subscription timing automatically —
 * we never calculate trial duration ourselves.
 */
export function customerInfoToPremiumState(
  info: CustomerInfo,
): PremiumState {
  const entitlement = info.entitlements.active[PREMIUM_ENTITLEMENT_ID];

  if (entitlement && entitlement.isActive) {
    const productId = entitlement.productIdentifier;
    const plan: PlanId | null = productId === PRODUCT_IDS.yearly
      ? "yearly"
      : productId === PRODUCT_IDS.monthly
        ? "monthly"
        : null;

    const periodType = (entitlement.periodType as PeriodType) ?? null;
    const isTrial = periodType === "TRIAL";
    const willRenew = entitlement.willRenew;
    const unsubAt = entitlement.unsubscribeDetectedAt || null;

    return {
      isPremium: true,
      plan,
      status: "active",
      purchaseDate: entitlement.latestPurchaseDate || null,
      expiryDate: entitlement.expirationDate || null,
      isTrial,
      willRenew,
      periodType,
      productIdentifier: productId,
      unsubscribeDetectedAt: unsubAt,
    };
  }

  const inactiveEntitlement =
    info.entitlements.all[PREMIUM_ENTITLEMENT_ID];
  if (inactiveEntitlement && !inactiveEntitlement.isActive) {
    return {
      isPremium: false,
      plan: null,
      status: "expired",
      purchaseDate: inactiveEntitlement.latestPurchaseDate || null,
      expiryDate: inactiveEntitlement.expirationDate || null,
      isTrial: false,
      willRenew: false,
      periodType: null,
      productIdentifier: inactiveEntitlement.productIdentifier || null,
      unsubscribeDetectedAt: inactiveEntitlement.unsubscribeDetectedAt || null,
    };
  }

  return {
    isPremium: false,
    plan: null,
    status: "none",
    purchaseDate: null,
    expiryDate: null,
    isTrial: false,
    willRenew: false,
    periodType: null,
    productIdentifier: null,
    unsubscribeDetectedAt: null,
  };
}

// ─── Subscription management ───────────────────────────────────────────

/**
 * Open the platform's native subscription management screen
 * (App Store / Google Play subscriptions page).
 */
export async function manageSubscription(): Promise<void> {
  if (!(await ensureConfigured())) return;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    if (customerInfo.managementURL) {
      window.open(customerInfo.managementURL, "_blank");
    }
  } catch (err) {
    console.error("[IAP] Failed to get management URL:", err);
  }
}

/**
 * Invalidate RevenueCat's cached CustomerInfo so the next call fetches
 * fresh data from the server. Call this before re-checking entitlement
 * after a user identity change to avoid stale cached data.
 */
export async function invalidateCustomerInfoCache(): Promise<void> {
  if (!(await ensureConfigured())) return;
  try {
    await Purchases.invalidateCustomerInfoCache();
    console.log("[IAP] CustomerInfo cache invalidated");
  } catch (err) {
    console.warn("[IAP] Failed to invalidate CustomerInfo cache:", err);
  }
}

/**
 * Sync local StoreKit purchases with RevenueCat's backend.
 *
 * This is a background/migration utility — it is NOT used for the user-facing
 * "Restore Purchases" button. That button calls {@link restoreIAPPurchases}
 * which calls `Purchases.restorePurchases()` and returns CustomerInfo.
 *
 * `syncPurchases()` is useful when you need to link existing App Store
 * receipts to the current RevenueCat appUserID without showing a restore
 * flow (e.g. after a background identity migration).
 */
export async function syncPurchases(): Promise<void> {
  if (!(await ensureConfigured())) return;
  try {
    await Purchases.syncPurchases();
    console.log("[IAP] Purchases synced (background)");
  } catch (err) {
    console.warn("[IAP] Failed to sync purchases:", err);
  }
}

/**
 * Log diagnostic details when Apple completes a transaction but Premium
 * is not activated. Logs the product ID, current RevenueCat appUserID,
 * and all active/inactive entitlement IDs so the mismatch can be
 * diagnosed in TestFlight console logs.
 */
async function logPremiumNotActivated(
  productId: string,
  customerInfo: CustomerInfo,
): Promise<void> {
  let appUserID: string | undefined;
  try {
    const { appUserID: uid } = await Purchases.getAppUserID();
    appUserID = uid;
  } catch {
    // getAppUserID may fail on some platforms; appUserID stays undefined.
  }
  const activeEntitlementIds = Object.keys(customerInfo.entitlements.active);
  const allEntitlementIds = Object.keys(customerInfo.entitlements.all);
  console.warn(
    `[IAP] Transaction completed but Premium NOT activated. ` +
      `productId="${productId}", appUserID="${appUserID ?? 'unknown'}", ` +
      `activeEntitlements=[${activeEntitlementIds.join(",") || "none"}], ` +
      `allEntitlements=[${allEntitlementIds.join(",") || "none"}], ` +
      `expectedEntitlementId="${PREMIUM_ENTITLEMENT_ID}"`,
  );
}

/**
 * Log in a RevenueCat appUserID (linking purchases to the signed-in user).
 *
 * RevenueCat treats `logIn` as idempotent for an existing user and creates
 * an anonymous-to-known alias on first call. Safe to invoke after every
 * genuine identity change. On web or when IAP isn't configured, this is
 * a no-op.
 *
 * Before logging in, the CustomerInfo cache is invalidated so eligibility
 * and entitlement data is fetched fresh from the server for the new user.
 *
 * Does NOT call `syncPurchases()` — that is a background-only utility and
 * is NOT used for the user-facing "Restore Purchases" action.
 */
export async function loginIAP(appUserID: string): Promise<PremiumState | null> {
  if (!(await ensureConfigured())) return null;
  try {
    console.log(`[IAP] logIn appUserID="${appUserID}"`);
    // Invalidate cache before login so the new user's eligibility +
    // entitlement data is fetched fresh from RevenueCat's backend.
    await invalidateCustomerInfoCache();
    const { customerInfo } = await Purchases.logIn({ appUserID });
    return customerInfoToPremiumState(customerInfo);
  } catch (err) {
    console.error("[IAP] logIn failed:", err);
    return null;
  }
}

/** Log out the RevenueCat user (clears the appUserID). */
export async function logoutIAP(): Promise<void> {
  if (!(await ensureConfigured())) return;
  try {
    await Purchases.logOut();
    console.log("[IAP] Logged out from RevenueCat");
  } catch (err) {
    console.warn("[IAP] Logout warning:", err);
  }
}

// ─── Diagnostics ───────────────────────────────────────────────────────

/**
 * Run a full diagnostic sweep — logs platform, API key presence,
 * configuration status, StoreKit products, and current offering.
 * Useful for debugging "Product not found" in TestFlight.
 *
 * Returns a structured diagnostic object for programmatic inspection.
 */
export async function runIAPDiagnostics(): Promise<{
  platform: string;
  isNative: boolean;
  hasApiKey: boolean;
  configured: boolean;
  productCount: number;
  products: { id: string; price: string; title: string }[];
  hasCurrentOffering: boolean;
  offeringPackages: { packageId: string; productId: string }[];
}> {
  const platform = Capacitor.getPlatform();
  const isNative = Capacitor.isNativePlatform();
  const hasApiKey = platform === "ios" ? !!RC_IOS_API_KEY : !!RC_ANDROID_API_KEY;

  console.log("[IAP Diagnostics] Platform:", platform, "Native:", isNative);
  console.log("[IAP Diagnostics] API key present:", hasApiKey);

  if (!isNative || !hasApiKey) {
    console.log("[IAP Diagnostics] IAP not available — non-native or missing key.");
    return {
      platform,
      isNative,
      hasApiKey,
      configured: false,
      productCount: 0,
      products: [],
      hasCurrentOffering: false,
      offeringPackages: [],
    };
  }

  const isConfigured = await ensureConfigured();
  console.log("[IAP Diagnostics] RevenueCat configured:", isConfigured);

  if (!isConfigured) {
    return {
      platform,
      isNative,
      hasApiKey,
      configured: false,
      productCount: 0,
      products: [],
      hasCurrentOffering: false,
      offeringPackages: [],
    };
  }

  const products = await fetchProducts(ALL_PRODUCT_IDS);
  const offering = await fetchOffering();

  const result = {
    platform,
    isNative,
    hasApiKey,
    configured: isConfigured,
    productCount: products.length,
    products: products.map((p) => ({
      id: p.identifier,
      price: p.priceString,
      title: p.title,
    })),
    hasCurrentOffering: !!offering,
    offeringPackages: offering
      ? offering.availablePackages.map((pkg) => ({
          packageId: pkg.identifier,
          productId: pkg.product.identifier,
        }))
      : [],
  };

  console.log("[IAP Diagnostics] Full result:", result);
  return result;
}

/**
 * Get diagnostic details for the hidden diagnostics panel.
 * Returns the current RC appUserID, anonymous status, active entitlement
 * IDs, and intro eligibility results. Never exposes API keys, tokens,
 * or receipts.
 */
export async function getDiagnosticsInfo(): Promise<{
  rcAppUserID: string | null;
  rcIsAnonymous: boolean | null;
  activeEntitlementIds: string[];
  monthlyEligibility: string;
  yearlyEligibility: string;
}> {
  if (!isIAPAvailable() || !(await ensureConfigured())) {
    return {
      rcAppUserID: null,
      rcIsAnonymous: null,
      activeEntitlementIds: [],
      monthlyEligibility: "IAP unavailable",
      yearlyEligibility: "IAP unavailable",
    };
  }

  let rcAppUserID: string | null = null;
  let rcIsAnonymous: boolean | null = null;
  let activeEntitlementIds: string[] = [];

  try {
    const { appUserID } = await Purchases.getAppUserID();
    rcAppUserID = appUserID;
    // RC anonymous IDs start with "$" — a signed-in user has a UUID.
    rcIsAnonymous = appUserID.startsWith("$");
  } catch {
    // getAppUserID may fail if RC isn't fully initialized.
  }

  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    activeEntitlementIds = Object.keys(customerInfo.entitlements.active);
  } catch {
    // CustomerInfo may not be available yet.
  }

  // Check intro eligibility for both plans.
  const eligibility = await checkIntroEligibility();
  const monthlyElig = eligibility[PRODUCT_IDS.monthly];
  const yearlyElig = eligibility[PRODUCT_IDS.yearly];
  const formatElig = (e: IntroEligibility | undefined): string => {
    if (!e) return "Not checked";
    const status = e.status;
    if (status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE) return "Eligible";
    if (status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE) return "Ineligible";
    if (status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS) return "No intro offer";
    return "Unknown";
  };

  return {
    rcAppUserID,
    rcIsAnonymous,
    activeEntitlementIds,
    monthlyEligibility: formatElig(monthlyElig),
    yearlyEligibility: formatElig(yearlyElig),
  };
}
