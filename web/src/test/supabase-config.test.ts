/**
 * Tests for the self-healing Supabase config resolver.
 *
 * These cover the two real-world misconfigurations that shipped to
 * TestFlight ("Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL"):
 *  1. The anon/publishable KEY pasted into VITE_SUPABASE_URL.
 *  2. A typo'd project ref inside EXPO_PUBLIC_SUPABASE_URL.
 */
import { describe, expect, it } from "vitest";

import { decodeJwtProjectRef, resolveSupabaseConfig } from "@/lib/supabase";

const REF = "jqzubtkxiairtchzmkgj";
const GOOD_URL = `https://${REF}.supabase.co`;
const TYPO_URL = "https://jqzubtkxiaiirtchzmkgj.supabase.co/"; // extra "i" + trailing slash
const PUBLISHABLE_KEY = "sb_publishable_vokPvwAyDq58VV7LFOcMhw_FCtkE4i-";

function toBase64Url(json: string): string {
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: Record<string, unknown>): string => toBase64Url(JSON.stringify(obj));
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.fakesignature`;
}

const JWT_KEY = makeJwt({ iss: "supabase", ref: REF, role: "anon" });

describe("decodeJwtProjectRef", () => {
  it("extracts the ref claim from a JWT anon key", () => {
    expect(decodeJwtProjectRef(JWT_KEY)).toBe(REF);
  });

  it("returns null for publishable keys and garbage", () => {
    expect(decodeJwtProjectRef(PUBLISHABLE_KEY)).toBeNull();
    expect(decodeJwtProjectRef("not-a-jwt")).toBeNull();
    expect(decodeJwtProjectRef("a.b.c")).toBeNull();
  });
});

describe("resolveSupabaseConfig", () => {
  it("passes through clean, correct values with no warnings", () => {
    const result = resolveSupabaseConfig({
      VITE_SUPABASE_URL: GOOD_URL,
      VITE_SUPABASE_ANON_KEY: JWT_KEY,
    });
    expect(result.url).toBe(GOOD_URL);
    expect(result.anonKey).toBe(JWT_KEY);
    expect(result.urlSource).toBe("VITE_SUPABASE_URL");
    expect(result.keySource).toBe("VITE_SUPABASE_ANON_KEY");
    expect(result.warnings).toHaveLength(0);
  });

  it("repairs the exact production misconfiguration (key in URL var + typo'd fallback URL)", () => {
    const result = resolveSupabaseConfig({
      VITE_SUPABASE_URL: PUBLISHABLE_KEY, // ← the bug: key pasted as URL
      VITE_SUPABASE_ANON_KEY: JWT_KEY,
      EXPO_PUBLIC_SUPABASE_URL: TYPO_URL, // ← typo'd ref, dead domain
      EXPO_PUBLIC_SUPABASE_ANON_KEY: PUBLISHABLE_KEY,
    });
    expect(result.url).toBe(GOOD_URL);
    expect(result.anonKey).toBe(JWT_KEY);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("recovers a full swap (URL in key var, key in URL var)", () => {
    const result = resolveSupabaseConfig({
      VITE_SUPABASE_URL: JWT_KEY,
      VITE_SUPABASE_ANON_KEY: GOOD_URL,
    });
    expect(result.url).toBe(GOOD_URL);
    expect(result.anonKey).toBe(JWT_KEY);
    expect(result.keySource).toBe("VITE_SUPABASE_URL");
  });

  it("fixes a typo'd *.supabase.co host by deriving the URL from the JWT ref", () => {
    const result = resolveSupabaseConfig({
      VITE_SUPABASE_URL: TYPO_URL,
      VITE_SUPABASE_ANON_KEY: JWT_KEY,
    });
    expect(result.url).toBe(GOOD_URL);
    expect(result.urlSource).toBe("derived-from-anon-key-ref");
  });

  it("trusts custom domains without a ref cross-check", () => {
    const result = resolveSupabaseConfig({
      VITE_SUPABASE_URL: "https://db.example.com",
      VITE_SUPABASE_ANON_KEY: JWT_KEY,
    });
    expect(result.url).toBe("https://db.example.com");
  });

  it("accepts publishable-key-only setups (no JWT ref available)", () => {
    const result = resolveSupabaseConfig({
      VITE_SUPABASE_URL: GOOD_URL,
      VITE_SUPABASE_ANON_KEY: PUBLISHABLE_KEY,
    });
    expect(result.url).toBe(GOOD_URL);
    expect(result.anonKey).toBe(PUBLISHABLE_KEY);
  });

  it("falls back to the verified built-in credentials when env is empty", () => {
    const result = resolveSupabaseConfig({});
    expect(result.url).toBe(GOOD_URL);
    expect(result.anonKey).toBe(PUBLISHABLE_KEY);
    expect(result.urlSource).toBe("built-in-fallback");
    expect(result.keySource).toBe("built-in-fallback");
  });

  it("strips wrapping quotes, whitespace and trailing slashes", () => {
    const result = resolveSupabaseConfig({
      VITE_SUPABASE_URL: ` "${GOOD_URL}/" `,
      VITE_SUPABASE_ANON_KEY: `  ${JWT_KEY}  `,
    });
    expect(result.url).toBe(GOOD_URL);
    expect(result.anonKey).toBe(JWT_KEY);
  });
});
