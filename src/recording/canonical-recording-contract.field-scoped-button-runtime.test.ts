import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness, enrichRecordedScenarioContract } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import { buildOwnerTechnicalEvidence } from "./capture-engine-v2.action-owner-resolver";
import type { CaptureAction } from "./capture-engine-v2.types";
import type { ShadowActionRecord } from "./capture-engine-v2.shadow-bridge";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";
import type { StructuralOwnerIdentity } from "./structural-owner-identity";

/**
 * REGRESSION FIX (recordingId e5c8ac51-1dff-4c56-9a55-dcd941203a32, scenarioId REC-E5C8AC51-01,
 * interaction-14): a button click associated with a real field ("Número de identificación"),
 * carrying zero technicalTargetRefs but a real associatedField and a captured (if capture-time-
 * ambiguous) structural candidate, was wrongly certified with NO re-resolution strategy instead
 * of deferred to the SAME shared field-scoped runtime carve-out already granted to its own
 * paired fill action (interaction-13) and to an equivalent-shaped button in a prior physical run.
 * Root cause: `priorAmbiguityEvidence` (canonical-recording-contract.ts) had been widened in an
 * earlier ticket to also block on capture-time `structuralContext.identityAmbiguous`/
 * `structuralIdentityMatchCount` -- a coarse, landmark-wide count taken BEFORE the live resolver's
 * own narrower re-count ever runs. This exact button (`identityAmbiguous:true, matchCount:2` at
 * capture) had PHYSICALLY resolved live to exactly one element before that widening. Reverted:
 * `priorAmbiguityEvidence` checks only a genuine per-locator `ambiguous` flag again; the live
 * resolver's own independent `count !== 1` fail-closed re-check (target-resolver.ts) is unchanged
 * and remains the real ambiguity safety net.
 */

type RecorderInternals = {
  onV2TechnicalAction(record: ShadowActionRecord): void;
  v2IngestionQueue: Promise<void>;
};

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://field-scoped-button-fixture.test",
    framesDir: path.join(os.tmpdir(), "field-scoped-button-runtime-test-frames"),
    captureAuthority: "v2",
    onEvent: (event) => events.push(event),
  });
  return { recorder: recorder as unknown as RecorderInternals, events };
}

let seqCounter = 0;
function technicalRecord(action: CaptureAction): ShadowActionRecord {
  seqCounter += 1;
  return { seq: seqCounter, action };
}

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-field-scoped-button",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://field-scoped-button-fixture.test",
    startedAt: new Date().toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "inicio", url: "/inicio" } as any],
  } as unknown as SessionTrace;
}

function buildReadiness(events: RecordedEvent[]) {
  const scenario = buildHappyPathScenario(trace(events), events);
  const canonical = buildCanonicalInteractions(events);
  const enriched = enrichRecordedScenarioContract(scenario, canonical);
  return evaluateRecordedScenarioExecutionReadiness(enriched);
}

// Mirrors the REAL physical shape of interaction-14 ("Número de identificación"'s associated
// button): role=button, no id/data-testid/aria-label, real associatedField, capture-time-
// ambiguous (2 identically-shaped buttons landmark-wide) -- never a hardcoded business value.
function ambiguousFieldScopedButton(fieldLabel: string): CaptureAction {
  const identity: StructuralOwnerIdentity = {
    owner: { tag: "button" },
    stableDirectAttributes: {},
    stableDescendants: [],
    semanticShape: ["span"],
    landmarkAncestor: { tag: "main" },
    deterministicStructuralIdentity: false,
    identityAmbiguous: true,
    structuralIdentityMatchCount: 2,
  };
  const owner = { tag: "button", role: "button", associatedField: fieldLabel, structuralIdentity: identity };
  return { actionType: "click", identity: { tagName: "button", role: "button" }, owner, technicalEvidence: buildOwnerTechnicalEvidence(owner) };
}

function uniqueCertifiedButton(label: string): CaptureAction {
  return {
    actionType: "click",
    identity: { label, tagName: "button", role: "button" },
    owner: { tag: "button", role: "button", technicalRefs: [`role:button|${label}`] },
  };
}

