import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { Capacitor } from "@capacitor/core";

/**
 * Central soft-keyboard manager.
 *
 * One place owns keyboard tracking for the whole app so every surface
 * (bottom sheets, inline page inputs, auth screens) reacts consistently:
 *
 *  - Merges two signals: `@capacitor/keyboard` native events (exact height,
 *    fires early inside the iOS WKWebView) and `visualViewport` resize/scroll
 *    (web + fallback, also corrects the value once the animation settles).
 *  - Publishes the keyboard inset as a CSS variable (`--keyboard-inset`) and
 *    a `data-keyboard` attribute on <html> for style-level consumers.
 *  - Provides interactive keyboard dismissal: dragging downward over content
 *    while the keyboard is open blurs the field and hides the keyboard, the
 *    same gesture iOS users expect from Messages/Notes.
 *
 * The app runs with Capacitor `Keyboard.resize = None`, so the keyboard
 * OVERLAYS the layout viewport instead of resizing it: `window.innerHeight`
 * stays constant while the keyboard is up, and `visualViewport` reports the
 * visible (un-occluded) region.
 */

export interface KeyboardState {
  /** Height in CSS px of the keyboard overlaying the viewport (0 = hidden). */
  inset: number;
  /** Height in CSS px of the visible (un-occluded) viewport. */
  viewportHeight: number;
}

type KeyboardListener = (state: KeyboardState) => void;

const listeners = new Set<KeyboardListener>();

let state: KeyboardState = {
  inset: 0,
  viewportHeight: typeof window !== "undefined" ? window.innerHeight : 0,
};

let trackingStarted = false;
let dismissInstalled = false;

/**
 * Last state reported by the NATIVE keyboard events. On iOS with
 * `Keyboard.resize = None` the WKWebView is never resized, so
 * `visualViewport` frequently does NOT shrink when the keyboard opens —
 * but it still fires resize/scroll events (focus scrolling, relayout).
 * If those events were allowed to overwrite the inset, they would
 * clobber the correct native height with 0 and drop keyboard-avoiding
 * sheets back BEHIND the keyboard (the exact Build 12 bug on iPhone).
 * While the native plugin says the keyboard is visible, its height is
 * authoritative; visualViewport can only ever refine it upward.
 */
let nativeKeyboardVisible = false;
let nativeKeyboardHeight = 0;

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function insetFromViewport(): number {
  if (typeof window === "undefined" || !window.visualViewport) return 0;
  const vv = window.visualViewport;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

/** Merge the native and visualViewport signals into one truthful state. */
function computeState(): KeyboardState {
  if (typeof window === "undefined") return { inset: 0, viewportHeight: 0 };
  const vvInset = insetFromViewport();
  const inset = nativeKeyboardVisible ? Math.max(nativeKeyboardHeight, vvInset) : vvInset;
  return { inset, viewportHeight: Math.max(0, window.innerHeight - inset) };
}

function publish(next: KeyboardState): void {
  state = next;
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty(
      "--keyboard-inset",
      `${Math.round(next.inset)}px`,
    );
    document.documentElement.toggleAttribute("data-keyboard", next.inset > 0);
  }
  listeners.forEach((listener) => listener(state));
}

function startTracking(): void {
  if (trackingStarted || typeof window === "undefined") return;
  trackingStarted = true;

  const republish = () => publish(computeState());

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", republish);
    vv.addEventListener("scroll", republish);
  }
  window.addEventListener("resize", republish);

  if (isNative()) {
    // Native events fire before the animation, giving the exact height even
    // when visualViewport never reflects the keyboard (WKWebView with
    // resize=None). They flip the authoritative flags; every publish path
    // goes through computeState so later viewport events can never zero
    // out the inset while the keyboard is still open.
    Keyboard.addListener("keyboardWillShow", (info) => {
      nativeKeyboardVisible = true;
      nativeKeyboardHeight = Math.max(0, info.keyboardHeight);
      republish();
    }).catch(() => {
      // Plugin unavailable — visualViewport covers it.
    });
    Keyboard.addListener("keyboardWillHide", () => {
      nativeKeyboardVisible = false;
      nativeKeyboardHeight = 0;
      republish();
    }).catch(() => {
      // Plugin unavailable — visualViewport covers it.
    });
  }

  republish();
}

/** Current keyboard state (synchronous snapshot). */
export function getKeyboardState(): KeyboardState {
  return state;
}

/**
 * Subscribe to keyboard inset changes. Fires immediately with the current
 * state and on every subsequent change. Returns an unsubscribe function.
 */
export function subscribeKeyboard(listener: KeyboardListener): () => void {
  startTracking();
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

function isEditable(el: unknown): el is HTMLElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/** Blur the focused field and hide the native keyboard. */
export function dismissKeyboard(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && isEditable(active)) {
    active.blur();
  }
  if (isNative()) {
    Keyboard.hide().catch(() => {
      // Plugin unavailable — blur alone is enough on web.
    });
  }
}

/**
 * Interactive keyboard dismissal: while the keyboard is open, a deliberate
 * downward drag over content (not inside the focused field itself, so
 * scrolling long textareas still works) dismisses the keyboard — matching
 * the native iOS scroll-to-dismiss gesture. Install once at startup.
 */
export function installInteractiveKeyboardDismiss(): void {
  if (dismissInstalled || typeof window === "undefined") return;
  dismissInstalled = true;
  startTracking();

  let startX = 0;
  let startY = 0;
  let tracking = false;

  window.addEventListener(
    "touchstart",
    (e) => {
      tracking = false;
      if (state.inset <= 0) return;
      const touch = e.touches[0];
      if (!touch) return;
      // Drags that start inside the focused field (text selection, textarea
      // scrolling) should never dismiss.
      const active = document.activeElement;
      if (
        e.target instanceof Node &&
        active instanceof HTMLElement &&
        isEditable(active) &&
        active.contains(e.target)
      ) {
        return;
      }
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    },
    { passive: true },
  );

  window.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking || state.inset <= 0) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dy = touch.clientY - startY;
      const dx = Math.abs(touch.clientX - startX);
      // Mostly-vertical downward drag past a small threshold.
      if (dy > 28 && dy > dx * 1.4) {
        tracking = false;
        dismissKeyboard();
      }
    },
    { passive: true },
  );

  window.addEventListener(
    "touchend",
    () => {
      tracking = false;
    },
    { passive: true },
  );
}

/**
 * Keeps the soft keyboard in "overlay" (none) resize mode.
 *
 * All keyboard avoidance math relies on the WebView staying at full size
 * while the keyboard overlays it. If the native resize mode were "native" or
 * "body", `window.innerHeight` would shrink AND we'd translate content up,
 * double-offsetting and hiding the focused field. No-op on plain web.
 */
export async function ensureKeyboardResizeNone(): Promise<void> {
  if (!isNative()) return;
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.None });
  } catch {
    // Plugin unavailable — ignore.
  }
}
