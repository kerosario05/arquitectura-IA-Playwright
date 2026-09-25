import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web-session-recorder";
import type { RecordedEvent } from "../session-trace.types";

/**
 * Locks the CURRENT Browser Capture -> RawInteraction -> RecordedEvent/RecordedTarget boundary
 * with fixtures, so a future capture-engine replacement (browser events -> capture engine ->
 * RawInteraction) can be swapped in underneath without silently breaking everything downstream
 * (trace -> CanonicalInteraction -> Runtime Dataset -> RecordingExecutionContract -> resolver ->
 * spec/promotion/evidence/TestRail).
 *
 * `RawInteraction` (web-session-recorder.ts:79) is not exported -- it is purely an internal
 * shape for the payload `context.exposeBinding("__qaRecord", ...)` hands to `onInteraction`
 * (the actual browser->Node boundary, web-session-recorder.ts:1444/1287). These tests exercise
 * the REAL private `onInteraction` method (via a narrow, disclosed `as any` cast — there is no
 * other way to reach it without a live browser) with synthetic payloads shaped exactly like that
 * boundary, never a re-implementation of its mapping logic. `WebSessionRecorder.page` stays
 * `null` throughout (no `start()` call, no browser launched): every `this.page?.` access in
 * `onInteraction`'s post-click screen-absorption loop short-circuits to a no-op, so the method
 * runs its real field-mapping logic synchronously and honestly, with zero Playwright dependency.
 */

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://contract-fixture.test",
    framesDir: path.join(os.tmpdir(), "raw-interaction-contract-test-frames"),
    onEvent: (event) => events.push(event),
  });
  return { recorder: recorder as unknown as { onInteraction(raw: unknown): Promise<void> }, events };
}

test("A. fill normal: a plain text field emits exactly one fill event carrying its typed value and identity", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "input",
    label: "Correo electrónico",
    tagName: "input",
    inputType: "email",
    domId: "email",
    value: "persona@correo-fixture.test",
    valueSource: "user",
  });

  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.kind, "fill");
  assert.equal(event.value, "persona@correo-fixture.test");
  assert.equal(event.valueSource, "user");
  assert.equal(event.redactedKey, undefined);
  assert.equal(event.target?.label, "Correo electrónico");
  assert.equal(event.target?.sensitive, false);
});

test("B. sensitive fill: a password field is still detected/persisted for the recording contract, but flagged and given a redactedKey (never logged)", async () => {
  const { recorder, events } = newRecorder();
  const fixtureSecret = "fixture-only-value-never-logged";
  await recorder.onInteraction({
    kind: "input",
    label: "Contraseña",
    tagName: "input",
    inputType: "password",
    domId: "password",
    value: fixtureSecret,
    valueSource: "user",
  });

  const [event] = events;
  assert.equal(event.kind, "fill");
  assert.equal(event.target?.sensitive, true, "password inputType must mark the target sensitive");
  assert.equal(event.redactedKey, "contrasena", "redactedKey is derived from the normalized label, never the value");
  // Persistence of the literal is a documented, intentional QA-recording-contract behavior
  // (see the comment above the `value: raw.value` assignment in onInteraction) -- this test
  // documents that contract without ever printing the fixture value to console/log output.
  assert.equal(event.value, fixtureSecret);
});

test("C. click button: a plain actionable click emits exactly one tap event, no synthesized screen_change when the screen is unchanged", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    label: "Enviar",
    role: "button",
    tagName: "button",
    testId: "submit-btn",
    actionability: "NATIVE_ACTIONABLE",
    actionOwner: true,
  });

  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.kind, "tap");
  assert.equal(event.target?.label, "Enviar");
  assert.equal(event.target?.actionability, "NATIVE_ACTIONABLE");
  assert.equal(event.target?.actionOwner, true);
  assert.deepEqual(event.target?.locators?.[0], { strategy: "data-testid", value: "submit-btn", confidence: 0.98 });
});

test("D. select/option with owner+value lineage: the FIELD OWNER (associatedField) and the before/after selection value both survive onto the target", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    label: "Cédula de ciudadanía",
    role: "combobox",
    tagName: "select",
    domId: "docType",
    interactionType: "select",
    compoundRole: "selection",
    associatedField: "Tipo de documento",
    beforeValue: "",
    afterValue: "Cédula de ciudadanía",
    observedOptions: ["Cédula de ciudadanía", "Pasaporte"],
  });

  const [event] = events;
  assert.equal(event.target?.interactionType, "select");
  assert.equal(event.target?.compoundRole, "selection");
  assert.equal(event.target?.associatedField, "Tipo de documento", "the field owner label must survive onto the target");
  assert.equal(event.target?.beforeValue, "");
  assert.equal(event.target?.afterValue, "Cédula de ciudadanía");
  assert.deepEqual(event.target?.observedOptions, ["Cédula de ciudadanía", "Pasaporte"]);
});

