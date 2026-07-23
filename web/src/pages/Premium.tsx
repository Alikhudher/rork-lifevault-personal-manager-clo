import React, { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellRing,
  CalendarDays,
  Check,
  Cloud,
  Crown,
  Download,
  FileText,
  Headphones,
  Loader2,
  Receipt,
  ScanLine,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
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
import type { PurchasesStoreProduct } from "@revenuecat/purchases-capacitor";
import { fetchProducts } from "@/lib/iap";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const PERK_ICONS: Record<string, typeof Crown> = {
  ScanLine,
  Cloud,
  Sparkles,
  Download,
  BellRing,
  Users,
  Headphones,
};

const FREE_ICONS: Record<string, typeof Crown> = {
  FileText,
  Bell,
  Receipt,
  CalendarDays,
  ScanLine,
  Cloud,
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
  } = usePremium();
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("yearly");
  const [purchasing, setPurchasing] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [storeProducts, setStoreProducts] = useState<
    Record<string, PurchasesStoreProduct>
  >({});

  // Fetch localized product prices from the store on mount (native only).
  useEffect(() => {
    if (!iapAvailable) return;
    let mounted = true;
    (async () => {
      const products = await fetchProducts();
      if (!mounted) return;
      const map: Record<string, PurchasesStoreProduct> = {};
      for (const p of products) {
        map[p.identifier] = p;
      }
      setStoreProducts(map);
    })();
    return () => {
      mounted = false;
    };
  }, [iapAvailable]);

  // Get the localized price for a plan, falling back to the static label.
  const getPriceLabel = useMemo(() => {
    return (planId: PlanId): string => {
      const fallback = PREMIUM_PLANS.find((p) => p.id === planId);
      if (!fallback) return "";
      const product = storeProducts[fallback.productId];
      if (product && product.priceString) {
        return product.priceString;
      }
      return fallback.priceLabel;
    };
  }, [storeProducts]);

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      await purchase(selectedPlan);
      toast.success("Welcome to LifeVault Premium!", {
        description: "Your subscription is now active.",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Purchase failed. Please try again.";

      // Check if it's a user cancellation (common — don't show an error toast).
      if (
        message.toLowerCase().includes("cancel") ||
        message.toLowerCase().includes("user")
      ) {
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
              {isPremium ? "Premium Active" : "Upgrade to Premium"}
            </h2>
            <p className="mt-1.5 text-[14px] font-semibold text-white/80">
              Advanced tools for power users. Free forever for the basics.
            </p>
            {isPremium && (
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-2 text-[13px] font-bold ring-1 ring-white/30 backdrop-blur-sm">
                <ShieldCheck className="h-4 w-4" />
                {plan ? `Active · ${plan === "yearly" ? "Yearly" : "Monthly"}` : "All features unlocked"}
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
                  Premium is active
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  All premium features are unlocked.
                  {expiryFormatted && ` Renews ${expiryFormatted}.`}
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
        <div className="grid grid-cols-1 gap-2.5">
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
        <div className="grid grid-cols-1 gap-2.5">
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
          <div className="grid grid-cols-1 gap-3">
            {PREMIUM_PLANS.map((p) => {
              const isSelected = selectedPlan === p.id;
              const priceLabel = getPriceLabel(p.id);
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
                    </div>
                    <p className={cn("mt-0.5 text-[13px]", isSelected ? "text-white/70" : "text-muted-foreground")}>
                      {p.periodLabel}
                    </p>
                    {p.savingsLabel && (
                      <p className={cn("mt-0.5 text-[12px] font-bold", isSelected ? "text-emerald-300" : "text-success")}>
                        {p.savingsLabel}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className={cn("text-[22px] font-extrabold tabular", isSelected ? "text-white" : "text-foreground")}>
                      {priceLabel}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* CTA buttons — hidden if already premium */}
      {!isPremium && (
        <section className="px-4 pt-6">
          {iapAvailable ? (
            <Button
              onClick={handlePurchase}
              disabled={purchasing || checkingStatus}
              className="h-13 w-full rounded-2xl bg-gradient-to-r from-[hsl(43,90%,55%)] to-[hsl(33,85%,48%)] py-3.5 text-[15px] font-extrabold text-white shadow-lg shadow-amber-500/25 transition-transform active:scale-[0.98]"
              style={{ height: "52px" }}
            >
              {purchasing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <Crown className="mr-2 h-5 w-5" />
                  Continue with {selectedPlan === "yearly" ? "Yearly" : "Monthly"}
                </>
              )}
            </Button>
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
              className="mt-3 w-full text-center text-[13px] font-bold text-muted-foreground transition-colors hover:text-foreground active:scale-95"
            >
              {restoring ? "Restoring…" : "Restore purchases"}
            </button>
          )}
        </section>
      )}

      {/* Fine print */}
      <section className="px-4 pt-6 pb-6">
        <p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
          Subscriptions auto-renew unless cancelled at least 24 hours before the end of the current period.
          Manage or cancel anytime from your App Store or Google Play account settings.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 text-[12px] font-bold text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          Secure payment via Apple App Store & Google Play
        </div>
      </section>
    </div>
  );
}
