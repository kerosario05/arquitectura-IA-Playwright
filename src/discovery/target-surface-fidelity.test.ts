import assert from "node:assert/strict";
import test from "node:test";
import { classifyRecordedSurfaceCompatibility, resolveActionTarget } from "./target-resolver";
import { recordedPostActionSurfaceReached } from "./case-discovery";

function uniqueVisibleControl() {
  return {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
  };
}

test("stale route does not veto one exact visible enabled recorded control", async () => {
  const locator = uniqueVisibleControl();
  const page = {
    url: () => "https://app.test/current-surface",
    getByRole: () => locator,
  } as any;
  const result = await resolveActionTarget(page, {
    url: page.url(),
    title: "Current",
    elements: [],
  } as any, "Expected control", {
    expectedRouteBefore: "https://app.test/recorded-surface",
    recordedTechnicalTargetRefs: ["role:button|Expected control"],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.matchReason, "recorded_technical_target_current_dom_stale_surface_recovered");
});

test("same-route role/name match with incompatible recorded structure is not admitted", async () => {
  const locator = uniqueVisibleControl();
  const page = {
    url: () => "https://app.test/current-surface",
    getByRole: () => locator,
  } as any;
  const result = await resolveActionTarget(page, {
    url: page.url(),
    title: "Current",
    elements: [],
  } as any, "Expected control", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:button|Expected control"],
  });
  assert.equal(result.status, "not_found");
  assert.equal(result.matchReason, "recorded_target_structural_incompatibility");
});

test("exact recorded ref hydrates one uniquely matching persisted technical target", async () => {
  const locator = uniqueVisibleControl();
  const page = {
    url: () => "https://app.test/current-surface",
    getByRole: () => locator,
  } as any;
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "Expected control", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:button|Expected control"],
    recordedTechnicalTargets: [{
      targetType: "display",
      locatorCandidates: [{ strategy: "role", value: "button|Expected control", confidence: 0.85 }],
      structuralContext: { headerRef: "header:Expected control" },
      stableAttributes: {},
      interactionEvidence: ["click"],
      confidence: 0.85,
      validatedByInteraction: true,
    }],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.matchReason, "recorded_technical_target_current_dom");
});

test("exact ref with two persisted technical targets remains ambiguous and is rejected", async () => {
  const locator = uniqueVisibleControl();
  const page = { url: () => "https://app.test/current-surface", getByRole: () => locator } as any;
  const target = {
    targetType: "display",
    locatorCandidates: [{ strategy: "role", value: "button|Expected control", confidence: 0.85 }],
    structuralContext: { headerRef: "header:Expected control" },
    stableAttributes: {},
    interactionEvidence: ["click"],
    confidence: 0.85,
    validatedByInteraction: true,
  };
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "Expected control", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:button|Expected control"],
    recordedTechnicalTargets: [target, { ...target, structuralContext: { headerRef: "header:Other" } }],
  });
  assert.equal(result.status, "not_found");
  assert.equal(result.matchReason, "recorded_target_structural_incompatibility");
});

test("unique exact ref without structural metadata remains unknown and rejected", async () => {
  const locator = uniqueVisibleControl();
  const page = { url: () => "https://app.test/current-surface", getByRole: () => locator } as any;
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "Expected control", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:button|Expected control"],
    recordedTechnicalTargets: [{
      targetType: "display",
      locatorCandidates: [{ strategy: "role", value: "button|Expected control", confidence: 0.85 }],
      interactionEvidence: ["click"],
      confidence: 0.85,
      validatedByInteraction: true,
    }],
  });
  assert.equal(result.status, "not_found");
  assert.equal(result.matchReason, "recorded_target_structural_incompatibility");
});

test("different application origin remains a hard surface incompatibility", async () => {
  const compatibility = classifyRecordedSurfaceCompatibility(
    "https://current.test/surface",
    "https://recorded.test/surface",
  );
  assert.equal(compatibility.hardIncompatibility, true);
  assert.deepEqual(compatibility.reasons, ["wrong_application_origin"]);
});

test("same origin path drift is classified as soft stale surface evidence", () => {
  const compatibility = classifyRecordedSurfaceCompatibility(
    "https://app.test/current",
    "https://app.test/recorded",
  );
  assert.equal(compatibility.hardIncompatibility, false);
  assert.equal(compatibility.routeMismatch, true);
});

