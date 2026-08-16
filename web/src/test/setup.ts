/**
 * Vitest setup (node/jsdom runs).
 *
 * jsdom implements crypto.getRandomValues but NOT crypto.subtle, which
 * the password-hashing and encryption code depends on. Node's webcrypto
 * is a complete standards-compliant implementation, so use it whenever
 * SubtleCrypto is missing.
 *
 * jsdom also doesn't implement window.matchMedia, which the dark mode
 * detection effect in AppContext uses. Mock it with a no-op stub.
 */
import { webcrypto } from "node:crypto";

const current = globalThis.crypto as Crypto | undefined;
if (!current || !current.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

// jsdom doesn't implement matchMedia — stub it so the dark mode
// detection effect doesn't crash the test suite.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
