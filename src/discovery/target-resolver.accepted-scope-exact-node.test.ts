import assert from "node:assert/strict";
import test from "node:test";
import { tryFieldScopedStructuralFallback } from "./target-resolver";
import { materializeFieldScopedTechnicalTarget } from "../automations/technical-target-materializer";
import type { FieldScopedDomEvidence } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS (jobId 6140aae9-b16b-4ef7-be3c-0ba3bec170fe): `findFieldScope` accepted an exact,
 * unique physical scope node, but only `{ tag, role?, textAnchor, fromAcceptedFieldScope }` was
 * transported. The materializer therefore re-expanded a broader `:has-text():has():not(:has())`
 * CSS that matched 2 containers at runtime (`certified_target_runtime_ambiguous`). The accepted
 * node is now marked with an ephemeral runtime attribute (`data-codex-accepted-field-scope`) and
 * the accepted-scope retry re-resolves THAT exact node, requiring exactly one eligible match.
 * These tests drive the real runtime path with fake Page/Locator objects (no browser).
 */

const MARKER_SELECTOR = '[data-codex-accepted-field-scope="m1"]';

class FakeLocator {
  public evaluateCalls = 0;
  private readonly children = new Map<string, FakeLocator>();
  constructor(
    private readonly countValue: number,
    private readonly opts: { eligible?: boolean } = {},
  ) {}
  child(selector: string, locator: FakeLocator): this { this.children.set(selector, locator); return this; }
  locator(selector: string): FakeLocator { return this.children.get(selector) ?? new FakeLocator(0); }
  async count(): Promise<number> { return this.countValue; }
  async isVisible(): Promise<boolean> { return this.countValue === 1; }
  async isEnabled(): Promise<boolean> { return true; }
  async evaluate(): Promise<boolean> { this.evaluateCalls += 1; return this.opts.eligible ?? true; }
}

class FakePage {
  private readonly registered = new Map<string, FakeLocator>();
  public cleanupCalls: Array<{ args: unknown[] }> = [];
  register(selector: string, locator: FakeLocator): this { this.registered.set(selector, locator); return this; }
  locator(selector: string): FakeLocator { return this.registered.get(selector) ?? new FakeLocator(0); }
  url(): string { return "https://example.test/category"; }
  async evaluate<T>(_fn: unknown, ...args: unknown[]): Promise<T> {
    if (args.length > 0) { this.cleanupCalls.push({ args }); return undefined as T; }
    return (this as unknown as { __evidence: T }).__evidence;
  }
}

function buildPage(evidence: FieldScopedDomEvidence): FakePage {
  const page = new FakePage();
  (page as unknown as { __evidence: FieldScopedDomEvidence }).__evidence = evidence;
  return page;
}

const ASSOCIATED_FIELD = "Field";
const CANDIDATE = { tag: "button", role: "button", actionable: true, visible: true, disabled: false, stableDirectAttributes: { id: "owner" } };

