"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const test_1 = require("@playwright/test");
const testrail_case_publisher_1 = require("../src/server/services/testrail-case-publisher");
const testrail_run_reporter_1 = require("../src/server/services/testrail-run-reporter");
const testrail_client_1 = require("../src/clients/testrail.client");
const STORE_PATH = node_path_1.default.resolve(process.cwd(), ".artifacts", "testrail", "scenario-case-mappings.json");
function makeScenario(overrides = {}) {
    return {
        sourceIssueKey: overrides.sourceIssueKey ?? "JIRA-1",
        title: overrides.title ?? "Escenario",
        steps: overrides.steps ?? ["Paso 1", "Paso 2"],
        preconditions: overrides.preconditions ?? ["Usuario autenticado"],
        expectedResult: overrides.expectedResult ?? "Resultado esperado",
        type: overrides.type ?? "functional",
        database: overrides.database ?? "",
        isConverted: overrides.isConverted ?? 0,
        automationType: overrides.automationType ?? "e2e",
        setupStrategy: overrides.setupStrategy ?? "default",
        appSlug: overrides.appSlug ?? "kiosko",
        targetAppSlug: overrides.targetAppSlug,
        targetAppName: overrides.targetAppName,
        routeProfile: overrides.routeProfile ?? "default",
        dataRequirements: overrides.dataRequirements ?? "",
        nonExecutableCriteria: overrides.nonExecutableCriteria ?? "",
        mcpExecutable: overrides.mcpExecutable ?? true,
        caseId: overrides.caseId,
        validation: overrides.validation ?? { valid: true, errors: [], warnings: [] },
    };
}
function makeClient() {
    const existingCases = new Map();
    return {
        async getCasesByRefs(_projectId, refs) {
            const ids = refs.split(",").filter((part) => part.startsWith("scenarioId:"));
            return ids.map((_, index) => ({ id: 300 + index + 1, title: `Existing ${index + 1}`, section_id: 1731 }));
        },
        async addCase(_sectionId, input) {
            const nextId = existingCases.size + 500;
            existingCases.set(String(nextId), { id: nextId, section_id: 1731 });
            return { id: nextId, title: input.title };
        },
        async updateCase(caseId, input) {
            return { id: caseId, title: input.title ?? `Case ${caseId}` };
        },
        async addRun(input) {
            return { id: 901, name: input.name, url: "https://testrail.local/index.php?/runs/view/901" };
        },
        async addResultsForCases(_runId, results) {
            return { added: results.length };
        },
    };
}
test_1.test.afterEach(() => {
    if (node_fs_1.default.existsSync(STORE_PATH)) {
        node_fs_1.default.rmSync(STORE_PATH, { force: true });
    }
});
(0, test_1.test)("sanitizeTestRailRef elimina metadata técnica y deja solo token seguro", () => {
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("AA-81")).toBe("AA-81");
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("scenarioId:AA-81")).toBe("SCENARIOIDAA-81");
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("kiosko|kiosko|Detalle_KIOSKO|56")).toBe("KIOSKOKIOSKODETALLE_KIOSKO56");
});
(0, test_1.test)("buildSafeRefsFilter deduplica y no incluye cacheKey ni pipes", () => {
    const refs = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: ["AA-81", "AA-81", "scenarioId:AA-81", "cacheKey:kiosko|kiosko"],
    });
    (0, test_1.expect)(refs).toBeDefined();
    (0, test_1.expect)(refs).toContain("AA-81");
    (0, test_1.expect)(refs?.includes("|")).toBe(false);
    (0, test_1.expect)(refs?.includes("cacheKey")).toBe(false);
});
(0, test_1.test)("publishScenariosToTestRail crea casos en la seccion seleccionada y persiste mapping", async () => {
    const client = makeClient();
    const result = await (0, testrail_case_publisher_1.publishScenariosToTestRail)(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        sprintId: 7,
        storyKey: "JIRA-123",
        cacheKey: "cache-a",
        scenarios: [makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1" })],
    });
    (0, test_1.expect)(result.caseIds.length).toBe(1);
    (0, test_1.expect)(result.mappings[0].sectionId).toBe(4903);
    (0, test_1.expect)(result.mappings[0].projectId).toBe(56);
    (0, test_1.expect)((0, testrail_case_publisher_1.readPersistedScenarioMappings)().some((m) => m.testRailCaseId === result.caseIds[0])).toBe(true);
});
(0, test_1.test)("publishScenariosToTestRail no duplica casos si ya existe mapping", async () => {
    const client = makeClient();
    await (0, testrail_case_publisher_1.publishScenariosToTestRail)(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        cacheKey: "cache-a",
        scenarios: [makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1" })],
    });
    const result = await (0, testrail_case_publisher_1.publishScenariosToTestRail)(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        cacheKey: "cache-a",
        scenarios: [makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1 actualizado" })],
    });
    (0, test_1.expect)(result.updated + result.reused).toBeGreaterThan(0);
});
(0, test_1.test)("reportScenarioPreviewResultsToTestRail reporta passed/failed y crea pending retry si falla", async () => {
    const client = {
        async addResultsForCases() {
            throw new Error("429 Rate Limit");
        },
    };
    const result = await (0, testrail_run_reporter_1.reportScenarioPreviewResultsToTestRail)(client, {
        runId: 901,
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        runName: "QA Lab",
        artifactDir: node_path_1.default.resolve(process.cwd(), ".artifacts", "tmp", `testrail-report-${Date.now()}`),
        results: [
            {
                scenarioId: "JIRA-123",
                testRailCaseId: 501,
                status: "passed",
            },
            {
                scenarioId: "JIRA-124",
                testRailCaseId: 502,
                status: "failed",
                failureReason: "No se encontró botón",
            },
        ],
        mappings: [
            { scenarioId: "JIRA-123", scenarioTitle: "Escenario 1", cacheKey: "cache-a", testRailCaseId: 501, sectionId: 4903, projectId: 56, updatedAt: new Date().toISOString(), source: "reused" },
            { scenarioId: "JIRA-124", scenarioTitle: "Escenario 2", cacheKey: "cache-a", testRailCaseId: 502, sectionId: 4903, projectId: 56, updatedAt: new Date().toISOString(), source: "reused" },
        ],
    });
    (0, test_1.expect)(result.added).toBe(0);
    (0, test_1.expect)(result.pendingReportPath).toContain("pending-testrail-report.json");
});
(0, test_1.test)("getCasesByRefs encoda query params de TestRail", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = (async (input) => {
        capturedUrl = typeof input === "string" ? input : input.toString();
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    try {
        const client = new testrail_client_1.TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
        await client.getCasesByRefs("56", "AA-81,AA-82", "1731", "4903");
        (0, test_1.expect)(capturedUrl).toContain("refs_filter=AA-81%2CAA-82");
        (0, test_1.expect)(capturedUrl).not.toContain("refs_filter=AA-81,AA-82");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
