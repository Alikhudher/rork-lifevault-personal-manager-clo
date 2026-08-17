import React, { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  Cloud,
  Crown,
  Download,
  FileText,
  Loader2,
  Receipt,
  ScanLine,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader, SectionTitle } from "@/components/lifevault/PageHeader";
import { usePremium } from "@/context/PremiumContext";
import {
  PREMIUM_PLANS,
  PREMIUM_PERKS,
  FREE_FEATURES,
  type PlanId,
} from "@/lib/premium";
import type {
  PurchasesOffering,
  PurchasesStoreProduct,
} from "@revenuecat/purchases-capacitor";
import {
  fetchOffering,
  fetchProducts,
  findPackageForPlan,
  runIAPDiagnostics,
  checkIntroEligibility,
  invalidateCustomerInfoCache,
  getIntroOfferInfo,
  isEligibleForIntro,
  type IntroOfferInfo,
} from "@/lib/iap";
import type { IntroEligibility } from "@revenuecat/purchases-capacitor";
import { LegalLinks, LegalSheet, type LegalDocType } from "@/components/lifevault/LegalLinks";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

const PERK_ICONS: Record<string, typeof Crown> = {
  ScanLine,
  Cloud,
  Sparkles,
  Download,
};

const FREE_ICONS: Record<string, typeof Crown> = {
  FileText,
  Bell,
  Receipt,
  CalendarDays,
  ScanLine,
  Cloud,
};

