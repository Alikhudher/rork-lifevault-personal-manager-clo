/**
 * Server-backed account security flows.
 *
 * Everything here runs on an EPHEMERAL Supabase client (in-memory
 * session, never persisted) so the app's main cloud-backup session is
 * never replaced or signed out as a side effect. Three capabilities:
 *
 *  1. Email verification codes — a real 6-digit code is generated and
 *     emailed by Supabase Auth (`signInWithOtp`), then checked
 *     server-side (`verifyOtp`). Used by Forgot Password and by the
 *     email-change flow. Wrong or expired codes are rejected by the
 *     server, never by client-side guessing.
 *
 *  2. Server-side current-password verification — a real
 *     `signInWithPassword` attempt against Supabase Auth. Used before
 *     changing the cloud backup password so an incorrect current
 *     password can never be accepted.
 *
 *  3. Cloud identity alignment after a password reset — when the email
 *     has a cloud identity but NO encrypted backup yet, its auth
 *     password is aligned with the new account password so future
 *     cloud setup keeps working. An existing backup's password is
 *     never touched (it is a separate secret by design).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEphemeralClient, REQUEST_TIMEOUT_MS, withTimeout } from "@/lib/supabase";

export type RecoveryFailureCode =
  | "wrong_password"
  | "rate_limited"
  | "invalid_code"
  | "network"
  | "unavailable";

export type RecoveryResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code?: RecoveryFailureCode;
      /** Seconds the server asks to wait before another send (rate limits). */
      retryAfterS?: number;
    };

const NOT_CONFIGURED =
  "Email verification isn't available in this build — cloud services are not configured.";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}

function isRateLimit(msg: string): boolean {
  return /rate limit|too many|frequency|security purposes|after \d+ seconds/i.test(msg);
}

/**
 * Extracts the wait time from GoTrue's rate-limit message ("For
 * security purposes, you can only request this after N seconds.") so
 * the UI can restart its resend countdown with the server's number.
 */
export function parseRetryAfterSeconds(msg: string): number | undefined {
  const m = /after (\d+) seconds?/i.exec(msg);
  if (!m) return undefined;
  const s = Number.parseInt(m[1], 10);
  return Number.isFinite(s) && s > 0 && s <= 3600 ? s : undefined;
}

function isNetwork(msg: string): boolean {
  return /failed to fetch|network|fetch failed|load failed|timed out|aborted/i.test(msg);
}

/**
 * True when a message carries no human-readable information.
 * supabase-js stringifies body-less gateway responses (502/503/504)
 * into literally "{}" — that must never reach the user.
 */
function isMeaninglessMessage(msg: string): boolean {
  const t = msg.trim();
  return t === "" || t === "{}" || t === "[]" || t === "null" || t === "undefined" || t === "[object Object]";
}

/** Structured, always-readable view of a Supabase auth failure. */
export interface AuthErrorDetail {
  /** Human-readable description — never "{}", "[object Object]", or empty. */
  detail: string;
  status?: number;
  code?: string;
  /** True when the failure looks transient (gateway 5xx / retryable fetch). */
  transient: boolean;
}

/**
 * Extracts the most useful description from a Supabase auth error,
 * combining the server message with the HTTP status and error code.
 * Meaningless messages (empty body, "{}") are replaced with a clear
 * status-based description so the real failure is always visible.
 */
export function extractAuthErrorDetail(err: unknown): AuthErrorDetail {
  const e = (typeof err === "object" && err !== null ? err : {}) as {
    message?: unknown;
    status?: unknown;
    code?: unknown;
    name?: unknown;
  };
  const status = typeof e.status === "number" && e.status > 0 ? e.status : undefined;
  const code = typeof e.code === "string" && e.code.length > 0 ? e.code : undefined;
  const raw = typeof err === "string" ? err : typeof e.message === "string" ? e.message : "";
  const transient =
    (typeof e.name === "string" && e.name === "AuthRetryableFetchError") ||
    status === 502 ||
    status === 503 ||
    status === 504;
  const meta = [status !== undefined ? `HTTP ${status}` : null, code ?? null]
    .filter((part): part is string => part !== null)
    .join(", ");
  if (!isMeaninglessMessage(raw)) {
    return { detail: meta.length > 0 ? `${raw} (${meta})` : raw, status, code, transient };
  }
  return {
    detail:
      meta.length > 0
        ? `the request failed with ${meta} and an empty response body`
        : "the request failed with an empty response body",
    status,
    code,
    transient,
  };
}

