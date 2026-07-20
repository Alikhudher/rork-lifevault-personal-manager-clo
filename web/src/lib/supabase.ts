/**
 * Supabase client for LifeVault cloud backup & sync.
 *
 * Reads URL + anon key from Vite env vars (VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY). Falls back to EXPO_PUBLIC_* for parity with
 * the rest of the project. When env vars are absent, every call
 * degrades to a no-op so the app keeps working without cloud backup.
 *
 * Hang-proofing:
 *  - Every network request goes through `fetchWithTimeout`, so a dead
 *    connection, a paused Supabase project, or a stalled WKWebView
 *    socket can never hang a cloud operation forever.
 *  - `withTimeout` is exported as an operation-level watchdog for
 *    multi-step flows (setup/unlock), guaranteeing the caller always
 *    gets a result or a clear timeout error.
 *  - No custom auth `lock` is configured: supabase-js ≥ 2.107 is
 *    lockless by default, and passing a lock would opt back into the
 *    legacy mutex path that caused indefinite auth hangs.
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  (import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined) ??
  "";

const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined) ??
  "";

/** True when Supabase credentials are configured in the environment. */
export const supabaseConfigured: boolean = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Hard cap for any single network request to Supabase. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * fetch wrapper that aborts after REQUEST_TIMEOUT_MS so no Supabase
 * request (auth or database) can stall indefinitely. Respects an
 * upstream abort signal if the caller provided one.
 */
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new DOMException(
        `Cloud request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds. Check your internet connection and try again.`,
        "TimeoutError",
      ),
    );
  }, REQUEST_TIMEOUT_MS);
  const upstream = init?.signal;
  if (upstream) {
    if (upstream.aborted) {
      controller.abort(upstream.reason);
    } else {
      upstream.addEventListener("abort", () => controller.abort(upstream.reason), { once: true });
    }
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Watchdog: rejects with a clear, user-displayable Error if `promise`
 * doesn't settle within `ms`. The underlying operation is not cancelled
 * — this only guarantees the caller always gets an answer.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(ms / 1000)} seconds. Check your internet connection and try again.`,
        ),
      );
    }, ms);
  });
  try {
    return await Promise.race([promise, watchdog]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

let client: SupabaseClient | null = null;

/** Returns the singleton Supabase client, or null when not configured. */
export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "lv-supabase-auth",
      },
      global: { fetch: fetchWithTimeout },
    });
    console.log("[CloudBackup] Supabase client initialised (request timeout 30s)");
  }
  return client;
}

/** Current Supabase auth session, or null if not signed in. */
export async function getSupabaseSession(): Promise<Session | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    // getSession is normally instant (reads local storage), but a token
    // refresh can trigger a network call — bound it so callers never hang.
    const { data } = await withTimeout(sb.auth.getSession(), REQUEST_TIMEOUT_MS, "Reading cloud session");
    return data.session;
  } catch (err) {
    console.warn("[CloudBackup] getSession failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Current Supabase user id, or null if not signed in. */
export async function getSupabaseUserId(): Promise<string | null> {
  const session = await getSupabaseSession();
  return session?.user?.id ?? null;
}
