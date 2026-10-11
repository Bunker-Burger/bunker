import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

const PUBLIC = path.resolve(__dirname, "../../public");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("web app manifest", () => {
  const value = manifest();

  it("opens the public menu as a standalone app", () => {
    expect(value).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone", name: "Búnker Burger", short_name: "Búnker", lang: "es-AR" });
    expect(value.start_url).not.toMatch(/bunker/);
  });

  it("has installable icons (192 and 512, plus a maskable one) that exist with their declared size", () => {
    const icons = value.icons ?? [];
    expect(icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      const file = path.join(PUBLIC, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      expect(pngSize(file), icon.src).toBe(icon.sizes);
      expect(icon.type).toBe("image/png");
    }
  });

  it("ships the apple-touch-icon iOS uses for the home screen", () => {
    expect(pngSize(path.join(PUBLIC, "icons/apple-touch-icon.png"))).toBe("180x180");
  });
});
