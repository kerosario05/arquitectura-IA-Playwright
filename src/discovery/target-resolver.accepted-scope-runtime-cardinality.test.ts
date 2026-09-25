import assert from "node:assert/strict";
import test from "node:test";
import { tryFieldScopedStructuralFallback } from "./target-resolver";
import { buildCssFromAttributes, materializeFieldScopedTechnicalTarget } from "../automations/technical-target-materializer";
import type { FieldScopedDomEvidence } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS (jobId dfbecfc8-895d-4751-9987-c4060164d2f2, field "Categoría de producto"): the
 * `fromAcceptedFieldScope=true` retry was only ever verified by SOURCE-SHAPE assertions (does the
 * code contain the right call?) -- never by actually driving cardinality through a fake
 * `Page`/`Locator`. These tests exercise the real runtime path: `tryFieldScopedStructuralFallback`
 * -> `materializeFieldScopedTechnicalTarget` -> the accepted-scope retry in `target-resolver.ts`
 * -> `resolveRecordedTechnicalTarget` with `scopeRoot` -> `Locator.count()`, with no browser.
 *
 * Every test forces the TOP-level (non-scoped) reconfirmation to fail by leaving every CSS value
 * unregistered on the fake page except the accepted container's own selector -- `FakeLocator`'s
 * default is "not found" (count 0), so the top-level Tier-1 attempt always falls through to the
 * accepted-scope retry under test, exactly like a genuinely ambiguous/ownerless top-level target
 * would in production.
 */

class FakeLocator {
  private readonly children = new Map<string, FakeLocator>();
  public countCalls = 0;

  constructor(
    private readonly countValue: number,
    private readonly opts: { visible?: boolean; enabled?: boolean } = {},
  ) {}

  child(selector: string, locator: FakeLocator): this {
    this.children.set(selector, locator);
    return this;
  }

  locator(selector: string): FakeLocator {
    return this.children.get(selector) ?? new FakeLocator(0);
  }

  async count(): Promise<number> {
    this.countCalls += 1;
    return this.countValue;
  }

  async isVisible(): Promise<boolean> {
    return this.countValue === 1 && (this.opts.visible ?? true);
  }

  async isEnabled(): Promise<boolean> {
    return this.opts.enabled ?? true;
  }

  async evaluate(): Promise<boolean> {
    return true;
  }
}

/** A page whose only "known" selector is the accepted container's own CSS -- everything else
 *  (including the page-GLOBAL version of the descendant selector, registered separately below)
 *  behaves exactly like production: `page.locator(x)` for an unregistered x is simply "not found". */
class FakePage {
  private readonly registered = new Map<string, FakeLocator>();

  register(selector: string, locator: FakeLocator): this {
    this.registered.set(selector, locator);
    return this;
  }

  locator(selector: string): FakeLocator {
    return this.registered.get(selector) ?? new FakeLocator(0);
  }

  url(): string {
    return "https://example.test/category";
  }

  async evaluate<T>(): Promise<T> {
    // tryFieldScopedStructuralFallback's own page.evaluate() call for FieldScopedDomEvidence is
    // stubbed per-test via (page as any).__evidence -- see buildPage() below.
    return (this as unknown as { __evidence: T }).__evidence;
  }
}

function buildPage(evidence: FieldScopedDomEvidence): FakePage {
  const page = new FakePage();
  (page as unknown as { __evidence: FieldScopedDomEvidence }).__evidence = evidence;
  return page;
}

const ASSOCIATED_FIELD = "Categoría de producto";
const CANDIDATE_STABLE_ATTRS = { id: "category-owner" };
const CONTAINER_STABLE_ATTRS = { "data-field-scope": "category" };

const containerCss = buildCssFromAttributes(CONTAINER_STABLE_ATTRS);
const descendantCss = `button${buildCssFromAttributes(CANDIDATE_STABLE_ATTRS)}`;

