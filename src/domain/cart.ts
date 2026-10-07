import type { CartLine, SelectedOptions } from "./types";

const CART_VERSION = 1;

function normalizeNotes(notes: string): string {
  return notes.trim().replace(/\s+/g, " ");
}

function normalizeOptions(options: SelectedOptions): SelectedOptions {
  return Object.fromEntries(
    Object.entries(options)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([groupId, optionIds]) => [groupId, [...new Set(optionIds)].sort()])
  );
}

export function cartLineIdentity(line: Pick<CartLine, "productId" | "notes" | "selectedOptions">): string {
  return JSON.stringify({
    productId: line.productId,
    notes: normalizeNotes(line.notes),
    selectedOptions: normalizeOptions(line.selectedOptions)
  });
}

export function addCartLine(lines: CartLine[], incoming: CartLine): CartLine[] {
  const identity = cartLineIdentity(incoming);
  const match = lines.findIndex((line) => cartLineIdentity(line) === identity);
  const normalized = {
    ...incoming,
    id: identity,
    notes: normalizeNotes(incoming.notes),
    selectedOptions: normalizeOptions(incoming.selectedOptions)
  };

  if (match === -1) return [...lines, normalized];
  return lines.map((line, index) => index === match
    ? { ...line, quantity: line.quantity + incoming.quantity }
    : line);
}

export function serializeCart(lines: CartLine[]): string {
  return JSON.stringify({
    version: CART_VERSION,
    lines: lines.map((line) => ({ ...line, unitPriceCents: line.unitPriceCents.toString() }))
  });
}

export function parsePersistedCart(value: string | null): CartLine[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as { version?: unknown; lines?: unknown };
    if (parsed.version !== CART_VERSION || !Array.isArray(parsed.lines)) return [];
    return parsed.lines.flatMap((candidate): CartLine[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const line = candidate as Record<string, unknown>;
      if (
        typeof line.id !== "string" || typeof line.productId !== "string" ||
        typeof line.productSlug !== "string" || typeof line.productName !== "string" ||
        typeof line.unitPriceCents !== "string" || typeof line.quantity !== "number" ||
        typeof line.notes !== "string" || !line.selectedOptions || typeof line.selectedOptions !== "object"
      ) return [];
      return [{
        id: line.id,
        productId: line.productId,
        productSlug: line.productSlug,
        productName: line.productName,
        unitPriceCents: BigInt(line.unitPriceCents),
        quantity: Math.max(1, Math.floor(line.quantity)),
        notes: line.notes,
        selectedOptions: line.selectedOptions as SelectedOptions
      }];
    });
  } catch {
    return [];
  }
}

