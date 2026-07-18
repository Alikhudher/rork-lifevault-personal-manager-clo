/**
 * Resize an image (data URL or object URL) into a raw-base64 JPEG that fits
 * within the Vercel AI Gateway ~4.5MB request-body limit. Walks an iterative
 * ladder of pixel-size + quality steps, stops at the first that fits.
 *
 * Used by the AI Assistant before sending photos to the vision model. Pure
 * browser implementation (canvas) — no native deps required, works on the
 * Capacitor iOS WebView and the web preview.
 */

const DEFAULT_MAX_BYTES = 3_000_000;

const LADDER = [
  { width: 1280, compress: 0.82 },
  { width: 1024, compress: 0.78 },
  { width: 832, compress: 0.74 },
  { width: 640, compress: 0.7 },
  { width: 512, compress: 0.65 },
] as const;

export const stripDataUriPrefix = (b64: string): string => {
  if (!b64.startsWith("data:")) return b64;
  const comma = b64.indexOf(",");
  return comma === -1 ? b64 : b64.slice(comma + 1);
};

function byteLengthUtf8(base64: string): number {
  // base64 → binary bytes; UTF-8 length of the base64 string equals the
  // number of binary bytes after atob, since each char is one byte.
  // Approximate with string length (base64 char = 6 bits). For budget
  // checks this is accurate enough (overestimates by ~0.4%).
  return Math.floor((base64.length * 3) / 4);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    img.src = src;
  });
}

function encodeAt(
  img: HTMLImageElement,
  width: number,
  compress: number,
): string {
  let { naturalWidth: w, naturalHeight: h } = img;
  if (w === 0 || h === 0) {
    w = img.width;
    h = img.height;
  }
  if (w > width || h > width) {
    if (w >= h) {
      h = Math.round((h / w) * width);
      w = width;
    } else {
      w = Math.round((w / h) * width);
      h = width;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("NO_CANVAS_CTX");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", compress);
}

/**
 * Resize an image data URL to a raw base64 JPEG under `maxBytes`.
 * Returns `{ base64, mimeType }` where base64 has no `data:` prefix.
 * Throws `IMAGE_TOO_LARGE` if every ladder step is still over budget.
 */
export async function resizeForAI(
  dataUrl: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<{ base64: string; mimeType: "image/jpeg"; dataUrl: string }> {
  const img = await loadImage(dataUrl);
  for (const step of LADDER) {
    const encoded = encodeAt(img, step.width, step.compress);
    const raw = stripDataUriPrefix(encoded);
    if (byteLengthUtf8(raw) <= maxBytes) {
      return { base64: raw, mimeType: "image/jpeg", dataUrl: encoded };
    }
  }
  throw new Error("IMAGE_TOO_LARGE");
}
