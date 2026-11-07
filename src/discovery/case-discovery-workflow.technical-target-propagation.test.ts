import assert from "node:assert/strict";
import test from "node:test";
import { buildPromotionSourceScenario } from "./case-discovery-workflow";
import { buildSpecExecutionContract } from "../automations/spec-execution-contract";
import { compileDeterministicSpec } from "../automations/spec-compiler/deterministic-spec-compiler";
import type { CaseDiscoveryResult } from "../types/discovery.types";
import type { TestScenario } from "../types/testrail.types";

/**
 * Regression coverage for the physical first-loss-boundary found in the real
 * ce1cc899-8511-47af-8e7a-336543f4f37f run (REC-BC075766 / "Consulta Tarjeta"): the recording's
 * technicalTargetCandidates were present all the way through preview-scenarios.json and the
 * loaded TestScenario, but buildPromotionSourceScenario's own scenarioSteps mapping (the
 * function that builds the persisted plan.json `sourceScenario`) silently dropped
 * technicalTargetRef/technicalTargetRefs/technicalTargetCandidates — forcing every step through
 * the weaker Discovery PlanTarget path regardless of recordingReplay=true.
 *
 * These tests chain the REAL two functions the physical pipeline calls
 * (buildPromotionSourceScenario -> buildSpecExecutionContract) with synthetic, hermetic
 * fixtures — not the real (and previously observed to be live/mutable) kiosko artifacts.
 */

const LONG_LABEL =
  "Tarjeta Crédito Visa Clásica Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Pagos en línea con disponibilidad inmediata.";

function buildCaseResult(overrides: Partial<CaseDiscoveryResult> = {}): CaseDiscoveryResult {
  return {
    version: "1.0",
    caseId: 0,
    caseTitle: "Consulta Tarjeta",
    discoveredAt: new Date().toISOString(),
    status: "discovered_passed",
    steps: [],
    discoveredObjects: [],
    ...overrides,
  };
}

function step4TechnicalTargetCandidates(): Array<Record<string, unknown>> {
  return [{
    targetType: "display",
    semanticRole: "display",
    locatorCandidates: [{ strategy: "role", value: `div|${LONG_LABEL}`, confidence: 0.85 }],
    structuralContext: {
      owner: { tag: "div" },
      stableDescendants: [
        { relation: "descendant", tag: "img", stableAttributes: { alt: "Tarjeta Crédito Visa Clásica", src: "/assets/images/tarjetas-de-credito-visa-clasica.png" } },
      ],
      semanticShape: ["div", "h3"],
      stableDirectAttributes: {},
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
    },
    stableAttributes: {},
    interactionEvidence: ["click", LONG_LABEL],
    confidence: 0.45,
    validatedByInteraction: true,
  }];
}

function buildRecordingScenario(): TestScenario {
  return {
    source: "jira",
    externalId: "REC-BC075766-01",
    caseId: 0,
    title: "Consulta Tarjeta",
    recordingId: "bc075766-708b-4862-a207-0e6c8d07fad5",
    recordedScenarioId: "REC-BC075766-01",
    steps: [
      {
        index: 4,
        action: `Presionar "${LONG_LABEL}"`,
        dataHints: [],
        technicalTargetRefs: [`role:div|${LONG_LABEL}`],
        technicalTargetCandidates: step4TechnicalTargetCandidates(),
      } as TestScenario["steps"][number],
    ],
  };
}

function buildPlan(target: unknown) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "jira", caseId: 0, externalId: "REC-BC075766-01", title: "Consulta Tarjeta" },
    requiredData: [],
    steps: [{ index: 4, action: "click", target, description: "Clic en tarjeta" }],
    createdAt: new Date().toISOString(),
  } as any;
}

