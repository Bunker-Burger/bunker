import { beforeAll, describe, expect, it } from "vitest";
import { inspectImage, inspectImageHeader, MAX_IMAGE_BYTES, sniffImageFormat, type ImageFormat } from "./image";
import { animatedWebp, corruptMiddle, realGif, realImage, truncate } from "./test-images";

/*
 * Hand-made headers (below) only exercise stage 1 (format sniffing and header parsing). Every
 * file `inspectImage` accepts is a real encoded image from ./test-images; the hand-made ones
 * must be rejected by it, since they carry no pixel data.
 */

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

describe("sniffImageFormat (stage 1)", () => {
  it("recognises the four accepted formats by their magic numbers", () => {
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

describe("inspectImageHeader (stage 1, no decoding)", () => {
  it.each([
    ["PNG", png(1200, 900)],
    ["baseline JPEG", jpeg(1200, 900)],
    ["progressive JPEG", jpeg(1200, 900, { progressive: true })],
    ["lossy WebP", webpLossy(1200, 900)],
    ["lossless WebP", webpLossless(1200, 900)],
    ["extended WebP", webpExtended(1200, 900)],
    ["AVIF", avif([[1200, 900]])]
  ])("reads the dimensions of a %s header", (_name, file) => {
    expect(inspectImageHeader(file)).toMatchObject({ ok: true, value: { width: 1200, height: 900 } });
  });

  it("takes the largest AVIF extent as the primary image (thumbnails and alpha are smaller)", () => {
    expect(inspectImageHeader(avif([[160, 120], [1600, 1200]]))).toMatchObject({ ok: true, value: { width: 1600, height: 1200 } });
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
    expect(inspectImageHeader(file, "")).toMatchObject({ ok: false, error: { code } });
  });

  it("enforces 5 MiB on the raw size before looking at the content", () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(png(1000, 1000));
    expect(inspectImageHeader(big, "image/png")).toMatchObject({ ok: false, error: { code: "too_large" } });
    const exact = new Uint8Array(MAX_IMAGE_BYTES);
    exact.set(png(1000, 1000));
    expect(inspectImageHeader(exact, "image/png").ok).toBe(true);
  });

  it("rejects a declared type that contradicts the bytes and tolerates a missing or generic one", () => {
    expect(inspectImageHeader(png(800, 800), "image/jpeg")).toMatchObject({ ok: false, error: { code: "type_mismatch" } });
    expect(inspectImageHeader(png(800, 800), "image/svg+xml")).toMatchObject({ ok: false, error: { code: "type_mismatch" } });
    expect(inspectImageHeader(png(800, 800), "").ok).toBe(true);
    expect(inspectImageHeader(png(800, 800), "application/octet-stream").ok).toBe(true);
    expect(inspectImageHeader(jpeg(800, 800), "image/jpg").ok).toBe(true);
  });
});

const FORMATS: ImageFormat[] = ["jpeg", "png", "webp", "avif"];
const MIME: Record<ImageFormat, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };
const real = {} as Record<ImageFormat, Uint8Array<ArrayBuffer>>;

beforeAll(async () => {
  for (const format of FORMATS) real[format] = await realImage(format);
}, 60_000);

describe("inspectImage (header + full decode)", () => {
  it.each(FORMATS)("accepts a real %s and reports its true format and size", async (format) => {
    expect(await inspectImage(real[format], MIME[format])).toEqual({
      ok: true,
      value: { format, mime: MIME[format], extension: format === "jpeg" ? "jpg" : format, width: 400, height: 320 }
    });
  });

  it("accepts the exact side limits and rejects one pixel beyond", async () => {
    expect(await inspectImage(await realImage("png", 320, 320))).toMatchObject({ ok: true, value: { width: 320, height: 320 } });
    expect(await inspectImage(await realImage("jpeg", 4096, 320))).toMatchObject({ ok: true, value: { width: 4096, height: 320 } });
    expect(await inspectImage(await realImage("webp", 319, 400))).toMatchObject({ ok: false, error: { code: "too_small" } });
    expect(await inspectImage(await realImage("png", 4097, 320))).toMatchObject({ ok: false, error: { code: "too_big" } });
  }, 60_000);

  it.each([
    ["a PNG signature + IHDR 800×600 without IDAT/IEND", () => png(800, 600)],
    ["a JPEG with a frame header but no scan or EOI", () => jpeg(800, 600)],
    ["a lossy WebP header without image data", () => webpLossy(800, 600)],
    ["a lossless WebP header without image data", () => webpLossless(800, 600)],
    ["an extended WebP header without image data", () => webpExtended(800, 600)],
    ["an AVIF with dimensions but no coded image", () => avif([[800, 600]])]
  ])("rejects %s (it only looks like an image)", async (_name, make) => {
    const file = make();
    expect(inspectImageHeader(file).ok).toBe(true);
    expect(await inspectImage(file)).toMatchObject({ ok: false, error: { code: "corrupt" } });
  });

  it.each(FORMATS)("rejects a real %s cut short", async (format) => {
    expect(inspectImageHeader(truncate(real[format], 0.6)).ok).toBe(true);
    expect(await inspectImage(truncate(real[format], 0.6))).toMatchObject({ ok: false, error: { code: "corrupt" } });
    expect(await inspectImage(real[format].slice(0, real[format].length - 20))).toMatchObject({ ok: false, error: { code: "corrupt" } });
  });

  // PNG (CRC per chunk) and AVIF (AV1 bitstream + box sizes) detect damaged data.
  it.each(["png", "avif"] as const)("rejects a real %s whose image data is corrupted", async (format) => {
    const damaged = corruptMiddle(real[format]);
    expect(damaged.length).toBe(real[format].length);
    expect(await inspectImage(damaged)).toMatchObject({ ok: false, error: { code: "corrupt" } });
  });

  // JPEG has no checksum: a damaged block of entropy data or a stray marker is detected; a few
  // flipped bytes that still decode are not (documented limit, like lossy WebP).
  it("rejects a real JPEG with a damaged scan or an end marker inside it", async () => {
    expect(await inspectImage(corruptMiddle(real.jpeg, 512))).toMatchObject({ ok: false, error: { code: "corrupt" } });
    const earlyEnd = new Uint8Array(real.jpeg);
    const middle = Math.floor(earlyEnd.length / 2);
    earlyEnd.set([0xff, 0xd9], middle);
    expect(await inspectImage(earlyEnd)).toMatchObject({ ok: false, error: { code: "corrupt" } });
  });

  it("rejects a WebP whose RIFF size does not cover the file exactly", async () => {
    const padded = new Uint8Array(real.webp.length + 16);
    padded.set(real.webp);
    expect(await inspectImage(padded)).toMatchObject({ ok: false, error: { code: "corrupt" } });
  });

  it("rejects real GIF, SVG and animated WebP files", async () => {
    expect(await inspectImage(await realGif(), "image/gif")).toMatchObject({ ok: false, error: { code: "unsupported_type" } });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800"/></svg>');
    expect(await inspectImage(svg, "image/png")).toMatchObject({ ok: false, error: { code: "unsupported_type" } });
    expect(await inspectImage(await animatedWebp(), "image/webp")).toMatchObject({ ok: false, error: { code: "animated" } });
  });

  it("still rejects a real image whose declared type contradicts it", async () => {
    expect(await inspectImage(real.png, "image/jpeg")).toMatchObject({ ok: false, error: { code: "type_mismatch" } });
  });
});
