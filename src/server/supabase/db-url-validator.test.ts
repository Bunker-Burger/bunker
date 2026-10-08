import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIGRATION_BRANCHES,
  DEFAULT_DEV_PROJECT_REF,
  isOfficialPoolerHost,
  validateBranch,
  validateDbUrl,
  validateMigrationInputs,
  validateTrustBoundary,
} from "./db-url-validator";

const scriptPath = resolve(__dirname, "../../../scripts/validate-db-url.mjs");
const sampleSecret = "SuperSecretPassword123!#%";
const validDirectUrl = `postgresql://postgres:${encodeURIComponent(sampleSecret)}@db.zokkgocmcaqcujltfkjf.supabase.co:5432/postgres`;
const validPoolerUrl = `postgresql://postgres.zokkgocmcaqcujltfkjf:${encodeURIComponent(sampleSecret)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;

describe("isOfficialPoolerHost", () => {
  it("acepta hosts oficiales de Supabase pooler", () => {
    expect(isOfficialPoolerHost("aws-0-sa-east-1.pooler.supabase.com")).toBe(true);
    expect(isOfficialPoolerHost("aws-0-us-east-1.pooler.supabase.com")).toBe(true);
    expect(isOfficialPoolerHost("aws-1-eu-central-1.pooler.supabase.com")).toBe(true);
  });

  it("rechaza subdominios no oficiales o hosts arbitrarios", () => {
    expect(isOfficialPoolerHost("evil.pooler.supabase.com")).toBe(false);
    expect(isOfficialPoolerHost("pooler.supabase.com")).toBe(false);
    expect(isOfficialPoolerHost("aws-0-sa-east-1.pooler.supabase.com.evil.com")).toBe(false);
    expect(isOfficialPoolerHost("evil.com")).toBe(false);
    expect(isOfficialPoolerHost("")).toBe(false);
  });
});

describe("validateDbUrl", () => {
  it("acepta una URL directa válida hacia el proyecto development autorizado", () => {
    const result = validateDbUrl({ url: validDirectUrl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectRef).toBe(DEFAULT_DEV_PROJECT_REF);
      expect(result.host).toBe("db.zokkgocmcaqcujltfkjf.supabase.co");
      expect(result.mode).toBe("direct");
    }
  });

  it("acepta una URL de pooler válida hacia el proyecto development autorizado", () => {
    const result = validateDbUrl({ url: validPoolerUrl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectRef).toBe(DEFAULT_DEV_PROJECT_REF);
      expect(result.host).toBe("aws-0-sa-east-1.pooler.supabase.com");
      expect(result.mode).toBe("pooler");
    }
  });

  it("rechaza URL ausente o vacía", () => {
    const result = validateDbUrl({ url: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no está configurado o está vacío");
    }
  });

  it("rechaza formato de URL inválido", () => {
    const result = validateDbUrl({ url: "esto-no-es-una-url" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no tiene un formato de URL válido");
    }
  });

  it("rechaza protocolos no postgres (ej. https)", () => {
    const result = validateDbUrl({ url: "https://zokkgocmcaqcujltfkjf.supabase.co" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("debe utilizar el protocolo postgresql: o postgres:");
    }
  });

  it("rechaza URLs que apuntan a otro project ref desconocido en conexión directa", () => {
    const otherUrl = `postgresql://postgres:${encodeURIComponent(sampleSecret)}@db.abcdefghijklmnopqrst.supabase.co:5432/postgres`;
    const result = validateDbUrl({ url: otherUrl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no coincide con el identificador del proyecto de desarrollo autorizado");
      expect(result.error).not.toContain(sampleSecret);
    }
  });

  it("rechaza URLs que apuntan a otro project ref en el usuario de pooler", () => {
    const otherPoolerUrl = `postgresql://postgres.abcdefghijklmnopqrst:${encodeURIComponent(sampleSecret)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;
    const result = validateDbUrl({ url: otherPoolerUrl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no coincide con el identificador del proyecto de desarrollo autorizado");
      expect(result.error).not.toContain(sampleSecret);
    }
  });

  it("rechaza host arbitrario con usuario de desarrollo (evita spoof de host)", () => {
    const spoofHostUrl = `postgresql://postgres.zokkgocmcaqcujltfkjf:${encodeURIComponent(sampleSecret)}@evil-attacker.com:5432/postgres`;
    const result = validateDbUrl({ url: spoofHostUrl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no coincide con el identificador del proyecto de desarrollo autorizado");
      expect(result.error).not.toContain(sampleSecret);
    }
  });

  it("rechaza subdominio falso spoofed (evita spoof de subdominio)", () => {
    const spoofSubdomainUrl = `postgresql://postgres:${encodeURIComponent(sampleSecret)}@db.zokkgocmcaqcujltfkjf.supabase.co.evil.com:5432/postgres`;
    const result = validateDbUrl({ url: spoofSubdomainUrl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no coincide con el identificador del proyecto de desarrollo autorizado");
      expect(result.error).not.toContain(sampleSecret);
    }
  });

  it("rechaza pooler falso no oficial (evita spoof de pooler)", () => {
    const fakePoolerUrl = `postgresql://postgres.zokkgocmcaqcujltfkjf:${encodeURIComponent(sampleSecret)}@fake.pooler.supabase.com:6543/postgres`;
    const result = validateDbUrl({ url: fakePoolerUrl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no coincide con el identificador del proyecto de desarrollo autorizado");
      expect(result.error).not.toContain(sampleSecret);
    }
  });

  it("rechaza explícitamente URLs que apunten a producción con productionRef configurado", () => {
    const prodRef = "prodref123456789012";
    const prodUrl = `postgresql://postgres:${encodeURIComponent(sampleSecret)}@db.${prodRef}.supabase.co:5432/postgres`;
    const result = validateDbUrl({ url: prodUrl, productionRef: prodRef });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("apunta al proyecto de producción no permitido");
      expect(result.error).not.toContain(sampleSecret);
    }
  });

  it("rechaza guard de producción cuando expectedProjectRef coincide con productionRef", () => {
    const prodRef = "prodref123456789012";
    const prodUrl = `postgresql://postgres:${encodeURIComponent(sampleSecret)}@db.${prodRef}.supabase.co:5432/postgres`;
    const result = validateDbUrl({
      url: prodUrl,
      expectedProjectRef: prodRef,
      productionRef: prodRef,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("apunta al proyecto de producción no permitido");
      expect(result.error).not.toContain(sampleSecret);
    }
  });
});

describe("validateMigrationInputs", () => {
  it("por defecto o con dryRun=true permite la ejecución en modo dry-run", () => {
    expect(validateMigrationInputs({ dryRun: true })).toEqual({
      ok: true,
      mode: "dry-run",
    });
    expect(validateMigrationInputs({})).toEqual({
      ok: true,
      mode: "dry-run",
    });
  });

  it("permite modo apply (dryRun=false) cuando se proporciona el ID exacto del proyecto", () => {
    const result = validateMigrationInputs({
      dryRun: false,
      confirmProject: DEFAULT_DEV_PROJECT_REF,
    });
    expect(result).toEqual({ ok: true, mode: "apply" });
  });

  it("rechaza modo apply (dryRun=false) sin confirmación o con confirmación incorrecta", () => {
    const sinConfirmacion = validateMigrationInputs({
      dryRun: false,
      confirmProject: "",
    });
    expect(sinConfirmacion.ok).toBe(false);
    if (!sinConfirmacion.ok) {
      expect(sinConfirmacion.error).toContain("se requiere confirmación expresa");
    }

    const confirmacionErronea = validateMigrationInputs({
      dryRun: false,
      confirmProject: "otro-proyecto-invalido",
    });
    expect(confirmacionErronea.ok).toBe(false);
    if (!confirmacionErronea.ok) {
      expect(confirmacionErronea.error).toContain("se requiere confirmación expresa");
    }
  });
});

describe("validateBranch", () => {
  it("permite ramas autorizadas por defecto", () => {
    expect(validateBranch({ branch: "refs/heads/main" })).toEqual({
      ok: true,
      branch: "main",
    });
    expect(validateBranch({ branch: "refs/heads/feat/bb-05-option-engine" })).toEqual({
      ok: true,
      branch: "feat/bb-05-option-engine",
    });
    expect(validateBranch({ branch: "main" })).toEqual({
      ok: true,
      branch: "main",
    });
  });

  it("rechaza ramas arbitrarias no autorizadas", () => {
    const result = validateBranch({ branch: "refs/heads/feat/unauthorized-branch" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no está autorizada para ejecutar migraciones directas");
      expect(result.error).toContain(ALLOWED_MIGRATION_BRANCHES.join(", "));
    }
  });
});

describe("validateTrustBoundary", () => {
  const authorizedSha = "30e917d40a77b8d1af652fcfe8dcca913628a7ca";
  const unreviewedSha = "abcdef1234567890abcdef1234567890abcdef12";

  it("autoriza eventos push sobre la rama main (trusted main workflow)", () => {
    const result = validateTrustBoundary({
      eventName: "push",
      ref: "refs/heads/main",
      sha: authorizedSha,
      isCi: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("trusted-main");
    }
  });

  it("autoriza un commit cuando coincide exactamente con verifiedSha de mantenedor", () => {
    const result = validateTrustBoundary({
      eventName: "workflow_dispatch",
      ref: "refs/heads/feat/bb-05-option-engine",
      sha: authorizedSha,
      verifiedSha: authorizedSha,
      isCi: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("verified-sha");
    }
  });

  it("autoriza cuando verifiedSha usa un prefijo de commit corto válido (>= 7 caracteres)", () => {
    const result = validateTrustBoundary({
      eventName: "pull_request",
      ref: "refs/heads/feat/bb-05-option-engine",
      sha: authorizedSha,
      verifiedSha: authorizedSha.slice(0, 10),
      isCi: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("verified-sha");
    }
  });

  it("rechaza pull_request no autorizado sin verifiedSha de mantenedor", () => {
    const result = validateTrustBoundary({
      eventName: "pull_request",
      ref: "refs/heads/feat/unauthorized-branch",
      sha: unreviewedSha,
      verifiedSha: "",
      isCi: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no cuenta con autorización verificada de un mantenedor");
    }
  });

  it("rechaza un nuevo SHA no revisado en una rama previamente autorizada (mismatched SHA)", () => {
    const result = validateTrustBoundary({
      eventName: "pull_request",
      ref: "refs/heads/feat/bb-05-option-engine",
      sha: unreviewedSha,
      verifiedSha: authorizedSha,
      isCi: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no coincide con el SHA autorizado");
    }
  });

  it("rechaza un SHA verificado si la rama no está en allowedBranches", () => {
    const result = validateTrustBoundary({
      eventName: "workflow_dispatch",
      ref: "refs/heads/feat/malicious-branch",
      sha: authorizedSha,
      verifiedSha: authorizedSha,
      isCi: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no está en la lista de ramas autorizadas");
    }
  });

  it("permite ejecuciones en entorno local de desarrollo (isCi: false)", () => {
    const result = validateTrustBoundary({
      isCi: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("local-environment");
    }
  });
});

describe("CLI scripts/validate-db-url.mjs (ejecución real Node.js)", () => {
  function runCli(args: string[], env: Record<string, string> = {}) {
    try {
      const stdout = execFileSync("node", [scriptPath, ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          // Clear any conflicting env vars by default in test runs
          SUPABASE_DEV_DB_URL: "",
          INPUT_DRY_RUN: "",
          INPUT_CONFIRM_PROJECT: "",
          INPUT_BRANCH: "",
          GITHUB_ACTIONS: "",
          GITHUB_EVENT_NAME: "",
          GITHUB_REF: "",
          GITHUB_SHA: "",
          VERIFIED_SHA: "",
          SUPABASE_PRODUCTION_PROJECT_REF: "",
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { exitCode: 0, stdout, stderr: "" };
    } catch (err: unknown) {
      const error = err as { status?: number; stdout?: string; stderr?: string };
      return {
        exitCode: error.status ?? 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      };
    }
  }

  it("retorna exit code 0 para URL directa válida vía SUPABASE_DEV_DB_URL", () => {
    const res = runCli([], { SUPABASE_DEV_DB_URL: validDirectUrl });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Conexión de base de datos validada exitosamente");
    expect(res.stdout).toContain("direct");
  });

  it("retorna exit code 0 para URL pooler válida vía SUPABASE_DEV_DB_URL", () => {
    const res = runCli([], { SUPABASE_DEV_DB_URL: validPoolerUrl });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Conexión de base de datos validada exitosamente");
    expect(res.stdout).toContain("pooler");
  });

  it("retorna exit code 1 cuando SUPABASE_DEV_DB_URL no está configurado", () => {
    const res = runCli([], { SUPABASE_DEV_DB_URL: "" });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("no está configurado o está vacío");
  });

  it("retorna exit code 1 para host arbitrario spoofed y no revela credenciales", () => {
    const spoofUrl = `postgresql://postgres.zokkgocmcaqcujltfkjf:${encodeURIComponent(sampleSecret)}@evil-attacker.com:5432/postgres`;
    const res = runCli([], { SUPABASE_DEV_DB_URL: spoofUrl });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("no coincide con el identificador del proyecto de desarrollo autorizado");
    expect(res.stderr).not.toContain(sampleSecret);
  });

  it("retorna exit code 1 para URL de producción y no revela credenciales", () => {
    const prodRef = "prodref123456789012";
    const prodUrl = `postgresql://postgres:${encodeURIComponent(sampleSecret)}@db.${prodRef}.supabase.co:5432/postgres`;
    const res = runCli([], {
      SUPABASE_DEV_DB_URL: prodUrl,
      SUPABASE_PRODUCTION_PROJECT_REF: prodRef,
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("apunta al proyecto de producción no permitido");
    expect(res.stderr).not.toContain(sampleSecret);
  });

  it("retorna exit code 0 para modo migración dry-run en rama autorizada", () => {
    const res = runCli(["--migration"], {
      SUPABASE_DEV_DB_URL: validPoolerUrl,
      INPUT_DRY_RUN: "true",
      INPUT_BRANCH: "refs/heads/main",
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Modo: dry-run");
  });

  it("retorna exit code 0 para modo migración apply con confirmación exacta en rama autorizada", () => {
    const res = runCli(["--migration"], {
      SUPABASE_DEV_DB_URL: validPoolerUrl,
      INPUT_DRY_RUN: "false",
      INPUT_CONFIRM_PROJECT: DEFAULT_DEV_PROJECT_REF,
      INPUT_BRANCH: "refs/heads/feat/bb-05-option-engine",
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Modo: apply");
  });

  it("retorna exit code 1 para modo migración en rama no autorizada", () => {
    const res = runCli(["--migration"], {
      SUPABASE_DEV_DB_URL: validPoolerUrl,
      INPUT_DRY_RUN: "true",
      INPUT_BRANCH: "refs/heads/feat/unauthorized-branch",
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("no está autorizada para ejecutar migraciones directas");
  });

  it("retorna exit code 1 para modo migración apply sin confirmación", () => {
    const res = runCli(["--migration"], {
      SUPABASE_DEV_DB_URL: validPoolerUrl,
      INPUT_DRY_RUN: "false",
      INPUT_CONFIRM_PROJECT: "",
      INPUT_BRANCH: "refs/heads/main",
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("se requiere confirmación expresa");
  });

  it("maneja de forma segura metacaracteres shell benignos en INPUT_CONFIRM_PROJECT sin inyección", () => {
    const benignInjection = `${DEFAULT_DEV_PROJECT_REF}; echo pwned; $(whoami); | ls; ' OR '1'='1`;
    const res = runCli(["--migration"], {
      SUPABASE_DEV_DB_URL: validPoolerUrl,
      INPUT_DRY_RUN: "false",
      INPUT_CONFIRM_PROJECT: benignInjection,
      INPUT_BRANCH: "refs/heads/main",
    });
    // Trata la entrada estrictamente como string de datos, falla por confirmación errónea sin ejecutar shell
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("se requiere confirmación expresa");
    expect(res.stdout).not.toContain("pwned");
  });

  it("maneja de forma segura metacaracteres shell benignos en INPUT_BRANCH sin inyección", () => {
    const benignBranchInjection = "main && echo pwned";
    const res = runCli(["--migration"], {
      SUPABASE_DEV_DB_URL: validPoolerUrl,
      INPUT_DRY_RUN: "true",
      INPUT_BRANCH: benignBranchInjection,
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("no está autorizada para ejecutar migraciones directas");
    expect(res.stdout).not.toContain("pwned");
  });

  it("en modo CI bloquea con exit code 1 cuando el commit no está autorizado", () => {
    const res = runCli([], {
      SUPABASE_DEV_DB_URL: validPoolerUrl,
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/heads/feat/bb-05-option-engine",
      GITHUB_SHA: "1234567890abcdef1234567890abcdef12345678",
      VERIFIED_SHA: "",
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("no cuenta con autorización verificada de un mantenedor");
  });

  it("en modo CI permite con exit code 0 cuando verifiedSha coincide con GITHUB_SHA", () => {
    const sha = "1234567890abcdef1234567890abcdef12345678";
    const res = runCli([], {
      SUPABASE_DEV_DB_URL: validPoolerUrl,
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/heads/feat/bb-05-option-engine",
      GITHUB_SHA: sha,
      VERIFIED_SHA: sha,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Conexión de base de datos validada exitosamente");
  });
});
