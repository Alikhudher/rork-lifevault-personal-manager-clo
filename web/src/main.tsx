import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./index.css";
import { ensureKeyboardResizeNone, installInteractiveKeyboardDismiss } from "./lib/keyboard";
import { installStaleChunkRecovery } from "./lib/stale-chunk-recovery";

// Every deploy rotates the hashed chunk filenames; a tab still holding the
// previous HTML then fails lazy imports with "Failed to fetch dynamically
// imported module". Install recovery FIRST so any such failure triggers one
// automatic reload onto the fresh build instead of a dead app.
installStaleChunkRecovery();

// Force the keyboard into "overlay" (none) resize mode at runtime. The
// Capacitor config also sets this, but setResizeMode is a hard guarantee that
// survives stale native projects / hand-edited Info.plist values, and it
// ensures the keyboard-avoidance math is correct on every launch.
void ensureKeyboardResizeNone();

// Interactive keyboard dismissal: dragging down over content while the
// keyboard is open blurs the field and hides the keyboard (iOS-style).
installInteractiveKeyboardDismiss();

/* ── Cross-origin "Script error." suppression ──────────────────────────
 *
 * The preview environment injects monitoring scripts (e.g. React Grab)
 * from a different origin. Browsers report any error from those scripts
 * as the literal string "Script error." with no stack trace, due to
 * same-origin policy. These are NOT app bugs but the preview system
 * surfaces them as runtime errors.
 *
 * We suppress them at every entry point:
 *  1.  window.onerror  — property-style handler (set directly so it runs
 *      before/instead of any default handler the preview injects).
 *  2.  capture-phase 'error' listener — catches errors from script tags
 *      and dynamic imports.
 *  3.  'unhandledrejection' listener — catches promise rejections whose
 *      reason is or contains "Script error." (string OR Error object).
 */
const SCRIPT_ERROR_RE = /^script error\.?$/i;

/** True when the value is a string or Error whose message is "Script error." */
function isScriptError(value: unknown): boolean {
  if (typeof value === "string") return SCRIPT_ERROR_RE.test(value.trim());
  if (value instanceof Error) return SCRIPT_ERROR_RE.test(value.message.trim());
  if (value && typeof value === "object" && "message" in value) {
    const msg = (value as { message: unknown }).message;
    return typeof msg === "string" && SCRIPT_ERROR_RE.test(msg.trim());
  }
  return false;
}

if (typeof window !== "undefined") {
  // 1 — property-style handler (highest priority for uncaught errors)
  const originalOnError = window.onerror;
  window.onerror = function (
    message: string | Event,
    source: string | undefined,
    lineno: number | undefined,
    colno: number | undefined,
    error: Error | undefined,
  ): boolean {
    const msg = typeof message === "string" ? message : "";
    if (SCRIPT_ERROR_RE.test(msg.trim()) || isScriptError(error) || (msg === "" && (source === "" || source === undefined) && (lineno === 0 || lineno === undefined))) {
      return true; // suppress default handling
    }
    if (typeof originalOnError === "function") {
      return Boolean(originalOnError.call(window, message, source, lineno, colno, error));
    }
    return false;
  };

  // 2 — capture-phase listener for ErrorEvent from scripts / dynamic imports
  window.addEventListener("error", (event: ErrorEvent) => {
    if (isScriptError(event.message) || isScriptError(event.error) || (event.message === "Script error." && (event.filename === "" || event.lineno === 0))) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }, true);

  // 3 — unhandled promise rejections whose reason is or wraps "Script error."
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    if (isScriptError(event.reason)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }, true);
}

createRoot(document.getElementById("root")!).render(<App />);
