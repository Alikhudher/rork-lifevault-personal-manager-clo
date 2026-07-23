import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_PREMIUM_STATE,
  type PlanId,
  type PremiumFeature,
  type PremiumState,
} from "@/lib/premium";

const STORAGE_KEY = "lifevault-premium-v1";

const PremiumContext = createContext<PremiumContextValue | null>(null);

interface PremiumContextValue {
  /** Full premium state. */
  premium: PremiumState;
  /** Whether the user has Premium (convenience). */
  isPremium: boolean;
  /** Which plan is active, or null. */
  plan: PlanId | null;
  /** Check if a specific feature is available for the current user. */
  hasFeature: (feature: PremiumFeature) => boolean;
  /**
   * Purchase a plan. STUB — replace with StoreKit / Billing when IAP
   * is activated.
   */
  purchase: (planId: PlanId) => Promise<void>;
  /**
   * Restore previous purchases. STUB — replace with StoreKit / Billing
   * restore when IAP is activated.
   */
  restore: () => Promise<void>;
  /** Cancel / deactivate Premium (used for testing or support flows). */
  deactivate: () => void;
}

function loadPremiumState(): PremiumState {
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
 * Premium subscription provider.
 *
 * Until in-app purchases are activated, every user is treated as
 * Premium (`isPremium = true`) so nothing is locked. The state machine,
 * persistence and feature-flag checking are all real — activating IAP
 * later only requires replacing the `purchase` / `restore` stubs in
 * `@/lib/premium` with native StoreKit / Billing calls.
 *
 * Mounted inside `AppProvider` (needs user context) and outside the
 * router so every screen can call `usePremium()`.
 */
export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const [premium, setPremium] = useState<PremiumState>(() => loadPremiumState());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(premium));
    } catch {
      // ignore quota errors
    }
  }, [premium]);

  const hasFeature = useCallback(
    (feature: PremiumFeature) => {
      // While everything is free, always return true.
      // When IAP activates: return premium.isPremium || FREE_FEATURE_FLAGS[feature]
      void feature;
      return true;
    },
    [premium.isPremium],
  );

  const purchase = useCallback(async (_planId: PlanId) => {
    // STUB — when IAP activates:
    // 1. Call the native purchase flow.
    // 2. Verify the receipt server-side.
    // 3. Update state with the new entitlement.
    void _planId;
    // No-op for now — Premium is free.
  }, []);

  const restore = useCallback(async () => {
    // STUB — when IAP activates:
    // 1. Call StoreKit.restorePurchases / BillingClient.queryPurchases.
    // 2. Verify any returned receipts.
    // 3. Update state.
    // No-op for now.
  }, []);

  const deactivate = useCallback(() => {
    setPremium(DEFAULT_PREMIUM_STATE);
  }, []);

  const value = useMemo<PremiumContextValue>(
    () => ({
      premium,
      isPremium: premium.isPremium,
      plan: premium.plan,
      hasFeature,
      purchase,
      restore,
      deactivate,
    }),
    [premium, hasFeature, purchase, restore, deactivate],
  );

  return (
    <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>
  );
}

/** Access the Premium subscription state from any component. */
export function usePremium(): PremiumContextValue {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error("usePremium must be used inside PremiumProvider");
  return ctx;
}