test("E. interaction unresolved with technical evidence: no strong identity locator survives, but structural technical-target evidence and the unresolved field-owner diagnostic both persist", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    tagName: "div",
    role: "gridcell",
    technicalTargetCandidates: [
      {
        targetType: "editable",
        locatorCandidates: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text", confidence: 0.72 }],
        interactionEvidence: ["dom_mutation"],
        confidence: 0.72,
        validatedByInteraction: true,
      },
    ],
    fieldOwnerDiagnostic: {
      result: "unresolved",
      trace: [
        {
          ancestorLevel: 0,
          tagName: "div",
          idPresent: false,
          classSummary: "",
          candidateFieldCount: 0,
          candidateFields: [],
          candidateLabelCount: 0,
          candidateLabels: [],
        },
      ],
    },
  });

  const [event] = events;
  assert.equal(event.target?.locators?.length, 1, "no testId/ariaLabel/role+label/domId/text/name -> only the structural fallback remains");
  assert.equal(event.target?.locators?.[0]?.strategy, "structural");
  assert.equal(event.target?.technicalTargetCandidates?.[0]?.targetType, "editable");
  assert.equal(event.target?.fieldOwnerDiagnostic?.result, "unresolved");
});

test("F. screen/document identity: the event carries whatever screen the recorder currently believes it is on", async () => {
  const { recorder, events } = newRecorder();
  (recorder as unknown as { lastScreenKey: string }).lastScreenKey = "screen-9b3ed654dc84";
  await recorder.onInteraction({ kind: "click", label: "Depurar", role: "button" });

  const [event] = events;
  assert.equal(event.screenKey, "screen-9b3ed654dc84");
});

test("G. sourceEventRefs survive onto the target; editingSessionRef is a documented GAP (always undefined -- RawInteraction has no field to carry it)", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "input",
    label: "Número de identificación",
    tagName: "input",
    domId: "docNumber",
    value: "1000000000",
    eventTargetRef: "ref-target-1",
    currentTargetRef: "ref-current-1",
    composedPathRefs: ["ref-target-1", "ref-form-1", "ref-body"],
    deepestEditableTargetRef: "ref-target-1",
  });

  const [event] = events;
  assert.equal(event.target?.eventTargetRef, "ref-target-1");
  assert.equal(event.target?.currentTargetRef, "ref-current-1");
  assert.deepEqual(event.target?.composedPathRefs, ["ref-target-1", "ref-form-1", "ref-body"]);
  assert.equal(event.target?.deepestEditableTargetRef, "ref-target-1");
  // GAP: onInteraction hardcodes `editingSessionRef: undefined` on every target (there is no
  // corresponding field on RawInteraction) even though RecordedTarget/RecordedEditingSession both
  // define one. A future capture engine that wants to cross-reference a persisted
  // RecordedEditingSession from its RawInteraction needs a new field -- not added here, per this
  // ticket's own "no ampliar el contrato" instruction; reported under GAPS instead.
  assert.equal(event.target?.editingSessionRef, undefined);
});

test("ordering: two interactions on the same recorder are pushed, and stay retrievable, in the exact order they occurred", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", label: "Primero", role: "button" });
  await recorder.onInteraction({ kind: "click", label: "Segundo", role: "button" });

  assert.equal(events.length, 2);
  assert.equal(events[0].target?.label, "Primero");
  assert.equal(events[1].target?.label, "Segundo");
  assert.ok(events[0].seq < events[1].seq, "seq must be monotonically assigned in emission order");
});

test("historical compatibility: a minimal legacy-shaped RawInteraction (no technicalTargetCandidates/actionability/fieldOwnerDiagnostic) still maps cleanly", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", label: "Volver", role: "button" });

  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.kind, "tap");
  assert.equal(event.target?.label, "Volver");
  assert.equal(event.target?.technicalTargetCandidates, undefined);
  assert.equal(event.target?.fieldOwnerDiagnostic, undefined);
});
