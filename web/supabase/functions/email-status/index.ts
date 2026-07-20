/**
 * LifeVault email delivery status — answers "did the verification email
 * actually reach the inbox?" straight from Brevo's own logs.
 *
 * WHY THIS EXISTS
 * Supabase Auth returning 200 only proves Brevo ACCEPTED the message
 * (the send-email hook fails the request otherwise). Gmail then
 * sometimes DEFERS delivery for minutes ("421 unusual rate of mail"),
 * so a code can be "sent" yet not in the inbox. This function lets the
 * app confirm real delivery (or surface the true deferral/bounce
 * reason) instead of showing a blind success message.
 *
 * Input  (POST JSON): { email: string, sinceMs: number }
 *   sinceMs — client timestamp taken just before the send; only
 *   messages from (sinceMs - 90s) onward are considered, capped to the
 *   last 20 minutes so the endpoint can't be used to mine history.
 * Output (200 JSON): { found, status, reason, at }
 *   status: "accepted" | "delayed" | "delivered" | "failed" | "unknown"
 *
 * Secrets: BREVO_API_KEY (project-wide, shared with send-email).
 */
import { summarizeBrevoEvents, type BrevoEventLike, type DeliverySummary } from "./mapper.ts";

const BREVO_BASE = "https://api.brevo.com/v3";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Lookback slack before sinceMs — absorbs client/server clock skew. */
const SKEW_MS = 90_000;
/** sinceMs may not be older than this — keeps the endpoint non-minable. */
const MAX_AGE_MS = 20 * 60_000;
const BREVO_TIMEOUT_MS = 8_000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "…";
  const visible = local.length > 3 ? `${local.slice(0, 2)}…${local.slice(-1)}` : `${local[0] ?? ""}…`;
  return `${visible}@${domain}`;
}

async function brevoGet(path: string, apiKey: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${BREVO_BASE}${path}`, {
      headers: { "api-key": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[email-status] Brevo GET ${path.split("?")[0]} → HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as unknown;
  } catch (err) {
    console.error(
      `[email-status] Brevo GET ${path.split("?")[0]} failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Events from the account-wide feed for this recipient since the cutoff. */
async function feedEvents(email: string, cutoffMs: number, apiKey: string): Promise<BrevoEventLike[]> {
  const data = (await brevoGet(
    `/smtp/statistics/events?email=${encodeURIComponent(email)}&days=1&sort=desc&limit=40`,
    apiKey,
  )) as { events?: BrevoEventLike[] } | null;
  const events = Array.isArray(data?.events) ? data.events : [];
  return events.filter((e) => {
    const t = Date.parse(e.date ?? e.time ?? "");
    return Number.isFinite(t) && t >= cutoffMs;
  });
}

/** Event history of the newest transactional message to this recipient since the cutoff. */
async function messageEvents(email: string, cutoffMs: number, apiKey: string): Promise<BrevoEventLike[]> {
  const list = (await brevoGet(
    `/smtp/emails?email=${encodeURIComponent(email)}&sort=desc&limit=10`,
    apiKey,
  )) as { transactionalEmails?: { uuid?: string; date?: string }[] } | null;
  const messages = Array.isArray(list?.transactionalEmails) ? list.transactionalEmails : [];
  const newest = messages.find((m) => {
    const t = Date.parse(m.date ?? "");
    return Number.isFinite(t) && t >= cutoffMs;
  });
  if (!newest?.uuid) return [];
  const detail = (await brevoGet(`/smtp/emails/${newest.uuid}`, apiKey)) as {
    events?: BrevoEventLike[];
  } | null;
  return Array.isArray(detail?.events) ? detail.events : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("BREVO_API_KEY") ?? "";
  if (!apiKey) {
    console.error("[email-status] BREVO_API_KEY secret is not configured");
    return json({ error: "Email status is not configured" }, 500);
  }

  let email = "";
  let sinceMs = 0;
  try {
    const body = (await req.json()) as { email?: unknown; sinceMs?: unknown };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    sinceMs = typeof body.sinceMs === "number" ? body.sinceMs : 0;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const now = Date.now();
  if (!EMAIL_REGEX.test(email)) return json({ error: "Invalid email" }, 400);
  if (!Number.isFinite(sinceMs) || sinceMs <= 0 || sinceMs > now + 120_000 || now - sinceMs > MAX_AGE_MS) {
    return json({ error: "sinceMs must be a recent timestamp" }, 400);
  }

  const cutoffMs = sinceMs - SKEW_MS;
  // Both sources in parallel: the per-message log is authoritative but
  // can lag; the events feed carries deferral/bounce reasons.
  const [fromFeed, fromMessage] = await Promise.all([
    feedEvents(email, cutoffMs, apiKey),
    messageEvents(email, cutoffMs, apiKey),
  ]);
  const events = [...fromMessage, ...fromFeed];
  const summary: DeliverySummary = summarizeBrevoEvents(events);
  const found = events.length > 0;

  console.log(
    `[email-status] ${maskEmail(email)} events=${events.length} status=${summary.status}${
      summary.reason ? ` reason=${summary.reason.slice(0, 120)}` : ""
    }`,
  );
  return json({ found, status: summary.status, reason: summary.reason, at: summary.at });
});
