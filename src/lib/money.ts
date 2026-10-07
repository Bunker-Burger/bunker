const arsFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

export function formatArs(cents: bigint): string {
  return arsFormatter.format(Number(cents / 100n));
}

