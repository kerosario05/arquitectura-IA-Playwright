import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, deriveRelatedStateSurfaceEvidence, type RelatedStateMutationRecord } from "./canonical-recording-contract";
import type { RecordedEvent } from "./session-trace.types";

/**
 * Related-state surface evidence: a redacted, structurally-identified surface causally mutated by a
 * trusted click, SEPARATE from `associatedField` (which stays field-relation authority). Captured
 * from the recorder's existing mutation observation and certified fail-closed: exactly ONE distinct
 * changed node (never the owner, never document-level) -> evidence; zero or multiple -> none.
 * Never consults text, position, coordinates, or values.
 */

function rec(nodeIdentity: string, kind: string, attributeName?: string): RelatedStateMutationRecord {
  return attributeName ? { nodeIdentity, kind, attributeName } : { nodeIdentity, kind };
}

const OWNER = "button|role=button";
const DISPLAY = "div|id=amount-display";

test("1/localStateSurface. a distinct locally-related display mutation certifies the surface", () => {
  const evidence = deriveRelatedStateSurfaceEvidence({
    sourceInteractionId: "interaction-7",
    sourceOwnerIdentity: OWNER,
    relationKind: "local_container",
    containerIdentity: "div|role=dialog",
    mutations: [rec(DISPLAY, "characterData")],
  });
  assert.ok(evidence, "one distinct changed node certifies");
  assert.equal(evidence!.changedNodeIdentity, DISPLAY);
  assert.deepEqual(evidence!.changeKinds, ["characterData"]);
  assert.equal(evidence!.sourceInteractionId, "interaction-7");
  assert.equal(evidence!.relationKind, "local_container");
  assert.equal(evidence!.certificationKind, "causal_local_mutation");
});

test("2/sameInteractionOwnership. the evidence carries the source interaction id", () => {
  const evidence = deriveRelatedStateSurfaceEvidence({
    sourceInteractionId: "interaction-7",
    sourceOwnerIdentity: OWNER,
    relationKind: "local_container",
    mutations: [rec(DISPLAY, "attributes", "value")],
  });
  assert.equal(evidence!.sourceInteractionId, "interaction-7");
});

test("3/ownerOnly. a change to the clicked owner alone never fabricates a related surface", () => {
  const evidence = deriveRelatedStateSurfaceEvidence({
    sourceInteractionId: "interaction-7",
    sourceOwnerIdentity: OWNER,
    relationKind: "local_container",
    mutations: [rec(OWNER, "attributes", "class")],
  });
  assert.equal(evidence, undefined);
});

test("4/unrelatedGlobal. a document/body-level mutation is never a related state surface", () => {
  const evidence = deriveRelatedStateSurfaceEvidence({
    sourceInteractionId: "interaction-7",
    sourceOwnerIdentity: OWNER,
    relationKind: "local_container",
    mutations: [rec("document", "childList"), rec("body", "childList")],
  });
  assert.equal(evidence, undefined);
});

test("5/multipleCandidates. two distinct changed nodes fail closed (never first/nth/order)", () => {
  const evidence = deriveRelatedStateSurfaceEvidence({
    sourceInteractionId: "interaction-7",
    sourceOwnerIdentity: OWNER,
    relationKind: "local_container",
    mutations: [rec(DISPLAY, "characterData"), rec("div|id=other", "attributes", "value")],
  });
  assert.equal(evidence, undefined);
});

test("6/propertyChange. an attribute/value mutation is capturable as a structural change kind", () => {
  const evidence = deriveRelatedStateSurfaceEvidence({
    sourceInteractionId: "interaction-7",
    sourceOwnerIdentity: OWNER,
    relationKind: "local_container",
    mutations: [rec(DISPLAY, "attributes", "value")],
  });
  assert.ok(evidence);
  assert.deepEqual(evidence!.changeKinds, ["attributes"]);
});

test("7/localDomChange. a characterData (text) mutation on the display is capturable", () => {
  const evidence = deriveRelatedStateSurfaceEvidence({
    sourceInteractionId: "interaction-7",
    sourceOwnerIdentity: OWNER,
    relationKind: "local_container",
    mutations: [rec(DISPLAY, "characterData"), rec(DISPLAY, "childList")],
  });
  assert.ok(evidence);
  assert.deepEqual(evidence!.changeKinds.sort(), ["characterData", "childList"]);
});

test("8/selfLabelRegression. a button label is never promoted to related-state authority", () => {
  const evidence = deriveRelatedStateSurfaceEvidence({
    sourceInteractionId: "interaction-7",
    sourceOwnerIdentity: "button|role=button",
    relationKind: "local_container",
    mutations: [rec("button|role=button", "attributes", "class")],
  });
  assert.equal(evidence, undefined);
});

test("9/noAuthority. no mutations -> no evidence (fail closed)", () => {
  assert.equal(
    deriveRelatedStateSurfaceEvidence({ sourceInteractionId: "i", sourceOwnerIdentity: OWNER, relationKind: "local_container", mutations: [] }),
    undefined,
  );
});

test("10/noValueSerialized. the evidence contains identity + kind only, never a value", () => {
  const evidence = deriveRelatedStateSurfaceEvidence({
    sourceInteractionId: "interaction-7",
    sourceOwnerIdentity: OWNER,
    relationKind: "local_container",
    mutations: [rec(DISPLAY, "characterData")],
  });
  const json = JSON.stringify(evidence);
  assert.equal(json.includes("40229999"), false);
  assert.equal(json.includes("value"), false);
});

test("11/roundTrip. a trusted click's post_action observation reaches the canonical interaction as relatedStateSurfaceEvidence", () => {
  const events: RecordedEvent[] = [
    { seq: 0, t: 100, kind: "tap", screenKey: "s1", target: { label: "4", role: "button", eventTargetRef: "owner-ref", locators: [{ strategy: "role", value: "button|4" }] } as RecordedEvent["target"] },
    { seq: 1, t: 300, kind: "note", screenKey: "s1", observationType: "post_action", target: { label: "4", role: "button", dynamicLifecycle: { triggerTechnicalTarget: "owner-ref", relatedStateOwnerIdentity: "button|role=button", relatedStateContainerIdentity: "div|role=dialog", relatedStateMutations: [{ nodeIdentity: "div|id=display", kind: "characterData" }] } } as RecordedEvent["target"] },
  ];
  const interactions = buildCanonicalInteractions(events);
  const click = interactions.find((interaction) => interaction.action === "click");
  assert.ok(click, "the tap becomes a click interaction");
  assert.ok(click!.relatedStateSurfaceEvidence, "the related state surface is attached to the interaction");
  assert.equal(click!.relatedStateSurfaceEvidence!.changedNodeIdentity, "div|id=display");
  assert.equal(click!.relatedStateSurfaceEvidence!.sourceInteractionId, click!.id);
  assert.equal(click!.relatedStateSurfaceEvidence!.relationKind, "local_container");
});

test("12/legacy. a tap with no post_action observation carries no relatedStateSurfaceEvidence", () => {
  const events: RecordedEvent[] = [
    { seq: 0, t: 100, kind: "tap", screenKey: "s1", target: { label: "Continuar", role: "button", eventTargetRef: "owner-ref", locators: [{ strategy: "data-testid", value: "continue" }] } as RecordedEvent["target"] },
  ];
  const interactions = buildCanonicalInteractions(events);
  const click = interactions.find((interaction) => interaction.action === "click");
  assert.ok(click, "the tap still becomes a click interaction (legacy unaffected)");
  assert.equal(click!.relatedStateSurfaceEvidence, undefined);
});
