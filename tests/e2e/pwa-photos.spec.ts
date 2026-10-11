import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test as base, type Page } from "@playwright/test";

/*
 * BB-16: product photos live in the public `catalog` bucket of Supabase Storage, another origin.
 * The worker keeps them for offline use and stores nothing else from Supabase.
 *
 * Playwright cannot route requests a service worker makes to other origins, so the build's
 * Supabase host is pointed at a local HTTPS stand-in (`--host-resolver-rules`, throwaway
 * self-signed certificate). The worker really fetches over the network, and offline really cuts it.
 */

/** A 1×1 PNG: every URL of the stand-in answers it as a CORS image, so only the worker's policy decides. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

interface StorageStandIn {
  origin: string;
  port: number;
  /** Paths (with query) the stand-in answered. */
  hits: string[];
}

const test = base.extend<object, { storage: StorageStandIn }>({
  storage: [
    async ({}, use) => {
      // The origin the build inlined into the worker (`NEXT_PUBLIC_SUPABASE_URL`).
      const worker = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
      const origin = /https:\/\/[a-z0-9]{20}\.supabase\.co/.exec(worker)?.[0];
      if (!origin) throw new Error("Build with NEXT_PUBLIC_SUPABASE_URL set: without it the worker caches no product photo.");

      const dir = mkdtempSync(path.join(tmpdir(), "bunker-storage-"));
      const key = path.join(dir, "key.pem");
      const cert = path.join(dir, "cert.pem");
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", `/CN=${new URL(origin).hostname}`], {
        stdio: "ignore"
      });
      const hits: string[] = [];
      const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
        hits.push(request.url ?? "");
        response.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" });
        response.end(PNG);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      await use({ origin, port: (server.address() as AddressInfo).port, hits });
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    },
    { scope: "worker" }
  ],
  launchOptions: [
    async ({ storage }, use) => {
      await use({ args: [`--host-resolver-rules=MAP ${new URL(storage.origin).hostname} 127.0.0.1:${storage.port}`, "--ignore-certificate-errors"] });
    },
    { scope: "worker" }
  ]
});

test.use({ ignoreHTTPSErrors: true });

/** Waits, without reloading, until this page's worker finished activating and controls the page. */
async function controlledWithoutReload(page: Page) {
  await page.evaluate(async () => {
    const worker = (await navigator.serviceWorker.ready).active;
    if (worker && worker.state !== "activated") {
      await new Promise<void>((resolve) => {
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
        });
      });
    }
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

/** Adds the images to the page (as the menu does, plain `<img>`) and reports which ones loaded. */
async function loadImages(page: Page, urls: string[]) {
  return page.evaluate(
    (sources) =>
      Promise.all(
        sources.map(
          (src) =>
            new Promise<boolean>((resolve) => {
              const image = new Image();
              image.alt = "";
              image.onload = () => resolve(image.naturalWidth > 0);
              image.onerror = () => resolve(false);
              image.src = src;
              document.body.append(image);
            })
        )
      ),
    urls
  );
}

async function cachedFrom(page: Page, origin: string) {
  return page.evaluate(async (prefix) => {
    const entries: Array<{ cache: string; url: string }> = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        if (request.url.startsWith(prefix)) entries.push({ cache: name, url: request.url });
      }
    }
    return entries;
  }, origin);
}

test("a public product photo seen online opens offline; private Supabase URLs are never stored", async ({ page, context, storage }) => {
  const { origin } = storage;
  const publicPhoto = `${origin}/storage/v1/object/public/catalog/products/e2e/smash-doble.png`;
  const neverStored = [
    `${origin}/storage/v1/object/authenticated/catalog/products/e2e/a.png`,
    `${origin}/storage/v1/object/public/private-orders/a.png`,
    `${origin}/storage/v1/object/sign/catalog/products/e2e/a.png?token=e2e`,
    `${origin}/storage/v1/object/public/catalog/products/e2e/a.png?v=2`,
    `${origin}/rest/v1/products?select=name`,
    `${origin}/auth/v1/user`
  ];

  await page.goto("/");
  await controlledWithoutReload(page);
  // Every URL loads online (the stand-in answers all of them)…
  expect(await loadImages(page, [publicPhoto, ...neverStored])).toEqual(Array(neverStored.length + 1).fill(true));
  expect(storage.hits).toContain("/storage/v1/object/public/catalog/products/e2e/smash-doble.png");
  // …but only the public catalog photo is stored, in the bounded image cache.
  await expect.poll(() => cachedFrom(page, origin)).toEqual([{ cache: "bunker-images", url: publicPhoto }]);

  // Offline: the menu reopens and the photo comes from the cache; the others cannot load.
  await context.setOffline(true);
  const hitsBefore = storage.hits.length;
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "LA CARTA DEL BÚNKER" })).toBeVisible();
  expect(await loadImages(page, [publicPhoto, ...neverStored])).toEqual([true, ...neverStored.map(() => false)]);
  expect(storage.hits.length).toBe(hitsBefore);
  await context.setOffline(false);
});