// CASE 1 / CASE 5: recording technical evidence survives buildPromotionSourceScenario ->
// buildSpecExecutionContract for the real bug's exact Step 4 shape.
test("recordingPropagationPhysicalShapeTest / step4StructuralContractTest (CASE 1, CASE 5): recording structuralContext survives buildPromotionSourceScenario into the execution contract", () => {
  const scenario = buildRecordingScenario();
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());

  const propagatedStep = sourceScenario.steps?.find((s) => s.index === 4);
  assert.ok(propagatedStep, "step 4 must survive buildPromotionSourceScenario");
  assert.ok(
    (propagatedStep as any).technicalTargetCandidates?.length,
    "technicalTargetCandidates must not be dropped by buildPromotionSourceScenario",
  );

  const contract = buildSpecExecutionContract(
    buildPlan({ strategy: "recorded:structural-owner", value: LONG_LABEL }),
    sourceScenario,
  );
  const step = contract.steps.find((s) => s.scenarioStepIndex === 4);
  assert.ok(step, "contract must contain scenarioStepIndex 4");
  assert.ok(step!.certifiedTechnicalTarget, "step 4 must be certified — this is the physical fix");
  assert.equal(step!.certifiedTechnicalTarget!.certifiedFrom, "recording");
  assert.equal(step!.certifiedTechnicalTarget!.structuralContext?.owner?.tag, "div");
  assert.deepEqual(step!.certifiedTechnicalTarget!.structuralContext?.semanticShape, ["div", "h3"]);
  // Never the long display label used as the primary locator value.
  assert.ok(!step!.certifiedTechnicalTarget!.locatorCandidates[0].value.includes(LONG_LABEL));
});

// CASE 2: when a step carries BOTH recording technicalTargetCandidates AND a Discovery
// PlanTarget text fallback, recording authority must win — never degraded to PlanTarget text.
test("recordingBeatsTextPlanTest (CASE 2): recording evidence wins over a Discovery text PlanTarget on the same step", () => {
  const scenario = buildRecordingScenario();
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const contract = buildSpecExecutionContract(
    // The plan's own target is a plain, non-recording text strategy — the weaker fallback.
    buildPlan({ strategy: "text", value: LONG_LABEL }),
    sourceScenario,
  );
  const step = contract.steps.find((s) => s.scenarioStepIndex === 4);
  assert.ok(step?.certifiedTechnicalTarget);
  assert.equal(step!.certifiedTechnicalTarget!.certifiedFrom, "recording", "recording authority must not be discarded in favor of the discovery PlanTarget");
});

test("recording action lineage is matched by semantic step identity when scenario and plan indices differ", () => {
  const scenario = buildRecordingScenario();
  scenario.steps = [{
    index: 19,
    action: `Presionar "${LONG_LABEL}"`,
    dataHints: [],
  }];
  scenario.recordingExecutionContract = {
    actions: [{
      actionType: "click",
      humanStep: `Presionar "${LONG_LABEL}"`,
      semanticField: LONG_LABEL,
      technicalTargetRef: `role:div|${LONG_LABEL}`,
      technicalTargetRefs: [`role:div|${LONG_LABEL}`],
      technicalTargetCandidates: step4TechnicalTargetCandidates(),
      associatedField: LONG_LABEL,
    }],
    runtimeInputRequirements: [],
  };

  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const propagated = sourceScenario.steps?.find((candidate) => candidate.index === 19) as any;
  assert.equal(propagated.technicalTargetRef, `role:div|${LONG_LABEL}`);
  assert.equal(propagated.associatedField, LONG_LABEL);
  assert.ok(propagated.technicalTargetCandidates?.length);

  const contract = buildSpecExecutionContract(buildPlan({ strategy: "text", value: LONG_LABEL }), sourceScenario);
  const contractStep = contract.steps.find((candidate) => candidate.scenarioStepIndex === 19);
  assert.equal(contractStep?.technicalTargetRef, `role:div|${LONG_LABEL}`);
  assert.ok(contractStep?.certifiedTechnicalTarget, "recording candidate remains available to the shared target materializer");
});

