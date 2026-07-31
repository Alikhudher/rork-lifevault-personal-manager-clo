/**
 * Direct OTP fallback for LifeVault signup / password reset.
 *
 * WHY THIS EXISTS
 * Supabase Auth's built-in "Send Email" hook must be configured in the
 * Supabase dashboard to point at the `send-email` Edge Function. If the
 * hook is not configured, or if Brevo rejects the hook's send,
 * `signInWithOtp` can return 200 while the user never receives a code.
 * This function is a fallback that:
 *   1. Generates a short-lived 6-digit code.
 *   2. Stores the SHA-256 hash in `direct_otp_codes`.
 *   3. Sends the code directly through Brevo's HTTPS API.
 *   4. Verifies the code server-side.
 *   5. On success, creates or locates the Supabase Auth user and returns
 *      temporary credentials so the app can sign in and immediately set the
 *      user's chosen password.
 *
 * Endpoints (POST JSON):
 *   { action: "send", email, actionType: "signup" | "recovery" }
 *   { action: "verify", email, code, actionType: "signup" | "recovery" }
 *
 * Secrets: BREVO_API_KEY, MAIL_SENDER_EMAIL, MAIL_SENDER_NAME, SUPABASE_URL,
 *          SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SendPayload {
  action: "send";
  email: string;
  actionType: "signup" | "recovery";
}

interface VerifyPayload {
  action: "verify";
  email: string;
  code: string;
  actionType: "signup" | "recovery";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function error(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "…";
  const visible = local.length > 3 ? `${local.slice(0, 2)}…${local.slice(-1)}` : `${local[0] ?? ""}…`;
  return `${visible}@${domain}`;
}

function randomSixDigit(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String((arr[0] % 900000) + 100000);
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function card(inner: string): string {
  return `<div style='background:#f4f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif'><div style='max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 28px'><p style='margin:0;font-size:20px;font-weight:800;color:#111827'>LifeVault</p>${inner}</div></div>`;
}

function lead(text: string): string {
  return `<p style='margin:16px 0 0;font-size:15px;color:#374151'>${text}</p>`;
}

function codeBlock(token: string): string {
  return `<p style='margin:18px 0;font-size:36px;font-weight:800;letter-spacing:8px;color:#111827;text-align:center'>${token}</p>`;
}

function expiryNote(): string {
  return "The code expires in 10 minutes. Only the newest code works — requesting another cancels this one. If you didn’t request it, you can safely ignore this email.";
}

function buildEmail(code: string, actionType: "signup" | "recovery"): { subject: string; html: string; text: string } {
  const expiry = expiryNote();
  if (actionType === "recovery") {
    return {
      subject: `${code} is your LifeVault password reset code`,
      html: card(
        lead("Enter this code to reset your LifeVault password:") +
          codeBlock(code) +
          `<p style='margin:0;font-size:13px;color:#6b7280'>${expiry}</p>`,
      ),
      text: `LifeVault\n\nEnter this code to reset your password: ${code}\n\n${expiry}`,
    };
  }
  return {
    subject: `${code} — confirm your LifeVault email`,
    html: card(
      lead("Confirm this email address to activate your LifeVault account.") +
        `<p style='margin:18px 0 6px;font-size:13px;color:#6b7280'>Enter this code in the app:</p>` +
        codeBlock(code) +
        `<p style='margin:18px 0 0;font-size:13px;color:#6b7280'>${expiry}</p>`,
    ),
    text: `LifeVault\n\nConfirm this email address to activate your LifeVault account.\n\nEnter this code in the app: ${code}\n\n${expiry}`,
  };
}

async function sendViaBrevo(to: string, code: string, actionType: "signup" | "recovery"): Promise<{ ok: true } | { ok: false; reason: string }> {
  const apiKey = Deno.env.get("BREVO_API_KEY") ?? "";
  const senderEmail = Deno.env.get("MAIL_SENDER_EMAIL") ?? "";
  const senderName = Deno.env.get("MAIL_SENDER_NAME") ?? "LifeVault";
  if (!apiKey || !senderEmail) {
    return { ok: false, reason: "Brevo email credentials are not configured on the server." };
  }
  const { subject, html, text } = buildEmail(code, actionType);
  const res = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      replyTo: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
      tags: ["lifevault-direct-otp", actionType],
    }),
  });
  if (!res.ok) {
    let reason = `Brevo returned HTTP ${res.status}`;
    try {
      const body = await res.json() as { message?: string };
      if (body.message) reason = body.message;
    } catch {
      const body = await res.text();
      if (body) reason = body.slice(0, 200);
    }
    return { ok: false, reason };
  }
  return { ok: true };
}

function getAdminClient(): { client: ReturnType<typeof createClient>; missing: string[] } | null {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  try {
    return {
      client: createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }),
      missing: [],
    };
  } catch {
    return null;
  }
}

async function handleSend(body: SendPayload): Promise<Response> {
  const email = (body.email ?? "").trim().toLowerCase();
  const actionType = body.actionType === "recovery" ? "recovery" : "signup";
  if (!EMAIL_REGEX.test(email)) {
    return error("Enter a valid email address.");
  }

  const admin = getAdminClient();
  if (!admin) {
    return error("Direct OTP fallback is not configured on the server (missing Supabase service role).", 500);
  }

  const code = randomSixDigit();
  const codeHash = await sha256(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

  const { error: insertErr } = await admin.client
    .from("direct_otp_codes")
    .insert({ email, action: actionType, code_hash: codeHash, expires_at: expiresAt });

  if (insertErr) {
    console.error("[otp] Failed to store OTP code:", insertErr.message);
    return error("Couldn't store the verification code. Please try again.", 500);
  }

  console.log(`[otp] Sending direct ${actionType} OTP to ${maskEmail(email)}`);
  const result = await sendViaBrevo(email, code, actionType);
  if (!result.ok) {
    console.error("[otp] Brevo send failed:", result.reason);
    return error(`Couldn't send the verification email: ${result.reason}`);
  }

  console.log(`[otp] Direct ${actionType} OTP accepted by Brevo for ${maskEmail(email)}`);
  return json({ ok: true });
}

async function handleVerify(body: VerifyPayload): Promise<Response> {
  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();
  const actionType = body.actionType === "recovery" ? "recovery" : "signup";
  if (!EMAIL_REGEX.test(email)) return error("Enter a valid email address.");
  if (!/^\d{6}$/.test(code)) return error("Enter the 6-digit code from the email.");

  const admin = getAdminClient();
  if (!admin) {
    return error("Direct OTP fallback is not configured on the server.", 500);
  }

  // Fetch the newest unexpired code for this email.
  const { data: rows, error: fetchErr } = await admin.client
    .from("direct_otp_codes")
    .select("id, code_hash, attempts, used, expires_at")
    .eq("email", email)
    .eq("action", actionType)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  if (fetchErr) {
    console.error("[otp] Failed to read OTP code:", fetchErr.message);
    return error("Couldn't verify the code. Please try again.", 500);
  }
  const row = (rows ?? [])[0];
  if (!row || row.used) {
    return error("That code is incorrect or has expired. Request a new code.");
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await admin.client.from("direct_otp_codes").update({ used: true }).eq("id", row.id);
    return error("Too many incorrect attempts. Request a new code.");
  }

  // Increment attempts first.
  await admin.client.from("direct_otp_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);

  const hash = await sha256(code);
  if (hash !== row.code_hash) {
    return error("That code is incorrect. Check the latest email and try again.");
  }

  // Mark as used and resolve the auth user.
  await admin.client.from("direct_otp_codes").update({ used: true }).eq("id", row.id);

  const { data: userList } = await admin.client.auth.admin.listUsers();
  const existing = (userList?.users ?? []).find((u) => u.email?.toLowerCase() === email);

  let tempPassword: string;
  if (!existing) {
    // Create a new user with a random temporary password.
    tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 24) + "A1!";
    const { error: createErr } = await admin.client.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });
    if (createErr) {
      console.error("[otp] Failed to create user:", createErr.message);
      return error("Couldn't create your account. Please try again.", 500);
    }
  } else {
    // For both recovery and signup, reset the existing user's password to a
    // random temporary password. In the signup flow this only happens when the
    // primary Supabase Auth send already created the user but the email was not
    // delivered; the app immediately replaces this temporary password with the
    // user's chosen password.
    tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 24) + "A1!";
    const { error: updateErr } = await admin.client.auth.admin.updateUserById(existing.id, {
      password: tempPassword,
      email_confirm: true,
    });
    if (updateErr) {
      console.error("[otp] Failed to reset password:", updateErr.message);
      return error("Couldn't reset your password. Please try again.", 500);
    }
  }

  console.log(`[otp] Direct ${actionType} verified for ${maskEmail(email)}`);
  return json({ ok: true, tempPassword });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return error("Method not allowed", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || !("action" in body)) {
    return error("Missing action field");
  }

  const payload = body as { action: string };
  if (payload.action === "send") {
    return handleSend(payload as unknown as SendPayload);
  }
  if (payload.action === "verify") {
    return handleVerify(payload as unknown as VerifyPayload);
  }
  return error("Unknown action");
});
