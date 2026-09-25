import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "./spec-compiler/deterministic-spec-compiler";

const TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/portal-comercial/sections/default-section/cases/preview-001-segunta-prueba/case.spec.ts",
);

function compileDeterministicSpec(contract: Parameters<typeof compileDeterministicSpecRaw>[0]) {
  return compileDeterministicSpecRaw(contract, { targetSpecPath: TARGET_SPEC_PATH });
}

function buildPlan() {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, externalId: "C1", title: "Scenario" },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Depurar" }, description: "Clic en Depurar" }],
    createdAt: new Date().toISOString(),
  } as any;
}

test("A/upstream resolutionState=certified is transported verbatim into SpecExecutionContractStep.resolutionState", () => {
  const contract = buildSpecExecutionContract(buildPlan(), {
    steps: [{ index: 1, action: "click", resolutionState: "certified" }],
  });
  assert.equal(contract.steps[0].resolutionState, "certified");
});

test("B/upstream resolutionState=runtime_resolution_required is transported verbatim, unchanged", () => {
  const contract = buildSpecExecutionContract(buildPlan(), {
    steps: [{ index: 1, action: "click", resolutionState: "runtime_resolution_required" }],
  });
  assert.equal(contract.steps[0].resolutionState, "runtime_resolution_required");
});

test("C/upstream resolutionState=unresolved_unrecoverable is transported verbatim, unchanged", () => {
  const contract = buildSpecExecutionContract(buildPlan(), {
    steps: [{ index: 1, action: "click", resolutionState: "unresolved_unrecoverable" }],
  });
  assert.equal(contract.steps[0].resolutionState, "unresolved_unrecoverable");
});

test("no upstream signal (field absent) never gets inferred/fabricated on the contract step", () => {
  const contract = buildSpecExecutionContract(buildPlan(), {
    steps: [{ index: 1, action: "click" }],
  });
  assert.equal(contract.steps[0].resolutionState, undefined);
});

// The exact real shapes persisted for PREVIEW-001 scenarioStepIndex=6 (portal-comercial):
// plan.steps[6].target = { strategy: "recorded:css", value: "Número de identificación", exact: false }
// executionContract.steps[5].certifiedTechnicalTarget = targetType="structural" tier=4,
//   locatorCandidates=[{strategy:"role", value:"button", confidence:0.85}],
//   structuralContext={owner:{tag:"button"}, identityAmbiguous:true, structuralIdentityMatchCount:2,
//     deterministicStructuralIdentity:false}
function buildAmbiguousButtonPlan(planTargetStrategy: string) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, externalId: "C1", title: "Scenario" },
    requiredData: [],
    steps: [{
      index: 1,
      action: "click",
      target: { strategy: planTargetStrategy, value: "Número de identificación", exact: false },
      description: "Presionar botón asociado a \"Número de identificación\"",
    }],
    createdAt: new Date().toISOString(),
  } as any;
}

const AMBIGUOUS_BUTTON_RECORDING_CANDIDATE = {
  targetType: "structural",
  locatorCandidates: [{ strategy: "role", value: "button", confidence: 0.85 }],
  structuralContext: {
    owner: { tag: "button" },
    semanticShape: ["span"],
    deterministicStructuralIdentity: false,
    identityAmbiguous: true,
    structuralIdentityMatchCount: 2,
  },
  confidence: 0.85,
  validatedByInteraction: true,
};

test("D1/validated plan carries a recorded:<strategy> marker (real PREVIEW-001 step6 shape) -- resolutionState inferred as runtime_resolution_required, no recalculation of the weaker recording evidence", () => {
  const contract = buildSpecExecutionContract(buildAmbiguousButtonPlan("recorded:css"), {
    steps: [{
      index: 1,
      action: "click",
      technicalTargetCandidates: [AMBIGUOUS_BUTTON_RECORDING_CANDIDATE],
    }],
  });
  const step = contract.steps[0];
  assert.equal(step.resolutionState, "runtime_resolution_required");
  // certifiedTechnicalTarget itself is unchanged/unrecalculated -- still the real, ambiguous tier-4 evidence.
  assert.equal(step.certifiedTechnicalTarget?.certificationTier, 4);
  assert.equal(step.certifiedTechnicalTarget?.structuralContext?.identityAmbiguous, true);
});

