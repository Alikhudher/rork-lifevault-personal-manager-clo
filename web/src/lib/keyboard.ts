import { Keyboard, KeyboardResize } from "@capacitor/keyboard";

/**
 * Keeps the soft keyboard in "overlay" (none) resize mode.
 *
 * The app's bottom-sheet and inline-input keyboard avoidance relies on the
 * WebView staying at full size while the keyboard overlays it. If the native
 * resize mode were "native" or "body", `window.innerHeight` would shrink when
 * the keyboard appears, which breaks the translate-up math in `FormSheet` and
 * `useKeyboardAvoidance` (the viewport would be double-subtracted, hiding the
 * focused field behind the keyboard).
 *
 * This is a no-op on web (the Capacitor Keyboard plugin is only available on
 * native iOS/Android).
 */
export async function ensureKeyboardResizeNone(): Promise<void> {
  if (typeof window === "undefined") return;
  // Capacitor.platform is only defined in the native shell; on web the import
  // itself is inert but calling setResizeMode would throw, so guard with the
  // bridge availability check.
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.None });
  } catch {
    // Plugin unavailable or not native — ignore.
  }
}
