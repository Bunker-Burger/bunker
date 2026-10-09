import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import "@fontsource-variable/oswald/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Búnker Burger | Carta online",
  description: "Pedí hamburguesas, sándwiches, papas y bebidas en Búnker Burger.",
  applicationName: "Búnker Burger"
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a", // --color-canvas
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Shrink the layout viewport when the on-screen keyboard opens so fixed bars never cover inputs.
  interactiveWidget: "resizes-content"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