test("B2/validated plan target has NO recorded: marker -- resolutionState stays unset, existing behavior unchanged", () => {
  const contract = buildSpecExecutionContract(buildAmbiguousButtonPlan("css"), {
    steps: [{
      index: 1,
      action: "click",
      technicalTargetCandidates: [AMBIGUOUS_BUTTON_RECORDING_CANDIDATE],
    }],
  });
  assert.equal(contract.steps[0].resolutionState, undefined);
});

test("D2/end-to-end on the real PREVIEW-001 step6 evidence shapes: contract + deterministic compiler now represent the candidate action, still delegating physical resolution to the existing runtime", () => {
  const contract = buildSpecExecutionContract(buildAmbiguousButtonPlan("recorded:css"), {
    steps: [{
      index: 1,
      action: "click",
      technicalTargetCandidates: [AMBIGUOUS_BUTTON_RECORDING_CANDIDATE],
    }],
  });
  const result = compileDeterministicSpec(contract);

  assert.equal(result.unsupportedCapabilities.length, 0, "no longer fails closed once resolutionState signals runtime_resolution_required");
  assert.equal(result.bindings.length, 1);
  assert.equal(result.bindings[0].runtimeResolutionRequired, true);
  assert.equal(result.bindings[0].runtimeMethod, "clickPromotedTarget");
  // Physical resolution is still delegated to the SAME existing runtime (recordedLocatorFactory),
  // never a frozen/invented locator -- no ambiguous getByRole('button') built directly by the compiler.
  assert.match(result.source, /recordedLocatorFactory\(page, parseSerializedTechnicalTargetString\('role:button'\)/);
});

// Real PREVIEW-001 shapes for scenarioStepIndex=4 ("Solicitud multiproducto"): plan target
// strategy="recorded:structural-owner", technicalTargetRef="role:link|Solicitud multiproducto",
// certifiedTechnicalTarget=structural tier=1 (stableDirectAttributes href), non-ambiguous.
function buildAuthoritativeLinkPlan(planTargetStrategy: string) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, externalId: "C1", title: "Scenario" },
    requiredData: [],
    steps: [{
      index: 1,
      action: "click",
      target: { strategy: planTargetStrategy, value: "Solicitud multiproducto", exact: false },
      description: "Clic en \"Solicitud multiproducto\"",
    }],
    createdAt: new Date().toISOString(),
  } as any;
}

const TIER1_LINK_RECORDING_CANDIDATE = {
  targetType: "structural",
  locatorCandidates: [{ strategy: "css", value: '[href="/requests/create/multiproduct"]', confidence: 0.85 }],
  structuralContext: { stableDirectAttributes: { href: "/requests/create/multiproduct" } },
  confidence: 0.85,
  validatedByInteraction: true,
};

test("2/authoritative technicalTargetRef + recorded:* plan marker (real step4/step7 shape) -- must NOT be downgraded to runtime_resolution_required", () => {
  const contract = buildSpecExecutionContract(buildAuthoritativeLinkPlan("recorded:structural-owner"), {
    steps: [{
      index: 1,
      action: "click",
      technicalTargetRef: "role:link|Solicitud multiproducto",
      technicalTargetCandidates: [TIER1_LINK_RECORDING_CANDIDATE],
    }],
  });
  const step = contract.steps[0];
  assert.equal(step.resolutionState, undefined, "authoritative technicalTargetRef must prevent the recorded:* inference from firing");
  assert.equal(step.technicalTargetRef, "role:link|Solicitud multiproducto");
});

test("3/non-ambiguous certified structural target (no technicalTargetRef) + recorded:* plan marker -- must NOT be downgraded either", () => {
  const contract = buildSpecExecutionContract(buildAuthoritativeLinkPlan("recorded:structural-owner"), {
    steps: [{
      index: 1,
      action: "click",
      technicalTargetCandidates: [TIER1_LINK_RECORDING_CANDIDATE],
    }],
  });
  const step = contract.steps[0];
  assert.equal(step.resolutionState, undefined, "non-ambiguous tier-1 certified structural authority must prevent the recorded:* inference from firing");
  assert.equal(step.certifiedTechnicalTarget?.targetType, "structural");
  assert.equal(step.certifiedTechnicalTarget?.certificationTier, 1);
});

