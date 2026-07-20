/**
 * Real email delivery confirmation, shared by EVERY flow that sends a
 * verification/confirmation email (login Forgot Password, Profile →
 * Change Password recovery, email change, backup password reset,
 * confirmation resend).
 *
 * Why: a successful send only proves the mail provider (Brevo)
 * ACCEPTED the message. Gmail sometimes defers delivery for minutes
 * ("421 unusual rate of mail…"), so the code can be "sent" yet not in
 * the inbox. After each send the app now asks the `email-status` Edge
 * Function (which reads Brevo's own logs) and tells the user the
 * truth: delivered ✓, delayed by the inbox provider, or failed with
 * the provider's real reason.
 */
import { toast } from "sonner";
import { getSupabase, withTimeout } from "@/lib/supabase";

export type EmailDeliveryStatus = "accepted" | "delayed" | "delivered" | "failed" | "unknown";

export interface EmailDeliveryReport {
  found: boolean;
  status: EmailDeliveryStatus;
  reason: string | null;
  at: string | null;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "accepted",
  "delayed",
  "delivered",
  "failed",
  "unknown",
]);

const CHECK_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 4_000;
/** Total confirmation budget — Gmail deferrals longer than this get an honest "delayed" verdict. */
const POLL_BUDGET_MS = 45_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One delivery-status lookup against Brevo's logs (via the
 * `email-status` Edge Function). Returns null when the status service
 * is unreachable — delivery tracking is best-effort and must never
 * break a recovery flow.
 */
export async function checkEmailDelivery(
  email: string,
  sinceMs: number,
): Promise<EmailDeliveryReport | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await withTimeout(
      sb.functions.invoke("email-status", { body: { email, sinceMs } }),
      CHECK_TIMEOUT_MS,
      "Checking email delivery",
    );
    if (error || data === null || typeof data !== "object") {
      if (error) {
        console.warn("[EmailDelivery] Status check failed:", error.message ?? String(error));
      }
      return null;
    }
    const d = data as { found?: unknown; status?: unknown; reason?: unknown; at?: unknown };
    if (typeof d.status !== "string" || !VALID_STATUSES.has(d.status)) return null;
    return {
      found: d.found === true,
      status: d.status as EmailDeliveryStatus,
      reason: typeof d.reason === "string" && d.reason.length > 0 ? d.reason : null,
      at: typeof d.at === "string" ? d.at : null,
    };
  } catch (err) {
    console.warn("[EmailDelivery] Status check threw:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Latest tracker per email — a resend supersedes the previous tracker's toast. */
const activeTrackers = new Map<string, number>();
let trackerSeq = 0;

/**
 * Fire-and-forget delivery watcher. Shows a small progress toast and
 * resolves it with the REAL outcome from Brevo's logs:
 *  - delivered → success ("check Spam if you don't see it")
 *  - delayed   → explains the inbox provider is throttling (Gmail 421)
 *  - failed    → the provider's exact rejection reason
 * If the status service can't be reached at all, the toast is
 * dismissed quietly — the send itself was already confirmed accepted.
 */
export async function trackEmailDelivery(email: string, sinceMs: number): Promise<EmailDeliveryStatus> {
  const me = ++trackerSeq;
  activeTrackers.set(email, me);
  const toastId = toast.loading("Confirming delivery…", {
    description: `Checking with the mail service that the email to ${email} arrived.`,
  });
  const isStale = (): boolean => activeTrackers.get(email) !== me;

  const deadline = Date.now() + POLL_BUDGET_MS;
  let last: EmailDeliveryStatus = "unknown";
  let anyResponse = false;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (isStale()) {
      toast.dismiss(toastId);
      return last;
    }
    const report = await checkEmailDelivery(email, sinceMs);
    if (isStale()) {
      toast.dismiss(toastId);
      return last;
    }
    if (!report) continue;
    anyResponse = true;
    last = report.status;
    if (report.status === "delivered") {
      console.log("[EmailDelivery] Delivery confirmed by the mail service");
      toast.success("Email delivered", {
        id: toastId,
        description: `The mail service confirmed delivery to ${email}. If you don't see it, check Spam.`,
        duration: 7000,
      });
      return last;
    }
    if (report.status === "failed") {
      console.warn("[EmailDelivery] Provider rejected delivery:", report.reason ?? "no reason given");
      toast.error("The email could not be delivered", {
        id: toastId,
        description: report.reason
          ? `The mail service said: “${report.reason}”`
          : "The mail service reported a delivery failure. Check the address and try again.",
        duration: 12000,
      });
      return last;
    }
    if (report.status === "delayed") {
      toast.loading("Your inbox is delaying the email…", {
        id: toastId,
        description: report.reason
          ? `The receiving server said: “${report.reason.slice(0, 140)}”. It usually arrives within a few minutes — check Spam too.`
          : "It was accepted, but the receiving server is throttling. It usually arrives within a few minutes — check Spam too.",
      });
    }
  }

  if (isStale() || !anyResponse) {
    // Status service unreachable (or superseded) — the send was already
    // confirmed accepted, so end quietly rather than alarm the user.
    toast.dismiss(toastId);
    return last;
  }
  if (last === "delayed") {
    toast.warning("Delivery is delayed by your inbox provider", {
      id: toastId,
      description:
        "The email was sent and accepted, but your mail provider is throttling it. It can take a few minutes — check Spam as well, then use Resend if it never arrives.",
      duration: 12000,
    });
  } else {
    toast.info("Sent — waiting on the delivery receipt", {
      id: toastId,
      description: "The email was accepted by the mail service. Give it a minute and check Spam too.",
      duration: 8000,
    });
  }
  return last;
}
