/**
 * Sends a brand-new verification code to BOTH user addresses through the
 * app's exact flow (Supabase signInWithOtp → send-email Edge Function →
 * Brevo HTTPS API), then queries Brevo's transactional log for the exact
 * messageId, timestamp, and subject for each recipient.
 *
 * Usage: BREVO_API_KEY=... VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
 *        bun run web/scripts/send-fresh-code.ts
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const BREVO_KEY = process.env.BREVO_API_KEY!;

const RECIPIENTS = ["alikhudher20@gmail.com", "alikhudher25@gmail.com"];

interface SendResult {
  email: string;
  ok: boolean;
  status: number;
  body: string;
  at: string;
}

async function triggerOtp(email: string): Promise<SendResult> {
  const at = new Date().toISOString();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, create_user: true }),
  });
  const body = await res.text();
  return { email, ok: res.ok, status: res.status, body, at };
}

interface BrevoMessage {
  uuid: string;
  messageId: string;
  date: string;
  subject: string;
  from: string;
  to: string[];
  event: string;
  reason: string;
  tag: string;
}

async function fetchBrevoLog(email: string, days: number = 1): Promise<BrevoMessage[]> {
  const params = new URLSearchParams({
    limit: "50",
    offset: "0",
    days: String(days),
    sort: "desc",
  });
  if (email) params.set("email", email);
  const url = `https://api.brevo.com/v3/smtp/emails?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "api-key": BREVO_KEY, accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`Brevo log fetch failed for ${email}: HTTP ${res.status} ${await res.text()}`);
    return [];
  }
  const json = (await res.json()) as { transactionalEmails?: BrevoMessage[] };
  return json.transactionalEmails ?? [];
}

async function main() {
  if (!SUPABASE_URL || !ANON_KEY || !BREVO_KEY) {
    console.error("Missing env vars. Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, BREVO_API_KEY.");
    process.exit(1);
  }
  console.log("=== Sending fresh verification codes via the app's exact flow ===\n");
  const start = new Date();

  const results: SendResult[] = [];
  for (const email of RECIPIENTS) {
    const r = await triggerOtp(email);
    results.push(r);
    console.log(`[${r.email}] signInWithOtp -> HTTP ${r.status} at ${r.at}`);
    if (r.body) console.log(`  body: ${r.body.slice(0, 300)}`);
  }

  console.log("\nWaiting 10s for Brevo to register the sends...");
  await new Promise((r) => setTimeout(r, 10_000));

  console.log("\n=== Pulling exact message details from Brevo (per recipient) ===\n");
  for (const email of RECIPIENTS) {
    const logs = await fetchBrevoLog(email, 1);
    const fresh = logs.filter((m) => new Date(m.date) >= new Date(start.getTime() - 120_000));
    console.log(`--- ${email} ---`);
    if (fresh.length === 0) {
      console.log("  No fresh messages found since the send. All recent for this recipient:");
      for (const m of logs.slice(0, 8)) {
        console.log(
          `  • ${m.date} | id=${m.messageId} | subject="${m.subject}" | to=${(m.to || []).join(",")} | event=${m.event} | reason=${m.reason || "-"}`,
        );
      }
    } else {
      for (const m of fresh) {
        console.log(`  RECIPIENT:  ${email}`);
        console.log(`  SEND TIME:  ${m.date}`);
        console.log(`  MESSAGE ID: ${m.messageId}`);
        console.log(`  SUBJECT:    ${m.subject}`);
        console.log(`  EVENT:      ${m.event}`);
        console.log(`  REASON:     ${m.reason || "-"}`);
        console.log(`  UUID:       ${m.uuid}`);
        console.log("");
      }
    }
    console.log("");
  }

  console.log("=== Raw recent Brevo transactional log (last 15, all recipients) ===");
  const all = await fetchBrevoLog("", 1);
  for (const m of all.slice(0, 15)) {
    console.log(
      `  ${m.date} | to=${(m.to || []).join(",")} | id=${m.messageId} | subject="${m.subject}" | event=${m.event} | reason=${m.reason || "-"}`,
    );
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
