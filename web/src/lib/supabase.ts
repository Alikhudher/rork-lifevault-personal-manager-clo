/**
 * Supabase client for LifeVault cloud backup & sync.
 *
 * This is the ONE place a Supabase client is created — every module
 * (sync engine, SyncContext, Backup & Sync screen) imports the same
 * singleton via getSupabase().
 *
 * Config self-healing:
 *  Production builds shipped with two real-world misconfigurations:
 *   1. VITE_SUPABASE_URL contained the anon/publishable KEY instead of
 *      the URL (values pasted into swapped variables), which made
 *      supabase-js throw "Invalid supabaseUrl: Must be a valid HTTP or
 *      HTTPS URL."
 *   2. EXPO_PUBLIC_SUPABASE_URL contained a typo'd project ref (an
 *      extra character in the host), a domain that does not exist.
 *  resolveSupabaseConfig() therefore classifies every candidate env
 *  value by SHAPE (URL vs key), repairs swapped values, cross-checks
 *  the URL host against the project ref embedded in a JWT anon key,
 *  and finally falls back to the project's verified public credentials.
 *  createClient can never be called with garbage, and it is wrapped so
 *  a failure degrades to "cloud disabled" instead of crashing the app.
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

/**
 * Verified fallback credentials for this project's Supabase instance
 * ("LifeVaultHub", ref jqzubtkxiairtchzmkgj) — checked live against
 * /auth/v1/health and /rest/v1. These are PUBLIC client-side values by
 * design (every shipped Supabase app bundle contains its URL + anon
 * key); all data access is protected by Row Level Security. Valid env
 * vars always take precedence.
 */
const FALLBACK_SUPABASE_URL = "https://jqzubtkxiairtchzmkgj.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "sb_publishable_vokPvwAyDq58VV7LFOcMhw_FCtkE4i-";

export interface SupabaseResolvedConfig {
  url: string;
  anonKey: string;
  /** Which env var (or fallback strategy) supplied the URL — for diagnostics. */
  urlSource: string;
  /** Which env var (or fallback strategy) supplied the key — for diagnostics. */
  keySource: string;
  /** Human-readable notes about every repair that was applied. */
  warnings: string[];
}

/** Trims whitespace and strips accidental wrapping quotes from an env value. */
function cleanEnvValue(raw: string | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/^["']+|["']+$/g, "").trim();
}

/** True when the value parses as an http(s) URL. */
function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    return Boolean(new URL(value));
  } catch {
    return false;
  }
}

/** True when the value is shaped like a Supabase API key (JWT or sb_* token). */
function looksLikeKey(value: string): boolean {
  if (!value || value.includes("://")) return false;
  return value.startsWith("eyJ") || value.startsWith("sb_") || /^[A-Za-z0-9._-]{30,}$/.test(value);
}

/**
 * Extracts the Supabase project ref embedded in a legacy JWT anon key
 * (payload claim "ref"), or null for non-JWT keys / malformed tokens.
 */