/**
 * REVERTED (jobId 02b62e2a-029f-4dfd-849c-660e8e8575ea): a prior change added a lexical
 * "numeric/UUID => dynamic" heuristic here. That is not authority -- a segment that merely
 * LOOKS like an id is not proof the route actually varies there; two genuinely different,
 * unrelated numeric/UUID resources would have been silently treated as the same surface.
 * `classifyRecordedSurfaceCompatibility` has no route-template/dynamic-segment input at all,
 * so until that authority is threaded in from upstream (see the AUTHORITY TRACE in this
 * ticket's own diagnostic output), pathname comparison stays exact and fails closed.
 */
test("numericWithoutAuthority. a numeric segment difference with no template/segment authority is a route mismatch", () => {
  const compatibility = classifyRecordedSurfaceCompatibility(
    "https://app.test/entity/200/edit",
    "https://app.test/entity/100/edit",
  );
  assert.equal(compatibility.routeMismatch, true);
});

test("uuidWithoutAuthority. a UUID segment difference with no template/segment authority is a route mismatch", () => {
  const compatibility = classifyRecordedSurfaceCompatibility(
    "https://app.test/entity/f6c1c3aa-1111-2222-3333-444455556666/edit",
    "https://app.test/entity/a1282e09-65a1-45cc-b4e0-62832a5a7985/edit",
  );
  assert.equal(compatibility.routeMismatch, true);
});

test("exactRoute. an identical static route still matches exactly", () => {
  const compatibility = classifyRecordedSurfaceCompatibility(
    "https://app.test/requests/create/multiproduct",
    "https://app.test/requests/create/multiproduct",
  );
  assert.equal(compatibility.routeMismatch, false);
});

test("dynamicIdSameValue. identical ids still match (unchanged pre-existing behavior)", () => {
  const compatibility = classifyRecordedSurfaceCompatibility(
    "https://app.test/requests/10207/edit",
    "https://app.test/requests/10207/edit",
  );
  assert.equal(compatibility.routeMismatch, false);
});

test("currentRecordingFixture. WITHOUT dynamic-segment authority, the physical recording/runtime id drift (10207 vs 10208) fails closed", () => {
  assert.equal(recordedPostActionSurfaceReached("https://app.test/requests/10208/edit", "https://app.test/requests/10207/edit"), false);
});

/**
 * 11-12: `classifyRecordedSurfaceCompatibility` WITH learned route-family authority
 * (RecordingRouteObservation-derived). Exact match is checked first and unchanged; a learned
 * authority only recovers a literal mismatch when BOTH the recorded and current URL conform to
 * it (origin/search/hash/segmentCount exact, every learned static segment exact) -- never a
 * lexical numeric/UUID guess.
 */
const depurarAuthority = {
  origin: "https://app.test",
  search: "",
  hash: "",
  segmentCount: 4,
  staticSegments: new Map<number, string>([[0, ""], [1, "requests"], [3, "edit"]]),
  dynamicIndices: new Set<number>([2]),
};

/**
 * FIRST_LOSS (job 92f0d173-3dee-48ad-b2da-af4f3f784a7f, actionIndex=9, target="Categoría de
 * producto"): `resolveActionTargetCore` called `classifyRecordedSurfaceCompatibility(page.url(),
 * opts.expectedRouteBefore)` WITHOUT the already-existing optional 3rd `learnedRouteAuthority`
 * argument, so a physically-present, physically-visible owner on a legitimately-authorized dynamic
 * surface (/requests/10217/edit, same learned family as the recorded /requests/10207/edit) was
 * still classified as a route mismatch. These tests prove the option now reaches the matcher and
 * changes the classification exactly the way `classifyRecordedSurfaceCompatibility`'s own
 * authority branch already promises -- no new matcher logic, no heuristic, pure wiring.
 */