function baseEvidence(overrides: Partial<FieldScopedDomEvidence> = {}): FieldScopedDomEvidence {
  return {
    candidates: [
      {
        tag: "button",
        role: "button",
        actionable: true,
        visible: true,
        disabled: false,
        stableDirectAttributes: CANDIDATE_STABLE_ATTRS,
      },
    ],
    diagnostics: {
      textAnchorMatchCount: 1,
      semanticLabelMatchCount: 0,
      ariaRelationMatchCount: 0,
      leafAnchorMatchCount: 1,
      anchorFound: true,
      anchorTag: "label",
      ancestorsInspected: 1,
      ancestorTrace: [],
      containerAccepted: true,
    },
    // No evidence.container: `containerAvailable` stays false, so the broader-container retry
    // (which this ticket does not touch) is skipped and only the accepted-scope retry runs.
    container: undefined,
    scopeContainer: {
      tag: "div",
      stableDirectAttributes: CONTAINER_STABLE_ATTRS,
      fromAcceptedFieldScope: true,
    },
    ...overrides,
  };
}

test("1/globalTwoScopedOne. a page-global descendant match count of 2 is irrelevant: the accepted container resolves to 1 and the descendant resolves to 1 WITHIN it, so the target is resolved from the scoped root", async () => {
  const scopedDescendant = new FakeLocator(1);
  const container = new FakeLocator(1).child(descendantCss, scopedDescendant);
  const globalDescendant = new FakeLocator(2); // page-global count for the SAME selector -- must never be consulted

  const page = buildPage(baseEvidence());
  page.register(containerCss, container);
  page.register(descendantCss, globalDescendant);

  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");

  assert.ok(result, "expected the accepted-scope retry to resolve the target");
  assert.equal(result?.strategy, "recorded:css");
  assert.equal(globalDescendant.countCalls, 0, "the page-global locator for the same selector must never be queried -- the result must come from the scoped container, not a global count");
  assert.ok(scopedDescendant.countCalls > 0, "the scoped descendant locator must actually have been queried");
});

test("2/scopedTwo. exactly 2 compatible owners inside the accepted (unique) container: fails closed, never picks one arbitrarily", async () => {
  const scopedDescendant = new FakeLocator(2);
  const container = new FakeLocator(1).child(descendantCss, scopedDescendant);

  const page = buildPage(baseEvidence());
  page.register(containerCss, container);

  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");

  assert.equal(result, undefined, "2 compatible owners within an otherwise-unique accepted scope must fail closed, not resolve to either one");
});

test("3/scopedZero. the accepted (unique) container resolves, but the descendant is absent inside it: fails closed", async () => {
  const scopedDescendant = new FakeLocator(0);
  const container = new FakeLocator(1).child(descendantCss, scopedDescendant);

  const page = buildPage(baseEvidence());
  page.register(containerCss, container);

  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");

  assert.equal(result, undefined, "zero matches for the descendant within the accepted scope must fail closed");
});

test("4/containerTwo. the accepted container itself no longer resolves to a single live element: fails closed BEFORE ever querying the descendant", async () => {
  const scopedDescendant = new FakeLocator(1); // would resolve fine if reached -- must NEVER be reached
  const container = new FakeLocator(2).child(descendantCss, scopedDescendant);

  const page = buildPage(baseEvidence());
  page.register(containerCss, container);

  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");

  assert.equal(result, undefined, "an ambiguous accepted-container re-resolution must fail closed");
  assert.equal(scopedDescendant.countCalls, 0, "the descendant must never be queried once the container itself failed to prove unique -- container ambiguity is checked FIRST");
});

