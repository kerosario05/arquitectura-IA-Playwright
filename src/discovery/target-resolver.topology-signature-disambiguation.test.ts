import assert from "node:assert/strict";
import test from "node:test";
import { disambiguateStructuralCandidatesByTopology, resolveRecordedStructuralOwner } from "./target-resolver";
import type { RecordedTechnicalTarget } from "../recording/session-trace.types";

/**
 * FIRST_LOSS (jobId c29e2310-cd72-48b5-8bff-9c06f3099aa7): the previous fix admitted a locator-less
 * owner with `topologyTieBreakUnique`, but the runtime matcher still built a CSS selector from
 * tag/attributes/semantic-shape and required count===1. When two live owners share that fingerprint
 * (two modal buttons), it returned `action_owner_ambiguous` because the recorded TOPOLOGY SIGNATURE
 * never travelled and the matcher never compared it. This suite proves the signature is transported
 * and consumed: exactly-one topology match resolves; 0 or >1 fail closed; the boolean alone is never
 * enough. No text, no position, no nth/index.
 */

function topologySignature(childTags: string[], descendantTags: string[]): string {
  const count = (tags: string[]): Record<string, number> => tags.reduce((acc, tag) => { acc[tag] = (acc[tag] || 0) + 1; return acc; }, {} as Record<string, number>);
  const entries = (tags: string[]): Array<[string, number]> => { const c = count(tags); return Object.keys(c).sort().map((key) => [key, c[key]] as [string, number]); };
  return JSON.stringify({ childEntries: entries(childTags), descendantEntries: entries(descendantTags) });
}

function domNode(childTags: string[], descendantTags: string[]) {
  const node: any = {
    tagName: "button",
    children: childTags.map((tag) => ({ tagName: tag.toUpperCase() })),
    querySelectorAll: (selector: string) => (selector === "*" ? descendantTags.map((tag) => ({ tagName: tag.toUpperCase() })) : []),
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
  };
  return node;
}

function withFakeDocument<T>(candidates: any[], run: () => T): T {
  const previous = (globalThis as any).document;
  (globalThis as any).document = { querySelectorAll: () => candidates };
  try {
    return run();
  } finally {
    (globalThis as any).document = previous;
  }
}

test("2/topologyUniqueRuntime. base collision of 2, recorded signature matches exactly candidate A -> matched", () => {
  const signatureA = topologySignature(["span", "span"], ["span", "span"]);
  const signatureB = topologySignature(["a", "b"], ["a", "b"]);
  const a = domNode(["span", "span"], ["span", "span"]);
  const b = domNode(["a", "b"], ["a", "b"]);
  const result = withFakeDocument([a, b], () => disambiguateStructuralCandidatesByTopology({ selector: "button", recordedSignature: signatureA }));
  assert.equal(result.matched, true);
  assert.equal(result.matchCount, 1);
  assert.equal(a.attributes["data-codex-structural-owner"], result.marker);
  assert.equal(b.attributes["data-codex-structural-owner"], undefined, "only the matching candidate is marked");
  assert.equal(signatureA !== signatureB, true);
});

test("3/topologyStillAmbiguous. two candidates share the recorded signature -> fail closed", () => {
  const signature = topologySignature(["span"], ["span"]);
  const a = domNode(["span"], ["span"]);
  const b = domNode(["span"], ["span"]);
  const result = withFakeDocument([a, b], () => disambiguateStructuralCandidatesByTopology({ selector: "button", recordedSignature: signature }));
  assert.equal(result.matched, false);
  assert.equal(result.matchCount, 2);
  assert.equal(a.attributes["data-codex-structural-owner"], undefined);
});

test("4/topologyNoMatch. no candidate matches the recorded signature -> fail closed", () => {
  const a = domNode(["span"], ["span"]);
  const result = withFakeDocument([a], () => disambiguateStructuralCandidatesByTopology({ selector: "button", recordedSignature: "no-such-signature" }));
  assert.equal(result.matched, false);
  assert.equal(result.matchCount, 0);
});

