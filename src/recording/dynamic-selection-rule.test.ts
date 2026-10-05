import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { chromium } from "playwright";
import { encodeSelectionRule, parseSelectionRule, matchingSelectionOptions } from "./dynamic-selection-rule";
import { renderHumanStepValue } from "./human-step-renderer";
import { parseStepIntent } from "../discovery/step-intent-parser";
import { resolveActionTarget } from "../discovery/target-resolver";
import { compileDeterministicSpec } from "../automations/spec-compiler/deterministic-spec-compiler";
import type { NativeSelectionCapture } from "./native-selection-capture";
import { PromotedSpecRuntime } from "../automations/runtime/promoted-spec-runtime";
import { applyRuntimeDatasetValues, toSharedMcpScenario } from "./canonical-recording-contract";

const nativeSelection: NativeSelectionCapture = {
  controlIdentity: { strategy: "id", value: "source-list" },
  scopeIdentity: { strategy: "css", value: "div:has(> select[id=\"source-list\"])" },
  options: [{ value: "old-key", label: "Old item / USD / 12345678 / 99.00", disabled: false }],
  clickedOption: { value: "old-key", label: "Old item / USD / 12345678 / 99.00" },
  selectedValue: "old-key", selectionMode: "index", selectedOptionIndex: 0,
};
const evidence = { kind: "text" as const, normalizedName: "Choose item", scopeIdentity: nativeSelection.scopeIdentity,
  runtimeResolutionRequired: true as const, nativeSelection };

test("explicit criteria are generic, validated, and rendered without serialization details", () => {
  const rule = { terms: ["USD", "Savings"], matchIndex: 1 };
  const value = encodeSelectionRule(rule);
  assert.deepEqual(parseSelectionRule(value), rule);
  assert.equal(parseSelectionRule('@selection-rule/v1:{"terms":[],"matchIndex":0}'), undefined);
  assert.equal(parseSelectionRule('@selection-rule/v2:{}'), undefined);
  assert.throws(() => encodeSelectionRule({ terms: ["USD"], matchIndex: -1 }));
  const otherDomain = matchingSelectionOptions([
    { value: "a", label: "Large / Red" }, { value: "b", label: "Small / Red" }, { value: "c", label: "Large / Blue" },
  ], { terms: ["Large", "Red"], matchIndex: 0 });
  assert.deepEqual(otherDomain.map(option => option.value), ["a"]);
  assert.match(renderHumanStepValue('Seleccionar [choice]', "choice", value), /coincidencia 2/);
  assert.doesNotMatch(renderHumanStepValue('Seleccionar [choice]', "choice", value), /@selection-rule/);
  const step = renderHumanStepValue('Seleccionar [choice] en "Choose item"', "choice", encodeSelectionRule({ terms: ['Savings "USD"'], matchIndex: 0 }));
  assert.equal(step, 'Seleccionar opción que contiene Savings USD (coincidencia 1) en el campo "Choose item"');
  const parsed = parseStepIntent(step).find((intent) => intent.type === "action_select");
  assert.equal(parsed?.selectionField, "Choose item");
  const olderNestedQuoteStep = 'Seleccionar "coincidencia 1 con \\"Savings\\"" en "Choose item"';
  assert.equal(parseStepIntent(olderNestedQuoteStep).find((intent) => intent.type === "action_select")?.selectionField, "Choose item");
});

