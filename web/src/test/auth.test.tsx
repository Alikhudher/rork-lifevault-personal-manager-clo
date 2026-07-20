/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";

import { AppProvider, useApp, type AuthResult } from "@/context/AppContext";

/**
 * Auth + fresh-start tests.
 *
 * Covers the critical password-validation flows and the release guarantee
 * that new users start with a completely empty account (no demo documents,
 * expenses, subscriptions, appointments, notifications or budget).
 */

const TEST_EMAIL = "test@example.com";
const TEST_PASSWORD = "mypassword";

type AppHook = { current: ReturnType<typeof useApp> };

/** Register a fresh account (most tests need an existing registered user). */
async function signUpTestUser(result: AppHook): Promise<void> {
  await act(async () => {
    result.current.signUp("Test User", TEST_EMAIL, TEST_PASSWORD);
  });
}

beforeEach(() => {
  localStorage.clear();
});

test("fresh install starts completely empty — no demo data, no budget", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  expect(result.current.user).toBeNull();
  expect(result.current.accounts).toEqual([]);
  expect(result.current.documents).toEqual([]);
  expect(result.current.expenses).toEqual([]);
  expect(result.current.subscriptions).toEqual([]);
  expect(result.current.appointments).toEqual([]);
  expect(result.current.notifications).toEqual([]);
  expect(result.current.settings.monthlyBudget).toBe(0);
  // Only the real current device appears in sessions — never fake devices.
  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.sessions[0].current).toBe(true);
});

test("legacy demo data persisted by pre-release builds is purged on load", async () => {
  // Simulate an old install that persisted seeded demo state.
  localStorage.setItem(
    "lifevault-state-v1",
    JSON.stringify({
      onboarded: true,
      user: null,
      lastEmail: "mia.thompson@example.com",
      accounts: [
        {
          email: "mia.thompson@example.com",
          name: "Mia Thompson",
          photo: null,
          password: "password123",
          createdAt: new Date().toISOString(),
          emailVerified: true,
        },
        {
          email: "real.user@example.com",
          name: "Real User",
          photo: null,
          password: "realpass",
          createdAt: new Date().toISOString(),
          emailVerified: true,
        },
      ],
      settings: { currency: "AUD", darkMode: false, biometric: false, monthlyBudget: 3800, language: "en" },
      documents: [
        { id: "doc_passport", name: "Australian Passport", category: "Passport", issueDate: "2022-01-01", expiryDate: "2026-09-01", notes: "", reminderDays: 60, fileName: null, fileKind: null, createdAt: new Date().toISOString() },
        { id: "doc_l8x2ab_1", name: "My real doc", category: "ID", issueDate: "2025-01-01", expiryDate: null, notes: "", reminderDays: 30, fileName: null, fileKind: null, createdAt: new Date().toISOString() },
      ],
      expenses: [
        { id: "exp_3", amount: 22, date: new Date().toISOString(), category: "Transport", merchant: "Opal", notes: "", paymentMethod: "Credit Card" },
        { id: "exp_l8x2ab_2", amount: 10, date: new Date().toISOString(), category: "Food", merchant: "Real Cafe", notes: "", paymentMethod: "Cash" },
      ],
      subscriptions: [
        { id: "sub_netflix", name: "Netflix Premium", price: 25.99, frequency: "monthly", nextPaymentDate: "2026-08-01", category: "Entertainment", paymentMethod: "Credit Card", reminderDays: 7, status: "active" },
      ],
      appointments: [
        { id: "apt_dentist", title: "Dentist", date: "2026-08-01", time: "09:30", location: "", notes: "", reminder: "1 day before" },
      ],
      notifications: [
        { id: "ntf_1", type: "document", title: "Demo", message: "Demo", date: new Date().toISOString(), read: false },
      ],
      sessions: [
        { id: "ses_ipad", device: "iPad Air", location: "Sydney", app: "LifeVault", lastActive: new Date().toISOString() },
      ],
    }),
  );

  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  // Demo records are gone; real user records survive.
  expect(result.current.documents.map((d) => d.id)).toEqual(["doc_l8x2ab_1"]);
  expect(result.current.expenses.map((e) => e.id)).toEqual(["exp_l8x2ab_2"]);
  expect(result.current.subscriptions).toEqual([]);
  expect(result.current.appointments).toEqual([]);
  expect(result.current.notifications).toEqual([]);
  // Demo account removed, real account kept.
  expect(result.current.accounts.map((a) => a.email)).toEqual(["real.user@example.com"]);
  expect(result.current.lastEmail).toBeNull();
  // Seeded demo budget reset; fake sessions replaced with the real device.
  expect(result.current.settings.monthlyBudget).toBe(0);
  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.sessions[0].current).toBe(true);
});