function deterministicStructuralButton(label: string): CaptureAction {
  const structuralIdentity: StructuralOwnerIdentity = {
    owner: { tag: "button" },
    stableDirectAttributes: { "data-testid": "stable-action-owner" },
    stableDescendants: [],
    semanticShape: ["span"],
    landmarkAncestor: { tag: "main" },
    deterministicStructuralIdentity: true,
    structuralIdentityMatchCount: 1,
  };
  const owner = {
    tag: "button",
    role: "button",
    accessibleName: label,
    roleTechnicalIdentityEligible: false,
    structuralIdentity,
  };
  return {
    actionType: "click",
    identity: { label, tagName: "button", role: "button" },
    owner,
    technicalEvidence: buildOwnerTechnicalEvidence(owner),
  };
}

test("1/associatedButton. a button click with a real associatedField and zero technicalTargetRefs becomes runtime_resolution_required, never certified-with-nothing", async () => {
  const { recorder, events } = newRecorder();
  recorder.onV2TechnicalAction(technicalRecord(ambiguousFieldScopedButton("Número de identificación")));
  await recorder.v2IngestionQueue;
  const readiness = buildReadiness(events);
  const action = readiness.actions.find((a) => a.semanticField === "Número de identificación");
  assert.ok(action);
  assert.equal(action!.runtimeResolutionRequired, true);
  assert.equal(action!.ready, true);
  assert.equal(action!.blockReasons.length, 0);
});

test("2/missingField. the same button shape with NO associatedField stays blocked -- structuralFieldName is mandatory", async () => {
  const { recorder, events } = newRecorder();
  const record = ambiguousFieldScopedButton("Número de identificación");
  delete (record.owner as any).associatedField;
  record.technicalEvidence = buildOwnerTechnicalEvidence(record.owner!);
  recorder.onV2TechnicalAction(technicalRecord(record));
  await recorder.v2IngestionQueue;
  const readiness = buildReadiness(events);
  const action = readiness.actions[0];
  assert.ok(action);
  assert.notEqual(action.runtimeResolutionRequired, true);
  assert.equal(action.ready, false);
  assert.equal(readiness.executionReady, false);
});

test("2b/deterministicStructuralOwner. a role-ref-withheld button remains runtime-ready only with unique structural authority", async () => {
  const { recorder, events } = newRecorder();
  recorder.onV2TechnicalAction(technicalRecord(deterministicStructuralButton("Primary action")));
  await recorder.v2IngestionQueue;
  const readiness = buildReadiness(events);
  const [action] = readiness.actions;
  assert.equal(action.runtimeResolutionRequired, true);
  assert.equal(action.ready, true);
  assert.equal(readiness.executionReady, true);
  assert.equal(readiness.technicalReady, false);
  assert.equal(readiness.promotionReady, false);
  assert.equal(events[0].target?.locators?.some((locator) => locator.strategy === "role"), false);
});

test("3/noFakeCertification. no technicalTargetRef is ever fabricated for the button -- it stays 0 real refs, only resolutionState changes", async () => {
  const { recorder, events } = newRecorder();
  recorder.onV2TechnicalAction(technicalRecord(ambiguousFieldScopedButton("Número de identificación")));
  await recorder.v2IngestionQueue;
  assert.deepEqual(events[0].target?.locators, [], "the raw event itself never gains a fabricated locator");
});

test("4/depurarUnaffected. an already-unique, already-certified button (Depurar-shaped) is completely unaffected by this fix", async () => {
  const { recorder, events } = newRecorder();
  recorder.onV2TechnicalAction(technicalRecord(uniqueCertifiedButton("Depurar")));
  await recorder.v2IngestionQueue;
  const readiness = buildReadiness(events);
  const action = readiness.actions[0];
  assert.equal(action.ready, true);
  assert.notEqual(action.runtimeResolutionRequired, true, "already certified via a real technicalTargetRef -- never routed through the runtime-resolution carve-out");
});

