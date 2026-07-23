/**
 * Cross-platform share utility.
 *
 * On native (iOS/Android via Capacitor) uses @capacitor/share, which opens
 * the real native share sheet (Messages, Mail, WhatsApp, AirDrop, etc.).
 * On web falls back to the Web Share API (navigator.share) when available,
 * otherwise shows a toast and copies a text summary to the clipboard.
 */
import { Capacitor } from "@capacitor/core";
import { Share, type ShareOptions } from "@capacitor/share";
import { toast } from "sonner";

const isNative = (): boolean =>
  typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();

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

/** Writes a data URL to a temporary blob URL (for native share on web view). */
function dataUrlToBlobUrl(dataUrl: string): { url: string; blob: Blob } | null {
  try {
    const commaIdx = dataUrl.indexOf(",");
    const meta = commaIdx >= 0 ? dataUrl.slice(0, commaIdx) : "";
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    const mimeMatch = meta.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    return { url: URL.createObjectURL(blob), blob };
  } catch {
    return null;
  }
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
      // On native, we can share files via the Share plugin if the platform
      // supports it. We write the data URL's bytes to a temp blob URL and
      // pass it as a URL. Capacitor Share on iOS/Android can handle
      // blob: URLs in the webview layer by converting them to native temp files.
      const blobResult = dataUrlToBlobUrl(fileData);
      if (blobResult) {
        try {
          // Try file share first (navigator.share with files works in WKWebView on iOS 17+)
          if (typeof navigator !== "undefined" && navigator.canShare) {
            const file = await dataUrlToFile(fileData, resolvedName);
            if (file && navigator.canShare({ files: [file] })) {
              try {
                await navigator.share({
                  files: [file],
                  title,
                  text: text || undefined,
                });
                URL.revokeObjectURL(blobResult.url);
                return;
              } catch {
                // Fall through to Capacitor Share
              }
            }
          }
          // Capacitor Share with URL — for webview blob URLs, this may
          // open the share sheet with the file on some platforms.
          options.url = blobResult.url;
          await Share.share(options);
          URL.revokeObjectURL(blobResult.url);
          return;
        } catch (err) {
          URL.revokeObjectURL(blobResult.url);
          // If file sharing fails, fall through to text-only share
        }
      }
    }

    // Text-only share (or fallback when file share failed)
    try {
      await Share.share(options);
    } catch {
      // User cancelled — no action needed
    }
    return;
  }

  // ---- Web ----
  if (fileData) {
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
        } catch {
          // User cancelled or failed — fall through
        }
      }
    }
  }

  // Text-only web share
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({
        title,
        text: text || `${title}`,
      });
      return;
    } catch {
      // User cancelled — no action needed
      return;
    }
  }

  // Final fallback: copy to clipboard
  const summary = text ? `${title}\n\n${text}` : title;
  try {
    await navigator.clipboard.writeText(summary);
    toast.success("Copied to clipboard");
  } catch {
    toast.info("Sharing is not supported on this device");
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
    } catch {
      // User cancelled
    }
    return;
  }

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, text, url });
    } catch {
      // User cancelled
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(url ? `${title}\n${text}\n${url}` : `${title}\n${text}`);
    toast.success("Copied to clipboard");
  } catch {
    toast.info("Sharing is not supported on this device");
  }
}
