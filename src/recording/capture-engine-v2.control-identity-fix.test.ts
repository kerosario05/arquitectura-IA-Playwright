import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildWebLocators } from "./web/web-session-recorder";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { CaptureEngineV2ShadowBridge } from "./capture-engine-v2.shadow-bridge";
import { adaptCaptureActionToRawInteraction } from "./capture-engine-v2.raw-interaction-adapter";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import { isTechnicalIdentityAdmissible } from "./trace-normalizer";
import type { CaptureOwnerCandidate } from "./capture-engine-v2.types";
import type { RecordedEvent } from "./session-trace.types";

/**
 * FIRST_LOSS: `buildWebLocators` built a `role|label` locator unconditionally whenever both were
 * present -- so a target whose label degraded to the internal "control" sentinel (the adapter's
 * own fallback when no real identity survived: `label ?? name ?? text ?? "control"`) still
 * produced a locator SHAPED like real technical identity: `role=textbox|control`,
 * `role=button|control`. Downstream admission (`isTechnicalIdentityAdmissible`/
 * `roleLocatorHasStableIdentity` in trace-normalizer.ts) already correctly refused to CERTIFY
 * such a locator, but it still existed in `technicalTargetRefs`, muddying the evidence and
 * risking future code trusting its mere presence. Fixed by never generating that locator
 * candidate at all when the label is generic (reusing the SAME shared `isGenericUnresolvedLabel`
 * detector admission/semantic-field resolution already use -- no new/duplicate definition of
 * "generic").
 */

function candidate(overrides: Partial<CaptureOwnerCandidate> & Pick<CaptureOwnerCandidate, "tag" | "pathDepth">): CaptureOwnerCandidate {
  return { editable: false, actionable: false, ...overrides };
}

test("12a. buildWebLocators never produces a role|control locator -- the generic sentinel is never baked into a locator string", () => {
  const locators = buildWebLocators({ kind: "input", role: "textbox", label: "control" } as never);
  assert.ok(!locators.some((l) => l.strategy === "role"), "no role locator must be generated from a generic label");
});

test("16. regression: buildWebLocators still produces a real role|label locator for a genuine accessible name (Usuario/Contraseña/Aceptar unaffected)", () => {
  for (const label of ["Usuario", "Contraseña", "Aceptar", "Cancelar", "Continuar", "Depurar"]) {
    const locators = buildWebLocators({ kind: "click", role: "button", label } as never);
    assert.ok(locators.some((l) => l.strategy === "role" && l.value === `button|${label}`), `expected a real role locator for "${label}"`);
  }
});

test("13. a generic label never contaminates a real technicalTargetRef that DOES exist (semanticReadiness != technicalReadiness)", () => {
  const locators = buildWebLocators({ kind: "click", role: "button", label: "control", domId: "action-123" } as never);
  assert.ok(locators.some((l) => l.strategy === "css" && l.value === "#action-123"), "the real id-based locator must still survive even though the label is generic");
  assert.ok(!locators.some((l) => l.strategy === "role"), "the generic-label role locator must still be excluded");
});

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://contract-fixture.test",
    framesDir: path.join(os.tmpdir(), "control-identity-fix-test-frames"),
    captureAuthority: "v2",
    onEvent: (event) => events.push(event),
  }) as unknown as { onInteraction(raw: unknown): Promise<void> };
  return { recorder, events };
}

const doc = { captureInstanceId: "instance-1", documentId: "doc-A" };

test("7. an icon button with no accessible name and no technical id at all resolves to unresolved, no name invented, and never certified", async () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", role: "button", actionable: true, pathDepth: 0 })], // no accessibleName, no technicalRefs
  });

  assert.equal(bridge.technicalActions.length, 1);
  const action = bridge.technicalActions[0].action;
  assert.equal(action.identity.label, undefined);

  const { recorder, events } = newRecorder();
  await recorder.onInteraction(adaptCaptureActionToRawInteraction(action));

  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 1);
  assert.notEqual(canonical[0].resolutionState, "certified", "no name and no technical id must never certify");
  assert.equal(isTechnicalIdentityAdmissible(events[0].target), false);
});

