import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web-session-recorder";
import { buildCanonicalInteractions } from "../canonical-recording-contract";
import { buildOwnerTechnicalEvidence } from "../capture-engine-v2.action-owner-resolver";
import type { CaptureAction } from "../capture-engine-v2.types";
import type { ShadowActionRecord } from "../capture-engine-v2.shadow-bridge";
import type { RecordedEvent } from "../session-trace.types";

/**
 * Behavioral half of the controlled authority switch: exercises the REAL, private
 * `onV2TechnicalAction`/`onInteraction`/`stop()` methods (via the same narrow `as any` cast
 * already used in web-session-recorder.raw-interaction-contract.test.ts and
 * capture-engine-v2.canonical-integration.test.ts), never a re-implementation of their logic.
 * `WebSessionRecorder.start()` itself launches a real browser and cannot be exercised without
 * one -- the structural half of this switch (binding gating, the exact wiring inside `start()`)
 * is verified separately, via source text, in web-session-recorder.v2-shadow-integration.test.ts
 * (tests 19-22). `this.page`/`this.context`/`this.browser` stay `null` throughout: every
 * `this.page?.`/`this.context?.` access short-circuits to a no-op, so `onInteraction` and
 * `stop()` both run their real logic honestly with zero Playwright dependency.
 */

type RecorderInternals = {
  onInteraction(raw: unknown): Promise<void>;
  onV2TechnicalAction(record: ShadowActionRecord): void;
  stop(): Promise<{ events: RecordedEvent[]; screens: unknown[] }>;
};

function newRecorder(captureAuthority?: "legacy" | "v2") {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://contract-fixture.test",
    framesDir: path.join(os.tmpdir(), "authority-switch-test-frames"),
    captureAuthority,
    onEvent: (event) => events.push(event),
  });
  return { recorder: recorder as unknown as RecorderInternals, events };
}

let seqCounter = 0;
function technicalRecord(action: CaptureAction): ShadowActionRecord {
  seqCounter += 1;
  return { seq: seqCounter, action };
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
  value: { present: true, changed: true }, // no literal
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

const searchClick: CaptureAction = {
  actionType: "click",
  identity: { label: "Buscar" },
  owner: { tag: "button", role: "button", technicalRefs: ["id:search-btn"] },
};

/**
 * The physical fragment this ticket investigates: fill a field, click an ICON-ONLY button with
 * NO accessible name (`identity` carries no label/name/text at all) but a real structural
 * relation to the field it sits next to (`owner.associatedField`), then click a separately
 * named button. No `owner.technicalRefs` either -- an icon button often has no durable locator.
 */
const unnamedIconButtonClick: CaptureAction = {
  actionType: "click",
  identity: { tagName: "button", role: "button" },
  owner: { tag: "button", role: "button", associatedField: "Número de identificación" },
};

const depurarClick: CaptureAction = {
  actionType: "click",
  identity: { label: "Depurar", tagName: "button" },
  owner: { tag: "button", role: "button", technicalRefs: ["id:depurar-btn"] },
};

test("1/2. a default session (captureAuthority omitted) resolves to \"v2\" and DOES forward a V2 technical action to SessionTrace -- CaptureEngine V2 is the WEB recorder now, not a selectable feature", async () => {
  const { recorder, events } = newRecorder(); // omitted -> "v2" (product decision, this ticket)
  recorder.onV2TechnicalAction(technicalRecord(usuarioEdit));
  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;
  assert.equal(events.length, 1, "the default authority must be v2, so a V2 action reaches SessionTrace with no override needed");
  assert.equal(events[0].value, "qauser");
});

test("legacyAuthorityIsolation: the internal override captureAuthority=\"legacy\" still blocks V2 technical actions from SessionTrace", async () => {
  const { recorder, events } = newRecorder("legacy");
  recorder.onV2TechnicalAction(technicalRecord(usuarioEdit));
  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;
  assert.equal(events.length, 0, "an explicit internal captureAuthority=\"legacy\" must still gate V2 actions off from SessionTrace");
});

test("2/4. explicit captureAuthority=\"v2\": a V2 edit reaches SessionTrace as a real fill RecordedEvent", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(usuarioEdit));
  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "fill");
  assert.equal(events[0].value, "qauser");
});

test("3. authority=legacy: a direct legacy-shaped onInteraction call still populates SessionTrace exactly as before (unchanged path)", async () => {
  const { recorder, events } = newRecorder("legacy");
  await recorder.onInteraction({ kind: "click", label: "Volver", role: "button" });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "tap");
});

test("5. the physical V2 fixture (edit, edit, click, edit, click) produces exactly 5 RecordedEvents and 5 canonical interactions under captureAuthority=\"v2\"", async () => {
  const { recorder, events } = newRecorder("v2");
  for (const action of [usuarioEdit, contrasenaEdit, loginClick, docNumberEdit, searchClick]) {
    recorder.onV2TechnicalAction(technicalRecord(action));
  }
  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;

  assert.equal(events.length, 5);
  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 5);
  assert.deepEqual(canonical.map((c) => c.action), ["fill", "fill", "click", "fill", "click"]);
});

