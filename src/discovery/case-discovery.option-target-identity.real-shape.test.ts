import assert from "node:assert/strict";
import test from "node:test";
import { parseScenarioStepsForDiscovery } from "./case-discovery";
import type { TestScenario } from "../types/testrail.types";

/**
 * DIAGNOSE (jobId 4e55bced-f9d1-4814-b244-8ed481496152): replicates the REAL
 * `recordingExecutionContract.actions` shape read directly from
 * `.artifacts/scenario-preview-runs/4e55bced-f9d1-4814-b244-8ed481496152/generated-cases/
 * preview-001.json` (interaction-18 = owner, interaction-19 = option), verbatim except for
 * renumbered `stepIndex` (1/2 instead of 9/10, so the monotonic-index check in
 * `parseScenarioStepsForDiscovery` doesn't reject this two-action subset) and mojibake-decoded
 * accented characters (the raw artifact bytes render as "Categor�a"/"Cuentas de Efectivo" is
 * already clean). Proves whether the CURRENT code, given the ACTUAL physical shape, produces the
 * correct target/associatedField split.
 */

function realShapeScenario(): TestScenario {
  const actions = [
    {
      actionType: "click",
      interactionId: "interaction-18",
      semanticField: "Categoría de producto",
      associatedField: "Categoría de producto",
      targetRef: "fbf08c6ecee9|Categoría de producto",
      technicalTargetCandidates: [{
        targetType: "structural",
        locatorCandidates: [],
        structuralContext: {
          owner: { tag: "span", role: "combobox" },
          stableDirectAttributes: { role: "combobox" },
          stableDescendants: [],
          semanticShape: [],
          landmarkAncestor: { tag: "main" },
          deterministicStructuralIdentity: false,
          identityAmbiguous: true,
          structuralIdentityMatchCount: 2,
        },
        interactionEvidence: ["v2_click_owner"],
        confidence: 0.85,
        validatedByInteraction: true,
      }],
      valueKey: "categoria_de_producto",
      stepIndex: 1,
      expectedState: "fbf08c6ecee9",
      expectedRouteBefore: "https://example.test/requests/10207/edit",
      controlIdentity: "fbf08c6ecee9|Categoría de producto",
    },
    {
      actionType: "click",
      interactionId: "interaction-19",
      semanticField: "Categoría de producto",
      associatedField: "Categoría de producto",
      targetRef: "fbf08c6ecee9|Cuentas de Efectivo|role|option|Cuentas de Efectivo",
      technicalTargetRef: "role:option|Cuentas de Efectivo",
      technicalTargetRefs: ["role:option|Cuentas de Efectivo", "css:#pv_id_113_0", "id:pv_id_113_0"],
      technicalTargetCandidates: [{
        targetType: "structural",
        locatorCandidates: [{ strategy: "css", value: "#pv_id_113_0", confidence: 0.8 }],
        structuralContext: {
          owner: { tag: "li", role: "option" },
          stableDirectAttributes: { "aria-label": "Cuentas de Efectivo", id: "pv_id_113_0", role: "option" },
          stableDescendants: [],
          semanticShape: ["span"],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
        },
        interactionEvidence: ["v2_click_owner"],
        confidence: 0.85,
        validatedByInteraction: true,
      }],
      valueKey: "cuentas_de_efectivo",
      stepIndex: 2,
      expectedState: "fbf08c6ecee9",
      expectedRouteBefore: "https://example.test/requests/10207/edit",
      controlIdentity: "fbf08c6ecee9|Cuentas de Efectivo|role|option|Cuentas de Efectivo",
    },
  ];
  return {
    source: "testrail",
    externalId: "external",
    caseId: 1,
    title: "scenario",
    steps: [{ index: 1, action: "placeholder", dataHints: [] }],
    recordingExecutionContract: { actions, runtimeInputRequirements: [] },
  } as unknown as TestScenario;
}

test("1/realArtifactShape. the EXACT real action shape from the physical artifact resolves target=option, associatedField=owner", () => {
  const parsed = parseScenarioStepsForDiscovery(realShapeScenario());
  assert.equal(parsed.actionTargets.length, 2);
  const [owner, option] = parsed.actionTargets;
  assert.equal(owner.target, "Categoría de producto");
  assert.equal(owner.associatedField, "Categoría de producto");
  assert.equal(option.target, "Cuentas de Efectivo", "target must be the option's own recorded identity");
  assert.equal(option.associatedField, "Categoría de producto");
  assert.notEqual(option.target, option.associatedField);
});
