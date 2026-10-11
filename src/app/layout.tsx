import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerManager } from "@/components/pwa/service-worker-manager";
import { Toaster } from "@/components/ui/sonner";
import { THEME_COLOR } from "./manifest";
import "@fontsource-variable/oswald/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Búnker Burger | Carta online",
  description: "Pedí hamburguesas, sándwiches, papas y bebidas en Búnker Burger.",
  applicationName: "Búnker Burger",
  // iOS reads these instead of the manifest when adding to the home screen.
  appleWebApp: { capable: true, title: "Búnker", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  formatDetection: { telephone: false }
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
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
        <ServiceWorkerManager />
      </body>
    </html>
  );
}
