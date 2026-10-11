// Provisional PWA icons (BB-16): a geometric burger on the brand canvas, no text, so the output
// does not depend on installed fonts. Run with `node scripts/generate-pwa-icons.mjs` and commit the
// PNGs in public/icons. Replace with the final brand artwork when it exists.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const CANVAS = "#0a0a0a"; // --color-canvas
const BUN = "#f59e0b"; // --color-primary
const CHEESE = "#fbbf24"; // --color-primary-hover
const PATTY = "#7c2d12";

/** The burger drawn in a 100×100 box, scaled by `artwork` (share of the icon it may cover). */
function svg(size, artwork) {
  const scale = (size * artwork) / 100;
  const offset = (size - size * artwork) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${CANVAS}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="M10 46 C10 20 90 20 90 46 Z" fill="${BUN}"/>
    <path d="M10 52 H90 V55 L80 62 L70 55 L60 62 L50 55 L40 62 L30 55 L20 62 L10 55 Z" fill="${CHEESE}"/>
    <rect x="10" y="58" width="80" height="12" rx="6" fill="${PATTY}"/>
    <path d="M10 74 H90 C90 86 80 90 70 90 H30 C20 90 10 86 10 74 Z" fill="${BUN}"/>
  </g>
</svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, artwork: 0.78 },
  { file: "icon-512.png", size: 512, artwork: 0.78 },
  // Maskable: the platform may crop to a circle; keep the burger inside the 80% safe zone.
  { file: "maskable-512.png", size: 512, artwork: 0.6 },
  { file: "apple-touch-icon.png", size: 180, artwork: 0.7 }
];

await mkdir("public/icons", { recursive: true });
for (const { file, size, artwork } of ICONS) {
  await sharp(Buffer.from(svg(size, artwork))).png({ compressionLevel: 9 }).toFile(`public/icons/${file}`);
  console.log(`public/icons/${file} ${size}×${size}`);
}
