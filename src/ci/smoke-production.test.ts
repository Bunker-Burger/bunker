import { execFile, type ExecFileException } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/*
 * The production smoke test (scripts/ci/smoke-production.mjs) run as the workflow runs it, against a
 * local stand-in of the site. The stand-in answers like the real routes; each case breaks one.
 */

const SCRIPT = path.resolve(__dirname, "../../scripts/ci/smoke-production.mjs");

type Route = (request: IncomingMessage, body: string) => { status: number; body: unknown; type?: string };

const product = {
  id: "p1",
  published: true,
  inStock: true,
  optionGroups: [
    { id: "size", required: true, minSelections: 1, defaultOptionIds: ["double"], options: [{ id: "double", available: true }] },
    { id: "extras", required: false, minSelections: 0, defaultOptionIds: [], options: [{ id: "bacon", available: true }] }
  ]
};

function site(overrides: Record<string, Route> = {}): Record<string, Route> {
  return {
    "GET /": () => ({ status: 200, type: "text/html", body: "<h1>LA CARTA DEL BÚNKER</h1>" }),
    "GET /api/store/products": () => ({ status: 200, body: { products: [product], categories: [] } }),
    "GET /api/store/status": () => ({ status: 200, body: { acceptingOrders: true } }),
    "POST /api/checkout/whatsapp": (_request, raw) => {
      const order = JSON.parse(raw) as { items?: Array<{ optionSelections: Record<string, string[]> }> };
      if (!order.items) return { status: 400, body: { error: "invalid_request" } };
      // The real route refuses an order without the required group.
      if (order.items[0]?.optionSelections.size?.[0] !== "double") return { status: 422, body: { error: "invalid_cart" } };
      return { status: 200, body: { url: "https://wa.me/5490000000000?text=x" } };
    },
    "GET /bunker": () => ({ status: 200, type: "text/html", body: "<h1>Administración</h1><button>Ingresar</button>" }),
    "GET /legal/privacidad": () => ({ status: 200, type: "text/html", body: "<h1>Privacidad</h1>" }),
    "POST /api/checkout/mercado-pago": () => ({ status: 400, body: { error: "invalid_request" } }),
    ...overrides
  };
}

let server: Server | undefined;
async function serve(routes: Record<string, Route>): Promise<string> {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const route = routes[`${request.method} ${new URL(request.url ?? "/", "http://x").pathname}`];
      const answer = route ? route(request, raw) : { status: 404, body: { error: "not_found" } };
      response.writeHead(answer.status, { "content-type": answer.type ?? "application/json" });
      response.end(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

function smoke(base: string, ...flags: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, base, ...flags], { encoding: "utf8" }, (error: ExecFileException | null, stdout: string, stderr: string) =>
      resolve({ code: error ? Number(error.code ?? 1) : 0, output: `${stdout}${stderr}` })
    );
  });
}

describe("smoke-production.mjs", () => {
  it("passes a healthy site: menu, catalog, status, a WhatsApp test order, admin login, privacy", async () => {
    const result = await smoke(await serve(site()));
    expect(result.code).toBe(0);
    expect(result.output).toContain("ok   whatsapp: pedido de prueba con enlace de WhatsApp");
    expect(result.output).toContain("ok   mercado pago: omitido: Mercado Pago no está habilitado (#38)");
    expect(result.output).not.toContain("::error::");
  });

  it("checks Mercado Pago only when asked", async () => {
    const result = await smoke(await serve(site()), "--mercado-pago");
    expect(result.code).toBe(0);
    expect(result.output).toContain("ok   mercado pago: rechaza un pedido inválido (400)");
  });

  it("a closed store is a valid state, not a failure", async () => {
    const result = await smoke(await serve(site({ "POST /api/checkout/whatsapp": (_r, raw) => (JSON.parse(raw).items ? { status: 409, body: { error: "store_closed" } } : { status: 400, body: { error: "invalid_request" } }) })));
    expect(result.code).toBe(0);
    expect(result.output).toContain("el local está cerrado ahora");
  });

  it.each<[string, Record<string, Route>, RegExp]>([
    ["the menu could not read Supabase", { "GET /": () => ({ status: 200, type: "text/html", body: "LA CARTA DEL BÚNKER No pudimos cargar la carta" }) }, /::error::carta: \/ no pudo leer la carta/],
    ["the home page errors", { "GET /": () => ({ status: 500, type: "text/html", body: "error" }) }, /::error::carta: \/ respondió 500/],
    ["the catalog API errors", { "GET /api/store/products": () => ({ status: 503, body: { error: "unavailable" } }) }, /::error::productos/],
    ["the status API errors", { "GET /api/store/status": () => ({ status: 503, body: { error: "unavailable" } }) }, /::error::estado del local/],
    ["WhatsApp returns 5xx", { "POST /api/checkout/whatsapp": () => ({ status: 503, body: { error: "unavailable" } }) }, /::error::whatsapp/],
    ["WhatsApp rejects a valid test order", { "POST /api/checkout/whatsapp": (_r, raw) => (JSON.parse(raw).items ? { status: 422, body: { error: "invalid_cart" } } : { status: 400, body: { error: "invalid_request" } }) }, /::error::whatsapp: el pedido de prueba respondió 422 invalid_cart/],
    ["the admin login is missing", { "GET /bunker": () => ({ status: 307, body: "" }) }, /::error::login admin/],
    ["privacy is missing", { "GET /legal/privacidad": () => ({ status: 404, body: "" }) }, /::error::privacidad/]
  ])("fails when %s", async (_case, overrides, message) => {
    const result = await smoke(await serve(site(overrides)));
    expect(result.code).toBe(1);
    expect(result.output).toMatch(message);
  });

  it("fails when Mercado Pago is enabled and its route errors", async () => {
    const result = await smoke(await serve(site({ "POST /api/checkout/mercado-pago": () => ({ status: 500, body: {} }) })), "--mercado-pago");
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/::error::mercado pago/);
  });

  it("refuses to run without a site URL", async () => {
    expect((await smoke("")).code).toBe(1);
  });
});
