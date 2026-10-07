export type ProductType = "burger" | "sandwich" | "fries" | "beverage";

export interface ProductOption {
  id: string;
  name: string;
  priceDeltaCents: bigint;
  available: boolean;
}

export interface OptionGroup {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  defaultOptionIds: string[];
  options: ProductOption[];
}

export interface Product {
  id: string;
  slug: string;
  categoryId: string;
  type: ProductType;
  name: string;
  description: string;
  priceCents: bigint;
  compareAtPriceCents?: bigint;
  imageUrl: string;
  imageAlt?: string;
  published: boolean;
  featured: boolean;
  inStock: boolean;
  containsAlcohol?: boolean;
  optionGroups: OptionGroup[];
}

export type SelectedOptions = Record<string, string[]>;

export interface CartLine {
  id: string;
  productId: string;
  productSlug: string;
  productName: string;
  unitPriceCents: bigint;
  quantity: number;
  notes: string;
  selectedOptions: SelectedOptions;
}

export type FulfilmentMethod = "pickup" | "delivery";

export interface Promotion {
  id: string;
  name: string;
  priority: number;
  kind: "percentage" | "fixed";
  value: number;
  active: boolean;
  productIds?: string[];
  startsAt?: string;
  endsAt?: string;
}

export interface Quote {
  subtotalCents: bigint;
  discountCents: bigint;
  deliveryCents: bigint;
  totalCents: bigint;
  promotion: Promotion | null;
}

