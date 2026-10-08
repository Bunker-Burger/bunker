import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

// Every test starts a real Node process (and some, local HTTP servers): allow for a loaded machine.
vi.setConfig({ testTimeout: 20_000 });

interface MockResponseRule {
  status?: number;
  body?: unknown;
  rawBody?: string;
  networkError?: string;
  /** Answer with a redirect to this URL; the preload then behaves as fetch does for the script's `redirect` option. */
  redirectTo?: string;
  /** Response of the redirect target, if the request is (wrongly) followed. */
  followed?: { status?: number; body?: unknown };
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  /** The `redirect` option the script passed to fetch (null when missing). */
  redirect: string | null;
}

async function runCheckAuthScript({
  args = [],
  env = {},
  mockResponses = [],
  preload = "scripts/test-mock-fetch-preload.mjs"
}: {
  args?: string[];
  env?: Record<string, string | undefined>;
  mockResponses?: MockResponseRule[];
  preload?: string;
}) {
  const logFile = resolve(tmpdir(), `auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const summaryFile = resolve(tmpdir(), `summary-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  const preloadPath = resolve(process.cwd(), preload);

  const baseEnv: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: "https://zokkgocmcaqcujltfkjf.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "dummy-anon-key-secret-99999",
    EXPECTED_PROJECT_REF: "zokkgocmcaqcujltfkjf",
    GITHUB_STEP_SUMMARY: summaryFile,
    __MOCK_FETCH_CONFIG: JSON.stringify({ responses: mockResponses }),
    __MOCK_FETCH_LOG_FILE: logFile
  };

  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete baseEnv[k];
    } else {
      baseEnv[k] = v;
    }
  }

  const runEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...baseEnv
  };

  const preloadUrl = pathToFileURL(preloadPath).href;

  let exitCode = 0;
  let stdout = "";
  let stderr = "";

  try {
    const res = await execFileAsync(
      process.execPath,
      ["--import", preloadUrl, resolve(process.cwd(), "scripts/check-auth-signup.mjs"), ...args],
      { env: runEnv }
    );
    stdout = res.stdout;
    stderr = res.stderr;
  } catch (err: unknown) {
    const procError = err as { code?: number; stdout?: string; stderr?: string };
    exitCode = procError.code ?? 1;
    stdout = procError.stdout ?? "";
    stderr = procError.stderr ?? "";
  }

  let capturedRequests: CapturedRequest[] = [];
  if (existsSync(logFile)) {
    try {
      capturedRequests = JSON.parse(readFileSync(logFile, "utf-8")) as CapturedRequest[];
      rmSync(logFile, { force: true });
    } catch {}
  }

  let summaryContent = "";
  if (existsSync(summaryFile)) {
    try {
      summaryContent = readFileSync(summaryFile, "utf-8");
      rmSync(summaryFile, { force: true });
    } catch {}
  }

  return {
    exitCode,
    stdout,
    stderr,
    capturedRequests,
    summaryContent
  };
}

describe("check-auth-signup CLI: validación de entorno y parámetros", () => {
  it("falla con código 1 y 0 requests si falta NEXT_PUBLIC_SUPABASE_URL", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      env: { NEXT_PUBLIC_SUPABASE_URL: undefined }
    });
    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(0);
    expect(stdout).toContain("Missing NEXT_PUBLIC_SUPABASE_URL");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("falla con código 1 y 0 requests si falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      env: { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }
    });
    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(0);
    expect(stdout).toContain("Missing NEXT_PUBLIC_SUPABASE_URL");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("falla con código 1 y 0 requests si EXPECTED_PROJECT_REF no tiene 20 caracteres alfanuméricos válidos", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      env: { EXPECTED_PROJECT_REF: "invalid_ref_length!" }
    });
    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(0);
    expect(stdout).toContain("Missing NEXT_PUBLIC_SUPABASE_URL");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("falla con código 1 y 0 requests si EXPECTED_PROJECT_REF no está en la allowlist de desarrollo", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      env: {
        EXPECTED_PROJECT_REF: "abcdefghijklmnopqrst",
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co"
      }
    });
    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(0);
    expect(stdout).toContain("is not in the allowed development projects list");
    expect(stdout).toContain("RESULT: FAIL");
  });
});

