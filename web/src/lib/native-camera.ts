/**
 * Shared native camera / photo-library capture utility.
 *
 * Uses the battle-tested `getPhoto` API with explicit `CameraSource` selection:
 *  - "camera" → `CameraSource.Camera` (opens the camera)
 *  - "photos" → `CameraSource.Photos` (opens the photo library)
 *
 * The v8.1+ `takePhoto` / `chooseFromGallery` methods are newer and less
 * battle-tested — `chooseFromGallery` in particular has been reported to open
 * the camera on some iOS builds when the native pods aren't perfectly synced.
 * `getPhoto` with an explicit source has been reliable since Capacitor 1.0.
 *
 * Camera race-condition fix: the known iOS issue (#1996) is that the first
 * `getPhoto(Camera)` call fails because iOS shows the permission dialog while
 * the camera tries to initialize. We fix this by **pre-requesting** camera
 * permission before calling `getPhoto` — once permission is already granted,
 * the camera initializes immediately with no race.
 *
 * Returns a JPEG data URL (`data:image/jpeg;base64,...`) on success, or `null`
 * if the user cancelled or an error was already surfaced via toast.
 */
import { Capacitor } from "@capacitor/core";
import {
  Camera,
  CameraErrorCode,
  CameraPermissionState,
  CameraResultType,
  CameraSource,
  type ImageOptions,
} from "@capacitor/camera";
import { toast } from "sonner";

export type CaptureSource = "camera" | "photos";

const isNativePlatform = (): boolean =>
  typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();

/* ----------------------- permission helpers ----------------------- */

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
 * Pre-check and request permission for a capture source.
 *
 * For the camera, this is critical: it ensures the permission is already
 * granted BEFORE `getPhoto` tries to initialize the camera preview, avoiding
 * the well-known iOS race condition where the first call fails.
 *
 * For the photo library, this routes already-denied users straight to the
 * Settings toast instead of a confusing rejection.
 *
 * Returns `true` if safe to proceed (granted / limited / unknown), `false` if
 * denied (toast already shown).
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
    // checkPermissions can throw on older runtimes — fall through to getPhoto,
    // which prompts internally as a last resort.
    return true;
  }
}

/* ----------------------- error classification ----------------------- */

function classifyCameraError(
  err: unknown,
  source: CaptureSource,
): "silent" | "permission-denied" | string | null {
  const code =
    (err as { code?: string })?.code ??
    (err instanceof Error ? err.message : String(err));
  const lower = String(code).toLowerCase();

  // User cancelled — silent.
  if (/cancel/i.test(lower)) {
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

/* ----------------------- public API ----------------------- */

/**
 * Capture an image from the camera or photo library.
 *
 * On native iOS uses `getPhoto` with an explicit `CameraSource`:
 *  - "camera" → opens the camera (permission pre-requested to avoid race)
 *  - "photos" → opens the photo library (never the camera)
 *
 * Returns a JPEG data URL, or `null` if the user cancelled or an error was
 * already surfaced via toast.
 *
 * On web, falls back to a hidden file input (`capture` for camera).
 *
 * @param source  "camera" to take a new photo, "photos" to pick from the library.
 * @param maxEdge Optional max edge (px) for the captured image (native only).
 */
export async function captureImage(
  source: CaptureSource,
  maxEdge?: number,
): Promise<string | null> {
  if (isNativePlatform()) {
    const granted = await ensurePermission(source);
    if (!granted) return null;

    // IMPORTANT: only specify `width`, NOT `height`. When both are set,
    // Capacitor Camera CROPS the image to those exact dimensions — so
    // passing width=height=1600 force-cropped every document photo to a
    // square, cutting off the top/bottom of receipts, prescriptions, etc.
    // Setting only `width` scales the longest edge down to `maxEdge` while
    // preserving the full aspect ratio, so no part of the document is lost.
    // `allowEditing: true` then presents the native iOS crop/adjust screen
    // so the user can manually frame the document before analysis.
    const options: ImageOptions = {
      resultType: CameraResultType.DataUrl,
      source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
      quality: 92,
      correctOrientation: true,
      // `allowEditing` is only supported for Camera on iOS, not Photos.
      // It shows the native iOS edit/crop screen so the user can manually
      // adjust the frame before the image is returned — this is the
      // "manual adjustment before analysis" step.
      allowEditing: source === "camera",
      saveToGallery: false,
      // Only constrain the longest edge; aspect ratio is preserved and no
      // cropping is applied by the camera plugin.
      ...(maxEdge ? { width: maxEdge } : {}),
    };

    try {
      const photo = await Camera.getPhoto(options);
      if (!photo.dataUrl) {
        // Fallback: if dataUrl is missing, try webPath → fetch → data URL.
        if (photo.webPath) {
          const res = await fetch(photo.webPath);
          const blob = await res.blob();
          const dataUrl = await blobToDataUrl(blob);
          return dataUrl;
        }
        throw new Error("NO_IMAGE_DATA");
      }
      return photo.dataUrl;
    } catch (err) {
      const classified = classifyCameraError(err, source);
      if (classified === "silent" || classified === "permission-denied") {
        return null;
      }
      if (typeof classified === "string") {
        toast.error(classified);
        return null;
      }
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("BLOB_READ_FAILED"));
    reader.readAsDataURL(blob);
  });
}

export { isNativePlatform };
