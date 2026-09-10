import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { validatePromotedSpecRuntimeContract } from "../src/automations/runtime/promoted-runtime-contract";
import { runPromotedRuntimeValidation } from "../src/cli/promoted-validate-runtime";

async function setupCase(baseDir: string, appSlug: string, caseSlug: string, specContent: string, diagnostics: Record<string, unknown>): Promise<{ specPath: string; diagnosticsPath: string }> {
  const caseDir = path.join(baseDir, "automations", "apps", appSlug, "cases", caseSlug);
  await fs.mkdir(caseDir, { recursive: true });
  const specPath = path.join(caseDir, "case.spec.ts");
  const diagnosticsPath = path.join(caseDir, "promotion-diagnostics.json");
  await fs.writeFile(specPath, specContent, "utf-8");
  await fs.writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), "utf-8");
  return { specPath, diagnosticsPath };
}

test("Spec POM válido cumple contrato runtime", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-valid");
  await fs.rm(root, { recursive: true, force: true });
  const { specPath, diagnosticsPath } = await setupCase(
    root,
    "test-app",
    "case-valid",
    `
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
const promotedRuntime = createPromotedSpecRuntime(page as any);
await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'X', action: async () => {} });
`,
    { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: true, blockers: [], reason: "promoted" }
  );
  const result = await validatePromotedSpecRuntimeContract(specPath, diagnosticsPath);
  expect(result.valid).toBe(true);
});

test("candidate diagnostics do not contaminate a different previous spec", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-identity");
  await fs.rm(root, { recursive: true, force: true });
  const expectedSpecPath = path.join(root, "automations", "apps", "test-app", "cases", "case-identity", "case.spec.ts");
  const { specPath, diagnosticsPath } = await setupCase(
    root, "test-app", "case-identity",
    `export const PROMOTED_SPEC_STRATEGY = "pom_runtime";\nconst promotedRuntime = createPromotedSpecRuntime(page as any);`,
    { specSource: "ai_candidate", specPath: expectedSpecPath, specHash: "candidate-hash", selectedStrategy: "pom", blockers: ["missing_method:candidate"], reason: "failed" },
  );
  const result = await validatePromotedSpecRuntimeContract(specPath, diagnosticsPath);
  expect(result.valid).toBe(true);
  expect(result.errors).not.toContain("pom_selected_with_fatal_blockers");
  await fs.rm(root, { recursive: true, force: true });
});

test("Spec POM sin runtime factory es inválido", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-no-factory");
  await fs.rm(root, { recursive: true, force: true });
  const { specPath, diagnosticsPath } = await setupCase(
    root,
    "test-app",
    "case-invalid-no-factory",
    `export const PROMOTED_SPEC_STRATEGY = "pom_runtime";`,
    { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: false, blockers: [], reason: "promoted" }
  );
  const result = await validatePromotedSpecRuntimeContract(specPath, diagnosticsPath);
  expect(result.valid).toBe(false);
  expect(result.errors.join("|")).toContain("runtime_factory");
});

test("Spec inline con diagnostics pom es inválido", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-inline-vs-pom");
  await fs.rm(root, { recursive: true, force: true });
  const { specPath, diagnosticsPath } = await setupCase(
    root,
    "test-app",
    "case-invalid-inline",
    `export const PROMOTED_SPEC_STRATEGY = "inline_executor";`,
    { selectedStrategy: "pom", fallbackUsed: true, requirePomRuntime: false, blockers: ["missing_method:x"], reason: "inline_fallback" }
  );
  const result = await validatePromotedSpecRuntimeContract(specPath, diagnosticsPath);
  expect(result.valid).toBe(true);
});

test("Fallback inline permitido con require=false es válido", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-inline-allowed");
  await fs.rm(root, { recursive: true, force: true });
  const { specPath, diagnosticsPath } = await setupCase(
    root,
    "test-app",
    "case-inline-ok",
    `export const PROMOTED_SPEC_STRATEGY = "inline_executor";`,
    { selectedStrategy: "inline", fallbackUsed: true, requirePomRuntime: false, blockers: ["missing_method:x"], reason: "inline_fallback" }
  );
  const result = await validatePromotedSpecRuntimeContract(specPath, diagnosticsPath);
  expect(result.valid).toBe(true);
  expect(result.strategy).toBe("inline_executor");
});

