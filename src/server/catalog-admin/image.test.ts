import { describe, expect, it } from "vitest";
import { inspectImage, MAX_IMAGE_BYTES, sniffImageFormat } from "./image";

/* Minimal but structurally valid headers; the rest of the file is padding. */

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());
const pad = (n = 64) => new Array<number>(n).fill(0);

function png(width: number, height: number) {
  return bytes([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a], u32(13), ascii("IHDR"), u32(width), u32(height), [8, 6, 0, 0, 0], pad());
}

function jpeg(width: number, height: number, { progressive = false } = {}) {
  const app0 = [0xff, 0xe0, ...u16(16), ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const dqt = [0xff, 0xdb, ...u16(4), 0, 0];
  const sof = [0xff, progressive ? 0xc2 : 0xc0, ...u16(17), 8, ...u16(height), ...u16(width), 3, ...pad(9)];
  return bytes([0xff, 0xd8], app0, dqt, sof, [0xff, 0xda], pad());
}

function riff(chunk: string, payload: number[]) {
  return bytes(ascii("RIFF"), [0, 0, 0, 0], ascii("WEBP"), ascii(chunk), [payload.length, 0, 0, 0], payload, pad());
}
const webpLossy = (w: number, h: number) => riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, (w >> 8) & 0x3f, h & 255, (h >> 8) & 0x3f]);
function webpLossless(w: number, h: number) {
  const W = w - 1, H = h - 1;
  return riff("VP8L", [0x2f, W & 255, ((W >> 8) & 0x3f) | ((H & 3) << 6), (H >> 2) & 255, (H >> 10) & 0x0f]);
}
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const webpExtended = (w: number, h: number) => riff("VP8X", [0x10, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);

const box = (type: string, body: number[]) => [...u32(8 + body.length), ...ascii(type), ...body];
function avif(sizes: Array<[number, number]>, brand = "avif") {
  const ispe = sizes.flatMap(([w, h]) => box("ispe", [0, 0, 0, 0, ...u32(w), ...u32(h)]));
  const meta = box("meta", [0, 0, 0, 0, ...box("hdlr", pad(24)), ...box("iprp", box("ipco", ispe))]);
  return bytes(box("ftyp", [...ascii(brand), 0, 0, 0, 0, ...ascii("mif1"), ...ascii("miaf")]), meta, box("mdat", pad()));
}

describe("sniffImageFormat", () => {
  it("recognises the four accepted formats by their bytes", () => {
    expect(sniffImageFormat(png(800, 600))).toBe("png");
    expect(sniffImageFormat(jpeg(800, 600))).toBe("jpeg");
    expect(sniffImageFormat(webpLossy(800, 600))).toBe("webp");
    expect(sniffImageFormat(avif([[800, 600]]))).toBe("avif");
  });

  it("rejects SVG, GIF, HEIC and text", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffImageFormat(enc('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>'))).toBeNull();
    expect(sniffImageFormat(enc('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffImageFormat(bytes(ascii("GIF89a"), pad()))).toBeNull();
    expect(sniffImageFormat(bytes(box("ftyp", [...ascii("heic"), 0, 0, 0, 0, ...ascii("mif1")]), pad()))).toBeNull();
    expect(sniffImageFormat(enc("hello, I am a png"))).toBeNull();
  });
});

describe("inspectImage", () => {
  it.each([
    ["PNG", png(1200, 900), "image/png", "png", "jpg"],
    ["baseline JPEG", jpeg(1200, 900), "image/jpeg", "jpeg", ""],
    ["progressive JPEG", jpeg(1200, 900, { progressive: true }), "image/jpeg", "jpeg", ""],
    ["lossy WebP", webpLossy(1200, 900), "image/webp", "webp", ""],
    ["lossless WebP", webpLossless(1200, 900), "image/webp", "webp", ""],
    ["extended WebP", webpExtended(1200, 900), "image/webp", "webp", ""],
    ["AVIF", avif([[1200, 900]]), "image/avif", "avif", ""]
  ])("accepts a %s and reads its real dimensions", (_name, file, declared, format) => {
    const result = inspectImage(file, declared);
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ format, mime: declared, width: 1200, height: 900 }) });
  });

  it("derives the stored extension from the bytes, never from the name", () => {
    const result = inspectImage(jpeg(640, 640), "");
    expect(result.ok && result.value.extension).toBe("jpg");
  });

  it("takes the largest AVIF extent as the primary image (thumbnails and alpha are smaller)", () => {
    const result = inspectImage(avif([[160, 120], [1600, 1200]]));
    expect(result.ok && [result.value.width, result.value.height]).toEqual([1600, 1200]);
  });

  it("accepts an AVIF sequence brand", () => {
    expect(inspectImage(avif([[800, 800]], "avis")).ok).toBe(true);
  });

  it.each([
    ["an empty file", new Uint8Array(), "empty"],
    ["SVG declared as an image", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "unsupported_type"],
    ["a text file renamed to .png", new TextEncoder().encode("not really an image".padEnd(100, ".")), "unsupported_type"],
    ["a PNG without its IHDR header", bytes([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a], pad(4)), "corrupt"],
    ["a JPEG cut before its frame header", bytes([0xff, 0xd8, 0xff, 0xe0, ...u16(16)], pad(4)), "corrupt"],
    ["a JPEG whose scan starts before any frame", bytes([0xff, 0xd8], [0xff, 0xda], pad()), "corrupt"],
    ["a WebP with a broken VP8 start code", riff("VP8 ", [0, 0, 0, 0, 0, 0, 0, 4, 0, 4]), "corrupt"],
    ["an AVIF without dimensions", avif([]), "corrupt"],
    ["a PNG of zero width", png(0, 900), "corrupt"],
    ["an image below 320 px", png(319, 900), "too_small"],
    ["an image above 4096 px", jpeg(4097, 900), "too_big"]
  ])("rejects %s", (_name, file, code) => {
    const result = inspectImage(file, "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it("rejects a file above 5 MB before looking at it", () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(png(1000, 1000));
    expect(inspectImage(big, "image/png")).toMatchObject({ ok: false, error: { code: "too_large" } });
    const exact = new Uint8Array(MAX_IMAGE_BYTES);
    exact.set(png(1000, 1000));
    expect(inspectImage(exact, "image/png").ok).toBe(true);
  });

  it("rejects a declared type that contradicts the bytes", () => {
    expect(inspectImage(png(800, 800), "image/jpeg")).toMatchObject({ ok: false, error: { code: "type_mismatch" } });
    expect(inspectImage(png(800, 800), "image/svg+xml")).toMatchObject({ ok: false, error: { code: "type_mismatch" } });
  });

  it("ignores a missing or generic declared type and accepts jpeg aliases", () => {
    expect(inspectImage(png(800, 800), "").ok).toBe(true);
    expect(inspectImage(png(800, 800), "application/octet-stream").ok).toBe(true);
    expect(inspectImage(jpeg(800, 800), "image/jpg").ok).toBe(true);
  });
});
