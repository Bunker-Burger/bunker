import { formatArs } from "@/lib/money";
import { validateOptionSelection } from "./options";
import type { CartIssue, CartLine, Product, RevalidationResult, SelectedOptions } from "./types";

export const CART_VERSION = 1;

export function normalizeNotes(notes: string): string {
  return notes.trim().replace(/\s+/g, " ");
}

export function normalizeOptions(options: SelectedOptions): SelectedOptions {
  return Object.fromEntries(
    Object.entries(options)
      .map(([groupId, optionIds]) => [groupId, [...new Set(optionIds)].sort()] as const)
      .filter(([, optionIds]) => optionIds.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

export function cartLineIdentity(line: Pick<CartLine, "productId" | "notes" | "selectedOptions"> & { comboId?: string | undefined }): string {
  return JSON.stringify({
    productId: line.productId,
    ...(line.comboId ? { comboId: line.comboId } : {}),
    notes: normalizeNotes(line.notes),
    selectedOptions: normalizeOptions(line.selectedOptions)
  });
}

export function addCartLine(lines: CartLine[], incoming: CartLine): CartLine[] {
  const normalizedNotes = normalizeNotes(incoming.notes);
  const normalizedOptions = normalizeOptions(incoming.selectedOptions);
  const identity = cartLineIdentity({
    productId: incoming.productId,
    comboId: incoming.comboId,
    notes: normalizedNotes,
    selectedOptions: normalizedOptions
  });

  const match = lines.findIndex((line) => line.id === identity);
  const normalized: CartLine = {
    ...incoming,
    id: identity,
    notes: normalizedNotes,
    selectedOptions: normalizedOptions
  };

  if (match === -1) return [...lines, normalized];
  return lines.map((line, index) =>
    index === match ? { ...line, quantity: line.quantity + incoming.quantity } : line
  );
}

export function changeCartLineQuantity(lines: CartLine[], id: string, delta: number): CartLine[] {
  return lines.flatMap((line) => {
    if (line.id !== id) return [line];
    const quantity = line.quantity + delta;
    return quantity > 0 ? [{ ...line, quantity }] : [];
  });
}

export function updateCartLineQuantity(lines: CartLine[], id: string, quantity: number): CartLine[] {
  const validQty = Math.floor(quantity);
  if (validQty <= 0) {
    return lines.filter((line) => line.id !== id);
  }
  return lines.map((line) => (line.id === id ? { ...line, quantity: validQty } : line));
}

export function updateCartLineNotes(lines: CartLine[], id: string, rawNotes: string): CartLine[] {
  const targetIndex = lines.findIndex((l) => l.id === id);
  if (targetIndex === -1) return lines;

  const current = lines[targetIndex]!;
  const normalizedNotes = normalizeNotes(rawNotes);
  const newIdentity = cartLineIdentity({
    productId: current.productId,
    comboId: current.comboId,
    notes: normalizedNotes,
    selectedOptions: current.selectedOptions
  });

  if (newIdentity === current.id) {
    return lines.map((line, idx) => (idx === targetIndex ? { ...line, notes: normalizedNotes } : line));
  }

  const collisionIndex = lines.findIndex(
    (l, idx) => idx !== targetIndex && (l.id === newIdentity || cartLineIdentity(l) === newIdentity)
  );
  if (collisionIndex !== -1) {
    const existing = lines[collisionIndex]!;
    return lines
      .map((line, idx) =>
        idx === collisionIndex
          ? { ...line, id: newIdentity, quantity: existing.quantity + current.quantity }
          : line
      )
      .filter((_, idx) => idx !== targetIndex);
  }

  return lines.map((line, idx) =>
    idx === targetIndex ? { ...line, id: newIdentity, notes: normalizedNotes } : line
  );
}

export function editCartLine(
  lines: CartLine[],
  id: string,
  updated: {
    selectedOptions?: SelectedOptions;
    unitPriceCents?: bigint;
    notes?: string;
    quantity?: number;
  }
): CartLine[] {
  const targetIndex = lines.findIndex((l) => l.id === id);
  if (targetIndex === -1) return lines;

  const current = lines[targetIndex]!;
  const newNotes = updated.notes !== undefined ? normalizeNotes(updated.notes) : current.notes;
  const newOptions = updated.selectedOptions !== undefined ? normalizeOptions(updated.selectedOptions) : current.selectedOptions;
  const newQuantity = updated.quantity !== undefined ? Math.max(1, Math.floor(updated.quantity)) : current.quantity;
  const newUnitPrice = updated.unitPriceCents !== undefined ? updated.unitPriceCents : current.unitPriceCents;

  const newIdentity = cartLineIdentity({
    productId: current.productId,
    comboId: current.comboId,
    notes: newNotes,
    selectedOptions: newOptions
  });

  const updatedLine: CartLine = {
    ...current,
    id: newIdentity,
    notes: newNotes,
    selectedOptions: newOptions,
    quantity: newQuantity,
    unitPriceCents: newUnitPrice
  };

  const collisionIndex = lines.findIndex(
    (l, idx) => idx !== targetIndex && (l.id === newIdentity || cartLineIdentity(l) === newIdentity)
  );
  if (collisionIndex !== -1) {
    const existing = lines[collisionIndex]!;
    return lines
      .map((line, idx) =>
        idx === collisionIndex
          ? { ...line, id: newIdentity, quantity: existing.quantity + updatedLine.quantity }
          : line
      )
      .filter((_, idx) => idx !== targetIndex);
  }

  return lines.map((line, idx) => (idx === targetIndex ? updatedLine : line));
}

export function removeCartLine(lines: CartLine[], id: string): CartLine[] {
  return lines.filter((line) => line.id !== id);
}

export function clearCart(): CartLine[] {
  return [];
}

export function serializeCart(lines: CartLine[]): string {
  return JSON.stringify({
    version: CART_VERSION,
    lines: lines.map((line) => ({
      ...line,
      unitPriceCents: line.unitPriceCents.toString()
    }))
  });
}

export function parsePersistedCart(value: string | null): CartLine[] {
  if (!value || typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    if (parsed.version !== CART_VERSION || !Array.isArray(parsed.lines)) return [];

    return parsed.lines.flatMap((candidate: unknown): CartLine[] => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const line = candidate as Record<string, unknown>;

      if (
        typeof line.id !== "string" ||
        typeof line.productId !== "string" ||
        typeof line.productSlug !== "string" ||
        typeof line.productName !== "string" ||
        typeof line.unitPriceCents !== "string" ||
        !/^\d+$/.test(line.unitPriceCents) ||
        typeof line.quantity !== "number" ||
        !Number.isFinite(line.quantity) ||
        Number.isNaN(line.quantity) ||
        typeof line.notes !== "string" ||
        !line.selectedOptions ||
        typeof line.selectedOptions !== "object" ||
        Array.isArray(line.selectedOptions)
      ) {
        return [];
      }

      const rawOptions = line.selectedOptions as Record<string, unknown>;
      const validOptions: SelectedOptions = {};
      for (const [groupId, optIds] of Object.entries(rawOptions)) {
        if (groupId === "__proto__" || groupId === "constructor" || groupId === "prototype") continue;
        if (!Array.isArray(optIds) || !optIds.every((opt) => typeof opt === "string")) {
          return [];
        }
        validOptions[groupId] = optIds;
      }

      const normalizedNotes = normalizeNotes(line.notes);
      const normalizedOpts = normalizeOptions(validOptions);

      return [{
        id: line.id,
        productId: line.productId,
        productSlug: line.productSlug,
        productName: line.productName,
        unitPriceCents: BigInt(line.unitPriceCents),
        quantity: Math.max(1, Math.floor(line.quantity)),
        notes: normalizedNotes,
        selectedOptions: normalizedOpts,
        ...(typeof line.comboId === "string" && line.comboId ? { comboId: line.comboId } : {})
      }];
    });
  } catch {
    return [];
  }
}

export function revalidateCart(
  cartLines: CartLine[],
  catalogProducts: readonly Product[]
): RevalidationResult {
  const catalogById = new Map(catalogProducts.map((p) => [p.id, p]));
  const issues: CartIssue[] = [];
  const validLinesMap = new Map<string, CartLine>();

  for (const line of cartLines) {
    const product = catalogById.get(line.productId);

    // 1. Producto eliminado o despublicado
    if (!product || !product.published) {
      issues.push({
        code: "product_removed",
        lineId: line.id,
        productId: line.productId,
        productName: line.productName,
        message: `El producto "${line.productName}" ya no está disponible en la carta y fue retirado de tu pedido.`,
        blocking: true
      });
      continue;
    }

    // 2. Producto agotado (inStock: false)
    if (!product.inStock) {
      issues.push({
        code: "out_of_stock",
        lineId: line.id,
        productId: product.id,
        productName: product.name,
        message: `"${product.name}" está agotado temporalmente y fue retirado de tu pedido.`,
        blocking: true
      });
      continue;
    }

    // 3. Inspeccionar y podar opciones agotadas o inválidas
    const cleanedOptions: SelectedOptions = {};

    for (const [groupId, optionIds] of Object.entries(line.selectedOptions)) {
      const group = product.optionGroups.find((g) => g.id === groupId);
      if (!group) {
        issues.push({
          code: "option_group_removed",
          lineId: line.id,
          productId: product.id,
          productName: product.name,
          groupId,
          message: `El grupo de opciones "${groupId}" de "${product.name}" ya no está disponible en la carta y fue retirado.`,
          blocking: false
        });
        continue;
      }

      const availableIds: string[] = [];
      for (const optId of optionIds) {
        const option = group.options.find((o) => o.id === optId);
        if (!option) {
          issues.push({
            code: "option_invalid",
            lineId: line.id,
            productId: product.id,
            productName: product.name,
            optionId: optId,
            message: `Una opción de "${product.name}" ya no existe en el menú y fue retirada.`,
            blocking: false
          });
        } else if (!option.available) {
          issues.push({
            code: "option_unavailable",
            lineId: line.id,
            productId: product.id,
            productName: product.name,
            optionId: option.id,
            optionName: option.name,
            message: `El adicional "${option.name}" en tu "${product.name}" se agotó y fue removido.`,
            blocking: false
          });
        } else {
          availableIds.push(optId);
        }
      }

      if (availableIds.length > 0) {
        cleanedOptions[groupId] = availableIds;
      }
    }

    // 4. Validar opciones depuradas contra el motor de opciones
    const validation = validateOptionSelection(product, cleanedOptions);
    if (!validation.ok) {
      issues.push({
        code: "option_invalid",
        lineId: line.id,
        productId: product.id,
        productName: product.name,
        message: `La personalización de "${product.name}" ya no cumple con las opciones requeridas del menú y fue retirada del pedido.`,
        blocking: true
      });
      continue;
    }

    // 5. Comparar precio recalculado vs precio persistido
    const freshUnitPrice = validation.value.unitPriceCents;
    if (freshUnitPrice !== line.unitPriceCents) {
      issues.push({
        code: "price_changed",
        lineId: line.id,
        productId: product.id,
        productName: product.name,
        oldPriceCents: line.unitPriceCents,
        newPriceCents: freshUnitPrice,
        message: `"${product.name}" actualizó su precio de ${formatArs(line.unitPriceCents)} a ${formatArs(freshUnitPrice)}.`,
        blocking: false
      });
    }

    // 6. Construir línea normalizada
    const normalizedNotes = normalizeNotes(line.notes);
    const normalizedOpts = validation.value.normalizedSelections;
    const newIdentity = cartLineIdentity({
      productId: product.id,
      comboId: line.comboId,
      notes: normalizedNotes,
      selectedOptions: normalizedOpts
    });

    const validatedLine: CartLine = {
      id: newIdentity,
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      unitPriceCents: freshUnitPrice,
      quantity: Math.max(1, Math.floor(line.quantity)),
      notes: normalizedNotes,
      selectedOptions: normalizedOpts,
      ...(line.comboId ? { comboId: line.comboId } : {})
    };

    // 7. Fusión por identidad si la poda de opciones provocó colisión
    const existing = validLinesMap.get(newIdentity);
    if (existing) {
      validLinesMap.set(newIdentity, {
        ...existing,
        quantity: existing.quantity + validatedLine.quantity
      });
    } else {
      validLinesMap.set(newIdentity, validatedLine);
    }
  }

  const validLines = Array.from(validLinesMap.values());

  const hasChanges =
    issues.length > 0 ||
    validLines.length !== cartLines.length ||
    validLines.some((vl, idx) => {
      const orig = cartLines[idx];
      return (
        !orig ||
        orig.id !== vl.id ||
        orig.quantity !== vl.quantity ||
        orig.unitPriceCents !== vl.unitPriceCents
      );
    });

  const hasBlockingIssues =
    validLines.length === 0 ||
    issues.some((issue) => issue.blocking);

  return {
    validLines,
    issues,
    hasChanges,
    hasBlockingIssues
  };
}

export function formatRevalidationNotice(issues: readonly CartIssue[]): string {
  if (issues.length === 0) return "";
  if (issues.length === 1) return issues[0]!.message;
  const blocking = issues.find((i) => i.blocking);
  if (blocking) {
    return `${blocking.message} (y otros cambios en tu pedido)`;
  }
  return `${issues[0]!.message} (y otros ajustes en tu pedido)`;
}
