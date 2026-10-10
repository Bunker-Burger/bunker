import "server-only";

import sharp from "sharp";
import { err, ok, type Result } from "@/lib/result";

/*
 * Server-side inspection of an uploaded product photo, in two stages:
 *
 * 1. Header (cheap, before any decoding): the format comes from the file's own bytes (magic
 *    numbers), never from its name or the browser's declared type, and the dimensions from its
 *    header, so oversized or hostile files are refused before a decoder sees them.
 * 2. Integrity: the whole image is decoded with libvips (sharp) with warnings treated as errors.
 *    A file whose header looks right but whose pixel data is missing, truncated or corrupted
 *    (no IDAT/IEND, a JPEG without scan/EOI, a cut WebP/AVIF, a bad PNG CRC) is rejected, and the
 *    decoded format and size must match what the header said.
 *
 * Known limit: JPEG and lossy WebP (VP8) carry no checksum over their compressed data, so a few
 * flipped bytes that still decode cannot be told from a real picture. Truncation, missing scans,
 * stray markers, broken RIFF/chunk sizes and badly damaged data are rejected; PNG (CRC) and AVIF
 * corruption is rejected.
 */

export type ImageFormat = "jpeg" | "png" | "webp" | "avif";

export const IMAGE_MIME: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif"
};

const EXTENSION: Record<ImageFormat, string> = { jpeg: "jpg", png: "png", webp: "webp", avif: "avif" };

/** Same limit as the `catalog` bucket (5 MiB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MIN_IMAGE_SIDE = 320;
export const MAX_IMAGE_SIDE = 4096;

export interface InspectedImage {
  format: ImageFormat;
  mime: string;
  extension: string;
  width: number;
  height: number;
}

export type ImageRejectionCode =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "type_mismatch"
  | "corrupt"
  | "animated"
  | "too_small"
  | "too_big";

export interface ImageRejection {
  code: ImageRejectionCode;
  message: string;
}

const reject = (code: ImageRejectionCode, message: string) => err<ImageRejection>({ code, message });

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  start + length <= bytes.length ? String.fromCharCode(...bytes.subarray(start, start + length)) : "";
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

interface Dimensions {
  width: number;
  height: number;
}

function pngDimensions(b: Uint8Array): Dimensions | null {
  // Signature, then the IHDR chunk must come first.
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

// Start-of-frame markers carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) do not.
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegDimensions(b: Uint8Array): Dimensions | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan before any frame header
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    if (JPEG_SOF.has(marker)) {
      if (i + 9 > b.length) return null;
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webpDimensions(b: Uint8Array): Dimensions | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 " && b.length >= 30) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  if (chunk === "VP8L" && b.length >= 25) {
    if (b[20] !== 0x2f) return null;
    const b1 = b[21]!, b2 = b[22]!, b3 = b[23]!, b4 = b[24]!;
    return { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) };
  }
  if (chunk === "VP8X" && b.length >= 30) {
    return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  }
  return null;
}

interface Box {
  type: string;
  start: number;
  end: number;
}

/** ISO BMFF boxes in [start, end); stops at the first malformed size. */
function boxes(b: Uint8Array, start: number, end: number): Box[] {
  const found: Box[] = [];
  let i = start;
  while (i + 8 <= end) {
    let size = u32be(b, i);
    let header = 8;
    if (size === 1) {
      if (i + 16 > end || u32be(b, i + 8) !== 0) break; // 64-bit sizes above 4 GiB never fit the limit
      size = u32be(b, i + 12);
      header = 16;
    } else if (size === 0) {
      size = end - i;
    }
    if (size < header || i + size > end) break;
    found.push({ type: ascii(b, i + 4, 4), start: i + header, end: i + size });
    i += size;
  }
  return found;
}

function isAvif(b: Uint8Array) {
  const [ftyp] = boxes(b, 0, Math.min(b.length, 4096));
  if (!ftyp || ftyp.type !== "ftyp" || ftyp.end - ftyp.start < 8) return false;
  const brands = [ascii(b, ftyp.start, 4)];
  for (let i = ftyp.start + 8; i + 4 <= ftyp.end; i += 4) brands.push(ascii(b, i, 4));
  return brands.includes("avif") || brands.includes("avis");
}