test("shared discovery resolver uses current options, owner, criteria and occurrence; missing matches fail closed", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div><select id="source-list" aria-label="Choose item">
      <option value="">Choose</option><option value="eur">Savings / EUR / New owner</option>
      <option value="blocked" disabled>Savings / USD</option><optgroup disabled><option value="group-disabled">Savings / USD</option></optgroup>
      <option value="usd-a">Savings / USD / Changed owner / 1.00</option><option value="usd-b">Savings / USD / Another owner / 2.00</option>
    </select></div><div><select id="destination-list"><option value="untouched">Savings / USD</option></select></div>`);
    const select = (value: string, capture = evidence) => resolveActionTarget(page, { elements: [] } as any, "Choose item", {
      actionType: "action_select", recordingActionType: "select", associatedField: "Choose item", selectionField: "Choose item",
      selectionValue: value, playwrightRecorderEvidence: capture,
    });
    const result = await select(encodeSelectionRule({ terms: ["USD", "Savings"], matchIndex: 1 }));
    assert.equal(result.selectionApplied, true);
    assert.equal(await page.locator('#source-list').inputValue(), "usd-b");
    assert.equal(await page.locator('#destination-list').inputValue(), "untouched");
    // Exercise the promoted runtime's real shared selection path. Evidence and
    // post-action bookkeeping are outside this isolated DOM selection fixture.
    const runtime = Object.create(PromotedSpecRuntime.prototype) as any;
    runtime.page = page;
    runtime.config = { actionTimeoutMs: 1000 };
    for (const method of ["markBoundaryProgress", "ensureInitialEvidence", "dismissSessionExpiringWarningIfPresent", "postActionStability", "captureClickStep"]) {
      runtime[method] = async () => undefined;
    }
    let callbackInvoked = false;
    await runtime.selectPromotedItem({ stepIndex: 1, target: "Choose item", associatedField: "Choose item", selectionField: "Choose item",
      selectionValue: encodeSelectionRule({ terms: ["USD"], matchIndex: 0 }), playwrightRecorderEvidence: evidence,
      action: async () => { callbackInvoked = true; } });
    assert.equal(await page.locator('#source-list').inputValue(), "usd-a");
    assert.equal(callbackInvoked, false);
    await assert.rejects(runtime.selectPromotedItem({ stepIndex: 1, target: "Choose item", associatedField: "Choose item", selectionField: "Choose item",
      selectionValue: encodeSelectionRule({ terms: ["JPY"], matchIndex: 0 }), playwrightRecorderEvidence: evidence,
      action: async () => { callbackInvoked = true; } }), /not applied and verified/);
    assert.equal(callbackInvoked, false, "a missing rule match must never fall back to the old option callback");
    const missing = await select(encodeSelectionRule({ terms: ["JPY"], matchIndex: 0 }));
    assert.notEqual(missing.status, "resolved");
    assert.equal(await page.locator('#source-list').inputValue(), "usd-a");
    assert.notEqual((await select('@selection-rule/v1:{}')).status, "resolved");
    const positional = await select("Old item / USD / 12345678 / 99.00");
    assert.equal(positional.selectionApplied, true);
    assert.equal(await page.locator('#source-list').inputValue(), "eur", "legacy index mode remains positional");
  } finally { await browser.close(); }
});

test("QA rule survives scenario persistence and MCP execution contract without rewriting recorded evidence", () => {
  const value = encodeSelectionRule({ terms: ["USD"], matchIndex: 0 });
  const original = {
    scenarioId: "fixture", sourceRecordingId: "fixture-recording", title: "fixture", description: "fixture",
    preconditions: [], kind: "happy_path", provenance: "observed", mobileSteps: [], webSteps: [], primary: true,
    hasUncertainSteps: false, technicalReadiness: true, functionalReadiness: true, oracleAuthority: "observed_only",
    requiredData: [{ key: "choice_seleccion", label: "Choose item", semanticField: "Choose item", stepIndex: 1,
      exampleValue: nativeSelection.clickedOption!.label, sensitive: false, source: "RECORDED_CONFIRMED", valueRole: "action_input" }],
    testRailSteps: [{ content: 'Seleccionar [choice_seleccion] en "Choose item"', stepTemplate: 'Seleccionar [choice_seleccion] en "Choose item"',
      valueKey: "choice_seleccion", expected: "" }],
    canonicalInteractions: [{ id: "selection", action: "select", semanticField: "Choose item", controlIdentity: "source-list",
      valueKey: "choice_seleccion", recordedValue: nativeSelection.clickedOption!.label, technicalTargetRefs: ["css:#source-list"],
      sourceEventRefs: ["event-1"], confidence: 1, playwrightRecorderEvidence: evidence }],
  } as any;
  const edited = applyRuntimeDatasetValues(original, { choice_seleccion: value });
  const restored = applyRuntimeDatasetValues(JSON.parse(JSON.stringify(edited)), {});
  const mcp = toSharedMcpScenario(restored, "generic-project", {});
  assert.equal(restored.runtimeDataset?.resolvedValues.choice_seleccion, value);
  assert.equal(mcp.recordingExecutionContract?.datasetBindings?.choice_seleccion, value);
  assert.equal(mcp.recordingExecutionContract?.actions.find(action => action.valueKey === "choice_seleccion")?.value, value);
  assert.equal(restored.canonicalInteractions?.[0].recordedValue, nativeSelection.clickedOption!.label);
});

test("compiler transports dataset binding and native owner even with technical target authority; no name callback for dynamic lists", () => {
  const result = compileDeterministicSpec({
    version: "1", scenarioId: "selection-fixture", title: "Selection fixture", unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: 1, representedScenarioSteps: 1, missingScenarioSteps: [] },
    steps: [{ contractStepIndex: 0, scenarioStepIndex: 1, operation: "select", originalText: "Select item", required: true,
      executionStatus: "executed", evidenceRefs: [], valueKey: "chosen_item", associatedField: "Choose item",
      selectionField: "Choose item", target: { strategy: "css", value: "#source-list" },
      technicalTargetRef: "css:#source-list", playwrightRecorderEvidence: evidence }],
  }, { targetSpecPath: path.resolve(".artifacts/dynamic-selection/spec.ts") });
  assert.deepEqual(result.unsupportedCapabilities, []);
  assert.match(result.source, /valueKey: 'chosen_item'/);
  assert.match(result.source, /playwrightRecorderEvidence:/);
  assert.match(result.source, /Recorded indexed selection requires runtime resolution/);
  assert.doesNotMatch(result.source, /getByRole\('option'/);
});
