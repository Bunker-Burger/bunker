import { describe, expect, it } from "vitest";

import type { RateLimitStore } from "./rate-limit";
import { createFixedWindowRateLimiter } from "./rate-limit";

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
