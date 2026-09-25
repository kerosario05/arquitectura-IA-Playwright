import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness } from "./canonical-recording-contract";
import { adaptCaptureActionToRawInteraction } from "./capture-engine-v2.raw-interaction-adapter";
import { buildCaptureScriptV2Content } from "./web/capture-engine-v2.browser-instrumentation";
import { resolvePlaywrightRecorderTarget } from "../discovery/target-resolver";
import { WebSessionRecorder } from "./web/web-session-recorder";
import os from "node:os";
import path from "node:path";
import { recorderEvidenceFromSemanticRuntime, type PlaywrightRecorderEvidence, type SemanticRuntimeEvidence } from "./structural-owner-identity";
import type { RecordedEvent } from "./session-trace.types";
import type { CaptureAction } from "./capture-engine-v2.types";

const scope = { strategy: "id" as const, value: "segmented-scope" };

test("recorder evidence is structured, execution-only, and preserves semantic fallback provenance", () => {
  const semantic: SemanticRuntimeEvidence = {
    source: "accessible_name",
    normalizedValue: "Observed control",
    role: "button",
    targetTag: "button",
    scopeAlternatives: [{ scopeIdentity: scope, captureMatchCount: 1 }],
    captureUniqueTarget: true,
  };
  const evidence = recorderEvidenceFromSemanticRuntime(semantic, "button");
  assert.deepEqual(evidence, {
    kind: "role",
    role: "button",
    normalizedName: "Observed control",
    targetTag: "button",
    scopeIdentity: scope,
    captureMatchCount: 1,
    runtimeResolutionRequired: true,
  });
  assert.equal("locator" in (evidence ?? {}), false);
  assert.equal("source" in (evidence ?? {}), false);
});

test("CaptureAction to RawInteraction preserves recorder evidence without creating technical authority", () => {
  const recorderEvidence: PlaywrightRecorderEvidence = {
    kind: "text", normalizedName: "Observed control", captureMatchCount: 1,
    runtimeResolutionRequired: true,
  };
  const raw = adaptCaptureActionToRawInteraction({
    actionType: "click", identity: { label: "Observed control" },
    playwrightRecorderEvidence: recorderEvidence,
  });
  assert.deepEqual(raw.playwrightRecorderEvidence, recorderEvidence);
  assert.equal(raw.technicalTargetCandidates, undefined);
});

