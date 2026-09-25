import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { materializeTechnicalTarget, normalizeRecordingEvidence } from "./technical-target-materializer";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import { compileDeterministicSpec } from "./spec-compiler/deterministic-spec-compiler";
import { createPromotedSpecRuntime } from "./runtime/promoted-spec-runtime";
import type { ExecutionPlan } from "../types/execution-plan.types";

/**
 * FIRST_LOSS fix (jobId aaf086b9-f02f-41e5-b633-815221734c5f): Discovery's own structural-match
 * for real Step 4 included landmarkAncestor=main (the SAME scoping signal
 * resolveRecordedStructuralOwner already uses to tell apart two structurally-identical owners
 * living in different landmarks -- see target-resolver.landmark-scoped-owner.test.ts), but that
 * field was silently dropped: normalizeRecordingEvidence read every other structuralContext
 * field except landmarkAncestor when building TechnicalTargetEvidenceInput, and the type itself
 * had no field to carry it. Fixed by threading landmarkAncestor through unchanged from wherever
 * it already exists upstream -- never inferred/fabricated -- so the promoted runtime's shared
 * resolver receives the SAME scope Discovery physically validated.
 */

const TEST_TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
);

test("1/LANDMARK_INPUT_TRANSPORT: recording evidence with an existing landmarkAncestor is carried into TechnicalTargetEvidenceInput unchanged", () => {
  const candidate = {
    targetType: "structural",
    locatorCandidates: [{ strategy: "css", value: '[href="/synthetic/target"]', confidence: 0.9 }],
    structuralContext: {
      owner: { tag: "a" },
      stableDirectAttributes: { href: "/synthetic/target" },
      semanticShape: ["span"],
      landmarkAncestor: { tag: "main" },
      deterministicStructuralIdentity: true,
      identityAmbiguous: false,
      structuralIdentityMatchCount: 1,
    },
    interactionEvidence: [],
    confidence: 0.9,
    validatedByInteraction: true,
  };
  const normalized = normalizeRecordingEvidence(candidate, { displayLabel: "Synthetic" });
  assert.ok(normalized);
  assert.deepEqual(normalized!.landmarkAncestor, { tag: "main" });
});

test("2/MATERIALIZER_PRESERVES_LANDMARK: a Tier1 rich identity with owner+attrs+semanticShape+landmarkAncestor keeps the landmark in certifiedTechnicalTarget.structuralContext", () => {
  const certified = materializeTechnicalTarget({
    source: "recording",
    stableDirectAttributes: { href: "/synthetic/target" },
    owner: { tag: "a" },
    semanticShape: ["span"],
    landmarkAncestor: { tag: "main" },
    deterministicStructuralIdentity: true,
    identityAmbiguous: false,
    structuralIdentityMatchCount: 1,
  });
  assert.ok(certified);
  assert.equal(certified!.certificationTier, 1);
  assert.deepEqual(certified!.structuralContext?.landmarkAncestor, { tag: "main" });
});

test("3/CROSS_BOUNDARY_STEP4_LIKE: materializer -> SpecExecutionContract -> deterministic compiler -> generated structuralTarget.structuralContext.landmarkAncestor present", () => {
  const certified = materializeTechnicalTarget({
    source: "recording",
    stableDirectAttributes: { href: "/requests/create/synthetic-product" },
    owner: { tag: "a" },
    semanticShape: ["span"],
    landmarkAncestor: { tag: "main" },
    deterministicStructuralIdentity: true,
    identityAmbiguous: false,
    structuralIdentityMatchCount: 1,
  });
  assert.ok(certified);

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-STEP4-LANDMARK", title: "Step4-like landmark" },
    requiredData: [],
    steps: [{ index: 1, action: "click", description: "Click synthetic multiproduct-like target", target: { strategy: "text", value: "Synthetic Multiproduct" } }],
  };
  const sourceScenario = {
    title: "Step4-like landmark",
    steps: [{ index: 1, action: "Click synthetic multiproduct-like target", technicalTargetCandidates: [certified] }],
  };
  const contract = buildSpecExecutionContract(plan, sourceScenario as any, { appSlug: "synthetic-app", sectionSlug: "default-section" });
  const result = compileDeterministicSpec(contract, { targetSpecPath: TEST_TARGET_SPEC_PATH });

  assert.equal(result.unsupportedCapabilities.length, 0);
  const structuralTargetMatch = result.source.match(/structuralTarget: (\{[\s\S]*?\}),\n\s*action:/);
  assert.ok(structuralTargetMatch, "structuralTarget must be emitted");
  const emitted = JSON.parse(structuralTargetMatch![1]);
  assert.deepEqual(emitted.structuralContext.landmarkAncestor, { tag: "main" });
});

