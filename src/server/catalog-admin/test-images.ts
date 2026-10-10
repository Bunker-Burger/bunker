import sharp, { type Sharp } from "sharp";
import type { ImageFormat } from "./image";

/*
 * Test-only: real, small encoded images (not hand-made headers). The pixels are a deterministic
 * texture so every format carries a genuine compressed payload, and corruption in the middle of
 * the file lands in image data rather than in padding.
 */

function texture(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 37 + (Math.floor(i / 3) % 251)) & 255;
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

const ENCODE: Record<ImageFormat, (image: Sharp) => Sharp> = {
  jpeg: (image) => image.jpeg({ quality: 80 }),
  png: (image) => image.png(),
  webp: (image) => image.webp({ quality: 80 }),
  avif: (image) => image.avif({ quality: 50, effort: 0 })
};

export async function realImage(format: ImageFormat, width = 400, height = 320): Promise<Uint8Array<ArrayBuffer>> {
  return Uint8Array.from(await ENCODE[format](texture(width, height)).toBuffer());
}

export async function realGif(width = 400, height = 320): Promise<Uint8Array<ArrayBuffer>> {
  return Uint8Array.from(await texture(width, height).gif().toBuffer());
}

/** Two-frame animated WebP. */
export async function animatedWebp(width = 400, height = 320): Promise<Uint8Array<ArrayBuffer>> {
  const frame = await texture(width, height).raw().toBuffer();
  const frames = Buffer.concat([frame, Buffer.from(frame).reverse()]);
  return Uint8Array.from(
    await sharp(frames, { raw: { width, height: height * 2, channels: 3, pageHeight: height } })
      .webp({ quality: 80, loop: 0, delay: [100, 100] })
      .toBuffer()
  );
}

/** Flips `count` bytes from the middle of the file: the data stays the same length. */
export function corruptMiddle(bytes: Uint8Array, count = 64): Uint8Array<ArrayBuffer> {
  const copy = Uint8Array.from(bytes);
  const start = Math.floor(copy.length / 2);
  for (let i = 0; i < count; i += 1) copy[start + i]! ^= 0xff;
  return copy;
}

export const truncate = (bytes: Uint8Array, keep: number): Uint8Array<ArrayBuffer> => Uint8Array.from(bytes.subarray(0, Math.floor(bytes.length * keep)));