test("5/weakUntrusted. scopeContainer evidence WITHOUT fromAcceptedFieldScope never acquires scoped retry authority", async () => {
  const scopedDescendant = new FakeLocator(1);
  const container = new FakeLocator(1).child(descendantCss, scopedDescendant);

  const page = buildPage(
    baseEvidence({
      scopeContainer: {
        tag: "div",
        stableDirectAttributes: CONTAINER_STABLE_ATTRS,
        // fromAcceptedFieldScope intentionally omitted -- an untrusted/fabricated container must
        // never be handed the same runtime authority as a real accepted scope.
      },
    }),
  );
  page.register(containerCss, container);

  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");

  assert.equal(result, undefined, "without fromAcceptedFieldScope=true, no scoped retry authority may be used, even though the container/descendant would otherwise resolve cleanly");
  assert.equal(container.countCalls, 0, "an untrusted container must never even be re-resolved as a live Locator");
});

/**
 * FIRST_LOSS (jobId 92d7c68d-106d-4800-8c53-59addc072f9e, field "Categoría de producto"): a
 * WEAK accepted-scope container -- no stable attribute of its own, only `tag` + `textAnchor`
 * (`stableAttribute=false` in the physical ancestor trace) -- used to be materialized as a bare
 * `div:has-text(...)` selector. `:has-text()` matches every ANCESTOR whose subtree contains the
 * text too, so that selector re-expanded from the one live node `findFieldScope` accepted back
 * out to 21 page-wide matches (physical evidence: `containerCount=21`). Fixed in
 * `materializeFieldScopedTechnicalTarget` by reusing the same nearest-owner `:has()`/
 * `:not(:has())` idiom `resolveRecordedStructuralOwner` already uses elsewhere in this file, so
 * the container selector is bounded by "narrowest ancestor containing the compatible
 * descendant" -- the same structural relation `findFieldScope` itself proved -- instead of a
 * bare tag name. These tests derive the REAL selector strings from the materializer itself
 * (never hand-typed), so they fail if the production CSS shape regresses.
 */

function weakScopeContainer(fromAcceptedFieldScope: boolean): NonNullable<FieldScopedDomEvidence["scopeContainer"]> {
  return {
    tag: "div",
    textAnchor: ASSOCIATED_FIELD,
    // no stableDirectAttributes at all -- the physical "stableAttribute=false" case.
    ...(fromAcceptedFieldScope ? { fromAcceptedFieldScope: true as const } : {}),
  };
}

function weakEvidence(fromAcceptedFieldScope = true): FieldScopedDomEvidence {
  return baseEvidence({ scopeContainer: weakScopeContainer(fromAcceptedFieldScope) });
}

const weakMaterialization = materializeFieldScopedTechnicalTarget(
  {
    associatedField: ASSOCIATED_FIELD,
    candidates: weakEvidence().candidates,
    requiredCompatibility: "actionable",
    fieldContainerEvidence: weakScopeContainer(true),
  },
  { requireContainerScope: true },
);
assert.equal(weakMaterialization.status, "certified", "test setup: the weak container must still certify (Tier 3) for these tests to be meaningful");
const weakContainerCss = weakMaterialization.status === "certified" ? weakMaterialization.scopeContainerLocator!.value : "";
const weakDescendantCss = weakMaterialization.status === "certified" ? weakMaterialization.scopedDescendantLocator!.value : "";
const naiveBroadContainerCss = `div :has-text("${ASSOCIATED_FIELD}")`;

assert.notEqual(
  weakContainerCss,
  naiveBroadContainerCss,
  "regression guard: the container selector must never be the bare tag+text-anchor shape that physically matched 21 elements",
);

/**
 * FIRST_LOSS (jobId f1e6f577-110d-491e-bbdf-3a64ca129e19, same field): 21 -> 2 after the 21-match
 * fix, still ambiguous. Root cause: `:has-text()` was chained onto the container tag through a
 * DESCENDANT COMBINATOR (a literal leading space, `div :has-text(...)`) -- that reads as "any
 * element that is a DESCENDANT of some div and itself has this text", not "a div that itself has
 * this text". Almost every element on a real page is a descendant of *some* div, so combined with
 * `:has(descendant)` it could still match an unrelated nearby wrapper alongside the real accepted
 * container. Fixed by chaining `:has-text()` directly onto the tag (no combinator) for the WEAK
 * case specifically -- the STABLE-attribute case's combinator form is untouched (see
 * `technical-target-materializer.text-anchor-disambiguation.test.ts`, still green).
 */
