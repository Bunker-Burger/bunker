import { describe, expect, it } from "vitest";

import type { RateLimitStore } from "./rate-limit";
import {
  AtomicRateLimitStore,
  createFixedWindowRateLimiter,
  DistributedMemoryQuotaBackend,
  DistributedRateLimitStore,
  extractClientIp,
  MemoryRateLimitStore
} from "./rate-limit";

describe("createFixedWindowRateLimiter (P2-05)", () => {
  it("rejects requests above the injected store limit", async () => {
    let count = 0;
    const store: RateLimitStore = { async increment() { count += 1; return count; } };
    const limiter = createFixedWindowRateLimiter({ store, limit: 2, windowMs: 60_000, now: () => 120_000 });

    expect(await limiter.check("ip:1")).toMatchObject({ allowed: true, remaining: 1 });
    expect(await limiter.check("ip:1")).toMatchObject({ allowed: true, remaining: 0 });
    expect(await limiter.check("ip:1")).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: 60_000 });
  });

  it("fails closed safely when quota backend throws, never bypasses (P2-05)", async () => {
    const faultyStore: RateLimitStore = {
      increment: async () => {
        throw new Error("Connection to quota backend lost");
      }
    };
    const limiter = createFixedWindowRateLimiter({
      store: faultyStore,
      limit: 10,
      windowMs: 60_000,
      now: () => 1_000_000
    });

    const res = await limiter.check("ip:any");
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.retryAfterMs).toBe(60_000);
    expect(res.error).toBe("rate_limit_backend_unavailable");
  });

  it("shares atomic quota across 2 separate serverless instances / cold starts (P2-05)", async () => {
    const sharedBackend = new DistributedMemoryQuotaBackend();
    const fixedNow = 1_000_000;

    // Instance A (Lambda 1): has its own store instance
    const storeA = new DistributedRateLimitStore(sharedBackend);
    const instanceA = createFixedWindowRateLimiter({
      store: storeA,
      limit: 10,
      windowMs: 60_000,
      now: () => fixedNow
    });

    // 6 requests through Instance A
    for (let i = 0; i < 6; i++) {
      const res = await instanceA.check("ip:shared-client");
      expect(res.allowed).toBe(true);
    }

    // Instance B (Lambda 2 / cold start): newly spawned, separate store instance (not same Map reference!)
    const storeB = new DistributedRateLimitStore(sharedBackend);
    expect(storeA).not.toBe(storeB);

    const instanceB = createFixedWindowRateLimiter({
      store: storeB,
      limit: 10,
      windowMs: 60_000,
      now: () => fixedNow
    });

    // 4 requests through Instance B
    for (let i = 0; i < 4; i++) {
      const res = await instanceB.check("ip:shared-client");
      expect(res.allowed).toBe(true);
    }

    // 11th request across either instance MUST be rate limited (429 / allowed: false)
    const rejectedB = await instanceB.check("ip:shared-client");
    expect(rejectedB.allowed).toBe(false);
    expect(rejectedB.remaining).toBe(0);
    expect(rejectedB.retryAfterMs).toBeGreaterThan(0);

    const rejectedA = await instanceA.check("ip:shared-client");
    expect(rejectedA.allowed).toBe(false);
    expect(rejectedA.remaining).toBe(0);
  });

  it("fails closed when distributed backend is down or unreachable (P2-05)", async () => {
    const failingBackend = {
      async atomicIncrement() {
        throw new Error("Distributed backend connection timed out");
      }
    };
    const store = new DistributedRateLimitStore(failingBackend);
    const limiter = createFixedWindowRateLimiter({
      store,
      limit: 10,
      windowMs: 60_000,
      now: () => Date.now()
    });

    const res = await limiter.check("ip:test");
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.error).toBe("rate_limit_backend_unavailable");
  });

  it("enforces atomic quota under concurrency (15 simultaneous requests, exactly 10 pass, 5 reject) (P2-05)", async () => {
    const store = new AtomicRateLimitStore();
    const limiter = createFixedWindowRateLimiter({
      store,
      limit: 10,
      windowMs: 60_000,
      now: () => 1_000_000
    });

    const results = await Promise.all(
      Array.from({ length: 15 }, () => limiter.check("ip:concurrent-client"))
    );

    const allowed = results.filter((r) => r.allowed);
    const rejected = results.filter((r) => !r.allowed);

    expect(allowed.length).toBe(10);
    expect(rejected.length).toBe(5);
    rejected.forEach((r) => {
      expect(r.remaining).toBe(0);
      expect(r.retryAfterMs).toBeGreaterThan(0);
    });
  });

  it("resets quota after window expiration according to real TTL (P2-05)", async () => {
    const store = new AtomicRateLimitStore();
    let currentNow = 1_000_000;
    const limiter = createFixedWindowRateLimiter({
      store,
      limit: 1,
      windowMs: 60_000,
      now: () => currentNow
    });

    const first = await limiter.check("ip:ttl-client");
    expect(first.allowed).toBe(true);

    const second = await limiter.check("ip:ttl-client");
    expect(second.allowed).toBe(false);

    // Advance clock past TTL window (60s)
    currentNow += 60_001;

    const afterTtl = await limiter.check("ip:ttl-client");
    expect(afterTtl.allowed).toBe(true);
  });
});

describe("AtomicRateLimitStore / MemoryRateLimitStore (P2-05 bounded memory & eviction)", () => {
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

describe("extractClientIp (P2-05 Vercel edge provenance & adversarial header resistance)", () => {
  it("prioritizes x-vercel-forwarded-for set by Vercel Edge Router", () => {
    const ip = extractClientIp({
      "x-vercel-forwarded-for": "181.44.20.15",
      "x-forwarded-for": "10.0.0.1, 192.168.1.1" // attacker tries to inject fake forwarded header
    });
    expect(ip).toBe("181.44.20.15");
  });

  it("accepts trusted x-real-ip when x-vercel-forwarded-for is absent", () => {
    const ip = extractClientIp({
      "x-real-ip": "181.44.20.15"
    });
    expect(ip).toBe("181.44.20.15");
  });

  it("neutralizes forged valid IPs in x-forwarded-for lacking trusted provenance into untrusted-client bucket", () => {
    // Attacker rotates valid IP addresses in x-forwarded-for to try to evade rate limit
    const ip1 = extractClientIp({ "x-forwarded-for": "198.51.100.10" });
    const ip2 = extractClientIp({ "x-forwarded-for": "203.0.113.50, 198.51.100.20" });

    // Both are untrusted because neither has x-vercel-forwarded-for nor trusted x-real-ip
    expect(ip1).toBe("untrusted-client");
    expect(ip2).toBe("untrusted-client");
  });

  it("neutralizes adversarial header injection by mapping invalid strings to untrusted-client", () => {
    expect(extractClientIp({ "x-forwarded-for": "attacker-spoofed-token-1" })).toBe("untrusted-client");
    expect(extractClientIp({ "x-forwarded-for": "999.999.999.999" })).toBe("untrusted-client");
    expect(extractClientIp({ "x-real-ip": "<script>alert(1)</script>" })).toBe("untrusted-client");
    expect(extractClientIp({})).toBe("untrusted-client");
  });
});
