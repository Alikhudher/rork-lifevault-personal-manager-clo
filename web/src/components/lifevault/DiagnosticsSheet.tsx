/**
 * Hidden diagnostics panel — opened by tapping the app version text 5 times
 * on the Profile page. Shows build metadata, Supabase + RevenueCat identity
 * info, and eligibility results. NEVER displays API keys, access tokens,
 * refresh tokens, passwords, or complete receipts.
 */
import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { getSupabaseUserId } from "@/lib/supabase";
import { getDiagnosticsInfo, isIAPAvailable } from "@/lib/iap";
import { usePremium } from "@/context/PremiumContext";
import { useApp } from "@/context/AppContext";

const APP_BUILD_NUMBER = "30";
const GIT_COMMIT_SHA = import.meta.env.VITE_GIT_SHA ?? "dev";

/** Extract the Supabase project reference from the resolved URL. */
function getSupabaseProjectRef(): string {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (url && /^https?:\/\//i.test(url)) {
      const host = new URL(url).hostname;
      if (host.endsWith(".supabase.co")) {
        return host.replace(".supabase.co", "");
      }
    }
  } catch {
    // ignore
  }
  return "jqzubtkxiairtchzmkgj";
}

interface DiagnosticsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DiagnosticsSheet({ open, onOpenChange }: DiagnosticsSheetProps) {
  const { supabaseUid: contextUid } = usePremium();
  const { supabaseUserId: appUid } = useApp();
  const [loading, setLoading] = useState(true);
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [rcInfo, setRcInfo] = useState<{
    rcAppUserID: string | null;
    rcIsAnonymous: boolean | null;
    activeEntitlementIds: string[];
    monthlyEligibility: string;
    yearlyEligibility: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void (async () => {
      // Call sb.auth.getSession() directly — this is the real source of truth.
      const uid = await getSupabaseUserId();
      setSupabaseUserId(uid);
      if (isIAPAvailable()) {
        const info = await getDiagnosticsInfo();
        setRcInfo(info);
      } else {
        setRcInfo({
          rcAppUserID: null,
          rcIsAnonymous: null,
          activeEntitlementIds: [],
          monthlyEligibility: "IAP unavailable (web)",
          yearlyEligibility: "IAP unavailable (web)",
        });
      }
      setLoading(false);
    })();
  }, [open]);

  if (!open) return null;

  const projectRef = getSupabaseProjectRef();
  const identityMismatch = supabaseUserId && rcInfo?.rcAppUserID
    && rcInfo.rcAppUserID !== supabaseUserId;
  const iapAvailable = isIAPAvailable();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="max-h-[85vh] w-full max-w-[420px] overflow-y-auto rounded-t-3xl bg-background p-5 shadow-2xl ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[17px] font-extrabold">Diagnostics</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Build info */}
            <DiagSection title="Build">
              <DiagRow label="App version" value="1.0.0" />
              <DiagRow label="Build number" value={APP_BUILD_NUMBER} />
              <DiagRow label="Git commit" value={GIT_COMMIT_SHA} />
              <DiagRow label="Platform" value={Capacitor.getPlatform()} />
            </DiagSection>

            {/* Supabase identity */}
            <DiagSection title="Supabase">
              <DiagRow label="Project ref" value={projectRef} />
              <DiagRow
                label="User ID"
                value={supabaseUserId ?? "Not signed in"}
              />
              <DiagRow
                label="Context UID"
                value={appUid ?? contextUid ?? "null"}
              />
            </DiagSection>

            {/* RevenueCat identity */}
            <DiagSection title="RevenueCat">
              <DiagRow label="IAP available" value={iapAvailable ? "Yes" : "No"} />
              <DiagRow
                label="App User ID"
                value={rcInfo?.rcAppUserID ?? "Not configured"}
              />
              <DiagRow
                label="Anonymous"
                value={
                  rcInfo?.rcIsAnonymous === null
                    ? "Unknown"
                    : rcInfo?.rcIsAnonymous
                      ? "Yes (anonymous)"
                      : "No (identified)"
                }
              />
              <DiagRow
                label="Entitlements"
                value={
                  rcInfo?.activeEntitlementIds.length
                    ? rcInfo.activeEntitlementIds.join(", ")
                    : "None active"
                }
              />
            </DiagSection>

            {/* Eligibility */}
            <DiagSection title="Intro Offer Eligibility">
              <DiagRow
                label="Monthly"
                value={rcInfo?.monthlyEligibility ?? "Unknown"}
              />
              <DiagRow
                label="Yearly"
                value={rcInfo?.yearlyEligibility ?? "Unknown"}
              />
            </DiagSection>

            {/* Identity mismatch warning */}
            {identityMismatch && (
              <div className="rounded-xl bg-red-500/10 p-3 ring-1 ring-red-500/20">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                  <p className="text-[12px] font-bold text-red-600 dark:text-red-400">
                    Identity mismatch: Supabase user.id does not match the
                    RevenueCat App User ID. Sign out and sign back in to
                    resynchronise.
                  </p>
                </div>
              </div>
            )}

            {/* Match confirmation */}
            {!identityMismatch && supabaseUserId && rcInfo?.rcAppUserID && (
              <div className="rounded-xl bg-success/10 p-3 ring-1 ring-success/20">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  <p className="text-[12px] font-bold text-success">
                    Identity verified — Supabase and RevenueCat user IDs match.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DiagSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-border">
      <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-right text-[12px] font-bold break-all">{value}</span>
    </div>
  );
}
