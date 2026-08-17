/**
 * @vitest-environment jsdom
 *
 * Paywall UI tests — prove the "7-day free trial for eligible new
 * subscribers." sentence renders for every non-premium user (regardless
 * of eligibility), and that free-plan + purchase sections disappear when
 * the user has an active trial or paid Premium.
 *
 * These tests do NOT find text in a minified bundle — they render the
 * actual Premium component in a DOM and assert the text is visible.
 *
 * Approach: we mock the PremiumContext directly (not IAP/Supabase) so
 * we have full control over isPremium, isTrial, iapAvailable, etc.
 * This tests the RENDERING logic of Premium.tsx, not the IAP lifecycle.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createContext, useContext, type ReactNode } from "react";
import type { PremiumState, PlanId, PremiumFeature } from "@/lib/premium";
import { DEFAULT_PREMIUM_STATE } from "@/lib/premium";

// ─── Mock PremiumContext ─────────────────────────────────────────────
//
// We create a test-only provider that directly sets the context value,
// bypassing the real PremiumProvider (which calls IAP/Supabase). This
// gives us full control over isPremium, isTrial, etc.

interface MockPremiumValue {
  premium: PremiumState;
  isPremium: boolean;
  plan: PlanId | null;
  hasFeature: (feature: PremiumFeature) => boolean;
  iapAvailable: boolean;
  checkingStatus: boolean;
  purchase: (planId: PlanId) => Promise<void>;
  restore: () => Promise<void>;
  manageSubscription: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  resetPremium: () => void;
  rcIdentityVersion: number;
  supabaseUid: string | null;
  rcAppUserID: string | null;
}

const MockPremiumContext = createContext<MockPremiumValue | null>(null);

function MockPremiumProvider({
  children,
  state,
  iapAvailable = false,
}: {
  children: ReactNode;
  state: PremiumState;
  iapAvailable?: boolean;
}) {
  const value: MockPremiumValue = {
    premium: state,
    isPremium: state.isPremium,
    plan: state.plan,
    hasFeature: () => true, // web: all features free
    iapAvailable,
    checkingStatus: false,
    purchase: async () => {},
    restore: async () => {},
    manageSubscription: async () => {},
    refreshStatus: async () => {},
    resetPremium: () => {},
    rcIdentityVersion: 0,
    supabaseUid: null,
    rcAppUserID: null,
  };
  return (
    <MockPremiumContext.Provider value={value}>
      {children}
    </MockPremiumContext.Provider>
  );
}

// Mock the usePremium hook to use our test context.
vi.mock("@/context/PremiumContext", async () => {
  const mod = await import("react");
  return {
    usePremium: () => {
      const ctx = mod.useContext(MockPremiumContext);
      if (!ctx) throw new Error("usePremium must be used inside MockPremiumProvider");
      return ctx;
    },
    PremiumProvider: ({ children }: { children: ReactNode }) =>
      mod.createElement(mod.Fragment, null, children),
  };
});

// Mock the IAP imports used by Premium.tsx (fetchOffering, etc.)
vi.mock("@/lib/iap", () => ({
  fetchOffering: vi.fn().mockResolvedValue(null),
  fetchProducts: vi.fn().mockResolvedValue([]),
  findPackageForPlan: vi.fn().mockReturnValue(null),
  runIAPDiagnostics: vi.fn().mockResolvedValue({
    platform: "web",
    isNative: false,
    hasApiKey: false,
    configured: false,
    productCount: 0,
    products: [],
    hasCurrentOffering: false,
    offeringPackages: [],
  }),
  checkIntroEligibility: vi.fn().mockResolvedValue({}),
  invalidateCustomerInfoCache: vi.fn().mockResolvedValue(undefined),
  getIntroOfferInfo: vi.fn().mockReturnValue(null),
  isEligibleForIntro: vi.fn().mockReturnValue(false),
  isIAPAvailable: vi.fn().mockReturnValue(false),
}));

// Mock Capacitor to report as web (non-native).
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => "web",
    isNativePlatform: () => false,
  },
}));

// Import after mocks are set up.
const Premium = (await import("@/pages/Premium")).default;

const TRIAL_TEXT = "7-day free trial for eligible new subscribers.";

function renderPremium(
  state: PremiumState = DEFAULT_PREMIUM_STATE,
  iapAvailable = false,
) {
  return render(
    <MemoryRouter>
      <MockPremiumProvider state={state} iapAvailable={iapAvailable}>
        <Premium />
      </MockPremiumProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

// ── Non-premium user tests ───────────────────────────────────────────

test("trial text renders when isPremium=false and isEligible=false", () => {
  // Non-premium, no IAP (web preview), not eligible for intro offer.
  const state: PremiumState = { ...DEFAULT_PREMIUM_STATE };
  renderPremium(state, false);

  // The sentence must appear in the rendered DOM.
  const el = screen.getByText(TRIAL_TEXT);
  expect(el).toBeTruthy();
  // It should be a <p> element (real JSX, not just a string in the bundle).
  expect(el.tagName).toBe("P");
});

test("trial text renders as visible JSX directly above the plan cards", () => {
  const state: PremiumState = { ...DEFAULT_PREMIUM_STATE };
  renderPremium(state, false);

  const trialEl = screen.getByText(TRIAL_TEXT);
  const sectionTitle = screen.getByText("Choose your plan");

  // Both elements must be present.
  expect(trialEl).toBeTruthy();
  expect(sectionTitle).toBeTruthy();
  // The trial text is a <p> element (real JSX, not a string in a bundle).
  expect(trialEl.tagName).toBe("P");
  // The section heading appears before the trial text in the DOM —
  // the trial text is directly below the heading and above the plan cards.
  const mask = sectionTitle.compareDocumentPosition(trialEl);
  expect(mask & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("free-plan section ('Free forever') is visible for non-premium users", () => {
  renderPremium({ ...DEFAULT_PREMIUM_STATE }, false);
  expect(screen.getByText("Free forever")).toBeTruthy();
});

test("purchase button area is visible for non-premium users", () => {
  renderPremium({ ...DEFAULT_PREMIUM_STATE }, false);
  // On web (iapAvailable=false), the "not available" message shows.
  expect(
    screen.getByText(/In-app purchases are not available on this device/i),
  ).toBeTruthy();
});

test("premium perks section is always visible (free and premium users)", () => {
  renderPremium({ ...DEFAULT_PREMIUM_STATE }, false);
  expect(screen.getByText("Premium unlocks")).toBeTruthy();
});

test("legal links are always visible", () => {
  renderPremium({ ...DEFAULT_PREMIUM_STATE }, false);
  expect(
    screen.getByText(/Subscriptions auto-renew unless cancelled/i),
  ).toBeTruthy();
});

// ── Active trial tests ──────────────────────────────────────────────

test("free-plan section disappears during active trial", () => {
  const trialState: PremiumState = {
    ...DEFAULT_PREMIUM_STATE,
    isPremium: true,
    isTrial: true,
    plan: "yearly",
    status: "active",
    expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    willRenew: true,
    periodType: "TRIAL",
  };
  renderPremium(trialState, false);

  // "Free forever" section must NOT be visible during trial.
  expect(screen.queryByText("Free forever")).toBeNull();
  // Trial text must NOT be visible (user is premium).
  expect(screen.queryByText(TRIAL_TEXT)).toBeNull();
  // "Choose your plan" section must NOT be visible.
  expect(screen.queryByText("Choose your plan")).toBeNull();
  // "Restore purchases" must NOT be visible.
  expect(screen.queryByText(/Restore purchases/i)).toBeNull();
});

// ── Paid Premium tests ──────────────────────────────────────────────

test("free-plan and purchase sections disappear during paid Premium", () => {
  const paidState: PremiumState = {
    ...DEFAULT_PREMIUM_STATE,
    isPremium: true,
    isTrial: false,
    plan: "yearly",
    status: "active",
    expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    willRenew: true,
    periodType: "NORMAL",
  };
  renderPremium(paidState, false);

  // "Free forever" must NOT be visible for paid premium.
  expect(screen.queryByText("Free forever")).toBeNull();
  // Trial text must NOT be visible.
  expect(screen.queryByText(TRIAL_TEXT)).toBeNull();
  // "Choose your plan" must NOT be visible.
  expect(screen.queryByText("Choose your plan")).toBeNull();
  // "Restore purchases" must NOT be visible.
  expect(screen.queryByText(/Restore purchases/i)).toBeNull();
  // "Subscribe" button must NOT be visible.
  expect(screen.queryByText(/^Subscribe$/i)).toBeNull();
});
