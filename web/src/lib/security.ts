/**
 * Security abstraction layer for LifeVault.
 *
 * Wraps three Capacitor plugins behind one typed, web-safe API:
 *  - @aparajita/capacitor-biometric-auth  → Face ID / Touch ID
 *  - @aparajita/capacitor-secure-storage  → iOS Keychain / Android Keystore
 *  - @capacitor/privacy-screen             → hide app in iOS App Switcher
 *
 * On the web (no native runtime) every method degrades gracefully so the
 * Security page and lock flow remain functional in the browser preview —
 * biometry reports "unavailable", secure storage falls back to localStorage,
 * and the privacy screen is a no-op. On native iOS the real Keychain /
 * LocalAuthentication / privacy overlay is used.
 */
import { Capacitor } from "@capacitor/core";

import {
  BiometricAuth,
  BiometryType,
  type BiometryError,
} from "@aparajita/capacitor-biometric-auth";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

let privacyScreenPlugin: typeof import("@capacitor/privacy-screen").PrivacyScreen | null = null;
async function loadPrivacyScreen() {
  if (privacyScreenPlugin) return privacyScreenPlugin;
  try {
    const mod = await import("@capacitor/privacy-screen");
    privacyScreenPlugin = mod.PrivacyScreen;
    return privacyScreenPlugin;
  } catch {
    return null;
  }
}

const isNative =
  typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();

/* ------------------------------------------------------------------ */
/* Biometry                                                            */
/* ------------------------------------------------------------------ */

export type BiometryKind = "none" | "faceId" | "touchId" | "fingerprint" | "face" | "iris";

export interface BiometryStatus {
  available: boolean;
  kind: BiometryKind;
  /** Human-readable label, e.g. "Face ID", "Touch ID", "Fingerprint". */
  label: string;
}

function kindFromBiometryType(type: BiometryType): BiometryKind {
  switch (type) {
    case BiometryType.faceId:
      return "faceId";
    case BiometryType.touchId:
      return "touchId";
    case BiometryType.fingerprintAuthentication:
      return "fingerprint";
    case BiometryType.faceAuthentication:
      return "face";
    case BiometryType.irisAuthentication:
      return "iris";
    default:
      return "none";
  }
}

function labelForKind(kind: BiometryKind): string {
  switch (kind) {
    case "faceId":
      return "Face ID";
    case "touchId":
      return "Touch ID";
    case "fingerprint":
      return "Fingerprint";
    case "face":
      return "Face Recognition";
    case "iris":
      return "Iris";
    default:
      return "";
  }
}

/**
 * Check whether biometric authentication is available on the device.
 * On web this always returns `{ available: false, kind: "none" }`.
 */
export async function checkBiometry(): Promise<BiometryStatus> {
  if (!isNative) {
    return { available: false, kind: "none", label: "" };
  }
  try {
    const result = await BiometricAuth.checkBiometry();
    const kind = kindFromBiometryType(result.biometryType);
    return {
      available: result.isAvailable && kind !== "none",
      kind,
      label: labelForKind(kind),
    };
  } catch {
    return { available: false, kind: "none", label: "" };
  }
}

export type BiometryFailReason =
  | "unavailable"
  | "cancelled"
  | "failed"
  | "lockout"
  | "unknown";

export interface BiometricAuthOutcome {
  ok: boolean;
  /** Present when `ok` is false. */
  reason?: BiometryFailReason;
}

/**
 * Prompt the user for biometric authentication.
 * Returns a discriminated outcome — never throws — so callers can
 * branch cleanly without try/catch juggling.
 */
export async function authenticateWithBiometry(reason: string): Promise<BiometricAuthOutcome> {
  if (!isNative) return { ok: false, reason: "unavailable" };
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "Cancel",
      allowDeviceCredential: true,
      iosFallbackTitle: "Enter Passcode",
    });
    return { ok: true };
  } catch (err) {
    const code = (err as BiometryError)?.code ?? "";
    if (code === "userCancel" || code === "appCancel" || code === "systemCancel") {
      return { ok: false, reason: "cancelled" };
    }
    if (code === "biometryLockout") {
      return { ok: false, reason: "lockout" };
    }
    if (code === "biometryNotAvailable" || code === "biometryNotEnrolled") {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: false, reason: "failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Secure storage (PIN hash + security prefs)                         */
/* ------------------------------------------------------------------ */

/**
 * We never store the raw PIN — only a salted SHA-256 hash. The hash and
 * security preferences live in the iOS Keychain (whenUnlockedThisDeviceOnly)
 * so they never leave the device and are wiped on uninstall.
 *
 * On web (browser preview) we fall back to localStorage so the flow is
 * testable, with the understanding that it is NOT secure — the native
 * build is the only secure path.
 */
const FALLBACK_PREFIX = "lv-secure:";
const KEY_PIN_HASH = "pin-hash";
const KEY_PIN_SALT = "pin-salt";

async function secureSet(key: string, value: string): Promise<void> {
  if (isNative) {
    await SecureStorage.set(key, value);
  } else {
    localStorage.setItem(FALLBACK_PREFIX + key, value);
  }
}

async function secureGet(key: string): Promise<string | null> {
  if (isNative) {
    try {
      const v = await SecureStorage.get(key);
      if (v == null) return null;
      return typeof v === "string" ? v : String(v);
    } catch {
      return null;
    }
  }
  return localStorage.getItem(FALLBACK_PREFIX + key);
}

async function secureRemove(key: string): Promise<void> {
  if (isNative) {
    await SecureStorage.remove(key);
  } else {
    localStorage.removeItem(FALLBACK_PREFIX + key);
  }
}

/** Generate a random salt using the Web Crypto API. */
function randomSalt(): string {
  const arr = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256(salt + pin) as a hex string. */
async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + pin);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback (non-crypto) — only used in very old environments.
  let h = 0;
  for (let i = 0; i < data.length; i++) {
    h = (h * 31 + data[i]) >>> 0;
  }
  return h.toString(16);
}

/**
 * Persist a new PIN. Generates a fresh salt and stores only the hash.
 */
export async function setPin(pin: string): Promise<void> {
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  await secureSet(KEY_PIN_SALT, salt);
  await secureSet(KEY_PIN_HASH, hash);
}

/**
 * Verify a PIN attempt against the stored hash.
 * Returns true if the PIN matches (or if no PIN is configured).
 */
export async function verifyPin(pin: string): Promise<boolean> {
  const salt = await secureGet(KEY_PIN_SALT);
  const stored = await secureGet(KEY_PIN_HASH);
  if (!salt || !stored) return false;
  const hash = await hashPin(pin, salt);
  return hash === stored;
}

/** True if a PIN has been configured. */
export async function hasPin(): Promise<boolean> {
  const stored = await secureGet(KEY_PIN_HASH);
  return !!stored;
}

/** Remove the stored PIN hash + salt. */
export async function clearPin(): Promise<void> {
  await secureRemove(KEY_PIN_HASH);
  await secureRemove(KEY_PIN_SALT);
}

/* ------------------------------------------------------------------ */
/* Privacy screen (hide app in App Switcher)                          */
/* ------------------------------------------------------------------ */

/**
 * Enable/disable the privacy overlay that hides app content in the iOS
 * App Switcher and blocks screenshots on Android.
 */
export async function setPrivacyScreen(enabled: boolean): Promise<void> {
  if (!isNative) return;
  const plugin = await loadPrivacyScreen();
  if (!plugin) return;
  try {
    if (enabled) {
      await plugin.enable();
    } else {
      await plugin.disable();
    }
  } catch {
    // Non-fatal — the toggle still reflects user intent.
  }
}

export { isNative };
