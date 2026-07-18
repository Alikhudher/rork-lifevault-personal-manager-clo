import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./index.css";
import { ensureKeyboardResizeNone } from "./lib/keyboard";

// Force the keyboard into "overlay" (none) resize mode at runtime. The
// Capacitor config also sets this, but setResizeMode is a hard guarantee that
// survives stale native projects / hand-edited Info.plist values, and it
// ensures the FormSheet keyboard-avoidance math is correct on every launch.
void ensureKeyboardResizeNone();

createRoot(document.getElementById("root")!).render(<App />);
