import {
  changeCartLineQuantity,
  clearCart,
  editCartLine,
  removeCartLine,
  updateCartLineNotes,
  updateCartLineQuantity
} from "@/domain/cart";

export type PaymentMethod = "cash" | "transfer" | "mercado-pago";

export const changeLineQuantity = changeCartLineQuantity;
export {
  changeCartLineQuantity,
  clearCart,
  editCartLine,
  removeCartLine,
  updateCartLineNotes,
  updateCartLineQuantity
};

export { clearOptionGroup, toggleOption } from "@/domain/options";
