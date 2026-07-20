import { useEffect, useRef, useState } from "react";
import { subscribeKeyboard } from "@/lib/keyboard";

/**
 * Keyboard avoidance for inline (non-sheet) inputs.
 *
 * Screens render inside a page-level scroll container with no built-in
 * keyboard handling, so inline fields (Profile → Monthly budget, AI search,
 * sign-in forms…) can end up hidden behind the soft keyboard on iOS. This
 * hook:
 *
 *  - Tracks the keyboard inset via the central keyboard manager
 *    (`@capacitor/keyboard` native events + `visualViewport` fallback).
 *  - Adds bottom padding to the scroll container equal to the keyboard
 *    height plus the iOS safe area, so the user can always scroll the
 *    focused field above the keyboard.
 *  - Scrolls the focused input into view (centered) whenever the keyboard
 *    appears or the focused element changes while the keyboard is open.
 *
 * @returns a ref to attach to the scrollable container (e.g. `<main>`).
 */
export function useKeyboardAvoidance<T extends HTMLElement = HTMLElement>() {
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const scrollRef = useRef<T | null>(null);

  useEffect(
    () => subscribeKeyboard((state) => setKeyboardHeight(state.inset)),
    [],
  );

  // When the keyboard appears (or focus changes while it's open), scroll the
  // focused input into view inside the scroll container so it isn't hidden
  // behind the keyboard. Also pads the container so there's room to scroll.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (keyboardHeight > 0) {
      container.style.paddingBottom = `calc(${keyboardHeight + 24}px + env(safe-area-inset-bottom, 0px))`;
    } else {
      container.style.paddingBottom = "";
    }

    if (keyboardHeight <= 0) return;
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return;
    if (!container.contains(el as Node)) return;

    // Defer until the padding has been applied.
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

    const rafIds = new Set<number>();
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (!container.contains(target)) return;
      const id = window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      rafIds.add(id);
    };

    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      rafIds.forEach((id) => window.cancelAnimationFrame(id));
      rafIds.clear();
    };
  }, [keyboardHeight]);

  return scrollRef;
}
