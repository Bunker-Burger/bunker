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
