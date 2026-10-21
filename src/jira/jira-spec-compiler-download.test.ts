import test from "node:test";
import assert from "node:assert/strict";
import type { ExecutionPlan } from "../types/execution-plan.types";
import { compileJiraSpec } from "./jira-spec-compiler";

const compile = (description: string) => {
  const plan: ExecutionPlan = {
    version: "1.0", source: "discovery_generated", status: "validated",
    scenario: { source: "jira", title: "Download content" }, requiredData: [],
    steps: [{ index: 1, action: "assertVisible", target: { strategy: "text", value: "datos.csv", exact: true }, description }],
    createdAt: new Date(0).toISOString(),
  };
  const sourceScenario = { observableOracles: [{ type: "runtime_state", stepIndex: 1, backed: true, details: { kind: "download_content" } }] };
  return compileJiraSpec({ plan, sourceScenario, appSlug: "fixture", sectionSlug: "jira", automationId: "case", specPath: "fixture/case.spec.ts" });
};

// The import header names both helpers, so match call sites only.
test("Jira compiler emits the download oracle for a backed download_content step, never visible text", () => {
  const compiled = compile('Validar que se descarga "datos.csv" con encabezados "Fecha, Monto".');
  assert.deepEqual(compiled.unsupported, []);
  assert.match(compiled.source, /await assertJiraSpecDownloadContent\(page, /);
  assert.doesNotMatch(compiled.source, /await assertJiraSpecVisibleText\(/);
});

test("Jira compiler emits the table-bound download helper, never static content or visible text", () => {
  const compiled = compile("Validar que se descargue el archivo datos.csv con los movimientos correspondientes a los filtros aplicados.");
  assert.deepEqual(compiled.unsupported, []);
  assert.match(compiled.source, /await assertJiraSpecTableBoundDownload\(page, /);
  assert.doesNotMatch(compiled.source, /await assertJiraSpecDownloadContent\(/);
  assert.doesNotMatch(compiled.source, /await assertJiraSpecVisibleText\(/);
});

test("Jira compiler marks an unparseable download requirement unsupported without downgrading to visible text", () => {
  const compiled = compile('Validar que el archivo descargado "a.csv" incluya los encabezados.');
  assert.deepEqual(compiled.unsupported, ["step_1:download_expectation_unparseable"]);
  assert.doesNotMatch(compiled.source, /await assertJiraSpecDownloadContent\(/);
  assert.doesNotMatch(compiled.source, /await assertJiraSpecVisibleText\(/);
});
