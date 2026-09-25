"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const codex_scenario_generator_1 = require("./codex-scenario-generator");
const scenario_validator_1 = require("./scenario-validator");
function test(label, fn) {
    Promise.resolve()
        .then(fn)
        .then(() => console.log(`  PASS  ${label}`))
        .catch((err) => {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    });
}
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
describe("generateScenariosWithAi route_pending purpose", () => {
    const issues = [
        {
            key: "HU-1",
            summary: "Transferir fondos entre cuentas",
            description: "El usuario realiza una transferencia normal.",
            acceptanceCriteria: "Dado que estoy autenticado, cuando confirmo transferencia, entonces veo resultado.",
            labels: [],
            components: [],
            status: "To Do",
            issueType: "Story"
        }
    ];
    const routeProfile = {
        name: "Catalog-like profile",
        entry: [{ businessLabel: "productos", visibleLabel: "Productos" }],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: [],
        representativeFixture: {},
        notes: [],
        targetPaths: {
            sample: {
                target: "Producto A",
                requiredIntermediates: [],
                productMetadata: {
                    productLabel: "Producto A",
                    normalizedLabel: "producto a",
                    subcategory: "Ahorros"
                }
            }
        }
    };
    async function runRoutePendingCase(scenario, usage, options) {
        const calls = [];
        const issueKey = options?.issueKey ?? issues[0].key;
        const appSlug = options?.appSlug ?? "default";
        const mockProvider = {
            providerType: "fake",
            providerName: "mock",
            model: "mock-model",
            async completeJson(request) {
                calls.push(request);
                return {
                    rawText: JSON.stringify({ scenarios: [scenario] }),
                    parsedJson: { scenarios: [scenario] },
                    model: "mock-model",
                    providerName: "mock",
                    durationMs: 1,
                    usage
                };
            }
        };
        const response = await (0, codex_scenario_generator_1.generateScenariosWithAi)([{ ...issues[0], key: issueKey }], appSlug, undefined, undefined, undefined, routeProfile, undefined, undefined, mockProvider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { launchId: options?.launchId });
        return { calls, response };
    }
    test("preserves mcpExecutable=true and sends scenario_generation purpose", async () => {
        const { calls, response } = await runRoutePendingCase({
            title: "Escenario ejecutable",
            steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
            mcpExecutable: true
        });
        node_assert_1.default.strictEqual(calls.length, 1, "route_pending should call provider once");
        node_assert_1.default.strictEqual(calls[0].purpose, "scenario_generation");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.generationMode, "route_pending");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiPurpose, "scenario_generation");
        node_assert_1.default.ok(Array.isArray(response.scenarios));
        node_assert_1.default.strictEqual(response.scenarios.length, 1, "valid scenario must not be dropped");
        node_assert_1.default.strictEqual(response.scenarios[0].title, "Escenario ejecutable");
        node_assert_1.default.strictEqual(response.scenarios[0].mcpExecutable, true);
    });
    test("preserves mcpExecutable=false without promoting to true", async () => {
        const { calls, response } = await runRoutePendingCase({
            title: "Escenario no ejecutable",
            steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
            mcpExecutable: false
        });
        node_assert_1.default.strictEqual(calls.length, 1, "route_pending should call provider once");
        node_assert_1.default.strictEqual(calls[0].purpose, "scenario_generation");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.generationMode, "route_pending");
        node_assert_1.default.strictEqual(response.scenarios.length, 1);
        node_assert_1.default.strictEqual(response.scenarios[0].mcpExecutable, false);
    });
    test("does not invent mcpExecutable=true when field is missing", async () => {
        const { calls, response } = await runRoutePendingCase({
            title: "Escenario sin bandera",
            steps: ["Seleccionar una opción visible.", "Validar el resultado visible."]
        });
        node_assert_1.default.strictEqual(calls.length, 1, "route_pending should call provider once");
        node_assert_1.default.strictEqual(calls[0].purpose, "scenario_generation");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.generationMode, "route_pending");
        node_assert_1.default.strictEqual(response.scenarios.length, 1);
        node_assert_1.default.ok(!Object.prototype.hasOwnProperty.call(response.scenarios[0], "mcpExecutable"));
    });
    test("preserves structured usage metrics without double counting", async () => {
        const usage = {
            inputTokens: 100,
            cachedInputTokens: 60,
            cacheWriteInputTokens: 0,
            nonCachedInputTokens: 40,
            outputTokens: 20,
            reasoningOutputTokens: 5,
            totalPhysicalTokens: 120,
            durationMs: 1500,
            success: true
        };
        const { response } = await runRoutePendingCase({
            title: "Escenario con usage",
            steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
            mcpExecutable: true
        }, usage);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiPurpose, "scenario_generation");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.generationMode, "route_pending");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.inputTokens, 100);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.cachedInputTokens, 60);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.nonCachedInputTokens, 40);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.outputTokens, 20);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.reasoningOutputTokens, 5);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.totalPhysicalTokens, 120);
    });
    test("correlates launchId, sourceIssueKey, appSlug, purpose/mode and usage in one diagnostics record", async () => {
        const usage = {
            inputTokens: 100,
            cachedInputTokens: 60,
            cacheWriteInputTokens: 0,
            nonCachedInputTokens: 40,
            outputTokens: 20,
            reasoningOutputTokens: 5,
            totalPhysicalTokens: 120,
            durationMs: 1500,
            success: true
        };
        const { response } = await runRoutePendingCase({
            title: "Escenario correlacionado",
            steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
            mcpExecutable: true
        }, usage, {
            launchId: "launch-test-001",
            issueKey: "HU-TEST-001",
            appSlug: "proyecto-prueba",
        });
        node_assert_1.default.strictEqual(response.generationDiagnostics?.launchId, "launch-test-001");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.sourceIssueKey, "HU-TEST-001");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.appSlug, "proyecto-prueba");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiPurpose, "scenario_generation");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.generationMode, "route_pending");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiProvider, "mock");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiModel, "mock-model");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.totalPhysicalTokens, 120);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.reasoningOutputTokens, 5);
    });
    test("handles missing usage fields without inventing values", async () => {
        const { response } = await runRoutePendingCase({
            title: "Escenario sin usage completo",
            steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
            mcpExecutable: true
        }, {
            inputTokens: 100,
            outputTokens: 20
        });
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.inputTokens, 100);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.outputTokens, 20);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.cachedInputTokens, undefined);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.nonCachedInputTokens, undefined);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.totalPhysicalTokens, undefined);
    });
    test("keeps partial identifiers without inventing launchId", async () => {
        const { response } = await runRoutePendingCase({
            title: "Escenario con identificadores parciales",
            steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
            mcpExecutable: true
        }, {
            inputTokens: 100,
            outputTokens: 20
        }, {
            issueKey: "HU-PARCIAL-001",
            appSlug: "app-parcial",
        });
        node_assert_1.default.strictEqual(response.generationDiagnostics?.launchId, undefined);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.sourceIssueKey, "HU-PARCIAL-001");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.appSlug, "app-parcial");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.inputTokens, 100);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.outputTokens, 20);
    });
    test("supports generation without Jira sourceIssueKey while preserving launchId/appSlug", async () => {
        const { response } = await runRoutePendingCase({
            title: "Escenario sin HU",
            steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
            mcpExecutable: true
        }, {
            inputTokens: 90,
            outputTokens: 10
        }, {
            launchId: "launch-no-jira-001",
            issueKey: "   ",
            appSlug: "app-no-jira",
        });
        node_assert_1.default.strictEqual(response.generationDiagnostics?.sourceIssueKey, undefined);
        node_assert_1.default.strictEqual(response.generationDiagnostics?.launchId, "launch-no-jira-001");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.appSlug, "app-no-jira");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage?.inputTokens, 90);
    });
    test("keeps identifiers when provider returns valid scenarios without usage", async () => {
        const { response } = await runRoutePendingCase({
            title: "Escenario sin usage",
            steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
            mcpExecutable: true
        }, undefined, {
            launchId: "launch-no-usage-001",
            issueKey: "HU-NO-USAGE-001",
            appSlug: "app-no-usage",
        });
        node_assert_1.default.strictEqual(response.generationDiagnostics?.launchId, "launch-no-usage-001");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.sourceIssueKey, "HU-NO-USAGE-001");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.appSlug, "app-no-usage");
        node_assert_1.default.strictEqual(response.generationDiagnostics?.aiUsage, undefined);
    });
    test("validateScenario accepts nonExecutableCriteria metadata when mcpExecutable is true", () => {
        const scenario = {
            sourceIssueKey: "HU-1",
            title: "Escenario ejecutable con metadata route pending",
            steps: [
                "1. Clic en \"Iniciar\".",
                "2. Validar que se muestre \"Resultado visible\"."
            ],
            preconditions: ["AuthGate"],
            expectedResult: "Resultado visible correctamente.",
            type: "Functional",
            database: "",
            isConverted: 0,
            automationType: "ui_discovery",
            setupStrategy: "no_login",
            appSlug: "default",
            routeProfile: "",
            dataRequirements: "",
            nonExecutableCriteria: "requires_route_discovery",
            mcpExecutable: true
        };
        const validation = (0, scenario_validator_1.validateScenario)(scenario, null);
        node_assert_1.default.strictEqual(validation.errors.includes("mcpExecutable must be true"), false);
    });
});
