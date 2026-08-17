import { useNavigate } from "react-router-dom";
import { Crown, Lock } from "lucide-react";
import { usePremium } from "@/context/PremiumContext";
import type { PremiumFeature } from "@/lib/premium";
import { cn } from "@/lib/utils";

interface PaywallGateProps {
  feature: PremiumFeature;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Gates a feature behind Premium. On web preview (no IAP), everything
 * is accessible. On native, free users see an upgrade prompt instead of
 * the gated content. Premium users see the content normally.
 */
export function PaywallGate({
  feature,
  title,
  description,
  children,
  className,
}: PaywallGateProps) {
  const { hasFeature, isPremium, iapAvailable, checkingStatus } = usePremium();
  const navigate = useNavigate();

  // While checking subscription status on native, show nothing
  // (prevents flicker of the paywall before RC confirms premium).
  if (iapAvailable && checkingStatus) {
    return (
      <div className={cn("flex items-center justify-center py-16", className)}>
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    );
  }

  // Premium users and web preview users get full access.
  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  // Free users on native see the upgrade prompt.
  return (
    <div className={cn("px-4 py-8", className)}>
      <div className="mx-auto max-w-sm rounded-3xl bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-6 text-center ring-1 ring-amber-500/20">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 ring-1 ring-amber-500/20">
          {isPremium ? (
            <Crown className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          ) : (
            <Lock className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          )}
        </span>
        <h3 className="mt-4 text-[17px] font-extrabold tracking-tight">{title}</h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          {description}
        </p>
        <button
          onClick={() => navigate("/premium")}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-3 text-[14px] font-bold text-white shadow-lg shadow-amber-500/25 transition-transform active:scale-95"
        >
          <Crown className="h-4 w-4" />
          Upgrade to Premium
        </button>
      </div>
    </div>
  );
}

/**
 * Compact inline lock badge for buttons or small UI elements.
 * Shows a lock icon when the feature is not available to free users.
 */
export function PremiumLockBadge({ feature }: { feature: PremiumFeature }) {
  const { hasFeature, iapAvailable } = usePremium();

  // Web preview: no badge
  if (!iapAvailable) return null;
  if (hasFeature(feature)) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
      <Lock className="h-2.5 w-2.5" />
      Premium
    </span>
  );
}
