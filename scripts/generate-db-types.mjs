#!/usr/bin/env node
// Regenerates src/server/supabase/database.types.ts from the cloud DEVELOPMENT project.
//
//   npm run db:types         write the file
//   npm run db:types:check   exit 1 if the committed file is out of date
//
// Source (first one set wins, read from the environment or .env.local):
//   SUPABASE_DEV_DB_URL        Postgres URL of the development project (needs Docker for the CLI's pg-meta)
//   SUPABASE_DEV_PROJECT_REF   development project ref (needs `npx supabase login` or SUPABASE_ACCESS_TOKEN)
// The production project is never a source: SUPABASE_PRODUCTION_PROJECT_REF is rejected.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../src/server/supabase/database.types.ts", import.meta.url));
const check = process.argv.includes("--check");
const dbUrl = process.env.SUPABASE_DEV_DB_URL?.trim();
const projectRef = process.env.SUPABASE_DEV_PROJECT_REF?.trim();
const productionRef = process.env.SUPABASE_PRODUCTION_PROJECT_REF?.trim();

function fail(message) {
  console.error(`db:types: ${message}`);
  process.exit(1);
}

let source;
if (dbUrl) {
  if (productionRef && dbUrl.includes(productionRef)) fail("SUPABASE_DEV_DB_URL points at the production project");
  source = ["--db-url", dbUrl];
} else if (projectRef) {
  if (productionRef && projectRef === productionRef) fail("SUPABASE_DEV_PROJECT_REF is the production project ref");
  source = ["--project-id", projectRef];
} else {
  fail("set SUPABASE_DEV_DB_URL or SUPABASE_DEV_PROJECT_REF (see README › Supabase)");
}

let generated;
try {
  generated = execFileSync("npx", ["--no-install", "supabase", "gen", "types", "--lang", "typescript", "--schema", "public", ...source], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"]
  });
} catch (error) {
  // The CLI reports API errors (e.g. missing privileges) on stdout; surface them.
  const detail = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
  fail(`supabase gen types failed (exit ${error.status ?? "?"})${detail ? `: ${detail}` : `: ${error.message}`}`);
}

const normalized = generated.replace(/\r\n/g, "\n").trimEnd() + "\n";

if (check) {
  const current = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
  if (current !== normalized) fail("database.types.ts is out of date; run `npm run db:types` and commit the result");
  console.log("db:types: database.types.ts is up to date");
} else {
  writeFileSync(target, normalized);
  console.log(`db:types: wrote ${target}`);
}
