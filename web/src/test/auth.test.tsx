/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { vi, test, expect } from "vitest";

import { AppProvider, useApp, type AuthResult } from "@/context/AppContext";

/**
 * Auth + fresh-start tests.
 *
 * Supabase Auth is the ONLY source of authentication truth. Every test
 * mocks the Supabase client so we can control exactly what signInWithPassword,
 * getSession, onAuthStateChange, and signOut return.
 */

const TEST_EMAIL = "test@example.com";
const TEST_PASSWORD = "mypassword";
const TEST_USER_ID = "supabase-user-id-123";

type AppHook = { current: ReturnType<typeof useApp> };

// ─── Supabase mock ──────────────────────────────────────────────────────
// Use a plain object holder created in vi.hoisted. The mock functions are
// created in each test (where vi is fully available) and assigned to the
// holder. The hoisted vi.mock factory reads from the holder at call time.
const mockHolder = vi.hoisted(() => ({ client: null as null | { auth: unknown } }));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => mockHolder.client,
  getSupabaseUserId: async () => {
    const c = mockHolder.client;
    if (!c) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auth = c.auth as any;
      const result = await auth.getSession();
      return result?.data?.session?.user?.id ?? null;
    } catch {
      return null;
    }
  },
  supabaseConfigured: true,
}));

interface MockAuth {
  signInWithPassword: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
}

/** Cast a mock auth object so its vi.fn methods are callable. */
function asMockAuth(auth: unknown): MockAuth {
  return auth as MockAuth;
}

/** Create a fresh mock Supabase client with default return values.
 *  Call this in each test before rendering. */
function setupMock(): MockAuth {
  localStorage.clear();
  const auth: MockAuth = {
    signInWithPassword: vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials" },
    }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };
  mockHolder.client = { auth };
  return auth;
}

function mockSuccessfulSignIn(email: string, userId: string = TEST_USER_ID) {
  const auth = mockHolder.client!.auth as MockAuth;
  auth.signInWithPassword.mockResolvedValue({
    data: {
      session: {
        user: {
          id: userId,
          email,
          email_confirmed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          user_metadata: { name: email.split("@")[0] },
        },
        access_token: "mock-access-token",
      },
      user: {
        id: userId,
        email,
        email_confirmed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        user_metadata: { name: email.split("@")[0] },
      },
    },
    error: null,
  });
}

function mockFailedSignIn() {
  const auth = mockHolder.client!.auth as MockAuth;
  auth.signInWithPassword.mockResolvedValue({
    data: { session: null, user: null },
    error: { message: "Invalid login credentials" },
  });
}

/** Helper: wait for authReady to become true using a simple delay. */
async function waitForAuthReady(result: AppHook) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });
  if (!result.current.authReady) {
    // Try one more time with a longer delay.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

test("fresh install starts completely empty — no demo data, no budget", async () => {
  setupMock();
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  expect(result.current.authReady).toBe(true);
  expect(result.current.user).toBeNull();
  expect(result.current.accounts).toEqual([]);
  expect(result.current.documents).toEqual([]);
  expect(result.current.expenses).toEqual([]);
  expect(result.current.subscriptions).toEqual([]);
  expect(result.current.appointments).toEqual([]);
  expect(result.current.notifications).toEqual([]);
  expect(result.current.settings.monthlyBudget).toBe(0);
  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.sessions[0].current).toBe(true);
});

test("sign in with unknown email returns not_found when Supabase rejects", async () => {
  setupMock();
  mockFailedSignIn();
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = await result.current.signIn("nobody@example.com", "anything");
  });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toBe("not_found");
  }
  expect(result.current.user).toBeNull();
});

test("successful sign-in always calls Supabase signInWithPassword first", async () => {
  const auth = setupMock();
  mockSuccessfulSignIn(TEST_EMAIL);
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  let res: AuthResult = { ok: false, error: "not_found" };
  await act(async () => {
    res = await result.current.signIn(TEST_EMAIL, TEST_PASSWORD);
  });

  expect(res.ok).toBe(true);
  expect(result.current.user?.email).toBe(TEST_EMAIL);
  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
});

