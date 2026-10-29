"use client";

import { Hamburger, ReceiptText, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { BottomNav, type BottomNavItem } from "@/components/shell/bottom-nav";

/** Same bottom bar as the storefront, with Admin current (canonical admin captures, issue #54). */
const ITEMS: BottomNavItem[] = [
  { href: "/#menu", label: "Menú", icon: Hamburger },
  { href: "/#carrito", label: "Carrito", icon: ShoppingCart },
  { href: "/#checkout", label: "Checkout", icon: ReceiptText },
  { href: "/bunker/admin", label: "Admin", icon: SlidersHorizontal }
];

export function AdminBottomNav() {
  return <BottomNav activeHref="/bunker/admin" items={ITEMS} />;
}