test("11/weakContainerPseudoClassNotCombinator. the weak container's own :has-text() is chained directly on the tag, never through a descendant combinator", () => {
  assert.match(
    weakContainerCss,
    /^div:has-text\(/,
    "the container selector must read 'a div that itself has this text', not 'a descendant of some div that has this text'",
  );
});

test("6/weakGlobal21ScopedOne. a weak (no-stable-attribute) accepted container reconstructs to a nearest-owner selector that resolves to exactly 1, regardless of how broad the naive tag+text selector would have been", async () => {
  const scopedDescendant = new FakeLocator(1);
  const container = new FakeLocator(1).child(weakDescendantCss, scopedDescendant);
  const naiveBroadContainer = new FakeLocator(21); // what the OLD `div:has-text()` shape would have matched physically

  const page = buildPage(weakEvidence());
  page.register(weakContainerCss, container);
  page.register(naiveBroadContainerCss, naiveBroadContainer);

  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");

  assert.ok(result, "expected the reconstructed nearest-owner scope to resolve the target");
  assert.equal(naiveBroadContainer.countCalls, 0, "the naive broad tag+text-anchor selector (21 physical matches) must never be queried");
  assert.ok(container.countCalls > 0, "the reconstructed nearest-owner container must actually have been queried");
});

test("7/weakScopeTwoFailsClosed. the reconstructed weak-container selector itself resolves to 2: fails closed before ever querying the descendant", async () => {
  const scopedDescendant = new FakeLocator(1);
  const container = new FakeLocator(2).child(weakDescendantCss, scopedDescendant);

  const page = buildPage(weakEvidence());
  page.register(weakContainerCss, container);

  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");

  assert.equal(result, undefined, "an ambiguous reconstructed weak-container scope must fail closed");
  assert.equal(scopedDescendant.countCalls, 0, "the descendant must never be queried once the reconstructed container failed to prove unique");
});

test("8/weakScopeDescendantTwoFailsClosed. the weak-container scope resolves to 1, but the descendant inside it resolves to 2: fails closed", async () => {
  const scopedDescendant = new FakeLocator(2);
  const container = new FakeLocator(1).child(weakDescendantCss, scopedDescendant);

  const page = buildPage(weakEvidence());
  page.register(weakContainerCss, container);

  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");

  assert.equal(result, undefined, "2 compatible descendants within the reconstructed weak scope must fail closed");
});

test("9/weakScopeDescendantZeroFailsClosed. the weak-container scope resolves to 1, but the descendant is absent inside it: fails closed", async () => {
  const scopedDescendant = new FakeLocator(0);
  const container = new FakeLocator(1).child(weakDescendantCss, scopedDescendant);

  const page = buildPage(weakEvidence());
  page.register(weakContainerCss, container);

  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");

  assert.equal(result, undefined, "zero matches for the descendant within the reconstructed weak scope must fail closed");
});

test("10/weakScopeUntrustedRejected. a weak container WITHOUT fromAcceptedFieldScope never gets the nearest-owner reconstruction either", async () => {
  const scopedDescendant = new FakeLocator(1);
  const container = new FakeLocator(1).child(weakDescendantCss, scopedDescendant);

  const page = buildPage(weakEvidence(false));
  page.register(weakContainerCss, container);

  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");

  assert.equal(result, undefined, "without fromAcceptedFieldScope=true, the weak container never acquires reconstruction authority either");
  assert.equal(container.countCalls, 0, "an untrusted weak container must never be re-resolved as a live Locator");
});