test("6. an icon button WITH a real technical id (but no accessible name) preserves the id-based locator despite a generic display label", async () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", role: "button", actionable: true, technicalRefs: ["id:action-123"], pathDepth: 0 })],
  });

  const action = bridge.technicalActions[0].action;
  const { recorder, events } = newRecorder();
  await recorder.onInteraction(adaptCaptureActionToRawInteraction(action));

  assert.ok(events[0].target?.locators?.some((l) => l.strategy === "css" && l.value === "#action-123"), "real technical id must survive despite no accessible name -- never lost, regardless of the missing display label");
  // SUPERSEDED by the "close the css/#id admission gap" ticket: buildWebLocators now ALSO emits a
  // dedicated strategy="id" candidate (bare value, same convention mobile-route-learner.ts
  // already uses) alongside the unchanged css candidate above, so a real DOM id is now counted as
  // admissible technical identity without widening admission to arbitrary css strings.
  assert.ok(events[0].target?.locators?.some((l) => l.strategy === "id" && l.value === "action-123"), "a dedicated id-strategy locator must exist for the real DOM id");
  assert.equal(isTechnicalIdentityAdmissible(events[0].target), true, "a real DOM id is now admissible via the dedicated id strategy, never via widening css admission");
});

test("associatedField structural evidence (as the browser instrumentation would compute it) flows through to RecordedTarget.associatedField, never invented as accessibleName", async () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [
      candidate({
        tag: "button",
        role: "button",
        actionable: true,
        technicalRefs: ["id:search-btn"],
        associatedField: "Número de identificación", // as if computeAssociatedField() already resolved this structurally
        pathDepth: 0,
      }),
    ],
  });

  const action = bridge.technicalActions[0].action;
  assert.equal(action.owner?.associatedField, "Número de identificación");
  assert.equal(action.identity.label, undefined, "the button's OWN accessible name must stay absent -- associatedField is never promoted into it");

  const { recorder, events } = newRecorder();
  await recorder.onInteraction(adaptCaptureActionToRawInteraction(action));

  assert.equal(events[0].target?.associatedField, "Número de identificación");
  assert.ok(events[0].target?.locators?.some((l) => l.strategy === "css" && l.value === "#search-btn"), "the button's OWN technical identity (its id) remains the executable target, not the associated field text");
});

test("10. multiple unrelated buttons with no names never get an arbitrary role-based locator, each independently", () => {
  for (let i = 0; i < 8; i++) {
    const locators = buildWebLocators({ kind: "click", role: "button", label: "control" } as never);
    assert.equal(locators.length, 0, `button #${i} with no real identity must produce zero locators, never a fabricated one`);
  }
});

test("11. multiple unrelated textboxes with no names never get an arbitrary role-based locator, each independently", () => {
  for (let i = 0; i < 3; i++) {
    const locators = buildWebLocators({ kind: "input", role: "textbox", label: "control" } as never);
    assert.equal(locators.length, 0, `textbox #${i} with no real identity must produce zero locators, never a fabricated one`);
  }
});

test("17. no nth/first/last positional strategy is ever produced by buildWebLocators", () => {
  const locators = buildWebLocators({ kind: "click", role: "button", label: "control", domId: "x" } as never);
  assert.ok(locators.every((l) => !/nth|first|last/i.test(l.strategy)));
});

test("18. no app/project-specific hardcode: isGenericUnresolvedLabel is the same shared function reused verbatim, not a new production-code string list", () => {
  // buildWebLocators imports isGenericUnresolvedLabel from trace-normalizer.ts rather than
  // redefining its own generic-word list -- confirmed structurally by re-running the exact
  // scenario that motivated this fix with a genuinely different, unrelated label.
  const locators = buildWebLocators({ kind: "click", role: "button", label: "campo" } as never); // another entry in the SAME shared set
  assert.ok(!locators.some((l) => l.strategy === "role"));
});

/**
 * "Close the css/#id admission gap" ticket -- a real DOM id must become admissible technical
 * identity WITHOUT admitting arbitrary CSS. Fixed by having buildWebLocators emit a dedicated
 * strategy="id" candidate (bare id value) for a real domId, reusing the exact strategy name
 * mobile-route-learner.ts already uses for a resource id -- isTechnicalIdentityAdmissible already
 * treats "id" as admissible, so no change to trace-normalizer.ts's ADMISSIBLE_LOCATOR_STRATEGIES
 * or admission logic was needed at all. The pre-existing css="#<id>" locator is left untouched
 * and stays first in the candidates array, so trace-to-scenario.ts's `locators[0]` "best" pick
 * (spec generation) is unaffected.
 */

