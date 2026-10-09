export interface RateLimitStore {
  increment(key: string, windowStartMs: number, expiresAtMs: number, nowMs?: number): Promise<number>;
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
  error?: "rate_limit_backend_unavailable" | undefined;
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
 * 
 * Provenance security:
 * 1. Checks `x-vercel-forwarded-for` first: set by Vercel Edge Router with the real client IP,
 *    immune to client forgery.
 * 2. Checks `x-real-ip`: set by trusted edge reverse proxy.
 * 3. Client-provided `x-forwarded-for` alone CANNOT be trusted even if it contains valid IP syntax,
 *    because attackers can rotate arbitrary valid IPs to evade rate limiting.
 *    Any unverified header falls back to the canonical bucket "untrusted-client".
 */
export function extractClientIp(headers: Headers | Readonly<Record<string, string | null | undefined>>): string {
  const getHeader = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name);
    }
    const rec = headers as Record<string, string | null | undefined>;
    return rec[name] ?? rec[name.toLowerCase()] ?? null;
  };

  // 1. Procedencia confiable en Vercel Edge
  const vercelIp = getHeader("x-vercel-forwarded-for")?.trim();
  if (vercelIp && isValidIp(vercelIp)) {
    return vercelIp;
  }

  // 2. Proxy inverso de confianza
  const realIp = getHeader("x-real-ip")?.trim();
  if (realIp && isValidIp(realIp)) {
    return realIp;
  }

  // 3. Sintaxis no basta: x-forwarded-for sin procedencia Vercel ni x-real-ip
  // se canaliza al bucket canónico 'untrusted-client' para neutralizar evasiones por rotación de IPs.
  return "untrusted-client";
}

interface Entry {
  count: number;
  expiresAt: number;
}

/**
 * Backend interface for distributed, atomic rate limiting with real TTL.
 */
export interface DistributedQuotaBackend {
  atomicIncrement(key: string, windowStartMs: number, expiresAtMs: number, nowMs?: number): Promise<number>;
  clear?(): void;
  size?(): number;
}

export interface RemoteQuotaTransportPayload {
  key: string;
  windowStartMs: number;
  expiresAtMs: number;
  nowMs: number;
}

export interface RemoteQuotaTransportResponse {
  count: number;
}

/**
 * P2-14: Timeout finito para el transporte de cuota distribuida remota (en milisegundos).
 * Limita el tiempo de espera a 2.5s antes de abortar con AbortSignal y fallar cerrado (HTTP 503),
 * evitando cuelgues indefinidos de la función serverless y garantizando que 0 peticiones se envíen a MP.
 */
export const DEFAULT_REMOTE_QUOTA_TIMEOUT_MS = 2500;

/**
 * P2-05 / P2-14: Backend de cuota distribuida a través de transporte de red HTTP.
 * Desacopla runtimes serverless (Lambdas/Edge) comunicando con un servicio centralizado de cuota.
 */
export class RemoteTransportQuotaBackend implements DistributedQuotaBackend {
  readonly timeoutMs: number;

  constructor(
    private options: {
      endpointUrl: string;
      fetcher?: typeof fetch;
      apiKey?: string;
      timeoutMs?: number;
    }
  ) {
    const configuredTimeout =
      options.timeoutMs ??
      (typeof process !== "undefined" && process.env.RATE_LIMIT_TIMEOUT_MS
        ? Number(process.env.RATE_LIMIT_TIMEOUT_MS)
        : undefined);
    this.timeoutMs =
      typeof configuredTimeout === "number" && Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_REMOTE_QUOTA_TIMEOUT_MS;
  }

