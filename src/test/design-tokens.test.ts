import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Guards the BB-02 rule "no colors, typography or radii duplicated arbitrarily":
 * outside src/app/globals.css every reusable color, font family, font size, letter
 * spacing and radius must come from a token. Layout geometry (sizes, spacing,
 * positions, border widths) is intentionally not checked.
 */

const SRC = path.resolve(__dirname, "..");
const TOKENS_FILE = path.join(SRC, "app", "globals.css");

interface Allowance {
  file: string;
  match: RegExp;
  reason: string;
}

const ALLOWED: Allowance[] = [
  {
    file: "app/manifest.ts",
    match: /THEME_COLOR = "#[0-9a-f]{6}"/,
    reason: "The web manifest and viewport metadata cannot read CSS variables; equality with --color-canvas is asserted below."
  },
  {
    file: "components/storefront/storefront.css",
    match: /mask-image: linear-gradient\(#000 \d+%, transparent\)/,
    reason: "Alpha mask: only opacity matters, the color is never painted."
  }
];

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
const TAILWIND_PALETTE =
  /\b(?:bg|text|border(?:-[trblxy])?|ring|fill|stroke|from|to|via|outline|decoration|shadow|accent|caret|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/;
const TAILWIND_DEFAULT_SCALE =
  /(?<![\w-])(?:text-(?:xs|sm|base|lg|[2-9]?xl)|rounded(?:-[trblse]{1,2})?-(?:xs|2xl|3xl|4xl)|tracking-(?:tighter|tight|wide|wider|widest))(?![\w-])/;
const TYPOGRAPHY_OR_RADIUS_ARBITRARY = /(?<![\w-])(?:text|rounded(?:-[trblse]{1,2})?|tracking|leading|font)-\[[^\]]+\]/;

const CSS_RULES: Array<{ property: string; valid: RegExp }> = [
  { property: "font-size", valid: /^(?:var\(--text-[\w-]+\)|clamp\(var\(--text-[\w-]+\), [\d.]+vw, var\(--text-[\w-]+\)\))$/ },
  { property: "font-family", valid: /^var\(--font-[\w-]+\)$/ },
  { property: "letter-spacing", valid: /^var\(--tracking-[\w-]+\)$/ },
  { property: "border-radius", valid: /^(?:(?:var\(--radius-[\w-]+\)|0)\s*){1,4}$/ }
];

export function findViolations(file: string, source: string): string[] {
  const violations: string[] = [];
  const isCss = file.endsWith(".css");

  source.split("\n").forEach((line, index) => {
    const where = `${file}:${index + 1}`;
    const allowed = ALLOWED.some((allowance) => allowance.file === file && allowance.match.test(line));

    if (!allowed && COLOR_LITERAL.test(line)) violations.push(`${where} color literal outside tokens`);

    if (isCss) {
      for (const { property, valid } of CSS_RULES) {
        const declaration = new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;}]+)`).exec(line);
        if (declaration?.[1] && !valid.test(declaration[1].trim())) {
          violations.push(`${where} ${property} must use a token, got "${declaration[1].trim()}"`);
        }
      }
      return;
    }

    if (TAILWIND_PALETTE.test(line)) violations.push(`${where} Tailwind palette color instead of a token`);
    if (TAILWIND_DEFAULT_SCALE.test(line)) violations.push(`${where} Tailwind default scale instead of a token`);
    if (TYPOGRAPHY_OR_RADIUS_ARBITRARY.test(line)) violations.push(`${where} arbitrary typography/radius value`);
  });

  return violations;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(css|tsx?)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || full === TOKENS_FILE) return [];
    return [full];
  });
}

const definedTokens = new Set([...readFileSync(TOKENS_FILE, "utf8").matchAll(/(--[\w-]+):/g)].map((match) => match[1]));

describe("design token guard", () => {
  it("rejects hardcoded colors, typography and radii", () => {
    expect(findViolations("x.css", ".a { color: #fff; }")).toHaveLength(1);
    expect(findViolations("x.css", ".a { background: rgb(0 0 0 / .5); }")).toHaveLength(1);
    expect(findViolations("x.css", ".a { border-radius: 9999px; }")).toHaveLength(1);
    expect(findViolations("x.css", ".a { border-radius: 50%; }")).toHaveLength(1);
    expect(findViolations("x.css", ".a { font-size: .68rem; }")).toHaveLength(1);
    expect(findViolations("x.css", ".a { font-family: Impact, sans-serif; }")).toHaveLength(1);
    expect(findViolations("x.css", ".a { letter-spacing: .04em; }")).toHaveLength(1);
    expect(findViolations("x.tsx", '<b className="text-[0.625rem]" />')).toHaveLength(1);
    expect(findViolations("x.tsx", '<b className="rounded-[10px]" />')).toHaveLength(1);
    expect(findViolations("x.tsx", '<b className="tracking-[0.05em]" />')).toHaveLength(1);
    expect(findViolations("x.tsx", '<b className="bg-amber-500" />')).toHaveLength(1);
    expect(findViolations("x.tsx", '<b className="text-sm rounded-2xl" />')).toHaveLength(1);
    expect(findViolations("x.tsx", '<b style={{ color: "#f59e0b" }} />')).toHaveLength(1);
  });

  it("accepts tokens and non-semantic geometry", () => {
    expect(findViolations("x.css", ".a { border-radius: var(--radius-full); font-size: var(--text-badge); }")).toEqual([]);
    expect(findViolations("x.css", ".a { border-radius: var(--radius-xl) var(--radius-xl) 0 0; width: 2.75rem; }")).toEqual([]);
    expect(findViolations("x.tsx", '<b className="rounded-full text-body-sm tracking-label border-[1.5px] left-[calc(50%+0.4rem)]" />')).toEqual([]);
    expect(findViolations("x.tsx", '<a href="#carrito" className="shadow-[0_0_0_1px_var(--color-primary)]" />')).toEqual([]);
  });

  it("finds no violations in the app source", () => {
    const violations = sourceFiles(SRC).flatMap((file) =>
      findViolations(path.relative(SRC, file).split(path.sep).join("/"), readFileSync(file, "utf8"))
    );
    expect(violations).toEqual([]);
  });

  it("only references tokens that globals.css defines", () => {
    const missing = sourceFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/var\((--(?:color|text|tracking|radius|font|shadow|spacing|container)-[\w-]+)/g)]
        .map((match) => match[1] ?? "")
        .filter((token) => !definedTokens.has(token))
        .map((token) => `${path.relative(SRC, file)} uses undefined ${token}`)
    );
    expect(missing).toEqual([]);
  });

  it("keeps the browser and installed-app theme color equal to the canvas token", () => {
    const canvas = /--color-canvas:\s*(#[0-9a-f]{6})/.exec(readFileSync(TOKENS_FILE, "utf8"))?.[1];
    const themeColor = /THEME_COLOR = "(#[0-9a-f]{6})"/.exec(readFileSync(path.join(SRC, "app", "manifest.ts"), "utf8"))?.[1];
    expect(canvas).toBeDefined();
    expect(themeColor).toBe(canvas);
    // The viewport and the manifest read that single constant.
    expect(readFileSync(path.join(SRC, "app", "layout.tsx"), "utf8")).toMatch(/themeColor: THEME_COLOR/);
    expect(readFileSync(path.join(SRC, "app", "manifest.ts"), "utf8")).toMatch(/background_color: THEME_COLOR,\s*theme_color: THEME_COLOR/);
  });
});
