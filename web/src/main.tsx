import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./index.css";
import { ensureKeyboardResizeNone, installInteractiveKeyboardDismiss } from "./lib/keyboard";
import { installStaleChunkRecovery } from "./lib/stale-chunk-recovery";
import { installScriptErrorSuppression } from "./lib/script-error-suppression";

// Every deploy rotates the hashed chunk filenames; a tab still holding the
// previous HTML then fails lazy imports with "Failed to fetch dynamically
// imported module". Install recovery FIRST so any such failure triggers one
// automatic reload onto the fresh build instead of a dead app.
installStaleChunkRecovery();

// Suppress cross-origin "Script error." reported by the preview iframe's
// monitoring scripts (React Grab). This module runs as a deferred ES module,
// so it executes AFTER React Grab has installed its own window.onerror —
// wrapping it makes our filter the final handler. No-op in production.
installScriptErrorSuppression();

// Force the keyboard into "overlay" (none) resize mode at runtime. The
// Capacitor config also sets this, but setResizeMode is a hard guarantee that
// survives stale native projects / hand-edited Info.plist values, and it
// ensures the keyboard-avoidance math is correct on every launch.
void ensureKeyboardResizeNone();

// Interactive keyboard dismissal: dragging down over content while the
// keyboard is open blurs the field and hides the keyboard (iOS-style).
installInteractiveKeyboardDismiss();

createRoot(document.getElementById("root")!).render(<App />);