test("13/learnedAuthorityMakesSurfaceExactNotStale. a dynamic-but-authorized surface resolves via the exact path, not the stale-recovery path", async () => {
  const locator = uniqueVisibleControl();
  const page = { url: () => "https://app.test/requests/10217/edit", getByRole: () => locator } as any;
  const result = await resolveActionTarget(page, {
    url: page.url(),
    title: "Current",
    elements: [],
  } as any, "Expected control", {
    expectedRouteBefore: "https://app.test/requests/10207/edit",
    recordedTechnicalTargetRefs: ["role:button|Expected control"],
    recordedTechnicalTargets: [{
      targetType: "display",
      locatorCandidates: [{ strategy: "role", value: "button|Expected control", confidence: 0.85 }],
      structuralContext: { headerRef: "header:Expected control" },
      stableAttributes: {},
      interactionEvidence: ["click"],
      confidence: 0.85,
      validatedByInteraction: true,
    }],
    learnedRouteAuthority: depurarAuthority,
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.matchReason, "recorded_technical_target_current_dom");
});

test("14/withoutAuthoritySameCaseStaysStaleRecovered. the same case without authority is unaffected -- still resolves via the pre-existing stale-recovery fallback, unchanged", async () => {
  const locator = uniqueVisibleControl();
  const page = { url: () => "https://app.test/requests/10217/edit", getByRole: () => locator } as any;
  const result = await resolveActionTarget(page, {
    url: page.url(),
    title: "Current",
    elements: [],
  } as any, "Expected control", {
    expectedRouteBefore: "https://app.test/requests/10207/edit",
    recordedTechnicalTargetRefs: ["role:button|Expected control"],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.matchReason, "recorded_technical_target_current_dom_stale_surface_recovered");
});

test("15/wrongLineageAuthorityStillRejected. an authority that does not conform to THIS expected/actual pair is never applied -- fails closed exactly like having no authority", () => {
  const foreignAuthority = {
    origin: "https://app.test",
    search: "",
    hash: "",
    segmentCount: 3,
    staticSegments: new Map<number, string>([[0, ""], [1, "customers"]]),
    dynamicIndices: new Set<number>([2]),
  };
  const compatibility = classifyRecordedSurfaceCompatibility(
    "https://app.test/requests/10217/edit",
    "https://app.test/requests/10207/edit",
    foreignAuthority,
  );
  assert.equal(compatibility.routeMismatch, true);
});

test("11/matcherWithAuthority. same route family (dynamic index conforms on both sides) is compatible", () => {
  const compatibility = classifyRecordedSurfaceCompatibility(
    "https://app.test/requests/10211/edit",
    "https://app.test/requests/10207/edit",
    depurarAuthority,
  );
  assert.equal(compatibility.routeMismatch, false);
  assert.equal(compatibility.hardIncompatibility, false);
});

test("12/matcherWithAuthorityStillFailsClosed. authority never permits a static-segment or segment-count violation", () => {
  const wrongTerminal = classifyRecordedSurfaceCompatibility(
    "https://app.test/requests/10211/view",
    "https://app.test/requests/10207/edit",
    depurarAuthority,
  );
  assert.equal(wrongTerminal.routeMismatch, true);

  const wrongFamily = classifyRecordedSurfaceCompatibility(
    "https://app.test/customers/10211/edit",
    "https://app.test/requests/10207/edit",
    depurarAuthority,
  );
  assert.equal(wrongFamily.routeMismatch, true);

  const wrongSegmentCount = classifyRecordedSurfaceCompatibility(
    "https://app.test/requests/10211",
    "https://app.test/requests/10207/edit",
    depurarAuthority,
  );
  assert.equal(wrongSegmentCount.routeMismatch, true);
});

test("framework surface candidates are observable without relaxing recorded-target admission", async () => {
  const locator = {
    count: async () => 0,
    isVisible: async () => false,
    isEnabled: async () => false,
  };
  const page = { url: () => "https://app.test/current-surface", getByRole: () => locator } as any;
  const frameworkElement = {
    id: "el-framework-card",
    type: "text",
    text: "Card label",
    tagName: "span",
    visible: true,
    candidateLocators: [{ strategy: "text", value: "Card label", exact: false, confidence: 0.75 }],
    dataHints: [],
    actionability: "FRAMEWORK_ACTIONABLE",
  };
  const result = await resolveActionTarget(page, {
    url: page.url(),
    title: "Current",
    elements: [frameworkElement],
  } as any, "Card label", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:button|Card label"],
  });
  assert.equal(result.status, "not_found");
  assert.equal(result.structuredTargetDiagnostics?.candidates[0]?.text, "Card label");
  assert.equal(result.structuredTargetDiagnostics?.candidates[0]?.matchReason, "current_surface_candidate_not_recorded_target");
});

function structuralTarget(overrides: Record<string, unknown> = {}) {
  return {
    targetType: "display",
    locatorCandidates: [{ strategy: "role", value: "div|display label", confidence: 0.85 }],
    structuralContext: {
      owner: { tag: "div" },
      stableDescendants: [{ relation: "descendant", tag: "img", stableAttributes: { alt: "card-a", src: "/a.svg" } }],
      semanticShape: ["div", "h3"],
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
      ...(overrides.structuralContext as Record<string, unknown> ?? {}),
    },
    interactionEvidence: ["click"],
    confidence: 0.85,
    validatedByInteraction: true,
    ...overrides,
  } as never;
}

function structuralPage(locatorCount = 1, locatorOverride?: (selector: string) => any) {
  const unique = {
    count: async () => locatorCount,
    isVisible: async () => locatorCount === 1,
    isEnabled: async () => locatorCount === 1,
    filter: () => unique,
  };
  return {
    url: () => "https://app.test/current-surface",
    getByRole: () => unique,
    locator: (selector: string) => locatorOverride?.(selector) ?? unique,
  } as any;
}

test("same-tag framework cards are separated by stable descendants", async () => {
  const selectors: string[] = [];
  const page = structuralPage(1, (selector) => { selectors.push(selector); return structuralPage(1).getByRole(); });
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "changed display label", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:div|display label"],
    recordedTechnicalTargets: [structuralTarget()],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.locatorStrategy, "recorded:structural-owner");
  assert.equal(selectors.some((selector) => selector.includes('img[alt="card-a"]')), true);
});

