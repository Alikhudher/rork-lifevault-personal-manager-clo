/**
 * Stale-deployment auto-recovery.
 *
 * Production builds fingerprint every JS chunk (e.g. `index-Cveyf1ZK.js`).
 * Each redeploy rotates those hashes and deletes the old files, so a browser
 * tab still holding the previous HTML fails every lazy `import()` with
 * "TypeError: Failed to fetch dynamically imported module". Without recovery
 * the app just looks broken until the user manually reloads.
 *
 * This module converts that hard failure into ONE automatic reload — the
 * fresh HTML then points at the new chunk names and the app recovers. A
 * sessionStorage timestamp guards against reload loops: if chunks are still
 * failing right after a recovery reload (e.g. the network is actually down),
 * the error is allowed to surface instead of reload-spinning.
 */

export const STALE_CHUNK_GUARD_KEY = "lv-stale-chunk-reload-at";
const GUARD_WINDOW_MS = 30_000;

/** Cross-browser messages produced by a failed dynamic import / CSS preload. */
const STALE_CHUNK_PATTERNS: readonly RegExp[] = [
  /failed to fetch dynamically imported module/i, // Chrome / Edge
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /failed to load module script/i, // 404 → HTML served with wrong MIME
  /unable to preload css/i, // Vite CSS preload helper
];

type GuardStorage = Pick<Storage, "getItem" | "setItem">;

/** True when `reason` looks like a missing/rotated hashed-chunk failure. */
export function isStaleChunkError(reason: unknown): boolean {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "";
  if (!message) return false;
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * True when a recovery reload may be attempted now. Records the attempt
 * timestamp so a reload loop (failure → reload → same failure) stops after
 * one round trip per guard window.
 */
export function shouldAttemptReload(now: number, storage: GuardStorage): boolean {
  let last = 0;
  try {
    last = Number(storage.getItem(STALE_CHUNK_GUARD_KEY) ?? "0");
  } catch {
    last = 0;
  }
  if (Number.isFinite(last) && last > 0 && now - last < GUARD_WINDOW_MS) {
    return false;
  }
  try {
    storage.setItem(STALE_CHUNK_GUARD_KEY, String(now));
  } catch {
    // Storage unavailable — still allow this single attempt.
  }
  return true;
}

let installed = false;

interface RecoveryOptions {
  /** Injectable for tests; defaults to `window.location.reload()`. */
  reload?: () => void;
  /** Injectable for tests; defaults to `window.sessionStorage`. */
  storage?: GuardStorage;
}

/**
 * Install global handlers that turn stale-chunk failures into one automatic
 * reload. Idempotent; call once at boot, before anything loads lazily.
 */
export function installStaleChunkRecovery(options: RecoveryOptions = {}): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const reload = options.reload ?? (() => window.location.reload());
  const storage = options.storage ?? window.sessionStorage;

  const recover = (source: string, detail: unknown): boolean => {
    if (!shouldAttemptReload(Date.now(), storage)) {
      console.error(
        `[stale-chunk] ${source}: chunks still failing right after a recovery reload — not looping. Original error:`,
        detail,
      );
      return false;
    }
    console.warn(
      `[stale-chunk] ${source}: a hashed chunk from a previous deployment is gone — reloading once to pick up the new build.`,
    );
    reload();
    return true;
  };

  // Vite dispatches this for every failed dynamic import / CSS preload.
  window.addEventListener("vite:preloadError", (event: Event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (recover("vite:preloadError", payload)) {
      event.preventDefault(); // suppress the re-throw; the reload takes over
    }
  });

  // Belt and braces: import() rejections that bypass Vite's preload helper
  // (e.g. Capacitor's lazily loaded web plugin implementations).
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    if (!isStaleChunkError(event.reason)) return;
    if (recover("unhandledrejection", event.reason)) {
      event.preventDefault();
    }
  });
}

/** Test-only: reset the install latch so each test gets a fresh install. */
export function resetStaleChunkRecoveryForTests(): void {
  installed = false;
}
