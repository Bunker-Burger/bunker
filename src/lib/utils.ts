import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the custom tokens from globals.css; otherwise `text-label` (a font size)
// is mistaken for a text color and silently drops `text-on-primary`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["hero", "hero-lg", "headline", "headline-lg", "headline-md", "title", "price", "body-lg", "body", "body-sm", "label", "badge"],
      radius: ["sm", "md", "lg", "xl"],
      shadow: ["glow", "overlay"],
      spacing: ["tap"],
      container: ["content"]
    }
  }
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
