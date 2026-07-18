/// <reference types="@capacitor/keyboard" />
import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.aliomer.lifevault',
  appName: 'LifeVault',
  webDir: 'dist',
  plugins: {
    Keyboard: {
      // Keep the WebView at full size when the keyboard appears so the soft
      // keyboard *overlays* the viewport rather than resizing it. This matches
      // our bottom-sheet keyboard-avoidance logic (FormSheet + useKeyboardAvoidance),
      // which moves content up by the exact keyboard height. With the default
      // "native" mode the WebView shrinks AND we translate up, causing a
      // double offset that hides the focused field behind the keyboard.
      resize: KeyboardResize.None,
    },
  },
};

export default config;