test("a non-unique display locator can resolve through unique structural authority", async () => {
  const page = structuralPage(1);
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "display label", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:div|display label"],
    recordedTechnicalTargets: [structuralTarget()],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.locatorStrategy, "recorded:structural-owner");
});

test("ambiguous structural identity remains rejected", async () => {
  const page = structuralPage(3);
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "display label", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:div|display label"],
    recordedTechnicalTargets: [structuralTarget({ structuralContext: { structuralIdentityMatchCount: 2, identityAmbiguous: true, deterministicStructuralIdentity: false } })],
  });
  assert.equal(result.status, "not_found");
  assert.equal(result.matchReason, "recorded_target_not_present_or_unique_on_current_surface");
});

test("display-label changes do not invalidate exact structural identity", async () => {
  const page = structuralPage(1);
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "new truncated display label", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:div|old truncated display label"],
    recordedTechnicalTargets: [structuralTarget({ locatorCandidates: [{ strategy: "role", value: "div|old truncated display label", confidence: 0.85 }] })],
  });
  assert.equal(result.status, "resolved");
});

test("contradictory descendant identity is rejected", async () => {
  const missing = {
    count: async () => 0,
    isVisible: async () => false,
    isEnabled: async () => false,
    filter: () => missing,
  };
  const page = structuralPage(3, (selector) => selector.includes('src="/a.svg"') ? missing : structuralPage(3).getByRole());
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "display label", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:div|display label"],
    recordedTechnicalTargets: [structuralTarget()],
  });
  assert.equal(result.status, "not_found");
});

test("compatible surface plus unique structure is admitted", async () => {
  const page = structuralPage(1);
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "display label", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:div|display label"],
    recordedTechnicalTargets: [structuralTarget()],
  });
  assert.equal(result.status, "resolved");
});

test("semantic shape ignores decorative sibling order and still narrows ancestor divs", async () => {
  // normalizeStructuralOwnerIdentity alphabetizes semanticShape, so the true
  // DOM order (e.g. h3 rendered before the image wrapper div) no longer
  // matches an ordered ":has(> div + h3)" sequence selector. Each recorded
  // child must instead be checked independently, regardless of order.
  const createLocator = (count: number): any => ({
    count: async () => count,
    isVisible: async () => count === 1,
    isEnabled: async () => count === 1,
    filter: () => createLocator(count),
  });
  const page = {
    url: () => "https://app.test/product-subcategory",
    getByRole: () => createLocator(0),
    locator: (selector: string) => {
      if (selector === "*") return createLocator(20);
      if (selector === "div") return createLocator(7);
      if (selector.startsWith("img")) return createLocator(1);
      // Ancestor-inclusive: every qualifying ancestor still matches here.
      if (selector.includes(":has(> div)") && selector.includes(":has(> h3)") && !selector.includes(":not(")) return createLocator(7);
      // Only the nearest (innermost) qualifying ancestor survives the
      // "does not itself contain another qualifying owner" exclusion.
      if (selector.includes(":not(:has(")) return createLocator(1);
      return createLocator(7);
    },
  } as any;
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "truncated display label", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:div|truncated display label"],
    recordedTechnicalTargets: [structuralTarget()],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.locatorStrategy, "recorded:structural-owner");
  assert.equal(result.structuralDiagnostics?.structuralCandidateCountAfterStableDescendants, 7);
  assert.equal(result.structuralDiagnostics?.structuralCandidateCountAfterSemanticShape, 7);
  assert.equal(result.structuralDiagnostics?.finalStructuralMatchCount, 1);
});

