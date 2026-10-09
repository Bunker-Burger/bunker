import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

describe("proxy matcher", () => {
  it("matches application documents but excludes static and service-worker assets", () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });

    expect(matches("http://localhost/")).toBe(true);
    expect(matches("http://localhost/bunker")).toBe(true);
    expect(matches("http://localhost/bunker/admin")).toBe(true);
    expect(matches("http://localhost/_next/static/chunk.js")).toBe(false);
    expect(matches("http://localhost/_next/image?url=%2Fburger.png&w=640&q=75")).toBe(false);
    expect(matches("http://localhost/favicon.ico")).toBe(false);
    expect(matches("http://localhost/manifest.webmanifest")).toBe(false);
    expect(matches("http://localhost/sw.js")).toBe(false);
    expect(matches("http://localhost/images/burger.webp")).toBe(false);
  });
});