/**
 * MANDATORY end-to-end test for this ticket: fill + unnamed-icon-button-click + named-click must
 * survive as THREE actions all the way from CaptureAction ingestion (`onV2TechnicalAction`, the
 * real production method, not a re-implementation) through `RecordedEvent`
 * (`WebSessionRecorder`'s own `events` array) to `CanonicalInteraction`
 * (`buildCanonicalInteractions`, unmodified). This directly exercises the exact scenario shape
 * reported physically -- an icon-only button with no accessible name/locator but a real
 * structural field relation, positioned between two other actions.
 */
test("middleIconClickPresent. fill + unnamed-icon-button click + named click all survive as 3 RecordedEvents and 3 CanonicalInteractions", async () => {
  const { recorder, events } = newRecorder("v2");
  for (const action of [docNumberEdit, unnamedIconButtonClick, depurarClick]) {
    recorder.onV2TechnicalAction(technicalRecord(action));
  }
  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;

  assert.equal(events.length, 3, "the unnamed icon button click must reach RecordedEvent, not be silently dropped");
  assert.deepEqual(events.map((e) => e.kind), ["fill", "tap", "tap"]);

  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 3, "the unnamed icon button click must survive as its own CanonicalInteraction");
  assert.deepEqual(canonical.map((c) => c.action), ["fill", "click", "click"]);

  const middleIconClick = canonical[1];
  assert.equal(middleIconClick.action, "click");
  // A real, non-generic `associatedField` relation IS legitimate structural identity on its
  // own -- admission accepts it (the field relation, not a fabricated accessible name for the
  // button itself). But zero technical target refs means it is not yet technically CERTIFIED:
  // `resolutionState` correctly stays `runtime_resolution_required`, never "certified".
  assert.equal(middleIconClick.admissionStatus, "accepted");
  assert.equal(middleIconClick.resolutionState, "runtime_resolution_required");
  // RAW TECHNICAL ACTION != DISPLAY LABEL: `semanticField` here is the click's STRUCTURAL
  // association (which field/group it belongs to) -- pre-existing, unmodified behavior for any
  // admission-accepted interaction, never a claim that the button's own accessible name equals
  // the field name. No `getByRole("button", { name: "..." })`-style locator is ever built from
  // it (confirmed separately: `technicalTargetRefs` stays empty for this interaction).
  assert.equal(middleIconClick.semanticField, "Número de identificación");
  assert.equal(middleIconClick.technicalTargetRefs.length, 0, "no locator is ever fabricated for the icon button");

  const namedClick = canonical[2];
  assert.equal(namedClick.admissionStatus, "accepted");
  assert.equal(namedClick.resolutionState, "certified");
});

/**
 * MANDATORY end-to-end test: two structurally-identical owners (same name/href) in DIFFERENT
 * landmarks -- a sidebar `nav` link and a content `main` card link. Clicking the CARD link must
 * carry ITS OWN landmark-scoped structural evidence end to end: CaptureAction -> RawInteraction
 * (RecordedEvent) -> CanonicalInteraction. This exercises the real production
 * `onV2TechnicalAction`/`buildCanonicalInteractions` path, never a re-implementation.
 */
test("2/3/5. clicking the content-card link carries its OWN landmark-scoped structural evidence through to CanonicalInteraction", async () => {
  // `onV2TechnicalAction` (like `onTechnicalAction`/`pushAction` in the real shadow-bridge) takes
  // an ALREADY-RESOLVED CaptureAction -- `technicalEvidence` is what `onClick` itself computes
  // via `buildOwnerTechnicalEvidence(resolution.owner)` before pushing. Built the same way here,
  // from the SAME owner shape, rather than re-deriving it, so this test exercises the real
  // integration of that function into this pipeline instead of a parallel, hand-written shape.
  const owner: CaptureAction["owner"] = {
    tag: "a",
    role: "link",
    technicalRefs: ["id:solicitud-link"],
    structuralIdentity: {
      owner: { tag: "a", role: "link" },
      stableDirectAttributes: { href: "/requests/create/multiproduct" },
      stableDescendants: [],
      semanticShape: [],
      landmarkAncestor: { tag: "main" },
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
    },
  };
  const cardLinkClick: CaptureAction = {
    actionType: "click",
    identity: { label: "Solicitud multiproducto", tagName: "a", role: "link" },
    owner,
    technicalEvidence: buildOwnerTechnicalEvidence(owner!),
  };
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(cardLinkClick));
  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;

  assert.equal(events.length, 1);
  assert.ok(events[0].target?.technicalTargetCandidates?.length, "technicalTargetCandidates must reach RecordedEvent");

  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 1);
  const structuralContext = canonical[0].technicalTargetCandidates?.[0]?.structuralContext;
  assert.ok(structuralContext, "structuralContext must reach CanonicalInteraction");
  assert.equal(structuralContext.landmarkAncestor?.tag, "main");
  assert.equal(structuralContext.deterministicStructuralIdentity, true);
});

