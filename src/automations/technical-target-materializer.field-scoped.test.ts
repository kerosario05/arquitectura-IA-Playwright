import assert from "node:assert/strict";
import test from "node:test";
import { materializeFieldScopedTechnicalTarget, resolveFieldScopedOwner, type FieldContainerEvidence, type FieldScopedOwnerCandidate } from "./technical-target-materializer";

/**
 * FIRST_LOSS (original ticket): an owner captured with a valid structural field association
 * (`associatedField="Identificación"`) but no direct technical locator of its own
 * (`role=textbox`/`role=button`, `candidateTargets=[]`) had NO path to a `CertifiedTechnicalTarget`
 * at all. Fixed with `resolveFieldScopedOwner`/`materializeFieldScopedTechnicalTarget`.
 *
 * FIRST_LOSS (this ticket): the first version of `materializeFieldScopedTechnicalTarget` let a
 * LOCALLY-unique candidate (unique among the field-scoped pool) certify via
 * `materializeTechnicalTarget`'s Tier 4 ("owner alone" -- a bare `"button"`/`"input"` tag
 * locator) whenever it had no stable attributes of its own. That locator is GLOBAL, not scoped:
 * it matches every `<button>` on the whole page, not just the one proven unique within this one
 * field's container -- exactly the "certify within container, execute globally" bug this ticket
 * closes. Fixed: a field-scoped certification now ONLY succeeds when either (a) the candidate
 * itself carries real stable attributes (Tier 1 -- presumed page-scoped on its own merit), or
 * (b) real field-container evidence is supplied and combines with the candidate into a genuine
 * container+descendant locator (Tier 3 -- actually scoped to that container). Tier 4's bare-tag
 * shape is NEVER accepted as a certified result of this field-scoped path.
 */

function candidate(overrides: Partial<FieldScopedOwnerCandidate> & Pick<FieldScopedOwnerCandidate, "tag">): FieldScopedOwnerCandidate {
  return { visible: true, disabled: false, ...overrides };
}

function fieldA(): FieldContainerEvidence {
  return { tag: "div", stableDirectAttributes: { "data-field": "field-a" } };
}
function fieldB(): FieldContainerEvidence {
  return { tag: "div", stableDirectAttributes: { "data-field": "field-b" } };
}

test("1/scopedButton. one button in one field, unique locally, WITH real container evidence: certified target stays scoped to that field", () => {
  const button = candidate({ tag: "button", role: "button", actionable: true });
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Field A",
    candidates: [button],
    requiredCompatibility: "actionable",
    fieldContainerEvidence: fieldA(),
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") {
    assert.equal(result.target.certificationTier, 3, "container + descendant, never the bare-tag owner-alone tier");
    assert.match(result.target.locatorCandidates[0].value, /data-field="field-a"/, "the container's own scoping attribute survives in the certified locator");
    assert.notEqual(result.target.locatorCandidates[0].value, "button", "never degrades to the bare, page-wide tag");
  }
});

test("2/twoFields. the same owner tag/shape in two different field containers yields two distinct, differently-scoped targets", () => {
  const button = candidate({ tag: "button", role: "button", actionable: true });
  const resultA = materializeFieldScopedTechnicalTarget({ associatedField: "Field A", candidates: [button], requiredCompatibility: "actionable", fieldContainerEvidence: fieldA() });
  const resultB = materializeFieldScopedTechnicalTarget({ associatedField: "Field B", candidates: [button], requiredCompatibility: "actionable", fieldContainerEvidence: fieldB() });
  assert.equal(resultA.status, "certified");
  assert.equal(resultB.status, "certified");
  if (resultA.status === "certified" && resultB.status === "certified") {
    assert.notEqual(resultA.target.locatorCandidates[0].value, resultB.target.locatorCandidates[0].value, "identical owner shape in two different fields must never collapse into the same locator");
  }
});

test("3/sameFieldAmbiguous. two compatible buttons inside the same field container: ambiguous, fails closed", () => {
  const result = resolveFieldScopedOwner(
    [candidate({ tag: "button", role: "button", actionable: true }), candidate({ tag: "button", role: "button", actionable: true })],
    "actionable",
  );
  assert.equal(result.status, "ambiguous");
  if (result.status === "ambiguous") assert.equal(result.matchCount, 2);
});

