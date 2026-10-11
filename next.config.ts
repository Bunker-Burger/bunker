import { randomUUID } from "node:crypto";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  // Registered by <ServiceWorkerManager>, which also asks before activating a new version (BB-16).
  register: false,
  // Coming back online must not reload a half-filled checkout.
  reloadOnOnline: false,
  // The public offline page, refreshed with every build.
  additionalPrecacheEntries: [{ url: "/offline", revision: process.env.VERCEL_GIT_COMMIT_SHA ?? randomUUID() }]
});

/**
 * The only other origin the worker may fetch: the Supabase project of this build, for the public
 * product photos it caches. Same rule as `publicImageOrigin` in src/app/sw-routes.ts (kept here
 * because next.config.ts cannot share app modules reliably across Node's TypeScript loaders).
 */
function workerImageOrigin() {
  try {
    const { origin } = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "");
    return /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(origin) ? origin : null;
  } catch {
    return null;
  }
}

const imageOrigin = workerImageOrigin();
const workerConnectSrc = imageOrigin ? `'self' ${imageOrigin}` : "'self'";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Product photos go through a Server Action: 5 MB (the image and bucket limit) plus multipart overhead.
      bodySizeLimit: "6mb"
    }
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" }
    ]
  },
  async headers() {
    return [
      {
        // The browser must always check for a new worker; a cached one would pin an old build.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self'; connect-src ${workerConnectSrc}` }
        ]
      }
    ];
  }
};

export default withSerwist(nextConfig);
