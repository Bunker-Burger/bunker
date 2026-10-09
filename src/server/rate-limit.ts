export interface RateLimitStore {
  increment(key: string, windowStartMs: number, expiresAtMs: number): Promise<number>;
}

interface RateLimiterOptions {
  store: RateLimitStore;
  limit: number;
  windowMs: number;
  now(): number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255 && (part === "0" || !part.startsWith("0"));
  });
}

export function isValidIpv6(ip: string): boolean {
  return /^[0-9a-fA-F:]{2,39}$/.test(ip) && ip.includes(":");
}

export function isValidIp(ip: string): boolean {
  return isValidIpv4(ip) || isValidIpv6(ip);
}

/**
 * Extracts a verified client IP address from request headers.
 * Prioritizes `x-real-ip` (set by trusted edge reverse proxy).
 * When falling back to `x-forwarded-for`, inspects from the proxy-facing end
 * and strictly verifies valid IPv4/IPv6 syntax.
 * Invalid or forged header strings fall back to a safe canonical bucket "untrusted-client".
 */
export function extractClientIp(headers: Headers | Readonly<Record<string, string | null | undefined>>): string {
  const getHeader = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name);
    }
    const rec = headers as Record<string, string | null | undefined>;
    return rec[name] ?? rec[name.toLowerCase()] ?? null;
  };

  const realIp = getHeader("x-real-ip")?.trim();
  if (realIp && isValidIp(realIp)) {
    return realIp;
  }

  const forwardedFor = getHeader("x-forwarded-for")?.trim();
  if (forwardedFor) {
    const parts = forwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
    // Examine candidate IPs from right to left (closest to edge proxy)
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts[i]!;
      if (isValidIp(candidate)) {
        return candidate;
      }
    }
  }

  return "untrusted-client";
}

export class MemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<string, { count: number; expiresAt: number }>();
  private readonly maxEntries: number;

  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = options?.maxEntries ?? 5000;
  }

  async increment(key: string, _windowStartMs: number, expiresAtMs: number): Promise<number> {
    const now = Date.now();

    // 1. Evict expired entries
    for (const [k, v] of this.entries.entries()) {
      if (v.expiresAt <= now) {
        this.entries.delete(k);
      }
    }

    // 2. Bound check: if still at max capacity, evict oldest entry
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    const current = this.entries.get(key);
    if (!current || current.expiresAt <= now) {
      this.entries.set(key, { count: 1, expiresAt: expiresAtMs });
      return 1;
    }

    current.count += 1;
    return current.count;
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

const GLOBAL_RATE_STORE_KEY = Symbol.for("bunker.checkout.rateLimitStore");

export function getSharedRateLimitStore(options?: { maxEntries?: number }): RateLimitStore {
  const globalObj = globalThis as unknown as { [key: symbol]: RateLimitStore | undefined };
  if (!globalObj[GLOBAL_RATE_STORE_KEY]) {
    globalObj[GLOBAL_RATE_STORE_KEY] = new MemoryRateLimitStore(options);
  }
  return globalObj[GLOBAL_RATE_STORE_KEY];
}

export function createFixedWindowRateLimiter(options: RateLimiterOptions) {
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("El límite debe ser positivo");
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1) throw new Error("La ventana debe ser positiva");

  return {
    async check(key: string): Promise<RateLimitResult> {
      const now = options.now();
      const windowStart = Math.floor(now / options.windowMs) * options.windowMs;
      const expiresAt = windowStart + options.windowMs;
      const count = await options.store.increment(key, windowStart, expiresAt);
      return {
        allowed: count <= options.limit,
        remaining: Math.max(0, options.limit - count),
        retryAfterMs: Math.max(0, expiresAt - now)
      };
    }
  };
}