test("a same-field recording option is not attached to a different authored selection value", () => {
  const action = 'Seleccionar "Mediana Empresa Zona Francas" en "Tipo de cliente"';
  const scenario = { ...buildRecordingScenario(), steps: [{ index: 18, action, dataHints: [], controlIdentity: "field:tipo" }] } as any;
  const recordedCelularCandidate = {
    targetType: "structural",
    locatorCandidates: [{ strategy: "css", value: "#recorded-phone-option", confidence: 0.85 }],
    structuralContext: {
      owner: { tag: "li", role: "option" },
      stableDirectAttributes: { "aria-label": "Celular", id: "recorded-phone-option", role: "option" },
      stableDescendants: [],
      semanticShape: ["span"],
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
      scopeIdentity: { strategy: "id", value: "recorded-phone-list" },
    },
    confidence: 0.85,
    validatedByInteraction: true,
  };
  scenario.recordingExecutionContract = {
    actions: [{
      actionType: "click",
      controlIdentity: "field:tipo",
      semanticField: "Tipo",
      valueKey: "celular",
      technicalTargetRef: "role:option|Celular",
      technicalTargetRefs: ["role:option|Celular", "css:#recorded-phone-option", "id:recorded-phone-option"],
      technicalTargetCandidates: [recordedCelularCandidate],
      playwrightRecorderEvidence: {
        kind: "role",
        role: "option",
        normalizedName: "Celular",
        targetTag: "li",
        runtimeResolutionRequired: true,
      },
    }],
    runtimeInputRequirements: [],
  };

  const discoveredMedianaCandidate = {
    targetType: "structural",
    certificationTier: 1,
    certifiedFrom: "discovery",
    locatorCandidates: [{ strategy: "css", value: '[data-testid="customer-type-mediana"]', confidence: 0.95 }],
    structuralContext: {
      owner: { tag: "li", role: "option" },
      stableDirectAttributes: { "data-testid": "customer-type-mediana", role: "option" },
      stableDescendants: [],
      semanticShape: ["span"],
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
    },
    confidence: 0.95,
    validatedByInteraction: true,
  };
  const discoveryResult = buildCaseResult({
    steps: [{ index: 18, action, status: "found", technicalTargetCandidates: [discoveredMedianaCandidate] } as any],
  });
  for (const appSlug of ["portal-comercial", "web-test"]) {
    const source = buildPromotionSourceScenario({ ...scenario, appSlug } as any, discoveryResult);
    const sourceStep = source.steps?.find((step) => step.index === 18) as any;
    assert.ok(sourceStep, `${appSlug}: the authored selection must survive promotion-source construction`);
    assert.deepEqual(
      sourceStep.technicalTargetCandidates,
      [{ ...discoveredMedianaCandidate, reconfirmedByDiscovery: true }],
      `${appSlug}: the recorded Celular option must not shadow the distinct value that Discovery actually selected`,
    );

    const plan = {
      ...buildPlan({ strategy: "selection_option_causal_surface", value: "Mediana Empresa Zona Francas" }),
      scenario: { ...buildPlan({ strategy: "selection_option_causal_surface", value: "Mediana Empresa Zona Francas" }).scenario, appSlug },
      steps: [{
        index: 18,
        action: "click",
        description: action,
        target: { strategy: "selection_option_causal_surface", value: "Mediana Empresa Zona Francas" },
      }],
    } as any;
    const contract = buildSpecExecutionContract(plan, source);
    const contractStep = contract.steps.find((step) => step.scenarioStepIndex === 18);
    assert.ok(contractStep?.certifiedTechnicalTarget, `${appSlug}: Discovery should provide the current option authority`);
    assert.equal(contractStep!.certifiedTechnicalTarget!.certifiedFrom, "discovery");
    assert.ok(!contractStep!.technicalTargetRefs?.some((ref) => ref.includes("recorded-phone-option")));
    const compiled = compileDeterministicSpec(contract, {
      targetSpecPath: `${process.cwd()}/automations/apps/${appSlug}/cases/selection/case.spec.ts`,
    });
    assert.deepEqual(compiled.unsupportedCapabilities, []);
    assert.ok(!compiled.source.includes("recorded-phone-option"));
    assert.ok(compiled.source.includes("customer-type-mediana"));
  }

  const matchingScenario = {
    ...scenario,
    steps: [{ index: 18, action: 'Seleccionar "Celular" en "Tipo"', dataHints: [], controlIdentity: "field:tipo" }],
  };
  const matchingSource = buildPromotionSourceScenario(matchingScenario, buildCaseResult());
  const matchingStep = matchingSource.steps?.find((step) => step.index === 18) as any;
  assert.deepEqual(
    matchingStep.technicalTargetCandidates,
    [recordedCelularCandidate],
    "an observed recorded option remains reusable when it matches the authored selection value",
  );
});