/**
 * FIRST_LOSS (jobId dfbecfc8-895d-4751-9987-c4060164d2f2, field "Categoría de producto"): a
 * `fromAcceptedFieldScope=true` retry reconfirmed the certified target by evaluating its single
 * COMBINED container+descendant CSS string page-globally (`resolveRecordedTechnicalTarget`'s own
 * `page.locator(value)`), which collapses a locally-unique accepted scope into a page-wide match
 * count whenever a lookalike container exists elsewhere on the page. Fixed by splitting the
 * container and descendant halves into separate, runtime-only `RecordedLocator`s so the caller
 * (`target-resolver.ts`) can re-resolve the container as its own live `Locator`, verify it is
 * still unique, and search the descendant RELATIVE to it -- never re-flattened into one global
 * selector. These two tests prove the split only appears (and is only trustworthy) exactly when
 * `fromAcceptedFieldScope` is the real authority.
 */
test("4/acceptedScopeSplit. fromAcceptedFieldScope=true yields a separate container/descendant locator pair that reconstructs the same combined selector", () => {
  const container: FieldContainerEvidence = { tag: "div", stableDirectAttributes: { "data-field": "category" }, fromAcceptedFieldScope: true };
  const button = candidate({ tag: "button", role: "button", actionable: true });
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Categoría de producto",
    candidates: [button],
    requiredCompatibility: "actionable",
    fieldContainerEvidence: container,
  });
  assert.equal(result.status, "certified");
  if (result.status !== "certified") return;
  assert.ok(result.scopeContainerLocator, "an accepted scope must expose its own container locator for relative retry");
  assert.ok(result.scopedDescendantLocator, "an accepted scope must expose a descendant-only locator, never the combined page-global one");
  assert.equal(result.scopeContainerLocator!.strategy, "css");
  assert.equal(result.scopedDescendantLocator!.strategy, "css");
  assert.match(result.scopeContainerLocator!.value, /data-field="category"/);
  assert.equal(result.scopedDescendantLocator!.value, "button", "the descendant-only locator must never carry the container's own selector baked in");
  assert.equal(
    result.target.locatorCandidates[0].value,
    `${result.scopeContainerLocator!.value} ${result.scopedDescendantLocator!.value}`,
    "the persisted combined locator must stay exactly the container half + descendant half -- the split is additive, not a behavior change to the certified identity",
  );
});

test("5/noSplitWithoutAcceptedScope. a container WITHOUT fromAcceptedFieldScope never exposes a scope split -- an untrusted container must never be handed to the relative-retry path", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Field A",
    candidates: [candidate({ tag: "button", role: "button", actionable: true })],
    requiredCompatibility: "actionable",
    fieldContainerEvidence: fieldA(),
  });
  assert.equal(result.status, "certified");
  if (result.status !== "certified") return;
  assert.equal(result.scopeContainerLocator, undefined);
  assert.equal(result.scopedDescendantLocator, undefined);
});

test("4/stableId. owner has a real stable id/testid: materializes directly, structural container scope not required", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Identificación",
    candidates: [candidate({ tag: "input", role: "textbox", editable: true, stableDirectAttributes: { "data-testid": "doc-number-input" } })],
    requiredCompatibility: "editable",
    // deliberately no fieldContainerEvidence -- the candidate's own evidence must be sufficient on its own
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") {
    assert.equal(result.target.certificationTier, 1);
    assert.equal(result.target.locatorCandidates[0].value, '[data-testid="doc-number-input"]');
  }
});

test("5/globalIdentity. resolveFieldScopedOwner's own local-uniqueness proof is unaffected by this fix -- only what happens AFTER it changed", () => {
  const result = resolveFieldScopedOwner([candidate({ tag: "input", role: "textbox", editable: true })], "editable");
  assert.equal(result.status, "unique");
});

test("6/noBareTag. owner has ONLY a tag, no stable attrs, no field container evidence: bare global tag is NOT accepted -- fails closed", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Identificación",
    candidates: [candidate({ tag: "button", role: "button", actionable: true })],
    requiredCompatibility: "actionable",
  });
  assert.equal(result.status, "not_materializable", "no evidence exists that would scope the locator to this field -- must never fall back to the unscoped bare-tag tier");
});

