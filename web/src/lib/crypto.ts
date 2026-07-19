/**
 * Client-side encryption for LifeVault cloud backup.
 *
 * Uses Web Crypto (AES-GCM 256-bit) with a key derived from the user's
 * backup password via PBKDF2 (SHA-256, 250k iterations). The salt is
 * random per user and stored alongside the ciphertext on the server.
 * The server NEVER sees the plaintext key, the password, or any
 * decrypted record content — only ciphertext + IV + salt.
 *
 * Every record is encrypted individually so incremental sync only
 * ships changed rows. The IV is fresh per encryption.
 */

const PBKDF2_ITERATIONS = 250_000;
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH = 16; // bytes
const IV_LENGTH = 12; // bytes, AES-GCM standard

/** Base64 helpers that work on Uint8Array. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  // Allocate an explicit ArrayBuffer (not SharedArrayBuffer) so the
  // result is assignable to Web Crypto's BufferSource parameter type.
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Random salt as a base64 string. */
export function generateSalt(): string {
  const arr = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(arr);
  return bytesToBase64(arr);
}

/** Derive an AES-GCM 256-bit CryptoKey from password + salt. */
export async function deriveKey(password: string, saltB64: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface EncryptedPayload {
  /** Base64 ciphertext. */
  ciphertext: string;
  /** Base64 AES-GCM IV. */
  iv: string;
}

/** Encrypt an arbitrary JSON-serialisable value with the given key. */
export async function encryptRecord(key: CryptoKey, plaintext: unknown): Promise<EncryptedPayload> {
  const iv = new Uint8Array(IV_LENGTH);
  crypto.getRandomValues(iv);
  const data = new TextEncoder().encode(JSON.stringify(plaintext));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipher)),
    iv: bytesToBase64(iv),
  };
}

/** Decrypt an EncryptedPayload back into its original value. */
export async function decryptRecord<T>(key: CryptoKey, payload: EncryptedPayload): Promise<T> {
  const iv = base64ToBytes(payload.iv);
  const cipher = base64ToBytes(payload.ciphertext);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  const text = new TextDecoder().decode(plain);
  return JSON.parse(text) as T;
}

/**
 * Store / retrieve the derived key in memory for the lifetime of the
 * session. We never persist the key itself — only the salt (on the
 * server) and the password (in the user's head / the secure unlock
 * prompt at session start).
 */
let cachedKey: CryptoKey | null = null;

export function setSessionKey(key: CryptoKey | null): void {
  cachedKey = key;
}

export function getSessionKey(): CryptoKey | null {
  return cachedKey;
}

export function hasSessionKey(): boolean {
  return cachedKey !== null;
}
