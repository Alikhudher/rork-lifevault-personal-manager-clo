/**
 * Cross-platform share utility.
 *
 * On native (iOS/Android via Capacitor) uses @capacitor/share, which opens
 * the real native share sheet (Messages, Mail, WhatsApp, AirDrop, etc.).
 * On web falls back to the Web Share API (navigator.share) when available,
 * otherwise downloads the file and copies a text summary to the clipboard.
 */
import { Capacitor } from "@capacitor/core";
import { Share, type ShareOptions } from "@capacitor/share";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { toast } from "sonner";

const isNative = (): boolean =>
  typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();

/**
 * Writes a data URL (base64) to a temporary file in the Capacitor Cache dir and
 * returns a `file://` URI that can be passed to `Share.share({ files: [...] })`.
 *
 * This is the only reliable way to share an actual binary attachment on native
 * iOS/Android — blob: URLs are not accepted by the native share sheet.
 */
async function dataUrlToCacheFile(
  dataUrl: string,
  fileName: string,
): Promise<string | null> {
  try {
    const commaIdx = dataUrl.indexOf(",");
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    // Sanitize the filename so it's safe on both platforms, preserving the
    // extension so iOS/Android know how to handle the shared file.
    const safeName = (fileName || "document").replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `share_${Date.now()}_${safeName}`;
    // IMPORTANT: do NOT pass `encoding` here. When `encoding` is omitted,
    // Capacitor's Filesystem plugin treats `data` as base64 and decodes it
    // to real binary bytes before writing. Passing `Encoding.UTF8` would
    // write the literal base64 characters as text, producing a corrupt
    // file that the native share sheet cannot open.
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    const uri = await Filesystem.getUri({ path, directory: Directory.Cache });
    return uri.uri; // file:// URI
  } catch (err) {
    console.error("dataUrlToCacheFile failed", err);
    return null;
  }
}

/** Best-effort cleanup of a temporary share file. */
async function cleanupCacheFile(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Cache });
  } catch {
    /* ignore */
  }
}

/** Converts a data URL to a File for the Web Share API. */
async function dataUrlToFile(
  dataUrl: string,
  fileName: string,
): Promise<File | null> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], fileName || "document", { type: blob.type });
  } catch {
    return null;
  }
}

/** Returns true if the error is a user-initiated cancellation (not a real error). */
function isCancellation(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === "AbortError" || err.name === "NotAllowedError";
  }
  if (err && typeof err === "object" && "message" in err) {
    const msg = String((err as { message: string }).message).toLowerCase();
    return msg.includes("cancel") || msg.includes("abort") || msg.includes("user dismissed");
  }
  return false;
}

/** Triggers a browser download from a data URL (web fallback for file sharing). */
function downloadDataUrl(dataUrl: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName || "document";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export interface ShareDocumentOptions {
  /** Document name / title. */
  title: string;
  /** Optional text body (notes, description). */
  text?: string;
  /** File content as a data URL (base64), or null/undefined for text-only share. */
  fileData?: string | null;
  /** Original file name including extension. */
  fileName?: string | null;
}

/**
 * Share a document. If `fileData` is provided, shares the actual file
 * (image/PDF/etc.) via the native share sheet. Otherwise shares the
 * document title and notes as text.
 *
 * Works on iOS, Android (via Capacitor Share) and web (Web Share API).
 * If file sharing isn't supported, falls back to downloading the file
 * plus copying text to the clipboard.
 */
export async function shareDocument({
  title,
  text,
  fileData,
  fileName,
}: ShareDocumentOptions): Promise<void> {
  const resolvedName = fileName || title || "document";

  // ---- Native (Capacitor) ----
  if (isNative()) {
    const options: ShareOptions = {
      title,
      text: text || undefined,
      dialogTitle: title,
    };

    if (fileData) {
      // Write the file to a temporary cache file and share via file:// URI.
      // This is the only reliable way to attach a real binary file to the
      // native iOS/Android share sheet — blob: URLs are rejected.
      const fileUri = await dataUrlToCacheFile(fileData, resolvedName);
      if (fileUri) {
        try {
          await Share.share({
            title,
            text: text || undefined,
            dialogTitle: title,
            files: [fileUri],
          });
          // Clean up the temp file after sharing completes.
          const path = fileUri.split("/").pop() ?? "";
          if (path) void cleanupCacheFile(path);
          return;
        } catch (err) {
          const path = fileUri.split("/").pop() ?? "";
          if (path) void cleanupCacheFile(path);
          if (isCancellation(err)) return;
          // Show a clear error instead of silently downloading on native.
          toast.error("Could not open share sheet", {
            description: "Sharing this file type isn't supported on this device.",
          });
          return;
        }
      }

      // Filesystem write failed — surface a clear error, do NOT silently download.
      toast.error("Could not prepare file for sharing", {
        description: "Please try again or use Download to save the file.",
      });
      return;
    }

    // Text-only share (or fallback when file share failed)
    try {
      await Share.share(options);
    } catch (err) {
      if (!isCancellation(err)) {
        toast.error("Could not open share sheet", {
          description: "Please try again or copy the document manually.",
        });
      }
    }
    return;
  }

  // ---- Web ----
  if (fileData) {
    // Try Web Share API with file
    if (typeof navigator !== "undefined" && navigator.canShare) {
      const file = await dataUrlToFile(fileData, resolvedName);
      if (file && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title,
            text: text || undefined,
          });
          return;
        } catch (err) {
          if (isCancellation(err)) return;
          // Fall through to download fallback
        }
      }
    }

    // Fallback: download the file + copy text to clipboard
    downloadDataUrl(fileData, resolvedName);
    const summary = text ? `${title}\n\n${text}` : title;
    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      // Clipboard may fail in non-secure contexts — the download is the main action
    }
    toast.success("File downloaded", {
      description: "Sharing isn't available in this browser — the file has been downloaded instead.",
    });
    return;
  }

  // Text-only web share (no file)
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({
        title,
        text: text || `${title}`,
      });
      return;
    } catch (err) {
      if (isCancellation(err)) return;
      // Fall through to clipboard
    }
  }

  // Final fallback: copy to clipboard
  const summary = text ? `${title}\n\n${text}` : title;
  try {
    await navigator.clipboard.writeText(summary);
    toast.success("Copied to clipboard");
  } catch {
    toast.info("Sharing is not supported on this device", {
      description: "The document title has been displayed for you to copy manually.",
    });
  }
}

/**
 * Share a generic text/link (e.g. sharing the app itself).
 */
export async function shareText(
  title: string,
  text: string,
  url?: string,
): Promise<void> {
  if (isNative()) {
    const options: ShareOptions = { title, text };
    if (url) options.url = url;
    try {
      await Share.share(options);
    } catch (err) {
      if (!isCancellation(err)) {
        toast.error("Could not open share sheet");
      }
    }
    return;
  }

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (isCancellation(err)) return;
    }
  }

  try {
    await navigator.clipboard.writeText(url ? `${title}\n${text}\n${url}` : `${title}\n${text}`);
    toast.success("Copied to clipboard");
  } catch {
    toast.info("Sharing is not supported on this device");
  }
}
