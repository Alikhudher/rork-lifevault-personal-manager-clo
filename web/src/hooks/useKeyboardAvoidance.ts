import { useEffect, useRef, useState } from "react";
import { Keyboard } from "@capacitor/keyboard";

/**
 * On-screen keyboard inset in CSS pixels (0 when no keyboard is visible).
 *
 * In iOS WKWebView (Capacitor) the keyboard overlays the layout viewport
 * instead of resizing it, so `window.innerHeight` stays constant while the
 * keyboard is up. `visualViewport` reports the visible (un-occluded) region
 * and is the reliable cross-platform signal.
 */
function keyboardInsetFromViewport(): number {
  if (typeof window === "undefined" || !window.visualViewport) return 0;
  const vv = window.visualViewport;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

/**
 * Keyboard avoidance for inline (non-sheet) inputs.
 *
 * The app shell's main scroll container has no built-in keyboard handling, so
 * inline fields like the Profile → Monthly budget input can end up hidden
 * behind the soft keyboard on iOS. This hook:
 *
 *  - Tracks the keyboard height via `@capacitor/keyboard` events with a
 *    `visualViewport` fallback (works on web too).
 *  - Adds bottom padding to the scroll container equal to the keyboard height,
 *    so the user can always scroll the focused field above the keyboard.
 *  - Scrolls the focused input into view (centered) whenever the keyboard
 *    appears or the focused element changes while the keyboard is open.
 *
 * Two signals are combined for reliability:
 *  - @capacitor/keyboard events (native iOS/Android — exact keyboard height)
 *  - visualViewport resize/scroll (web + fallback)
 *
 * @returns a ref to attach to the scrollable container (e.g. `<main>`).
 */
export function useKeyboardAvoidance() {
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const scrollRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let kapShow: { remove: () => void } | undefined;
    let kapHide: { remove: () => void } | undefined;

    const updateFromViewport = () => {
      setKeyboardHeight(keyboardInsetFromViewport());
    };

    // Native keyboard events (Capacitor). These fire reliably inside the
    // iOS WKWebView where visualViewport can be delayed or batched.
    try {
      Keyboard.addListener("keyboardWillShow", (info) => {
        setKeyboardHeight(info.keyboardHeight);
      }).then((h) => {
        kapShow = h;
      });
      Keyboard.addListener("keyboardWillHide", () => {
        setKeyboardHeight(0);
      }).then((h) => {
        kapHide = h;
      });
    } catch {
      // Keyboard plugin not available (pure web) — visualViewport below covers it.
    }

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", updateFromViewport);
      vv.addEventListener("scroll", updateFromViewport);
    }

    return () => {
      if (vv) {
        vv.removeEventListener("resize", updateFromViewport);
        vv.removeEventListener("scroll", updateFromViewport);
      }
      kapShow?.remove();
      kapHide?.remove();
    };
  }, []);

  // When the keyboard appears (or focus changes while it's open), scroll the
  // focused input into view inside the scroll container so it isn't hidden
  // behind the keyboard. Also pads the container so there's room to scroll.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (keyboardHeight > 0) {
      container.style.paddingBottom = `${keyboardHeight + 24}px`;
    } else {
      container.style.paddingBottom = "";
    }

    if (keyboardHeight <= 0) return;
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return;
    if (!container.contains(el as Node)) return;

    // Defer until the padding/transform has been applied.
    const id = window.requestAnimationFrame(() => {
      (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [keyboardHeight]);

  // Re-scroll when focus moves to a new input while the keyboard is already up.
  useEffect(() => {
    if (keyboardHeight <= 0) return;
    const container = scrollRef.current;
    if (!container) return;

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (!container.contains(target)) return;
      const id = window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      rafIds.add(id);
    };

    const rafIds = new Set<number>();
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      rafIds.forEach((id) => window.cancelAnimationFrame(id));
      rafIds.clear();
    };
  }, [keyboardHeight]);

  return scrollRef;
}
