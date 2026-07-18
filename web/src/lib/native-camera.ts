/**
 * Shared native camera / photo-library capture utility.
 *
 * Uses the Capacitor Camera plugin's v8.1+ API (`takePhoto` / `chooseFromGallery`)
 * instead of the deprecated `getPhoto`. The deprecated `getPhoto` had a well-known
 * iOS camera race condition (GitHub issue #1996): on the first call, iOS shows the
 * permission dialog *while* the camera tries to initialize, so the camera preview
 * fails to start and the call rejects silently; on the second attempt the
 * permission is already granted and it works. `getPhoto` with `CameraSource.Photos`
 * also silently fails on some iOS versions instead of showing the permission
 * dialog. The new `takePhoto` / `chooseFromGallery` methods handle permissions
 * correctly internally — no pre-requesting needed, no race.
 *
 * The new API returns a `MediaResult` with `uri` (native) or `thumbnail` /
 * `webPath` (web). On native, `thumbnail` is only a small preview, so to get the
 * full-resolution image we read `uri` via `@capacitor/filesystem` and construct a
 * data URL. On web, `thumbnail` contains the full base64-encoded image.
 *
 * Both capture paths return a JPEG data URL (`data:image/jpeg;base64,...`) so the
 * caller (profile photo picker, AI scanner) can use it directly.
 */
import { Capacitor } from "@capacitor/core";
import {
  Camera,
  CameraErrorCode,
  CameraPermissionState,
  MediaTypeSelection,
  type MediaResult,
} from "@capacitor/camera";
import { Filesystem } from "@capacitor/filesystem";
import { toast } from "sonner";

export type CaptureSource = "camera" | "photos";

const isNativePlatform = (): boolean =>
  typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();

/**
 * Read a native `MediaResult.uri` into a JPEG data URL via the Filesystem plugin.
 * Only used on native platforms where `thumbnail` is a low-res preview.
 */
