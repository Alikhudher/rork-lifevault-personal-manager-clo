/**
 * Suppress cross-origin "Script error." in the Rork preview environment.
 *
 * The preview iframe injects monitoring scripts (React Grab) from a
 * different origin. Those scripts overwrite `window.onerror` with their
 * own handler that reports errors back to the preview UI. When a
 * cross-origin script throws, the browser reports a generic
 * "Script error." (no filename, line 0, col 0) — the real details are
 * hidden by the same-origin policy.
 *
 * The inline `<script>` in `index.html` installs a handler, but React
 * Grab overwrites it when it loads. This module runs as a deferred ES
 * module (after React Grab), so wrapping `window.onerror` here makes
 * our filter the final handler — it can suppress "Script error."
 * before React Grab's handler (now chained) reports it.
 *
 * This is a no-op in production (native iOS/Android) — there's no
 * preview iframe or React Grab there.
 */

function isScriptError(msg: unknown): boolean {
  if (typeof msg === "string") {
    return msg.toLowerCase() === "script error.";
  }
  return false;
}

/**
 * Wrap the current `window.onerror` so "Script error." is suppressed
 * before reaching the preview system's handler. Must be called after
 * React Grab has installed its own handler.
 */
export function installScriptErrorSuppression(): void {
  if (typeof window === "undefined") return;

  // Save whatever handler is currently installed (React Grab's, ours,
  // or null).
  const prevHandler = window.onerror;

  window.onerror = function (
    msg: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error,
  ) {
    // Suppress cross-origin "Script error." — return true to prevent
    // default handling and propagation.
    if (isScriptError(msg)) {
      return true;
    }
    // Chain to the previous handler (React Grab etc.) for real errors.
    if (typeof prevHandler === "function") {
      return prevHandler.call(
        this,
        msg,
        source,
        lineno,
        colno,
        error,
      );
    }
    return false;
  };

  // Also catch unhandled promise rejections with the same signature.
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "";
    if (msg && msg.toLowerCase() === "script error.") {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });
}
