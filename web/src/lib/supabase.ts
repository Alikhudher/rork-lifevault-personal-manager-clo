/**
 * Supabase client for LifeVault cloud backup & sync.
 *
 * Reads URL + anon key from Vite env vars (VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY). Falls back to EXPO_PUBLIC_* for parity with
 * the rest of the project. When env vars are absent, every call
 * degrades to a no-op so the app keeps working without cloud backup.
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
    });
  }
  return client;
}

/** Current Supabase auth session, or null if not signed in. */
export async function getSupabaseSession(): Promise<Session | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session;
  } catch {
    return null;
  }
}

/** Current Supabase user id, or null if not signed in. */
export async function getSupabaseUserId(): Promise<string | null> {
  const session = await getSupabaseSession();
  return session?.user?.id ?? null;
}
