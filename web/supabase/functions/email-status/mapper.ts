/**
 * Pure mapping from Brevo transactional-email events to a single
 * delivery status the app can show truthfully. Shared by the
 * email-status Edge Function (Deno) and the web unit tests (Node) —
 * keep this file free of any runtime-specific APIs.
 */

export type DeliveryStatus = "accepted" | "delayed" | "delivered" | "failed" | "unknown";

/** Loose shape covering both Brevo event feeds (`statistics/events` and per-message `events`). */
export interface BrevoEventLike {
  /** Event name — "requests", "delivered", "opened", "deferred", "error", "soft_bounces", … */
  event?: string | null;
  /** Per-message endpoint uses `name` instead of `event`. */
  name?: string | null;
  reason?: string | null;
  date?: string | null;
  time?: string | null;
}

export interface DeliverySummary {
  status: DeliveryStatus;
  /** Human-readable reason from the mail provider (deferrals, bounces, blocks). */
  reason: string | null;
  /** ISO timestamp of the decisive event, when known. */
  at: string | null;
}

function normalize(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

function eventName(e: BrevoEventLike): string {
  return normalize(e.event ?? e.name);
}

function eventAt(e: BrevoEventLike): string | null {
  return e.date ?? e.time ?? null;
}

/** The recipient's mail server accepted the message (or the user saw it). */
function isDelivered(n: string): boolean {
  return (
    n.includes("delivered") ||
    n.includes("open") ||
    n.includes("click") ||
    n === "uniqueopened" ||
    n.includes("proxyopen")
  );
}

/** Permanent failure — the message will never arrive. */
function isFailed(n: string): boolean {
  return (
    n.includes("hardbounce") ||
    n.includes("blocked") ||
    n.includes("invalid") ||
    n === "error" ||
    n.includes("error")
  );
}

/** Temporary refusal — the provider keeps retrying (e.g. Gmail 421 throttling). */
function isDelayed(n: string): boolean {
  return n.includes("defer") || n.includes("softbounce");
}

/** Brevo's API accepted the send request. */
function isAccepted(n: string): boolean {
  return n.includes("request") || n === "sent" || n.includes("queued");
}

/**
 * Collapse a message's event history into one status.
 *
 * Priority: delivered > failed > delayed > accepted > unknown.
 * A delivery outranks an earlier error because retries can succeed —
 * if the user's mailbox got the message, that is the truth that matters.
 */
export function summarizeBrevoEvents(events: BrevoEventLike[]): DeliverySummary {
  let delivered: BrevoEventLike | null = null;
  let failed: BrevoEventLike | null = null;
  let delayed: BrevoEventLike | null = null;
  let accepted: BrevoEventLike | null = null;

  for (const e of events) {
    const n = eventName(e);
    if (n.length === 0) continue;
    if (isDelivered(n)) delivered = delivered ?? e;
    else if (isFailed(n)) failed = failed ?? e;
    else if (isDelayed(n)) delayed = delayed ?? e;
    else if (isAccepted(n)) accepted = accepted ?? e;
  }

  if (delivered) return { status: "delivered", reason: null, at: eventAt(delivered) };
  if (failed) return { status: "failed", reason: failed.reason ?? null, at: eventAt(failed) };
  if (delayed) return { status: "delayed", reason: delayed.reason ?? null, at: eventAt(delayed) };
  if (accepted) return { status: "accepted", reason: null, at: eventAt(accepted) };
  return { status: "unknown", reason: null, at: null };
}
