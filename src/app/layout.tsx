import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Búnker Burger | Carta online",
  description: "Pedí hamburguesas, sándwiches, papas y bebidas en Búnker Burger.",
  applicationName: "Búnker Burger"
};

export const viewport: Viewport = {
  themeColor: "#11100f",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
