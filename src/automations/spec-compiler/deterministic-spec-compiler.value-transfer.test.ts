import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { compileDeterministicSpec } from "./deterministic-spec-compiler";

test("mock: generated specs retain source tab for copied request IDs across project profiles", () => {
  for (const appSlug of ["portal-comercial", "portal-empresarial"]) {
    const contract = {
      version: "1.0",
      scenarioId: "value-transfer-mock",
      title: "Buscar solicitud en Bizagi",
      appSlug,
      steps: [{
        contractStepIndex: 0,
        scenarioStepIndex: 7,
        originalText: "Abrir Bizagi",
        operation: "select_tab",
        pageKey: "tab-2",
        opensNewPage: true,
        runtimeValueCaptures: [{
          sourceEventRef: "event-7",
          sourcePageKey: "tab-1",
          technicalTargetRefs: ["css:#request-id"],
          valueSelection: { sourceKind: "input", startOffset: 0, endOffset: 8, endAtSourceEnd: false },
        }],
        executionStatus: "executed",
      }],
      unresolvedRequiredOracles: [],
      diagnostics: { requiredScenarioSteps: 1, representedScenarioSteps: 1, missingScenarioSteps: [] },
    } as any;

    const generated = compileDeterministicSpec(contract, {
      targetSpecPath: path.resolve(`automations/apps/${appSlug}/cases/value-transfer-mock/case.spec.ts`),
    });
    assert.deepEqual(generated.unsupportedCapabilities, []);
    const selectTabIndex = generated.source.indexOf('selectRecordedPage("tab-2", true)');
    const captureIndex = generated.source.indexOf("captureRecordedApplicationValue(");
    assert.ok(selectTabIndex >= 0 && captureIndex > selectTabIndex, "capture is emitted after selecting the destination tab");
    assert.match(generated.source, /sourcePageKey.*tab-1/, "generated spec must retain the source tab identity");
  }
});
