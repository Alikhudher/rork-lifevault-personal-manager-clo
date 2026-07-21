/**
 * Regression tests for auth error surfacing.
 *
 * supabase-js stringifies body-less gateway responses (502/503/504)
 * into literally "{}" — the app once showed "the server said: {}".
 * These tests pin the guarantee that a real, readable description
 * (message + HTTP status + error code) is always produced instead.
 */
import { describe, expect, it } from "vitest";

import {
  describeSendFailure,
  extractAuthErrorDetail,
  parseRetryAfterSeconds,
} from "@/lib/account-recovery";

/** Mirrors supabase-js AuthRetryableFetchError (gateway 5xx → message "{}"). */
class RetryableFetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthRetryableFetchError";
    this.status = status;
  }
}

/** Mirrors supabase-js AuthApiError (real GoTrue error bodies). */
class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

describe("extractAuthErrorDetail", () => {
  it("never surfaces '{}' from body-less gateway errors", () => {
    const detail = extractAuthErrorDetail(new RetryableFetchError("{}", 502));
    expect(detail.detail).not.toContain("{}");
    expect(detail.detail).toContain("HTTP 502");
    expect(detail.transient).toBe(true);
    expect(detail.status).toBe(502);
  });

  it("keeps real server messages and appends status + error code", () => {
    const detail = extractAuthErrorDetail(
      new ApiError("Error sending magic link email", 500, "unexpected_failure"),
    );
    expect(detail.detail).toContain("Error sending magic link email");
    expect(detail.detail).toContain("HTTP 500");
    expect(detail.detail).toContain("unexpected_failure");
    expect(detail.transient).toBe(false);
  });

  it("describes empty errors without any metadata", () => {
    const detail = extractAuthErrorDetail(new Error(""));
    expect(detail.detail.length).toBeGreaterThan(0);
    expect(detail.detail).toContain("empty response");
  });

  it("flags AuthRetryableFetchError as transient even without a status", () => {
    const err = new Error("{}");
    err.name = "AuthRetryableFetchError";
    const detail = extractAuthErrorDetail(err);
    expect(detail.transient).toBe(true);
    expect(detail.detail).not.toContain("{}");
  });
});

describe("parseRetryAfterSeconds", () => {
  it("extracts the server's wait time from GoTrue rate-limit messages", () => {
    expect(
      parseRetryAfterSeconds("For security purposes, you can only request this after 27 seconds."),
    ).toBe(27);
  });

  it("returns undefined when no wait time is present", () => {
    expect(parseRetryAfterSeconds("email rate limit exceeded")).toBeUndefined();
  });

  it("rejects absurd values", () => {
    expect(parseRetryAfterSeconds("after 999999 seconds")).toBeUndefined();
  });
});

describe("describeSendFailure", () => {
  it("maps rate limits to rate_limited and carries the retry-after seconds", () => {
    const r = describeSendFailure(
      new ApiError(
        "For security purposes, you can only request this after 15 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    );
    expect(r.code).toBe("rate_limited");
    expect(r.retryAfterS).toBe(15);
    expect(r.error).toContain("15 seconds");
  });

  it("maps hourly rate limits without a wait time to rate_limited", () => {
    const r = describeSendFailure(
      new ApiError("email rate limit exceeded", 429, "over_email_send_rate_limit"),
    );
    expect(r.code).toBe("rate_limited");
    expect(r.retryAfterS).toBeUndefined();
  });

  it("maps transient gateway failures to a retry message instead of '{}'", () => {
    const r = describeSendFailure(new RetryableFetchError("{}", 503));
    expect(r.code).toBe("network");
    expect(r.error).not.toContain("{}");
    expect(r.error.toLowerCase()).toContain("temporarily unavailable");
  });

  it("maps fetch failures to a network message", () => {
    const r = describeSendFailure(new TypeError("Failed to fetch"));
    expect(r.code).toBe("network");
  });

  it("surfaces the real server error for hard failures, with the email kind", () => {
    const r = describeSendFailure(
      new ApiError("Brevo rejected the email (HTTP 401): Key not found", 500, "unexpected_failure"),
      "confirmation email",
    );
    expect(r.code).toBeUndefined();
    expect(r.error).toContain("confirmation email");
    expect(r.error).toContain("Brevo rejected the email");
    expect(r.error).toContain("HTTP 500");
  });
});