test("nearest owner is selected among several ancestor divs that all contain the stable descendant", async () => {
  // Regression for the "ownerTag :has(descendant) -> all ancestors" bug:
  // several wrapper divs above the true card owner also satisfy :has(img),
  // but only the innermost one is the recorded action owner.
  const createLocator = (count: number): any => ({
    count: async () => count,
    isVisible: async () => count === 1,
    isEnabled: async () => count === 1,
    filter: () => createLocator(count),
  });
  const page = {
    url: () => "https://app.test/product-subcategory",
    getByRole: () => createLocator(0),
    locator: (selector: string) => {
      if (selector === "*") return createLocator(30);
      if (selector === "div") return createLocator(7);
      if (selector.startsWith("img")) return createLocator(1);
      if (selector.includes(":not(:has(")) return createLocator(1);
      return createLocator(7);
    },
  } as any;
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "display label", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:div|display label"],
    recordedTechnicalTargets: [structuralTarget()],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.locatorStrategy, "recorded:structural-owner");
  assert.equal(result.structuralDiagnostics?.finalStructuralMatchCount, 1);
});

test("owner-tag ancestors with a genuinely different semantic shape remain rejected", async () => {
  const createLocator = (count: number): any => ({
    count: async () => count,
    isVisible: async () => count === 1,
    isEnabled: async () => count === 1,
    filter: () => createLocator(count),
  });
  const page = {
    url: () => "https://app.test/product-subcategory",
    getByRole: () => createLocator(0),
    locator: (selector: string) => {
      if (selector === "*") return createLocator(20);
      if (selector === "div") return createLocator(7);
      if (selector.startsWith("img")) return createLocator(1);
      // None of the qualifying ancestors actually has an h3 direct child.
      if (selector.includes(":has(> h3)")) return createLocator(0);
      return createLocator(7);
    },
  } as any;
  const result = await resolveActionTarget(page, { url: page.url(), title: "Current", elements: [] } as any, "display label", {
    expectedRouteBefore: page.url(),
    recordedTechnicalTargetRefs: ["role:div|display label"],
    recordedTechnicalTargets: [structuralTarget()],
  });
  assert.equal(result.status, "not_found");
});

test("reobserve pipeline preserves structural identity before resolving the next target", async () => {
  const recorded: any = structuralTarget();
  const initialSurface = {
    url: "https://app.test/product-catalog",
    elements: [{ id: "category", structuralOwnerIdentity: undefined }],
  };
  let currentSurface: any = initialSurface;
  const action = async () => {
    currentSurface = {
      url: "https://app.test/product-subcategory",
      elements: [{
        id: "el-106",
        tagName: "div",
        visible: true,
        actionability: "FRAMEWORK_ACTIONABLE",
        structuralOwnerIdentity: recorded.structuralContext,
      }],
    };
  };
  const reobserve = async () => currentSurface;

  await action();
  const reobservedSnapshot = await reobserve();
  const mappedCandidate = reobservedSnapshot.elements[0];
  const page = structuralPage(1);
  const resolution = await resolveActionTarget(page, reobservedSnapshot as any, "changed display label", {
    expectedRouteBefore: reobservedSnapshot.url,
    recordedTechnicalTargetRefs: ["role:div|display label"],
    recordedTechnicalTargets: [recorded],
  });

  assert.deepEqual(mappedCandidate.structuralOwnerIdentity, recorded.structuralContext);
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.locatorStrategy, "recorded:structural-owner");
});
