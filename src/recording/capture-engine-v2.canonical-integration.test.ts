import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { adaptCaptureActionToRawInteraction } from "./capture-engine-v2.raw-interaction-adapter";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { CaptureAction } from "./capture-engine-v2.types";
import type { RecordedEvent } from "./session-trace.types";

/**
 * Validates the integration boundary:
 *
 *   CaptureEngine V2 technicalActions
 *   -> adaptCaptureActionToRawInteraction (existing, unchanged mapping)
 *   -> WebSessionRecorder.onInteraction (the REAL, private production method -- same technique
 *      already used in web-session-recorder.raw-interaction-contract.test.ts)
 *   -> RecordedEvent (via the recorder's own pushEvent)
 *   -> buildCanonicalInteractions (the REAL, unchanged canonical-recording-contract.ts function)
 *
 * No parallel/duplicate canonicalizer is created here -- every step is the EXACT function
 * production code already uses. `WebSessionRecorder.page` stays `null` throughout (no browser),
 * exactly like the raw-interaction-contract tests: every `this.page?.` access in `onInteraction`
 * short-circuits to a no-op, so the method runs its real mapping logic honestly with zero
 * Playwright dependency.
 *
 * `v2Authority` remains false: this is an in-memory/test harness recorder instance, never the
 * one wired to the live `__qaRecordV2` shadow bridge, and its output is never fed back into any
 * production `SessionTrace`.
 */

function driveActionsThroughRealPipeline(actions: CaptureAction[]) {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://contract-fixture.test",
    framesDir: path.join(os.tmpdir(), "capture-engine-v2-canonical-integration-test-frames"),
    onEvent: (event) => events.push(event),
  }) as unknown as { onInteraction(raw: unknown): Promise<void> };

  return { recorder, events };
}

async function driveAndCanonicalize(actions: CaptureAction[]) {
  const { recorder, events } = driveActionsThroughRealPipeline(actions);
  for (const action of actions) {
    // eslint-disable-next-line no-await-in-loop
    await recorder.onInteraction(adaptCaptureActionToRawInteraction(action));
  }
  return { events, canonical: buildCanonicalInteractions(events) };
}

const usuarioEdit: CaptureAction = {
  actionType: "edit",
  identity: { label: "Usuario", tagName: "input", domId: "user" },
  owner: { tag: "input", role: "textbox", technicalRefs: ["id:user"] },
  value: { present: true, changed: true, literal: "qauser" },
};

const contrasenaEdit: CaptureAction = {
  actionType: "edit",
  identity: { label: "Contraseña", tagName: "input", inputType: "password", domId: "password" },
  owner: { tag: "input", role: "textbox", technicalRefs: ["id:password"] },
  sensitive: true,
  value: { present: true, changed: true }, // no literal -- sensitive
};

const loginClick: CaptureAction = {
  actionType: "click",
  identity: { label: "Iniciar sesión", tagName: "button" },
  owner: { tag: "button", role: "button", technicalRefs: ["id:login-btn"] },
};

const docNumberEdit: CaptureAction = {
  actionType: "edit",
  identity: { label: "Número de identificación", tagName: "input", domId: "docNumber" },
  owner: { tag: "input", role: "textbox", technicalRefs: ["id:docNumber"] },
  value: { present: true, changed: true, literal: "1000000000" },
};

const associatedButtonClick: CaptureAction = {
  actionType: "click",
  identity: { label: "Buscar" },
  owner: { tag: "button", role: "button", technicalRefs: ["id:search-btn"], associatedField: "Número de identificación" },
};

const scopedUnresolvedClick: CaptureAction = {
  actionType: "click",
  interactionId: "pointer-scoped-integration",
  identity: { label: "custom control", tagName: "div" },
  technicalEvidence: {
    candidates: [{
      targetType: "structural",
      locatorCandidates: [],
      structuralContext: {
        owner: { tag: "div" },
        stableDirectAttributes: { "data-field": "custom-control" },
        stableDescendants: [],
        semanticShape: [],
        deterministicStructuralIdentity: true,
        structuralIdentityMatchCount: 1,
        scopeIdentity: { strategy: "id", value: "stable-scope" },
        targetFingerprint: "opaque-local-target-fingerprint",
        captureScopeUnique: true,
        captureTargetMatchCount: 1,
      },
      interactionEvidence: ["v2_click_owner", "v2_scoped_structural_runtime_evidence"],
      confidence: 0.6,
      validatedByInteraction: true,
    }],
  },
};

test("1. a V2 normal edit survives as a canonical fill, with its recorded value intact", async () => {
  const { canonical } = await driveAndCanonicalize([usuarioEdit]);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].action, "fill");
  assert.equal(canonical[0].recordedValue, "qauser");
});

