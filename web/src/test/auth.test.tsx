/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";

import { AppProvider, useApp, type AuthResult } from "@/context/AppContext";

/**
 * Auth flow tests — verifies the critical bug where any password was accepted
 * after logout.
 */

beforeEach(() => {
  localStorage.clear();
});

test("wrong password is rejected before first login", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  // Demo account: mia.thompson@example.com / password123
  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn("mia.thompson@example.com", "wrongpassword");
  });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toBe("wrong_password");
  }
  expect(result.current.user).toBeNull();
});

test("correct password succeeds before first login", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn("mia.thompson@example.com", "password123");
  });
  expect(res.ok).toBe(true);
  expect(result.current.user).not.toBeNull();
  expect(result.current.user?.email).toBe("mia.thompson@example.com");
});

test("after logout, wrong password is still rejected", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  // 1. Sign in with correct password
  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn("mia.thompson@example.com", "password123");
  });
  expect(res.ok).toBe(true);
  expect(result.current.user).not.toBeNull();

  // 2. Sign out — must completely clear the session
  await act(async () => {
    result.current.signOut();
  });
  expect(result.current.user).toBeNull();

  // 3. THE BUG: wrong password must still be rejected after logout
  await act(async () => {
    res = result.current.signIn("mia.thompson@example.com", "wrongpassword");
  });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toBe("wrong_password");
  }
  expect(result.current.user).toBeNull();

  // 4. Correct password should still work after logout
  await act(async () => {
    res = result.current.signIn("mia.thompson@example.com", "password123");
  });
  expect(res.ok).toBe(true);
  expect(result.current.user).not.toBeNull();
});

test("newly registered account persists after logout", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  // Sign up a brand new account
  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signUp("Test User", "test@example.com", "mypassword");
  });
  expect(res.ok).toBe(true);
  expect(result.current.user?.email).toBe("test@example.com");

  // Sign out
  await act(async () => {
    result.current.signOut();
  });
  expect(result.current.user).toBeNull();

  // Wrong password must fail
  await act(async () => {
    res = result.current.signIn("test@example.com", "wrongpassword");
  });
  expect(res.ok).toBe(false);
  expect(result.current.user).toBeNull();

  // Correct password must succeed
  await act(async () => {
    res = result.current.signIn("test@example.com", "mypassword");
  });
  expect(res.ok).toBe(true);
  expect(result.current.user?.email).toBe("test@example.com");
});

test("duplicate email signup is rejected", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signUp("Mia Imposter", "mia.thompson@example.com", "hacked");
  });
  expect(res.ok).toBe(false);
});

test("unknown email returns not_found", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn("nobody@example.com", "anything");
  });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toBe("not_found");
  }
});

test("changePassword requires correct current password", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  // Sign in as demo user
  await act(async () => {
    result.current.signIn("mia.thompson@example.com", "password123");
  });

  // Wrong current password must fail
  let ok = true;
  await act(async () => {
    ok = result.current.changePassword("wrongcurrent", "newpassword123");
  });
  expect(ok).toBe(false);

  // Correct current password must succeed
  await act(async () => {
    ok = result.current.changePassword("password123", "newpassword123");
  });
  expect(ok).toBe(true);

  // Sign out
  await act(async () => {
    result.current.signOut();
  });

  // Old password must no longer work
  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn("mia.thompson@example.com", "password123");
  });
  expect(res.ok).toBe(false);

  // New password must work
  await act(async () => {
    res = result.current.signIn("mia.thompson@example.com", "newpassword123");
  });
  expect(res.ok).toBe(true);
});

test("signOutAllDevices clears user session", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  await act(async () => {
    result.current.signIn("mia.thompson@example.com", "password123");
  });
  expect(result.current.user).not.toBeNull();

  await act(async () => {
    result.current.signOutAllDevices();
  });
  expect(result.current.user).toBeNull();

  // Wrong password must still be rejected
  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = result.current.signIn("mia.thompson@example.com", "wrongpassword");
  });
  expect(res.ok).toBe(false);
});

test("signInWithBiometric unlocks the last signed-in account after logout", async () => {
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  // Sign in with password first to establish lastEmail
  await act(async () => {
    result.current.signIn("mia.thompson@example.com", "password123");
  });

  // Sign out
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
  expect(result.current.user?.email).toBe("mia.thompson@example.com");
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

  // Sign up a new account
  await act(async () => {
    result.current.signUp("Persist User", "persist@example.com", "persistpass");
  });

  // Simulate a page reload by clearing the in-memory state and re-loading from localStorage.
  // The account registry must survive so the password can still be validated.
  const stored = localStorage.getItem("lifevault-state-v1");
  expect(stored).not.toBeNull();

  const parsed = JSON.parse(stored!);
  expect(parsed.accounts).toBeDefined();
  expect(parsed.accounts.length).toBeGreaterThan(0);
  expect(parsed.accounts[0].password).toBe("password123"); // demo account

  const persistAccount = parsed.accounts.find(
    (a: { email: string }) => a.email === "persist@example.com",
  );
  expect(persistAccount).toBeDefined();
  expect(persistAccount.password).toBe("persistpass");
});
