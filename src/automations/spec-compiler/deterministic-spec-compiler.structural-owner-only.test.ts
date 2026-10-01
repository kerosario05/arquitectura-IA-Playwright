import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import type { SpecExecutionContract, SpecExecutionContractStep } from "../spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "./deterministic-spec-compiler";

/**
 * Recording 73f03712: the replay re-found the icon-only back arrows by structure, but spec
 * generation refused them (click_insufficient_authority:structural_certification_missing_candidate)
 * because the compiler kept its own, older copy of the resolver's rules. Both now share
 * structural-owner-eligibility.ts; these tests pin the compiler side of that contract.
 */

const TEST_TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
);

function compile(steps: SpecExecutionContractStep[]) {
  const contract = {
    version: "1",
    scenarioId: "SYN-ARROW",
    title: "synthetic arrow",
    steps,
    unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: steps.length, representedScenarioSteps: steps.length, missingScenarioSteps: [] },
  } as unknown as SpecExecutionContract;
  return compileDeterministicSpecRaw(contract, { targetSpecPath: TEST_TARGET_SPEC_PATH });
}

function iconArrowStep(scenarioStepIndex: number, structural: Record<string, unknown> = {}): SpecExecutionContractStep {
  return {
    contractStepIndex: scenarioStepIndex - 1,
    scenarioStepIndex,
    originalText: "Presionar el control indicado",
    operation: "click",
    required: true,
    executionStatus: "executed",
    evidenceRefs: [],
    certifiedTechnicalTarget: {
      targetType: "structural",
      locatorCandidates: [],
      interactionEvidence: ["v2_click_owner"],
      confidence: 0.85,
      validatedByInteraction: true,
      certifiedFrom: "recording",
      certificationTier: 4,
      structuralContext: {
        owner: { tag: "button" },
        stableDirectAttributes: {},
        stableDescendants: [],
        semanticShape: ["svg"],
        landmarkAncestor: { tag: "main" },
        deterministicStructuralIdentity: false,
        structuralIdentityMatchCount: 1,
        scopeIdentity: { strategy: "id", value: "root" },
        targetFingerprint: "{\"owner\":{\"tag\":\"button\"},\"semanticShape\":[\"svg\"]}",
        captureScopeUnique: true,
        captureTargetMatchCount: 1,
        topologySignature: "{\"childEntries\":[[\"svg\",1]],\"descendantEntries\":[[\"path\",2],[\"svg\",1]]}",
        ...structural,
      },
    },
  } as unknown as SpecExecutionContractStep;
}

const NAMED_CLICK: SpecExecutionContractStep = {
  contractStepIndex: 2,
  scenarioStepIndex: 3,
  originalText: "Presionar Cuentas",
  operation: "click",
  required: true,
  executionStatus: "executed",
  evidenceRefs: [],
  target: { strategy: "role", role: "button", name: "Cuentas" },
} as unknown as SpecExecutionContractStep;

test("an icon-only arrow with unique recorded structure compiles to a structural click (no unsupported step)", () => {
  const result = compile([iconArrowStep(1), iconArrowStep(2), NAMED_CLICK]);
  assert.deepEqual(result.unsupportedCapabilities, []);
  const source = result.source;
  assert.match(source, /import \{[^}]*resolveRecordedStructuralOwner[^}]*\} from '/);
  assert.match(source, /async function structuralOwnerLocator\(/);
  // The runtime gets the structure itself, and context replays re-find it the same way.
  assert.equal((source.match(/structuralTarget: \{"targetType":"structural"/g) ?? []).length, 2);
  assert.match(source, /await \(await structuralOwnerLocator\(page, \{/);
  // Never a fabricated text/role locator for the arrow.
  assert.doesNotMatch(source, /getByRole\('button'\)\./);
});

test("the generated spec is syntactically valid TypeScript", () => {
  const result = compile([iconArrowStep(1), NAMED_CLICK]);
  const source = result.source;
  const output = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.deepEqual((output.diagnostics ?? []).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});

test("an icon-only arrow whose structure was not unique, scoped or topologically recorded stays unsupported", () => {
  for (const structural of [{ captureScopeUnique: false }, { structuralIdentityMatchCount: 2 }, { topologySignature: undefined }, { scopeIdentity: undefined }, { identityAmbiguous: true }]) {
    const result = compile([iconArrowStep(1, structural)]);
    assert.equal(result.unsupportedCapabilities.length, 1, JSON.stringify(structural));
    assert.match(result.unsupportedCapabilities[0], /^scenarioStepIndex=1:click_insufficient_authority:/, JSON.stringify(structural));
  }
});

test("a certified arrow whose only locator is a nameless role is replayed by structure, never by getByRole('button')", () => {
  const withBareRole = iconArrowStep(1);
  (withBareRole as any).certifiedTechnicalTarget.locatorCandidates = [{ strategy: "role", value: "button", confidence: 0.85 }];
  const result = compile([withBareRole, NAMED_CLICK]);
  assert.deepEqual(result.unsupportedCapabilities, []);
  const source = result.source;
  // Step 3's session-reset replay of step 1 and step 1's own callback both go through the structure.
  assert.match(source, /stepIndex: 1, actionIntent: 'restore_recorded_context'[^\n]*structuralOwnerLocator\(page,/);
  assert.doesNotMatch(source, /parseSerializedTechnicalTargetString\('role:button'\)/);
  const output = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.deepEqual(output.diagnostics ?? [], []);
});