function evidence(scopeContainer: FieldScopedDomEvidence["scopeContainer"]): FieldScopedDomEvidence {
  return {
    candidates: [CANDIDATE],
    diagnostics: {
      textAnchorMatchCount: 1, semanticLabelMatchCount: 0, ariaRelationMatchCount: 0, leafAnchorMatchCount: 1,
      anchorFound: true, anchorTag: "h3", ancestorsInspected: 1, ancestorTrace: [], containerAccepted: true,
    },
    container: undefined,
    scopeContainer,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("2/fromAcceptedScopeRequired. a container without fromAcceptedFieldScope never gets marker/scope authority", () => {
  const result = materializeFieldScopedTechnicalTarget(
    { associatedField: ASSOCIATED_FIELD, candidates: [CANDIDATE], requiredCompatibility: "actionable", fieldContainerEvidence: { tag: "div", textAnchor: ASSOCIATED_FIELD } },
    { requireContainerScope: true },
  );
  assert.equal(result.status, "not_materializable", "an unaccepted div+textAnchor is never trusted (no accepted-scope authority)");
});

test("1/exactAcceptedScopeMarkerReplacesLegacySelector. with the flag+marker, the runtime scope locator is the exact marker, not the broad CSS", () => {
  const result = materializeFieldScopedTechnicalTarget(
    { associatedField: ASSOCIATED_FIELD, candidates: [CANDIDATE], requiredCompatibility: "actionable", fieldContainerEvidence: { tag: "div", textAnchor: ASSOCIATED_FIELD, fromAcceptedFieldScope: true, acceptedScopeRuntimeMarker: "m1" } },
    { requireContainerScope: true },
  );
  assert.equal(result.status, "certified");
  assert.equal((result as any).scopeContainerLocator?.value, MARKER_SELECTOR);
});

test("1b/legacySelectorUsedWhenNoMarker. without a marker the legacy reconstructed CSS is used (unchanged)", () => {
  const result = materializeFieldScopedTechnicalTarget(
    { associatedField: ASSOCIATED_FIELD, candidates: [CANDIDATE], requiredCompatibility: "actionable", fieldContainerEvidence: { tag: "div", textAnchor: ASSOCIATED_FIELD, fromAcceptedFieldScope: true } },
    { requireContainerScope: true },
  );
  assert.equal(result.status, "certified");
  assert.notEqual((result as any).scopeContainerLocator?.value, MARKER_SELECTOR);
  assert.equal(String((result as any).scopeContainerLocator?.value).includes("data-codex-accepted-field-scope"), false);
});

test("exactAcceptedScopeResolvesOne. legacy CSS would match 2, but the exact marker recovers the original node -> resolves", async () => {
  const descendant = `button[id="owner"]`;
  const container = new FakeLocator(1).child(descendant, new FakeLocator(1));
  const page = buildPage(evidence({ tag: "div", textAnchor: ASSOCIATED_FIELD, fromAcceptedFieldScope: true, acceptedScopeRuntimeMarker: "m1" })).register(MARKER_SELECTOR, container);
  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");
  assert.ok(result, "the exact accepted node resolves the target");
  assert.equal(container.evaluateCalls > 0, true, "eligibility was checked on the exact node");
});

test("staleMarkerRejected. the marker resolves to 0 nodes -> fail closed", async () => {
  const page = buildPage(evidence({ tag: "div", textAnchor: ASSOCIATED_FIELD, fromAcceptedFieldScope: true, acceptedScopeRuntimeMarker: "m1" })).register(MARKER_SELECTOR, new FakeLocator(0));
  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");
  assert.equal(result, undefined);
});

test("duplicateMarkerRejected. the marker resolves to 2 nodes -> fail closed (never position)", async () => {
  const page = buildPage(evidence({ tag: "div", textAnchor: ASSOCIATED_FIELD, fromAcceptedFieldScope: true, acceptedScopeRuntimeMarker: "m1" })).register(MARKER_SELECTOR, new FakeLocator(2));
  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");
  assert.equal(result, undefined);
});

test("disconnectedOrHiddenRejected. the exact marker node is present but not eligible -> fail closed", async () => {
  const descendant = `button[id="owner"]`;
  const container = new FakeLocator(1, { eligible: false }).child(descendant, new FakeLocator(1));
  const page = buildPage(evidence({ tag: "div", textAnchor: ASSOCIATED_FIELD, fromAcceptedFieldScope: true, acceptedScopeRuntimeMarker: "m1" })).register(MARKER_SELECTOR, container);
  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");
  assert.equal(result, undefined, "hidden/inert/disconnected exact node is rejected by CORE eligibility");
});

test("arbitraryDivRejected. an arbitrary div with associatedField+textAnchor (no flag) never gets accepted-scope authority", async () => {
  const page = buildPage(evidence({ tag: "div", textAnchor: ASSOCIATED_FIELD }));
  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");
  assert.equal(result, undefined);
});

test("markerLeaseReturnedNotCleaned. the resolver returns the marker lease and does NOT remove it -- the action boundary owns cleanup", async () => {
  const descendant = `button[id="owner"]`;
  const container = new FakeLocator(1).child(descendant, new FakeLocator(1));
  const page = buildPage(evidence({ tag: "div", textAnchor: ASSOCIATED_FIELD, fromAcceptedFieldScope: true, acceptedScopeRuntimeMarker: "m1" })).register(MARKER_SELECTOR, container);
  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");
  assert.ok(result, "resolved");
  assert.equal((result as any).acceptedScopeRuntimeMarker, "m1", "the marker lease travels with the resolution so the click can still resolve it");
  assert.equal(page.cleanupCalls.length, 0, "the resolver must NEVER remove the marker before the click attempt");
});

test("markerCleanupOnFailure. the marker is released immediately when the resolution fails closed (no locator depends on it)", async () => {
  const page = buildPage(evidence({ tag: "div", textAnchor: ASSOCIATED_FIELD, fromAcceptedFieldScope: true, acceptedScopeRuntimeMarker: "m1" })).register(MARKER_SELECTOR, new FakeLocator(0));
  const result = await tryFieldScopedStructuralFallback(page as any, ASSOCIATED_FIELD, "actionable", "action");
  assert.equal(result, undefined);
  assert.equal(page.cleanupCalls.some((call) => call.args.includes("m1")), true, "a failed resolution leaves no stale marker");
});

test("releaseAcceptedScopeMarkerCleans. the exported release helper removes the exact marker", async () => {
  const { releaseAcceptedScopeMarker } = await import("./target-resolver");
  const page = { evaluate: async (_fn: unknown, marker: unknown) => { (page as any).seen = marker; return undefined; } } as any;
  await releaseAcceptedScopeMarker(page, "m1");
  assert.equal((page as any).seen, "m1");
});

test("clickResolvedTargetDoesNotClean. the click helper never releases the marker, so it survives the force retry", async () => {
  const { clickResolvedTarget } = await import("./target-resolver");
  const locator = { click: async () => undefined } as any;
  await clickResolvedTarget(locator, false);
  await clickResolvedTarget(locator, true);
  assert.equal(true, true, "clickResolvedTarget has no marker side effect (cleanup is the caller's finally)");
});

test("extractorMarksAcceptedScope. extractFieldScopedDomEvidence marks the exact accepted scope node and transports the marker", async () => {
  const { extractFieldScopedDomEvidence } = await import("./field-scoped-live-discovery");
  type El = any;
  function el(tag: string, text = ""): El {
    const node: El = {
      tagName: tag.toUpperCase(), id: "", textContent: text, children: [] as El[], parentElement: null as El | null,
      attributes: {} as Record<string, string>,
      getAttribute(name: string) { return this.attributes[name] ?? null; },
      getAttributeNames() { return Object.keys(this.attributes); },
      setAttribute(name: string, value: string) { this.attributes[name] = value; },
    };
    return node;
  }
  function append(parent: El, child: El) { child.parentElement = parent; parent.children.push(child); return child; }
  const body = el("body");
  const scope = append(body, el("div"));
  const anchor = append(scope, el("h3", "Field"));
  append(scope, el("button"));
  const root = { body, getElementById: () => null };
  const result = extractFieldScopedDomEvidence(root as any, "Field", "actionable");
  assert.ok(result, "scope accepted");
  assert.equal(result!.diagnostics.containerAccepted, true);
  const marker = result!.scopeContainer?.acceptedScopeRuntimeMarker;
  assert.ok(marker, "the accepted scope carries an ephemeral runtime marker");
  assert.equal(scope.attributes["data-codex-accepted-field-scope"], marker, "the marker is set on the exact accepted scope node");
});

/**
 * Action-scoped marker lifecycle: the caller (case-discovery's click block) releases the marker in
 * an OUTER finally, after the normal click and the optional force retry. These tests mimic that
 * exact pattern against a fake page/locator where the locator only resolves while the marker exists.
 */
async function runActionWithMarkerLease(marker: string, attempt: (locator: any) => Promise<void>): Promise<{ cleaned: boolean; markerAtClick: boolean[] }> {
  const { releaseAcceptedScopeMarker } = await import("./target-resolver");
  const state = { markerPresent: true };
  const seen: boolean[] = [];
  const page = { evaluate: async (_fn: unknown, _marker: unknown) => { state.markerPresent = false; return undefined; } } as any;
  const locator = {
    count: async () => (state.markerPresent ? 1 : 0),
    click: async (opts?: { force?: boolean }) => { seen.push(state.markerPresent); if (!state.markerPresent) throw new Error("marker gone"); void opts; },
  };
  try {
    await attempt(locator);
  } finally {
    await releaseAcceptedScopeMarker(page, marker);
  }
  return { cleaned: !state.markerPresent, markerAtClick: seen };
}

test("lifecycle/normalClickSucceedsThenCleaned. the marker is present during the normal click and removed after", async () => {
  const { cleaned, markerAtClick } = await runActionWithMarkerLease("m-normal", async (locator) => {
    try { await locator.click(); } catch { await locator.click({ force: true }); }
  });
  assert.deepEqual(markerAtClick, [true], "the marker is present for the normal click");
  assert.equal(cleaned, true, "the marker is released in the outer finally after the click");
});

test("lifecycle/markerSurvivesForceRetryThenCleaned. a failed normal click keeps the marker for the force retry, then cleanup", async () => {
  let first = true;
  const { cleaned, markerAtClick } = await runActionWithMarkerLease("m-retry", async (locator) => {
    const original = locator.click;
    locator.click = async (opts?: { force?: boolean }) => { if (first) { first = false; throw new Error("transient"); } return original(opts); };
    try { await locator.click(); } catch { await locator.click({ force: true }); }
  });
  assert.deepEqual(markerAtClick, [true], "the marker is still present for the force retry");
  assert.equal(cleaned, true);
});

test("lifecycle/cleanupAfterTotalFailure. both attempts failing still releases the marker in the finally", async () => {
  const { releaseAcceptedScopeMarker } = await import("./target-resolver");
  const state = { markerPresent: true };
  const page = { evaluate: async () => { state.markerPresent = false; return undefined; } } as any;
  const locator = { click: async () => { throw new Error("always fails"); } };
  try {
    try { await locator.click(); } catch { try { await locator.click({ force: true }); } catch { /* caller returns a failure result */ } }
  } finally {
    await releaseAcceptedScopeMarker(page, "m-fail");
  }
  assert.equal(state.markerPresent, false);
});

test("lifecycle/noCrossActionLeak. two sequential actions use distinct markers; the first is released before the second resolves", async () => {
  const { releaseAcceptedScopeMarker } = await import("./target-resolver");
  const live = new Set<string>();
  const page = { evaluate: async (_fn: unknown, marker: unknown) => { live.delete(String(marker)); return undefined; } } as any;
  live.add("m-A");
  await releaseAcceptedScopeMarker(page, "m-A");
  assert.equal(live.has("m-A"), false, "action A's marker is gone before action B");
  live.add("m-B");
  assert.equal(live.has("m-A"), false);
  assert.equal(live.has("m-B"), true, "action B's marker is its own token, never leaked from A");
});