/**
 * Maps a failed email-send attempt to a user-displayable message.
 * Exported so every email-sending surface (recovery flows, cloud
 * confirmation resend) reports identical, real server errors.
 */
export function describeSendFailure(
  err: unknown,
  emailKind: string = "verification email",
): { error: string; code?: RecoveryFailureCode; retryAfterS?: number } {
  const { detail, transient } = extractAuthErrorDetail(err);
  if (isRateLimit(detail)) {
    const retryAfterS = parseRetryAfterSeconds(detail);
    return {
      error: retryAfterS
        ? `Please wait ${retryAfterS} seconds before requesting another code — rapid repeat requests are blocked for security.`
        : `The email service refused to send: “${detail}”. The mailer allows only a few emails per hour — wait a bit, then try again.`,
      code: "rate_limited",
      retryAfterS,
    };
  }
  if (transient) {
    return {
      error: `The email service is temporarily unavailable (${detail}). Try again in a moment.`,
      code: "network",
    };
  }
  if (isNetwork(detail)) {
    return {
      error: "Couldn't reach the verification service. Check your internet connection and try again.",
      code: "network",
    };
  }
  return { error: `Couldn't send the ${emailKind} — the server said: “${detail}”.` };
}

/**
 * Send a 6-digit verification code to the given email. Creates a cloud
 * identity for brand-new emails so ownership can always be verified.
 *
 * Resend semantics (server-enforced by Supabase Auth): every call
 * generates a FRESH 6-digit code and INVALIDATES the previous one —
 * only the newest code verifies. Rapid repeats are refused with a
 * rate-limit error carrying `retryAfterS` for the UI countdown.
 */
export async function requestEmailCode(email: string): Promise<RecoveryResult> {
  const client = createEphemeralClient();
  if (!client) return { ok: false, error: NOT_CONFIGURED, code: "unavailable" };
  try {
    console.log("[AccountSecurity] Sending verification code");
    const { error } = await withTimeout(
      client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }),
      REQUEST_TIMEOUT_MS,
      "Sending the verification code",
    );
    if (error) {
      // Log the FULL error (message + HTTP status + error code) so the
      // real server failure is always diagnosable from the console.
      // Rate limits are an expected, self-resolving condition — warn
      // only, so dev overlays don't report them as app crashes.
      const d = extractAuthErrorDetail(error);
      const logPayload = JSON.stringify({
        message: error.message,
        status: d.status ?? null,
        code: d.code ?? null,
      });
      if (isRateLimit(d.detail)) {
        console.warn("[AccountSecurity] Code send rate-limited:", logPayload);
      } else {
        console.error("[AccountSecurity] Code send failed:", logPayload);
      }
      return { ok: false, ...describeSendFailure(error) };
    }
    console.log("[AccountSecurity] Verification code accepted by the mail server");
    return { ok: true };
  } catch (err) {
    console.error("[AccountSecurity] Code send threw:", messageOf(err));
    return { ok: false, ...describeSendFailure(err) };
  }
}

/** Handle to a successfully verified email session (kept in memory only). */
export interface VerifiedEmailSession {
  client: SupabaseClient;
  userId: string;
  email: string;
}

/**
 * Check a 6-digit code against the server. On success returns a session
 * handle that proves ownership of the email; always pass it to
 * `finishVerifiedSession` when the flow completes.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<{ ok: true; session: VerifiedEmailSession } | { ok: false; error: string; code?: RecoveryFailureCode }> {
  const client = createEphemeralClient();
  if (!client) return { ok: false, error: NOT_CONFIGURED, code: "unavailable" };
  try {
    const { data, error } = await withTimeout(
      client.auth.verifyOtp({ email, token: code.trim(), type: "email" }),
      REQUEST_TIMEOUT_MS,
      "Checking the verification code",
    );
    if (error || !data.session?.user) {
      const d = error ? extractAuthErrorDetail(error) : null;
      const msg = d?.detail ?? "No session returned";
      if (d && isRateLimit(d.detail)) {
        console.warn("[AccountSecurity] Code verification rate-limited:", msg);
        return { ok: false, error: describeSendFailure(error).error, code: "rate_limited" };
      }
      if (d && (d.transient || isNetwork(d.detail))) {
        console.error("[AccountSecurity] Code verification failed:", msg);
        return {
          ok: false,
          error: "Couldn't reach the verification service. Check your internet connection and try again.",
          code: "network",
        };
      }
      // A wrong or expired code is expected user input — the UI shows
      // inline guidance. Never console.error (dev overlays would report
      // it as an app-level runtime error).
      console.warn("[AccountSecurity] Code rejected (incorrect or expired):", msg);
      return {
        ok: false,
        error: "That code is incorrect or has expired. Check the latest email or resend a new code.",
        code: "invalid_code",
      };
    }
    console.log("[AccountSecurity] Email ownership verified");
    return {
      ok: true,
      session: { client, userId: data.session.user.id, email },
    };
  } catch (err) {
    const msg = messageOf(err);
    console.error("[AccountSecurity] Code verification threw:", msg);
    if (isNetwork(msg)) {
      return {
        ok: false,
        error: "Couldn't reach the verification service. Check your internet connection and try again.",
        code: "network",
      };
    }
    return { ok: false, error: `Couldn't check the code — ${extractAuthErrorDetail(err).detail}.` };
  }
}

/** Discard a verified email session (in-memory sign-out; never throws). */
export async function finishVerifiedSession(session: VerifiedEmailSession | null): Promise<void> {
  if (!session) return;
  try {
    await session.client.auth.signOut({ scope: "local" });
  } catch {
    // In-memory session — dropping the client reference is enough.
  }
}

