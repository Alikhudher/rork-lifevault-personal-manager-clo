/**
 * Vitest setup (node/jsdom runs).
 *
 * jsdom implements crypto.getRandomValues but NOT crypto.subtle, which
 * the password-hashing and encryption code depends on. Node's webcrypto
 * is a complete standards-compliant implementation, so use it whenever
 * SubtleCrypto is missing.
 */
import { webcrypto } from "node:crypto";

const current = globalThis.crypto as Crypto | undefined;
if (!current || !current.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}