async function readUriAsDataUrl(uri: string): Promise<string> {
  // `Filesystem.readFile` returns base64 when `directory` is omitted and the
  // path is a fully-qualified Capacitor URI (which `MediaResult.uri` is).
  const { data } = await Filesystem.readFile({ path: uri });
  // `data` is a string (base64) on native. Guard just in case.
  const base64 = typeof data === "string" ? data : await blobToBase64(data as Blob);
  return `data:image/jpeg;base64,${base64}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip any data: prefix the reader may have added.
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("BLOB_READ_FAILED"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Show a permission-denied toast with a one-tap shortcut to the system Settings
 * page (Apple's `app-settings:` URL scheme). Only meaningful on native iOS.
 */
function showPermissionDeniedToast(source: CaptureSource): void {
  const what = source === "camera" ? "Camera" : "Photo library";
  toast.error(`${what} access denied`, {
    description: "Enable it in Settings to use this feature.",
    action: {
      label: "Open settings",
      onClick: () => {
        try {
          window.location.href = "app-settings:";
        } catch {
          /* ignore */
        }
      },
    },
  });
}

/**
 * Map a Capacitor Camera error code (OS-PLUG-CAMR-*) to a user-facing action.
 * Returns:
 *  - "silent"            → user cancelled, no toast.
 *  - "permission-denied" → permission denied toast already shown.
 *  - string              → user-facing error message to toast.
 *  - null                → unexpected, caller shows generic message.
 */
function classifyCameraError(err: unknown, source: CaptureSource): "silent" | "permission-denied" | string | null {
  const code =
    (err as { code?: string })?.code ??
    (err instanceof Error ? err.message : String(err));
  const lower = String(code).toLowerCase();

  // User cancelled — silent.
  if (
    code === CameraErrorCode.TakePhotoCancelled ||
    /cancel/i.test(lower)
  ) {
    return "silent";
  }

  // Permission denied — show the Settings shortcut toast.
  if (
    code === CameraErrorCode.CameraPermissionDenied ||
    code === CameraErrorCode.GalleryPermissionDenied ||
    /denied|permission/i.test(lower)
  ) {
    showPermissionDeniedToast(source);
    return "permission-denied";
  }

  // No camera hardware.
  if (
    code === CameraErrorCode.NoCameraAvailable ||
    /no camera|unavailable|not available/i.test(lower)
  ) {
    return "No camera available on this device.";
  }

  return null;
}

/**
 * Pre-check + request permission for a capture source. The v8.1+ methods handle
 * permissions internally, but we still pre-check so that an already-denied state
 * (which iOS will NOT re-prompt) routes straight to the Settings toast instead
 * of calling the native method and getting a confusing rejection.
 *
 * Returns true if it's safe to proceed (granted / limited / prompt→granted /
 * unknown), false if denied (toast already shown).
 */
async function ensurePermission(source: CaptureSource): Promise<boolean> {
  try {
    const status = await Camera.checkPermissions();
    const current: CameraPermissionState =
      source === "camera" ? status.camera : status.photos;

    if (current === "denied") {
      showPermissionDeniedToast(source);
      return false;
    }

    if (current === "prompt") {
      const requested = await Camera.requestPermissions({
        permissions: [source],
      });
      const next: CameraPermissionState =
        source === "camera" ? requested.camera : requested.photos;
      if (next === "denied") {
        showPermissionDeniedToast(source);
        return false;
      }
      // granted | limited | unknown → proceed
      return true;
    }

    // granted | limited | unknown → proceed
    return true;
  } catch {
    // checkPermissions can throw on older runtimes — fall through to the
    // native method, which prompts internally as a last resort.
    return true;
  }
}

/**
 * Convert a `MediaResult` from the v8.1+ API into a JPEG data URL.
 *
 * - Native: read `uri` via Filesystem for full resolution.
 * - Web: `thumbnail` already contains the full base64-encoded image.
 *
 * `thumbnail` on native is a low-res preview, so we prefer `uri` there.
 */
async function mediaResultToDataUrl(result: MediaResult): Promise<string> {
  // Native path — full resolution via Filesystem.
  if (isNativePlatform() && result.uri) {
    return readUriAsDataUrl(result.uri);
  }
  // Web path — thumbnail is the full image.
  if (result.thumbnail) {
    // `thumbnail` is base64 without a data: prefix on web.
    return result.thumbnail.startsWith("data:")
      ? result.thumbnail
      : `data:image/jpeg;base64,${result.thumbnail}`;
  }
  // Last-resort: fetch webPath and convert. This is async-heavy but ensures
  // we never return null when the plugin gave us *something*.
  if (result.webPath) {
    const res = await fetch(result.webPath);
    const blob = await res.blob();
    const base64 = await blobToBase64(blob);
    return `data:image/jpeg;base64,${base64}`;
  }
  throw new Error("NO_IMAGE_DATA");
}

/**
 * Capture an image from the camera or photo library.
 *
 * On native iOS uses the v8.1+ `takePhoto` / `chooseFromGallery` methods, which
 * handle permissions correctly internally (no first-call race condition).
 * Pre-checks permission only to route already-denied users straight to the
 * Settings shortcut. Returns a JPEG data URL, or `null` if the user cancelled or
 * an error was already surfaced via toast.
 *
 * On web, falls back to a hidden file input (`capture` for camera).
 *
 * @param source  "camera" to take a new photo, "photos" to pick from the library.
 * @param maxEdge Optional max edge (px) for the captured image. Only applies on
 *                native (passed as `targetWidth`/`targetHeight`).
 */
export async function captureImage(
  source: CaptureSource,
  maxEdge?: number,
): Promise<string | null> {
  if (isNativePlatform()) {
    const granted = await ensurePermission(source);
    if (!granted) return null;

    try {
      let result: MediaResult;
      if (source === "camera") {
        result = await Camera.takePhoto({
          quality: 92,
          correctOrientation: true,
          saveToGallery: false,
          // `editable` replaces the old `allowEditing`. Use in-app editing so
          // the user can crop on iOS (external isn't supported on iOS anyway).
          editable: "in-app",
          ...(maxEdge
            ? { targetWidth: maxEdge, targetHeight: maxEdge }
            : {}),
        });
      } else {
        const { results } = await Camera.chooseFromGallery({
          mediaType: MediaTypeSelection.Photo,
          allowMultipleSelection: false,
          quality: 92,
          correctOrientation: true,
          ...(maxEdge
            ? { targetWidth: maxEdge, targetHeight: maxEdge }
            : {}),
        });
        if (!results || results.length === 0) return null;
        result = results[0];
      }
      return await mediaResultToDataUrl(result);
    } catch (err) {
      const classified = classifyCameraError(err, source);
      if (classified === "silent" || classified === "permission-denied") {
        return null;
      }
      if (typeof classified === "string") {
        toast.error(classified);
        return null;
      }
      // Unexpected error — surface a generic message but log for debugging.
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[native-camera] capture failed:", source, msg);
      toast.error("Could not capture that photo. Please try again.");
      return null;
    }
  }

  // Web fallback: hidden file input.
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = source === "camera" ? "environment" : undefined;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => {
        toast.error("Couldn't read that image.");
        resolve(null);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

export { isNativePlatform };