test("repeated recording labels keep each occurrence's own technical target over stale projected refs", () => {
  const makeButtonCandidate = (id: string) => [{
    targetType: "structural",
    locatorCandidates: [{ strategy: "css", value: `#${id}`, confidence: 0.9 }],
    structuralContext: {
      owner: { tag: "button" },
      stableDirectAttributes: { id },
      stableDescendants: [],
      semanticShape: ["span"],
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
      captureTargetMatchCount: 1,
    },
    confidence: 0.9,
    validatedByInteraction: true,
  }];
  const scenario = buildRecordingScenario();
  scenario.steps = [
    {
      index: 6,
      action: 'Presionar "Continuar"',
      dataHints: [],
      technicalTargetRefs: ["role:button|Continuar", "css:#continue-second", "id:continue-second"],
      technicalTargetCandidates: makeButtonCandidate("continue-second"),
    },
    {
      index: 7,
      action: 'Presionar "Continuar"',
      dataHints: [],
      technicalTargetRefs: ["role:button|Continuar", "css:#continue-second", "id:continue-second"],
      technicalTargetCandidates: makeButtonCandidate("continue-second"),
    },
  ];
  scenario.recordingExecutionContract = {
    actions: [
      {
        actionType: "click",
        humanStep: 'Presionar "Continuar"',
        stepIndex: 5,
        technicalTargetRef: "role:button|Continuar",
        technicalTargetRefs: ["role:button|Continuar", "css:#continue-first", "id:continue-first"],
        technicalTargetCandidates: makeButtonCandidate("continue-first"),
      },
      {
        actionType: "click",
        humanStep: 'Presionar "Continuar"',
        stepIndex: 6,
        technicalTargetRef: "role:button|Continuar",
        technicalTargetRefs: ["role:button|Continuar", "css:#continue-second", "id:continue-second"],
        technicalTargetCandidates: makeButtonCandidate("continue-second"),
      },
    ],
    runtimeInputRequirements: [],
  };

  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const firstStep = sourceScenario.steps?.find((step) => step.index === 6)!;
  const secondStep = sourceScenario.steps?.find((step) => step.index === 7)!;
  assert.equal((firstStep.technicalTargetCandidates?.[0]?.structuralContext as any)?.stableDirectAttributes.id, "continue-first");
  assert.equal((secondStep.technicalTargetCandidates?.[0]?.structuralContext as any)?.stableDirectAttributes.id, "continue-second");

  const contract = buildSpecExecutionContract({
    ...buildPlan({ strategy: "text", value: "Continuar" }),
    steps: [6, 7].map((index) => ({
      index,
      action: "click",
      target: { strategy: "text", value: "Continuar" },
      description: 'Presionar "Continuar"',
    })),
  } as any, sourceScenario);
  assert.deepEqual(
    contract.steps.map((step) => step.certifiedTechnicalTarget?.structuralContext?.stableDirectAttributes?.id),
    ["continue-first", "continue-second"],
    "the persisted execution contract must retain each repeated label's own recorded target",
  );
});

