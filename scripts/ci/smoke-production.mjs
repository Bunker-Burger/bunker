#!/usr/bin/env node
/*
 * Smoke test of a deployed site (docs/runbooks/release.md): menu, catalog API, store status,
 * WhatsApp checkout, admin login page and privacy page; Mercado Pago only when it is enabled.
 * Read-only: the WhatsApp checkout stores nothing (src/app/api/checkout/whatsapp/route.ts) and the
 * Mercado Pago probe sends an invalid body that is rejected before anything is created.
 * Dependency-free; run by vercel-production.yml after the deploy and testable against any server
 * (src/ci/smoke-production.test.ts). Exit 1 when any check fails.
 */

import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 15_000;

async function requestWith(base, path, init = {}, headers = {}) {
  const response = await fetch(new URL(path, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) }
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, text, json };
}

/** Defaults (or the first available options) for every group that needs a choice. */
function selectionsFor(product) {
  const selections = {};
  for (const group of product.optionGroups ?? []) {
    const available = (group.options ?? []).filter((option) => option.available).map((option) => option.id);
    const defaults = (group.defaultOptionIds ?? []).filter((id) => available.includes(id));
    const needed = Math.max(group.required ? 1 : 0, group.minSelections ?? 0);
    const chosen = defaults.length >= needed ? defaults : available.slice(0, needed);
    if (chosen.length) selections[group.id] = chosen;
  }
  return selections;
}

/**
 * @param {string} base site origin, e.g. https://bunker-burger.vercel.app
 * @param {{ mercadoPago?: boolean, headers?: Record<string, string> }} options `headers` go with every
 *   request, e.g. Vercel's automation bypass to reach a protected deployment URL (never logged).
 * @returns {Promise<Array<{ name: string, ok: boolean, detail: string }>>}
 */
export async function smoke(base, { mercadoPago = false, headers = {} } = {}) {
  const results = [];
  const request = (url, path, init = {}) => requestWith(url, path, init, headers);
  const check = async (name, run) => {
    try {
      const detail = await run();
      results.push({ name, ok: true, detail });
    } catch (error) {
      results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const expect = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  let products = [];
  await check("carta", async () => {
    const home = await request(base, "/");
    expect(home.status === 200, `/ respondió ${home.status}`);
    expect(home.text.includes("LA CARTA DEL BÚNKER"), "/ no muestra la carta");
    expect(!home.text.includes("No pudimos cargar la carta"), "/ no pudo leer la carta de Supabase");
    return "/ 200 con la carta";
  });
  await check("productos", async () => {
    const response = await request(base, "/api/store/products");
    expect(response.status === 200 && Array.isArray(response.json?.products), `/api/store/products respondió ${response.status}`);
    products = response.json.products;
    return `${products.length} productos`;
  });
  await check("estado del local", async () => {
    const response = await request(base, "/api/store/status");
    expect(response.status === 200 && response.json && typeof response.json === "object", `/api/store/status respondió ${response.status}`);
    return "200";
  });
  await check("whatsapp", async () => {
    const invalid = await request(base, "/api/checkout/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(invalid.status === 400 && invalid.json?.error === "invalid_request", `un pedido inválido respondió ${invalid.status}`);
    const product = products.find((candidate) => candidate.published && candidate.inStock);
    if (!product) return "valida pedidos; no hay productos disponibles para un pedido de prueba";
    for (const paymentMethod of ["cash_exact", "transfer"]) {
      const order = await request(base, "/api/checkout/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: product.id, quantity: 1, optionSelections: selectionsFor(product) }],
          fulfilment: "pickup",
          paymentMethod
        })
      });
      if (order.status === 200) {
        expect(typeof order.json?.url === "string" && order.json.url.startsWith("https://wa.me/"), "el pedido no devolvió un enlace de WhatsApp");
        return "pedido de prueba con enlace de WhatsApp";
      }
      if (order.status === 409 && order.json?.error === "store_closed") return "valida pedidos; el local está cerrado ahora";
      if (order.status === 422 && order.json?.error === "payment_method_unavailable") continue;
      throw new Error(`el pedido de prueba respondió ${order.status} ${order.json?.error ?? ""}`.trim());
    }
    return "valida pedidos; efectivo y transferencia están deshabilitados";
  });
  await check("login admin", async () => {
    const login = await request(base, "/bunker");
    expect(login.status === 200 && login.text.includes("Administración") && login.text.includes("Ingresar"), `/bunker respondió ${login.status} sin el login`);
    return "/bunker 200 con el login";
  });
  await check("privacidad", async () => {
    const privacy = await request(base, "/legal/privacidad");
    expect(privacy.status === 200, `/legal/privacidad respondió ${privacy.status}`);
    return "200";
  });
  if (mercadoPago) {
    await check("mercado pago", async () => {
      const response = await request(base, "/api/checkout/mercado-pago", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(response.status >= 400 && response.status < 500, `un pedido inválido respondió ${response.status}`);
      return `rechaza un pedido inválido (${response.status})`;
    });
  } else {
    results.push({ name: "mercado pago", ok: true, detail: "omitido: Mercado Pago no está habilitado (#38)" });
  }
  return results;
}

export async function main(argv) {
  const base = argv.find((arg) => !arg.startsWith("--"));
  if (!base || !/^https?:\/\//.test(base)) {
    console.log("::error::Uso: smoke-production.mjs <https://sitio> [--mercado-pago]");
    return 1;
  }
  const results = await smoke(base, { mercadoPago: argv.includes("--mercado-pago") });
  for (const result of results) console.log(result.ok ? `ok   ${result.name}: ${result.detail}` : `::error::${result.name}: ${result.detail}`);
  return results.every((result) => result.ok) ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