test("4/ambiguous certified structural target (no technicalTargetRef) + recorded:* plan marker -- correctly maps to runtime_resolution_required (real step6 shape)", () => {
  const contract = buildSpecExecutionContract(buildAmbiguousButtonPlan("recorded:css"), {
    steps: [{
      index: 1,
      action: "click",
      technicalTargetCandidates: [AMBIGUOUS_BUTTON_RECORDING_CANDIDATE],
    }],
  });
  assert.equal(contract.steps[0].resolutionState, "runtime_resolution_required");
});

test("5/explicit upstream resolutionState always wins over both technicalTargetRef and the recorded:* inference", () => {
  const contract = buildSpecExecutionContract(buildAuthoritativeLinkPlan("recorded:structural-owner"), {
    steps: [{
      index: 1,
      action: "click",
      resolutionState: "runtime_resolution_required",
      technicalTargetRef: "role:link|Solicitud multiproducto",
      technicalTargetCandidates: [TIER1_LINK_RECORDING_CANDIDATE],
    }],
  });
  assert.equal(contract.steps[0].resolutionState, "runtime_resolution_required");
});

test("1/real-contract-shape matrix: all 7 PREVIEW-001 action steps rebuilt in-memory report the corrected resolutionState", () => {
  const cases: Array<{ label: string; technicalTargetRef?: string; candidate?: unknown; planTargetStrategy: string; expected: "certified" | "runtime_resolution_required" | "unresolved_unrecoverable" | undefined }> = [
    { label: "step1 fill Usuario", technicalTargetRef: "role:textbox|Usuario", planTargetStrategy: "text", expected: undefined },
    { label: "step2 fill Contraseña", technicalTargetRef: "role:textbox|Contraseña", planTargetStrategy: "text", expected: undefined },
    { label: "step3 press Contraseña", technicalTargetRef: "role:textbox|Contraseña", planTargetStrategy: "text", expected: undefined },
    { label: "step4 click Solicitud multiproducto", technicalTargetRef: "role:link|Solicitud multiproducto", candidate: TIER1_LINK_RECORDING_CANDIDATE, planTargetStrategy: "recorded:structural-owner", expected: undefined },
    { label: "step5 fill Número de identificación", planTargetStrategy: "text", expected: undefined },
    { label: "step6 click Número de identificación", candidate: AMBIGUOUS_BUTTON_RECORDING_CANDIDATE, planTargetStrategy: "recorded:css", expected: "runtime_resolution_required" },
    { label: "step7 click Depurar", technicalTargetRef: "role:button|Depurar", candidate: TIER1_LINK_RECORDING_CANDIDATE, planTargetStrategy: "recorded:structural-owner", expected: undefined },
  ];
  for (const c of cases) {
    const contract = buildSpecExecutionContract(
      { ...buildAuthoritativeLinkPlan(c.planTargetStrategy), steps: [{ index: 1, action: "click", target: { strategy: c.planTargetStrategy, value: c.label }, description: c.label }] } as any,
      { steps: [{ index: 1, action: "click", ...(c.technicalTargetRef ? { technicalTargetRef: c.technicalTargetRef } : {}), ...(c.candidate ? { technicalTargetCandidates: [c.candidate] } : {}) }] } as any,
    );
    assert.equal(contract.steps[0].resolutionState, c.expected, `${c.label}: expected resolutionState=${c.expected}`);
  }
});

test("no explicit upstream resolutionState is never overridden by the validated-plan marker inference", () => {
  const contract = buildSpecExecutionContract(buildAmbiguousButtonPlan("recorded:css"), {
    steps: [{
      index: 1,
      action: "click",
      resolutionState: "unresolved_unrecoverable",
      technicalTargetCandidates: [AMBIGUOUS_BUTTON_RECORDING_CANDIDATE],
    }],
  });
  assert.equal(contract.steps[0].resolutionState, "unresolved_unrecoverable");
});
