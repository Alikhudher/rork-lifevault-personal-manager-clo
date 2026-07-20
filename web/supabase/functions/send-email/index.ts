/**
 * LifeVault auth email sender — Supabase Auth "Send Email" hook.
 *
 * WHY THIS EXISTS
 * Brevo rejects Supabase's SMTP servers with `525 5.7.1 Unauthorized
 * IP address` (Brevo IP-restricts SMTP relay logins, and Supabase Auth
 * sends from dynamic IPs that cannot be whitelisted). Brevo's HTTPS
 * API is key-authenticated and works from any IP, so Auth calls this
 * function for every email instead of SMTP and the function delivers
 * through the API.
 *
 * DIAGNOSABILITY (the reason emails failed silently before)
 * - The full Brevo response (HTTP status + body) is logged on every send.
 * - Failures are returned to Auth as a real, human-readable message —
 *   never an empty body — so the app can surface the true cause.
 *
 * Secrets (Edge Function secrets, set via the Management API):
 * - SEND_EMAIL_HOOK_SECRET  "v1,whsec_<base64>" shared with Auth
 * - BREVO_API_KEY           Brevo HTTPS API key ("xkeysib-…")
 * - MAIL_SENDER_EMAIL       verified Brevo sender address
 * - MAIL_SENDER_NAME        display name (defaults to "LifeVault")
 */
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

interface HookUser {
  email: string;
}

interface HookEmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new: string;
  token_hash_new: string;
}

interface HookPayload {
  user: HookUser;
  email_data: HookEmailData;
}

/** Masks an email for logs: "alikhudher25@gmail.com" → "al…5@gmail.com". */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "…";
  const visible = local.length > 3 ? `${local.slice(0, 2)}…${local.slice(-1)}` : `${local[0] ?? ""}…`;
  return `${visible}@${domain}`;
}

/* ------------------------------------------------------------------ */
/* LifeVault-branded HTML (mirrors the previous Auth templates)        */
/* ------------------------------------------------------------------ */

function card(inner: string): string {
  return `<div style='background:#f4f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif'><div style='max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 28px'><p style='margin:0;font-size:20px;font-weight:800;color:#111827'>LifeVault</p>${inner}</div></div>`;
}

function lead(text: string): string {
  return `<p style='margin:16px 0 0;font-size:15px;color:#374151'>${text}</p>`;
}

function codeBlock(token: string): string {
  return `<p style='margin:18px 0;font-size:36px;font-weight:800;letter-spacing:8px;color:#111827;text-align:center'>${token}</p>`;
}

function note(text: string): string {
  return `<p style='margin:0;font-size:13px;color:#6b7280'>${text}</p>`;
}

function button(url: string, label: string): string {
  return `<a href='${url}' style='display:block;background:#111827;color:#ffffff;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:14px 0;border-radius:12px'>${label}</a>`;
}

/** GoTrue verify link for link-based actions (confirm email, invites). */
function verifyUrl(data: HookEmailData, tokenHash: string): string {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const params = new URLSearchParams({
    token: tokenHash,
    type: data.email_action_type,
    redirect_to: data.redirect_to || data.site_url || "",
  });
  return `${base}/auth/v1/verify?${params.toString()}`;
}

/**
 * Every email carries BOTH an HTML and a plain-text part — multipart
 * messages score measurably better with Gmail's spam/deferral filters
 * than HTML-only mail (relevant here because the sender is a personal
 * gmail.com address, which Gmail already treats with suspicion when
 * relayed through Brevo).
 */
