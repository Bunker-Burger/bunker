import type { MetadataRoute } from "next";

/* BB-16: the public menu is the installed app; Admin is reached from it, never its start page. */

export const THEME_COLOR = "#0a0a0a"; // --color-canvas

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Búnker Burger",
    short_name: "Búnker",
    description: "Carta online de Búnker Burger: armá tu pedido y envialo por WhatsApp.",
    lang: "es-AR",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    categories: ["food", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
