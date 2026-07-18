import React, { useCallback, useRef, useState } from "react";
import { Camera as CameraIcon, Image as ImageIcon, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import {
  Camera,
  CameraPermissionState,
  CameraResultType,
  CameraSource,
} from "@capacitor/camera";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Maximum stored edge length (px) and encoded size (bytes) for a profile
 * photo. Camera images are downscaled by the plugin (`width`/`height`) and
 * re-encoded as JPEG so we never persist a multi-megabyte HEIC into state.
 */
const MAX_EDGE = 512;
const MAX_BYTES = 4 * 1024 * 1024;

type Option = "camera" | "photos";

/**
 * Read a File into a downsized JPEG data URL using a canvas. Used only on the
 * web fallback path (pure browser, no Capacitor native runtime).
 */
function fileToDownscaledDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("not-image"));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      reject(new Error("too-large"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_EDGE || height > MAX_EDGE) {
        if (width >= height) {
          height = Math.round((height / width) * MAX_EDGE);
          width = MAX_EDGE;
        } else {
          width = Math.round((width / height) * MAX_EDGE);
          height = MAX_EDGE;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no-canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        if (dataUrl.length > MAX_BYTES) {
          reject(new Error("encoded-too-large"));
          return;
        }
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load-failed"));
    };
    img.src = url;
  });
}

/**
 * Profile photo picker.
 *
 * On a Capacitor native runtime (iOS/Android) it uses `@capacitor/camera`,
 * which performs the real permission prompt, launches the native camera /
 * photo picker, and returns a pre-downscaled base64 JPEG.
 *
 * On plain web it falls back to a hidden file input with the same canvas
 * downscaling pipeline.
 *
 * Permission denials are handled gracefully: a friendly toast is shown and,
 * on native, the user is offered a one-tap shortcut to open the system
 * settings page for the app so they can grant access without hunting for it.
 */