test("Require POM runtime con spec inline es inválido", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-require");
  await fs.rm(root, { recursive: true, force: true });
  const { specPath, diagnosticsPath } = await setupCase(
    root,
    "test-app",
    "case-inline-require",
    `export const PROMOTED_SPEC_STRATEGY = "inline_executor";`,
    { selectedStrategy: "inline", fallbackUsed: true, requirePomRuntime: true, blockers: ["missing_method:x"], reason: "inline_fallback" }
  );
  const result = await validatePromotedSpecRuntimeContract(specPath, diagnosticsPath);
  expect(result.valid).toBe(false);
  expect(result.errors.join("|")).toContain("require_pom_runtime");
});

test("CLI promoted:validate-runtime reporta counts y falla con invalids", async () => {
  const root = process.cwd();
  const appSlug = "test-app-contract-gate";
  const appDir = path.join(root, "automations", "apps", appSlug);
  await fs.rm(appDir, { recursive: true, force: true });

  await setupCase(
    root,
    appSlug,
    "case-pom-ok",
    `
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
const promotedRuntime = createPromotedSpecRuntime(page as any);
await promotedRuntime.expectPromotedVisible({ stepIndex: 1, target: 'Y', assertion: async () => {} });
`,
    { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: false, blockers: [], reason: "promoted" }
  );
  await setupCase(
    root,
    appSlug,
    "case-inline",
    `export const PROMOTED_SPEC_STRATEGY = "inline_executor";`,
    { selectedStrategy: "inline", fallbackUsed: true, requirePomRuntime: false, blockers: [], reason: "inline_fallback" }
  );
  await setupCase(
    root,
    appSlug,
    "case-invalid",
    `export const PROMOTED_SPEC_STRATEGY = "pom_runtime";`,
    { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: false, blockers: [], reason: "promoted" }
  );

  const summary = await runPromotedRuntimeValidation(appSlug);
  expect(summary.totalSpecs).toBe(3);
  expect(summary.pomRuntimeCount).toBe(2);
  expect(summary.inlineCount).toBe(1);
  expect(summary.invalidCount).toBe(1);
  expect(summary.errors.length).toBeGreaterThan(0);
  await fs.rm(appDir, { recursive: true, force: true });
});

test("detects fillField(fieldName, fieldName) anti-pattern", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-antipattern");
  await fs.rm(root, { recursive: true, force: true });
  const { specPath, diagnosticsPath } = await setupCase(
    root,
    "test-app",
    "case-antipattern",
    `
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
const promotedRuntime = createPromotedSpecRuntime(page as any);
const ordenNombre = requirePromotedData(dataContext, 'orden_nombre', { fieldName: 'Name', stepIndex: 8 });
await promotedRuntime.fillPromotedField({ stepIndex: 8, field: 'Name', value: String(ordenNombre), sensitive: false, fill: async () => { await formPage.fillField('Name', 'Name'); } });
`,
    { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: true, blockers: [], reason: "promoted" }
  );
  const result = await validatePromotedSpecRuntimeContract(specPath, diagnosticsPath);
  expect(result.valid).toBe(false);
  expect(result.errors.join("|")).toContain("PROMOTED_FILL_VALUE_LITERAL_FIELD_NAME");
});

test("valid spec with valueKey uses variable in callback", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-valid-valuekey");
  await fs.rm(root, { recursive: true, force: true });
  const { specPath, diagnosticsPath } = await setupCase(
    root,
    "test-app",
    "case-valid-valuekey",
    `
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
const promotedRuntime = createPromotedSpecRuntime(page as any);
const ordenNombre = requirePromotedData(dataContext, 'orden_nombre', { fieldName: 'Name', stepIndex: 8 });
await promotedRuntime.fillPromotedField({ stepIndex: 8, field: 'Name', value: String(ordenNombre), sensitive: false, fill: async () => { await formPage.fillField('Name', ordenNombre); } });
`,
    { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: true, blockers: [], reason: "promoted" }
  );
  const result = await validatePromotedSpecRuntimeContract(specPath, diagnosticsPath);
  expect(result.valid).toBe(true);
  expect(result.errors).toHaveLength(0);
});

test("warns about unused requirePromotedData variable", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-unused");
  await fs.rm(root, { recursive: true, force: true });
  const { specPath, diagnosticsPath } = await setupCase(
    root,
    "test-app",
    "case-unused-var",
    `
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
const promotedRuntime = createPromotedSpecRuntime(page as any);
const unusedVar = requirePromotedData(dataContext, 'unused_key', { fieldName: 'Field', stepIndex: 1 });
await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'X', action: async () => {} });
`,
    { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: false, blockers: [], reason: "promoted" }
  );
  const result = await validatePromotedSpecRuntimeContract(specPath, diagnosticsPath);
  expect(result.warnings.some(w => w.includes("UNUSED_PROMOTED_DATA_VAR"))).toBe(true);
});