describe("check-auth-signup CLI: validación estricta de origen canónico (ORIGEN - P2)", () => {
  const negativeUrls = [
    { name: "subdominio adicional", url: "https://evil.zokkgocmcaqcujltfkjf.supabase.co" },
    { name: "puerto no estándar (8443)", url: "https://zokkgocmcaqcujltfkjf.supabase.co:8443" },
    { name: "puerto explícito (443)", url: "https://zokkgocmcaqcujltfkjf.supabase.co:443" },
    { name: "userinfo en URL", url: "https://admin:secret@zokkgocmcaqcujltfkjf.supabase.co" },
    { name: "protocolo inseguro (http)", url: "http://zokkgocmcaqcujltfkjf.supabase.co" },
    { name: "pathname en base URL", url: "https://zokkgocmcaqcujltfkjf.supabase.co/extra/path" },
    { name: "query string en base URL", url: "https://zokkgocmcaqcujltfkjf.supabase.co?token=evil" },
    { name: "fragmento hash en base URL", url: "https://zokkgocmcaqcujltfkjf.supabase.co#fragment" },
    { name: "dominio ajeno que no es supabase.co", url: "https://zokkgocmcaqcujltfkjf.attacker.com" },
    { name: "ref no coincidente", url: "https://anotherproject12345.supabase.co" }
  ];

  for (const { name, url } of negativeUrls) {
    it(`rechaza variante negativa "${name}" antes de cualquier fetch (0 requests)`, async () => {
      const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
        env: { NEXT_PUBLIC_SUPABASE_URL: url }
      });
      expect(exitCode).toBe(1);
      expect(capturedRequests).toHaveLength(0);
      expect(stdout).toContain("RESULT: FAIL");
    });
  }
});

