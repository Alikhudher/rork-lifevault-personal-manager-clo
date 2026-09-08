/**
 * Free-tier contract tests.
 *
 * Lock in the product promise: the free plan is genuinely useful and
 * essential basics are NEVER paywalled.
 *
 *  - Free includes unlimited document/expense/subscription/payment/bill/
 *    appointment management (no caps in FREE_TIER_LIMITS).
 *  - Free includes 3 AI scans/month and 25-item cloud backup.
 *  - Free includes sharing individual documents (unlimited) and up to 10
 *    documents together in one bulk share.
 *  - Premium is about unlimited usage, AI, cloud sync and advanced bulk
 *    tools — NOT about locking basics. "Share & export documents" must
 *    never appear as a Premium perk.
 *  - Combined PDF/ZIP bulk export is NOT advertised until implemented.
 */
import { describe, it, expect } from "vitest";
import {
  FREE_TIER_LIMITS,
  FREE_FEATURE_FLAGS,
  PREMIUM_PERKS,
  FREE_FEATURES,
  isFeatureAvailable,
  type PremiumFeature,
} from "../lib/premium";

describe("FREE_TIER_LIMITS", () => {
  it("keeps the promised AI scan and cloud backup limits", () => {
    expect(FREE_TIER_LIMITS.monthlyAiScans).toBe(3);
    expect(FREE_TIER_LIMITS.cloudBackupItems).toBe(25);
  });

  it("allows bulk-sharing exactly 10 documents together on the free plan", () => {
    expect(FREE_TIER_LIMITS.multiShareDocuments).toBe(10);
  });

  it("has NO caps on essential basic management features", () => {
    const keys = Object.keys(FREE_TIER_LIMITS) as Array<keyof typeof FREE_TIER_LIMITS>;
    expect(keys).not.toContain("maxDocuments");
    expect(keys).not.toContain("maxExpenses");
    expect(keys).not.toContain("maxSubscriptions");
    expect(keys).not.toContain("maxAppointments");
  });
});

describe("Premium perk list", () => {
  it("never advertises sharing/exporting as a Premium perk — sharing is free", () => {
    const titles = PREMIUM_PERKS.map((p) => p.title.toLowerCase());
    expect(titles.some((t) => t.includes("share") || t.includes("export"))).toBe(false);
  });

  it("does not advertise combined PDF/ZIP bulk export until it is implemented", () => {
    const all = PREMIUM_PERKS.map((p) => `${p.title} ${p.description}`.toLowerCase());
    expect(all.some((t) => t.includes("pdf") || t.includes("zip"))).toBe(false);
  });

  it("covers unlimited scans, unlimited backup, AI Assistant and AI search", () => {
    const titles = PREMIUM_PERKS.map((p) => p.title.toLowerCase());
    expect(titles.some((t) => t.includes("unlimited ai scans"))).toBe(true);
    expect(titles.some((t) => t.includes("unlimited cloud backup"))).toBe(true);
    expect(titles.some((t) => t.includes("ai assistant"))).toBe(true);
    expect(titles.some((t) => t.includes("ai search"))).toBe(true);
  });
});

describe("Free feature list (shown on the Premium screen)", () => {
  it("highlights free document sharing (individual + up to 10 together)", () => {
    const sharing = FREE_FEATURES.find((f) => f.title === "Document sharing");
    expect(sharing).toBeDefined();
    expect(sharing!.description.toLowerCase()).toContain("10");
  });

  it("highlights free exact appointment reminders", () => {
    const reminders = FREE_FEATURES.find((f) => f.title === "Appointment reminders");
    expect(reminders).toBeDefined();
  });

  it("highlights 3 AI scans/month and 25-item cloud backup", () => {
    const scans = FREE_FEATURES.find((f) => f.title === "AI scanning");
    const backup = FREE_FEATURES.find((f) => f.title === "Cloud backup");
    expect(scans!.description).toContain("3");
    expect(backup!.description).toContain("25");
  });
});

describe("Feature flags", () => {
  it("gates AI/backup/assistant behind Premium on native", () => {
    const gated: PremiumFeature[] = ["unlimitedScans", "unlimitedCloudBackup", "aiAssistant"];
    for (const feature of gated) {
      expect(isFeatureAvailable(feature, false)).toBe(false);
      expect(isFeatureAvailable(feature, true)).toBe(true);
      expect(FREE_FEATURE_FLAGS[feature]).toBe(false);
    }
  });
});