test("sign in with unknown email returns not_found", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn("nobody@example.com", "anything");
  });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toBe("not_found");
  }
  expect(result.current.user).toBeNull();
});

test("wrong password is rejected for a registered account", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await signUpTestUser(result);
  await act(async () => {
    result.current.signOut();
  });

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn(TEST_EMAIL, "wrongpassword");
  });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toBe("wrong_password");
  }
  expect(result.current.user).toBeNull();
});

test("after logout, wrong password is still rejected and correct one works", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await signUpTestUser(result);
  expect(result.current.user).not.toBeNull();

  // Sign out — must completely clear the session
  await act(async () => {
    result.current.signOut();
  });
  expect(result.current.user).toBeNull();

  // THE BUG: wrong password must still be rejected after logout
  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn(TEST_EMAIL, "wrongpassword");
  });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toBe("wrong_password");
  }
  expect(result.current.user).toBeNull();

  // Correct password should still work after logout
  await act(async () => {
    res = result.current.signIn(TEST_EMAIL, TEST_PASSWORD);
  });
  expect(res.ok).toBe(true);
  expect(result.current.user).not.toBeNull();
});

test("newly registered account persists after logout", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signUp("Test User", TEST_EMAIL, TEST_PASSWORD);
  });
  expect(res.ok).toBe(true);
  expect(result.current.user?.email).toBe(TEST_EMAIL);

  await act(async () => {
    result.current.signOut();
  });
  expect(result.current.user).toBeNull();

  await act(async () => {
    res = result.current.signIn(TEST_EMAIL, "wrongpassword");
  });
  expect(res.ok).toBe(false);
  expect(result.current.user).toBeNull();

  await act(async () => {
    res = result.current.signIn(TEST_EMAIL, TEST_PASSWORD);
  });
  expect(res.ok).toBe(true);
  expect(result.current.user?.email).toBe(TEST_EMAIL);
});

test("duplicate email signup is rejected", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await signUpTestUser(result);

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signUp("Imposter", TEST_EMAIL, "hacked");
  });
  expect(res.ok).toBe(false);
});

test("changePassword requires correct current password", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await signUpTestUser(result);

  // Wrong current password must fail
  let ok = true;
  await act(async () => {
    ok = result.current.changePassword("wrongcurrent", "newpassword123");
  });
  expect(ok).toBe(false);

  // Correct current password must succeed
  await act(async () => {
    ok = result.current.changePassword(TEST_PASSWORD, "newpassword123");
  });
  expect(ok).toBe(true);

  await act(async () => {
    result.current.signOut();
  });

  // Old password must no longer work
  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn(TEST_EMAIL, TEST_PASSWORD);
  });
  expect(res.ok).toBe(false);

  // New password must work
  await act(async () => {
    res = result.current.signIn(TEST_EMAIL, "newpassword123");
  });
  expect(res.ok).toBe(true);
});

test("signOutAllDevices clears user session", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await signUpTestUser(result);
  expect(result.current.user).not.toBeNull();

  await act(async () => {
    result.current.signOutAllDevices();
  });
  expect(result.current.user).toBeNull();

  // Wrong password must still be rejected
  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn(TEST_EMAIL, "wrongpassword");
  });
  expect(res.ok).toBe(false);
});

test("signInWithBiometric unlocks the last signed-in account after logout", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await signUpTestUser(result);

  await act(async () => {
    result.current.signOut();
  });
  expect(result.current.user).toBeNull();

  // Biometric unlock should restore the session without a password
  let res: AuthResult = { ok: false, error: "not_found" };
  await act(async () => {
    res = result.current.signInWithBiometric();
  });
  expect(res.ok).toBe(true);
  expect(result.current.user?.email).toBe(TEST_EMAIL);
});

test("signInWithBiometric fails when no previous login exists", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signInWithBiometric();
  });
  expect(res.ok).toBe(false);
});

test("password validation survives page reload (persisted registry)", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  await act(async () => {
    result.current.signUp("Persist User", "persist@example.com", "persistpass");
  });

  // Simulate a page reload by re-reading persisted state from localStorage.
  const stored = localStorage.getItem("lifevault-state-v1");
  expect(stored).not.toBeNull();

  const parsed = JSON.parse(stored!);
  expect(parsed.accounts).toBeDefined();
  // Only the account the user actually registered — no seeded demo accounts.
  expect(parsed.accounts.length).toBe(1);

  const persistAccount = parsed.accounts.find(
    (a: { email: string }) => a.email === "persist@example.com",
  );
  expect(persistAccount).toBeDefined();
  expect(persistAccount.password).toBe("persistpass");
});
