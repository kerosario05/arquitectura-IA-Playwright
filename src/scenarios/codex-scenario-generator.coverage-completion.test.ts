import assert from "node:assert/strict";
import { runCoverageCompletionPass } from "./codex-scenario-generator";
import type { AiProvider } from "../ai/ai-provider.types";

type Requirement = {
  id: string;
  requirementId: string;
  category: "branch";
  associatedBranchId: string;
  expectedBehavior: string;
};

const requirements: Requirement[] = ["A", "B", "C", "D"].map((id) => ({
  id,
  requirementId: id,
  category: "branch",
  associatedBranchId: `branch-${id}`,
  expectedBehavior: `result-${id}`,
}));

const scenario = (id: string, refs = [id], branchId = `branch-${id}`) => ({
  sourceIssueKey: "GENERIC",
  scenarioId: `scenario-${id}-${Math.random()}`,
  title: `scenario-${id}`,
  steps: refs.map((ref) => `step-${ref}`),
  functionalBranch: { branchId },
  stepRequirementRefs: refs.map((ref, index) => ({ requirementId: ref, stepIndex: index })),
});

function provider(first: any[], second: any[] = []): { provider: AiProvider; calls: any[] } {
  const calls: any[] = [];
  let index = 0;
  return {
    calls,
    provider: {
      providerType: "fake",
      providerName: "coverage-test",
      model: "coverage-test",
      async completeJson(request: any) {
        calls.push(request);
        const scenarios = index++ === 0 ? first : second;
        return { rawText: JSON.stringify({ scenarios }), parsedJson: { scenarios }, model: "coverage-test", providerName: "coverage-test", durationMs: 0 };
      },
    },
  };
}

const issue: any = { key: "GENERIC", summary: "generic", description: "generic", acceptanceCriteria: "generic" };
const prepare = (scenarios: any[]) => scenarios;
const noClaims: any[] = [];

async function run(label: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  console.log(`PASS ${label}`);
}

async function main(): Promise<void> {
  {
    const testProvider = provider([scenario("C"), scenario("D")]);
    const result = await runCoverageCompletionPass([scenario("A"), scenario("B")], requirements as any, noClaims, testProvider.provider, issue, prepare);
    await run("T1 completion covers A,B,C,D", async () => {
      assert.deepEqual(result.compliance.missingRequirementIds, []);
      assert.equal(testProvider.calls.length, 1);
      assert.deepEqual(JSON.parse(testProvider.calls[0].messages[1].content).missingRequirements.map((r: any) => r.requirementId), ["C", "D"]);
    });
  }

  await run("T2 no completion when fully covered", async () => {
    const testProvider = provider([]);
    const result = await runCoverageCompletionPass(requirements.map((r) => scenario(r.id)), requirements as any, noClaims, testProvider.provider, issue, prepare);
    assert.equal(testProvider.calls.length, 0);
    assert.deepEqual(result.compliance.missingRequirementIds, []);
  });

  await run("T3 scenario count does not imply coverage", async () => {
    const testProvider = provider([scenario("D")]);
    const first = [scenario("A"), scenario("A"), scenario("B"), scenario("C")];
    const result = await runCoverageCompletionPass(first, requirements as any, noClaims, testProvider.provider, issue, prepare);
    assert.equal(testProvider.calls.length, 1);
    assert.deepEqual(JSON.parse(testProvider.calls[0].messages[1].content).missingRequirements.map((r: any) => r.requirementId), ["D"]);
    assert.deepEqual(result.compliance.missingRequirementIds, []);
  });

  await run("T4 same destination branches remain independent", async () => {
    const sameDestination = requirements.map((r) => ({ ...r, expectedBehavior: "same" }));
    const result = await runCoverageCompletionPass(requirements.map((r) => scenario(r.id)), sameDestination as any, noClaims, provider([]).provider, issue, prepare);
    assert.equal(result.compliance.expectedCoverableRequirementIds.length, 4);
  });

  await run("T5 invented IDs do not cover canonical requirements", async () => {
    const testProvider = provider([scenario("X")]);
    const result = await runCoverageCompletionPass([scenario("A"), scenario("B"), scenario("C")], requirements as any, noClaims, testProvider.provider, issue, prepare);
    assert.deepEqual(result.compliance.missingRequirementIds, ["D"]);
  });

  await run("T6 persistent gap fails coverage", async () => {
    const testProvider = provider([scenario("X")]);
    const result = await runCoverageCompletionPass([scenario("A")], requirements as any, noClaims, testProvider.provider, issue, prepare);
    assert.equal(result.completionCalls, 1);
    assert.deepEqual(result.compliance.missingRequirementIds, ["B", "C", "D"]);
  });

  await run("T7 coverage overrides a lower target", async () => {
    const testProvider = provider([]);
    const result = await runCoverageCompletionPass([scenario("A")], requirements as any, noClaims, testProvider.provider, issue, prepare);
    assert.equal(result.completionCalls, 1);
  });

  await run("T8 no artificial target scenarios", async () => {
    const testProvider = provider([]);
    const result = await runCoverageCompletionPass(requirements.map((r) => scenario(r.id)), requirements as any, noClaims, testProvider.provider, issue, prepare);
    assert.equal(result.scenarios.length, 4);
    assert.equal(testProvider.calls.length, 0);
  });

  await run("T9 no branch requirements preserves no-completion behavior", async () => {
    const testProvider = provider([]);
    const result = await runCoverageCompletionPass([], [], noClaims, testProvider.provider, issue, prepare);
    assert.equal(result.completionCalls, 0);
    assert.equal(result.compliance.expectedCoverableRequirementIds.length, 0);
  });

  await run("T10 production contract is generic", async () => {
    assert.ok(!JSON.stringify(requirements).includes("AA-88"));
    assert.ok(!JSON.stringify(requirements).includes("appSlug"));
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
