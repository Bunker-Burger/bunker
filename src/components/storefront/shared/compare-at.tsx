import { formatArs } from "@/lib/money";

/** The previous price, struck through. Callers keep any space before it and say how much of the markup they need. */
export function CompareAt({
  cents,
  srLabel = true,
  className = "compare-at"
}: {
  cents: bigint;
  /** Prefixes the price with a screen-reader-only "Antes". */
  srLabel?: boolean;
  className?: string | undefined;
}) {
  return (
    <s {...(className ? { className } : {})}>
      {srLabel ? <><span className="sr-only">Antes</span> {formatArs(cents)}</> : formatArs(cents)}
    </s>
  );
}
