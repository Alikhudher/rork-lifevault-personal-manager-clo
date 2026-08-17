import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_PREMIUM_STATE,
  FREE_FEATURE_FLAGS,
  type PlanId,
  type PremiumFeature,
  type PremiumState,
} from "@/lib/premium";
import {
  checkSubscriptionStatus,
  configureIAP,
  invalidateCustomerInfoCache,
  isIAPAvailable,
  loginIAP,
  logoutIAP,
  onCustomerInfoUpdate,
  purchasePlan as iapPurchase,
  removeCustomerInfoListener,
  restoreIAPPurchases,
  customerInfoToPremiumState,
  manageSubscription as iapManageSubscription,
} from "@/lib/iap";
import { Capacitor } from "@capacitor/core";
import { useApp } from "@/context/AppContext";

const STORAGE_KEY = "lifevault-premium-v1";

const PremiumContext = createContext<PremiumContextValue | null>(null);

interface PremiumContextValue {
  /** Full premium state (verified by Apple/Google via RevenueCat). */
  premium: PremiumState;
  /** Whether the user has an active Premium subscription. */
  isPremium: boolean;
  /** Which plan is active, or null. */
  plan: PlanId | null;
  /** Check if a specific feature is available for the current user. */
  hasFeature: (feature: PremiumFeature) => boolean;
  /** Whether IAP is available on this platform. */
  iapAvailable: boolean;
  /** Whether the subscription status is being checked (on launch). */
  checkingStatus: boolean;
  /** Purchase a plan — shows Apple's / Google's native purchase sheet. */
  purchase: (planId: PlanId) => Promise<void>;
  /** Restore previous purchases via Apple/Google. */
  restore: () => Promise<void>;
  /** Open the platform's subscription management page. */
  manageSubscription: () => Promise<void>;
  /** Refresh subscription status from RevenueCat. */
  refreshStatus: () => Promise<void>;
  /** Reset premium state (used on logout). */
  resetPremium: () => void;
  /** Monotonically increasing counter bumped every time the RevenueCat
   *  appUserID changes (sign-in, sign-out, account switch). Components
   *  that cache RevenueCat data (offerings, eligibility) should depend on
   *  this to re-fetch fresh data for the new user. */
  rcIdentityVersion: number;
}

function loadCachedState(): PremiumState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREMIUM_STATE;
    const parsed = JSON.parse(raw) as Partial<PremiumState>;
    return { ...DEFAULT_PREMIUM_STATE, ...parsed };
  } catch {
    return DEFAULT_PREMIUM_STATE;
  }
}

/**
 * Premium subscription provider — connected to real Apple/Google IAP.
 *
 * On native platforms (iOS/Android):
 *  - Configures RevenueCat on mount.
 *  - Checks subscription status on app launch (server-side receipt validation).
 *  - Listens for customer info updates (renewals, expirations, cross-device).
 *  - Purchase shows the native Apple/Google purchase sheet.
 *  - Premium only unlocks when RevenueCat confirms an active entitlement.
 *
 * On web (browser/preview):
 *  - IAP is unavailable; `isPremium` is `false`.
 *  - `hasFeature()` returns `true` for ALL features so the web preview
 *    stays fully functional without a subscription.
 */
