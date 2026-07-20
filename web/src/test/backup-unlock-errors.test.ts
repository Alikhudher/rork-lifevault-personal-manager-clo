/**
 * Regression tests for Cloud Backup unlock error surfacing.
 *
 * Supabase Auth deliberately returns the SAME invalid-credentials error
 * for "no such account" and "wrong password". The app once mapped both
 * to a misleading "Incorrect email or backup password" — even when no
 * backup existed for the entered email at all. These tests pin the
 * guarantee that the server-side backup-exists check produces the TRUE
 * reason:
 *  - no backup for the email  → "No cloud backup found for this email."
 *  - backup exists            → wrong backup password (+ recovery hint)
 *  - check unavailable        → safe generic fallback
 */
import { describe, expect, it } from "vitest";

import { describeUnlockFailure } from "@/lib/sync";

describe("describeUnlockFailure", () => {
  it("says 'No cloud backup found for this email.' when no backup exists", () => {
    const r = describeUnlockFailure(false);
    expect(r.code).toBe("no_backup_found");
    expect(r.error).toContain("No cloud backup found for this email.");
    // Must NOT blame the password when there is nothing to unlock.
    expect(r.error.toLowerCase()).not.toContain("incorrect");
    // Points the user at the correct next step.
    expect(r.error).toContain("Enable cloud backup");
  });

  it("blames only the backup password when a backup exists", () => {
    const r = describeUnlockFailure(true);
    expect(r.code).toBe("wrong_backup_password");
    expect(r.error.toLowerCase()).toContain("backup password is incorrect");
    // Explains the #1 confusion: backup password ≠ account password.
    expect(r.error.toLowerCase()).toContain("account password");
    // Offers the self-service recovery path.
    expect(r.error).toContain("Forgot backup password?");
  });

  it("falls back to the generic message when the check could not run", () => {
    const r = describeUnlockFailure(null);
    expect(r.code).toBeNull();
    expect(r.error).toContain("Incorrect email or backup password");
  });

  it("never produces an empty or meaningless message", () => {
    for (const state of [true, false, null] as const) {
      const r = describeUnlockFailure(state);
      expect(r.error.trim().length).toBeGreaterThan(20);
      expect(r.error).not.toContain("{}");
    }
  });
});