test("wrong password is rejected when Supabase returns invalid credentials", async () => {
  setupMock();
  mockSuccessfulSignIn(TEST_EMAIL);
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  await act(async () => {
    await result.current.signUp("Test User", TEST_EMAIL, TEST_PASSWORD);
  });
  expect(result.current.user).not.toBeNull();

  await act(async () => {
    result.current.signOut();
  });
  expect(result.current.user).toBeNull();

  mockFailedSignIn();
  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = await result.current.signIn(TEST_EMAIL, "wrongpassword");
  });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toBe("wrong_password");
  }
  expect(result.current.user).toBeNull();
});

test("after sign-out, correct password works and wrong is rejected", async () => {
  setupMock();
  mockSuccessfulSignIn(TEST_EMAIL);
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  await act(async () => {
    await result.current.signUp("Test User", TEST_EMAIL, TEST_PASSWORD);
  });
  expect(result.current.user).not.toBeNull();

  await act(async () => {
    result.current.signOut();
  });
  expect(result.current.user).toBeNull();

  mockFailedSignIn();
  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = await result.current.signIn(TEST_EMAIL, "wrongpassword");
  });
  expect(res.ok).toBe(false);
  expect(result.current.user).toBeNull();

  mockSuccessfulSignIn(TEST_EMAIL);
  await act(async () => {
    res = await result.current.signIn(TEST_EMAIL, TEST_PASSWORD);
  });
  expect(res.ok).toBe(true);
  expect(result.current.user?.email).toBe(TEST_EMAIL);
});

test("sign-up creates a real Supabase session", async () => {
  const auth = setupMock();
  mockSuccessfulSignIn(TEST_EMAIL);
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  let res: AuthResult = { ok: false, error: "not_found" };
  await act(async () => {
    res = await result.current.signUp("Test User", TEST_EMAIL, TEST_PASSWORD);
  });
  expect(res.ok).toBe(true);
  expect(result.current.user?.email).toBe(TEST_EMAIL);
  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  expect(result.current.supabaseUserId).toBe(TEST_USER_ID);
});

test("duplicate email signup is rejected with email_taken", async () => {
  setupMock();
  mockSuccessfulSignIn(TEST_EMAIL);
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  await act(async () => {
    await result.current.signUp("Test User", TEST_EMAIL, TEST_PASSWORD);
  });

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = await result.current.signUp("Imposter", TEST_EMAIL, "hacked");
  });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toBe("email_taken");
  }
});

test("sign-out calls Supabase signOut and clears the user", async () => {
  const auth = setupMock();
  mockSuccessfulSignIn(TEST_EMAIL);
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  await act(async () => {
    await result.current.signUp("Test User", TEST_EMAIL, TEST_PASSWORD);
  });
  expect(result.current.user).not.toBeNull();

  await act(async () => {
    result.current.signOut();
  });
  expect(result.current.user).toBeNull();
  expect(auth.signOut).toHaveBeenCalled();
  expect(result.current.supabaseUserId).toBeNull();
});

test("password validation survives page reload (persisted registry, hash only)", async () => {
  setupMock();
  mockSuccessfulSignIn("persist@example.com");
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  await act(async () => {
    await result.current.signUp("Persist User", "persist@example.com", "persistpass");
  });

  const stored = localStorage.getItem("lifevault-state-v1");
  expect(stored).not.toBeNull();

  const parsed = JSON.parse(stored!) as {
    accounts: { email: string; password?: string; passwordHash?: string; passwordSalt?: string }[];
    user: { password?: string } | null;
  };
  expect(parsed.accounts).toBeDefined();
  expect(parsed.accounts.length).toBe(1);

  const persistAccount = parsed.accounts.find((a) => a.email === "persist@example.com");
  expect(persistAccount).toBeDefined();
  expect(persistAccount?.password).toBeUndefined();
  expect(persistAccount?.passwordHash).toBeTruthy();
  expect(persistAccount?.passwordSalt).toBeTruthy();
  expect(persistAccount?.passwordHash).not.toContain("persistpass");
  expect(parsed.user).toBeNull();
});