/** Capitalize each part of a hyphenated duration label (e.g. "14-day" → "14-Day"). */
function capitalizeDuration(label: string): string {
  return label
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

/** Format the intro trial duration as lowercase words, e.g. "7 days", "1 week", "3 months". */
function formatDurationWords(intro: IntroOfferInfo): string {
  const unit = intro.periodUnit.toLowerCase();
  const n = intro.periodNumberOfUnits;
  if (unit === "day") return n === 1 ? "1 day" : `${n} days`;
  if (unit === "week") return n === 1 ? "1 week" : `${n} weeks`;
  if (unit === "month") return n === 1 ? "1 month" : `${n} months`;
  if (unit === "year") return n === 1 ? "1 year" : `${n} years`;
  return `${n} ${unit}${n > 1 ? "s" : ""}`;
}

/**
 * Preview intro offer shown when IAP is unavailable (web preview).
 * Lets the paywall design be reviewed in the browser. On native iOS,
 * the real introductory offer from RevenueCat/App Store is used instead.
 */
const PREVIEW_INTRO_OFFER: IntroOfferInfo = {
  durationLabel: "7-day",
  isFreeTrial: true,
  priceString: "Free",
  cycles: 1,
  periodUnit: "DAY",
  periodNumberOfUnits: 7,
};

export default function Premium() {
  const {
    isPremium,
    plan,
    premium,
    purchase,
    restore,
    manageSubscription,
    iapAvailable,
    checkingStatus,
    rcIdentityVersion,
  } = usePremium();
  const navigate = useNavigate();
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("yearly");
  const [purchasing, setPurchasing] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [productCount, setProductCount] = useState<number>(0);
  const [introEligibility, setIntroEligibility] = useState<Record<string, IntroEligibility>>({});
  const [legalDoc, setLegalDoc] = useState<LegalDocType | null>(null);

  // Fetch the current RevenueCat Offering on mount (native only) and use
  // its Monthly / Yearly packages for localized pricing. Falls back to the
  // static price labels when no offering or package is available.
  // Also runs a full diagnostic sweep and logs all StoreKit products so
  // "Product not found" issues are visible in TestFlight console logs.
  //
  // Re-fetches whenever the RevenueCat identity changes (sign-in, sign-out,
  // account switch) so offerings and introductory-offer eligibility are
  // always fresh for the current user — never stale from a previous user.
  useEffect(() => {
    if (!iapAvailable) return;
    let mounted = true;
    (async () => {
      // Invalidate cached CustomerInfo so offerings + eligibility are
      // fetched fresh from RevenueCat's backend for the current user.
      await invalidateCustomerInfoCache();

      // Run full diagnostics — logs platform, API key, config status,
      // all StoreKit products, and current offering to the console.
      const diag = await runIAPDiagnostics();
      if (!mounted) return;
      setProductCount(diag.productCount);

      const current = await fetchOffering();
      if (!mounted) return;
      setOffering(current);

      // If the offering had no packages, also try a direct product fetch
      // so we can still display prices from StoreKit.
      if (!current || current.availablePackages.length === 0) {
        console.warn(
          "[Premium] No offering packages — attempting direct StoreKit fetch.",
        );
        const products = await fetchProducts();
        if (!mounted) return;
        setProductCount(products.length);
        if (products.length === 0) {
          console.warn(
            "[Premium] StoreKit returned ZERO products. " +
              "Check App Store Connect: products must be in 'Ready to Submit' " +
              "or 'Approved' status, with a valid price tier, and the bundle ID " +
              "must match. Also verify RevenueCat Offerings are active.",
          );
        }
      }

      // Check introductory offer eligibility so the paywall can show
      // "7-day free trial, then $X" when Apple's StoreKit confirms the
      // user hasn't used their free trial yet.
      const eligibility = await checkIntroEligibility();
      if (!mounted) return;
      setIntroEligibility(eligibility);
    })();
    return () => {
      mounted = false;
    };
  }, [iapAvailable, rcIdentityVersion]);

  // Get the localized price for a plan from the Offering's package, falling
  // back to the static label defined in PREMIUM_PLANS.
  const getPriceLabel = useMemo(() => {
    return (planId: PlanId): string => {
      const fallback = PREMIUM_PLANS.find((p) => p.id === planId);
      if (!fallback) return "";
      const pkg = findPackageForPlan(offering, planId);
      if (pkg && pkg.product.priceString) {
        return pkg.product.priceString;
      }
      return fallback.priceLabel;
    };
  }, [offering]);

  /**
   * Get the introductory offer info for a plan.
   *
   * On native: returns the real intro offer from RevenueCat when the user
   * is eligible (Apple determines eligibility server-side).
   *
   * On web preview: returns a static 7-day free trial preview so the
   * paywall design can be reviewed in the browser. This does NOT affect
   * actual purchases — web purchases remain disabled.
   */
  const getIntroOffer = useMemo(() => {
    return (planId: PlanId): IntroOfferInfo | null => {
      // Web preview: return the static preview offer for design review.
      if (!iapAvailable) return PREVIEW_INTRO_OFFER;
      // Native: use the real RevenueCat intro offer + eligibility.
      const pkg = findPackageForPlan(offering, planId);
      if (!pkg) {
        console.warn(
          `[Premium] No package found for plan="${planId}" — ` +
            `offering=${offering ? JSON.stringify(offering.availablePackages.map(p => p.identifier)) : 'null'}`,
        );
        return null;
      }
      const intro = getIntroOfferInfo(pkg.product.introPrice);
      if (!intro) {
        console.warn(
          `[Premium] Product "${pkg.product.identifier}" has no introPrice. ` +
            `Check App Store Connect: ensure a 7-day Free Trial introductory offer is configured.`,
        );
        return null;
      }
      const eligible = isEligibleForIntro(introEligibility, planId);
      console.log(
        `[Premium] Intro offer for plan="${planId}": ` +
          `duration=${intro.durationLabel}, freeTrial=${intro.isFreeTrial}, eligible=${eligible}`,
      );
      if (!eligible) return null;
      return intro;
    };
  }, [offering, introEligibility, iapAvailable]);

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      await purchase(selectedPlan);
      toast.success("Welcome to LifeVault Premium!", {
        description: "Your subscription is now active.",
      });
      // Close the paywall and return to Home after a successful purchase.
      // PremiumContext has already updated `isPremium` synchronously, so
      // all gated features are immediately available on Home.
      navigate("/", { replace: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Purchase failed. Please try again.";

      // User cancellation — silent (common, not an error).
      if (message.toLowerCase().includes("cancel")) {
        // Silent — user dismissed the purchase sheet.
      } else {
        toast.error("Purchase failed", { description: message });
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      await restore();
      toast.success("Purchases restored", {
        description: "Your Premium subscription is active.",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Restore failed.";
      toast.error("Could not restore", { description: message });
    } finally {
      setRestoring(false);
    }
  };

  const expiryFormatted = premium.expiryDate
    ? format(new Date(premium.expiryDate), "MMM d, yyyy")
    : null;

  // Real trial/subscription state from RevenueCat — no local countdown.
  // periodType === "TRIAL" means the user is in the free trial period.
  // willRenew === true means auto-renew is on (subscription or trial will continue).
  // willRenew === false with isActive means cancelled but still active until expiry.
  const isTrialActive = premium.isPremium && premium.isTrial;
  const isPaidActive = premium.isPremium && !premium.isTrial;
  const isCancelled = premium.isPremium && !premium.willRenew;

  // Status banner text based on real RC entitlement state.
  const statusTitle = isTrialActive
    ? "Premium Free Trial"
    : isPaidActive
      ? "LifeVault Premium — Active"
      : "";
  const statusSubtitle = isTrialActive
    ? isCancelled
      ? `Trial cancelled — Premium remains available until ${expiryFormatted}.`
      : premium.willRenew
        ? `Trial ends ${expiryFormatted}. Your paid plan starts after the trial.`
        : `Trial ends ${expiryFormatted}.`
    : isPaidActive
      ? isCancelled
        ? `Cancelled — Premium remains available until ${expiryFormatted}.`
        : `Renews ${expiryFormatted}.`
      : "";

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="LifeVault Premium"
        subtitle="Unlock advanced features"
        back
      />

      {/* Hero */}
      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(43,90%,55%)] via-[hsl(38,85%,50%)] to-[hsl(28,80%,45%)] p-6 text-center text-white shadow-xl shadow-amber-500/20">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <div className="absolute -bottom-16 -left-8 h-44 w-44 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="relative">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur-sm">
              <Crown className="h-8 w-8" strokeWidth={2.2} />
            </div>
            <h2 className="mt-4 text-[24px] font-extrabold tracking-tight">
              {isPremium
                ? premium.isTrial ? "Premium Free Trial" : "Premium Active"
                : "Upgrade to Premium"}
            </h2>
            <p className="mt-1.5 text-[14px] font-semibold text-white/80">
              Advanced tools for power users. Free forever for the basics.
            </p>
            {!isPremium && getIntroOffer(selectedPlan) && (
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-2 text-[13px] font-bold ring-1 ring-white/30 backdrop-blur-sm">
                <Sparkles className="h-4 w-4" />
                {getIntroOffer(selectedPlan)!.isFreeTrial
                  ? "7-DAY FREE TRIAL"
                  : `Save with ${getIntroOffer(selectedPlan)!.durationLabel} intro`}
              </div>
            )}
            {isPremium && (
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-2 text-[13px] font-bold ring-1 ring-white/30 backdrop-blur-sm">
                <ShieldCheck className="h-4 w-4" />
                {premium.isTrial
                  ? `Free Trial · Ends ${expiryFormatted}`
                  : plan
                    ? `Active · ${plan === "yearly" ? "Yearly" : "Monthly"}`
                    : "All features unlocked"}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Status / loading banner */}
      <section className="px-4 pt-4">
        {checkingStatus ? (
          <div className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-border">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-[13px] font-semibold text-muted-foreground">
              Checking subscription status…
            </p>
          </div>
        ) : isPremium ? (
          <div className="rounded-2xl bg-success/10 px-4 py-4 ring-1 ring-success/20">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-success">
                  {statusTitle}
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  {statusSubtitle || "All premium features are unlocked."}
                </p>
              </div>
            </div>
            {iapAvailable && (
              <button
                type="button"
                onClick={() => manageSubscription()}
                className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-muted-foreground transition-colors hover:text-foreground active:scale-95"
              >
                <Settings className="h-3.5 w-3.5" />
                Manage subscription
              </button>
            )}
          </div>
        ) : !iapAvailable ? (
          <div className="flex items-center gap-3 rounded-2xl bg-success/10 px-4 py-3 ring-1 ring-success/20">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-success">
                All features are currently free
              </p>
              <p className="text-[12px] text-muted-foreground">
                In-app purchases are not available on this platform. Enjoy everything at no cost.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl bg-amber-500/10 px-4 py-3 ring-1 ring-amber-500/20">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Crown className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-amber-600 dark:text-amber-400">
                You're on the free plan
              </p>
              <p className="text-[12px] text-muted-foreground">
                Upgrade to unlock unlimited scans, AI assistant, and more.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Free features — what you already enjoy */}
      <section className="px-4 pt-6">
        <SectionTitle>Free forever</SectionTitle>
        <p className="mb-3 text-[13px] text-muted-foreground">
          Everything below is yours to keep — no subscription needed.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {FREE_FEATURES.map((feature) => {
            const Icon = FREE_ICONS[feature.icon] ?? FileText;
            return (
              <div
                key={feature.title}
                className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-[20px] w-[20px]" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold">{feature.title}</p>
                  <p className="text-[12.5px] text-muted-foreground">{feature.description}</p>
                </div>
                <span className="shrink-0 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-success">
                  Free
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Premium perks — what upgrading unlocks */}
      <section className="px-4 pt-6">
        <SectionTitle>Premium unlocks</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {PREMIUM_PERKS.map((perk) => {
            const Icon = PERK_ICONS[perk.icon] ?? Sparkles;
            return (
              <div
                key={perk.title}
                className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
                  <Icon className="h-[20px] w-[20px]" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold">{perk.title}</p>
                  <p className="text-[12.5px] text-muted-foreground">{perk.description}</p>
                </div>
                {isPremium ? (
                  <Check className="h-5 w-5 shrink-0 text-success" strokeWidth={2.5} />
                ) : (
                  <Crown className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={2.5} />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Plan picker — hidden if already premium */}
      {!isPremium && (
        <section className="px-4 pt-6">
          <SectionTitle>Choose your plan</SectionTitle>

          {/* Always-visible informational trial line */}
          <p className="mb-3 text-[13px] font-semibold text-muted-foreground">
            7-day free trial for eligible new subscribers.
          </p>

          {/* Visible 7-DAY FREE TRIAL badge — only when eligible */}
          {getIntroOffer(selectedPlan)?.isFreeTrial && (
            <div className="mb-3 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 px-4 py-3 ring-1 ring-emerald-500/20">
              <Sparkles className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="text-[13px] font-extrabold text-emerald-700 dark:text-emerald-300">
                7-DAY FREE TRIAL
                <span className="ml-1.5 font-semibold text-emerald-600/80 dark:text-emerald-400/80">
                  — no charge until it ends
                </span>
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            {PREMIUM_PLANS.map((p) => {
              const isSelected = selectedPlan === p.id;
              const priceLabel = getPriceLabel(p.id);
              const intro = getIntroOffer(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPlan(p.id)}
                  disabled={purchasing}
                  className={cn(
                    "relative flex items-center gap-4 overflow-hidden rounded-2xl p-4 text-left shadow-sm ring-1 transition-all active:scale-[0.99] disabled:opacity-60",
                    isSelected
                      ? "bg-gradient-to-br from-[hsl(219,60%,15%)] to-[hsl(216,55%,28%)] text-white ring-primary shadow-lg shadow-primary/20"
                      : "bg-card text-foreground ring-border",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      isSelected ? "border-white bg-white" : "border-muted-foreground/40",
                    )}
                  >
                    {isSelected && <Check className="h-4 w-4 text-primary" strokeWidth={3} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn("text-[16px] font-extrabold", isSelected ? "text-white" : "text-foreground")}>
                        {p.id === "yearly" ? "Yearly" : "Monthly"}
                      </p>
                      {p.recommended && (
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                            isSelected ? "bg-white/20 text-white" : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                          )}
                        >
                          Best value
                        </span>
                      )}
                      {intro && intro.isFreeTrial && (
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                            isSelected ? "bg-emerald-400/20 text-emerald-200" : "bg-success/15 text-success",
                          )}
                        >
                          Free trial
                        </span>
                      )}
                    </div>
                    {intro && intro.isFreeTrial ? (
                      <p className={cn("mt-0.5 text-[13px] font-semibold", isSelected ? "text-emerald-200" : "text-success")}>
                        {formatDurationWords(intro)} free, then {priceLabel}{p.id === "yearly" ? "/year" : "/month"}
                      </p>
                    ) : (
                      <p className={cn("mt-0.5 text-[13px]", isSelected ? "text-white/70" : "text-muted-foreground")}>
                        {p.periodLabel}
                      </p>
                    )}
                    {p.savingsLabel && (
                      <p className={cn("mt-0.5 text-[12px] font-bold", isSelected ? "text-emerald-300" : "text-success")}>
                        {p.savingsLabel}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    {intro && intro.isFreeTrial && (
                      <p className={cn("text-[11px] font-bold uppercase tracking-wide", isSelected ? "text-emerald-200" : "text-success")}>
                        Free
                      </p>
                    )}
                    <p className={cn("text-[22px] font-extrabold tabular", isSelected ? "text-white" : "text-foreground")}>
                      {priceLabel}
                    </p>
                    {intro && intro.isFreeTrial && (
                      <p className={cn("text-[11px] font-medium", isSelected ? "text-white/50" : "text-muted-foreground")}>
                        after trial
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Zero-products warning — visible in TestFlight when StoreKit returns nothing */}
      {!isPremium && iapAvailable && productCount === 0 && !checkingStatus && (
        <section className="px-4 pt-4">
          <div className="rounded-2xl bg-red-500/10 px-4 py-3 ring-1 ring-red-500/20">
            <p className="text-[13px] font-bold text-red-600 dark:text-red-400">
              No store products found
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              The subscription products could not be loaded from the App Store. This usually means the products are still
              in "Missing Metadata" or "Ready to Submit" status, or RevenueCat Offerings are not active. Check the
              console logs for detailed StoreKit diagnostics.
            </p>
          </div>
        </section>
      )}

      {/* CTA buttons — hidden if already premium */}
      {!isPremium && (
        <section className="px-4 pt-6">
          {iapAvailable ? (
            <>
              <Button
                onClick={handlePurchase}
                disabled={purchasing}
                className="h-13 w-full rounded-2xl bg-gradient-to-r from-[hsl(43,90%,55%)] to-[hsl(33,85%,48%)] py-3.5 text-[15px] font-extrabold text-white shadow-lg shadow-amber-500/25 transition-transform active:scale-[0.98]"
                style={{ height: "52px" }}
              >
                {purchasing ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Processing…
                  </>
                ) : getIntroOffer(selectedPlan)?.isFreeTrial ? (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    Start {capitalizeDuration(getIntroOffer(selectedPlan)!.durationLabel)} Free Trial
                  </>
                ) : (
                  <>
                    <Crown className="mr-2 h-5 w-5" />
                    Subscribe
                  </>
                )}
              </Button>
              {/* Price after trial + auto-renew notice — directly below the button */}
              {getIntroOffer(selectedPlan)?.isFreeTrial ? (
                <div className="mt-2.5 text-center">
                  <p className="text-[13px] font-bold text-muted-foreground">
                    {formatDurationWords(getIntroOffer(selectedPlan)!)} free, then {getPriceLabel(selectedPlan)}{selectedPlan === "yearly" ? "/year" : "/month"} · auto-renews unless cancelled
                  </p>
                </div>
              ) : (
                <p className="mt-2.5 text-center text-[13px] font-bold text-muted-foreground">
                  {getPriceLabel(selectedPlan)}{selectedPlan === "yearly" ? "/year" : "/month"} · auto-renews unless cancelled
                </p>
              )}
            </>
          ) : (
            <div className="rounded-2xl bg-muted/50 px-4 py-5 text-center ring-1 ring-border">
              <p className="text-[13px] font-bold text-muted-foreground">
                In-app purchases are not available on this device.
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Premium is currently free. Subscriptions will be available on iOS and Android.
              </p>
            </div>
          )}
          {iapAvailable && (
            <button
              type="button"
              onClick={handleRestore}
              disabled={restoring || purchasing}
              className="mt-4 w-full text-center text-[13px] font-bold text-muted-foreground transition-colors hover:text-foreground active:scale-95"
            >
              {restoring ? "Restoring…" : "Restore purchases"}
            </button>
          )}
        </section>
      )}

      {/* Fine print — Apple App Store Guideline 3.1.2(c) compliance */}
      <section className="px-4 pt-6 pb-6">
        {iapAvailable && (
          <div className="mb-4 rounded-2xl bg-card p-4 ring-1 ring-border">
            <h3 className="text-[13px] font-extrabold text-foreground">
              {selectedPlan === "yearly" ? "LifeVault Premium — Yearly" : "LifeVault Premium — Monthly"}
            </h3>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {selectedPlan === "yearly"
                ? `${getPriceLabel("yearly")} per year — billed annually.`
                : `${getPriceLabel("monthly")} per month — billed monthly.`}
            </p>
            {getIntroOffer(selectedPlan)?.isFreeTrial && (
              <p className="mt-1.5 text-[12.5px] font-semibold text-success">
                Includes a {capitalizeDuration(getIntroOffer(selectedPlan)!.durationLabel)} free trial. You won't be charged until the trial ends. Your subscription automatically converts to the paid plan after the trial period unless you cancel at least 24 hours before the trial ends.
              </p>
            )}
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              This is an auto-renewable subscription. Payment is charged to your Apple App Store or
              Google Play account at confirmation of purchase. The subscription automatically renews
              unless auto-renew is turned off at least 24 hours before the end of the current billing
              period. Your account will be charged for renewal within 24 hours prior to the end of the
              current period. You can manage and cancel your subscription anytime from your App Store
              or Google Play account settings.
            </p>
          </div>
        )}
        <p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
          Subscriptions auto-renew unless cancelled at least 24 hours before the end of the current period.
          Manage or cancel anytime from your App Store or Google Play account settings.
        </p>
        <LegalLinks
          className="mt-3 flex items-center justify-center gap-1 text-[12px]"
          onOpen={setLegalDoc}
        />
        <div className="mt-4 flex items-center justify-center gap-2 text-[12px] font-bold text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          Secure payment via Apple App Store & Google Play
        </div>
      </section>

      {/* Legal document bottom sheet */}
      <LegalSheet
        doc={legalDoc}
        open={legalDoc !== null}
        onOpenChange={(open) => !open && setLegalDoc(null)}
      />
    </div>
  );
}
