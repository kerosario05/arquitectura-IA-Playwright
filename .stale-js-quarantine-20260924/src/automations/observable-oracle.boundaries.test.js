"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const spec_execution_contract_1 = require("./spec-execution-contract");
const spec_generation_hybrid_1 = require("./spec-generation-hybrid");
const promote_plan_1 = require("./promote-plan");
function planFor(appSlug, caseId = 901) {
    return {
        scenario: { caseId, externalId: `SYNTH-${caseId}`, title: "Synthetic oracle boundary" },
        appSlug,
        steps: [
            { index: 1, action: "assertVisible", expected: "document field invalid" },
            { index: 2, action: "assertUrl", expected: "forbidden destination absent" },
        ],
    };
}
function canonicalSource(oracle, expected, stepIndex) {
    const requirementId = `REQ-SYNTH-${stepIndex}`;
    return {
        title: "Synthetic oracle boundary",
        steps: [{ index: stepIndex, action: stepIndex === 1 ? "Validar estado" : "Validar no avance", expected }],
        observableOracles: [{
                id: `oracle-${stepIndex}`,
                requirement: requirementId,
                source: "discovery",
                stepIndex,
                requirementRefs: [requirementId],
                evidence: [],
                ...oracle,
            }],
        requirements: [{ requirementId, description: expected, polarity: oracle.polarity }],
        stepRequirementRefs: [{ stepIndex, requirementId }],
        stepClaims: [{ stepIndex, claimId: `CLAIM-${stepIndex}`, requirementId, required: true, coverable: true }],
    };
}
(0, node_test_1.default)("TEST 1 invalid field state is backed, required, and promotable", () => {
    const source = canonicalSource({
        type: "runtime_state",
        backed: true,
        polarity: "positive",
        details: {
            stateKind: "field_validation",
            fieldIdentity: { role: "textbox", name: "document" },
            expectedState: "invalid",
            association: { ariaInvalid: true, describedBy: "document-error" },
        },
        evidence: ["field_state:invalid", "aria_invalid:true", "validation_association:document-error"],
    }, "document field invalid", 1);
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(planFor("synthetic-a"), source, { appSlug: "synthetic-a" });
    const validation = (0, spec_execution_contract_1.validateSpecExecutionContract)(contract);
    strict_1.default.equal(contract.steps[0]?.required, true);
    strict_1.default.equal(contract.steps[0]?.oracle?.backed, true);
    strict_1.default.equal(validation.valid, true);
    strict_1.default.equal((0, spec_generation_hybrid_1.buildPromotedOracleImplementations)(source.observableOracles, null).length, 1);
});
(0, node_test_1.default)("TEST 2 negative no-transition oracle preserves negative polarity and evidence", () => {
    const source = canonicalSource({
        type: "url_state",
        backed: true,
        polarity: "negative",
        details: { expectedUrl: "/forbidden-destination" },
        evidence: ["trigger:advance_attempt", "forbidden_transition_absent:true", "after_url:/current"],
    }, "forbidden destination absent", 2);
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(planFor("synthetic-a"), source, { appSlug: "synthetic-a" });
    const implementation = (0, spec_generation_hybrid_1.buildPromotedOracleImplementations)(source.observableOracles, null)[0];
    strict_1.default.equal(contract.steps[0]?.oracle?.backed, true);
    strict_1.default.equal(contract.steps[0]?.oracle?.polarity, "negative");
    strict_1.default.equal(implementation?.polarity, "negative");
    strict_1.default.equal(implementation?.expectedUrlPattern, "/forbidden-destination");
    strict_1.default.equal((0, spec_execution_contract_1.validateSpecExecutionContract)(contract).valid, true);
});
(0, node_test_1.default)("TEST 4 narrative without runtime evidence remains required and blocks promotion", () => {
    const source = canonicalSource({
        type: "unsupported_or_unresolved",
        backed: false,
        source: "scenario",
        evidence: ["backing_evidence_missing"],
    }, "document validation appears", 1);
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(planFor("synthetic-a"), source, { appSlug: "synthetic-a" });
    strict_1.default.equal(contract.steps[0]?.required, true);
    strict_1.default.equal(Boolean(contract.steps[0]?.oracle?.backed), false);
    strict_1.default.equal(contract.steps[0]?.executionStatus, "unresolved");
    strict_1.default.equal((0, spec_execution_contract_1.validateSpecExecutionContract)(contract).valid, false);
});
(0, node_test_1.default)("TEST 5 round-trip preserves oracle identity, polarity, refs, and evidence", async () => {
    const root = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "oracle-round-trip-"));
    try {
        const planPath = node_path_1.default.join(root, "plan.json");
        const plan = planFor("synthetic-a");
        const source = canonicalSource({
            type: "url_state",
            backed: true,
            polarity: "negative",
            evidence: ["forbidden_transition_absent:true"],
            details: { expectedUrl: "/forbidden-destination" },
        }, "forbidden destination absent", 2);
        const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(plan, source, { appSlug: "synthetic-a" });
        node_fs_1.default.writeFileSync(planPath, JSON.stringify({ ...plan, sourceScenario: source, executionContract: contract }));
        await (0, promote_plan_1.persistFreshPlanForExistingSpecReuse)({ planPath, plan, sourceScenario: source, executionContract: contract });
        const roundTrip = JSON.parse(node_fs_1.default.readFileSync(planPath, "utf8"));
        const oracle = roundTrip.sourceScenario.observableOracles[0];
        strict_1.default.equal(oracle.id, "oracle-2");
        strict_1.default.equal(oracle.polarity, "negative");
        strict_1.default.deepEqual(oracle.requirementRefs, ["REQ-SYNTH-2"]);
        strict_1.default.equal(roundTrip.executionContract.steps[0].oracle.polarity, "negative");
        strict_1.default.equal(roundTrip.executionContract.steps[0].evidenceRefs[0], "oracle:oracle-2");
        strict_1.default.equal(Object.values(roundTrip).some((value) => String(value).includes("password")), false);
    }
    finally {
        node_fs_1.default.rmSync(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("TEST 6 the same oracle contract logic is independent across synthetic projects", () => {
    const sourceA = canonicalSource({
        type: "runtime_state",
        backed: true,
        polarity: "positive",
        evidence: ["field_state:invalid"],
    }, "document field invalid", 1);
    const sourceB = { ...sourceA, title: "Synthetic oracle boundary B" };
    const contractA = (0, spec_execution_contract_1.buildSpecExecutionContract)(planFor("synthetic-a", 902), sourceA, { appSlug: "synthetic-a" });
    const contractB = (0, spec_execution_contract_1.buildSpecExecutionContract)(planFor("synthetic-b", 903), sourceB, { appSlug: "synthetic-b" });
    strict_1.default.equal(contractA.steps[0]?.oracle?.type, contractB.steps[0]?.oracle?.type);
    strict_1.default.equal(contractA.steps[0]?.oracle?.backed, true);
    strict_1.default.equal(contractB.steps[0]?.oracle?.backed, true);
    strict_1.default.equal((0, spec_execution_contract_1.validateSpecExecutionContract)(contractA).valid, true);
    strict_1.default.equal((0, spec_execution_contract_1.validateSpecExecutionContract)(contractB).valid, true);
});
(0, node_test_1.default)("TEST 7 before-after mutation is required before promoting field validation", () => {
    const before = {
        structuralFingerprint: "screen-before",
        field: { identity: "document", invalid: false, describedBy: null },
        transition: { attempted: false, url: "/current" },
    };
    const after = {
        structuralFingerprint: "screen-after",
        field: { identity: "document", invalid: true, describedBy: "document-error" },
        transition: { attempted: true, url: "/current" },
    };
    strict_1.default.notEqual(before.structuralFingerprint, after.structuralFingerprint);
    strict_1.default.equal(before.field.invalid, false);
    strict_1.default.equal(after.field.invalid, true);
    strict_1.default.equal(after.field.describedBy, "document-error");
    strict_1.default.equal(after.transition.attempted, true);
    strict_1.default.equal(after.transition.url, before.transition.url);
    const source = canonicalSource({
        type: "runtime_state",
        backed: true,
        polarity: "positive",
        details: {
            stateKind: "before_after_mutation",
            beforeState: before,
            afterState: after,
            trigger: "advance_attempt",
        },
        evidence: [
            "before:fingerprint=screen-before",
            "after:fingerprint=screen-after",
            "after:field.invalid=true",
            "after:field.describedBy=document-error",
        ],
    }, "document field invalid", 1);
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(planFor("synthetic-a"), source, { appSlug: "synthetic-a" });
    strict_1.default.equal(contract.steps[0]?.oracle?.backed, true);
    strict_1.default.deepEqual(contract.steps[0]?.evidenceRefs, ["oracle:oracle-1"]);
    strict_1.default.equal((0, spec_execution_contract_1.validateSpecExecutionContract)(contract).valid, true);
});
(0, node_test_1.default)("TEST 8 focal integration maps canonical evidence to oracle, contract, coverage, and promotion", async () => {
    const requirementOne = "document field invalid";
    const requirementTwo = "forbidden destination absent";
    const source = {
        title: "Synthetic focal integration",
        steps: [
            { index: 1, action: "Validar estado", expected: requirementOne },
            { index: 2, action: "Validar no avance", expected: requirementTwo },
        ],
        observableOracles: [
            {
                id: "oracle-integration-1",
                requirement: requirementOne,
                type: "runtime_state",
                backed: true,
                source: "discovery",
                stepIndex: 1,
                evidence: ["after:field.invalid=true"],
                polarity: "positive",
            },
            {
                id: "oracle-integration-2",
                requirement: requirementTwo,
                type: "url_state",
                backed: true,
                source: "discovery",
                stepIndex: 2,
                evidence: ["after:url=/current", "forbidden_transition_absent:true"],
                polarity: "negative",
                details: { expectedUrl: "/forbidden-destination" },
            },
        ],
        requirements: [
            { requirementId: requirementOne, description: requirementOne, polarity: "positive" },
            { requirementId: requirementTwo, description: requirementTwo, polarity: "negative" },
        ],
        stepRequirementRefs: [
            { stepIndex: 1, requirementId: requirementOne },
            { stepIndex: 2, requirementId: requirementTwo },
        ],
        stepClaims: [
            { stepIndex: 1, claimId: "claim-integration-1", requirementId: requirementOne, required: true, coverable: true },
            { stepIndex: 2, claimId: "claim-integration-2", requirementId: requirementTwo, required: true, coverable: true },
        ],
    };
    const plan = {
        ...planFor("synthetic-integration", 904),
        steps: [
            { index: 1, action: "assertVisible", expected: requirementOne },
            { index: 2, action: "assertUrl", expected: requirementTwo },
        ],
    };
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(plan, source, { appSlug: "synthetic-integration" });
    const contractValidation = (0, spec_execution_contract_1.validateSpecExecutionContract)(contract);
    const promoted = (0, spec_generation_hybrid_1.buildPromotedOracleImplementations)(source.observableOracles, null);
    const coverage = (0, spec_generation_hybrid_1.buildSemanticCoverageDiagnostics)({
        semanticErrors: [],
        requiredAssertions: [requirementOne, requirementTwo],
        observableOracles: source.observableOracles,
        scenarioSteps: source.steps ?? [],
    });
    strict_1.default.equal(contractValidation.valid, true);
    strict_1.default.equal(contract.steps.filter((step) => step.required).length, 2);
    strict_1.default.equal(promoted.length, 2);
    strict_1.default.deepEqual(promoted.map((item) => item.polarity), ["positive", "negative"]);
    strict_1.default.deepEqual(coverage.missingRequirements, []);
    strict_1.default.deepEqual(coverage.candidateCoverage.map((item) => item.implemented), [true, true]);
    const root = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "oracle-integration-"));
    try {
        const appDir = node_path_1.default.join(root, "automations", "apps", "synthetic-integration");
        const caseDir = node_path_1.default.join(appDir, "sections", "synthetic", "cases", "case");
        node_fs_1.default.mkdirSync(caseDir, { recursive: true });
        const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
        const deterministicDraft = [
            "import { test, expect } from '@playwright/test';",
            "import { createPromotedSpecRuntime } from 'BROKEN_RUNTIME_IMPORT';",
            "export const PROMOTED_SPEC_STRATEGY = \"pom_runtime\";",
            "test('Synthetic focal integration', async ({ page }) => {",
            "  process.env.APP_SLUG = 'synthetic-integration';",
            "  process.env.SECTION_SLUG = 'synthetic';",
            "  process.env.SCENARIO_ID = 'SYNTH-904';",
            "  process.env.SCENARIO_TITLE = 'Synthetic focal integration';",
            "  const promotedRuntime = createPromotedSpecRuntime(page);",
            "  try {",
            "    await promotedRuntime.expectPromotedVisible({ stepIndex: 1, target: 'document field invalid', polarity: 'positive', assertion: async () => { await expect(page.locator('body')).toBeVisible(); } });",
            "    await promotedRuntime.expectPromotedVisible({ stepIndex: 2, target: 'forbidden destination absent', polarity: 'negative', expectedUrl: '/forbidden-destination', assertion: async () => { await expect(page.locator('body')).toBeVisible(); } });",
            "  } finally {",
            "    await promotedRuntime.finishEvidence();",
            "  }",
            "});",
        ].join("\n");
        const aiEnvironmentKeys = [
            "AI_ENABLED",
            "AI_SPEC_GENERATION_ENABLED",
            "AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED",
        ];
        const previousAiEnvironment = Object.fromEntries(aiEnvironmentKeys.map((key) => [key, process.env[key]]));
        let generation;
        try {
            for (const key of aiEnvironmentKeys)
                process.env[key] = "false";
            generation = await (0, spec_generation_hybrid_1.runHybridSpecGeneration)({
                plan,
                deterministicDraft,
                appProfile: {
                    appSlug: "synthetic-integration",
                    source: "default",
                    createdAt: "",
                    updatedAt: "",
                },
                appPaths: {
                    appDir,
                    configPath: node_path_1.default.join(appDir, "app.config.json"),
                    caseDir,
                    specPath,
                },
                sectionSlug: "synthetic",
                scenarioId: "SYNTH-904",
                sourceScenario: source,
                executionSource: "synthetic-boundary-test",
            }, {
                runTypeScriptValidation: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
                runPlaywrightDiscovery: async () => ({ ok: true, stdout: "Total: 1 test in 1 file", stderr: "", exitCode: 0 }),
            });
        }
        finally {
            for (const [key, value] of Object.entries(previousAiEnvironment)) {
                if (value === undefined)
                    delete process.env[key];
                else
                    process.env[key] = value;
            }
        }
        strict_1.default.equal(generation.promotionAllowed, true);
        strict_1.default.equal(generation.diagnostics.validation.structure, "passed");
        strict_1.default.equal(generation.diagnostics.validation.semanticCoverage, "passed");
        strict_1.default.equal(generation.diagnostics.validation.typescript, "passed");
        strict_1.default.equal(generation.diagnostics.validation.playwrightDiscovery, "passed");
    }
    finally {
        node_fs_1.default.rmSync(root, { recursive: true, force: true });
    }
});
