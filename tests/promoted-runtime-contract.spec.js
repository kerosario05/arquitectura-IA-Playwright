"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const promoted_runtime_contract_1 = require("../src/automations/runtime/promoted-runtime-contract");
const promoted_validate_runtime_1 = require("../src/cli/promoted-validate-runtime");
async function setupCase(baseDir, appSlug, caseSlug, specContent, diagnostics) {
    const caseDir = node_path_1.default.join(baseDir, "automations", "apps", appSlug, "cases", caseSlug);
    await promises_1.default.mkdir(caseDir, { recursive: true });
    const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
    const diagnosticsPath = node_path_1.default.join(caseDir, "promotion-diagnostics.json");
    await promises_1.default.writeFile(specPath, specContent, "utf-8");
    await promises_1.default.writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), "utf-8");
    return { specPath, diagnosticsPath };
}
(0, test_1.test)("Spec POM válido cumple contrato runtime", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-valid");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const { specPath, diagnosticsPath } = await setupCase(root, "test-app", "case-valid", `
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
const promotedRuntime = createPromotedSpecRuntime(page as any);
await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'X', action: async () => {} });
`, { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: true, blockers: [], reason: "promoted" });
    const result = await (0, promoted_runtime_contract_1.validatePromotedSpecRuntimeContract)(specPath, diagnosticsPath);
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("Spec POM sin runtime factory es inválido", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-no-factory");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const { specPath, diagnosticsPath } = await setupCase(root, "test-app", "case-invalid-no-factory", `export const PROMOTED_SPEC_STRATEGY = "pom_runtime";`, { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: false, blockers: [], reason: "promoted" });
    const result = await (0, promoted_runtime_contract_1.validatePromotedSpecRuntimeContract)(specPath, diagnosticsPath);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.errors.join("|")).toContain("runtime_factory");
});
(0, test_1.test)("Spec inline con diagnostics pom es inválido", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-inline-vs-pom");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const { specPath, diagnosticsPath } = await setupCase(root, "test-app", "case-invalid-inline", `export const PROMOTED_SPEC_STRATEGY = "inline_executor";`, { selectedStrategy: "pom", fallbackUsed: true, requirePomRuntime: false, blockers: ["missing_method:x"], reason: "inline_fallback" });
    const result = await (0, promoted_runtime_contract_1.validatePromotedSpecRuntimeContract)(specPath, diagnosticsPath);
    (0, test_1.expect)(result.valid).toBe(false);
});
(0, test_1.test)("Fallback inline permitido con require=false es válido", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-inline-allowed");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const { specPath, diagnosticsPath } = await setupCase(root, "test-app", "case-inline-ok", `export const PROMOTED_SPEC_STRATEGY = "inline_executor";`, { selectedStrategy: "inline", fallbackUsed: true, requirePomRuntime: false, blockers: ["missing_method:x"], reason: "inline_fallback" });
    const result = await (0, promoted_runtime_contract_1.validatePromotedSpecRuntimeContract)(specPath, diagnosticsPath);
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(result.strategy).toBe("inline_executor");
});
(0, test_1.test)("Require POM runtime con spec inline es inválido", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-require");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const { specPath, diagnosticsPath } = await setupCase(root, "test-app", "case-inline-require", `export const PROMOTED_SPEC_STRATEGY = "inline_executor";`, { selectedStrategy: "inline", fallbackUsed: true, requirePomRuntime: true, blockers: ["missing_method:x"], reason: "inline_fallback" });
    const result = await (0, promoted_runtime_contract_1.validatePromotedSpecRuntimeContract)(specPath, diagnosticsPath);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.errors.join("|")).toContain("require_pom_runtime");
});
(0, test_1.test)("CLI promoted:validate-runtime reporta counts y falla con invalids", async () => {
    const root = process.cwd();
    const appSlug = "test-app-contract-gate";
    const appDir = node_path_1.default.join(root, "automations", "apps", appSlug);
    await promises_1.default.rm(appDir, { recursive: true, force: true });
    await setupCase(root, appSlug, "case-pom-ok", `
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
const promotedRuntime = createPromotedSpecRuntime(page as any);
await promotedRuntime.expectPromotedVisible({ stepIndex: 1, target: 'Y', assertion: async () => {} });
`, { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: false, blockers: [], reason: "promoted" });
    await setupCase(root, appSlug, "case-inline", `export const PROMOTED_SPEC_STRATEGY = "inline_executor";`, { selectedStrategy: "inline", fallbackUsed: true, requirePomRuntime: false, blockers: [], reason: "inline_fallback" });
    await setupCase(root, appSlug, "case-invalid", `export const PROMOTED_SPEC_STRATEGY = "pom_runtime";`, { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: false, blockers: [], reason: "promoted" });
    const summary = await (0, promoted_validate_runtime_1.runPromotedRuntimeValidation)(appSlug);
    (0, test_1.expect)(summary.totalSpecs).toBe(3);
    (0, test_1.expect)(summary.pomRuntimeCount).toBe(2);
    (0, test_1.expect)(summary.inlineCount).toBe(1);
    (0, test_1.expect)(summary.invalidCount).toBe(1);
    (0, test_1.expect)(summary.errors.length).toBeGreaterThan(0);
    await promises_1.default.rm(appDir, { recursive: true, force: true });
});
(0, test_1.test)("detects fillField(fieldName, fieldName) anti-pattern", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-antipattern");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const { specPath, diagnosticsPath } = await setupCase(root, "test-app", "case-antipattern", `
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
const promotedRuntime = createPromotedSpecRuntime(page as any);
const ordenNombre = requirePromotedData(dataContext, 'orden_nombre', { fieldName: 'Name', stepIndex: 8 });
await promotedRuntime.fillPromotedField({ stepIndex: 8, field: 'Name', value: String(ordenNombre), sensitive: false, fill: async () => { await formPage.fillField('Name', 'Name'); } });
`, { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: true, blockers: [], reason: "promoted" });
    const result = await (0, promoted_runtime_contract_1.validatePromotedSpecRuntimeContract)(specPath, diagnosticsPath);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.errors.join("|")).toContain("PROMOTED_FILL_VALUE_LITERAL_FIELD_NAME");
});
(0, test_1.test)("valid spec with valueKey uses variable in callback", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-valid-valuekey");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const { specPath, diagnosticsPath } = await setupCase(root, "test-app", "case-valid-valuekey", `
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
const promotedRuntime = createPromotedSpecRuntime(page as any);
const ordenNombre = requirePromotedData(dataContext, 'orden_nombre', { fieldName: 'Name', stepIndex: 8 });
await promotedRuntime.fillPromotedField({ stepIndex: 8, field: 'Name', value: String(ordenNombre), sensitive: false, fill: async () => { await formPage.fillField('Name', ordenNombre); } });
`, { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: true, blockers: [], reason: "promoted" });
    const result = await (0, promoted_runtime_contract_1.validatePromotedSpecRuntimeContract)(specPath, diagnosticsPath);
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(result.errors).toHaveLength(0);
});
(0, test_1.test)("warns about unused requirePromotedData variable", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-contract-unused");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const { specPath, diagnosticsPath } = await setupCase(root, "test-app", "case-unused-var", `
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
const promotedRuntime = createPromotedSpecRuntime(page as any);
const unusedVar = requirePromotedData(dataContext, 'unused_key', { fieldName: 'Field', stepIndex: 1 });
await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'X', action: async () => {} });
`, { selectedStrategy: "pom", fallbackUsed: false, requirePomRuntime: false, blockers: [], reason: "promoted" });
    const result = await (0, promoted_runtime_contract_1.validatePromotedSpecRuntimeContract)(specPath, diagnosticsPath);
    (0, test_1.expect)(result.warnings.some(w => w.includes("UNUSED_PROMOTED_DATA_VAR"))).toBe(true);
});