  async atomicIncrement(key: string, windowStartMs: number, expiresAtMs: number, nowMs?: number): Promise<number> {
    const fetchFn = this.options.fetcher ?? fetch;
    const body: RemoteQuotaTransportPayload = {
      key,
      windowStartMs,
      expiresAtMs,
      nowMs: nowMs ?? Date.now()
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId =
      controller && this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : null;

    const init: RequestInit = {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    };
    if (controller) {
      init.signal = controller.signal;
    }

    try {
      const response = await fetchFn(this.options.endpointUrl, init);

      if (!response.ok) {
        throw new Error(`Transporte de cuota devolvió HTTP ${response.status}`);
      }

      const json = (await response.json()) as RemoteQuotaTransportResponse;
      if (typeof json?.count !== "number" || !Number.isFinite(json.count)) {
        throw new Error("Formato de respuesta de cuota inválido: falta count");
      }
      return json.count;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

/**
 * P2-05: Implementación de cuota distribuida basada en Supabase RPC.
 *
 * Decisión técnica y diseño de migración (para aplicar tras autorización):
 *
 * ```sql
 * create table if not exists private.rate_limit_quotas (
 *   key text primary key,
 *   count integer not null check (count > 0),
 *   window_start timestamptz not null,
 *   expires_at timestamptz not null,
 *   updated_at timestamptz not null default now()
 * );
 *
 * create or replace function private.atomic_increment_rate_limit(
 *   p_key text,
 *   p_window_start timestamptz,
 *   p_expires_at timestamptz,
 *   p_now timestamptz default now()
 * )
 * returns integer
 * language plpgsql
 * security definer
 * as $$
 * declare
 *   v_count integer;
 * begin
 *   insert into private.rate_limit_quotas (key, count, window_start, expires_at, updated_at)
 *   values (p_key, 1, p_window_start, p_expires_at, p_now)
 *   on conflict (key) do update
 *     set count = case
 *                   when private.rate_limit_quotas.expires_at <= p_now then 1
 *                   else private.rate_limit_quotas.count + 1
 *                 end,
 *         window_start = case
 *                          when private.rate_limit_quotas.expires_at <= p_now then p_window_start
 *                          else private.rate_limit_quotas.window_start
 *                        end,
 *         expires_at = case
 *                        when private.rate_limit_quotas.expires_at <= p_now then p_expires_at
 *                        else private.rate_limit_quotas.expires_at
 *                      end,
 *         updated_at = p_now
 *   returning count into v_count;
 *   return v_count;
 * end;
 * $$;
 * ```
 */
export class SupabaseRpcQuotaBackend implements DistributedQuotaBackend {
  constructor(
    private client: {
      rpc: (
        name: string,
        params: Record<string, unknown>
      ) => Promise<{ data: unknown; error: unknown }>;
    }
  ) {}

  async atomicIncrement(key: string, windowStartMs: number, expiresAtMs: number, nowMs?: number): Promise<number> {
    const { data, error } = await this.client.rpc("atomic_increment_rate_limit", {
      p_key: key,
      p_window_start: new Date(windowStartMs).toISOString(),
      p_expires_at: new Date(expiresAtMs).toISOString(),
      p_now: new Date(nowMs ?? Date.now()).toISOString()
    });

    if (error) {
      throw new Error(
        `Error en Supabase RPC atomic_increment_rate_limit: ${String(
          (error as { message?: string }).message || error
        )}`
      );
    }

    if (typeof data !== "number") {
      throw new Error("RPC atomic_increment_rate_limit devolvió resultado no numérico");
    }

    return data;
  }
}

/**
 * Atomic in-memory implementation of DistributedQuotaBackend.
 * Serializes access per key to guarantee atomic updates without race conditions,
 * evicts expired keys according to real TTL, and enforces upper memory bounds.
 */
export class DistributedMemoryQuotaBackend implements DistributedQuotaBackend {
  private entries = new Map<string, Entry>();
  private queue = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;

  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = options?.maxEntries ?? 5000;
  }

  async atomicIncrement(key: string, windowStartMs: number, expiresAtMs: number, nowMs?: number): Promise<number> {
    const prevPromise = this.queue.get(key) ?? Promise.resolve();
    let resolveCurrent!: () => void;
    const currentPromise = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    this.queue.set(key, currentPromise);

    await prevPromise;

    try {
      const now = nowMs ?? windowStartMs;

      // Real TTL: evict expired entries
      for (const [k, v] of this.entries.entries()) {
        if (v.expiresAt <= now) {
          this.entries.delete(k);
        }
      }

      // Bound check
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
    } finally {
      if (this.queue.get(key) === currentPromise) {
        this.queue.delete(key);
      }
      resolveCurrent();
    }
  }

  clear(): void {
    this.entries.clear();
    this.queue.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

/**
 * Distributed rate limit store adapter.
 * Each serverless instance or cold start creates its own store instance,
 * which coordinates atomically with the shared distributed quota backend.
 */
export class DistributedRateLimitStore implements RateLimitStore {
  constructor(private backend: DistributedQuotaBackend = getGlobalDistributedBackend()) {}

  async increment(key: string, windowStartMs: number, expiresAtMs: number, nowMs?: number): Promise<number> {
    return this.backend.atomicIncrement(key, windowStartMs, expiresAtMs, nowMs);
  }

  clear(): void {
    this.backend.clear?.();
  }

  size(): number {
    return this.backend.size?.() ?? 0;
  }
}

/**
 * Atomic quota store with real TTL.
 * Uses DistributedMemoryQuotaBackend for backwards compatibility.
 */
export class AtomicRateLimitStore extends DistributedRateLimitStore {
  constructor(options?: { maxEntries?: number; backend?: DistributedQuotaBackend }) {
    super(options?.backend ?? new DistributedMemoryQuotaBackend(options));
  }
}

// Alias for backwards compatibility
export const MemoryRateLimitStore = AtomicRateLimitStore;

const GLOBAL_DISTRIBUTED_BACKEND_KEY = Symbol.for("bunker.checkout.distributedQuotaBackend");

export function getGlobalDistributedBackend(options?: { maxEntries?: number }): DistributedQuotaBackend {
  const globalObj = globalThis as unknown as { [key: symbol]: DistributedQuotaBackend | undefined };
  if (!globalObj[GLOBAL_DISTRIBUTED_BACKEND_KEY]) {
    globalObj[GLOBAL_DISTRIBUTED_BACKEND_KEY] = new DistributedMemoryQuotaBackend(options);
  }
  return globalObj[GLOBAL_DISTRIBUTED_BACKEND_KEY];
}

export class UnavailableRateLimitStore implements RateLimitStore {
  constructor(private message = "Servicio de cuota distribuida no disponible") {}

  async increment(): Promise<number> {
    throw new Error(`rate_limit_backend_unavailable: ${this.message}`);
  }

  clear(): void {}
  size(): number {
    return 0;
  }
}

export type RateLimitBackendKind = "distributed" | "local" | "unavailable";

export interface RateLimitUpstreamValidation {
  valid: boolean;
  url?: string | undefined;
  apiKey?: string | undefined;
  reason?: string | undefined;
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0.0.0.0"
  );
}

/**
 * P2-14: Validación centralizada de la configuración del servicio remoto de cuota (RATE_LIMIT_UPSTREAM_URL).
 * Reglas de seguridad:
 * 1. La URL debe estar presente, bien formada y parseable por URL().
 * 2. Esquemas permitidos: únicamente 'https:' o 'http:'. Cualquier otro ('ftp:', 'file:', etc.) es inválido.
 * 3. En producción (NODE_ENV === 'production'): HTTPS remoto obligatorio (se prohíbe 'http:' y hosts loopback/localhost).
 * 4. Fuera de producción (desarrollo/test): 'http:' solo se admite para loopback/localhost.
 * 5. Protección de credenciales: RATE_LIMIT_API_KEY NUNCA puede ser enviada por 'http:' en texto claro.
 */
export function validateRateLimitUpstream(
  environment: Readonly<Record<string, string | undefined>> = process.env
): RateLimitUpstreamValidation {
  const rawUrl = environment.RATE_LIMIT_UPSTREAM_URL?.trim();
  if (!rawUrl) {
    return { valid: false, reason: "missing" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: "invalid_url" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { valid: false, reason: "unsupported_protocol" };
  }

  const isProduction = environment.NODE_ENV === "production";
  const isLoopback = isLoopbackHost(parsed.hostname);
  const apiKey = environment.RATE_LIMIT_API_KEY?.trim() || undefined;

  // En producción: HTTPS remoto obligatorio (prohibido http: y prohibido loopback/localhost)
  if (isProduction) {
    if (parsed.protocol !== "https:") {
      return { valid: false, reason: "production_requires_https" };
    }
    if (isLoopback) {
      return { valid: false, reason: "production_requires_remote_host" };
    }
  } else {
    // Fuera de producción: http: solo permitido contra localhost / loopback controlado
    if (parsed.protocol === "http:" && !isLoopback) {
      return { valid: false, reason: "remote_http_forbidden" };
    }
  }

  // RATE_LIMIT_API_KEY nunca puede transmitirse por HTTP en texto claro
  if (parsed.protocol === "http:" && apiKey) {
    return { valid: false, reason: "api_key_over_http_forbidden" };
  }

  return {
    valid: true,
    url: parsed.toString(),
    ...(apiKey ? { apiKey } : {})
  };
}

/**
 * Which quota backend a configuration yields, without building it: `distributed` with a valid
 * `RATE_LIMIT_UPSTREAM_URL`; otherwise `unavailable` when a distributed backend is required (or in
 * production, or with an invalid upstream configured) and `local` in development.
 * `getSharedRateLimitStore` and the Mercado Pago availability guard both decide from here,
 * so the storefront never offers what the route refuses.
 */
export function rateLimitBackendKind(
  options: { requireDistributed?: boolean } = {},
  environment: Readonly<Record<string, string | undefined>> = process.env
): RateLimitBackendKind {
  const upstream = validateRateLimitUpstream(environment);
  if (upstream.valid) return "distributed";

  // P2-14: Si se configuró RATE_LIMIT_UPSTREAM_URL pero no es válida, la configuración es defectuosa.
  // NUNCA caer silenciosamente a memoria local en desarrollo cuando hay una URL mal configurada.
  const hasConfiguredUpstream = Boolean(environment.RATE_LIMIT_UPSTREAM_URL?.trim());
  if (hasConfiguredUpstream) return "unavailable";

  return options.requireDistributed || environment.NODE_ENV === "production" ? "unavailable" : "local";
}

export function getSharedRateLimitStore(options?: {
  backend?: DistributedQuotaBackend;
  maxEntries?: number;
  requireDistributed?: boolean;
  timeoutMs?: number;
}): RateLimitStore {
  if (options?.backend) {
    return new DistributedRateLimitStore(options.backend);
  }

  const kind = rateLimitBackendKind(
    options?.requireDistributed ? { requireDistributed: true } : {},
    process.env
  );

  if (kind === "distributed") {
    const upstream = validateRateLimitUpstream(process.env);
    if (!upstream.valid) {
      return new UnavailableRateLimitStore("Configuración de upstream distribuido inválida");
    }
    const envTimeout =
      typeof process !== "undefined" && process.env.RATE_LIMIT_TIMEOUT_MS
        ? Number(process.env.RATE_LIMIT_TIMEOUT_MS)
        : undefined;
    const timeoutMs =
      options?.timeoutMs ??
      (typeof envTimeout === "number" && Number.isFinite(envTimeout) && envTimeout > 0
        ? envTimeout
        : DEFAULT_REMOTE_QUOTA_TIMEOUT_MS);

    return new DistributedRateLimitStore(
      new RemoteTransportQuotaBackend({
        endpointUrl: upstream.url!,
        ...(upstream.apiKey ? { apiKey: upstream.apiKey } : {}),
        timeoutMs
      })
    );
  }

  // P2-05 / P2-14: En producción o cuando se exige cuota distribuida (o configuración inválida),
  // NUNCA caer silenciosamente en memoria local por proceso.
  // Falla cerrado (503) garantizando que no haya bypass entre réplicas / cold starts.
  if (kind === "unavailable") {
    return new UnavailableRateLimitStore(
      "No hay servicio de cuota distribuido válido configurado (RATE_LIMIT_UPSTREAM_URL ausente o inválido)"
    );
  }

  return new DistributedRateLimitStore(getGlobalDistributedBackend(options));
}

export function createFixedWindowRateLimiter(options: RateLimiterOptions) {
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("El límite debe ser positivo");
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1) throw new Error("La ventana debe ser positiva");

  return {
    async check(key: string): Promise<RateLimitResult> {
      const now = options.now();
      const windowStart = Math.floor(now / options.windowMs) * options.windowMs;
      const expiresAt = windowStart + options.windowMs;

      try {
        const count = await options.store.increment(key, windowStart, expiresAt, now);
        return {
          allowed: count <= options.limit,
          remaining: Math.max(0, options.limit - count),
          retryAfterMs: Math.max(0, expiresAt - now)
        };
      } catch {
        // Política explícita segura: backend de cuota caído -> FAIL CLOSED, jamás bypass!
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: options.windowMs,
          error: "rate_limit_backend_unavailable"
        };
      }
    }
  };
}