test("browser Capture V2 emits recorder-shaped evidence from DOM observation, not source code", () => {
  const source = buildCaptureScriptV2Content("capture-test");
  assert.match(source, /playwrightRecorderEvidence/);
  assert.match(source, /segmented_input/);
  assert.match(source, /Recorder intent is a capture candidate/);
  assert.doesNotMatch(source, /eval\(/);
});

test("shared runtime resolver revalidates recorder role/name uniqueness and fails closed on duplicates", async () => {
  const scopeIdentity = { strategy: "id" as const, value: "scope" };
  const target = { count: async () => 1, isVisible: async () => true, isEnabled: async () => true };
  const scope = {
    count: async () => 1,
    getByRole: () => target,
    getByText: () => target,
    getByLabel: () => target,
    getByPlaceholder: () => target,
    getByTestId: () => target,
  };
  const page = { locator: () => scope } as any;
  const resolved = await resolvePlaywrightRecorderTarget(page, {
    kind: "role", role: "button", normalizedName: "Observed control", scopeIdentity,
    // Capture ambiguity is provenance only; the live resolver must revalidate.
    captureMatchCount: 2, runtimeResolutionRequired: true,
  });
  assert.ok(resolved);
  assert.equal(resolved?.strategy, "recorded:recorder-role");
  const duplicateTarget = { count: async () => 2, isVisible: async () => true, isEnabled: async () => true };
  const duplicatePage = { locator: () => ({ ...scope, getByRole: () => duplicateTarget }) } as any;
  assert.equal(await resolvePlaywrightRecorderTarget(duplicatePage, {
    kind: "role", role: "button", normalizedName: "Observed control", scopeIdentity,
    captureMatchCount: 2, runtimeResolutionRequired: true,
  }), undefined);
  const zeroTarget = { count: async () => 0, isVisible: async () => false, isEnabled: async () => false };
  const zeroPage = { locator: () => ({ ...scope, getByRole: () => zeroTarget }) } as any;
  assert.equal(await resolvePlaywrightRecorderTarget(zeroPage, {
    kind: "role", role: "button", normalizedName: "Observed control", scopeIdentity,
    captureMatchCount: 0, runtimeResolutionRequired: true,
  }), undefined);
});

test("six homogeneous recorder segments collapse into one runtime-resolution action", () => {
  const evidence: PlaywrightRecorderEvidence = {
    kind: "segmented_input",
    targetTag: "input",
    scopeIdentity: scope,
    captureMatchCount: 1,
    runtimeResolutionRequired: true,
    segmentCount: 6,
    inputMode: "numeric",
    valueKey: "verificationCode",
  };
  const events = Array.from({ length: 6 }, (_, index) => ({
    seq: index,
    t: index,
    kind: "fill" as const,
    screenKey: "screen",
    value: String(index + 1),
    interactionId: `segment-${index}`,
    target: { label: "control", role: "textbox", tag: "input", locators: [], playwrightRecorderEvidence: evidence },
  } as unknown as RecordedEvent));
  const [interaction] = buildCanonicalInteractions(events);
  assert.equal(interaction.action, "fill");
  assert.equal(interaction.playwrightRecorderEvidence?.kind, "segmented_input");
  assert.equal(interaction.playwrightRecorderEvidence?.segmentCount, 6);
  assert.equal(interaction.valueKey, "verificationCode");
  assert.equal(interaction.resolutionState, "runtime_resolution_required");
  assert.equal(interaction.technicalTargetRefs.length, 0);
  assert.equal(interaction.sourceEventRefs.length, 6);
});

test("segmented runtime evidence permits execution readiness without raising technical or promotion gates", () => {
  const evidence: PlaywrightRecorderEvidence = {
    kind: "segmented_input", targetTag: "input", scopeIdentity: scope,
    captureMatchCount: 1, runtimeResolutionRequired: true, segmentCount: 6, valueKey: "verificationCode",
  };
  const [interaction] = buildCanonicalInteractions(Array.from({ length: 6 }, (_, index) => ({
    seq: index, t: index, kind: "fill" as const, screenKey: "screen", value: String(index + 1),
    interactionId: `segment-ready-${index}`,
    target: { label: "control", role: "textbox", tag: "input", locators: [], playwrightRecorderEvidence: evidence },
  } as unknown as RecordedEvent)));
  const readiness = evaluateRecordedScenarioExecutionReadiness({
    canonicalInteractions: [interaction],
    runtimeInputRequirements: [{
      valueKey: "verificationCode", semanticField: null, valueRole: "action_input", required: true,
      value: "x".repeat(6), source: "CURRENT_QA_EDIT", resolved: true,
    }],
    testRailSteps: [{}], stateSequenceValid: true, mutationDiagnostics: [], readiness: undefined,
  } as any);
  assert.equal(readiness.executionReady, true);
  assert.equal(readiness.technicalReady, false);
  assert.equal(readiness.promotionReady, false);
});

test("recorder-only semantic click is execution-ready while technical and promotion gates remain closed", async () => {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://recorder-evidence.test",
    framesDir: path.join(os.tmpdir(), "recorder-evidence-test"),
    onEvent: (event) => events.push(event),
  }) as unknown as { onInteraction(raw: unknown): Promise<void> };
  await recorder.onInteraction({
    kind: "click", role: "button", associatedField: "control",
    playwrightRecorderEvidence: {
      kind: "text", normalizedName: "Observed control", targetTag: "div", scopeIdentity: scope,
      captureMatchCount: 1, runtimeResolutionRequired: true,
    },
  });
  const [interaction] = buildCanonicalInteractions(events);
  assert.equal(interaction.resolutionState, "runtime_resolution_required");
  assert.equal(interaction.playwrightRecorderEvidence?.runtimeResolutionRequired, true);
  assert.equal(interaction.technicalTargetRefs.length, 0);
});

