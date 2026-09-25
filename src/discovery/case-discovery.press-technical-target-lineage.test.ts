import assert from "node:assert/strict";
import test from "node:test";
import { parseScenarioStepsForDiscovery, executePressActionTarget } from "./case-discovery";
import type { TestScenario } from "../types/testrail.types";

/**
 * FIRST_LOSS: the two fills in the reported evidence resolved via
 * `[recording-replay] technicalTargetResolved=true strategy=recorded:role` -- `resolveActionTarget`
 * checks `resolveRecordedTechnicalTarget` FIRST, before any ordinal/alias/contextual fallback, but
 * only when it is HANDED `recordedTechnicalTargets`/`recordedTechnicalTargetRefs` in its options.
 * The click/fill branches in case-discovery.ts's live execution loop already forward
 * `actionTarget.technicalTargetCandidates`/`actionTarget.technicalTargetRefs` this way -- the
 * `action_press` branch (added by an earlier ticket) never did, so a press's recorded technical
 * identity (verified present upstream: `parseScenarioStepsForDiscovery` already puts it on the
 * `ActionTargetItem`/`ExecutableStep`, tested below, unaffected by this fix) was silently dropped
 * at that ONE call site, forcing every press through ordinal/alias/contextual resolution against
 * the raw display-string target ("role:textbox|Campo") instead -- exactly matching the observed
 * `press_resolution_failed:not_found` even though the SAME owner had just resolved for a
 * preceding fill.
 *
 * Fixed by adding the same `recordedTechnicalTargets: actionTarget.technicalTargetCandidates,
 * recordedTechnicalTargetRefs: actionTarget.technicalTargetRefs` the click/fill branches already
 * pass, to the press branch's own `resolveActionTarget(...)` call
 * (`src/discovery/case-discovery.ts`, inside the `action_press` branch). The live-Playwright-page
 * runtime consumption of these options is not independently testable here (no browser allowed,
 * matching this session's established disclosure convention for this ~4000-line execution loop);
 * `resolveRecordedTechnicalTarget`'s own mode-agnostic behavior (used identically for click/fill/
 * press once handed these options) is already covered by prior tickets' tests.
 */

function scenarioWithRecordingActions(actions: Array<Record<string, unknown>>): TestScenario {
  return {
    source: "testrail",
    externalId: "external",
    caseId: 1,
    title: "scenario",
    steps: [{ index: 1, action: "placeholder", dataHints: [] }],
    recordingExecutionContract: {
      actions,
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;
}

test("1/contract+actionTarget. a press RecordingExecutionAction's technicalTargetRefs/candidates reach the ActionTargetItem exactly like fill/click do", () => {
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    {
      actionType: "fill",
      humanStep: "Ingresar",
      targetRef: "Usuario",
      technicalTargetRef: "role:textbox|Usuario",
      technicalTargetRefs: ["role:textbox|Usuario"],
      technicalTargetCandidates: [{ strategy: "role", value: "textbox|Usuario", source: "recorded_dom", confidence: 0.95 }],
      valueKey: "auth.username",
      stepIndex: 1,
    },
    {
      actionType: "press",
      key: "Enter",
      targetRef: "Contraseña",
      technicalTargetRef: "role:textbox|Contraseña",
      technicalTargetRefs: ["role:textbox|Contraseña"],
      technicalTargetCandidates: [{ strategy: "role", value: "textbox|Contraseña", source: "recorded_dom", confidence: 0.95 }],
      stepIndex: 2,
    },
  ]));

  const pressTarget = parsed.actionTargets.find((item) => item.actionType === "action_press");
  assert.ok(pressTarget, "press must produce its own action target");
  assert.equal(pressTarget!.key, "Enter");
  assert.deepEqual(pressTarget!.technicalTargetRefs, ["role:textbox|Contraseña"]);
  assert.equal((pressTarget!.technicalTargetCandidates as any)?.[0]?.value, "textbox|Contraseña");

  const pressStep = parsed.orderedSteps.find((step) => step.type === "action_press");
  assert.ok(pressStep, "press must produce its own ordered step");
  assert.deepEqual(pressStep!.technicalTargetRefs, ["role:textbox|Contraseña"]);
});

test("3/sameOwner. fill and press sharing the same recorded technical identity both carry it unchanged, never re-derived from display text", () => {
  const sharedRef = "role:textbox|Campo Compartido";
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    {
      actionType: "fill",
      humanStep: "Ingresar",
      targetRef: "Campo Compartido",
      technicalTargetRef: sharedRef,
      technicalTargetRefs: [sharedRef],
      valueKey: "campo",
      stepIndex: 1,
    },
    {
      actionType: "press",
      key: "Enter",
      targetRef: "Campo Compartido",
      technicalTargetRef: sharedRef,
      technicalTargetRefs: [sharedRef],
      stepIndex: 2,
    },
  ]));
  const fillTarget = parsed.actionTargets.find((item) => item.actionType === "action_fill");
  const pressTarget = parsed.actionTargets.find((item) => item.actionType === "action_press");
  assert.deepEqual(fillTarget!.technicalTargetRefs, [sharedRef]);
  assert.deepEqual(pressTarget!.technicalTargetRefs, [sharedRef]);
});

test("8/missingRefs. a press with NO recorded technical evidence at all still parses (falls through to existing runtime resolution rules -- not this ticket's concern to fabricate one)", () => {
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    { actionType: "press", key: "Escape", targetRef: "Cualquier Campo", stepIndex: 1 },
  ]));
  const pressTarget = parsed.actionTargets.find((item) => item.actionType === "action_press");
  assert.ok(pressTarget);
  assert.equal(pressTarget!.technicalTargetRefs, undefined);
});

test("11/noClick. a press action target is never tagged action_click regardless of technical target lineage", () => {
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    {
      actionType: "press",
      key: "Enter",
      targetRef: "Campo",
      technicalTargetRef: "role:textbox|Campo",
      technicalTargetRefs: ["role:textbox|Campo"],
      stepIndex: 1,
    },
  ]));
  assert.equal(parsed.actionTargets[0].actionType, "action_press");
  assert.notEqual(parsed.actionTargets[0].actionType, "action_click");
});

test("9/10. executePressActionTarget's own fail-closed decision seam is unaffected by this fix (regression)", async () => {
  const resolved = await executePressActionTarget("Enter", { status: "resolved", locator: { press: async () => {} } });
  assert.equal(resolved.ok, true);
  const unresolved = await executePressActionTarget("Enter", { status: "not_found" });
  assert.equal(unresolved.ok, false);
});

test("14/generic. no app/project/label hardcode: the lineage mechanism generalizes to an arbitrary field/key pair", () => {
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    {
      actionType: "press",
      key: "Tab",
      targetRef: "Cualquier Campo Genérico",
      technicalTargetRef: "id:cualquier-id-generico",
      technicalTargetRefs: ["id:cualquier-id-generico"],
      technicalTargetCandidates: [{ strategy: "id", value: "cualquier-id-generico", source: "recorded_dom", confidence: 0.9 }],
      stepIndex: 1,
    },
  ]));
  const pressTarget = parsed.actionTargets.find((item) => item.actionType === "action_press");
  assert.equal(pressTarget!.key, "Tab");
  assert.deepEqual(pressTarget!.technicalTargetRefs, ["id:cualquier-id-generico"]);
});