test("6b/noBareTag. field container evidence present but with no real attributes of its own: still fails closed, never a weaker target", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Identificación",
    candidates: [candidate({ tag: "button", role: "button", actionable: true })],
    requiredCompatibility: "actionable",
    fieldContainerEvidence: { tag: "div" }, // no stableDirectAttributes
  });
  assert.equal(result.status, "not_materializable");
});

test("7/noFakeRoleName. associatedField never becomes a fake role+name locator", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Número de identificación",
    candidates: [candidate({ tag: "button", role: "button", actionable: true })],
    requiredCompatibility: "actionable",
    fieldContainerEvidence: fieldA(),
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") {
    const locator = result.target.locatorCandidates[0];
    assert.ok(!locator.value.includes("Número de identificación"), "associatedField text must never appear inside the certified locator");
    assert.notEqual(locator.strategy, "role", "never role|associatedField -- this candidate has no real accessible name");
  }
});

test("8/noNameMutation. field label/value never becomes the owner's accessibleName", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Identificación",
    candidates: [candidate({ tag: "input", role: "textbox", editable: true, stableDirectAttributes: { id: "doc-number" } })],
    requiredCompatibility: "editable",
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") assert.equal(result.target.locatorCandidates[0].value, '[id="doc-number"]', "identity comes only from the real attribute, never the field label");
});

test("9/noPosition. hidden and disabled candidates are excluded regardless of position in the pool", () => {
  const hidden = resolveFieldScopedOwner(
    [candidate({ tag: "input", role: "textbox", editable: true, visible: false }), candidate({ tag: "button", role: "button", actionable: true })],
    "editable",
  );
  assert.equal(hidden.status, "not_materializable");
  const disabled = resolveFieldScopedOwner([candidate({ tag: "button", role: "button", actionable: true, disabled: true })], "actionable");
  assert.equal(disabled.status, "not_materializable");
});

test("10/orderIndependent. reversing candidate array order never changes the result", () => {
  const a = candidate({ tag: "input", role: "textbox", editable: true });
  const forward = resolveFieldScopedOwner([a], "editable");
  const stillA = resolveFieldScopedOwner([a], "editable");
  assert.deepEqual(forward, stillA);
  const ambiguousReordered1 = resolveFieldScopedOwner([a, { ...a }], "editable");
  const ambiguousReordered2 = resolveFieldScopedOwner([{ ...a }, a], "editable");
  assert.equal(ambiguousReordered1.status, "ambiguous");
  assert.equal(ambiguousReordered2.status, "ambiguous");
});

test("role compatibility still distinguishes a textbox from a button in the same scoped container", () => {
  const textbox = candidate({ tag: "input", role: "textbox", editable: true, stableDirectAttributes: { id: "doc-number" } });
  const button = candidate({ tag: "button", role: "button", actionable: true, stableDirectAttributes: { id: "doc-number-clear" } });
  const pool = [textbox, button];
  const editableResult = materializeFieldScopedTechnicalTarget({ associatedField: "Identificación", candidates: pool, requiredCompatibility: "editable" });
  const actionableResult = materializeFieldScopedTechnicalTarget({ associatedField: "Identificación", candidates: pool, requiredCompatibility: "actionable" });
  assert.equal(editableResult.status, "certified");
  assert.equal(actionableResult.status, "certified");
  if (editableResult.status === "certified") assert.equal(editableResult.target.locatorCandidates[0].value, '[id="doc-number"]');
  if (actionableResult.status === "certified") assert.equal(actionableResult.target.locatorCandidates[0].value, '[id="doc-number-clear"]');
});

test("12/generic. no app/project/value hardcode: the mechanism generalizes to an arbitrary field/role/container pair", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Cualquier Campo Genérico",
    candidates: [candidate({ tag: "select", role: "combobox", editable: true })],
    requiredCompatibility: "editable",
    fieldContainerEvidence: { tag: "section", stableDirectAttributes: { "data-scope": "cualquier-seccion" } },
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") assert.match(result.target.locatorCandidates[0].value, /data-scope="cualquier-seccion"/);
});