test("6/keyOrderingStable. tag counts in a different insertion order yield the SAME signature", () => {
  const ordered = topologySignature(["a", "span"], ["a", "span"]);
  const reversed = topologySignature(["span", "a"], ["span", "a"]);
  assert.equal(ordered, reversed, "the signature sorts keys, so DOM order can never affect it");
  const a = domNode(["a", "span"], ["a", "span"]);
  const b = domNode(["span", "a"], ["span", "a"]);
  const result = withFakeDocument([a, b], () => disambiguateStructuralCandidatesByTopology({ selector: "button", recordedSignature: ordered }));
  assert.equal(result.matchCount, 2, "order-independent signatures mean both genuinely match -> still ambiguous, fail closed");
  assert.equal(result.matched, false);
});

test("7/eligibilityBeforeTopology. only candidates returned by the (already eligibility-filtered) selector are compared", () => {
  const signature = topologySignature(["span"], ["span"]);
  const eligible = domNode(["span"], ["span"]);
  const result = withFakeDocument([eligible], () => disambiguateStructuralCandidatesByTopology({ selector: "button:not([hidden])", recordedSignature: signature }));
  assert.equal(result.matched, true);
  assert.equal(result.matchCount, 1);
});

function structuralTarget(signature?: string): RecordedTechnicalTarget {
  return {
    targetType: "structural",
    locatorCandidates: [],
    structuralContext: {
      owner: { tag: "button" },
      stableDirectAttributes: {},
      stableDescendants: [],
      semanticShape: ["span"],
      deterministicStructuralIdentity: true,
      topologyTieBreakUnique: true,
      structuralIdentityMatchCount: 1,
      ...(signature ? { topologySignature: signature } : {}),
    },
    interactionEvidence: ["v2_click_owner"],
    confidence: 0.85,
    validatedByInteraction: true,
  } as unknown as RecordedTechnicalTarget;
}

function fakeStructuralPage(opts: { baseCount: number; markerCount?: number }) {
  let evaluateCalls = 0;
  return {
    evaluateCalls: () => evaluateCalls,
    locator: (selector: string) => ({
      count: async () => (selector.includes("data-codex-structural-owner") ? (opts.markerCount ?? 1) : opts.baseCount),
      isVisible: async () => true,
      isEnabled: async () => true,
    }),
    evaluate: async () => { evaluateCalls += 1; return { matched: true, matchCount: 1, marker: "marker-1" }; },
  } as any;
}

function scopedStructuralTarget(scope: { strategy: "css"; value: string }, captureTargetMatchCount = 1): RecordedTechnicalTarget {
  return {
    targetType: "structural",
    locatorCandidates: [],
    structuralContext: {
      owner: { tag: "div" },
      stableDirectAttributes: { "data-role": "custom-control" },
      stableDescendants: [],
      semanticShape: [],
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
      scopeIdentity: scope,
      targetFingerprint: "opaque-structural-fingerprint",
      captureScopeUnique: true,
      captureTargetMatchCount,
    },
    interactionEvidence: ["v2_click_owner"],
    confidence: 0.8,
    validatedByInteraction: true,
  } as unknown as RecordedTechnicalTarget;
}

function fakeScopedPage(options: { scopeCount: number; targetCount: number }) {
  const targetLocator = {
    count: async () => options.targetCount,
    isVisible: async () => true,
    isEnabled: async () => true,
    locator: () => targetLocator,
  } as any;
  const scopeLocator = {
    count: async () => options.scopeCount,
    isVisible: async () => true,
    isEnabled: async () => true,
    locator: () => targetLocator,
  } as any;
  return {
    locator: (selector: string) => selector === "#scope" ? scopeLocator : targetLocator,
    evaluate: async () => ({ matched: false, matchCount: 0 }),
  } as any;
}

test("scoped runtime evidence resolves a unique target inside a unique scope", async () => {
  const result = await resolveRecordedStructuralOwner(fakeScopedPage({ scopeCount: 1, targetCount: 1 }), scopedStructuralTarget({ strategy: "css", value: "#scope" }));
  assert.ok(result);
  assert.equal(result?.currentMatchCount, 1);
});

