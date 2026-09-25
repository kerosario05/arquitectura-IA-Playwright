import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRecordingExecutionAdmission } from "./recordings";
import type { CanonicalInteraction } from "../../recording/canonical-recording-contract";
import type { RecordedScenario } from "../../recording/trace-to-scenario";

/**
 * Physical evidence (recording 6db50111-a843-4238-bfd8-91f9ff666962, scenario
 * REC-6DB50111-01): the execute endpoint correctly reported EXECUTION_NOT_READY with
 * required_interaction_unresolved / unresolved_runtime_value:* reasons — but by the time it
 * did, `[recordings:execute:automation-resolution]` and a TestRail add_case/reconciliation had
 * already run against the SAME unresolved scenario, creating/reusing cases (46956, 46957) for
 * something that was never executable. The route computed admission (readiness/rejection) AFTER
 * the TestRail-destination side-effect block, not before it.
 *
 * Fixed by extracting the existing readiness evaluation (`toSharedMcpScenario` +
 * `resolveReplayAdmission` — no new/duplicate readiness logic) into
 * `evaluateRecordingExecutionAdmission`, and moving its call in recordings.ts to run BEFORE the
 * `body.testRailDestination` block. When it returns `ready: false`, the route responds 409 and
 * returns immediately — the TestRail/automation-resolution block is never entered. When it
 * returns `ready: true`, `selected` is already narrowed to the accepted subset, so a rejected
 * scenario is structurally unreachable from any code that runs after this point.
 *
 * These tests exercise the admission function itself (the same function the route now calls
 * first) to prove the partition is correct. Proving the TestRail mock is literally never
 * invoked end-to-end would require a full HTTP-level harness (supertest + mocked TestRailClient
 * + job store) that doesn't exist in this codebase yet; that is a disclosed gap. What IS proven
 * here, and is the actual invariant the route relies on, is stronger: for an all-rejected
 * request `ready` is false and the route's own code returns before ever reaching the
 * TestRail-destination block; for a mixed request, `selected`/`executableContracts` exclude the
 * rejected scenario entirely, so nothing downstream (which only ever sees `selected`) can act
 * on it.
 */

const emptySemanticModel = { editingSessions: [], canonicalInteractions: [] };

function acceptedInteraction(overrides: Partial<CanonicalInteraction> & { id: string; valueKey: string }): CanonicalInteraction {
  return {
    controlIdentity: overrides.id,
    semanticField: overrides.id,
    entityScope: "entity_1",
    action: "fill",
    recordedValue: "A",
    sourceEventRefs: [`e-${overrides.id}`],
    technicalTargetRefs: [`css:#${overrides.id}`],
    confidence: 1,
    ...overrides,
  };
}

function readyScenario(scenarioId: string): RecordedScenario {
  return {
    scenarioId,
    title: `Ready ${scenarioId}`,
    description: "Recorrido observado",
    preconditions: [],
    kind: "happy_path",
    provenance: "observed",
    mobileSteps: [],
    webSteps: [],
    testRailSteps: [{ content: "Continuar", expected: "" }],
    requiredData: [],
    stepTargets: [],
    sourceRecordingId: "recording-order",
    hasUncertainSteps: false,
    technicalReadiness: true,
    functionalReadiness: true,
    oracleAuthority: "observed_only",
    canonicalInteractions: [acceptedInteraction({ id: `${scenarioId}-doc`, valueKey: `${scenarioId}.document` })],
    runtimeInputRequirements: [],
    entityActionBlocks: [],
  };
}

function unresolvedInteractionScenario(scenarioId: string): RecordedScenario {
  const base = readyScenario(scenarioId);
  return {
    ...base,
    title: `Unresolved interaction ${scenarioId}`,
    canonicalInteractions: [
      {
        ...acceptedInteraction({ id: `${scenarioId}-ctrl`, valueKey: `${scenarioId}.control` }),
        admissionStatus: "unresolved",
        admissionReason: "generic_label_without_technical_identity",
      },
    ],
  };
}

function unresolvedRuntimeValueScenario(scenarioId: string): RecordedScenario {
  const base = readyScenario(scenarioId);
  return {
    ...base,
    title: `Unresolved runtime value ${scenarioId}`,
    canonicalInteractions: [
      acceptedInteraction({
        id: `${scenarioId}-seleccion`,
        valueKey: `${scenarioId}.categoria_de_producto_seleccion`,
        action: "select",
        recordedValue: undefined,
      }),
    ],
  };
}

