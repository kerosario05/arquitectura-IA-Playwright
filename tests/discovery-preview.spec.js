"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const discovery_preview_1 = require("../src/cli/discovery-preview");
const case_discovery_1 = require("../src/discovery/case-discovery");
const app_auto_resolver_1 = require("../src/automations/app-auto-resolver");
const scenario_normalizer_1 = require("../src/automations/scenario-normalizer");
const auto_pom_1 = require("../src/automations/auto-pom");
const spec_execution_contract_1 = require("../src/automations/spec-execution-contract");
const TECHNICAL_SLUGS = new Set(["tests", "test", "default", "unknown", "undefined", "null"]);
function isTechnicalSlug(slug) {
    return TECHNICAL_SLUGS.has(slug.trim().toLowerCase());
}
function hasNonDefaultRouteProfile(rp) {
    if (!rp)
        return false;
    const hasDomainTerms = Object.keys(rp.domainTerms ?? {}).length > 0;
    const hasEntry = (rp.entry ?? []).length > 0;
    const hasVisibleControls = (rp.visibleControls ?? []).length > 0;
    return hasDomainTerms || hasEntry || hasVisibleControls;
}
function makeRouteProfile(overrides = {}) {
    return {
        name: overrides.name ?? "test_profile",
        entry: overrides.entry ?? [
            { businessLabel: "iniciar", visibleLabel: "Iniciar" },
            { businessLabel: "informacion_productos", visibleLabel: "Información de productos" },
        ],
        aliases: overrides.aliases ?? {},
        intermediates: overrides.intermediates ?? {},
        domainTerms: overrides.domainTerms ?? { producto: ["producto"] },
        visibleControls: overrides.visibleControls ?? ["Iniciar", "Información de productos"],
        representativeFixture: overrides.representativeFixture ?? {},
        notes: overrides.notes ?? [],
    };
}
(0, test_1.test)("discovery-preview con --app propaga appProfile cli", async () => {
    const result = await (0, discovery_preview_1.resolvePreviewAppProfile)("app-a");
    (0, test_1.expect)(result.resolvedAppSlug).toBe("app-a");
    (0, test_1.expect)(result.appProfileObj.appSlug).toBe("app-a");
    (0, test_1.expect)(result.appProfileObj.source).toBe("cli");
    (0, test_1.expect)(String(result.appProfileObj.appDir)).toContain("automations/apps/app-a");
    (0, test_1.expect)(String(result.appProfileObj.configPath)).toContain("automations/apps/app-a/app.config.json");
});
(0, test_1.test)("runCaseDiscovery prioriza appSlug explicito sobre APP_SLUG del env", () => {
    (0, test_1.expect)((0, case_discovery_1.resolveCaseDiscoveryAppSlug)({
        appSlug: "app-a",
        env: { APP_SLUG: "app-b" },
    })).toBe("app-a");
});
(0, test_1.test)("runCaseDiscovery usa APP_SLUG del env si no recibe appSlug explicito", () => {
    (0, test_1.expect)((0, case_discovery_1.resolveCaseDiscoveryAppSlug)({
        env: { APP_SLUG: "app-b" },
    })).toBe("app-b");
});
(0, test_1.test)("virtualCaseToTestScenario preserves explicit TestRail case identity when present", () => {
    const scenario = (0, discovery_preview_1.virtualCaseToTestScenario)({
        id: "preview-001",
        displayId: "PREVIEW-001",
        testRailCaseId: 42811,
        title: "Caso existente",
        sourceIssueKey: "TR-C42811",
        steps: ["Clic en \"Información de productos\"."],
        expectedResult: "Se muestra el detalle",
        preconditions: [],
        appSlug: "app-a",
        routeProfile: "kiosko-default",
        dataRequirements: "",
        mcpExecutable: true,
        source: "scenario_preview",
        type: "Functional",
        automationType: "ui_with_auth_gate",
        setupStrategy: "auth_gate",
    });
    (0, test_1.expect)(scenario.source).toBe("testrail");
    (0, test_1.expect)(scenario.caseId).toBe(42811);
    (0, test_1.expect)(scenario.externalId).toBe("C42811");
});
(0, test_1.test)("virtualCaseToTestScenario uses payload routeProfile before the virtual case value", () => {
    const routeProfile = makeRouteProfile({ name: "payload-profile" });
    const scenario = (0, discovery_preview_1.virtualCaseToTestScenario)({
        id: "preview-002",
        displayId: "PREVIEW-002",
        title: "Caso con perfil explícito",
        sourceIssueKey: "TR-C42812",
        steps: ["Clic en \"Iniciar\"."],
        expectedResult: "Se inicia",
        preconditions: [],
        appSlug: "app-a",
        routeProfile: "app-config-profile",
        dataRequirements: "",
        mcpExecutable: true,
        source: "scenario_preview",
        type: "Functional",
        automationType: "ui_with_auth_gate",
        setupStrategy: "auth_gate",
    }, routeProfile);
    (0, test_1.expect)(scenario.routeProfile).toBe(routeProfile);
});
(0, test_1.test)("virtualCaseToTestScenario preserves the recording execution contract", () => {
    const scenario = (0, discovery_preview_1.virtualCaseToTestScenario)({
        id: "preview-recording-001",
        displayId: "PREVIEW-RECORDING-001",
        title: "Recording contract",
        sourceIssueKey: "REC-TEST",
        steps: ['Ingresar "123456" en "Campo"'],
        expectedResult: "Se completa",
        preconditions: [],
        appSlug: "app-a",
        dataRequirements: "",
        mcpExecutable: true,
        source: "scenario_preview",
        type: "Functional",
        automationType: "ui_with_auth_gate",
        setupStrategy: "auth_gate",
        recordingExecutionContract: {
            actions: [{
                    actionType: "fill",
                    humanStep: 'Ingresar "123456" en "Campo"',
                    targetRef: "field-a",
                    valueKey: "input.a",
                    runtimeValueSource: "dataset",
                }],
            runtimeInputRequirements: [{ valueKey: "input.a", value: "123456", valueRole: "action_input" }],
        },
    });
    (0, test_1.expect)(scenario.recordingExecutionContract?.actions).toHaveLength(1);
    (0, test_1.expect)(scenario.recordingExecutionContract?.actions[0]?.targetRef).toBe("field-a");
    (0, test_1.expect)(scenario.recordingExecutionContract?.actions[0]?.valueKey).toBe("input.a");
    (0, test_1.expect)(scenario.steps[0]?.action).toBe('Ingresar [input.a] en "Campo"');
});
(0, test_1.test)("virtualCaseToTestScenario preserves canonical and mutation authority alongside recording targets", () => {
    const scenario = (0, discovery_preview_1.virtualCaseToTestScenario)({
        id: "preview-repeat-001",
        displayId: "PREVIEW-REPEAT-001",
        title: "Repeat entity",
        sourceIssueKey: "REC-TEST",
        steps: ["Ingresar [entity_2.colaborador] en \"Colaborador\""],
        expectedResult: "Se registra la segunda entidad",
        preconditions: [],
        appSlug: "app-a",
        routeProfile: "",
        dataRequirements: "entity_2.colaborador",
        mcpExecutable: true,
        source: "scenario_preview",
        type: "Functional",
        automationType: "recorded_session",
        setupStrategy: "recorded_walkthrough",
        stepRequirementRefs: [{ stepIndex: 0, requirementId: "REQ-REPEAT", facet: "action" }],
        canonicalRequirements: [{
                requirementId: "REQ-REPEAT",
                kind: "action",
                description: "La segunda entidad usa un colaborador distinto",
                polarity: "positive",
                polaritySource: "canonical",
                polarityResolvedAt: "canonical_adapter",
                origin: { originRef: "recording:repeat" },
            }],
        repeatConstraintResolutions: [{
                valueKey: "entity_2.colaborador",
                constraintType: "uniqueWithinCollection",
                activeValueCount: 1,
                candidateCount: 1,
                distinctCandidateCount: 1,
                resolutionSource: "recorded_confirmed",
                resolved: true,
            }],
        recordingExecutionContract: {
            actions: [{
                    actionType: "fill",
                    stepIndex: 1,
                    semanticField: "Colaborador",
                    targetRef: "grid:table|entity_2|Colaborador",
                    technicalTargetRef: "role:input|Indicar...",
                    valueKey: "entity_2.colaborador",
                    runtimeValueSource: "dataset",
                }],
            runtimeInputRequirements: [{
                    valueKey: "entity_2.colaborador",
                    valueRole: "action_input",
                    constraints: [{ type: "uniqueWithinCollection", uniqueWithinCollection: true }],
                }],
        },
    });
    (0, test_1.expect)(scenario.canonicalRequirements?.[0]?.requirementId).toBe("REQ-REPEAT");
    (0, test_1.expect)(scenario.stepRequirementRefs?.[0]?.requirementId).toBe("REQ-REPEAT");
    (0, test_1.expect)(scenario.steps[0]?.valueKey).toBe("entity_2.colaborador");
    (0, test_1.expect)(scenario.steps[0]?.technicalTargetRef).toBe("role:input|Indicar...");
    (0, test_1.expect)(scenario.repeatConstraintResolutions?.[0]?.constraintType).toBe("uniqueWithinCollection");
    (0, test_1.expect)(scenario.recordingExecutionContract?.runtimeInputRequirements[0]?.valueKey).toBe("entity_2.colaborador");
});
(0, test_1.test)("spec execution contract preserves dataset valueKey after leading navigation enrichment", () => {
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)({
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "manual", title: "Repeat entity" },
        requiredData: [],
        createdAt: new Date(0).toISOString(),
        steps: [
            { index: 0, action: "navigate", target: "APP_BASE_URL", description: "Abrir la aplicación" },
            {
                index: 1,
                action: "fill",
                target: { strategy: "text", value: "Colaborador" },
                value: "[entity_2.colaborador]",
                valueKey: "entity_2.colaborador",
                description: 'Ingresar [entity_2.colaborador] en "Colaborador"',
            },
        ],
    }, {
        title: "Repeat entity",
        steps: [{
                index: 0,
                action: "fill",
                valueKey: "entity_2.colaborador",
                description: 'Ingresar [entity_2.colaborador] en "Colaborador"',
                entityScope: "entity_2",
                technicalTargetRef: "role:input|Indicar...",
            }],
    });
    (0, test_1.expect)(contract.diagnostics.missingScenarioSteps).toHaveLength(0);
    (0, test_1.expect)(contract.steps).toHaveLength(1);
    (0, test_1.expect)(contract.steps[0]?.valueKey).toBe("entity_2.colaborador");
    (0, test_1.expect)(contract.steps[0]?.implementation).toEqual({
        kind: "runtime",
        runtimeMethod: "fillPromotedField",
    });
});
(0, test_1.test)("autoPromote no considera discovered_partial como exito final si no hay spec promovido", () => {
    const completion = (0, discovery_preview_1.resolvePreviewCompletion)({
        caseResult: { status: "discovered_partial" },
        promotionStatus: "not_applicable",
    }, true);
    (0, test_1.expect)(completion.eventStatus).toBe("failed");
    (0, test_1.expect)(completion.automationReady).toBe(false);
    (0, test_1.expect)(completion.specGenerationStatus).toBe("failed");
});
(0, test_1.test)("recording replay expone spec eligibility sin afirmar que la spec ya fue generada", () => {
    const completion = (0, discovery_preview_1.resolvePreviewCompletion)({
        caseResult: { status: "discovered_passed" },
        promotionStatus: "not_promoted",
    }, false, true);
    (0, test_1.expect)(completion.eventStatus).toBe("passed");
    (0, test_1.expect)(completion.automationReady).toBe(true);
    (0, test_1.expect)(completion.specEligible).toBe(true);
    (0, test_1.expect)(completion.specGenerationInvoked).toBe(false);
    (0, test_1.expect)(completion.specGenerationStatus).toBe("deferred");
    (0, test_1.expect)(completion.specEligibilityReason).toBe("recording_spec_generation_deferred_until_explicit_product_action");
});
(0, test_1.test)("autoPromote no considera discovered_passed como exito final si spec generation falla", () => {
    const completion = (0, discovery_preview_1.resolvePreviewCompletion)({
        caseResult: { status: "discovered_passed" },
        promotionStatus: "spec_failed",
        specPath: "C:\\tmp\\case.spec.ts",
        specGeneration: {
            provider: "copilot",
            model: "gpt-5.4",
            invocations: 1,
            invocationsConsumed: 1,
            promotionAllowed: false,
            specWritten: false,
            finalSpec: { origin: "ai_candidate", fallback: null },
        },
    }, true);
    (0, test_1.expect)(completion.eventStatus).toBe("failed");
    (0, test_1.expect)(completion.automationReady).toBe(false);
    (0, test_1.expect)(completion.aiInvoked).toBe(true);
});
(0, test_1.test)("autoPromote requiere promotionAllowed y specWritten para automationReady", () => {
    const completion = (0, discovery_preview_1.resolvePreviewCompletion)({
        caseResult: { status: "discovered_passed" },
        promotionStatus: "promoted",
        specPath: "C:\\tmp\\case.spec.ts",
        specGeneration: {
            provider: "copilot",
            model: "gpt-5.4",
            invocations: 1,
            invocationsConsumed: 2,
            promotionAllowed: true,
            specWritten: true,
            finalSpec: { origin: "ai_candidate", fallback: null },
        },
    }, true);
    (0, test_1.expect)(completion.eventStatus).toBe("passed");
    (0, test_1.expect)(completion.automationReady).toBe(true);
    (0, test_1.expect)(completion.aiAttempts).toBe(2);
    (0, test_1.expect)(completion.finalSpecOrigin).toBe("ai_candidate");
});
(0, test_1.test)("T1 auto-POM promoted replaces the initial blocked status", () => {
    const promotionStatus = (0, auto_pom_1.resolveEffectiveAutoPomStatus)("promoted");
    const completion = (0, discovery_preview_1.resolvePreviewCompletion)({
        caseResult: { status: "discovered_passed" },
        promotionStatus,
        specPath: "automations/apps/project/cases/case/case.spec.ts",
        specGeneration: {
            provider: null,
            model: null,
            invocations: 0,
            invocationsConsumed: 0,
            promotionAllowed: true,
            specWritten: true,
            validation: { structure: "passed", semanticCoverage: "passed" },
            finalSpec: { origin: "deterministic", fallback: null },
        },
    }, true);
    (0, test_1.expect)(promotionStatus).toBe("promoted");
    (0, test_1.expect)(completion.specGenerationStatus).toBe("passed");
    (0, test_1.expect)(completion.automationReady).toBe(true);
});
(0, test_1.test)("T2 failed auto-POM remains fail-closed", () => {
    const promotionStatus = (0, auto_pom_1.resolveEffectiveAutoPomStatus)("needs_page_method");
    const completion = (0, discovery_preview_1.resolvePreviewCompletion)({
        caseResult: { status: "discovered_passed" },
        promotionStatus,
        specPath: "automations/apps/project/cases/case/case.spec.ts",
        specGeneration: {
            provider: null,
            model: null,
            invocations: 0,
            invocationsConsumed: 0,
            promotionAllowed: true,
            specWritten: true,
            finalSpec: { origin: "deterministic", fallback: null },
        },
    }, true);
    (0, test_1.expect)(promotionStatus).not.toBe("promoted");
    (0, test_1.expect)(completion.automationReady).toBe(false);
});
(0, test_1.test)("T3 a later spec gate failure overrides promoted readiness with the real reason", () => {
    const completion = (0, discovery_preview_1.resolvePreviewCompletion)({
        caseResult: { status: "discovered_passed" },
        promotionStatus: "promoted",
        specPath: "automations/apps/project/cases/case/case.spec.ts",
        specGeneration: {
            provider: null,
            model: null,
            invocations: 0,
            invocationsConsumed: 0,
            promotionAllowed: false,
            specWritten: true,
            validation: { structure: "failed" },
            finalSpec: { origin: "deterministic", fallback: null },
        },
    }, true);
    (0, test_1.expect)(completion.automationReady).toBe(false);
    (0, test_1.expect)(completion.reason).toBe("spec_gate_failed:structure");
});
(0, test_1.test)("T4 promotion failure without failed targets is not classified as target_not_found", () => {
    const failure = (0, discovery_preview_1.classifyPreviewFailure)({
        id: "case",
        displayId: "CASE",
        title: "Promotion failure",
        status: "failed",
        promotionStatus: "spec_failed",
        specGenerationStatus: "failed",
        promotionReason: "spec_gate_failed:structure",
        failedTargets: [],
        failedAssertions: [],
    });
    (0, test_1.expect)(failure).toEqual({ failureType: "spec_generation_failed", phase: "spec_generation" });
});
(0, test_1.test)("T5 an already promoted result remains automation ready", () => {
    const completion = (0, discovery_preview_1.resolvePreviewCompletion)({
        caseResult: { status: "discovered_passed" },
        promotionStatus: "promoted",
        specPath: "automations/apps/project/cases/case/case.spec.ts",
        specGeneration: {
            provider: null,
            model: null,
            invocations: 0,
            invocationsConsumed: 0,
            promotionAllowed: true,
            specWritten: true,
            finalSpec: { origin: "existing_spec", fallback: null },
        },
    }, true);
    (0, test_1.expect)(completion.eventStatus).toBe("passed");
    (0, test_1.expect)(completion.automationReady).toBe(true);
});
(0, test_1.test)("failureGroups agrupa fallos por causa sin perder promotion gate", () => {
    const failureGroups = (0, discovery_preview_1.buildPreviewFailureGroups)([
        {
            id: "1",
            displayId: "PREVIEW-001",
            title: "Assertion failed",
            status: "failed",
            failedTargets: [],
            failedAssertions: ["Solicitar"],
            assertionImportance: "contextual",
            discoveryStatus: "discovered_partial",
            promotionStatus: "not_applicable",
            promotionReason: "Promotion not applicable because discovery status is discovered_partial.",
        },
        {
            id: "2",
            displayId: "PREVIEW-002",
            title: "Target failed",
            status: "failed",
            failedTargets: ["el primer producto visible del listado"],
            failedAssertions: [],
            error: "target_not_found",
        },
        {
            id: "3",
            displayId: "PREVIEW-003",
            title: "Route profile failed",
            status: "failed",
            failedTargets: [],
            failedAssertions: [],
            error: "[route-profile] appSlug=default no routeProfile in app.config.json, returning undefined",
        },
    ]);
    (0, test_1.expect)(failureGroups.contextual_assertion_not_found).toBe(1);
    (0, test_1.expect)(failureGroups.target_not_found).toBeGreaterThanOrEqual(1);
    (0, test_1.expect)(failureGroups.route_profile_missing).toBe(1);
    (0, test_1.expect)(failureGroups.promotion_not_applicable).toBe(1);
    (0, test_1.expect)(failureGroups.assertion_not_found_unrecovered).toBe(0);
});
(0, test_1.test)("failureGroups separa optional y review_needed", () => {
    const failureGroups = (0, discovery_preview_1.buildPreviewFailureGroups)([
        {
            id: "1",
            displayId: "PREVIEW-010",
            title: "Optional assertion",
            status: "failed",
            failedAssertions: ["Volver"],
            assertionImportance: "optional",
            promotionStatus: "not_applicable",
        },
        {
            id: "2",
            displayId: "PREVIEW-011",
            title: "Conditional assertion",
            status: "failed",
            failedAssertions: ["Si aplica"],
            assertionImportance: "blocking",
            conditionalAssertion: true,
            conditionalRisk: "high",
            reviewNeededReason: "conditional_assertion_without_data",
            promotionStatus: "not_applicable",
        },
        {
            id: "3",
            displayId: "PREVIEW-012",
            title: "Unsafe action",
            status: "failed",
            failedAssertions: [],
            reviewNeededReason: "unsafe_action_requires_review",
            promotionStatus: "not_applicable",
        },
    ]);
    (0, test_1.expect)(failureGroups.optional_assertion_not_found).toBe(1);
    (0, test_1.expect)(failureGroups.unsafe_action_requires_review).toBe(1);
    (0, test_1.expect)(failureGroups.conditional_assertion_without_data).toBe(1);
});
(0, test_1.test)("clasifica net::ERR_CONNECTION_CLOSED como environment_navigation_error", () => {
    (0, test_1.expect)((0, discovery_preview_1.classifyPreviewFailure)({
        id: "1",
        displayId: "PREVIEW-004",
        title: "Environment failure",
        status: "failed",
        error: "page.goto: net::ERR_CONNECTION_CLOSED at https://172.27.4.50/",
    })).toEqual({
        failureType: "environment_navigation_error",
        phase: "navigation_start",
    });
});
(0, test_1.test)("dominantFailure prefiere causa raiz sobre promotion_not_applicable", () => {
    const report = (0, discovery_preview_1.buildPreviewSummaryReport)([
        {
            id: "1",
            caseId: "PREVIEW-001",
            displayId: "PREVIEW-001",
            title: "ordinal",
            status: "failed",
            failureType: "ordinal_selection_no_safe_candidate",
            promotionStatus: "not_applicable",
        },
        {
            id: "2",
            caseId: "PREVIEW-002",
            displayId: "PREVIEW-002",
            title: "ordinal-2",
            status: "failed",
            failureType: "ordinal_selection_no_safe_candidate",
            promotionStatus: "not_applicable",
        },
        {
            id: "3",
            caseId: "PREVIEW-003",
            displayId: "PREVIEW-003",
            title: "promotion consequence",
            status: "failed",
            failureType: "promotion_not_applicable",
            promotionStatus: "not_applicable",
        },
    ], 3, {
        ordinal_selection_no_safe_candidate: 2,
        promotion_not_applicable: 3,
    });
    (0, test_1.expect)(report.dominantFailure).toBe("ordinal_selection_no_safe_candidate");
});
// ── Technical slug prohibition tests ──
(0, test_1.test)("isTechnicalSlug: 'tests' is technical", () => {
    (0, test_1.expect)(isTechnicalSlug("tests")).toBe(true);
});
(0, test_1.test)("isTechnicalSlug: 'default' is technical", () => {
    (0, test_1.expect)(isTechnicalSlug("default")).toBe(true);
});
(0, test_1.test)("isTechnicalSlug: 'app-a' is NOT technical", () => {
    (0, test_1.expect)(isTechnicalSlug("app-a")).toBe(false);
});
(0, test_1.test)("isTechnicalSlug: 'kiosko' is NOT technical", () => {
    (0, test_1.expect)(isTechnicalSlug("kiosko")).toBe(false);
});
(0, test_1.test)("isTechnicalSlug: 'test' is technical", () => {
    (0, test_1.expect)(isTechnicalSlug("test")).toBe(true);
});
// ── hasNonDefaultRouteProfile tests ──
(0, test_1.test)("hasNonDefaultRouteProfile: null routeProfile is false", () => {
    (0, test_1.expect)(hasNonDefaultRouteProfile(null)).toBe(false);
});
(0, test_1.test)("hasNonDefaultRouteProfile: routeProfile with domainTerms is true", () => {
    const rp = makeRouteProfile({ domainTerms: { producto: ["producto"] }, entry: [], visibleControls: [] });
    (0, test_1.expect)(hasNonDefaultRouteProfile(rp)).toBe(true);
});
(0, test_1.test)("hasNonDefaultRouteProfile: routeProfile with entry is true", () => {
    const rp = makeRouteProfile({ entry: [{ businessLabel: "start", visibleLabel: "Start" }], domainTerms: {}, visibleControls: [] });
    (0, test_1.expect)(hasNonDefaultRouteProfile(rp)).toBe(true);
});
(0, test_1.test)("hasNonDefaultRouteProfile: routeProfile with visibleControls is true", () => {
    const rp = makeRouteProfile({ visibleControls: ["Start"], domainTerms: {}, entry: [] });
    (0, test_1.expect)(hasNonDefaultRouteProfile(rp)).toBe(true);
});
(0, test_1.test)("hasNonDefaultRouteProfile: empty routeProfile is false", () => {
    const rp = makeRouteProfile({ entry: [], domainTerms: {}, visibleControls: [], aliases: {}, intermediates: {} });
    (0, test_1.expect)(hasNonDefaultRouteProfile(rp)).toBe(false);
});
// ── AppSlug inference chain tests ──
(0, test_1.test)("inferAppFromTestRailSection: detects app from section name", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Regression App-A");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("app-a");
    (0, test_1.expect)(result.source).toBe("testrail_section");
    (0, test_1.expect)(result.confidence).toBe("high");
});
(0, test_1.test)("inferAppFromTestRailSection: returns null for empty section", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.inferAppFromTestRailSection)("")).toBeNull();
    (0, test_1.expect)((0, app_auto_resolver_1.inferAppFromTestRailSection)("   ")).toBeNull();
});
(0, test_1.test)("inferAppFromTestRailSection: strips 'tests' prefix", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Tests App-A");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("app-a");
});
(0, test_1.test)("resolveCaseDiscoveryAppSlug: uses explicit appSlug over env", () => {
    (0, test_1.expect)((0, case_discovery_1.resolveCaseDiscoveryAppSlug)({
        appSlug: "app-a",
        env: { APP_SLUG: "app-b" },
    })).toBe("app-a");
});
(0, test_1.test)("resolveCaseDiscoveryAppSlug: uses env APP_SLUG when no explicit", () => {
    (0, test_1.expect)((0, case_discovery_1.resolveCaseDiscoveryAppSlug)({
        env: { APP_SLUG: "app-b" },
    })).toBe("app-b");
});
(0, test_1.test)("resolveCaseDiscoveryAppSlug: falls back to 'default' when no source", () => {
    (0, test_1.expect)((0, case_discovery_1.resolveCaseDiscoveryAppSlug)({})).toBe("default");
});
// ── Entry step insertion tests (via normalizeEntrySteps) ──
(0, test_1.test)("normalizeEntrySteps: prepends all entry steps when none present", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "home", visibleLabel: "Inicio" },
            { businessLabel: "products", visibleLabel: "Productos" },
        ],
    });
    const input = ['Validar que se muestre "Catálogo".'];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    (0, test_1.expect)(steps[0]).toBe('Clic en "Inicio".');
    (0, test_1.expect)(steps[1]).toBe('Clic en "Productos".');
    (0, test_1.expect)(steps[2]).toBe('Validar que se muestre "Catálogo".');
});
(0, test_1.test)("normalizeEntrySteps: does not duplicate when entry steps already present", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "home", visibleLabel: "Inicio" },
            { businessLabel: "products", visibleLabel: "Productos" },
        ],
    });
    const input = [
        'Clic en "Inicio".',
        'Clic en "Productos".',
        'Validar algo.',
    ];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    (0, test_1.expect)(steps[0]).toBe('Clic en "Inicio".');
    (0, test_1.expect)(steps[1]).toBe('Clic en "Productos".');
    (0, test_1.expect)(steps[2]).toBe('Validar algo.');
    (0, test_1.expect)(steps).toHaveLength(3);
});
(0, test_1.test)("normalizeEntrySteps: inserts only missing entry steps when partially present", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "login", visibleLabel: "Iniciar sesión" },
            { businessLabel: "menu", visibleLabel: "Menú principal" },
            { businessLabel: "products", visibleLabel: "Productos" },
        ],
    });
    const input = [
        'Clic en "Menú principal".',
        'Clic en "Productos".',
        'Validar algo.',
    ];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    // "Iniciar sesión" should be prepended, others stay in order
    (0, test_1.expect)(steps[0]).toBe('Clic en "Iniciar sesión".');
    (0, test_1.expect)(steps[1]).toBe('Clic en "Menú principal".');
    (0, test_1.expect)(steps[2]).toBe('Clic en "Productos".');
    (0, test_1.expect)(steps[3]).toBe('Validar algo.');
});
(0, test_1.test)("normalizeEntrySteps: deduped counts excess entry steps", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "start", visibleLabel: "Start" },
        ],
    });
    const input = [
        'Clic en "Start".',
        'Clic en "Start".',
        'Clic en "Start".',
        'Validar algo.',
    ];
    const { deduped } = (0, scenario_normalizer_1.normalizeEntrySteps)(input, rp);
    // 3 entry steps in input, 1 canonical → 2 excess
    (0, test_1.expect)(deduped).toBe(2);
});
// ── routeProfile entry rebuilding through normalizeScenario (indirect test) ──
(0, test_1.test)("normalizeScenario: prepends all entry steps via normalizeEntrySteps", () => {
    const rp = makeRouteProfile({
        entry: [
            { businessLabel: "login", visibleLabel: "Inicio" },
        ],
    });
    const inputSteps = ['Clic en "Productos".', 'Validar algo.'];
    const { steps } = (0, scenario_normalizer_1.normalizeEntrySteps)(inputSteps, rp);
    (0, test_1.expect)(steps[0]).toBe('Clic en "Inicio".');
    (0, test_1.expect)(steps[1]).toBe('Clic en "Productos".');
    (0, test_1.expect)(steps[2]).toBe('Validar algo.');
});