export function PhotoPicker({
  value,
  onChange,
  name,
}: {
  value: string | null;
  onChange: (photo: string | null) => void;
  name: string;
}) {
  const [busy, setBusy] = useState<Option | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isNative = typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();

  const openSettings = useCallback(async () => {
    try {
      // @capacitor/app is not installed; use the generic iOS URL scheme via
      // window.open which the WKWebView routes to Settings on iOS.
      window.location.href = "app-settings:";
    } catch {
      // ignore — toast already shown
    }
  }, []);

  const handlePermissionDenied = useCallback(
    (which: Option) => {
      const what = which === "camera" ? "camera" : "photo library";
      toast.error(`${what.charAt(0).toUpperCase() + what.slice(1)} access denied`, {
        description: isNative ? "Tap below to open Settings and enable it." : undefined,
        action: isNative
          ? { label: "Open settings", onClick: openSettings }
          : undefined,
      });
    },
    [isNative, openSettings],
  );

  const pickFromNative = useCallback(
    async (source: Option) => {
      setBusy(source);
      try {
        const photo = await Camera.getPhoto({
          quality: 85,
          // allowEditing is only supported for CameraSource.Camera on iOS.
          // Setting it for Photos causes a native crash, so gate it.
          allowEditing: source === "camera",
          resultType: CameraResultType.DataUrl,
          source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
          width: MAX_EDGE,
          height: MAX_EDGE,
          correctOrientation: true,
          // Use the default 'fullscreen' presentation style. 'popover' is
          // iPad-only and crashes on iPhone (no source view for the popover
          // controller), so we omit it entirely.
        });
        const dataUrl = photo.dataUrl;
        if (!dataUrl) {
          toast.error("Could not capture that photo. Please try again.");
          return;
        }
        if (dataUrl.length > MAX_BYTES) {
          toast.error("Photo is too large after processing");
          return;
        }
        onChange(dataUrl);
        toast.success(source === "camera" ? "Photo taken" : "Photo selected");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Capacitor throws "User denied photos access" / "User denied access to camera"
        if (/denied|permission/i.test(message)) {
          handlePermissionDenied(source);
          return;
        }
        // "cancelled" / user dismissed — silent
        if (/cancel/i.test(message)) return;
        toast.error("Could not capture that photo. Please try again.");
      } finally {
        setBusy(null);
      }
    },
    [handlePermissionDenied, onChange],
  );

  /**
   * Pre-flight permission request. We use `requestPermissions` (not just
   * `checkPermissions`) so iOS shows the system prompt on first launch and
   * returns the final state. If the user already denied, we surface the
   * "open Settings" shortcut instead of silently failing.
   */
  const pickWithPermissionRequest = useCallback(
    (source: Option) => {
      if (!isNative) {
        // Web fallback — file input triggers its own browser prompt.
        fileInputRef.current?.click();
        return;
      }
      void (async () => {
        try {
          const status = await Camera.requestPermissions({
            permissions: [source],
          });
          const state: CameraPermissionState =
            source === "camera" ? status.camera : status.photos;
          if (state === "denied") {
            handlePermissionDenied(source);
            return;
          }
          // "granted" | "limited" | "prompt" → proceed. getPhoto will handle
          // any remaining prompt if the system didn't show one.
          await pickFromNative(source);
        } catch {
          // requestPermissions can throw on older runtimes — just attempt the
          // pick; getPhoto() will prompt internally as a fallback.
          await pickFromNative(source);
        }
      })();
    },
    [handlePermissionDenied, isNative, pickFromNative],
  );

  const handleFilePick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setBusy("photos");
      try {
        const dataUrl = await fileToDownscaledDataUrl(file);
        onChange(dataUrl);
        toast.success("Photo selected");
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        if (code === "not-image") toast.error("Please choose an image file");
        else if (code === "too-large") toast.error("Photo must be under 20 MB");
        else if (code === "encoded-too-large") toast.error("Photo is too large after processing");
        else toast.error("Could not process the photo");
      } finally {
        setBusy(null);
      }
    },
    [onChange],
  );

  return (
    <div className="flex flex-col items-center gap-3 pb-1">
      <button
        type="button"
        onClick={() => pickWithPermissionRequest(isNative ? "camera" : "photos")}
        disabled={busy !== null}
        className="group relative flex h-24 w-24 items-center justify-center rounded-full bg-secondary ring-2 ring-border transition-transform active:scale-95 disabled:opacity-60"
        aria-label="Change profile photo"
      >
        {value ? (
          <Avatar className="h-24 w-24 rounded-full">
            <AvatarImage src={value} alt={name || "Profile"} />
            <AvatarFallback className="rounded-full bg-primary text-[22px] font-extrabold text-primary-foreground">
              {initials(name || "You")}
            </AvatarFallback>
          </Avatar>
        ) : (
          <span className="flex flex-col items-center gap-1 text-primary">
            <User className="h-7 w-7" strokeWidth={2.2} />
            <span className="text-[18px] font-extrabold">{initials(name || "You")}</span>
          </span>
        )}
        <span className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background transition-transform group-hover:scale-105">
          <CameraIcon className="h-[18px] w-[18px]" />
        </span>
      </button>

      {isNative ? (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => pickWithPermissionRequest("camera")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 text-[13px] font-bold text-primary disabled:opacity-60 dark:text-foreground"
          >
            <CameraIcon className="h-4 w-4" />
            {busy === "camera" ? "Taking…" : "Take photo"}
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => pickWithPermissionRequest("photos")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 text-[13px] font-bold text-primary disabled:opacity-60 dark:text-foreground"
          >
            <ImageIcon className="h-4 w-4" />
            {busy === "photos" ? "Choosing…" : "Choose photo"}
          </button>
          {value && (
            <>
              <span className="text-muted-foreground">·</span>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  toast.success("Photo removed");
                }}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 text-[13px] font-bold text-destructive disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => pickWithPermissionRequest("photos")}
            disabled={busy !== null}
            className="text-[13px] font-bold text-primary disabled:opacity-60 dark:text-foreground"
          >
            {busy === "photos" ? "Processing…" : "Upload photo"}
          </button>
          {value && (
            <>
              <span className="text-muted-foreground">·</span>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  toast.success("Photo removed");
                }}
                disabled={busy !== null}
                className="text-[13px] font-bold text-destructive disabled:opacity-60"
              >
                Remove
              </button>
            </>
          )}
        </div>
      )}

      {/* Hidden file input — only used on the web fallback path. No
          `capture` attribute so mobile browsers open the file picker
          (photo library) instead of forcing the camera. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFilePick}
        aria-hidden
      />
    </div>
  );
}

// Re-export so callers can import the canvas helper if ever needed.
export { fileToDownscaledDataUrl };
export type { Option as PhotoOption };
export const PHOTO_MAX_EDGE = MAX_EDGE;
export const PHOTO_MAX_BYTES = MAX_BYTES;
