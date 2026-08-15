/**
 * Client-side fallback for Supabase Auth email OTP delivery failures.
 *
 * When the production "Send Email" hook is not configured or Brevo rejects
 * the hook's send, the app's primary `signInWithOtp` path may return a
 * success response while the user never receives the code. This module calls
 * the `otp` Edge Function directly to generate, send, and verify a code via
 * Brevo's HTTPS API. On verification, the Edge Function returns temporary
 * sign-in credentials so the app can obtain a real Supabase Auth session and
 * immediately replace the temporary password with the user's chosen password.
 */
import { getSupabase, withTimeout } from "@/lib/supabase";

const OTP_FN_NAME = "otp";
const OTP_TIMEOUT_MS = 20_000;

export type DirectOtpAction = "signup" | "recovery";

export interface DirectOtpSendResult {
  ok: true;
}

export interface DirectOtpVerifyResult {
  ok: true;
  tempPassword: string;
}

export interface DirectOtpError {
  ok: false;
  error: string;
}

export type DirectOtpSendResponse = DirectOtpSendResult | DirectOtpError;
export type DirectOtpVerifyResponse = DirectOtpVerifyResult | DirectOtpError;

function describeInvokeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "The direct email fallback failed. Please try again.";
}

async function invokeOtp<T>(body: Record<string, unknown>): Promise<T | DirectOtpError> {
  const sb = getSupabase();
  if (!sb) {
    return { ok: false, error: "Cloud services are not configured in this build." };
  }
  try {
    const { data, error } = await withTimeout(
      sb.functions.invoke(OTP_FN_NAME, { body }),
      OTP_TIMEOUT_MS,
      "Sending the verification code (fallback)",
    );
    if (error) {
      console.warn("[DirectOTP] Edge function error:", error);
      return { ok: false, error: describeInvokeError(error) };
    }
    if (!data || typeof data !== "object") {
      return { ok: false, error: "The fallback email service returned an empty response." };
    }
    return data as T;
  } catch (err) {
    console.warn("[DirectOTP] Invoke threw:", err);
    return { ok: false, error: describeInvokeError(err) };
  }
}

export async function sendDirectOtp(email: string, actionType: DirectOtpAction): Promise<DirectOtpSendResponse> {
  const result = await invokeOtp<DirectOtpSendResult>({ action: "send", email, actionType });
  if (result.ok === false) return result;
  return { ok: true };
}

export async function verifyDirectOtp(
  email: string,
  code: string,
  actionType: DirectOtpAction,
): Promise<DirectOtpVerifyResponse> {
  const result = await invokeOtp<DirectOtpVerifyResult>({ action: "verify", email, code, actionType });
  if (result.ok === false) {
    // Log the real backend error for diagnostics, but return a user-friendly
    // message — raw errors like "Edge Function returned a non-2xx status code"
    // must never reach the UI.
    console.warn("[DirectOTP] Verification failed:", result.error);
    return { ok: false, error: "Incorrect or expired verification code. Please try again." };
  }
  if (typeof result.tempPassword === "string") {
    return { ok: true, tempPassword: result.tempPassword };
  }
  return { ok: false, error: "Incorrect or expired verification code. Please try again." };
}
