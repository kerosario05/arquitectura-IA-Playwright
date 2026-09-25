"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const codex_scenario_generator_1 = require("./codex-scenario-generator");
const requirements = ["A", "B", "C", "D"].map((id) => ({
    id,
    requirementId: id,
    category: "branch",
    associatedBranchId: `branch-${id}`,
    expectedBehavior: `result-${id}`,
}));
const scenario = (id, refs = [id], branchId = `branch-${id}`) => ({
    sourceIssueKey: "GENERIC",
    scenarioId: `scenario-${id}-${Math.random()}`,
    title: `scenario-${id}`,
    steps: refs.map((ref) => `step-${ref}`),
    functionalBranch: { branchId },
    stepRequirementRefs: refs.map((ref, index) => ({ requirementId: ref, stepIndex: index })),
});
function provider(first, second = []) {
    const calls = [];
    let index = 0;
    return {
        calls,
        provider: {
            providerType: "fake",
            providerName: "coverage-test",
            model: "coverage-test",
            async completeJson(request) {
                calls.push(request);
                const scenarios = index++ === 0 ? first : second;
                return { rawText: JSON.stringify({ scenarios }), parsedJson: { scenarios }, model: "coverage-test", providerName: "coverage-test", durationMs: 0 };
            },
        },
    };
}
const issue = { key: "GENERIC", summary: "generic", description: "generic", acceptanceCriteria: "generic" };
const prepare = (scenarios) => scenarios;
const noClaims = [];
async function run(label, fn) {
    await fn();
    console.log(`PASS ${label}`);
}
async function main() {
    {
        const testProvider = provider([scenario("C"), scenario("D")]);
        const result = await (0, codex_scenario_generator_1.runCoverageCompletionPass)([scenario("A"), scenario("B")], requirements, noClaims, testProvider.provider, issue, prepare);
        await run("T1 completion covers A,B,C,D", async () => {
            strict_1.default.deepEqual(result.compliance.missingRequirementIds, []);
            strict_1.default.equal(testProvider.calls.length, 1);
            strict_1.default.deepEqual(JSON.parse(testProvider.calls[0].messages[1].content).missingRequirements.map((r) => r.requirementId), ["C", "D"]);
        });
    }
    await run("T2 no completion when fully covered", async () => {
        const testProvider = provider([]);
        const result = await (0, codex_scenario_generator_1.runCoverageCompletionPass)(requirements.map((r) => scenario(r.id)), requirements, noClaims, testProvider.provider, issue, prepare);
        strict_1.default.equal(testProvider.calls.length, 0);
        strict_1.default.deepEqual(result.compliance.missingRequirementIds, []);
    });
    await run("T3 scenario count does not imply coverage", async () => {
        const testProvider = provider([scenario("D")]);
        const first = [scenario("A"), scenario("A"), scenario("B"), scenario("C")];
        const result = await (0, codex_scenario_generator_1.runCoverageCompletionPass)(first, requirements, noClaims, testProvider.provider, issue, prepare);
        strict_1.default.equal(testProvider.calls.length, 1);
        strict_1.default.deepEqual(JSON.parse(testProvider.calls[0].messages[1].content).missingRequirements.map((r) => r.requirementId), ["D"]);
        strict_1.default.deepEqual(result.compliance.missingRequirementIds, []);
    });
    await run("T4 same destination branches remain independent", async () => {
        const sameDestination = requirements.map((r) => ({ ...r, expectedBehavior: "same" }));
        const result = await (0, codex_scenario_generator_1.runCoverageCompletionPass)(requirements.map((r) => scenario(r.id)), sameDestination, noClaims, provider([]).provider, issue, prepare);
        strict_1.default.equal(result.compliance.expectedCoverableRequirementIds.length, 4);
    });
    await run("T5 invented IDs do not cover canonical requirements", async () => {
        const testProvider = provider([scenario("X")]);
        const result = await (0, codex_scenario_generator_1.runCoverageCompletionPass)([scenario("A"), scenario("B"), scenario("C")], requirements, noClaims, testProvider.provider, issue, prepare);
        strict_1.default.deepEqual(result.compliance.missingRequirementIds, ["D"]);
    });
    await run("T6 persistent gap fails coverage", async () => {
        const testProvider = provider([scenario("X")]);
        const result = await (0, codex_scenario_generator_1.runCoverageCompletionPass)([scenario("A")], requirements, noClaims, testProvider.provider, issue, prepare);
        strict_1.default.equal(result.completionCalls, 1);
        strict_1.default.deepEqual(result.compliance.missingRequirementIds, ["B", "C", "D"]);
    });
    await run("T7 coverage overrides a lower target", async () => {
        const testProvider = provider([]);
        const result = await (0, codex_scenario_generator_1.runCoverageCompletionPass)([scenario("A")], requirements, noClaims, testProvider.provider, issue, prepare);
        strict_1.default.equal(result.completionCalls, 1);
    });
    await run("T8 no artificial target scenarios", async () => {
        const testProvider = provider([]);
        const result = await (0, codex_scenario_generator_1.runCoverageCompletionPass)(requirements.map((r) => scenario(r.id)), requirements, noClaims, testProvider.provider, issue, prepare);
        strict_1.default.equal(result.scenarios.length, 4);
        strict_1.default.equal(testProvider.calls.length, 0);
    });
    await run("T9 no branch requirements preserves no-completion behavior", async () => {
        const testProvider = provider([]);
        const result = await (0, codex_scenario_generator_1.runCoverageCompletionPass)([], [], noClaims, testProvider.provider, issue, prepare);
        strict_1.default.equal(result.completionCalls, 0);
        strict_1.default.equal(result.compliance.expectedCoverableRequirementIds.length, 0);
    });
    await run("T10 production contract is generic", async () => {
        strict_1.default.ok(!JSON.stringify(requirements).includes("AA-88"));
        strict_1.default.ok(!JSON.stringify(requirements).includes("appSlug"));
    });
}
void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