test("physical-shaped ambiguous recorder candidate is admitted for runtime re-resolution", async () => {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://recorder-evidence.test",
    framesDir: path.join(os.tmpdir(), "recorder-physical-shape-test"),
    onEvent: (event) => events.push(event),
  }) as unknown as { onInteraction(raw: unknown): Promise<void> };
  const captureAction: CaptureAction = {
    actionType: "click",
    identity: { label: "Observed control", tagName: "div" },
    owner: { tag: "div", associatedField: "field-token" },
    // This is intentionally not capture-unique. It proves admission does not
    // certify the target; runtime resolution remains responsible for uniqueness.
    playwrightRecorderEvidence: {
      kind: "text", normalizedName: "Observed control", targetTag: "div", scopeIdentity: scope,
      captureMatchCount: 2, runtimeResolutionRequired: true,
    },
  } as CaptureAction;
  await recorder.onInteraction(adaptCaptureActionToRawInteraction(captureAction));
  const [interaction] = buildCanonicalInteractions(events);
  assert.equal(interaction.resolutionState, "runtime_resolution_required");
  assert.equal(interaction.admissionStatus, "accepted");
  assert.equal(interaction.technicalTargetRefs.length, 0);

  const readiness = evaluateRecordedScenarioExecutionReadiness({
    canonicalInteractions: [interaction],
    runtimeInputRequirements: [],
    testRailSteps: [{}], stateSequenceValid: true, mutationDiagnostics: [], readiness: undefined,
  } as any);
  assert.equal(readiness.executionReady, true);
  assert.equal(readiness.technicalReady, false);
  assert.equal(readiness.promotionReady, false);
  assert.deepEqual(readiness.actions.filter((action) => !action.ready), []);
});

test("recorder action is not the password blocker when its only missing runtime value is separate", async () => {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://recorder-evidence.test",
    framesDir: path.join(os.tmpdir(), "recorder-password-control-test"),
    onEvent: (event) => events.push(event),
  }) as unknown as { onInteraction(raw: unknown): Promise<void> };
  await recorder.onInteraction({
    kind: "click", role: "button", associatedField: "field-token",
    playwrightRecorderEvidence: {
      kind: "text", normalizedName: "Observed control", targetTag: "div", scopeIdentity: scope,
      captureMatchCount: 2, runtimeResolutionRequired: true,
    },
  });
  const [recorderInteraction] = buildCanonicalInteractions(events);
  const missingValueInteraction = {
    ...recorderInteraction,
    id: "credential-action",
    action: "fill",
    valueKey: "credential-key",
    recordedValue: undefined,
    resolutionState: "certified",
    admissionStatus: "accepted",
    technicalTargetRefs: ["role:textbox|credential"],
    technicalTargetCandidates: [],
  } as any;
  const base = {
    canonicalInteractions: [recorderInteraction, missingValueInteraction],
    runtimeInputRequirements: [{
      valueKey: "credential-key", semanticField: null, valueRole: "action_input", required: true,
      value: null, source: "CURRENT_QA_EDIT", resolved: false,
    }],
    testRailSteps: [{}], stateSequenceValid: true, mutationDiagnostics: [], readiness: undefined,
  } as any;
  const missing = evaluateRecordedScenarioExecutionReadiness(base);
  assert.deepEqual(missing.actions.filter((action) => !action.ready).map((action) => action.actionId), ["credential-action"]);
  assert.equal(missing.executionReady, false);
  const supplied = evaluateRecordedScenarioExecutionReadiness({
    ...base,
    runtimeInputRequirements: [{ ...base.runtimeInputRequirements[0], value: "resolved", resolved: true }],
  });
  assert.equal(supplied.executionReady, true);
});

test("segmented evidence stays fail-closed when the observed group is incomplete", () => {
  const evidence: PlaywrightRecorderEvidence = {
    kind: "segmented_input", scopeIdentity: scope, captureMatchCount: 1,
    runtimeResolutionRequired: true, segmentCount: 6,
  };
  const events = Array.from({ length: 5 }, (_, index) => ({
    seq: index, t: index, kind: "fill" as const, screenKey: "screen", value: String(index),
    target: { label: "control", role: "textbox", tag: "input", locators: [], playwrightRecorderEvidence: evidence },
  } as unknown as RecordedEvent));
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.length, 5);
  assert.equal(interactions.every((interaction) => interaction.playwrightRecorderEvidence?.kind === "segmented_input"), true);
});
