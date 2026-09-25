import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { materializeTechnicalTarget } from "./technical-target-materializer";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import { compileDeterministicSpec } from "./spec-compiler/deterministic-spec-compiler";
import type { ExecutionPlan } from "../types/execution-plan.types";

/**
 * FIRST_LOSS fix (jobId 938b796f-a927-49cf-95bd-3ed66d3e49c0 follow-up): Tier 1
 * (materializeTechnicalTarget) certified a target as "structural" using ONLY
 * stableDirectAttributes, discarding any composite structural identity (owner/
 * stableDescendants/semanticShape/ambiguity) already available on its input -- even when a real
 * owner was recorded (Discovery's own composite structural-match already proved unique for real
 * Step 4: before=312 -> ... -> final=1). This is what kept the structural-authority wiring from
 * the prior ticket permanently inert for Tier-1 candidates: resolveCertifiedStructuralAuthority
 * only transports structuralTarget when structuralContext.owner is present. Fixed by having
 * Tier 1 preserve owner/stableDescendants/semanticShape/ambiguity metadata already on its input
 * (via the SAME shared normalizeStructuralOwnerIdentity sanitizer Recording/Discovery already
 * use for sanitization only -- ambiguity/determinism fields still pass through verbatim,
 * identically to Tiers 3/4) when an owner exists; without one, Tier 1's existing minimal shape
 * (stableDirectAttributes only) is unchanged.
 */

const TEST_TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
);

test("1/TIER1_RICH_IDENTITY_PRESERVED: owner + stableDescendants + semanticShape + ambiguity metadata all survive into structuralContext", () => {
  const certified = materializeTechnicalTarget({
    source: "recording",
    stableDirectAttributes: { href: "/synthetic/target" },
    owner: { tag: "a", role: "link" },
    stableDescendants: [{ relation: "descendant", tag: "span", stableAttributes: { class: "synthetic-icon" } }],
    semanticShape: ["span"],
    deterministicStructuralIdentity: true,
    identityAmbiguous: false,
    structuralIdentityMatchCount: 1,
  });

  assert.ok(certified, "must still certify tier 1");
  assert.equal(certified!.certificationTier, 1);
  assert.equal(certified!.structuralContext?.owner?.tag, "a");
  assert.equal(certified!.structuralContext?.owner?.role, "link");
  assert.deepEqual(certified!.structuralContext?.stableDirectAttributes, { href: "/synthetic/target" });
  assert.equal(certified!.structuralContext?.stableDescendants?.length, 1);
  assert.equal(certified!.structuralContext?.stableDescendants?.[0]?.tag, "span");
  assert.deepEqual(certified!.structuralContext?.semanticShape, ["span"]);
  assert.equal(certified!.structuralContext?.deterministicStructuralIdentity, true);
  assert.equal(certified!.structuralContext?.identityAmbiguous, false);
  assert.equal(certified!.structuralContext?.structuralIdentityMatchCount, 1);
});

test("2/TIER1_MINIMAL_LEGACY: only stableDirectAttributes (no owner) preserves the existing minimal shape -- no owner/identity fabricated", () => {
  const certified = materializeTechnicalTarget({
    source: "discovery",
    stableDirectAttributes: { "data-testid": "synthetic-widget" },
  });

  assert.ok(certified);
  assert.equal(certified!.certificationTier, 1);
  assert.deepEqual(certified!.structuralContext, { stableDirectAttributes: { "data-testid": "synthetic-widget" } });
});

