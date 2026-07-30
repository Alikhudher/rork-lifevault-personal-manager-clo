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
import type { PlanId, PremiumState } from "@/lib/premium";

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
      return customerInfoToPremiumState(result.customerInfo);
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
    return customerInfoToPremiumState(result.customerInfo);
  } catch (err) {
    throw wrapPurchaseError(err, planId);
  }
}

/**
 * Wrap a raw purchase error in a user-friendly message while preserving
 * the underlying StoreKit error in the logs. User cancellations are
 * re-thrown as-is (handled silently by the UI).
 */
function wrapPurchaseError(err: unknown, planId: PlanId): Error {
  const raw = err instanceof Error ? err.message : String(err);
  console.error(`[IAP] Purchase failed for plan="${planId}":`, err);

  // User cancelled — pass through; UI handles this silently.
  if (/cancel|user.*cancell|user.*dismiss/i.test(raw)) {
    return new Error("Purchase cancelled by user.");
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
 * Restore previous purchases. Checks for any active entitlement.
 * Returns the updated PremiumState — Premium only unlocks if an active
 * subscription is found.
 */
export async function restoreIAPPurchases(): Promise<PremiumState> {
  if (!(await ensureConfigured())) {
    throw new Error(
      "In-app purchases are not available on this platform.",
    );
  }

  console.log("[IAP] Restoring purchases…");
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    console.log("[IAP] Restore completed, checking entitlement…");
    return customerInfoToPremiumState(customerInfo);
  } catch (err) {
    console.error("[IAP] Restore failed:", err);
    throw new Error(
      `Could not restore purchases: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Check current subscription status without purchasing.
 * Called on app launch to sync entitlement state.
 */
export async function checkSubscriptionStatus(): Promise<PremiumState> {
  if (!(await ensureConfigured())) {
    return {
      isPremium: false,
      plan: null,
      status: "none",
      purchaseDate: null,
      expiryDate: null,
    };
  }

  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return customerInfoToPremiumState(customerInfo);
  } catch (err) {
    console.error("[IAP] Failed to check subscription status:", err);
    return {
      isPremium: false,
      plan: null,
      status: "none",
      purchaseDate: null,
      expiryDate: null,
    };
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

    return {
      isPremium: true,
      plan,
      status: "active",
      purchaseDate: entitlement.latestPurchaseDate || null,
      expiryDate: entitlement.expirationDate || null,
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
    };
  }

  return {
    isPremium: false,
    plan: null,
    status: "none",
    purchaseDate: null,
    expiryDate: null,
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
 * Log in a RevenueCat appUserID (linking purchases to the signed-in user).
 *
 * RevenueCat treats `logIn` as idempotent for an existing user and creates
 * an anonymous-to-known alias on first call. Safe to invoke after every
 * app sign-in. On web or when IAP isn't configured, this is a no-op.
 */
export async function loginIAP(appUserID: string): Promise<PremiumState | null> {
  if (!(await ensureConfigured())) return null;
  try {
    console.log(`[IAP] logIn appUserID="${appUserID}"`);
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
