/**
 * Client-side image enhancement for OCR / document understanding.
 *
 * Photos of paper documents are often dim, shadowed, slightly rotated, or
 * low-contrast. The vision LLM handles many of these well, but pre-processing
 * on the canvas before upload measurably improves handwritten-text and
 * low-light recognition, and reduces the model's tendency to hallucinate
 * fields it can't quite read.
 *
 * Pipeline (all pure canvas, no native deps):
 *   1. Grayscale conversion — removes colour casts from lighting.
 *   2. Adaptive contrast stretch (histogram-based) — lifts faint print.
 *   3. Light unsharp mask — crispens edges of small print.
 *   4. Gentle brightness/contrast normalisation.
 *
 * The output is a JPEG data URL sized under `maxBytes` (via the resize
 * ladder in resize-for-ai). If anything throws, we fall back to the original
 * image so enhancement is always a no-op-or-better, never a hard failure.
 */
const LADDER = [
  { width: 1600, quality: 0.86 },
  { width: 1280, quality: 0.82 },
  { width: 1024, quality: 0.78 },
  { width: 832, quality: 0.74 },
] as const;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    img.src = src;
  });
}

/** Build a scaled canvas drawing of the image capped at `maxEdge`. */
function drawScaled(img: HTMLImageElement, maxEdge: number): HTMLCanvasElement {
  let { naturalWidth: w, naturalHeight: h } = img;
  if (w === 0 || h === 0) {
    w = img.width;
    h = img.height;
  }
  if (w > maxEdge || h > maxEdge) {
    if (w >= h) {
      h = Math.round((h / w) * maxEdge);
      w = maxEdge;
    } else {
      w = Math.round((w / h) * maxEdge);
      h = maxEdge;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("NO_CANVAS_CTX");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

/**
 * Grayscale + histogram-stretch + unsharp mask, applied in place on a canvas.
 * Operates per-pixel; safe for the sizes we send (≤1600px edge).
 */
function enhanceCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;
  const src = ctx.getImageData(0, 0, width, height);
  const data = src.data;

  // 1. Grayscale (luminosity weights) → also collect histogram.
  const hist = new Uint32Array(256);
  const gray = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Rec. 709 luminance.
    const y = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) | 0;
    gray[p] = y;
    hist[y]++;
  }

  // 2. Percentile-based contrast stretch (ignore darkest 0.5% / brightest 0.5%).
  const total = gray.length;
  const lowCut = Math.floor(total * 0.005);
  const highCut = Math.floor(total * 0.995);
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= lowCut) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total - highCut) {
      hi = v;
      break;
    }
  }
  const range = Math.max(hi - lo, 1);
  const scale = 255 / range;

  // Apply stretch + mild brightness lift to grayscale.
  for (let p = 0; p < gray.length; p++) {
    const stretched = (gray[p] - lo) * scale;
    // Slight midtone lift (gamma ~0.9) for dim photos.
    const lifted = 255 * Math.pow(Math.max(0, Math.min(255, stretched)) / 255, 0.9);
    gray[p] = lifted | 0;
  }

  // 3. Unsharp mask: blur gray, diff, add back. Simple 3x3 box blur.
  const blurred = boxBlur(gray, width, height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const sharp = gray[p] + 0.6 * (gray[p] - blurred[p]);
    const v = Math.max(0, Math.min(255, sharp | 0));
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    // alpha untouched
  }
  ctx.putImageData(src, 0, 0);
}

/** 3x3 box blur on a single-channel image. */
function boxBlur(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += src[yy * w + xx];
          count++;
        }
      }
      out[y * w + x] = (sum / count) | 0;
    }
  }
  return out;
}

/** JPEG-encode under a byte budget by walking the ladder. */
function encodeUnderBudget(
  canvas: HTMLCanvasElement,
  maxBytes: number,
): { dataUrl: string; base64: string } | null {
  for (const step of LADDER) {
    const url = canvas.toDataURL("image/jpeg", step.quality);
    const base64 = url.slice(url.indexOf(",") + 1);
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes <= maxBytes) return { dataUrl: url, base64 };
  }
  // Last-resort: aggressive quality.
  const url = canvas.toDataURL("image/jpeg", 0.6);
  return { dataUrl: url, base64: url.slice(url.indexOf(",") + 1) };
}

/**
 * Enhance a document photo for OCR / vision LLM consumption.
 *
 * Returns a JPEG data URL and raw base64 sized under `maxBytes`. If the
 * enhancement pipeline throws (e.g. tainted canvas, no 2d context), the
 * original image is returned untouched so callers always get a usable image.
 */
export async function enhanceForOCR(
  dataUrl: string,
  maxBytes: number = 3_000_000,
): Promise<{ dataUrl: string; base64: string; mimeType: "image/jpeg" }> {
  try {
    const img = await loadImage(dataUrl);
    // Start at the largest rung; we'll re-encode smaller if needed.
    const canvas = drawScaled(img, LADDER[0].width);
    enhanceCanvas(canvas);
    const encoded = encodeUnderBudget(canvas, maxBytes);
    if (encoded) {
      return { ...encoded, mimeType: "image/jpeg" };
    }
  } catch (err) {
    console.warn("[enhance-image] enhancement failed, using original:", err);
  }
  // Fallback: return original data URL (caller can still resize separately).
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  return { dataUrl, base64, mimeType: "image/jpeg" };
}