test("terminal feedback promotion does not require a trailing narrative success message", () => {
  const scenario = buildRecordingScenario();
  scenario.steps = [
    { index: 19, action: 'Presionar "Generar Turno"', dataHints: [] },
    { index: 20, action: 'El sistema muestra "¡Hola!"', dataHints: [] },
  ];
  scenario.raw = { custom_expected: 'Se muestra "¡Hola!"' } as any;
  scenario.recordingExecutionContract = {
    actions: [{ actionType: "click", humanStep: 'Presionar "Generar Turno"', semanticField: "Generar Turno" }],
    runtimeInputRequirements: [],
  };
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult({
    steps: [
      { index: 19, action: 'Presionar "Generar Turno"', targetText: "Generar Turno", status: "found", assertionDiagnostics: { postActionSyncSignal: "terminal_feedback" } } as any,
      { index: 20, action: 'El sistema muestra "¡Hola!"', targetText: 'El sistema muestra "¡Hola!"', status: "found" } as any,
    ],
  }));

  assert.deepEqual(sourceScenario.observedAssertions, []);
  assert.equal(sourceScenario.expectedResult, undefined);
  assert.equal(sourceScenario.steps?.find((candidate) => candidate.index === 20)?.assertionImportance, "contextual");

  const contract = buildSpecExecutionContract({
    ...buildPlan({ strategy: "text", value: "Generar Turno" }),
    steps: [
      { index: 19, action: "click", target: { strategy: "text", value: "Generar Turno" }, description: 'Presionar "Generar Turno"' },
      { index: 20, action: "assert", target: { strategy: "text", value: "¡Hola!" }, description: 'El sistema muestra "¡Hola!"' },
    ],
  } as any, sourceScenario);
  const narrativeOutcome = contract.steps.find((candidate) => candidate.scenarioStepIndex === 20);
  assert.equal(narrativeOutcome?.required, false);
  assert.equal(narrativeOutcome?.executionStatus, "contextual_unresolved");
});

test("a successful click keeps its reconfirmed scoped target when captured identity was explicitly nondeterministic", () => {
  const scenario = { ...buildRecordingScenario(), steps: [{ index: 7, action: 'Presionar botón asociado a "Identificación"', dataHints: [] }] } as any;
  const weak = { targetType: "structural", locatorCandidates: [], validatedByInteraction: true,
    structuralContext: { owner: { tag: "button" }, deterministicStructuralIdentity: false, structuralIdentityMatchCount: 1 } };
  scenario.recordingExecutionContract = { actions: [{ actionType: "click", humanStep: scenario.steps[0].action, associatedField: "Identificación", technicalTargetCandidates: [weak] }], runtimeInputRequirements: [] };
  const reconfirmed = { targetType: "structural", certificationTier: 1, certifiedFrom: "discovery", validatedByInteraction: true,
    locatorCandidates: [{ strategy: "css", value: '[data-testid="identity-lookup"]' }],
    structuralContext: { owner: { tag: "button" }, stableDirectAttributes: { "data-testid": "identity-lookup" }, deterministicStructuralIdentity: true, structuralIdentityMatchCount: 1 } };
  const result = buildCaseResult({ steps: [{ index: 7, action: scenario.steps[0].action, status: "found", technicalTargetCandidates: [reconfirmed] } as any] });
  const source = buildPromotionSourceScenario(scenario, result);
  assert.deepEqual(source.steps?.[0].technicalTargetCandidates?.[0], { ...reconfirmed, reconfirmedByDiscovery: true });
  const contract = buildSpecExecutionContract({ ...buildPlan({ strategy: "recorded:css", value: "Identificación" }), steps: [{ index: 1, action: "click", description: scenario.steps[0].action, target: { strategy: "recorded:css", value: "Identificación" } }] } as any, source);
  assert.equal(contract.steps[0].certifiedTechnicalTarget?.structuralContext?.stableDirectAttributes?.["data-testid"], "identity-lookup");
  const compiled = compileDeterministicSpec(contract, { targetSpecPath: `${process.cwd()}/automations/apps/demo/cases/lookup/case.spec.ts` });
  assert.deepEqual(compiled.unsupportedCapabilities, []);
  const failedSource = buildPromotionSourceScenario(scenario, buildCaseResult({steps:[{index:7,action:scenario.steps[0].action,status:"not_found",technicalTargetCandidates:[reconfirmed]} as any]}));
  assert.deepEqual(failedSource.steps?.[0].technicalTargetCandidates?.[0], weak);
  const unrelated = buildPromotionSourceScenario(scenario, buildCaseResult({steps:[{index:7,action:'Presionar "Otro control"',status:"found",technicalTargetCandidates:[reconfirmed]} as any]}));
  assert.deepEqual(unrelated.steps?.[0].technicalTargetCandidates?.[0], weak);
});