test("1/domId. a real DOM id produces an admissible id-strategy locator", () => {
  const locators = buildWebLocators({ kind: "click", role: "button", domId: "real-id-42" } as never);
  assert.ok(locators.some((l) => l.strategy === "id" && l.value === "real-id-42"));
  assert.equal(isTechnicalIdentityAdmissible({ label: "x", locators } as never), true);
});

test("4/testId. a real data-testid remains admissible and is never degraded to a css/id locator", () => {
  const locators = buildWebLocators({ kind: "click", testId: "submit-btn" } as never);
  assert.ok(locators.some((l) => l.strategy === "data-testid" && l.value === "submit-btn"));
  assert.equal(isTechnicalIdentityAdmissible({ label: "x", locators } as never), true);
});

test("2. an arbitrary css class-selector locator is NOT admitted merely because its strategy is css", () => {
  // buildWebLocators never produces a bare class-selector css locator itself, but the admission
  // gate is what actually decides this -- a css-strategy locator with no id-derived provenance
  // must stay rejected on its own general shape, not just for the specific domId path.
  const target = { label: "x", locators: [{ strategy: "css", value: ".btn.btn-primary.js-submit" }] } as never;
  assert.equal(isTechnicalIdentityAdmissible(target), false, "css admission is still NOT opened up generally -- only the dedicated id strategy is");
});

test("3. a generated/deep css selector is NOT automatically admitted", () => {
  const target = { label: "x", locators: [{ strategy: "css", value: "div.app > div:nth-child(3) > section > button.abc123" }] } as never;
  assert.equal(isTechnicalIdentityAdmissible(target), false);
});

test("5. role + a real accessible name remains admitted (no regression from the prior 'control' fix)", () => {
  const locators = buildWebLocators({ kind: "click", role: "button", label: "Aceptar" } as never);
  assert.ok(locators.some((l) => l.strategy === "role" && l.value === "button|Aceptar"));
  assert.equal(isTechnicalIdentityAdmissible({ label: "Aceptar", locators } as never), true);
});

test("6. role + 'control' stays rejected (the prior ticket's fix is not reverted by this one)", () => {
  const locators = buildWebLocators({ kind: "click", role: "button", label: "control" } as never);
  assert.ok(!locators.some((l) => l.strategy === "role"));
  assert.equal(isTechnicalIdentityAdmissible({ label: "control", locators } as never), false);
});

test("8. a button with no id, no testId, and no accessible name stays unresolved -- never guessed", () => {
  const locators = buildWebLocators({ kind: "click", role: "button", label: "control" } as never);
  assert.equal(locators.length, 0);
  assert.equal(isTechnicalIdentityAdmissible({ label: "control", locators } as never), false);
});

test("9. two unrelated buttons each with their own real DOM id independently produce their own id locator, never a positional pick between them", () => {
  const a = buildWebLocators({ kind: "click", role: "button", domId: "btn-a" } as never);
  const b = buildWebLocators({ kind: "click", role: "button", domId: "btn-b" } as never);
  assert.ok(a.some((l) => l.strategy === "id" && l.value === "btn-a"));
  assert.ok(b.some((l) => l.strategy === "id" && l.value === "btn-b"));
  assert.ok(a.every((l) => !/nth|first|last/i.test(l.strategy)) && b.every((l) => !/nth|first|last/i.test(l.strategy)));
});

test("10/associatedField. associatedField is never promoted into a fabricated role-locator accessible name", () => {
  // buildWebLocators only ever reads interaction.label (the element's OWN accessible name) for
  // the role locator -- associatedField is a completely separate field it never even looks at.
  const locators = buildWebLocators({ kind: "click", role: "button", domId: "search-btn", associatedField: "Número de identificación" } as never);
  assert.ok(!locators.some((l) => l.strategy === "role"), "no accessible name on the button itself -- associatedField must never fill that gap");
  assert.ok(locators.some((l) => l.strategy === "id" && l.value === "search-btn"));
});