test("3/TIER1_AMBIGUITY_PRESERVED: identityAmbiguous=true and structuralIdentityMatchCount>1 both reach the certified target and are honored fail-closed by the existing downstream authority gate", () => {
  const certified = materializeTechnicalTarget({
    source: "recording",
    stableDirectAttributes: { href: "/synthetic/ambiguous" },
    owner: { tag: "a" },
    identityAmbiguous: true,
    structuralIdentityMatchCount: 2,
  });

  assert.ok(certified);
  assert.equal(certified!.structuralContext?.identityAmbiguous, true);
  assert.equal(certified!.structuralContext?.structuralIdentityMatchCount, 2);

  // Downstream gate re-verification (compiler, unmodified this ticket): an ambiguous certified
  // structural target must never be selected as certified_structural authority.
  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-TIER1-AMBIG", title: "Tier1 ambiguity" },
    requiredData: [],
    steps: [{ index: 1, action: "click", description: "Click synthetic ambiguous target", target: { strategy: "text", value: "Synthetic Ambiguous" } }],
  };
  const sourceScenario = {
    title: "Tier1 ambiguity",
    steps: [{ index: 1, action: "Click synthetic ambiguous target", technicalTargetCandidates: [certified] }],
  };
  const contract = buildSpecExecutionContract(plan, sourceScenario as any, { appSlug: "synthetic-app", sectionSlug: "default-section" });
  const clickStepFromContract = contract.steps.find((s) => s.operation === "click");
  assert.ok(clickStepFromContract?.certifiedTechnicalTarget, "contract must carry the ambiguous certification through");
  const result = compileDeterministicSpec(contract, { targetSpecPath: TEST_TARGET_SPEC_PATH });
  assert.doesNotMatch(result.source, /structuralTarget:/, "ambiguous structural identity must never be selected as certified authority");
});

test("4/CROSS_BOUNDARY: a Tier1 rich target (owner present) flows materializer -> contract -> compiler -> structuralTarget in the generated candidate, no browser", () => {
  const certified = materializeTechnicalTarget({
    source: "recording",
    stableDirectAttributes: { href: "/synthetic/cross-boundary" },
    owner: { tag: "a" },
    semanticShape: [],
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
    scenario: { source: "manual", externalId: "C-CROSS-BOUNDARY", title: "Cross boundary" },
    requiredData: [],
    steps: [{ index: 1, action: "click", description: "Click synthetic cross-boundary target", target: { strategy: "text", value: "Synthetic" } }],
  };
  const sourceScenario = {
    title: "Cross boundary",
    steps: [{ index: 1, action: "Click synthetic cross-boundary target", technicalTargetCandidates: [certified] }],
  };
  const contract = buildSpecExecutionContract(plan, sourceScenario as any, { appSlug: "synthetic-app", sectionSlug: "default-section" });
  const result = compileDeterministicSpec(contract, { targetSpecPath: TEST_TARGET_SPEC_PATH });

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /structuralTarget: \{/);
  assert.match(result.source, /await pageObject\.click\(\{/);
  const structuralTargetMatch = result.source.match(/structuralTarget: (\{[\s\S]*?\}),\n\s*action:/);
  assert.ok(structuralTargetMatch);
  const emitted = JSON.parse(structuralTargetMatch![1]);
  assert.equal(emitted.structuralContext.owner.tag, "a");
});

test("5/STEP4_LIKE: composite identity unique + a standalone-ambiguity-prone href attribute -- compiler does not reduce primary authority to bare CSS alone", () => {
  const certified = materializeTechnicalTarget({
    source: "recording",
    stableDirectAttributes: { href: "/requests/create/synthetic-product" },
    owner: { tag: "a" },
    stableDescendants: [],
    semanticShape: [],
    deterministicStructuralIdentity: true,
    identityAmbiguous: false,
    structuralIdentityMatchCount: 1,
  });
  assert.ok(certified);
  assert.equal(certified!.locatorCandidates[0].strategy, "css");
  assert.equal(certified!.structuralContext?.owner?.tag, "a", "composite identity (owner) must survive even though locatorCandidates[0] is still a bare css attribute fragment");

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-STEP4-LIKE", title: "Step4-like" },
    requiredData: [],
    steps: [{ index: 1, action: "click", description: "Click synthetic multiproduct-like target", target: { strategy: "text", value: "Synthetic Multiproduct" } }],
  };
  const sourceScenario = {
    title: "Step4-like",
    steps: [{ index: 1, action: "Click synthetic multiproduct-like target", technicalTargetCandidates: [certified] }],
  };
  const contract = buildSpecExecutionContract(plan, sourceScenario as any, { appSlug: "synthetic-app", sectionSlug: "default-section" });
  const result = compileDeterministicSpec(contract, { targetSpecPath: TEST_TARGET_SPEC_PATH });

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /structuralTarget: \{/, "primary authority must be the structural identity, not just the bare CSS locatorCandidates[0]");
});
