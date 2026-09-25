import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { SpecExecutionContract, SpecExecutionContractStep } from "../spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "./deterministic-spec-compiler";

/**
 * FIRST_LOSS fix (jobId 938b796f-a927-49cf-95bd-3ed66d3e49c0, classification C): Discovery's own
 * resolveRecordedStructuralOwner (src/discovery/target-resolver.ts, now exported) already proved
 * a composite structural identity unique for real Step 4 (before=312 -> ... -> final=1), but the
 * deterministic compiler previously reduced certified_structural authority to
 * `locatorCandidates[0]` alone (a bare CSS attribute fragment), which the physical runtime proved
 * is NOT standalone-unique ("resolved to 2 elements"). This wires the FULL structural identity
 * (owner/stableDirectAttributes/stableDescendants/semanticShape/landmarkAncestor) through to
 * clickPromotedTarget, which now reuses the SAME shared resolver -- only when the certified
 * target's structuralContext.owner is present (rich enough for that resolver to use); otherwise
 * the existing ref-only path is unchanged.
 */

const TEST_TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
);

function compileDeterministicSpec(contract: SpecExecutionContract) {
  return compileDeterministicSpecRaw(contract, { targetSpecPath: TEST_TARGET_SPEC_PATH });
}

function step(overrides: Partial<SpecExecutionContractStep>): SpecExecutionContractStep {
  return {
    contractStepIndex: 0,
    scenarioStepIndex: 0,
    originalText: "synthetic step",
    operation: "click",
    required: true,
    executionStatus: "executed",
    evidenceRefs: [],
    ...overrides,
  };
}

function contract(steps: SpecExecutionContractStep[], overrides: Partial<SpecExecutionContract> = {}): SpecExecutionContract {
  return {
    version: "1",
    scenarioId: "SYN-001",
    title: "synthetic scenario",
    steps,
    unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: steps.length, representedScenarioSteps: steps.length, missingScenarioSteps: [] },
    ...overrides,
  } as SpecExecutionContract;
}

const RICH_CERT_WITH_OWNER = {
  interactionEvidence: [],
  validatedByInteraction: true,
  certifiedFrom: "recording",
  targetType: "structural",
  locatorCandidates: [{ strategy: "css", value: '[href="/synthetic/target"]', confidence: 0.9 }],
  structuralContext: {
    owner: { tag: "a", role: "link" },
    stableDirectAttributes: { href: "/synthetic/target" },
    stableDescendants: [{ relation: "descendant", tag: "span", stableAttributes: { class: "synthetic-icon" } }],
    semanticShape: ["span"],
    landmarkAncestor: { tag: "nav" },
    deterministicStructuralIdentity: true,
    identityAmbiguous: false,
    structuralIdentityMatchCount: 1,
  },
  confidence: 0.9,
  certificationTier: 1,
} as any;

const TIER1_NO_OWNER_CERT = {
  interactionEvidence: [],
  validatedByInteraction: true,
  certifiedFrom: "recording",
  targetType: "structural",
  locatorCandidates: [{ strategy: "css", value: '[href="/synthetic/target"]', confidence: 0.9 }],
  structuralContext: { stableDirectAttributes: { href: "/synthetic/target" } },
  confidence: 0.9,
  certificationTier: 1,
} as any;

test("1/COMPILER_STRUCTURAL_TRANSPORT: a rich certified structural target (owner present) is emitted as structuralTarget with owner/attrs/descendants/semanticShape/landmark/ambiguity fields preserved", () => {
  const clickStep = step({
    scenarioStepIndex: 4,
    operation: "click",
    target: { strategy: "text", value: "Synthetic Target" },
    certifiedTechnicalTarget: RICH_CERT_WITH_OWNER,
  });
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /structuralTarget: \{/);
  const structuralTargetMatch = result.source.match(/structuralTarget: (\{[\s\S]*?\}),\n\s*action:/);
  assert.ok(structuralTargetMatch, "structuralTarget object literal must be present before the action callback");
  const emitted = JSON.parse(structuralTargetMatch![1]);
  assert.equal(emitted.structuralContext.owner.tag, "a");
  assert.deepEqual(emitted.structuralContext.stableDirectAttributes, { href: "/synthetic/target" });
  assert.equal(emitted.structuralContext.stableDescendants.length, 1);
  assert.deepEqual(emitted.structuralContext.semanticShape, ["span"]);
  assert.equal(emitted.structuralContext.landmarkAncestor.tag, "nav");
  assert.equal(emitted.structuralContext.identityAmbiguous, false);
  assert.equal(emitted.structuralContext.structuralIdentityMatchCount, 1);
});

test("2/COMPILER_STRUCTURAL_TRANSPORT: a Tier-1 certified target with NO owner does not emit structuralTarget -- stays on the existing ref-only path", () => {
  const clickStep = step({
    scenarioStepIndex: 4,
    operation: "click",
    target: { strategy: "text", value: "Synthetic Target" },
    certifiedTechnicalTarget: TIER1_NO_OWNER_CERT,
  });
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.doesNotMatch(result.source, /structuralTarget:/);
  assert.match(result.source, /technicalTargetRefs: \['css:\[href="\/synthetic\/target"\]'\]/);
});

test("5/RUNTIME_RESOLUTION_REQUIRED_UNCHANGED: a rich certified structural target (owner present) is NOT emitted as structuralTarget when resolutionState=runtime_resolution_required -- stays on the existing runtime_deferred path", () => {
  const clickStep = step({
    scenarioStepIndex: 6,
    operation: "click",
    target: { strategy: "text", value: "Synthetic deferred target" },
    resolutionState: "runtime_resolution_required",
    certifiedTechnicalTarget: RICH_CERT_WITH_OWNER,
  } as any);
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.unsupportedCapabilities.length, 0, "upstream explicitly deferred resolution -- not a compile-time failure");
  assert.doesNotMatch(result.source, /structuralTarget:/, "certified structural authority must never be fabricated for a step explicitly deferred to runtime resolution");
  assert.equal(result.bindings[0].runtimeResolutionRequired, true);
});
