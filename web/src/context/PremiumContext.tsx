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
  isIAPAvailable,
  onCustomerInfoUpdate,
  purchasePlan as iapPurchase,
  removeCustomerInfoListener,
  restoreIAPPurchases,
  customerInfoToPremiumState,
  manageSubscription as iapManageSubscription,
} from "@/lib/iap";
import { Capacitor } from "@capacitor/core";

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
  const [premium, setPremium] = useState<PremiumState>(() => loadCachedState());
  const [checkingStatus, setCheckingStatus] = useState<boolean>(true);
  const [iapAvailable] = useState<boolean>(() => isIAPAvailable());
  const listenerIdRef = useRef<string | null>(null);

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

      // Configure RevenueCat with the platform's API key.
      await configureIAP();

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
        console.error("[Premium] Failed to check subscription on launch:", err);
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

    return () => {
      mounted = false;
      if (listenerIdRef.current) {
        removeCustomerInfoListener(listenerIdRef.current);
        listenerIdRef.current = null;
      }
    };
  }, []);

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
