import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIGRATION_BRANCHES,
  DEFAULT_DEV_PROJECT_REF,
  validateBranch,
  validateDbUrl,
  validateMigrationInputs,
} from "./db-url-validator";

describe("validateDbUrl", () => {
  const sampleSecret = "SuperSecretPassword123!#%";
  const validDirectUrl = `postgresql://postgres:${encodeURIComponent(sampleSecret)}@db.zokkgocmcaqcujltfkjf.supabase.co:5432/postgres`;
  const validPoolerUrl = `postgresql://postgres.zokkgocmcaqcujltfkjf:${encodeURIComponent(sampleSecret)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;

  it("acepta una URL directa válida hacia el proyecto development autorizado", () => {
    const result = validateDbUrl({ url: validDirectUrl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectRef).toBe(DEFAULT_DEV_PROJECT_REF);
      expect(result.host).toBe("db.zokkgocmcaqcujltfkjf.supabase.co");
    }
  });

  it("acepta una URL de pooler válida hacia el proyecto development autorizado", () => {
    const result = validateDbUrl({ url: validPoolerUrl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectRef).toBe(DEFAULT_DEV_PROJECT_REF);
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

  it("rechaza URLs que apuntan a otro project ref desconocido", () => {
    const otherUrl = `postgresql://postgres:${encodeURIComponent(sampleSecret)}@db.abcdefghijklmnopqrst.supabase.co:5432/postgres`;
    const result = validateDbUrl({ url: otherUrl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no coincide con el identificador del proyecto de desarrollo autorizado");
      // Verifica que el mensaje de error NO revele la contraseña
      expect(result.error).not.toContain(sampleSecret);
    }
  });

  it("rechaza explícitamente URLs que apunten a producción", () => {
    const prodRef = "prodref123456789012";
    const prodUrl = `postgresql://postgres:${encodeURIComponent(sampleSecret)}@db.${prodRef}.supabase.co:5432/postgres`;
    const result = validateDbUrl({ url: prodUrl, productionRef: prodRef });
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