export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const { user } = useApp();
  const [premium, setPremium] = useState<PremiumState>(() => loadCachedState());
  const [checkingStatus, setCheckingStatus] = useState<boolean>(true);
  const [iapAvailable] = useState<boolean>(() => isIAPAvailable());
  const listenerIdRef = useRef<string | null>(null);
  // Track the last appUserID we logged in to RevenueCat so we only call
  // logIn when the identity actually changes (avoids redundant SDK calls).
  const lastAppUserIdRef = useRef<string | null>(null);
  // Bumped every time the RevenueCat appUserID changes. Components that
  // cache RC data (offerings, eligibility) depend on this to re-fetch.
  const [rcIdentityVersion, setRcIdentityVersion] = useState<number>(0);

  // Persist state to localStorage (cache for instant UI on next launch).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(premium));
    } catch {
      // ignore quota errors
    }
  }, [premium]);

  // Configure RevenueCat and check subscription status on launch.
  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!Capacitor.isNativePlatform()) {
        // Web: no IAP. Mark as done checking, keep features free via hasFeature.
        setCheckingStatus(false);
        return;
      }

      // Configure RevenueCat with the platform's API key. If the user is
      // already signed in (app restart), pass their email as the appUserID
      // so RevenueCat starts with the correct identity instead of anonymous.
      const initialUserID = user?.email ?? null;
      await configureIAP(initialUserID);

      if (!isIAPAvailable()) {
        setCheckingStatus(false);
        return;
      }

      // Check current subscription status (server-side validated).
      try {
        const state = await checkSubscriptionStatus();
        if (mounted) {
          setPremium(state);
        }
      } catch (err) {
        console.warn("[Premium] Failed to check subscription on launch:", err);
      } finally {
        if (mounted) setCheckingStatus(false);
      }

      // Register a listener for real-time subscription updates
      // (renewals, cancellations, purchases on other devices).
      const callbackId = await onCustomerInfoUpdate((info) => {
        if (!mounted) return;
        const newState = customerInfoToPremiumState(info);
        setPremium(newState);
      });
      if (callbackId) {
        listenerIdRef.current = callbackId;
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      mounted = false;
      if (listenerIdRef.current) {
        removeCustomerInfoListener(listenerIdRef.current);
        listenerIdRef.current = null;
      }
    };
  }, []);

  // Link RevenueCat to the signed-in user and re-check subscription status
  // whenever the user changes (sign-in / sign-out / account switch). On
  // web (no IAP) this is a no-op. Premium only unlocks after RevenueCat
  // confirms an active `premium` entitlement — never from the local cache.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const appUserID = user?.email ?? null;

    async function syncIdentity() {
      // Sign-out: log out RevenueCat and clear the cached Premium state so
      // the next user starts from a clean, unverified state.
      if (!appUserID) {
        if (lastAppUserIdRef.current !== null) {
          await invalidateCustomerInfoCache();
          await logoutIAP();
          lastAppUserIdRef.current = null;
          setPremium(DEFAULT_PREMIUM_STATE);
          setRcIdentityVersion((v) => v + 1);
        }
        return;
      }
      // Sign-in: log in RevenueCat with the user's email as appUserID and
      // sync entitlement state from the server.
      if (appUserID === lastAppUserIdRef.current) return;
      setCheckingStatus(true);
      try {
        const state = await loginIAP(appUserID);
        if (state) {
          setPremium(state);
        } else {
          // loginIAP returned null (web/IAP unavailable) — fall back to a
          // status check so we still reflect the real entitlement.
          const fallback = await checkSubscriptionStatus();
          setPremium(fallback);
        }
        lastAppUserIdRef.current = appUserID;
        // Bump identity version so the paywall re-fetches offerings +
        // eligibility for the new RevenueCat user.
        setRcIdentityVersion((v) => v + 1);
      } catch (err) {
        console.warn("[Premium] Failed to sync RevenueCat identity:", err);
      } finally {
        setCheckingStatus(false);
      }
    }
    void syncIdentity();
  }, [user?.email]);

  // hasFeature: on web (no IAP), everything is free.
  // On native, check the feature flag for non-premium users.
  const hasFeature = useCallback(
    (feature: PremiumFeature): boolean => {
      // Web fallback: all features free when IAP is not available.
      if (!iapAvailable) return true;
      // Native: premium users get everything; free users get FREE_FEATURE_FLAGS.
      if (premium.isPremium) return true;
      return FREE_FEATURE_FLAGS[feature];
    },
    [premium.isPremium, iapAvailable],
  );

  const purchase = useCallback(async (planId: PlanId) => {
    const newState = await iapPurchase(planId);
    setPremium(newState);
    if (!newState.isPremium) {
      throw new Error(
        "Purchase completed but Premium was not activated. " +
          "If this persists, try restoring purchases or contact support.",
      );
    }
  }, []);

  const restore = useCallback(async () => {
    const newState = await restoreIAPPurchases();
    setPremium(newState);
    if (!newState.isPremium) {
      throw new Error(
        "No active subscription was found for this Apple ID / Google account.",
      );
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!isIAPAvailable()) return;
    const state = await checkSubscriptionStatus();
    setPremium(state);
  }, []);

  const manageSubscription = useCallback(async () => {
    if (!isIAPAvailable()) return;
    await iapManageSubscription();
  }, []);

  const resetPremium = useCallback(() => {
    setPremium(DEFAULT_PREMIUM_STATE);
  }, []);

  const value = {
    premium,
    isPremium: premium.isPremium,
    plan: premium.plan,
    hasFeature,
    iapAvailable,
    checkingStatus,
    purchase,
    restore,
    manageSubscription,
    refreshStatus,
    resetPremium,
    rcIdentityVersion,
  };

  return (
    <PremiumContext.Provider value={value}>
      {children}
    </PremiumContext.Provider>
  );
}

/** Access the Premium subscription state from any component. */
export function usePremium(): PremiumContextValue {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error("usePremium must be used inside PremiumProvider");
  return ctx;
}
