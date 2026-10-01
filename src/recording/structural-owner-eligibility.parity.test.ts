import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { evaluateStructuralOwnerEligibility, STRUCTURAL_RESOLUTION_EVIDENCE_KEYS, type StructuralOwnerContext } from "./structural-owner-eligibility";
import { materializeTechnicalTarget, normalizeRecordingEvidence } from "../automations/technical-target-materializer";
import { resolveRecordedStructuralOwner } from "../discovery/target-resolver";
import { compileDeterministicSpec } from "../automations/spec-compiler/deterministic-spec-compiler";
import type { RecordedTechnicalTarget } from "./session-trace.types";
import type { SpecExecutionContract, SpecExecutionContractStep } from "../automations/spec-execution-contract";

/**
 * The replay resolver and the spec compiler must reach the SAME verdict on whether a structural
 * owner with no locator can be re-found. They once kept two copies of this rule; the copies drifted
 * and a recording replayed fine while its spec could not be generated (recording 73f03712).
 * If either side stops asking structural-owner-eligibility.ts, this matrix catches it.
 */

const ICON_ARROW: StructuralOwnerContext = {
  owner: { tag: "button" },
  stableDirectAttributes: {},
  stableDescendants: [],
  semanticShape: ["svg"],
  deterministicStructuralIdentity: false,
  structuralIdentityMatchCount: 1,
  scopeIdentity: { strategy: "id", value: "root" },
  targetFingerprint: "fingerprint",
  captureScopeUnique: true,
  captureTargetMatchCount: 1,
  topologySignature: "{\"childEntries\":[[\"svg\",1]]}",
};

const MATRIX: Array<[string, StructuralOwnerContext]> = [
  ["icon-only arrow unique in scope", ICON_ARROW],
  ["deterministic with stable attribute", { owner: { tag: "button" }, deterministicStructuralIdentity: true, stableDirectAttributes: { "data-role": "back" }, structuralIdentityMatchCount: 1 }],
  ["deterministic topology tie-break", { owner: { tag: "div" }, deterministicStructuralIdentity: true, topologyTieBreakUnique: true, structuralIdentityMatchCount: 1, semanticShape: ["span"] }],
  ["deterministic but no anchor nor topology", { owner: { tag: "button" }, deterministicStructuralIdentity: true, structuralIdentityMatchCount: 1, semanticShape: ["svg"] }],
  ["non-deterministic, scope not unique", { ...ICON_ARROW, captureScopeUnique: false }],
  ["non-deterministic, no topology", { ...ICON_ARROW, topologySignature: undefined }],
  ["non-deterministic, two matches", { ...ICON_ARROW, structuralIdentityMatchCount: 2 }],
  ["ambiguous at capture", { ...ICON_ARROW, identityAmbiguous: true }],
  ["no owner", { ...ICON_ARROW, owner: undefined }],
  ["invalid owner tag", { ...ICON_ARROW, owner: { tag: "bu tton" } }],
];

function technicalTarget(context: StructuralOwnerContext): RecordedTechnicalTarget {
  return { targetType: "structural", locatorCandidates: [], structuralContext: context, interactionEvidence: ["v2_click_owner"], confidence: 0.85, validatedByInteraction: true } as unknown as RecordedTechnicalTarget;
}

/** A page where every selector matches exactly one visible, enabled element. */
function permissivePage() {
  const locator: any = {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    locator: () => locator,
  };
  return { locator: () => locator, evaluate: async () => ({ matched: true, matchCount: 1, marker: "m" }) } as any;
}

function compilerAccepts(context: StructuralOwnerContext): boolean {
  const step = {
    contractStepIndex: 0, scenarioStepIndex: 1, originalText: "click", operation: "click", required: true, executionStatus: "executed", evidenceRefs: [],
    certifiedTechnicalTarget: { ...technicalTarget(context), certifiedFrom: "recording", certificationTier: 4 },
  } as unknown as SpecExecutionContractStep;
  const contract = { version: "1", scenarioId: "P", title: "p", steps: [step], unresolvedRequiredOracles: [], diagnostics: { requiredScenarioSteps: 1, representedScenarioSteps: 1, missingScenarioSteps: [] } } as unknown as SpecExecutionContract;
  const result = compileDeterministicSpec(contract, { targetSpecPath: path.resolve("automations/apps/p/sections/s/cases/c/case.spec.ts") });
  return result.unsupportedCapabilities.length === 0;
}

for (const [label, context] of MATRIX) {
  test(`replay and spec compiler agree: ${label}`, async () => {
    const eligible = evaluateStructuralOwnerEligibility(context).eligible;
    const replayResolves = Boolean(await resolveRecordedStructuralOwner(permissivePage(), technicalTarget(context)));
    assert.equal(replayResolves, eligible, "replay resolver must follow the shared rule");
    assert.equal(compilerAccepts(context), eligible, "spec compiler must follow the shared rule");
  });
}

/**
 * The compiler never sees the recorded context directly: it sees the certificate the
 * technical-target materializer rebuilds from it, tier by tier. That rebuild once dropped the
 * scope evidence, so an owner the replay resolved reached the compiler ineligible. The
 * certificate must keep the recorded verdict -- never lose an eligible owner, never invent one.
 */
function materialize(context: StructuralOwnerContext) {
  const evidence = normalizeRecordingEvidence(technicalTarget(context), { operation: "click" });
  return evidence ? materializeTechnicalTarget(evidence) : undefined;
}

for (const [label, context] of MATRIX) {
  test(`materialized certificate keeps the recorded verdict: ${label}`, () => {
    const eligible = evaluateStructuralOwnerEligibility(context).eligible;
    const certificate = materialize(context);
    const certifiedContext = certificate?.structuralContext as StructuralOwnerContext | undefined;
    if (eligible) {
      assert.ok(certificate, "an eligible owner must be certified");
      assert.equal(evaluateStructuralOwnerEligibility(certifiedContext).eligible, true, "certificate lost evidence the rule needs");
      assert.equal(compilerAccepts(certifiedContext!), true, "spec compiler must accept the certified owner");
    } else if (certifiedContext?.owner) {
      assert.equal(evaluateStructuralOwnerEligibility(certifiedContext).eligible, false, "certificate must not make an ineligible owner eligible");
    }
  });
}

test("every field the eligibility rule reads survives materialization", () => {
  const certifiedContext = materialize(ICON_ARROW)?.structuralContext as Record<string, unknown> | undefined;
  for (const key of STRUCTURAL_RESOLUTION_EVIDENCE_KEYS) {
    if ((ICON_ARROW as Record<string, unknown>)[key] === undefined) continue;
    assert.deepEqual(certifiedContext?.[key], (ICON_ARROW as Record<string, unknown>)[key], key);
  }
});