test("user is never set from localStorage — only from Supabase session", async () => {
  setupMock();
  localStorage.setItem(
    "lifevault-state-v1",
    JSON.stringify({
      onboarded: true,
      user: { name: "Old User", email: "old@example.com", photo: null, createdAt: new Date().toISOString(), emailVerified: true },
      lastEmail: "old@example.com",
      accounts: [
        { email: "old@example.com", name: "Old User", photo: null, password: "pass", createdAt: new Date().toISOString(), emailVerified: true },
      ],
      settings: { currency: "AUD", darkMode: false, biometric: false, monthlyBudget: 0, language: "en" },
    }),
  );

  (mockHolder.client!.auth as MockAuth).getSession.mockResolvedValue({ data: { session: null } });

  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  expect(result.current.user).toBeNull();
  expect(result.current.supabaseUserId).toBeNull();
});

test("getSession restores user on mount when a valid session exists", async () => {
  setupMock();
  const validSession = {
    user: {
      id: "restored-user-id",
      email: TEST_EMAIL,
      email_confirmed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      user_metadata: { name: "Restored" },
    },
    access_token: "valid-token",
  };
  (mockHolder.client!.auth as MockAuth).getSession.mockResolvedValue({ data: { session: validSession } });

  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  expect(result.current.user).not.toBeNull();
  expect(result.current.user?.email).toBe(TEST_EMAIL);
  expect(result.current.supabaseUserId).toBe("restored-user-id");
});

test("signInWithBiometric fails when no previous login exists", async () => {
  setupMock();
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  let res: AuthResult = { ok: true, error: null };
  await act(async () => {
    res = await result.current.signInWithBiometric();
  });
  expect(res.ok).toBe(false);
  expect(result.current.user).toBeNull();
});

test("changePassword updates Supabase auth password", async () => {
  const auth = setupMock();
  mockSuccessfulSignIn(TEST_EMAIL);
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  await act(async () => {
    await result.current.signUp("Test User", TEST_EMAIL, TEST_PASSWORD);
  });

  let ok = true;
  await act(async () => {
    ok = await result.current.changePassword(TEST_PASSWORD, "newpassword123");
  });
  expect(ok).toBe(true);
  expect(auth.updateUser).toHaveBeenCalledWith({ password: "newpassword123" });
  expect(result.current.user?.email).toBe(TEST_EMAIL);
});

test("signOutAllDevices calls Supabase signOut with global scope", async () => {
  const auth = setupMock();
  mockSuccessfulSignIn(TEST_EMAIL);
  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });
  await waitForAuthReady(result);

  await act(async () => {
    await result.current.signUp("Test User", TEST_EMAIL, TEST_PASSWORD);
  });

  await act(async () => {
    result.current.signOutAllDevices();
  });
  expect(result.current.user).toBeNull();
  expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
});

test("authReady is false before getSession completes, true after", async () => {
  setupMock();
  const auth = mockHolder.client!.auth as MockAuth;
  let resolveGetSession: (value: { data: { session: null } }) => void = () => {};
  auth.getSession.mockImplementation(
    () => new Promise<{ data: { session: null } }>((resolve) => { resolveGetSession = resolve; }),
  );

  const { result } = renderHook(() => useApp(), { wrapper: AppProvider });

  expect(result.current.authReady).toBe(false);

  await act(async () => {
    resolveGetSession({ data: { session: null } });
    await new Promise((r) => setTimeout(r, 200));
  });

  expect(result.current.authReady).toBe(true);
});