describe("check-auth-signup CLI: modo predeterminado read-only (TOCTOU - P2)", () => {
  it("pasa con código 0 y realiza exactamente 1 GET (0 POSTs) cuando settings es válido", async () => {
    const { exitCode, stdout, capturedRequests, summaryContent } = await runCheckAuthScript({
      mockResponses: [
        {
          status: 200,
          body: {
            disable_signup: true,
            external: { email: true }
          }
        }
      ]
    });

    expect(exitCode).toBe(0);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.method).toBe("GET");
    expect(capturedRequests[0]?.url).toBe("https://zokkgocmcaqcujltfkjf.supabase.co/auth/v1/settings");
    expect(stdout).toContain("Mode: read-only (default). Active sign-up probe omitted.");
    expect(stdout).toContain("disable_signup === true: true");
    expect(stdout).toContain("external.email === true: true");
    expect(stdout).toContain("RESULT: PASS — public sign-up is disabled; email sign-in is enabled.");
    expect(summaryContent).toContain("RESULT: PASS");
  });

  it("falla con código 1 y 0 POSTs si disable_signup es false", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      mockResponses: [
        {
          status: 200,
          body: {
            disable_signup: false,
            external: { email: true }
          }
        }
      ]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.method).toBe("GET");
    expect(stdout).toContain("disable_signup === true: false");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("falla con código 1 y 0 POSTs si external.email es false", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      mockResponses: [
        {
          status: 200,
          body: {
            disable_signup: true,
            external: { email: false }
          }
        }
      ]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.method).toBe("GET");
    expect(stdout).toContain("external.email === true: false");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("falla con código 1 y 0 POSTs ante HTTP 401 en /auth/v1/settings", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      mockResponses: [{ status: 401, body: { message: "Invalid API key" } }]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(1);
    expect(stdout).toContain("GET /auth/v1/settings: HTTP 401");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("falla con código 1 y 0 POSTs ante HTTP 500 en /auth/v1/settings", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      mockResponses: [{ status: 500, body: { message: "Internal server error" } }]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(1);
    expect(stdout).toContain("GET /auth/v1/settings: HTTP 500");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("falla con código 1 y 0 POSTs ante JSON malformado en /auth/v1/settings", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      mockResponses: [{ status: 200, rawBody: "not a valid json {{" }]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(1);
    expect(stdout).toContain("Malformed JSON");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("falla con código 1 y 0 POSTs ante excepción de red en fetch", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      mockResponses: [{ networkError: "Failed to connect to host" }]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(1);
    expect(stdout).toContain("Network error");
    expect(stdout).toContain("RESULT: FAIL");
  });
});

describe("check-auth-signup CLI: modo opt-in --active-probe (TOCTOU y HTTP 503 - P2)", () => {
  it("rechazo legítimo de probe: pasa con 3 requests (GET, POST, GET) con HTTP 422 y signup_disabled", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      args: ["--active-probe"],
      mockResponses: [
        {
          status: 200,
          body: { disable_signup: true, external: { email: true } }
        },
        {
          status: 422,
          body: { code: 422, error_code: "signup_disabled", msg: "Signups not allowed" }
        },
        {
          status: 200,
          body: { disable_signup: true, external: { email: true } }
        }
      ]
    });

    expect(exitCode).toBe(0);
    expect(capturedRequests).toHaveLength(3);
    expect(capturedRequests[0]?.method).toBe("GET");
    expect(capturedRequests[1]?.method).toBe("POST");
    expect(capturedRequests[1]?.url).toBe("https://zokkgocmcaqcujltfkjf.supabase.co/auth/v1/signup");
    expect(capturedRequests[2]?.method).toBe("GET");
    expect(stdout).toContain("Mode: active probe");
    expect(stdout).toContain("POST /auth/v1/signup (probe): HTTP 422, error_code: signup_disabled");
    expect(stdout).toContain("status in [400, 422]: true");
    expect(stdout).toContain("error_code === \"signup_disabled\": true");
    expect(stdout).toContain("settings unchanged after the probe: true");
    expect(stdout).toContain("RESULT: PASS — public sign-up is disabled; email sign-in is enabled.");
  });

  it("regresión HTTP 503: FALLA si el probe POST retorna 503 aunque incluya error_code signup_disabled", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      args: ["--active-probe"],
      mockResponses: [
        {
          status: 200,
          body: { disable_signup: true, external: { email: true } }
        },
        {
          status: 503,
          body: { code: 503, error_code: "signup_disabled", msg: "Service Unavailable" }
        },
        {
          status: 200,
          body: { disable_signup: true, external: { email: true } }
        }
      ]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(3);
    expect(stdout).toContain("POST /auth/v1/signup (probe): HTTP 503, error_code: signup_disabled");
    expect(stdout).toContain("status in [400, 422]: false");
    expect(stdout).toContain("FAIL: unexpected probe response HTTP status 503");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("TOCTOU: FALLA si la configuración cambia a disable_signup=false después del probe", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      args: ["--active-probe"],
      mockResponses: [
        {
          status: 200,
          body: { disable_signup: true, external: { email: true } }
        },
        {
          status: 422,
          body: { error_code: "signup_disabled" }
        },
        {
          status: 200,
          body: { disable_signup: false, external: { email: true } } // Cambió en Supabase!
        }
      ]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(3);
    expect(stdout).toContain("settings unchanged after the probe: false");
    expect(stdout).toContain("ALERT: settings changed during probe execution (TOCTOU violation)");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("usuario aceptado: FALLA y emite alerta de cleanup con email si el probe crea cuenta (HTTP 200)", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      args: ["--active-probe"],
      mockResponses: [
        {
          status: 200,
          body: { disable_signup: true, external: { email: true } }
        },
        {
          status: 200,
          body: { id: "usr_unexpected_created", email: "signup-probe-test@example.invalid" }
        },
        {
          status: 200,
          body: { disable_signup: true, external: { email: true } }
        }
      ]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(3);
    expect(stdout).toContain("user returned: true");
    expect(stdout).toContain("ALERT: the probe was accepted; an unconfirmed account may exist");
    expect(stdout).toContain("Delete it in Authentication → Users");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("no envía probe POST si la lectura inicial de settings tiene disable_signup=false", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      args: ["--active-probe"],
      mockResponses: [
        {
          status: 200,
          body: { disable_signup: false, external: { email: true } }
        }
      ]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.method).toBe("GET");
    expect(stdout).toContain("Sign-up probe NOT sent: project does not report sign-up disabled");
    expect(stdout).toContain("RESULT: FAIL");
  });
});