// The recorder's raw CaptureAction->onV2TechnicalAction path is validated for clicks above (tests
// 1-4); fill/press synthesis goes through a separate editing-session lifecycle this fixture does
// not need to exercise -- so this cross-boundary test builds RecordedEvent[] directly, using the
// EXACT shapes physically captured for this recording's real fill/press/click events (field
// names/roles kept, no id/dataset VALUE literals ever included).
function directEvent(partial: Partial<RecordedEvent> & { kind: RecordedEvent["kind"] }): RecordedEvent {
  return { t: 0, screenKey: "inicio", fingerprint: "fp", seq: 0, ...partial } as RecordedEvent;
}

test("5/crossBoundary. the current recording's 7-action fixture (Usuario, Contraseña, Enter, Solicitud multiproducto, Número ID fill, Número ID button, Depurar) reaches executionReady=true with zero blocking interactions", () => {
  const events: RecordedEvent[] = [
    directEvent({ kind: "fill", target: { label: "Usuario", role: "input", tag: "input", committedValue: "usuario-de-prueba", locators: [{ strategy: "id", value: "usuario", confidence: 0.8 }] } }),
    directEvent({ kind: "fill", target: { label: "Contraseña", role: "input", tag: "input", committedValue: "contrasena-de-prueba", locators: [{ strategy: "id", value: "contrasena", confidence: 0.8 }], sensitive: true } }),
    directEvent({ kind: "press", note: "Enter", target: { label: "Contraseña", role: "textbox", tag: "input", locators: [{ strategy: "id", value: "contrasena", confidence: 0.8 }] } }),
    directEvent({ kind: "tap", target: { label: "Solicitud multiproducto", role: "link", tag: "a", locators: [{ strategy: "role", value: "link|Solicitud multiproducto", confidence: 0.85 }] } }),
    directEvent({
      kind: "fill",
      target: { label: "control", role: "input", tag: "input", associatedField: "Número de identificación", committedValue: "numero-de-prueba", locators: [] },
    }),
    directEvent({
      kind: "tap",
      target: {
        label: "control", role: "button", tag: "button", associatedField: "Número de identificación", locators: [],
        technicalTargetCandidates: [{
          targetType: "structural", locatorCandidates: [],
          structuralContext: { owner: { tag: "button" }, stableDirectAttributes: {}, stableDescendants: [], semanticShape: ["span"], landmarkAncestor: { tag: "main" }, deterministicStructuralIdentity: false, identityAmbiguous: true, structuralIdentityMatchCount: 2 },
          interactionEvidence: ["v2_click_owner"], confidence: 0.85, validatedByInteraction: true,
        }],
      },
    }),
    directEvent({
      kind: "tap",
      target: {
        label: "Depurar", role: "button", tag: "button", locators: [{ strategy: "role", value: "button|Depurar", confidence: 0.85 }],
        technicalTargetCandidates: [{
          targetType: "structural", locatorCandidates: [{ strategy: "role", value: "button|Depurar", confidence: 0.85 }],
          structuralContext: { owner: { tag: "button" }, stableDirectAttributes: { "aria-label": "Depurar" }, stableDescendants: [], semanticShape: ["span"], landmarkAncestor: { tag: "main" }, deterministicStructuralIdentity: true, structuralIdentityMatchCount: 1 },
          interactionEvidence: ["v2_click_owner"], confidence: 0.85, validatedByInteraction: true,
        }],
      },
    }),
  ].map((e, i) => ({ ...e, seq: i })) as RecordedEvent[];

  const readiness = buildReadiness(events);
  const blocking = readiness.actions.filter((a) => !a.ready).map((a) => a.actionId);
  assert.deepEqual(blocking, [], "no interaction blocks readiness");
  assert.equal(readiness.executionReady, true);
  // promotionReady stays independently gated by runtime_resolution_required actions -- never
  // forced true just because execution is unblocked.
  assert.equal(readiness.promotionReady, false);

  const numeroIdFill = readiness.actions.find((a) => a.semanticField === "Número de identificación" && a.actionType === "fill");
  const numeroIdButton = readiness.actions.find((a) => a.semanticField === "Número de identificación" && a.actionType === "click");
  const depurar = readiness.actions.find((a) => a.semanticField === "Depurar");
  assert.equal(numeroIdFill!.runtimeResolutionRequired, true);
  assert.equal(numeroIdButton!.runtimeResolutionRequired, true);
  assert.notEqual(depurar!.runtimeResolutionRequired, true);
});