test("a successful exact Discovery interaction outranks a deterministic recorded owner with no executable locator", () => {
  const action = 'Presionar botón asociado a "¿No posee correo electrónico?"';
  const scenario = { ...buildRecordingScenario(), steps: [{ index: 11, action, dataHints: [] }] } as any;
  const recordedOwnerWithoutLocator = {
    targetType: "structural",
    locatorCandidates: [],
    validatedByInteraction: true,
    structuralContext: {
      owner: { tag: "input", role: "switch" },
      stableDirectAttributes: { role: "switch" },
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
    },
  };
  scenario.recordingExecutionContract = {
    actions: [{
      actionType: "click",
      stepIndex: 11,
      humanStep: action,
      associatedField: "¿No posee correo electrónico?",
      technicalTargetCandidates: [recordedOwnerWithoutLocator],
    }],
    runtimeInputRequirements: [],
  };

  const reconfirmed = {
    targetType: "structural",
    certificationTier: 3,
    certifiedFrom: "discovery",
    validatedByInteraction: true,
    locatorCandidates: [{
      strategy: "css",
      value: 'section.qa-field:has(> span) input[type="checkbox"][role="switch"]',
    }],
    structuralContext: {
      owner: { tag: "div" },
      stableDescendants: [{ relation: "descendant", tag: "input", role: "switch", stableAttributes: {} }],
    },
  };
  const successfulResult = buildCaseResult({
    steps: [{ index: 11, action, status: "found", technicalTargetCandidates: [reconfirmed] } as any],
  });
  const source = buildPromotionSourceScenario(scenario, successfulResult);
  const propagatedStep = source.steps?.find((step) => step.index === 11) as any;
  assert.deepEqual(propagatedStep.technicalTargetCandidates[0], { ...reconfirmed, reconfirmedByDiscovery: true });
  assert.deepEqual(propagatedStep.technicalTargetCandidates[1], recordedOwnerWithoutLocator);

  const plan = {
    ...buildPlan({ strategy: "snapshot:unique_checkable_control_in_caption_scope", value: "¿No posee correo electrónico?" }),
    steps: [{
      index: 11,
      action: "click",
      description: action,
      target: { strategy: "snapshot:unique_checkable_control_in_caption_scope", value: "¿No posee correo electrónico?" },
    }],
  } as any;
  const contract = buildSpecExecutionContract(plan, source);
  const contractStep = contract.steps.find((step) => step.scenarioStepIndex === 11);
  assert.equal(contractStep?.certifiedTechnicalTarget?.certificationTier, 3);
  assert.equal(contractStep?.checkableCaptionOwner, true);
  const compiled = compileDeterministicSpec(contract, {
    targetSpecPath: `${process.cwd()}/automations/apps/demo/cases/checkable/case.spec.ts`,
  });
  assert.deepEqual(compiled.unsupportedCapabilities, []);
  assert.equal(compiled.bindings[0]?.targetRef, `label:¿No posee correo electrónico?`);
  assert.match(compiled.source, /checkableCaptionOwner: true/);
  assert.doesNotMatch(compiled.source, /section\.qa-field/);

  const failed = buildPromotionSourceScenario(scenario, buildCaseResult({
    steps: [{ index: 11, action, status: "not_found", technicalTargetCandidates: [reconfirmed] } as any],
  }));
  assert.deepEqual((failed.steps?.[0] as any).technicalTargetCandidates[0], recordedOwnerWithoutLocator);
  const mismatched = buildPromotionSourceScenario(scenario, buildCaseResult({
    steps: [{ index: 11, action: 'Presionar "Otro control"', status: "found", technicalTargetCandidates: [reconfirmed] } as any],
  }));
  assert.deepEqual((mismatched.steps?.[0] as any).technicalTargetCandidates[0], recordedOwnerWithoutLocator);
});