test("4/STRUCTURAL_RUNTIME_RECEIVES_LANDMARK: the promoted click passes the full structural identity (including landmarkAncestor) to the shared resolver, and the resolver scopes its query to it -- no browser", async () => {
  const locatorCalls: string[] = [];
  const clicks: string[] = [];
  const page = {
    url: () => "https://example.test/",
    on: () => {},
    locator(selector: string) {
      locatorCalls.push(selector);
      const isFinal = selector.includes(":not(:has(");
      return {
        count: async () => 1,
        isVisible: async () => true,
        isEnabled: async () => true,
        click: async () => { clicks.push(selector); },
      };
    },
  } as any;
  const runtime = createPromotedSpecRuntime(page, { enabled: false });

  await (runtime as any).clickPromotedTargetViaStructuralAuthority({
    stepIndex: 4,
    target: '[href="/synthetic/target"]',
    actionIntent: "click",
    expectedEffect: "none",
    structuralTarget: {
      targetType: "structural",
      locatorCandidates: [{ strategy: "css", value: '[href="/synthetic/target"]', confidence: 0.9 }],
      structuralContext: {
        owner: { tag: "a" },
        stableDirectAttributes: { href: "/synthetic/target" },
        semanticShape: [],
        landmarkAncestor: { tag: "main" },
        deterministicStructuralIdentity: true,
        identityAmbiguous: false,
        structuralIdentityMatchCount: 1,
      },
      interactionEvidence: [],
      confidence: 0.9,
      validatedByInteraction: true,
    },
  });

  assert.equal(clicks.length, 1);
  assert.ok(
    locatorCalls.some((selector) => selector.startsWith("main ")),
    "the shared resolver must scope its query to the landmark, exactly as Discovery's own resolution does",
  );
});

test("5/NO_LANDMARK_LEGACY: when upstream carries no landmark, none is fabricated -- structuralContext omits the field exactly as before", () => {
  const candidate = {
    targetType: "structural",
    locatorCandidates: [{ strategy: "css", value: '[href="/synthetic/target"]', confidence: 0.9 }],
    structuralContext: {
      owner: { tag: "a" },
      stableDirectAttributes: { href: "/synthetic/target" },
      semanticShape: ["span"],
      deterministicStructuralIdentity: true,
      identityAmbiguous: false,
      structuralIdentityMatchCount: 1,
    },
    interactionEvidence: [],
    confidence: 0.9,
    validatedByInteraction: true,
  };
  const normalized = normalizeRecordingEvidence(candidate, { displayLabel: "Synthetic" });
  assert.ok(normalized);
  assert.equal(normalized!.landmarkAncestor, undefined);

  const certified = materializeTechnicalTarget(normalized!);
  assert.ok(certified);
  assert.equal(certified!.structuralContext?.landmarkAncestor, undefined);
});

test("6/AMBIGUITY_GATES_UNCHANGED: identityAmbiguous and structuralIdentityMatchCount behave exactly as before, independent of landmark presence", () => {
  const ambiguousWithLandmark = materializeTechnicalTarget({
    source: "recording",
    stableDirectAttributes: { href: "/synthetic/ambiguous" },
    owner: { tag: "a" },
    landmarkAncestor: { tag: "nav" },
    identityAmbiguous: true,
    structuralIdentityMatchCount: 2,
  });
  assert.ok(ambiguousWithLandmark);
  assert.equal(ambiguousWithLandmark!.structuralContext?.identityAmbiguous, true);
  assert.equal(ambiguousWithLandmark!.structuralContext?.structuralIdentityMatchCount, 2);
  assert.deepEqual(ambiguousWithLandmark!.structuralContext?.landmarkAncestor, { tag: "nav" });

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-AMBIG-LANDMARK", title: "Ambiguity with landmark" },
    requiredData: [],
    steps: [{ index: 1, action: "click", description: "Click synthetic ambiguous target", target: { strategy: "text", value: "Synthetic Ambiguous" } }],
  };
  const sourceScenario = {
    title: "Ambiguity with landmark",
    steps: [{ index: 1, action: "Click synthetic ambiguous target", technicalTargetCandidates: [ambiguousWithLandmark] }],
  };
  const contract = buildSpecExecutionContract(plan, sourceScenario as any, { appSlug: "synthetic-app", sectionSlug: "default-section" });
  const result = compileDeterministicSpec(contract, { targetSpecPath: TEST_TARGET_SPEC_PATH });
  assert.doesNotMatch(result.source, /structuralTarget:/, "an ambiguous identity must still never be selected as certified authority, landmark or not");
});
