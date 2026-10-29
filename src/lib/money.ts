const arsFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

export function formatArs(cents: bigint): string {
  return arsFormatter.format(Number(cents / 100n));
}

/** Pesos with up to two decimals, for the amounts the admin types in (not cents). */
export const ARS_DECIMAL = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
