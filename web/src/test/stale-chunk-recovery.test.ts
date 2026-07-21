/**
 * @vitest-environment jsdom
 *
 * Regression tests for the stale-deployment auto-recovery.
 *
 * Reported bug: after a redeploy rotated the hashed chunk filenames, the
 * preview showed "TypeError: Failed to fetch dynamically imported module:
 * …/assets/index-Cveyf1ZK.js" and the app stayed broken until a manual
 * reload. The recovery module must reload exactly once (no loops) and
 * suppress the error it recovered from.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  STALE_CHUNK_GUARD_KEY,
  installStaleChunkRecovery,
  isStaleChunkError,
  resetStaleChunkRecoveryForTests,
  shouldAttemptReload,
} from "@/lib/stale-chunk-recovery";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

beforeEach(() => {
  resetStaleChunkRecoveryForTests();
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("isStaleChunkError", () => {
  it("matches the exact reported Chrome error", () => {
    const reported = new TypeError(
      "Failed to fetch dynamically imported module: https://tg4z1lk4x1ksb946nhhn6-web.rork.live/assets/index-Cveyf1ZK.js",
    );
    expect(isStaleChunkError(reported)).toBe(true);
  });

  it("matches Firefox, Safari and Vite CSS preload variants", () => {
    expect(
      isStaleChunkError(new TypeError("error loading dynamically imported module: https://app/assets/web-abc.js")),
    ).toBe(true);
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError(new Error("Failed to load module script: Expected a JavaScript module"))).toBe(true);
    expect(isStaleChunkError(new Error("Unable to preload CSS for /assets/index-Lj69G2aZ.css"))).toBe(true);
    expect(isStaleChunkError("Failed to fetch dynamically imported module: /assets/x.js")).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch"))).toBe(false); // plain network error
    expect(isStaleChunkError(new Error("row-level security violation"))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError({ message: 42 })).toBe(false);
  });
});

describe("shouldAttemptReload", () => {
  it("allows one attempt per guard window and records the timestamp", () => {
    const storage = memoryStorage();
    expect(shouldAttemptReload(1_000, storage)).toBe(true);
    expect(storage.getItem(STALE_CHUNK_GUARD_KEY)).toBe("1000");
    // Right after the reload → guard active, no loop.
    expect(shouldAttemptReload(10_000, storage)).toBe(false);
    // After the window elapses a fresh attempt is allowed again.
    expect(shouldAttemptReload(31_001, storage)).toBe(true);
    expect(storage.getItem(STALE_CHUNK_GUARD_KEY)).toBe("31001");
  });

  it("still allows the attempt when storage is unavailable", () => {
    const throwing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(shouldAttemptReload(1_000, throwing)).toBe(true);
  });

  it("ignores corrupt stored values", () => {
    const storage = memoryStorage();
    storage.setItem(STALE_CHUNK_GUARD_KEY, "not-a-number");
    expect(shouldAttemptReload(1_000, storage)).toBe(true);
  });
});

describe("installStaleChunkRecovery", () => {
  it("reloads once on vite:preloadError, suppresses the error, and never loops", () => {
    const reload = vi.fn();
    installStaleChunkRecovery({ reload, storage: memoryStorage() });

    const first = new CustomEvent("vite:preloadError", { cancelable: true });
    Object.assign(first, {
      payload: new TypeError("Failed to fetch dynamically imported module: https://app/assets/index-old.js"),
    });
    window.dispatchEvent(first);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    // A second failure immediately after must NOT reload again — and the
    // error is allowed to surface (not prevented).
    const second = new CustomEvent("vite:preloadError", { cancelable: true });
    window.dispatchEvent(second);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });

  it("reloads on stale-chunk unhandled rejections but ignores unrelated ones", () => {
    const reload = vi.fn();
    installStaleChunkRecovery({ reload, storage: memoryStorage() });

    const unrelated = new Event("unhandledrejection", { cancelable: true }) as Event & { reason?: unknown };
    unrelated.reason = new Error("Invalid login credentials");
    window.dispatchEvent(unrelated);
    expect(reload).not.toHaveBeenCalled();
    expect(unrelated.defaultPrevented).toBe(false);

    const stale = new Event("unhandledrejection", { cancelable: true }) as Event & { reason?: unknown };
    stale.reason = new TypeError(
      "Failed to fetch dynamically imported module: https://tg4z1lk4x1ksb946nhhn6-web.rork.live/assets/index-Cveyf1ZK.js",
    );
    window.dispatchEvent(stale);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(stale.defaultPrevented).toBe(true);
  });
});
