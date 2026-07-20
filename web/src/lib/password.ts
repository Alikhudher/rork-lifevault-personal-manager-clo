/**
 * Account password hashing for LifeVault's local auth.
 *
 * Passwords are NEVER stored in plaintext. Each account keeps a
 * PBKDF2-SHA256 hash (250k iterations, 256-bit) plus a per-account
 * random salt. Verification derives the hash again and compares in
 * constant time, so a wrong "current password" can never be accepted.
 *
 * The same primitives back the cross-device password propagation: only
 * the (salted) hash is synced — inside the end-to-end encrypted backup
 * — never the password itself.
 */

const PBKDF2_ITERATIONS = 250_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function assertCryptoAvailable(): void {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Secure password hashing is unavailable in this environment.");
  }
}

async function deriveHashBytes(password: string, saltB64: string): Promise<Uint8Array> {
  assertCryptoAvailable();
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export interface HashedPassword {
  /** Base64 PBKDF2-SHA256 hash. */
  hash: string;
  /** Base64 random salt used for this hash. */
  salt: string;
}

/** Hash a password with a fresh random salt (or a caller-provided one). */
export async function hashPassword(password: string, saltB64?: string): Promise<HashedPassword> {
  assertCryptoAvailable();
  let salt = saltB64;
  if (!salt) {
    const raw = new Uint8Array(SALT_BYTES);
    crypto.getRandomValues(raw);
    salt = bytesToBase64(raw);
  }
  const bytes = await deriveHashBytes(password, salt);
  return { hash: bytesToBase64(bytes), salt };
}

/**
 * Verify a password attempt against a stored salt + hash.
 * Constant-time comparison; returns false on any malformed input.
 */
export async function verifyPassword(
  password: string,
  saltB64: string,
  expectedHashB64: string,
): Promise<boolean> {
  if (!saltB64 || !expectedHashB64) return false;
  try {
    const actual = await deriveHashBytes(password, saltB64);
    const expected = base64ToBytes(expectedHashB64);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}
