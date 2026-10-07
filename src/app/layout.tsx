import type { Metadata, Viewport } from "next";
import { Oswald, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-oswald",
  display: "swap"
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-space-grotesk",
  display: "swap"
});

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
    <html lang="es" className={`${oswald.variable} ${spaceGrotesk.variable}`}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