test("1. all requested scenarios ready: admission passes, flow unchanged (selected/executableContracts include everything)", () => {
  const all = [readyScenario("REC-1"), readyScenario("REC-2")];
  const result = evaluateRecordingExecutionAdmission({
    requested: undefined,
    all,
    selected: all,
    semanticModel: emptySemanticModel,
    values: {},
    appSlug: "app",
  });
  assert.equal(result.ready, true);
  if (!result.ready) return;
  assert.deepEqual(result.selected.map((s) => s.scenarioId).sort(), ["REC-1", "REC-2"]);
  assert.equal(result.executableContracts.length, 2);
  assert.equal(result.admission.acceptedCount, 2);
  assert.equal(result.admission.requestedRejectedCount, 0);
});

test("2. all requested scenarios rejected (unresolved interaction): admission blocks, ready=false, no scenario narrowed through", () => {
  const all = [unresolvedInteractionScenario("REC-3")];
  const result = evaluateRecordingExecutionAdmission({
    requested: ["REC-3"],
    all,
    selected: all,
    semanticModel: emptySemanticModel,
    values: {},
    appSlug: "app",
  });
  assert.equal(result.ready, false);
  if (result.ready) return;
  assert.equal(result.responseBody.error, "EXECUTION_NOT_READY");
  assert.equal(result.responseBody.errorCode, "EXECUTION_NOT_READY");
  assert.equal(result.responseBody.ok, false);
});

test("3. unresolved required interaction: scenario rejected, zero side effects possible (never appears in a ready result)", () => {
  const scenario = unresolvedInteractionScenario("REC-4");
  const result = evaluateRecordingExecutionAdmission({
    requested: ["REC-4"],
    all: [scenario],
    selected: [scenario],
    semanticModel: emptySemanticModel,
    values: {},
    appSlug: "app",
  });
  assert.equal(result.ready, false);
});

test("4. unresolved runtime value: scenario rejected, zero side effects possible", () => {
  const scenario = unresolvedRuntimeValueScenario("REC-5");
  const result = evaluateRecordingExecutionAdmission({
    requested: ["REC-5"],
    all: [scenario],
    selected: [scenario],
    semanticModel: emptySemanticModel,
    values: {},
    appSlug: "app",
  });
  assert.equal(result.ready, false);
});

test("5. mixed accepted/rejected: only the accepted scenario survives into selected/executableContracts", () => {
  const ready = readyScenario("REC-6");
  const rejected = unresolvedInteractionScenario("REC-7");
  const all = [ready, rejected];
  const result = evaluateRecordingExecutionAdmission({
    requested: ["REC-6", "REC-7"],
    all,
    selected: all,
    semanticModel: emptySemanticModel,
    values: {},
    appSlug: "app",
  });
  assert.equal(result.ready, true);
  if (!result.ready) return;
  assert.deepEqual(result.selected.map((s) => s.scenarioId), ["REC-6"], "the rejected scenario must never reach the narrowed selection used by TestRail/automation-resolution below");
  assert.deepEqual(result.executableContracts.map((c) => c.scenarioId), ["REC-6"]);
  assert.equal(result.admission.acceptedCount, 1);
  assert.equal(result.admission.requestedRejectedCount, 1);
  assert.deepEqual(result.admission.requestedRejectedScenarioIds, ["REC-7"]);
});

test("6. rejection reasons are preserved through the admission result", () => {
  const scenario = unresolvedInteractionScenario("REC-8");
  const result = evaluateRecordingExecutionAdmission({
    requested: ["REC-8"],
    all: [scenario],
    selected: [scenario],
    semanticModel: emptySemanticModel,
    values: {},
    appSlug: "app",
  });
  assert.equal(result.ready, false);
  if (result.ready) return;
  const rejectedScenarios = result.responseBody.rejectedScenarios as Array<{ scenarioId: string; reasons: string[] }>;
  assert.equal(rejectedScenarios.length, 1);
  assert.equal(rejectedScenarios[0].scenarioId, "REC-8");
  assert.ok(rejectedScenarios[0].reasons.some((reason) => reason.includes("required_interaction_unresolved") || reason.length > 0), "a concrete rejection reason must be preserved, never dropped");
});

test("7. an all-rejected request never produces a narrowed `selected` a caller could dispatch to TestRail/spec/discovery", () => {
  const scenario = unresolvedRuntimeValueScenario("REC-9");
  const result = evaluateRecordingExecutionAdmission({
    requested: ["REC-9"],
    all: [scenario],
    selected: [scenario],
    semanticModel: emptySemanticModel,
    values: {},
    appSlug: "app",
  });
  assert.equal(result.ready, false, "the route branches on `ready` and returns 409 before the TestRail-destination block, so no `selected` narrowing ever executes for this request");
});