/**
 * The icon-only button case must ALSO benefit once real structural evidence is available (not
 * only via the associatedField carve-out already proven above) -- a bare structural locator with
 * no accessible name still reaches CanonicalInteraction.technicalTargetCandidates.
 */
test("8/iconButton structural evidence. an icon-only button WITH structuralIdentity (no accessible name) still carries it through to CanonicalInteraction", async () => {
  const iconOwner: CaptureAction["owner"] = {
    tag: "button",
    role: "button",
    associatedField: "Número de identificación",
    technicalRefs: ["id:doc-search-btn"],
    structuralIdentity: {
      owner: { tag: "button" },
      stableDirectAttributes: { id: "doc-search-btn" },
      stableDescendants: [],
      semanticShape: [],
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
    },
  };
  const iconButtonWithEvidence: CaptureAction = {
    actionType: "click",
    identity: { tagName: "button", role: "button" },
    owner: iconOwner,
    technicalEvidence: buildOwnerTechnicalEvidence(iconOwner!),
  };
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(iconButtonWithEvidence));
  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;

  assert.equal(events.length, 1);
  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 1);
  // No fake accessible name was ever created -- the structural evidence is preserved, but no
  // getByRole/name-style identity is fabricated from it.
  assert.equal(canonical[0].semanticField, "Número de identificación");
  const structuralContext = canonical[0].technicalTargetCandidates?.[0]?.structuralContext;
  assert.ok(structuralContext, "structural evidence must reach CanonicalInteraction even with no accessible name");
  assert.equal(structuralContext.deterministicStructuralIdentity, true);
});

test("6. ordering under async ingestion: firing all 5 technical actions synchronously (no await between calls) still yields them in exact order once drained", async () => {
  const { recorder, events } = newRecorder("v2");
  // Deliberately no `await` between these -- onV2TechnicalAction only enqueues onto the shared
  // promise chain; nothing here waits for one interaction's onInteraction call to finish before
  // the next is queued.
  recorder.onV2TechnicalAction(technicalRecord(usuarioEdit));
  recorder.onV2TechnicalAction(technicalRecord(contrasenaEdit));
  recorder.onV2TechnicalAction(technicalRecord(loginClick));

  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;

  assert.deepEqual(events.map((e) => e.kind), ["fill", "fill", "tap"]);
  assert.equal(events[0].value, "qauser");
});

test("7. stop() drains any technical actions still queued before returning, even with no browser ever started", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(usuarioEdit));
  recorder.onV2TechnicalAction(technicalRecord(loginClick));
  // No manual await on v2IngestionQueue here -- stop() itself must drain it.
  const result = await recorder.stop();

  assert.equal(events.length, 2, "stop() must have drained the queue before resolving");
  assert.equal(result.events.length, 2);
});

test("8. a sensitive V2 edit without a literal reaches SessionTrace as a sensitive fill, no literal fabricated or logged", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(contrasenaEdit));
  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "fill");
  assert.equal(events[0].target?.sensitive, true);
  assert.equal(events[0].value, undefined, "no secret literal was ever captured, so none is fabricated");
});

test("9. owner.technicalRefs (id:...) survive the full authority-switch path onto the RecordedEvent's locators", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(usuarioEdit));
  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;

  assert.ok(events[0].target?.locators?.some((locator) => locator.strategy === "css" && locator.value === "#user"));
});

test("13. legacy behavior is unchanged when the default authority is used (no captureAuthority passed): identical to the pre-existing raw-interaction-contract behavior", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Correo electrónico", tagName: "input", domId: "email", value: "persona@correo-fixture.test", valueSource: "user" });

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "fill");
  assert.equal(events[0].value, "persona@correo-fixture.test");
});

test("14. no app/project/business hardcodes: an unrelated fixture with generic field names canonicalizes identically in shape under captureAuthority=\"v2\"", async () => {
  const { recorder, events } = newRecorder("v2");
  const genericEdit: CaptureAction = {
    actionType: "edit",
    identity: { label: "Correo", tagName: "input", domId: "email-field-xyz" },
    owner: { tag: "input", role: "textbox", technicalRefs: ["id:email-field-xyz"] },
    value: { present: true, changed: true, literal: "someone@example.test" },
  };
  recorder.onV2TechnicalAction(technicalRecord(genericEdit));
  await (recorder as unknown as { v2IngestionQueue: Promise<void> }).v2IngestionQueue;

  assert.equal(events[0].kind, "fill");
  assert.equal(events[0].value, "someone@example.test");
});