function avifDimensions(b: Uint8Array): Dimensions | null {
  const meta = boxes(b, 0, b.length).find((box) => box.type === "meta");
  if (!meta) return null;
  const iprp = boxes(b, meta.start + 4, meta.end).find((box) => box.type === "iprp"); // meta is a full box
  const ipco = iprp && boxes(b, iprp.start, iprp.end).find((box) => box.type === "ipco");
  if (!ipco) return null;
  // The largest spatial extent is the primary image; smaller ones are thumbnails or alpha planes.
  let best: Dimensions | null = null;
  for (const box of boxes(b, ipco.start, ipco.end)) {
    if (box.type !== "ispe" || box.end - box.start < 12) continue;
    const candidate = { width: u32be(b, box.start + 4), height: u32be(b, box.start + 8) };
    if (!best || candidate.width * candidate.height > best.width * best.height) best = candidate;
  }
  return best;
}

/** Format from the file's magic number, or null for anything that is not an accepted raster image. */
export function sniffImageFormat(b: Uint8Array): ImageFormat | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (ascii(b, 4, 4) === "ftyp" && isAvif(b)) return "avif";
  return null;
}

const DIMENSIONS: Record<ImageFormat, (b: Uint8Array) => Dimensions | null> = {
  png: pngDimensions,
  jpeg: jpegDimensions,
  webp: webpDimensions,
  avif: avifDimensions
};

const DECLARED_ALIASES: Record<string, ImageFormat> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/pjpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif"
};

const CORRUPT = "No pudimos leer la imagen: el archivo está dañado o incompleto.";

/**
 * Stage 1 only: format, declared type and header dimensions, without decoding. Never enough on
 * its own to accept a file; `inspectImage` adds the integrity check.
 */
export function inspectImageHeader(bytes: Uint8Array, declaredType = ""): Result<InspectedImage, ImageRejection> {
  if (bytes.length === 0) return reject("empty", "Elegí una imagen.");
  if (bytes.length > MAX_IMAGE_BYTES) return reject("too_large", "La imagen supera los 5 MB.");

  const format = sniffImageFormat(bytes);
  if (!format) return reject("unsupported_type", "Formato no permitido: subí una imagen JPEG, PNG, WebP o AVIF.");

  const declared = declaredType.trim().toLowerCase();
  if (declared && declared !== "application/octet-stream" && DECLARED_ALIASES[declared] !== format) {
    return reject("type_mismatch", "El contenido del archivo no coincide con su tipo declarado.");
  }

  const dimensions = DIMENSIONS[format](bytes);
  if (!dimensions || dimensions.width === 0 || dimensions.height === 0) {
    return reject("corrupt", CORRUPT);
  }
  const { width, height } = dimensions;
  if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) {
    return reject("too_small", `La imagen mide ${width}×${height} px; el mínimo es ${MIN_IMAGE_SIDE} px por lado.`);
  }
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    return reject("too_big", `La imagen mide ${width}×${height} px; el máximo es ${MAX_IMAGE_SIDE} px por lado.`);
  }
  return ok({ format, mime: IMAGE_MIME[format], extension: EXTENSION[format], width, height });
}

/** The RIFF size field must cover the file exactly: a cut or padded WebP fails here. */
function riffSizeMatches(b: Uint8Array) {
  const declared = (b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24)) >>> 0;
  return declared + 8 === b.length;
}

/** libvips names AVIF "heif" and tells it apart by the AV1 compression. */
const DECODED: Record<ImageFormat, { format: string; compression?: string }> = {
  jpeg: { format: "jpeg" },
  png: { format: "png" },
  webp: { format: "webp" },
  avif: { format: "heif", compression: "av1" }
};

/**
 * Accepts a complete, decodable JPEG/PNG/WebP/AVIF of at most 5 MiB whose sides are between
 * 320 and 4096 px. `declaredType` (the browser's File.type) only matters when it contradicts the
 * bytes.
 */
export async function inspectImage(bytes: Uint8Array, declaredType = ""): Promise<Result<InspectedImage, ImageRejection>> {
  const header = inspectImageHeader(bytes, declaredType);
  if (!header.ok) return header;
  const { format, width, height } = header.value;
  if (format === "webp" && !riffSizeMatches(bytes)) return reject("corrupt", CORRUPT);

  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_SIDE * MAX_IMAGE_SIDE,
      animated: false
    });
    const metadata = await image.metadata();
    const expected = DECODED[format];
    if (metadata.format !== expected.format || (expected.compression && metadata.compression !== expected.compression)) {
      return reject("corrupt", CORRUPT);
    }
    if ((metadata.pages ?? 1) > 1) return reject("animated", "No se admiten imágenes animadas: subí una foto.");
    // Decoding every pixel is what proves the data is complete; the pixels themselves are discarded.
    const { info } = await image.raw().toBuffer({ resolveWithObject: true });
    if (info.width !== width || info.height !== height) return reject("corrupt", CORRUPT);
  } catch {
    return reject("corrupt", CORRUPT);
  }
  return header;
}
