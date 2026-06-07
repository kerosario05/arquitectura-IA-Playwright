import assert from "node:assert";
import { resolveTargetWithAliases } from "./target-alias-resolver";
import type { AppRouteProfile } from "../types/env.types";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(_name: string, fn: () => void): void {
  console.log(`\n${_name}`);
  fn();
}

const profile: AppRouteProfile = {
  aliases: {
    "Volver al listado de productos": "Volver",
    "Regresar al listado": "Volver",
    "Ir a inicio": "Inicio",
  },
};

const emptyProfile: AppRouteProfile = {};

describe("resolveTargetWithAliases", () => {
  test("no routeProfile: returns not resolved", () => {
    const result = resolveTargetWithAliases("Volver al listado", undefined);
    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.source, "none");
  });

  test("no aliases: returns not resolved", () => {
    const result = resolveTargetWithAliases("Volver al listado", emptyProfile);
    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.source, "none");
  });

  test("target matches alias value exactly: resolves to canonical key", () => {
    const result = resolveTargetWithAliases("Volver", profile);
    assert.ok(result.resolved);
    assert.strictEqual(result.resolvedTarget, "Volver");
    assert.strictEqual(result.matchedValue, "Volver");
    assert.ok(result.confidence >= 0.9);
  });

  test("target text contains alias key (long form): resolves to short value", () => {
    const result = resolveTargetWithAliases("Hacer clic en Volver al listado de productos", profile);
    assert.ok(result.resolved);
    assert.strictEqual(result.resolvedTarget, "Volver");
    assert.ok(result.confidence >= 0.8);
  });

  test("target partially matches alias by token overlap: resolves with moderate confidence", () => {
    const result = resolveTargetWithAliases("Regresar a listado productos", profile);
    assert.ok(result.resolved);
    assert.strictEqual(result.resolvedTarget, "Volver");
    assert.ok(result.confidence >= 0.7);
  });

  test("target with no token overlap: not resolved", () => {
    const result = resolveTargetWithAliases("Configuración avanzada", profile);
    assert.strictEqual(result.resolved, false);
  });

  test("non-matching short target: not resolved", () => {
    const result = resolveTargetWithAliases("Guardar", profile);
    assert.strictEqual(result.resolved, false);
  });

  test("alias from one appSlug does not apply to another (empty profile check)", () => {
    const otherProfile: AppRouteProfile = {
      aliases: { "Productos activos": "Activos" },
    };
    const result = resolveTargetWithAliases("Volver al listado", otherProfile);
    assert.strictEqual(result.resolved, false);
  });

  test("navigate step with descriptive text is resolved", () => {
    const result = resolveTargetWithAliases("Ir a inicio", profile);
    assert.ok(result.resolved);
    assert.strictEqual(result.resolvedTarget, "Inicio");
  });

  test("returns originalTarget unchanged", () => {
    const result = resolveTargetWithAliases("Volver al listado de productos", profile);
    assert.strictEqual(result.originalTarget, "Volver al listado de productos");
  });
});