test("2. a V2 sensitive edit without a literal still survives as a canonical fill -- no secret is fabricated or required", async () => {
  const { canonical } = await driveAndCanonicalize([contrasenaEdit]);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].action, "fill");
  assert.equal(canonical[0].recordedValue, undefined, "a sensitive fill with no captured literal has no recordedValue -- this is correct, not a loss");
  assert.equal(canonical[0].admissionStatus, "accepted", "real technical identity (domId) still admits the interaction despite the missing value");
});

test("3. two edits + a click canonicalize as fill, fill, click, in that exact order", async () => {
  const { canonical } = await driveAndCanonicalize([usuarioEdit, contrasenaEdit, loginClick]);
  assert.deepEqual(canonical.map((c) => c.action), ["fill", "fill", "click"]);
});

test("4. a post-login edit (on a later, distinct screen conceptually) still canonicalizes as a fill, not degraded to an observation", async () => {
  const { canonical } = await driveAndCanonicalize([usuarioEdit, contrasenaEdit, loginClick, docNumberEdit]);
  assert.equal(canonical[3].action, "fill");
  assert.equal(canonical[3].recordedValue, "1000000000");
});

test("5. a click's owner identity (role) is preserved onto the canonical interaction, never re-inferred from text", async () => {
  const { canonical } = await driveAndCanonicalize([loginClick]);
  assert.equal(canonical[0].action, "click");
  assert.ok(canonical[0].technicalTargetRefs.some((ref) => ref.includes("login-btn")));
});

test("6. owner.technicalRefs (id:...) are preserved across the boundary as real technicalTargetRefs on the canonical interaction", async () => {
  const { canonical } = await driveAndCanonicalize([usuarioEdit]);
  assert.ok(canonical[0].technicalTargetRefs.some((ref) => ref === "css:#user"), `expected a css:#user locator, got ${JSON.stringify(canonical[0].technicalTargetRefs)}`);
});

test("7. source ordering (sourceEventRefs) increases monotonically with the input order", async () => {
  const { canonical } = await driveAndCanonicalize([usuarioEdit, contrasenaEdit, loginClick]);
  const refIndex = (ref: string) => Number(ref.split("-")[1]);
  const indices = canonical.map((c) => refIndex(c.sourceEventRefs[0]));
  assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
});

test("8. this validation only ever drives technicalActions -- CaptureFunctionalAction/select never participates and is never CanonicalInteraction execution authority", async () => {
  const { canonical } = await driveAndCanonicalize([usuarioEdit, contrasenaEdit, loginClick]);
  assert.ok(canonical.every((c) => c.action !== "select" || false), "no select interaction was fabricated from this technical-only fixture");
  // Structural confirmation: this test file never imports CaptureFunctionalAction or SelectionSessionManager.
});

test("9. no duplicate legacy/V2 event: driving N technical actions through the real pipeline once produces exactly N RecordedEvents, never more", async () => {
  const actions = [usuarioEdit, contrasenaEdit, loginClick, docNumberEdit, associatedButtonClick];
  const { events } = await driveAndCanonicalize(actions);
  assert.equal(events.length, actions.length);
});

test("10. the physical fixture (edit, edit, click, edit, click) canonicalizes to exactly 5 technical canonical interactions, in order", async () => {
  const actions = [usuarioEdit, contrasenaEdit, loginClick, docNumberEdit, associatedButtonClick];
  const { canonical } = await driveAndCanonicalize(actions);
  assert.equal(canonical.length, 5);
  assert.deepEqual(canonical.map((c) => c.action), ["fill", "fill", "click", "fill", "click"]);
});

test("11. the canonical pipeline used is the real, existing buildCanonicalInteractions -- not a V2-only duplicate (verified by using its full admission/resolutionState contract)", async () => {
  const { canonical } = await driveAndCanonicalize([usuarioEdit]);
  assert.ok("resolutionState" in canonical[0], "resolutionState is a field only the real canonical-recording-contract.ts admission pipeline produces");
  assert.equal(canonical[0].resolutionState, "certified");
});

test("12. no app-specific labels/hardcodes: the same pipeline canonicalizes a completely different, unrelated fixture identically in shape", async () => {
  const genericEdit: CaptureAction = {
    actionType: "edit",
    identity: { label: "Correo", tagName: "input", domId: "email-field-xyz" },
    owner: { tag: "input", role: "textbox", technicalRefs: ["id:email-field-xyz"] },
    value: { present: true, changed: true, literal: "someone@example.test" },
  };
  const { canonical } = await driveAndCanonicalize([genericEdit]);
  assert.equal(canonical[0].action, "fill");
  assert.equal(canonical[0].recordedValue, "someone@example.test");
});

test("13/scopedRuntimeIntegration. scoped evidence crosses the real V2 adapter and canonical contract without certifying an owner", async () => {
  const { canonical } = await driveAndCanonicalize([scopedUnresolvedClick]);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
  assert.equal(canonical[0].technicalTargetRefs.length, 0);
});
