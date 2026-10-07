import type {
  OptionGroup,
  OptionSelectionError,
  Product,
  PublicationError,
  SelectedOptions,
  ValidatedOptionSelection
} from "./types";
import { ok, type Result } from "@/lib/result";

/**
 * Checks whether an option group is applicable to a given product.
 * Respects explicit `applicableTypes` configuration, and enforces domain rules
 * (e.g. beverages must never show or accept hamburger/sandwich-specific groups).
 */
export function isGroupApplicableToProduct(
  group: OptionGroup,
  product: Pick<Product, "type" | "categoryId">
): boolean {
  if (group.applicableTypes && group.applicableTypes.length > 0) {
    return group.applicableTypes.includes(product.type);
  }

  // Domain guard: beverages never show or accept burger/meat/sandwich-exclusive groups
  if (product.type === "beverage" || product.categoryId === "drinks") {
    const lowerId = group.id.toLowerCase();
    const lowerName = group.name.toLowerCase();
    if (
      lowerId.includes("patty") ||
      lowerId.includes("medallon") ||
      lowerId.includes("medallón") ||
      lowerId.includes("burger") ||
      lowerName.includes("medallón") ||
      lowerName.includes("medallon") ||
      lowerName.includes("hamburguesa") ||
      lowerId.includes("bread") ||
      lowerName.includes("pan")
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Returns only the option groups applicable to the specific product and its type.
 */
export function getApplicableOptionGroups(product: Product): OptionGroup[] {
  return product.optionGroups.filter((group) => isGroupApplicableToProduct(group, product));
}

/**
 * Builds the canonical default selection for a product.
 * Returns only defaults for applicable groups, normalized and deduplicated.
 */
export function getDefaultSelection(product: Product): SelectedOptions {
  const applicableGroups = getApplicableOptionGroups(product);
  const selection: SelectedOptions = {};

  for (const group of applicableGroups) {
    selection[group.id] = [...new Set(group.defaultOptionIds)].sort();
  }

  return selection;
}

/**
 * Calculates the unit price in cents derived from the product base price and selected options.
 * Negative option adjustments cannot drop the total price below zero.
 */
export function calculateConfiguredUnitPrice(product: Product, selected: SelectedOptions): bigint {
  const applicableGroups = getApplicableOptionGroups(product);
  let totalDelta = 0n;

  for (const group of applicableGroups) {
    const chosen = new Set(selected[group.id] ?? []);
    const optionsById = new Map(group.options.map((option) => [option.id, option]));
    for (const id of chosen) {
      const option = optionsById.get(id);
      if (option) {
        totalDelta += option.priceDeltaCents;
      }
    }
  }

  const result = product.priceCents + totalDelta;
  return result < 0n ? 0n : result;
}

/**
 * Validates a customer or server-submitted option selection against a product.
 * Shared between client and authoritative server verification.
 */
export function validateOptionSelection(
  product: Product,
  selected: SelectedOptions
): Result<ValidatedOptionSelection, OptionSelectionError[]> {
  const errors: OptionSelectionError[] = [];
  const applicableGroups = getApplicableOptionGroups(product);
  const applicableGroupIds = new Set(applicableGroups.map((group) => group.id));
  const allProductGroupsById = new Map(product.optionGroups.map((group) => [group.id, group]));

  // 1. Verify that no unknown or inapplicable groups were submitted
  for (const [groupId, optionIds] of Object.entries(selected)) {
    if (optionIds.length > 0) {
      const group = allProductGroupsById.get(groupId);
      if (!group) {
        errors.push({
          groupId,
          code: "UNKNOWN_GROUP",
          message: `El grupo de opciones '${groupId}' no existe en el producto '${product.name}'.`
        });
        continue;
      }

      if (!applicableGroupIds.has(groupId)) {
        errors.push({
          groupId,
          code: "INAPPLICABLE_GROUP",
          message: `El grupo de opciones '${group.name}' no es aplicable a productos de tipo '${product.type}'.`
        });
      }
    }
  }

  const normalizedSelections: SelectedOptions = {};
  const selectedDetails: ValidatedOptionSelection["selectedDetails"] = [];
  let optionsPriceDelta = 0n;

  // 2. Validate all applicable groups
  for (const group of applicableGroups) {
    const rawChosenIds = selected[group.id] ?? [];
    const uniqueChosenIds = [...new Set(rawChosenIds)];

    if (uniqueChosenIds.length !== rawChosenIds.length) {
      errors.push({
        groupId: group.id,
        code: "DUPLICATE_SELECTION",
        message: `El grupo '${group.name}' contiene opciones duplicadas.`
      });
    }

    const effectiveMin = group.required ? Math.max(1, group.minSelections) : group.minSelections;
    const count = uniqueChosenIds.length;

    if (count < effectiveMin) {
      const isMissingRequired = group.required && count === 0;
      errors.push({
        groupId: group.id,
        code: isMissingRequired ? "REQUIRED_GROUP_EMPTY" : "BELOW_MIN_SELECTIONS",
        message: isMissingRequired
          ? `Debe seleccionar una opción requerida en '${group.name}'.`
          : `El grupo '${group.name}' requiere un mínimo de ${effectiveMin} opción(es).`
      });
    }

    if (count > group.maxSelections) {
      errors.push({
        groupId: group.id,
        code: "EXCEEDS_MAX_SELECTIONS",
        message: `El grupo '${group.name}' permite un máximo de ${group.maxSelections} opción(es).`
      });
    }

    if (group.selectionMode === "single" && count > 1) {
      errors.push({
        groupId: group.id,
        code: "SINGLE_SELECT_MULTIPLE_CHOICES",
        message: `El grupo '${group.name}' es de selección única.`
      });
    }

    const optionsById = new Map(group.options.map((option) => [option.id, option]));
    const validGroupSelection: string[] = [];

    for (const optionId of uniqueChosenIds) {
      const option = optionsById.get(optionId);
      if (!option) {
        errors.push({
          groupId: group.id,
          optionId,
          code: "UNKNOWN_OPTION",
          message: `La opción '${optionId}' no existe en el grupo '${group.name}'.`
        });
        continue;
      }

      if (!option.available) {
        errors.push({
          groupId: group.id,
          optionId,
          code: "OPTION_UNAVAILABLE",
          message: `La opción '${option.name}' no está disponible.`
        });
        continue;
      }

      optionsPriceDelta += option.priceDeltaCents;
      validGroupSelection.push(option.id);
      selectedDetails.push({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        priceDeltaCents: option.priceDeltaCents
      });
    }

    normalizedSelections[group.id] = validGroupSelection.sort();
  }

  if (errors.length > 0) {
    return { ok: false, error: errors };
  }

  const rawTotal = product.priceCents + optionsPriceDelta;
  const unitPriceCents = rawTotal < 0n ? 0n : rawTotal;

  return ok({
    unitPriceCents,
    normalizedSelections,
    selectedDetails
  });
}

/**
 * Validates whether a product meets all publishing criteria.
 * Verifies that:
 * - Basic metadata (name, slug, positive base price) are set.
 * - Non-alcoholic beverage rule is respected.
 * - Option groups are applicable to the product type.
 * - Defaults are valid, available, within cardinality constraints, and never deleted/disabled.
 * - Direct addition (using defaults) produces a valid configuration.
 */
export function validateProductPublication(product: Product): Result<void, PublicationError[]> {
  const errors: PublicationError[] = [];

  if (!product.name || !product.name.trim()) {
    errors.push({ code: "MISSING_NAME", message: "El producto debe tener un nombre." });
  }
  if (!product.slug || !product.slug.trim()) {
    errors.push({ code: "MISSING_SLUG", message: "El producto debe tener un slug." });
  }
  if (product.priceCents < 0n) {
    errors.push({ code: "NEGATIVE_PRICE", message: "El precio base no puede ser negativo." });
  }
  if (product.type === "beverage" && product.containsAlcohol) {
    errors.push({ code: "ALCOHOL_BEVERAGE", message: "Las bebidas con alcohol no están permitidas." });
  }

  for (const group of product.optionGroups) {
    if (!isGroupApplicableToProduct(group, product)) {
      errors.push({
        code: "INAPPLICABLE_OPTION_GROUP",
        groupId: group.id,
        message: `El grupo '${group.name}' no es aplicable a productos de tipo '${product.type}'.`
      });
    }

    if (group.minSelections < 0 || group.maxSelections < group.minSelections) {
      errors.push({
        code: "INVALID_CARDINALITY",
        groupId: group.id,
        message: `La cardinalidad del grupo '${group.name}' es inválida.`
      });
    }

    const optionsById = new Map(group.options.map((option) => [option.id, option]));
    const availableOptions = group.options.filter((option) => option.available);
    const effectiveMin = group.required ? Math.max(1, group.minSelections) : group.minSelections;

    if (group.required && availableOptions.length < effectiveMin) {
      errors.push({
        code: "INSUFFICIENT_AVAILABLE_OPTIONS",
        groupId: group.id,
        message: `El grupo requerido '${group.name}' no cuenta con suficientes opciones disponibles.`
      });
    }

    const defaultIds = group.defaultOptionIds ?? [];
    const uniqueDefaultIds = new Set(defaultIds);

    if (uniqueDefaultIds.size !== defaultIds.length) {
      errors.push({
        code: "DEFAULT_DUPLICATES",
        groupId: group.id,
        message: `El grupo '${group.name}' contiene defaults duplicados.`
      });
    }

    if (defaultIds.length < effectiveMin) {
      errors.push({
        code: "DEFAULT_BELOW_MIN",
        groupId: group.id,
        message: `El grupo '${group.name}' requiere al menos ${effectiveMin} default(s), pero tiene ${defaultIds.length}.`
      });
    }

    if (defaultIds.length > group.maxSelections) {
      errors.push({
        code: "DEFAULT_EXCEEDS_MAX",
        groupId: group.id,
        message: `El grupo '${group.name}' tiene más defaults (${defaultIds.length}) que el máximo permitido (${group.maxSelections}).`
      });
    }

    if (group.selectionMode === "single" && defaultIds.length > 1) {
      errors.push({
        code: "DEFAULT_SINGLE_SELECT_MULTIPLE",
        groupId: group.id,
        message: `El grupo de selección única '${group.name}' tiene múltiples defaults.`
      });
    }

    for (const defaultId of defaultIds) {
      const option = optionsById.get(defaultId);
      if (!option) {
        errors.push({
          code: "MISSING_DEFAULT_OPTION",
          groupId: group.id,
          optionId: defaultId,
          message: `La opción por defecto '${defaultId}' no existe en el grupo '${group.name}'.`
        });
        continue;
      }

      if (!option.available) {
        errors.push({
          code: "UNAVAILABLE_DEFAULT_OPTION",
          groupId: group.id,
          optionId: defaultId,
          message: `La opción por defecto '${option.name}' está agotada / deshabilitada.`
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors };
  }

  // Ensure direct add with defaults produces a valid selection
  const defaultSelection = getDefaultSelection(product);
  const selectionValidation = validateOptionSelection(product, defaultSelection);
  if (!selectionValidation.ok) {
    for (const err of selectionValidation.error) {
      errors.push({
        code: "INVALID_CARDINALITY",
        groupId: err.groupId,
        ...(err.optionId ? { optionId: err.optionId } : {}),
        message: `La configuración por defecto no es válida: ${err.message}`
      });
    }
    return { ok: false, error: errors };
  }

  return ok(undefined);
}

/**
 * Boolean predicate: returns true if the product meets all criteria to be published.
 */
export function isPublishable(product: Product): boolean {
  return validateProductPublication(product).ok;
}

/**
 * Pure state toggle helper for client selection state.
 * Respects single vs multiple selection modes, maximum limits, and availability.
 */
export function toggleOption(
  selected: SelectedOptions,
  groupId: string,
  optionId: string,
  maxSelections: number,
  isAvailable = true
): SelectedOptions {
  if (!isAvailable) return selected;
  const current = selected[groupId] ?? [];

  if (maxSelections === 1) {
    return { ...selected, [groupId]: [optionId] };
  }

  if (current.includes(optionId)) {
    return { ...selected, [groupId]: current.filter((id) => id !== optionId) };
  }

  if (current.length >= maxSelections) {
    return selected;
  }

  return { ...selected, [groupId]: [...current, optionId] };
}
