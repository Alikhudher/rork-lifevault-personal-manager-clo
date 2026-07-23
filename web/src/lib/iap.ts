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

// Baked-in fallbacks — replace with your real RevenueCat public keys.
// These are PUBLIC app-level keys, not secret keys.
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

/** Whether RevenueCat has been configured. */
let configured = false;

/**
 * Configure RevenueCat with the appropriate API key for the current platform.
 * Must be called before any other IAP method. Safe to call multiple times.
 */
export async function configureIAP(appUserID?: string | null): Promise<void> {
  if (configured) return;
  if (!Capacitor.isNativePlatform()) return;

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
      // Use StoreKit 2 on iOS 16+ for better receipt validation
      storeKitVersion: STOREKIT_VERSION.STOREKIT_2,
    });
    configured = true;
    console.log(`[IAP] RevenueCat configured for ${platform}`);
  } catch (err) {
    console.error("[IAP] Failed to configure RevenueCat:", err);
  }
}

/**
 * Fetch store products for the given product IDs.
 * Returns localized pricing from the App Store / Google Play.
 */
export async function fetchProducts(
  productIds: string[] = ALL_PRODUCT_IDS,
): Promise<PurchasesStoreProduct[]> {
  if (!isIAPAvailable()) return [];
  try {
    const result = await Purchases.getProducts({
      productIdentifiers: productIds,
    });
    return result.products;
  } catch (err) {
    console.error("[IAP] Failed to fetch products:", err);
    return [];
  }
}

/**
 * Initiate a purchase for the given plan.
 * Displays Apple's / Google's native purchase sheet.
 *
 * Returns the updated PremiumState if the purchase succeeds and the
 * entitlement is active. Throws if the user cancels or the purchase fails.
 */
export async function purchasePlan(
  planId: PlanId,
): Promise<PremiumState> {
  if (!isIAPAvailable()) {
    throw new Error(
      "In-app purchases are not available on this platform. " +
        "Premium is currently free for all users.",
    );
  }

  const productId = PRODUCT_IDS[planId];
  const products = await fetchProducts([productId]);
  const product = products.find((p) => p.identifier === productId);

  if (!product) {
    throw new Error(
      `Product "${productId}" not found in the store. ` +
        "Make sure it's configured in App Store Connect / RevenueCat.",
    );
  }

  const result = await Purchases.purchaseStoreProduct({ product });

  // RevenueCat validates the receipt server-side and returns CustomerInfo.
  // Premium only unlocks if the entitlement is ACTIVE.
  return customerInfoToPremiumState(result.customerInfo);
}

/**
 * Restore previous purchases. Checks for any active entitlement.
 * Returns the updated PremiumState — Premium only unlocks if an active
 * subscription is found.
 */
export async function restoreIAPPurchases(): Promise<PremiumState> {
  if (!isIAPAvailable()) {
    throw new Error(
      "In-app purchases are not available on this platform.",
    );
  }

  const { customerInfo } = await Purchases.restorePurchases();
  return customerInfoToPremiumState(customerInfo);
}

/**
 * Check current subscription status without purchasing.
 * Called on app launch to sync entitlement state.
 */
export async function checkSubscriptionStatus(): Promise<PremiumState> {
  if (!isIAPAvailable()) {
    // Web fallback: return the "everything free" state
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
  if (!isIAPAvailable()) return null;
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
  if (!isIAPAvailable()) return;
  try {
    await Purchases.removeCustomerInfoUpdateListener({
      listenerToRemove: callbackId,
    });
  } catch (err) {
    console.error("[IAP] Failed to remove listener:", err);
  }
}

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
    // Determine plan from product identifier
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

  // Check if there's an inactive entitlement (expired)
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

/**
 * Open the platform's native subscription management screen
 * (App Store / Google Play subscriptions page).
 */
export async function manageSubscription(): Promise<void> {
  if (!isIAPAvailable()) return;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    if (customerInfo.managementURL) {
      window.open(customerInfo.managementURL, "_blank");
    }
  } catch (err) {
    console.error("[IAP] Failed to get management URL:", err);
  }
}

/** Log out the RevenueCat user (clears the appUserID). */
export async function logoutIAP(): Promise<void> {
  if (!isIAPAvailable()) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    // "User is already logged out" — safe to ignore
    console.warn("[IAP] Logout warning:", err);
  }
}