/**
 * After a verified password reset: if this email's cloud identity has
 * no encrypted backup yet (no salt stored), align its auth password
 * with the new account password so the identity stays usable. A cloud
 * identity WITH an existing backup keeps its separate backup password
 * untouched. Best-effort — never blocks the reset.
 */
export async function alignCloudPasswordAfterReset(
  session: VerifiedEmailSession,
  newPassword: string,
): Promise<void> {
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        session.client.from("sync_state").select("salt").eq("user_id", session.userId).maybeSingle(),
      ),
      REQUEST_TIMEOUT_MS,
      "Checking cloud backup state",
    );
    if (error) {
      console.warn("[AccountSecurity] Salt check failed (skipping cloud alignment):", error.message);
      return;
    }
    const salt = (data as { salt: string | null } | null)?.salt ?? null;
    if (salt) {
      console.log("[AccountSecurity] Existing backup found — backup password left untouched");
      return;
    }
    const { error: updateErr } = await withTimeout(
      session.client.auth.updateUser({ password: newPassword }),
      REQUEST_TIMEOUT_MS,
      "Aligning the cloud identity password",
    );
    if (updateErr) {
      console.warn("[AccountSecurity] Cloud password alignment failed:", updateErr.message);
    } else {
      console.log("[AccountSecurity] Cloud identity password aligned with the new account password");
    }
  } catch (err) {
    console.warn("[AccountSecurity] Cloud alignment skipped:", messageOf(err));
  }
}

/**
 * Verify a password against the cloud account with a REAL server-side
 * sign-in attempt on an ephemeral client. The app's main session is
 * never touched. Returns `wrong_password` only when the server
 * explicitly rejects the credentials.
 */
export async function verifyCloudPassword(email: string, password: string): Promise<RecoveryResult> {
  const client = createEphemeralClient();
  if (!client) return { ok: false, error: NOT_CONFIGURED, code: "unavailable" };
  try {
    console.log("[AccountSecurity] Verifying current password with the server");
    const { error } = await withTimeout(
      client.auth.signInWithPassword({ email, password }),
      REQUEST_TIMEOUT_MS,
      "Verifying your current password",
    );
    if (error) {
      const msg = error.message;
      if (/invalid login credentials|invalid_credentials/i.test(msg)) {
        console.warn("[AccountSecurity] Server rejected the current password");
        return { ok: false, error: "Current password is incorrect.", code: "wrong_password" };
      }
      if (isRateLimit(msg)) {
        return {
          ok: false,
          error: "Too many attempts. Please wait a minute and try again.",
          code: "rate_limited",
        };
      }
      const d = extractAuthErrorDetail(error);
      console.error("[AccountSecurity] Password verification failed:", d.detail);
      return {
        ok: false,
        error:
          d.transient || isNetwork(d.detail)
            ? "Couldn't reach the cloud to verify your password. Check your internet connection and try again."
            : `Couldn't verify your password — the server said: “${d.detail}”.`,
        code: d.transient || isNetwork(d.detail) ? "network" : undefined,
      };
    }
    console.log("[AccountSecurity] Current password verified by the server");
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    return { ok: true };
  } catch (err) {
    const msg = messageOf(err);
    console.error("[AccountSecurity] Password verification threw:", msg);
    return {
      ok: false,
      error: isNetwork(msg)
        ? "Couldn't reach the cloud to verify your password. Check your internet connection and try again."
        : `Couldn't verify your password: ${msg}`,
      code: isNetwork(msg) ? "network" : undefined,
    };
  }
}
