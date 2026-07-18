import React, { useCallback, useRef, useState } from "react";
import { Camera as CameraIcon, Image as ImageIcon, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { captureImage, isNativePlatform } from "@/lib/native-camera";

/**
 * Maximum stored edge length (px) and encoded size (bytes) for a profile
 * photo. Native capture uses this as `targetWidth`/`targetHeight`; the web
 * fallback downscales via canvas to the same limit so we never persist a
 * multi-megabyte image into app state.
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
 * The **Photo Library** is the primary action on every platform, matching the
 * user's expectation: tapping the avatar opens the library picker.
 *
 * On a Capacitor native runtime (iOS/Android) it uses the shared
 * `captureImage` helper from `@/lib/native-camera`, which wraps the v8.1+
 * `chooseFromGallery` / `takePhoto` APIs (the deprecated `getPhoto` had a
 * well-known iOS camera race condition where the first call failed because
 * the permission dialog appeared while the camera initialized). The shared
 * helper handles permissions, cancellation, denial-toastery, and full-res
 * reading via `@capacitor/filesystem`.
 *
 * On plain web it falls back to a visually-hidden (but rendered) file input
 * with the same canvas downscaling pipeline. The input is kept in the layout
 * (`position:absolute; opacity:0`) rather than `display:none` because some
 * sandboxed WebViews refuse to honour `.click()` on detached/hidden nodes.
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
  const isNative = isNativePlatform();

  /**
   * Native capture via the shared `captureImage` helper. Enforces the profile
   * photo size budget (MAX_EDGE / MAX_BYTES) after capture so we never persist
   * a huge image into app state — the helper returns a full-res data URL on
   * native, so we downscale via canvas if it exceeds the budget.
   */
  const pickFromNative = useCallback(
    async (source: Option) => {
      setBusy(source);
      try {
        const dataUrl = await captureImage(source, MAX_EDGE);
        if (!dataUrl) return; // cancelled / error already surfaced
        if (dataUrl.length > MAX_BYTES) {
          // Still too large after native sizing — downscale via canvas.
          try {
            const downscaled = await downscaleDataUrl(dataUrl, MAX_EDGE);
            onChange(downscaled);
          } catch {
            toast.error("Photo is too large after processing");
            return;
          }
        } else {
          onChange(dataUrl);
        }
        toast.success(source === "camera" ? "Photo taken" : "Photo selected");
      } finally {
        setBusy(null);
      }
    },
    [onChange],
  );

  /** Primary action — always opens the Photo Library. */
  const pickFromLibrary = useCallback(() => {
    if (isNative) {
      void pickFromNative("photos");
    } else {
      // Web fallback — file input triggers its own browser prompt.
      // Always reset value so re-picking the same file fires onChange.
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      fileInputRef.current?.click();
    }
  }, [isNative, pickFromNative]);

  const handleFilePick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so choosing the same file again fires a change event.
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
        onClick={pickFromLibrary}
        disabled={busy !== null}
        className="group relative flex h-24 w-24 items-center justify-center rounded-full bg-secondary ring-2 ring-border transition-transform active:scale-95 disabled:opacity-60"
        aria-label="Choose profile photo from library"
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
          <ImageIcon className="h-[18px] w-[18px]" />
        </span>
      </button>

      {isNative ? (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={pickFromLibrary}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 text-[13px] font-bold text-primary disabled:opacity-60 dark:text-foreground"
          >
            <ImageIcon className="h-4 w-4" />
            {busy === "photos" ? "Choosing…" : "Choose photo"}
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => void pickFromNative("camera")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 text-[13px] font-bold text-primary disabled:opacity-60 dark:text-foreground"
          >
            <CameraIcon className="h-4 w-4" />
            {busy === "camera" ? "Taking…" : "Take photo"}
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
            onClick={pickFromLibrary}
            disabled={busy !== null}
            className="text-[13px] font-bold text-primary disabled:opacity-60 dark:text-foreground"
          >
            {busy === "photos" ? "Processing…" : "Choose from library"}
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

      {/*
        Hidden file input — only used on the web fallback path. No `capture`
        attribute so mobile browsers open the file picker (photo library)
        instead of forcing the camera.

        Kept rendered (absolute, opacity 0, pointer-events none) rather than
        `display:none` because some sandboxed WebViews and iframe-based
        previews ignore `.click()` on detached nodes. This keeps the node in
        the layout so the programmatic click is honoured.
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFilePick}
        aria-hidden
        tabIndex={-1}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          border: 0,
          opacity: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/**
 * Downscale an existing data URL to a JPEG within `maxEdge` px via canvas.
 * Used when the native capture helper returns a full-res image that exceeds
 * the profile photo size budget.
 */
function downscaleDataUrl(dataUrl: string, maxEdge: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxEdge || height > maxEdge) {
        if (width >= height) {
          height = Math.round((height / width) * maxEdge);
          width = maxEdge;
        } else {
          width = Math.round((width / height) * maxEdge);
          height = maxEdge;
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
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("load-failed"));
    img.src = dataUrl;
  });
}

// Re-export so callers can import the canvas helper if ever needed.
export { fileToDownscaledDataUrl };
export type { Option as PhotoOption };
export const PHOTO_MAX_EDGE = MAX_EDGE;
export const PHOTO_MAX_BYTES = MAX_BYTES;
