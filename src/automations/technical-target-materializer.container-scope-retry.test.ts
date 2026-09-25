import assert from "node:assert/strict";
import test from "node:test";
import { materializeFieldScopedTechnicalTarget, type FieldScopedOwnerCandidate } from "./technical-target-materializer";

/**
 * FIRST_LOSS (jobId 2949de20-78b9-4ab8-a20c-c9396d4e00dc): a click's field-scoped owner had its
 * own "stable" direct attribute (Tier 1) and materialized as `certified`, but that attribute
 * turned out NOT to be page-globally unique -- discoverable only at runtime revalidation
 * (`certified_target_runtime_ambiguous`). The caller (`tryFieldScopedStructuralFallback` in
 * target-resolver.ts) then gave up entirely, even though the SAME field-scope climb already
 * proved a real container that could produce a genuinely-scoped Tier-3 locator instead.
 *
 * `requireContainerScope` lets that caller retry with the container folded in, without touching
 * the default priority (own evidence first) for every already-succeeding case -- verified here in
 * isolation, since target-resolver.ts's retry wiring itself is covered by the companion
 * static-source test (this file's "no browser" convention, see
 * target-resolver.click-field-scoped-fallback-gate.test.ts).
 */

function candidate(overrides: Partial<FieldScopedOwnerCandidate> & Pick<FieldScopedOwnerCandidate, "tag">): FieldScopedOwnerCandidate {
  return { visible: true, disabled: false, ...overrides };
}

test("1/defaultUnchanged. without the option, own-evidence Tier 1 still wins exactly as before", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "FIELD",
    candidates: [candidate({ tag: "button", role: "button", actionable: true, stableDirectAttributes: { "data-icon": "chevron" } })],
    requiredCompatibility: "actionable",
    fieldContainerEvidence: { tag: "div", stableDirectAttributes: { "data-stable": "field-wrapper" } },
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") {
    assert.equal(result.target.certificationTier, 1);
    assert.equal(result.target.locatorCandidates[0].value, '[data-icon="chevron"]');
  }
});

test("2/requireContainerScope. the same input, retried with the option, produces a container-scoped Tier 3 locator instead of the bare candidate attribute", () => {
  const result = materializeFieldScopedTechnicalTarget(
    {
      associatedField: "FIELD",
      candidates: [candidate({ tag: "button", role: "button", actionable: true, stableDirectAttributes: { "data-icon": "chevron" } })],
      requiredCompatibility: "actionable",
      fieldContainerEvidence: { tag: "div", stableDirectAttributes: { "data-stable": "field-wrapper" } },
    },
    { requireContainerScope: true },
  );
  assert.equal(result.status, "certified");
  if (result.status === "certified") {
    assert.equal(result.target.certificationTier, 3);
    assert.match(result.target.locatorCandidates[0].value, /\[data-stable="field-wrapper"\] button\[data-icon="chevron"\]/);
  }
});

test("3/noContainerNoFabrication. requireContainerScope with no usable container evidence fails closed -- never fabricates a bare-tag/global locator", () => {
  const result = materializeFieldScopedTechnicalTarget(
    {
      associatedField: "FIELD",
      candidates: [candidate({ tag: "button", role: "button", actionable: true, stableDirectAttributes: { "data-icon": "chevron" } })],
      requiredCompatibility: "actionable",
      // no fieldContainerEvidence at all
    },
    { requireContainerScope: true },
  );
  assert.equal(result.status, "not_materializable");
});

test("4/ambiguousOwnerUnaffected. two locally-actionable owners still fail ambiguous regardless of the option -- resolveFieldScopedOwner's own gate is untouched", () => {
  const result = materializeFieldScopedTechnicalTarget(
    {
      associatedField: "FIELD",
      candidates: [
        candidate({ tag: "button", role: "button", actionable: true }),
        candidate({ tag: "button", role: "button", actionable: true }),
      ],
      requiredCompatibility: "actionable",
    },
    { requireContainerScope: true },
  );
  assert.equal(result.status, "ambiguous");
});

test("5/fillRegression. editable/fill materialization (requiredCompatibility=editable) is unaffected by this option existing", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Numero de identificacion",
    candidates: [candidate({ tag: "input", role: "textbox", editable: true, stableDirectAttributes: { "data-testid": "doc-number-input" } })],
    requiredCompatibility: "editable",
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") assert.equal(result.target.certificationTier, 1);
});

test("6/noPosition. no positional selector is ever produced by this fix", () => {
  const result = materializeFieldScopedTechnicalTarget(
    {
      associatedField: "FIELD",
      candidates: [candidate({ tag: "button", role: "button", actionable: true, stableDirectAttributes: { class: "icon-btn" } })],
      requiredCompatibility: "actionable",
      fieldContainerEvidence: { tag: "section", stableDirectAttributes: { "data-scope": "s" } },
    },
    { requireContainerScope: true },
  );
  assert.equal(result.status, "certified");
  if (result.status === "certified") {
    assert.doesNotMatch(result.target.locatorCandidates[0].value, /:nth|\.first\(|\.last\(/);
  }
});
