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
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
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
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" }
        ]
      }
    ];
  }
};

export default withSerwist(nextConfig);
