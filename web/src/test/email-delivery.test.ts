/**
 * Delivery-status mapping used by the email-status Edge Function (and
 * therefore by every "was the verification email really delivered?"
 * message the app shows). These cases mirror REAL Brevo event
 * histories observed in this project's logs — including Gmail's
 * "421 unusual rate of mail" deferrals that made codes arrive late.
 */
import { describe, expect, it } from "vitest";
import {
  summarizeBrevoEvents,
  type BrevoEventLike,
} from "../../supabase/functions/email-status/mapper";

describe("summarizeBrevoEvents", () => {
  it("returns unknown for an empty history", () => {
    expect(summarizeBrevoEvents([]).status).toBe("unknown");
  });

  it("maps a Brevo-accepted send with no delivery receipt yet to accepted", () => {
    const events: BrevoEventLike[] = [{ event: "requests", date: "2026-07-21T01:21:45+02:00" }];
    expect(summarizeBrevoEvents(events).status).toBe("accepted");
  });

  it("maps a Gmail 421 deferral to delayed and keeps the provider reason", () => {
    const events: BrevoEventLike[] = [
      { event: "requests" },
      {
        event: "deferred",
        reason: "421-4.7.28 Gmail has detected an unusual rate of mail originating from your SPF",
      },
    ];
    const s = summarizeBrevoEvents(events);
    expect(s.status).toBe("delayed");
    expect(s.reason).toContain("421-4.7.28");
  });

  it("delivered outranks an earlier deferral (retry succeeded)", () => {
    const events: BrevoEventLike[] = [
      { event: "requests" },
      { event: "deferred", reason: "421 throttled" },
      { event: "delivered", date: "2026-07-21T01:21:46+02:00" },
    ];
    const s = summarizeBrevoEvents(events);
    expect(s.status).toBe("delivered");
    expect(s.at).toBe("2026-07-21T01:21:46+02:00");
  });

  it("treats an open as proof of delivery", () => {
    expect(summarizeBrevoEvents([{ event: "opened" }]).status).toBe("delivered");
  });

  it("maps a provider rejection to failed with the exact reason", () => {
    const events: BrevoEventLike[] = [
      { event: "requests" },
      {
        event: "error",
        reason: "Sending has been rejected because the sender you used is not valid",
      },
    ];
    const s = summarizeBrevoEvents(events);
    expect(s.status).toBe("failed");
    expect(s.reason).toContain("rejected");
  });

  it("maps hard bounces and blocks to failed", () => {
    expect(summarizeBrevoEvents([{ event: "hardBounces" }]).status).toBe("failed");
    expect(summarizeBrevoEvents([{ event: "blocked" }]).status).toBe("failed");
    expect(summarizeBrevoEvents([{ event: "invalid_email" }]).status).toBe("failed");
  });

  it("maps soft bounces to delayed", () => {
    expect(summarizeBrevoEvents([{ event: "soft_bounces" }]).status).toBe("delayed");
    expect(summarizeBrevoEvents([{ event: "softBounces" }]).status).toBe("delayed");
  });

  it("a delivery outranks an earlier error (the inbox got the message)", () => {
    const events: BrevoEventLike[] = [
      { event: "error", reason: "temporary failure" },
      { event: "delivered" },
    ];
    expect(summarizeBrevoEvents(events).status).toBe("delivered");
  });

  it("understands the per-message endpoint shape (name/time instead of event/date)", () => {
    const events: BrevoEventLike[] = [
      { name: "requests", time: "2026-07-21T01:21:45+02:00" },
      { name: "delivered", time: "2026-07-21T01:21:46+02:00" },
    ];
    const s = summarizeBrevoEvents(events);
    expect(s.status).toBe("delivered");
    expect(s.at).toBe("2026-07-21T01:21:46+02:00");
  });

  it("ignores unrecognised event names without crashing", () => {
    const events: BrevoEventLike[] = [{ event: "listAddition" }, { event: "requests" }];
    expect(summarizeBrevoEvents(events).status).toBe("accepted");
  });
});
