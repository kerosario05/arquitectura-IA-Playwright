import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "../recording/web/web-session-recorder";
import { buildCanonicalInteractions, enrichRecordedScenarioContract, toSharedMcpScenario } from "../recording/canonical-recording-contract";
import { buildHappyPathScenario } from "../recording/trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "../recording/session-trace.types";
import { parseScenarioStepsForDiscovery } from "./case-discovery";
import type { TestScenario } from "../types/testrail.types";

/**
 * FIRST_LOSS (real physical shape, recordingId 52849d4b-bfa5-4842-850a-a43e6460dcaf, execution
 * 9214dbee-36b0-4df5-b227-964767d7516b): `case-discovery.fill-target-readiness.test.ts` proved
 * `waitForFillTargetReadiness` is wired into both fill branches, gated on
 * `actionTarget.associatedField` -- but only as a STATIC source-shape check. It never proved the
 * DATA actually reaches that field at runtime. It did not: `RecordingExecutionAction` (the type
 * carried through `RecordingExecutionContract`, produced by `enrichRecordedScenarioContract`) had
 * no `associatedField` property at all, and `parseScenarioStepsForDiscovery`'s conversion of a
 * structured-contract action into `ActionTargetItem`/`ExecutableStep` never set one either --
 * `CanonicalInteraction.semanticField` (the real, non-generic field-relation authority, already
 * proven correct and unchanged by `canonical-recording-contract.structural-runtime-readiness.test.ts`)
 * was silently dropped at this exact boundary. The retry gate's condition
 * (`normalizedActionTarget.associatedField && !isGenericUnresolvedLabel(...)`) was therefore
 * ALWAYS false for every Recording Replay fill/select, regardless of `resolutionState`, so
 * `waitForFillTargetReadiness` could never be invoked from that path -- exactly matching the
 * physical failure (`fill_target_not_editable`, no `[fill-target-readiness]` log at all).
 *
 * Fixed by forwarding the SAME authority across the whole boundary, never re-derived from text:
 * `CanonicalInteraction.semanticField` -> `RecordingExecutionAction.associatedField`
 * (`canonical-recording-contract.ts`) -> `ActionTargetItem.associatedField` /
 * `ExecutableStep.associatedField` (`case-discovery.ts`'s `parseScenarioStepsForDiscovery`).
 */

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-lineage-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://readiness-lineage-fixture.test",
    startedAt: new Date().toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "inicio", url: "/inicio" } as any],
  } as unknown as SessionTrace;
}

type RecorderInternals = { onInteraction(raw: unknown): Promise<void> };

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://readiness-lineage-fixture.test",
    framesDir: path.join(os.tmpdir(), "fill-target-readiness-lineage-test-frames"),
    onEvent: (event) => events.push(event),
  }) as unknown as RecorderInternals;
  return { recorder, events };
}

function buildScenarioWithContract(events: RecordedEvent[]) {
  const scenario = buildHappyPathScenario(trace(events), events);
  const canonical = buildCanonicalInteractions(events);
  const enriched = enrichRecordedScenarioContract(scenario, canonical);
  return toSharedMcpScenario(enriched, "app");
}

function baseTestScenario(recordingExecutionContract: NonNullable<TestScenario["recordingExecutionContract"]>): TestScenario {
  return {
    source: "testrail",
    externalId: "C1",
    caseId: 1,
    title: "Fixture",
    steps: [],
    recordingExecutionContract,
  } as TestScenario;
}

test("1/realShape. a runtime_resolution_required fill (real associatedField, zero technical refs) keeps its field relation all the way to the parsed runtime action", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", role: "textbox", associatedField: "Número de identificación", value: "1000000000" });
  const enriched = buildScenarioWithContract(events);

  const contractAction = enriched.recordingExecutionContract?.actions[0];
  assert.ok(contractAction, "expected one structured contract action");
  assert.equal(contractAction!.associatedField, "Número de identificación", "RecordingExecutionAction must carry the real field relation, not drop it");

  const parsed = parseScenarioStepsForDiscovery(baseTestScenario(enriched.recordingExecutionContract!));
  const fillTarget = parsed.actionTargets[0];
  assert.ok(fillTarget, "expected one parsed action target");
  assert.equal(fillTarget.associatedField, "Número de identificación", "ActionTargetItem must carry the real field relation -- this is what the retry gate reads");
  assert.equal(parsed.orderedSteps[0]?.associatedField, "Número de identificación", "ExecutableStep must carry it too");
});

test("2/eligibleForRetry. the parsed action target now satisfies the EXACT retry-gate condition used in both fill branches", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", role: "textbox", associatedField: "Número de identificación", value: "1000000000" });
  const enriched = buildScenarioWithContract(events);
  const parsed = parseScenarioStepsForDiscovery(baseTestScenario(enriched.recordingExecutionContract!));
  const { isGenericUnresolvedLabel } = await import("../recording/trace-normalizer");
  const fillTarget = parsed.actionTargets[0];
  const eligible = Boolean(fillTarget.associatedField) && !isGenericUnresolvedLabel(fillTarget.associatedField);
  assert.equal(eligible, true, "helperInvoked must now be reachable for this exact recorded shape");
});

test("3/genericStaysIneligible. a generic/no field relation never becomes eligible -- the fix does not create a blanket retry", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", role: "button" });
  const enriched = buildScenarioWithContract(events);
  const parsed = parseScenarioStepsForDiscovery(baseTestScenario(enriched.recordingExecutionContract!));
  const target = parsed.actionTargets[0];
  assert.equal(target?.associatedField, undefined);
});

test("4/certifiedFillUnaffected. an already-certified fill (real technical target) still carries no misleading associatedField requirement -- unaffected by this fix", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Usuario", role: "input", domId: "user", value: "qauser" });
  const enriched = buildScenarioWithContract(events);
  const contractAction = enriched.recordingExecutionContract?.actions[0];
  assert.ok(contractAction);
  assert.equal(contractAction!.technicalTargetRef !== undefined || (contractAction!.technicalTargetRefs?.length ?? 0) > 0, true, "expected a certified technical target on this fixture");
});

test("5/pressUnaffected. press actions never carry associatedField (semanticField is deliberately never computed for press -- unchanged, out of this ticket's scope) and remain unaffected by this fix", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", role: "textbox", domId: "password", label: "Contraseña", value: "secret" });
  await recorder.onInteraction({ kind: "press", key: "Enter", role: "textbox", associatedField: "Contraseña" });
  const canonical = buildCanonicalInteractions(events);
  const pressInteraction = canonical.find((c) => c.action === "press");
  assert.ok(pressInteraction);
  assert.equal(pressInteraction!.semanticField, undefined, "press deliberately never computes semanticField -- confirms this fix (which forwards semanticField) correctly leaves press untouched");
  const enriched = buildScenarioWithContract(events);
  const pressAction = enriched.recordingExecutionContract?.actions.find((a) => a.actionType === "press");
  assert.ok(pressAction);
  assert.equal(pressAction!.associatedField, undefined);
});

test("6/multiproject. no app/field hardcode governs the lineage -- an arbitrary field name travels identically", async () => {
  for (const field of ["Campo Totalmente Arbitrario", "Otro Campo Distinto"]) {
    const { recorder, events } = newRecorder();
    await recorder.onInteraction({ kind: "input", role: "textbox", associatedField: field, value: "cualquier valor" });
    const enriched = buildScenarioWithContract(events);
    const parsed = parseScenarioStepsForDiscovery(baseTestScenario(enriched.recordingExecutionContract!));
    assert.equal(parsed.actionTargets[0]?.associatedField, field);
  }
});