function buildEmail(data: HookEmailData): { subject: string; html: string; text: string } {
  const expiry = note(
    "The code expires in 60 minutes. If you didn&#8217;t request it, you can safely ignore this email.",
  );
  const expiryText = "The code expires in 60 minutes. If you didn't request it, you can safely ignore this email.";
  switch (data.email_action_type) {
    case "signup":
      return {
        subject: "Confirm your LifeVault email",
        html: card(
          lead("Confirm this email address to activate cloud backup.") +
            `<p style='margin:18px 0 6px;font-size:13px;color:#6b7280'>If the app asks for a code, enter:</p>` +
            codeBlock(data.token) +
            button(verifyUrl(data, data.token_hash), "Confirm email") +
            `<p style='margin:18px 0 0;font-size:13px;color:#6b7280'>The code and link expire in 60 minutes. If you didn&#8217;t request this, you can safely ignore this email.</p>`,
        ),
        text: `LifeVault\n\nConfirm this email address to activate cloud backup.\n\nIf the app asks for a code, enter: ${data.token}\n\nOr confirm via this link:\n${verifyUrl(data, data.token_hash)}\n\n${expiryText}`,
      };
    case "recovery":
      return {
        subject: "Your LifeVault password reset code",
        html: card(
          lead("Enter this code to reset your password:") +
            codeBlock(data.token) +
            note(
              "The code expires in 60 minutes. If you didn&#8217;t request a reset, you can safely ignore this email &#8212; your password stays unchanged.",
            ),
        ),
        text: `LifeVault\n\nEnter this code to reset your password: ${data.token}\n\nThe code expires in 60 minutes. If you didn't request a reset, you can safely ignore this email — your password stays unchanged.`,
      };
    case "invite":
      return {
        subject: "You've been invited to LifeVault",
        html: card(
          lead("You&#8217;ve been invited to LifeVault. Accept the invitation below.") +
            `<div style='height:18px'></div>` +
            button(verifyUrl(data, data.token_hash), "Accept invitation") +
            `<div style='height:18px'></div>` +
            expiry,
        ),
        text: `LifeVault\n\nYou've been invited to LifeVault. Accept the invitation:\n${verifyUrl(data, data.token_hash)}\n\n${expiryText}`,
      };
    case "reauthentication":
      return {
        subject: `${data.token} is your LifeVault verification code`,
        html: card(lead("Enter this code to verify your identity:") + codeBlock(data.token) + expiry),
        text: `LifeVault\n\nEnter this code to verify your identity: ${data.token}\n\n${expiryText}`,
      };
    case "email_change":
    case "email_change_current":
    case "email_change_new": {
      const token = data.email_action_type === "email_change_new" && data.token_new ? data.token_new : data.token;
      return {
        subject: "Confirm your new email address",
        html: card(
          lead("Confirm the change to your LifeVault email address with this code:") + codeBlock(token) + expiry,
        ),
        text: `LifeVault\n\nConfirm the change to your LifeVault email address with this code: ${token}\n\n${expiryText}`,
      };
    }
    // "magiclink" — also the safe default for any future action type.
    default:
      return {
        subject: "Your LifeVault verification code",
        html: card(lead("Enter this verification code in the app:") + codeBlock(data.token) + expiry),
        text: `LifeVault\n\nEnter this verification code in the app: ${data.token}\n\n${expiryText}`,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Brevo HTTPS API delivery                                            */
/* ------------------------------------------------------------------ */

type SendResult = { ok: true; messageId: string } | { ok: false; status: number; body: string };

async function sendViaBrevo(
  to: string,
  subject: string,
  html: string,
  text: string,
  action: string,
): Promise<SendResult> {
  const apiKey = Deno.env.get("BREVO_API_KEY") ?? "";
  const senderEmail = Deno.env.get("MAIL_SENDER_EMAIL") ?? "";
  const senderName = Deno.env.get("MAIL_SENDER_NAME") ?? "LifeVault";
  if (!apiKey || !senderEmail) {
    return { ok: false, status: 0, body: "BREVO_API_KEY or MAIL_SENDER_EMAIL secret is not configured" };
  }
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
      // Tags make every auth email identifiable in Brevo's logs by flow.
      tags: ["lifevault-auth", action.replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "unknown"],
    }),
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body };
  let messageId = "unknown";
  try {
    const parsed = JSON.parse(body) as { messageId?: string };
    if (typeof parsed.messageId === "string") messageId = parsed.messageId;
  } catch {
    // Body was not JSON — keep "unknown"; the raw body is logged anyway.
  }
  return { ok: true, messageId };
}

/**
 * Auth-hook error contract: GoTrue only READS the response body when the
 * HTTP status is 200/202 — an `error` object inside a 200 body is
 * propagated verbatim to the original client. Any 4xx/5xx status makes
 * GoTrue discard the body and return a generic message ("Invalid
 * payload sent to hook", "Unexpected status code…"), hiding the cause.
 */
function errorResponse(httpCode: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const secret = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace("v1,whsec_", "");
  if (!secret) {
    console.error("[send-email] SEND_EMAIL_HOOK_SECRET is not configured");
    return errorResponse(500, "Email hook secret is not configured");
  }

  let data: HookPayload;
  try {
    const wh = new Webhook(secret);
    data = wh.verify(payload, headers) as HookPayload;
  } catch (err) {
    console.error(
      "[send-email] Webhook signature verification failed:",
      err instanceof Error ? err.message : String(err),
    );
    return errorResponse(401, "Invalid webhook signature");
  }

  const recipient = data.user?.email ?? "";
  const action = data.email_data?.email_action_type ?? "unknown";
  if (!recipient || !data.email_data) {
    console.error(`[send-email] Payload missing recipient or email_data (action=${action})`);
    return errorResponse(400, "Hook payload has no recipient email");
  }

  console.log(`[send-email] Sending action=${action} to=${maskEmail(recipient)}`);
  const { subject, html, text } = buildEmail(data.email_data);
  const result = await sendViaBrevo(recipient, subject, html, text, action);

  if (!result.ok) {
    // Log the FULL Brevo response and return the real reason to Auth.
    console.error(`[send-email] Brevo REJECTED the send: HTTP ${result.status} body=${result.body}`);
    let reason = result.body;
    try {
      const parsed = JSON.parse(result.body) as { message?: string };
      if (typeof parsed.message === "string" && parsed.message.length > 0) reason = parsed.message;
    } catch {
      // Keep the raw body.
    }
    return errorResponse(400, `The email provider (Brevo) rejected the send: ${reason}`);
  }

  console.log(`[send-email] Brevo accepted action=${action} to=${maskEmail(recipient)} messageId=${result.messageId}`);
  return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
});