describe("check-auth-signup CLI: confidencialidad y no revelación de secretos", () => {
  it("nunca revela NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en stdout, stderr ni GITHUB_STEP_SUMMARY", async () => {
    const superSecretKey = "secret-super-sensitive-jwt-token-xyz-123456789";
    const { stdout, stderr, summaryContent } = await runCheckAuthScript({
      env: { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: superSecretKey },
      mockResponses: [
        {
          status: 200,
          body: { disable_signup: true, external: { email: true } }
        }
      ]
    });

    expect(stdout).not.toContain(superSecretKey);
    expect(stderr).not.toContain(superSecretKey);
    expect(summaryContent).not.toContain(superSecretKey);
  });
});

describe("check-auth-signup CLI: redirecciones prohibidas (REDIRECT - P2)", () => {
  const validSettings = { status: 200, body: { disable_signup: true, external: { email: true } } };
  const attacker = "https://attacker.example";
  const toAttacker = (requests: CapturedRequest[]) => requests.filter((request) => !request.url.startsWith("https://zokkgocmcaqcujltfkjf.supabase.co/"));

  it("pide redirect:\"error\" al leer settings en modo read-only", async () => {
    const { exitCode, capturedRequests } = await runCheckAuthScript({ mockResponses: [validSettings] });

    expect(exitCode).toBe(0);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.redirect).toBe("error");
  });

  it("pide redirect:\"error\" en las tres solicitudes del probe activo (GET, POST, GET)", async () => {
    const { exitCode, capturedRequests } = await runCheckAuthScript({
      args: ["--active-probe"],
      mockResponses: [validSettings, { status: 422, body: { error_code: "signup_disabled" } }, validSettings]
    });

    expect(exitCode).toBe(0);
    expect(capturedRequests.map((request) => [request.method, request.redirect])).toEqual([
      ["GET", "error"],
      ["POST", "error"],
      ["GET", "error"]
    ]);
  });

  it("302 en settings hacia otro origen con flags válidos: FALLA y nunca consulta ese origen", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      mockResponses: [{ status: 302, redirectTo: `${attacker}/auth/v1/settings`, followed: validSettings }]
    });

    expect(exitCode).toBe(1);
    expect(toAttacker(capturedRequests)).toEqual([]);
    expect(stdout).toContain("Network error reading /auth/v1/settings");
    expect(stdout).not.toContain("disable_signup === true: true");
    expect(stdout).toContain("RESULT: FAIL");
    expect(stdout).not.toContain("RESULT: PASS");
  });

  it("307 en el probe POST hacia otro origen que responde signup_disabled: FALLA sin reenviar cuerpo ni apikey", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      args: ["--active-probe"],
      mockResponses: [
        validSettings,
        { status: 307, redirectTo: `${attacker}/auth/v1/signup`, followed: { status: 422, body: { error_code: "signup_disabled" } } },
        validSettings
      ]
    });

    expect(exitCode).toBe(1);
    expect(toAttacker(capturedRequests)).toEqual([]);
    expect(capturedRequests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(stdout).toContain("Network error during active probe");
    expect(stdout).not.toContain("error_code: signup_disabled");
    expect(stdout).toContain("RESULT: FAIL");
    expect(stdout).not.toContain("RESULT: PASS");
  });

  it("falla cerrado ante un 3xx entregado sin seguir en settings (aunque traiga flags válidos)", async () => {
    const { exitCode, stdout, capturedRequests } = await runCheckAuthScript({
      mockResponses: [{ status: 302, body: { disable_signup: true, external: { email: true } } }]
    });

    expect(exitCode).toBe(1);
    expect(capturedRequests).toHaveLength(1);
    expect(stdout).toContain("Redirect refused from /auth/v1/settings (HTTP 302)");
    expect(stdout).toContain("RESULT: FAIL");
  });

  it("falla cerrado ante un 3xx entregado sin seguir en el probe (aunque traiga signup_disabled)", async () => {
    const { exitCode, stdout } = await runCheckAuthScript({
      args: ["--active-probe"],
      mockResponses: [validSettings, { status: 307, body: { error_code: "signup_disabled" } }, validSettings]
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("FAIL: redirect refused from /auth/v1/signup (HTTP 307)");
    expect(stdout).toContain("RESULT: FAIL");
    expect(stdout).not.toContain("RESULT: PASS");
  });
});

