import { describe, expect, it } from "vitest";

import type { PaymentMethodSetting } from "@/domain/types";
import { getMercadoPagoAvailability } from "./mercado-pago-availability";

/*
 * BB-14 R6 P2-12/P2-13: one server-side answer to "can a Mercado Pago checkout start?", from the
 * same rules the route enforces. Environments are passed explicitly; nothing is mocked.
 */

/** Everything a production checkout needs, with the distributed quota service configured. */
const completeProduction = {
  NODE_ENV: "production",
  MERCADO_PAGO_ACCESS_TOKEN: "TEST-access-token",
  APP_URL: "https://bunker.example",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_PROJECT_ENV: "development",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  RATE_LIMIT_UPSTREAM_URL: "https://quota.example/increment"
} as const;

const methods = (mercadoPagoEnabled: boolean): PaymentMethodSetting[] => [
  { method: "cash", displayName: "Efectivo", instructions: "", enabled: true, sortOrder: 10 },
  { method: "mercado_pago", displayName: "Mercado Pago", instructions: "", enabled: mercadoPagoEnabled, sortOrder: 30 }
];

function without<T extends Record<string, string>>(environment: T, ...keys: Array<keyof T>) {
  const copy: Record<string, string> = { ...environment };
  for (const key of keys) delete copy[key as string];
  return copy;
}

describe("getMercadoPagoAvailability", () => {
  it("is available with config, store method, durable storage and distributed quota", () => {
    const availability = getMercadoPagoAvailability({ environment: completeProduction, storePaymentMethods: methods(true) });
    expect(availability).toEqual({
      available: true,
      config: { accessToken: "TEST-access-token", appUrl: "https://bunker.example" }
    });
  });

  it("is unavailable in production without the distributed quota service, exactly when the route would 503", () => {
    expect(
      getMercadoPagoAvailability({ environment: without(completeProduction, "RATE_LIMIT_UPSTREAM_URL"), storePaymentMethods: methods(true) })
    ).toEqual({ available: false, reasons: ["rate_limit_backend"] });
  });

  it("accepts the local quota outside production (development only)", () => {
    const development = { ...without(completeProduction, "RATE_LIMIT_UPSTREAM_URL"), NODE_ENV: "development" };
    expect(getMercadoPagoAvailability({ environment: development, storePaymentMethods: methods(true) }).available).toBe(true);
  });

  it.each([
    ["no service role key", without(completeProduction, "SUPABASE_SERVICE_ROLE_KEY"), ["persistence"]],
    ["no Supabase project", without(completeProduction, "NEXT_PUBLIC_SUPABASE_URL"), ["persistence"]],
    ["no access token", without(completeProduction, "MERCADO_PAGO_ACCESS_TOKEN"), ["config"]],
    ["an APP_URL without a scheme", { ...completeProduction, APP_URL: "sin-esquema" }, ["config"]],
    ["an ftp APP_URL", { ...completeProduction, APP_URL: "ftp://example.com" }, ["config"]]
  ])("is unavailable, without throwing, with %s", (_case, environment, reasons) => {
    expect(getMercadoPagoAvailability({ environment, storePaymentMethods: methods(true) })).toEqual({ available: false, reasons });
  });

  it("requires the store to have enabled the method, and treats unreadable methods as disabled", () => {
    expect(getMercadoPagoAvailability({ environment: completeProduction, storePaymentMethods: methods(false) })).toEqual({
      available: false,
      reasons: ["payment_method_disabled"]
    });
    expect(getMercadoPagoAvailability({ environment: completeProduction, storePaymentMethods: null })).toEqual({
      available: false,
      reasons: ["payment_method_disabled"]
    });
    // The route checks the method itself after loading the catalog.
    expect(getMercadoPagoAvailability({ environment: completeProduction }).available).toBe(true);
  });

  it("reports every missing dependency at once", () => {
    expect(getMercadoPagoAvailability({ environment: { NODE_ENV: "production" }, storePaymentMethods: [] })).toEqual({
      available: false,
      reasons: ["config", "payment_method_disabled", "persistence", "rate_limit_backend"]
    });
  });
});