test("scoped runtime evidence fails closed when the scope is ambiguous", async () => {
  const result = await resolveRecordedStructuralOwner(fakeScopedPage({ scopeCount: 2, targetCount: 1 }), scopedStructuralTarget({ strategy: "css", value: "#scope" }));
  assert.equal(result, undefined);
});

test("scoped runtime evidence fails closed when the local target fingerprint is ambiguous", async () => {
  const result = await resolveRecordedStructuralOwner(fakeScopedPage({ scopeCount: 1, targetCount: 2 }), scopedStructuralTarget({ strategy: "css", value: "#scope" }, 2));
  assert.equal(result, undefined);
});

test("1/baseUnique. a unique base structural match resolves exactly as before (no topology evaluation)", async () => {
  const page = fakeStructuralPage({ baseCount: 1 });
  const result = await resolveRecordedStructuralOwner(page, structuralTarget());
  assert.ok(result, "unique base match resolves");
  assert.equal(result?.strategy, "recorded:structural-owner");
  assert.equal(page.evaluateCalls(), 0, "no topology evaluation when the base selector is already unique");
});

test("5/uniqueBooleanWithoutSignatureRejected. topologyTieBreakUnique=true but no recorded signature -> never pick arbitrarily", async () => {
  const page = fakeStructuralPage({ baseCount: 2 });
  const result = await resolveRecordedStructuralOwner(page, structuralTarget());
  assert.equal(result, undefined, "the boolean alone is never enough -- ambiguity stays fail-closed");
  assert.equal(page.evaluateCalls(), 0);
});

test("2b/actionResolutionIntegration. collision of 2 + recorded signature resolves to the single matching owner", async () => {
  const page = fakeStructuralPage({ baseCount: 2, markerCount: 1 });
  const result = await resolveRecordedStructuralOwner(page, structuralTarget(topologySignature(["span"], ["span"])));
  assert.ok(result, "the topology signature disambiguates the collision at replay time");
  assert.equal(page.evaluateCalls(), 1);
});

test("8/humanLabelOnlyRejected. a structural target with no deterministic identity resolves nothing", async () => {
  const page = fakeStructuralPage({ baseCount: 1 });
  const target = { targetType: "structural", locatorCandidates: [], structuralContext: { owner: { tag: "button" } }, interactionEvidence: [], confidence: 0.5, validatedByInteraction: false } as unknown as RecordedTechnicalTarget;
  const result = await resolveRecordedStructuralOwner(page, target);
  assert.equal(result, undefined, "no deterministic structural identity -> no resolution, never a label/text fallback");
});

test("transport/normalizePreservesTopologySignature. the signature survives structural-identity normalization", async () => {
  const { normalizeStructuralOwnerIdentity } = await import("../recording/structural-owner-identity");
  const identity = normalizeStructuralOwnerIdentity({
    ownerTag: "button",
    stableDirectAttributes: {},
    stableDescendants: [],
    semanticShape: ["span"],
    structuralIdentityMatchCount: 1,
    topologyTieBreakUnique: true,
    topologySignature: "sig-abc",
  });
  assert.equal(identity.topologySignature, "sig-abc");
  assert.equal(identity.topologyTieBreakUnique, true);
});

test("transport/ownerTechnicalEvidenceCarriesTopologySignature. the signature reaches structuralContext", async () => {
  const { buildOwnerTechnicalEvidence } = await import("../recording/capture-engine-v2.action-owner-resolver");
  const owner = {
    tag: "button",
    role: "button",
    structuralIdentity: {
      owner: { tag: "button", role: "button" },
      stableDirectAttributes: {},
      stableDescendants: [],
      semanticShape: ["span"],
      deterministicStructuralIdentity: true,
      topologyTieBreakUnique: true as const,
      topologySignature: "sig-xyz",
      structuralIdentityMatchCount: 1,
    },
  } as any;
  const evidence = buildOwnerTechnicalEvidence(owner);
  assert.equal(evidence?.candidates?.[0]?.structuralContext?.topologySignature, "sig-xyz");
});