export function decodeJwtProjectRef(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { ref?: unknown };
    return typeof payload.ref === "string" && payload.ref.length > 0 ? payload.ref : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the Supabase URL + anon key from env vars by VALUE SHAPE,
 * not just variable name, in priority order VITE_* → EXPO_PUBLIC_*.
 * Repairs swapped URL/key values, discards non-URL "URLs", cross-checks
 * *.supabase.co hosts against the project ref inside a JWT anon key
 * (fixing typo'd refs), and falls back to the verified project
 * credentials when nothing usable exists.
 */
export function resolveSupabaseConfig(env: Record<string, string | undefined>): SupabaseResolvedConfig {
  const warnings: string[] = [];
  const values = new Map<string, string>([
    ["VITE_SUPABASE_URL", cleanEnvValue(env.VITE_SUPABASE_URL)],
    ["EXPO_PUBLIC_SUPABASE_URL", cleanEnvValue(env.EXPO_PUBLIC_SUPABASE_URL)],
    ["VITE_SUPABASE_ANON_KEY", cleanEnvValue(env.VITE_SUPABASE_ANON_KEY)],
    ["EXPO_PUBLIC_SUPABASE_ANON_KEY", cleanEnvValue(env.EXPO_PUBLIC_SUPABASE_ANON_KEY)],
  ]);

  // Candidate pools by shape. URL vars are checked first, but key vars are
  // also scanned in case the two values were pasted into swapped variables.
  const urlOrder = [
    "VITE_SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  ];
  const keyOrder = [
    "VITE_SUPABASE_ANON_KEY",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_URL",
  ];

  const urlCandidates = urlOrder
    .map((name) => ({ name, value: values.get(name) ?? "" }))
    .filter((c) => isHttpUrl(c.value));
  const keyCandidates = keyOrder
    .map((name) => ({ name, value: values.get(name) ?? "" }))
    .filter((c) => looksLikeKey(c.value));

  for (const name of ["VITE_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL"]) {
    const v = values.get(name) ?? "";
    if (v && !isHttpUrl(v)) {
      warnings.push(
        `${name} is not a valid http(s) URL${looksLikeKey(v) ? " (it contains an API key — values appear swapped)" : ""}; ignored.`,
      );
    }
  }

  // --- Key resolution ---
  const keyPick = keyCandidates[0];
  const anonKey = keyPick?.value ?? FALLBACK_SUPABASE_ANON_KEY;
  const keySource = keyPick?.name ?? "built-in-fallback";
  if (!keyPick) {
    warnings.push("No anon key found in env; using the verified built-in project key.");
  } else if (keyPick.name === "VITE_SUPABASE_URL" || keyPick.name === "EXPO_PUBLIC_SUPABASE_URL") {
    warnings.push(`Anon key recovered from ${keyPick.name} — the URL/key env values are swapped.`);
  }

  // --- URL resolution, cross-checked against the JWT project ref ---
  const jwtRef =
    keyCandidates.map((c) => decodeJwtProjectRef(c.value)).find((r): r is string => r !== null) ?? null;
  const derivedUrl = jwtRef ? `https://${jwtRef}.supabase.co` : null;

  /** A *.supabase.co host must match the JWT ref; custom domains are trusted as-is. */
  const hostMatchesRef = (value: string): boolean => {
    const host = new URL(value).hostname;
    if (!host.endsWith(".supabase.co")) return true;
    return jwtRef === null || host === `${jwtRef}.supabase.co`;
  };

  let url: string;
  let urlSource: string;
  const trusted = urlCandidates.find((c) => hostMatchesRef(c.value));
  if (trusted) {
    url = trusted.value;
    urlSource = trusted.name;
    if (urlCandidates[0] && urlCandidates[0].name !== trusted.name) {
      warnings.push(
        `${urlCandidates[0].name} host does not match the project ref "${jwtRef}" from the anon key; used ${trusted.name} instead.`,
      );
    }
  } else if (derivedUrl) {
    url = derivedUrl;
    urlSource = "derived-from-anon-key-ref";
    warnings.push(
      urlCandidates.length > 0
        ? `URL host in ${urlCandidates[0].name} does not match the project ref "${jwtRef}" embedded in the anon key (likely a typo); derived ${derivedUrl} from the key instead.`
        : `No valid Supabase URL in env; derived ${derivedUrl} from the anon key's project ref.`,
    );
  } else {
    url = FALLBACK_SUPABASE_URL;
    urlSource = "built-in-fallback";
    warnings.push("No valid Supabase URL in env; using the verified built-in project URL.");
  }

  return { url: url.replace(/\/+$/, ""), anonKey, urlSource, keySource, warnings };
}

const resolved: SupabaseResolvedConfig = resolveSupabaseConfig(
  import.meta.env as unknown as Record<string, string | undefined>,
);

if (resolved.warnings.length > 0) {
  console.warn("[CloudBackup] Supabase config self-healed:\n - " + resolved.warnings.join("\n - "));
}
console.log(
  `[CloudBackup] Supabase config → url=${resolved.url} (from ${resolved.urlSource}), key=${resolved.anonKey.slice(0, 10)}… (from ${resolved.keySource})`,
);

/** True when Supabase credentials are configured/resolvable. */
export const supabaseConfigured: boolean = Boolean(resolved.url && resolved.anonKey);

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
let clientCreationFailed = false;

/**
 * Returns the app-wide singleton Supabase client, or null when not
 * configured. Never throws: if client creation fails (e.g. malformed
 * URL that slipped past validation), the error is logged once and
 * cloud features degrade gracefully.
 */
export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured || clientCreationFailed) return null;
  if (!client) {
    try {
      client = createClient(resolved.url, resolved.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: "lv-supabase-auth",
        },
        global: { fetch: fetchWithTimeout },
      });
      console.log("[CloudBackup] Supabase client initialised (request timeout 30s)");
    } catch (err) {
      clientCreationFailed = true;
      console.error(
        "[CloudBackup] Failed to create Supabase client:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
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