describe("check-auth-signup CLI: redirecciones con fetch real sobre loopback (2 servidores)", () => {
  type Hit = { method: string; path: string; hasApiKey: boolean; body: string };
  type Handler = (request: IncomingMessage, body: string) => { status: number; headers?: Record<string, string>; body?: unknown };

  async function listen(handler: Handler) {
    const hits: Hit[] = [];
    const server: Server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      request.on("end", () => {
        hits.push({ method: request.method ?? "", path: request.url ?? "", hasApiKey: Boolean(request.headers.apikey), body });
        const answer = handler(request, body);
        response.writeHead(answer.status, { "content-type": "application/json", ...(answer.headers ?? {}) });
        response.end(JSON.stringify(answer.body ?? {}));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const close = () => new Promise<void>((done) => server.close(() => done()));
    return { hits, origin, close };
  }

  const settingsBody = { disable_signup: true, external: { email: true } };

  // The second server answers exactly what a passing run needs: following it would look like a PASS.
  const lookalike: Handler = (request) =>
    request.method === "POST" ? { status: 422, body: { error_code: "signup_disabled" } } : { status: 200, body: settingsBody };

  /** First server = the "canonical" origin (through the preload); second = a foreign origin. */
  async function withServers(primary: (secondOrigin: string) => Handler, args: string[] = []) {
    const second = await listen(lookalike);
    const first = await listen(primary(second.origin));
    try {
      const result = await runCheckAuthScript({
        args,
        preload: "scripts/test-loopback-fetch-preload.mjs",
        env: { __LOOPBACK_ORIGIN: first.origin }
      });
      return { ...result, firstHits: first.hits, secondHits: second.hits };
    } finally {
      await first.close();
      await second.close();
    }
  }

  it("control: sin redirección, el harness llega al servidor real con fetch real y el script pasa", async () => {
    const { exitCode, stdout, firstHits, secondHits } = await withServers(() => lookalike);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("RESULT: PASS");
    expect(firstHits).toEqual([{ method: "GET", path: "/auth/v1/settings", hasApiKey: true, body: "" }]);
    expect(secondHits).toEqual([]);
  });

  it("302 real en settings: la solicitud no llega al segundo servidor y el run FALLA", async () => {
    const { exitCode, stdout, firstHits, secondHits } = await withServers((secondOrigin) => () => ({
      status: 302,
      headers: { location: `${secondOrigin}/auth/v1/settings` }
    }));

    expect(exitCode).toBe(1);
    expect(firstHits).toHaveLength(1);
    expect(secondHits).toEqual([]);
    expect(stdout).toContain("Network error reading /auth/v1/settings");
    expect(stdout).not.toContain("RESULT: PASS");
  });

  it("307 real en el probe POST: ni cuerpo, ni contraseña, ni apikey llegan al segundo servidor y el run FALLA", async () => {
    const { exitCode, stdout, firstHits, secondHits } = await withServers(
      (secondOrigin) => (request) =>
        request.method === "POST"
          ? { status: 307, headers: { location: `${secondOrigin}/auth/v1/signup` } }
          : { status: 200, body: settingsBody },
      ["--active-probe"]
    );

    expect(exitCode).toBe(1);
    expect(firstHits.map((hit) => `${hit.method} ${hit.path}`)).toEqual(["GET /auth/v1/settings", "POST /auth/v1/signup"]);
    expect(secondHits).toEqual([]);
    expect(stdout).toContain("Network error during active probe");
    expect(stdout).not.toContain("RESULT: PASS");
  });

  // Node's fetch with redirect:"error" rejects any 3xx, even without Location; the script's own 3xx
  // check (covered with the mock above) is the second layer if a runtime ever delivered one.
  it("3xx real sin Location en el probe: falla cerrado aunque el cuerpo diga signup_disabled", async () => {
    const { exitCode, stdout, secondHits } = await withServers(
      () => (request) =>
        request.method === "POST" ? { status: 307, body: { error_code: "signup_disabled" } } : { status: 200, body: settingsBody },
      ["--active-probe"]
    );

    expect(exitCode).toBe(1);
    expect(secondHits).toEqual([]);
    expect(stdout).toContain("Network error during active probe");
    expect(stdout).not.toContain("error_code: signup_disabled");
    expect(stdout).not.toContain("RESULT: PASS");
  });
});

describe("check-auth-signup CLI: GITHUB_STEP_SUMMARY obligatorio (SUMMARY - P3)", () => {
  const validSettings = { status: 200, body: { disable_signup: true, external: { email: true } } };

  it("si el summary no se puede escribir, un run que habría pasado sale con 1 y advierte sin datos sensibles", async () => {
    const secretKey = "secret-summary-key-should-never-leak-42";
    // A directory is never writable as a file, on any OS.
    const unwritable = tmpdir();
    const { exitCode, stdout, stderr } = await runCheckAuthScript({
      env: { GITHUB_STEP_SUMMARY: unwritable, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secretKey },
      mockResponses: [validSettings]
    });

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/WARNING: could not write GITHUB_STEP_SUMMARY \(E[A-Z]+\); the audit record is incomplete\./);
    expect(stdout).toContain("RESULT: FAIL — the step summary is required evidence and could not be written.");
    expect(stdout).not.toContain("RESULT: PASS");
    for (const output of [stdout, stderr]) {
      expect(output).not.toContain(secretKey);
      expect(output).not.toContain(unwritable);
    }
  });

  it("si el summary no se puede escribir y el chequeo ya fallaba, sigue saliendo con 1", async () => {
    const { exitCode, stdout, stderr } = await runCheckAuthScript({
      env: { GITHUB_STEP_SUMMARY: tmpdir() },
      mockResponses: [{ status: 200, body: { disable_signup: false, external: { email: true } } }]
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain("WARNING: could not write GITHUB_STEP_SUMMARY");
    expect(stdout).not.toContain("RESULT: PASS");
  });

  it("cuando el summary se escribe, incluye el resultado final", async () => {
    const { exitCode, summaryContent } = await runCheckAuthScript({ mockResponses: [validSettings] });

    expect(exitCode).toBe(0);
    expect(summaryContent).toContain("### Supabase Auth: registro público");
    expect(summaryContent).toContain("disable_signup === true: true");
    expect(summaryContent).toContain("RESULT: PASS — public sign-up is disabled; email sign-in is enabled.");
  });
});
