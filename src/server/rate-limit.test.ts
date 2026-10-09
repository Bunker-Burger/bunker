import { describe, expect, it } from "vitest";

import type { RateLimitStore } from "./rate-limit";
import {
  createFixedWindowRateLimiter,
  extractClientIp,
  MemoryRateLimitStore
} from "./rate-limit";

describe("createFixedWindowRateLimiter", () => {
  it("rejects requests above the injected store limit", async () => {
    let count = 0;
    const store: RateLimitStore = { async increment() { count += 1; return count; } };
    const limiter = createFixedWindowRateLimiter({ store, limit: 2, windowMs: 60_000, now: () => 120_000 });

    expect(await limiter.check("ip:1")).toMatchObject({ allowed: true, remaining: 1 });
    expect(await limiter.check("ip:1")).toMatchObject({ allowed: true, remaining: 0 });
    expect(await limiter.check("ip:1")).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: 60_000 });
  });
});

describe("MemoryRateLimitStore (P2-05 bounded memory & eviction)", () => {
  it("bounds memory size and evicts oldest entries at capacity", async () => {
    const store = new MemoryRateLimitStore({ maxEntries: 3 });
    const now = Date.now();
    const expiry = now + 60_000;

    await store.increment("ip:1", now, expiry);
    await store.increment("ip:2", now, expiry);
    await store.increment("ip:3", now, expiry);
    expect(store.size()).toBe(3);

    // Adding 4th entry triggers eviction of oldest entry
    await store.increment("ip:4", now, expiry);
    expect(store.size()).toBe(3);
  });

  it("evicts expired entries on access", async () => {
    const store = new MemoryRateLimitStore();
    const now = Date.now();
    // Entry expired 10 seconds ago
    await store.increment("ip:old", now - 20_000, now - 10_000);
    expect(store.size()).toBe(1);

    // Incrementing another key cleans up the expired one
    await store.increment("ip:new", now, now + 60_000);
    expect(store.size()).toBe(1);
  });
});

describe("extractClientIp (P2-05 adversarial header resistance)", () => {
  it("prioritizes trusted x-real-ip when valid IPv4 or IPv6", () => {
    const ip = extractClientIp({
      "x-real-ip": "181.44.20.15",
      "x-forwarded-for": "10.0.0.1, 192.168.1.1"
    });
    expect(ip).toBe("181.44.20.15");
  });

  it("extracts rightmost valid IP from x-forwarded-for when x-real-ip is absent", () => {
    const ip = extractClientIp({
      "x-forwarded-for": "203.0.113.195, 198.51.100.10"
    });
    expect(ip).toBe("198.51.100.10");
  });

  it("neutralizes adversarial header injection by mapping invalid strings to untrusted-client", () => {
    // Attacker tries to bypass rate limiting with arbitrary strings or invalid IPs
    expect(extractClientIp({ "x-forwarded-for": "attacker-spoofed-token-1" })).toBe("untrusted-client");
    expect(extractClientIp({ "x-forwarded-for": "999.999.999.999" })).toBe("untrusted-client");
    expect(extractClientIp({ "x-real-ip": "<script>alert(1)</script>" })).toBe("untrusted-client");
    expect(extractClientIp({})).toBe("untrusted-client");
  });
});
