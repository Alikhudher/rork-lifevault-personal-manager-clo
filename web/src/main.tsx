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

// Suppress cross-origin "Script error." reports that originate from preview
// environment injected scripts (e.g. React Grab). Browsers report these as the
// literal string "Script error." with no stack trace due to same-origin policy.
// They are not app bugs and should not surface as runtime errors.
if (typeof window !== "undefined") {
  const isCrossOriginScriptError = (message: unknown): boolean =>
    typeof message === "string" && message.toLowerCase().startsWith("script error");

  window.addEventListener("error", (event: ErrorEvent) => {
    if (isCrossOriginScriptError(event.message) && event.filename === "" && event.lineno === 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    if (isCrossOriginScriptError(event.reason)) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
