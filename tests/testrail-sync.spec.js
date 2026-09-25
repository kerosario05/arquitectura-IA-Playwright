"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const test_1 = require("@playwright/test");
const testrailPublisher = __importStar(require("../src/server/services/testrail-case-publisher"));
const testrail_run_reporter_1 = require("../src/server/services/testrail-run-reporter");
const testrail_client_1 = require("../src/clients/testrail.client");
const scenario_to_testrail_1 = require("../src/recording/scenario-to-testrail");
const STORE_PATH = node_path_1.default.resolve(process.cwd(), ".artifacts", "testrail", "scenario-case-mappings.json");
function makeScenario(overrides = {}) {
    return {
        sourceIssueKey: overrides.sourceIssueKey ?? "JIRA-1",
        title: overrides.title ?? "Escenario",
        steps: overrides.steps ?? ["Paso 1", "Paso 2"],
        preconditions: overrides.preconditions ?? ["Usuario autenticado"],
        expectedResult: overrides.expectedResult !== undefined ? overrides.expectedResult : "Resultado esperado",
        caseOracle: overrides.caseOracle,
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
    const captured = {
        addCaseInputs: [],
        updateCaseInputs: [],
    };
    return {
        async getCasesByRefs(_projectId, refs) {
            void refs;
            return [];
        },
        async addCase(_sectionId, input) {
            captured.addCaseInputs.push(input);
            const nextId = existingCases.size + 500;
            existingCases.set(String(nextId), { id: nextId, section_id: 1731 });
            return { id: nextId, title: input.title };
        },
        async updateCase(caseId, input) {
            captured.updateCaseInputs.push(input);
            return { id: caseId, title: input.title ?? `Case ${caseId}` };
        },
        async addRun(input) {
            return { id: 901, name: input.name, url: "https://testrail.local/index.php?/runs/view/901" };
        },
        async addResultsForCases(_runId, results) {
            return { added: results.length };
        },
        __captured: captured,
    };
}
const TESTRAIL_ENV_KEYS = [
    "TESTRAIL_DEFAULT_CASE_ORACLE",
    "TESTRAIL_REFS_FIELD",
    "TESTRAIL_SEND_CUSTOM_REFS",
];
function snapshotTestRailEnv() {
    return {
        TESTRAIL_DEFAULT_CASE_ORACLE: process.env.TESTRAIL_DEFAULT_CASE_ORACLE,
        TESTRAIL_REFS_FIELD: process.env.TESTRAIL_REFS_FIELD,
        TESTRAIL_SEND_CUSTOM_REFS: process.env.TESTRAIL_SEND_CUSTOM_REFS,
    };
}
function restoreTestRailEnv(snapshot) {
    for (const key of TESTRAIL_ENV_KEYS) {
        const value = snapshot[key];
        if (value === undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
}
function clearTestRailModuleCache() {
    delete require.cache[require.resolve("../src/server/services/testrail-case-publisher")];
    delete require.cache[require.resolve("../src/clients/testrail.client")];
}
function loadFreshTestRailModules() {
    clearTestRailModuleCache();
    const publisher = require("../src/server/services/testrail-case-publisher");
    const clientModule = require("../src/clients/testrail.client");
    return { publisher, TestRailClientCtor: clientModule.TestRailClient };
}
async function withIsolatedTestRailEnv(env, run) {
    const snapshot = snapshotTestRailEnv();
    try {
        for (const key of TESTRAIL_ENV_KEYS) {
            const value = env[key];
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
        return await run(loadFreshTestRailModules());
    }
    finally {
        restoreTestRailEnv(snapshot);
        clearTestRailModuleCache();
    }
}
test_1.test.afterEach(() => {
    if (node_fs_1.default.existsSync(STORE_PATH)) {
        node_fs_1.default.rmSync(STORE_PATH, { force: true });
    }
});
(0, test_1.test)("sanitizeTestRailRef elimina metadata técnica y deja solo token seguro", () => {
    (0, test_1.expect)(testrailPublisher.sanitizeTestRailRef("AA-81")).toBe("AA-81");
    (0, test_1.expect)(testrailPublisher.sanitizeTestRailRef("scenarioId:AA-81")).toBe("SCENARIOIDAA-81");
    (0, test_1.expect)(testrailPublisher.sanitizeTestRailRef("kiosko|kiosko|Detalle_KIOSKO|56")).toBe("KIOSKOKIOSKODETALLE_KIOSKO56");
});
(0, test_1.test)("buildSafeRefsFilter deduplica y no incluye cacheKey ni pipes", () => {
    const refs = testrailPublisher.buildSafeRefsFilter({
        refs: ["AA-81", "AA-81", "scenarioId:AA-81", "cacheKey:kiosko|kiosko"],
    });
    (0, test_1.expect)(refs).toBeDefined();
    (0, test_1.expect)(refs).toContain("AA-81");
    (0, test_1.expect)(refs?.includes("|")).toBe(false);
    (0, test_1.expect)(refs?.includes("cacheKey")).toBe(false);
});
(0, test_1.test)("publishScenariosToTestRail crea casos en la seccion seleccionada y persiste mapping", async () => {
    const client = makeClient();
    const result = await testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        sprintId: 7,
        storyKey: "AA-81",
        cacheKey: "cache-a",
        scenarios: [makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1" })],
    });
    (0, test_1.expect)(result.caseIds.length).toBe(1);
    (0, test_1.expect)(result.mappings[0].sectionId).toBe(4903);
    (0, test_1.expect)(result.mappings[0].projectId).toBe(56);
    (0, test_1.expect)(testrailPublisher.readPersistedScenarioMappings().some((m) => m.testRailCaseId === result.caseIds[0])).toBe(true);
    (0, test_1.expect)(String(client.__captured.addCaseInputs[0].refs)).toBe("AA-81-PREVIEW-001");
});
(0, test_1.test)("buildSafeTestRailRefs devuelve un ref simple y unico por escenario", () => {
    const scenario = makeScenario({ sourceIssueKey: "AA-81", title: "Escenario" });
    const refs = testrailPublisher.buildSafeTestRailRefs(scenario, "PREVIEW-001", "AA-81");
    (0, test_1.expect)(refs).toBe("AA-81-PREVIEW-001");
    (0, test_1.expect)(refs.includes(",")).toBe(false);
    (0, test_1.expect)(refs.includes("|")).toBe(false);
    (0, test_1.expect)(refs.includes("cacheKey")).toBe(false);
});
(0, test_1.test)("Recording adapta al mismo contrato de entrada que Jira/HU para el publisher compartido", async () => {
    const recorded = {
        scenarioId: "REC-ADAPTER-001",
        title: "Crear registro desde evidencia observada",
        description: "Flujo observado",
        preconditions: ["Usuario autenticado"],
        kind: "happy_path",
        provenance: "observed",
        mobileSteps: [],
        webSteps: [],
        testRailSteps: [
            { content: "Abrir la pantalla", expected: "La pantalla queda disponible" },
            { content: "Guardar el registro", expected: "Resultado esperado por confirmar" },
        ],
        requiredData: [],
        stepTargets: [],
        sourceRecordingId: "fixture-recording",
        hasUncertainSteps: false,
    };
    const recordingInput = (0, scenario_to_testrail_1.toPublishableScenario)(recorded, "shared-app", "fixture-recording");
    const jiraInput = makeScenario({
        title: recordingInput.title,
        preconditions: recordingInput.preconditions,
        expectedResult: recordingInput.expectedResult,
        appSlug: recordingInput.appSlug,
    });
    const recordingClient = makeClient();
    const jiraClient = makeClient();
    const baseContext = {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "shared-app",
        publishStrategy: "always_create",
    };
    await testrailPublisher.publishScenariosToTestRail(recordingClient, {
        ...baseContext,
        scenarios: [recordingInput],
        cacheKey: "recording-contract-equivalence",
    });
    await testrailPublisher.publishScenariosToTestRail(jiraClient, {
        ...baseContext,
        scenarios: [jiraInput],
        cacheKey: "jira-contract-equivalence",
    });
    const shapeOf = (input) => ({
        keys: Object.keys(input).sort(),
        types: Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Array.isArray(value) ? "array" : typeof value])),
        stepShape: Array.isArray(input.stepsSeparated)
            ? input.stepsSeparated.map((step) => Object.keys(step).sort())
            : [],
    });
    (0, test_1.expect)(shapeOf(recordingClient.__captured.addCaseInputs[0])).toEqual(shapeOf(jiraClient.__captured.addCaseInputs[0]));
    (0, test_1.expect)(recordingClient.__captured.addCaseInputs[0].customFields).toEqual({});
});
(0, test_1.test)("publishScenariosToTestRail incluye custom_expected y custom_case_oracle en addCase", async () => {
    const client = makeClient();
    await testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        storyKey: "AA-81",
        cacheKey: "cache-custom-fields",
        scenarios: [
            makeScenario({
                sourceIssueKey: "JIRA-200",
                title: "Escenario oracle",
                expectedResult: "Debe mostrarse el resultado esperado",
                caseOracle: "Oracle funcional del caso",
            }),
        ],
    });
    const capturedInput = client.__captured.addCaseInputs[0];
    (0, test_1.expect)(capturedInput.customExpected).toBeDefined();
    (0, test_1.expect)(String(capturedInput.customExpected)).toContain("Debe mostrarse");
    (0, test_1.expect)(capturedInput.customCaseOracle).toBe("Oracle funcional del caso");
    (0, test_1.expect)(String(capturedInput.refs)).toBe("AA-81-PREVIEW-001");
});
(0, test_1.test)("publishScenariosToTestRail usa fallback para custom_case_oracle cuando no existe en el escenario", async () => {
    await withIsolatedTestRailEnv({
        TESTRAIL_DEFAULT_CASE_ORACLE: "ORACLE-CONFIGURADO-POR-TEST",
        TESTRAIL_REFS_FIELD: "both",
        TESTRAIL_SEND_CUSTOM_REFS: "true",
    }, async ({ publisher }) => {
        const client = makeClient();
        await publisher.publishScenariosToTestRail(client, {
            projectId: 56,
            suiteId: 1731,
            sectionId: 4903,
            appSlug: "kiosko",
            storyKey: "AA-81",
            cacheKey: "cache-oracle-fallback",
            scenarios: [
                makeScenario({
                    sourceIssueKey: "JIRA-201",
                    title: "Escenario sin oracle",
                    expectedResult: "",
                    steps: ["Validar que se muestre el resultado correcto", "Continuar"],
                }),
            ],
        });
        const capturedInput = client.__captured.addCaseInputs[0];
        (0, test_1.expect)(String(capturedInput.customCaseOracle)).toBe("ORACLE-CONFIGURADO-POR-TEST");
        (0, test_1.expect)(String(capturedInput.refs)).toBe("AA-81-PREVIEW-001");
    });
});
(0, test_1.test)("publishScenariosToTestRail incluye custom fields configurados por env", async () => {
    const previous = process.env.TESTRAIL_REQUIRED_CASE_FIELDS_JSON;
    process.env.TESTRAIL_REQUIRED_CASE_FIELDS_JSON = JSON.stringify({
        custom_case_oracle: "Automatizado: validación funcional según pasos del escenario.",
        custom_environment_tag: "QA",
    });
    try {
        const client = makeClient();
        await testrailPublisher.publishScenariosToTestRail(client, {
            projectId: 56,
            suiteId: 1731,
            sectionId: 4903,
            appSlug: "kiosko",
            storyKey: "AA-81",
            cacheKey: "cache-env-fields",
            scenarios: [makeScenario({ sourceIssueKey: "JIRA-202", title: "Escenario env" })],
        });
        const capturedInput = client.__captured.addCaseInputs[0];
        (0, test_1.expect)(capturedInput.customFields?.custom_environment_tag).toBe("QA");
        (0, test_1.expect)(capturedInput.customCaseOracle).toBeDefined();
        (0, test_1.expect)(String(capturedInput.refs)).toBe("AA-81-PREVIEW-001");
    }
    finally {
        if (previous === undefined) {
            delete process.env.TESTRAIL_REQUIRED_CASE_FIELDS_JSON;
        }
        else {
            process.env.TESTRAIL_REQUIRED_CASE_FIELDS_JSON = previous;
        }
    }
});
(0, test_1.test)("publishScenariosToTestRail crea un caseId unico por escenario distinto", async () => {
    const client = makeClient();
    const result = await testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        storyKey: "AA-81",
        cacheKey: "cache-b",
        scenarios: [
            makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1" }),
            makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 2" }),
            makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 3" }),
            makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 4" }),
            makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 5" }),
            makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 6" }),
        ],
    });
    (0, test_1.expect)(result.caseIds.length).toBe(6);
    (0, test_1.expect)(new Set(result.caseIds).size).toBe(6);
    (0, test_1.expect)(new Set(client.__captured.addCaseInputs.map((input) => input.refs)).size).toBe(6);
});
(0, test_1.test)("publishScenariosToTestRail no duplica casos si ya existe mapping", async () => {
    const client = makeClient();
    await testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        storyKey: "AA-81",
        cacheKey: "cache-a",
        scenarios: [makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1" })],
    });
    const result = await testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        cacheKey: "cache-a",
        scenarios: [makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1 actualizado" })],
    });
    (0, test_1.expect)(result.updated + result.reused).toBeGreaterThan(0);
    (0, test_1.expect)(String(client.__captured.updateCaseInputs[0].refs)).toBe("AA-81-PREVIEW-001");
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
// ── RESERVED_TESTRAIL_FIELDS guard tests ──
(0, test_1.test)("addCase: customFields.refs no sobrescribe body.refs", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 999, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        await withIsolatedTestRailEnv({
            TESTRAIL_DEFAULT_CASE_ORACLE: "QA",
            TESTRAIL_REFS_FIELD: "both",
            TESTRAIL_SEND_CUSTOM_REFS: "true",
        }, async ({ TestRailClientCtor }) => {
            const client = new TestRailClientCtor({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
            await client.addCase("4903", {
                title: "Test case",
                refs: "AA-81-PREVIEW-001",
                // Simulate a customFields bag that tries to overwrite refs
                customFields: { refs: "SHOULD-NOT-WIN", custom_refs: "SHOULD-NOT-WIN" },
            });
        });
        // body.refs must keep the explicitly set value
        (0, test_1.expect)(capturedBody.refs).toBe("AA-81-PREVIEW-001");
        (0, test_1.expect)(capturedBody.custom_refs).toBe("AA-81-PREVIEW-001");
        (0, test_1.expect)(capturedBody.refs).not.toBe("SHOULD-NOT-WIN");
        (0, test_1.expect)(capturedBody.custom_refs).not.toBe("SHOULD-NOT-WIN");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("updateCase: customFields.custom_refs no sobrescribe body.custom_refs", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 501, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        await withIsolatedTestRailEnv({
            TESTRAIL_DEFAULT_CASE_ORACLE: "QA",
            TESTRAIL_REFS_FIELD: "both",
            TESTRAIL_SEND_CUSTOM_REFS: "true",
        }, async ({ TestRailClientCtor }) => {
            const client = new TestRailClientCtor({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
            await client.updateCase(501, {
                title: "Updated case",
                refs: "AA-81-PREVIEW-001",
                // Simulate a customFields bag that tries to overwrite custom_refs
                customFields: { custom_refs: "OVERWRITE-ATTEMPT", refs: "OVERWRITE-ATTEMPT" },
            });
        });
        (0, test_1.expect)(capturedBody.refs).toBe("AA-81-PREVIEW-001");
        (0, test_1.expect)(capturedBody.custom_refs).toBe("AA-81-PREVIEW-001");
        (0, test_1.expect)(capturedBody.refs).not.toBe("OVERWRITE-ATTEMPT");
        (0, test_1.expect)(capturedBody.custom_refs).not.toBe("OVERWRITE-ATTEMPT");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("addCase: final body contiene refs y custom_refs no vacíos", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 998, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        await withIsolatedTestRailEnv({
            TESTRAIL_DEFAULT_CASE_ORACLE: "QA",
            TESTRAIL_REFS_FIELD: "both",
            TESTRAIL_SEND_CUSTOM_REFS: "true",
        }, async ({ TestRailClientCtor }) => {
            const client = new TestRailClientCtor({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
            await client.addCase("4903", {
                title: "Test case refs integrity",
                refs: "AA-81-PREVIEW-007",
                customFields: { custom_environment_tag: "QA" }, // Non-reserved field – must pass through
            });
        });
        // Core fields must be non-empty strings
        (0, test_1.expect)(typeof capturedBody.refs).toBe("string");
        (0, test_1.expect)(capturedBody.refs.trim().length).toBeGreaterThan(0);
        (0, test_1.expect)(typeof capturedBody.custom_refs).toBe("string");
        (0, test_1.expect)(capturedBody.custom_refs.trim().length).toBeGreaterThan(0);
        // Non-reserved customField must survive
        (0, test_1.expect)(capturedBody.custom_environment_tag).toBe("QA");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("shared addCase follows the configured template step contract", async () => {
    const originalFetch = globalThis.fetch;
    const originalSeparated = process.env.TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED;
    const originalText = process.env.TESTRAIL_SEND_CUSTOM_STEPS_TEXT;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 1001, title: "Shared contract" }), { status: 200 });
    });
    try {
        process.env.TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED = "true";
        process.env.TESTRAIL_SEND_CUSTOM_STEPS_TEXT = "true";
        const { TestRailClientCtor } = loadFreshTestRailModules();
        const client = new TestRailClientCtor({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
        await client.addCase("4903", {
            title: "Shared contract",
            refs: "AA-81-SHARED-CONTRACT",
            stepsSeparated: [{ content: "Abrir", expected: "Disponible" }, { content: "Guardar", expected: "Confirmar" }],
        });
        (0, test_1.expect)(typeof capturedBody.custom_steps).toBe("string");
        (0, test_1.expect)(capturedBody.custom_steps).toBe("<ol>\n<li>1. Abrir<br />Esperado: Disponible</li>\n<li>2. Guardar<br />Esperado: Confirmar</li>\n</ol>\n");
        (0, test_1.expect)(Array.isArray(capturedBody.custom_steps_separated)).toBe(true);
    }
    finally {
        globalThis.fetch = originalFetch;
        if (originalSeparated === undefined)
            delete process.env.TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED;
        else
            process.env.TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED = originalSeparated;
        if (originalText === undefined)
            delete process.env.TESTRAIL_SEND_CUSTOM_STEPS_TEXT;
        else
            process.env.TESTRAIL_SEND_CUSTOM_STEPS_TEXT = originalText;
        clearTestRailModuleCache();
    }
});
(0, test_1.test)("updateCase: final body contiene refs y custom_refs no vacíos", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 500, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        await withIsolatedTestRailEnv({
            TESTRAIL_DEFAULT_CASE_ORACLE: "QA",
            TESTRAIL_REFS_FIELD: "both",
            TESTRAIL_SEND_CUSTOM_REFS: "true",
        }, async ({ TestRailClientCtor }) => {
            const client = new TestRailClientCtor({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
            await client.updateCase(500, {
                title: "Updated case refs integrity",
                refs: "AA-81-PREVIEW-007",
                customFields: { custom_priority: 2 }, // Non-reserved field – must pass through
            });
        });
        (0, test_1.expect)(typeof capturedBody.refs).toBe("string");
        (0, test_1.expect)(capturedBody.refs.trim().length).toBeGreaterThan(0);
        (0, test_1.expect)(typeof capturedBody.custom_refs).toBe("string");
        (0, test_1.expect)(capturedBody.custom_refs.trim().length).toBeGreaterThan(0);
        // Non-reserved customField must survive
        (0, test_1.expect)(capturedBody.custom_priority).toBe(2);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("addCase: con TESTRAIL_SEND_CUSTOM_REFS=false omite custom_refs y mantiene refs en modo both", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 997, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        await withIsolatedTestRailEnv({
            TESTRAIL_DEFAULT_CASE_ORACLE: "QA",
            TESTRAIL_REFS_FIELD: "both",
            TESTRAIL_SEND_CUSTOM_REFS: "false",
        }, async ({ TestRailClientCtor }) => {
            const client = new TestRailClientCtor({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
            await client.addCase("4903", { title: "Refs mode off custom", refs: "AA-81-PREVIEW-099" });
        });
        (0, test_1.expect)(capturedBody.refs).toBe("AA-81-PREVIEW-099");
        (0, test_1.expect)(capturedBody.custom_refs).toBeUndefined();
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
// ── custom_preconds mandatory field tests ──
(0, test_1.test)("addCase: siempre envía custom_preconds no vacío", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 600, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        const client = new testrail_client_1.TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
        await client.addCase("4903", {
            title: "Test preconds",
            refs: "AA-81-PREVIEW-100",
        });
        (0, test_1.expect)(typeof capturedBody.custom_preconds).toBe("string");
        (0, test_1.expect)(capturedBody.custom_preconds.trim().length).toBeGreaterThan(0);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("addCase: custom_preconds con preconditions explícitas las respeta", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 601, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        const client = new testrail_client_1.TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
        await client.addCase("4903", {
            title: "Test preconds explicit",
            refs: "AA-81-PREVIEW-101",
            preconditions: "Usuario autenticado.",
        });
        (0, test_1.expect)(capturedBody.custom_preconds).toBe("Usuario autenticado.");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("addCase: custom_preconds usa fallback cuando no hay preconditions", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 602, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        const client = new testrail_client_1.TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
        await client.addCase("4903", {
            title: "Test preconds fallback",
            refs: "AA-81-PREVIEW-102",
            preconditions: undefined,
        });
        (0, test_1.expect)(typeof capturedBody.custom_preconds).toBe("string");
        (0, test_1.expect)(capturedBody.custom_preconds.trim().length).toBeGreaterThan(0);
        (0, test_1.expect)(capturedBody.custom_preconds).toContain("Precondiciones:");
        (0, test_1.expect)(capturedBody.custom_preconds).toContain("App disponible");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("addCase: customFields.custom_preconds no sobrescribe body.custom_preconds", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 603, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        const client = new testrail_client_1.TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
        await client.addCase("4903", {
            title: "Test preconds reserved",
            refs: "AA-81-PREVIEW-103",
            preconditions: "Precondición core.",
            customFields: { custom_preconds: "NO-DEBE-APARECER" },
        });
        (0, test_1.expect)(capturedBody.custom_preconds).toBe("Precondición core.");
        (0, test_1.expect)(capturedBody.custom_preconds).not.toBe("NO-DEBE-APARECER");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("updateCase: siempre envía custom_preconds no vacío", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 604, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        const client = new testrail_client_1.TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
        await client.updateCase(604, {
            title: "Updated preconds",
            refs: "AA-81-PREVIEW-104",
        });
        (0, test_1.expect)(typeof capturedBody.custom_preconds).toBe("string");
        (0, test_1.expect)(capturedBody.custom_preconds.trim().length).toBeGreaterThan(0);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("updateCase: custom_preconds con preconditions explícitas las respeta", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 605, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        const client = new testrail_client_1.TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
        await client.updateCase(605, {
            title: "Updated preconds explicit",
            refs: "AA-81-PREVIEW-105",
            preconditions: "Usuario autenticado.",
        });
        (0, test_1.expect)(capturedBody.custom_preconds).toBe("Usuario autenticado.");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("updateCase: custom_preconds usa fallback cuando no hay preconditions", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 606, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        const client = new testrail_client_1.TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
        await client.updateCase(606, {
            title: "Updated preconds fallback",
            refs: "AA-81-PREVIEW-106",
            preconditions: undefined,
        });
        (0, test_1.expect)(typeof capturedBody.custom_preconds).toBe("string");
        (0, test_1.expect)(capturedBody.custom_preconds.trim().length).toBeGreaterThan(0);
        (0, test_1.expect)(capturedBody.custom_preconds).toContain("Precondiciones:");
        (0, test_1.expect)(capturedBody.custom_preconds).toContain("App disponible");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, test_1.test)("updateCase: customFields.custom_preconds no sobrescribe body.custom_preconds", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = {};
    globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(init?.body ?? "{}");
        return new Response(JSON.stringify({ id: 607, title: "Test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    try {
        const client = new testrail_client_1.TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
        await client.updateCase(607, {
            title: "Updated preconds reserved",
            refs: "AA-81-PREVIEW-107",
            preconditions: "Precondición core update.",
            customFields: { custom_preconds: "NO-DEBE-APARECER" },
        });
        (0, test_1.expect)(capturedBody.custom_preconds).toBe("Precondición core update.");
        (0, test_1.expect)(capturedBody.custom_preconds).not.toBe("NO-DEBE-APARECER");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
// ── add_case HTTP 500 recovery tests ──
function makeAddCaseRecoveryClient(options) {
    const existingInSection = options?.existingInSection ?? [];
    const returnOnFirstGetCases = options?.returnOnFirstGetCases ?? false;
    const captured = {
        addCaseInputs: [],
        updateCaseInputs: [],
        getCasesCalls: 0,
    };
    let getCasesReturned = false;
    const getCasesSequence = [...(options?.getCasesSequence ?? [])];
    return {
        async getCasesByRefs(_projectId, _refs) {
            return [];
        },
        async getCases(_projectId, _suiteId, _sectionId) {
            captured.getCasesCalls++;
            if (getCasesSequence.length > 0) {
                getCasesReturned = true;
                return getCasesSequence.shift().map((c) => ({ ...c }));
            }
            // First call(s) during reuse search return empty so addCase is attempted
            if (!returnOnFirstGetCases && !getCasesReturned) {
                getCasesReturned = true;
                return [];
            }
            getCasesReturned = true;
            return existingInSection.map((c) => ({
                id: c.id,
                title: c.title,
                section_id: c.section_id,
                custom_scenario_id: c.custom_scenario_id,
                custom_preconds: c.custom_preconds,
            }));
        },
        async addCase(_sectionId, input) {
            captured.addCaseInputs.push(input);
            if (options?.addCaseResult) {
                return options.addCaseResult;
            }
            throw new Error(options?.addCaseErrorMessage ?? "TestRail API error (HTTP 500) at add_case/4903: backend plugin failure");
        },
        async updateCase(caseId, input) {
            captured.updateCaseInputs.push(input);
            return { id: caseId, title: input.title ?? `Case ${caseId}` };
        },
        async addRun(input) {
            return { id: 901, name: input.name, url: "https://testrail.local/index.php?/runs/view/901" };
        },
        async addResultsForCases(_runId, _results) {
            return { added: 0 };
        },
        __captured: captured,
    };
}
(0, test_1.test)("publishScenariosToTestRail mantiene flujo normal cuando addCase responde OK", async () => {
    const client = makeAddCaseRecoveryClient({
        addCaseResult: { id: 3800, title: "Escenario normal" },
    });
    const result = await testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        storyKey: "AA-81",
        cacheKey: "cache-success",
        scenarios: [
            makeScenario({
                sourceIssueKey: "JIRA-600",
                title: "Escenario normal",
            }),
        ],
        publishStrategy: "always_create",
        launchId: "23cd1ead-9ca2-4b24-ae14-37b6f5837373",
    });
    (0, test_1.expect)(result.caseIds).toContain(3800);
    (0, test_1.expect)(result.created).toBe(1);
    (0, test_1.expect)(result.mappings[0].testRailCaseId).toBe(3800);
    (0, test_1.expect)(result.mappings[0].source).toBe("created");
    (0, test_1.expect)(client.__captured.addCaseInputs.length).toBe(1);
});
(0, test_1.test)("publishScenariosToTestRail recupera caso ya creado cuando addCase devuelve HTTP 500 y hay match exacto por marca", async () => {
    const marker = "[automationScenarioId: 23cd1ead-001]";
    const client = makeAddCaseRecoveryClient({
        existingInSection: [
            { id: 3801, title: "Escenario recuperado", section_id: 4903, custom_preconds: `Precondiciones\n${marker}` },
        ],
    });
    const result = await testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        storyKey: "AA-81",
        cacheKey: "cache-recovery-exact",
        scenarios: [
            makeScenario({
                sourceIssueKey: "JIRA-601",
                title: "Escenario recuperado",
            }),
        ],
        publishStrategy: "always_create",
        launchId: "23cd1ead-9ca2-4b24-ae14-37b6f5837373",
    });
    (0, test_1.expect)(result.caseIds).toContain(3801);
    (0, test_1.expect)(result.created).toBe(1);
    (0, test_1.expect)(result.mappings[0].testRailCaseId).toBe(3801);
    (0, test_1.expect)(result.mappings[0].source).toBe("recovered_after_add_case_500");
    (0, test_1.expect)(client.__captured.addCaseInputs.length).toBe(1);
});
(0, test_1.test)("Recording reconcilia un 500 con el título exacto cuando el template no conserva metadata interna", async () => {
    const client = makeAddCaseRecoveryClient({
        existingInSection: [{ id: 3810, title: "Caso observado", section_id: 4903, custom_preconds: "Precondiciones humanas" }],
        getCasesSequence: [
            [],
            [],
            [],
            [{ id: 3810, title: "Caso observado", section_id: 4903, custom_preconds: "Precondiciones humanas" }],
        ],
    });
    const result = await testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        cacheKey: "recording-title-reconciliation",
        recordingBatch: true,
        scenarios: [makeScenario({ title: "Caso observado" })],
        publishStrategy: "always_create",
    });
    (0, test_1.expect)(client.__captured.addCaseInputs.length).toBe(1);
    (0, test_1.expect)(result.reconciledCreated).toEqual([{ scenarioId: "PREVIEW-001", testRailCaseId: 3810 }]);
    (0, test_1.expect)(result.caseIds).toEqual([3810]);
    (0, test_1.expect)(result.failed).toEqual([]);
    (0, test_1.expect)(testrailPublisher.readPersistedScenarioMappings().some((m) => m.testRailCaseId === 3810)).toBe(true);
    const retry = await testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        cacheKey: "recording-title-reconciliation-retry",
        recordingBatch: true,
        scenarios: [makeScenario({ title: "Caso observado" })],
        publishStrategy: "always_create",
    });
    (0, test_1.expect)(retry.caseIds).toEqual([3810]);
    (0, test_1.expect)(retry.created).toBe(0);
    (0, test_1.expect)(retry.reused).toBe(1);
    (0, test_1.expect)(client.__captured.addCaseInputs.length).toBe(1);
});
(0, test_1.test)("publishScenariosToTestRail falla en HTTP 500 cuando no hay matches exactos por marca", async () => {
    const client = makeAddCaseRecoveryClient({
        existingInSection: [
            { id: 3802, title: "Escenario perdido", section_id: 4903, custom_preconds: "Precondiciones sin marca" },
        ],
    });
    await (0, test_1.expect)(testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        storyKey: "AA-81",
        cacheKey: "cache-recovery-zero",
        scenarios: [
            makeScenario({
                sourceIssueKey: "JIRA-602",
                title: "Escenario perdido",
            }),
        ],
        publishStrategy: "always_create",
        launchId: "23cd1ead-9ca2-4b24-ae14-37b6f5837373",
    })).rejects.toThrow("HTTP 500");
    (0, test_1.expect)(client.__captured.addCaseInputs.length).toBe(1);
});
(0, test_1.test)("publishScenariosToTestRail falla en HTTP 500 cuando hay múltiples matches exactos por marca", async () => {
    const marker = "[automationScenarioId: 23cd1ead-001]";
    const client = makeAddCaseRecoveryClient({
        existingInSection: [
            { id: 3803, title: "Escenario duplicado", section_id: 4903, custom_preconds: `A\n${marker}` },
            { id: 3804, title: "Escenario duplicado", section_id: 4903, custom_preconds: `B\n${marker}` },
        ],
    });
    await (0, test_1.expect)(testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        storyKey: "AA-81",
        cacheKey: "cache-recovery-multi",
        scenarios: [
            makeScenario({
                sourceIssueKey: "JIRA-603",
                title: "Escenario duplicado",
            }),
        ],
        publishStrategy: "always_create",
        launchId: "23cd1ead-9ca2-4b24-ae14-37b6f5837373",
    })).rejects.toThrow("HTTP 500");
    (0, test_1.expect)(client.__captured.addCaseInputs.length).toBe(1);
});
(0, test_1.test)("publishScenariosToTestRail no activa recuperación para HTTP 401", async () => {
    const client = makeAddCaseRecoveryClient({
        addCaseErrorMessage: "TestRail API error (HTTP 401) at add_case/4903: Unauthorized",
    });
    await (0, test_1.expect)(testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        storyKey: "AA-81",
        cacheKey: "cache-http-401",
        scenarios: [
            makeScenario({
                sourceIssueKey: "JIRA-604",
                title: "Escenario 401",
            }),
        ],
        publishStrategy: "always_create",
        launchId: "23cd1ead-9ca2-4b24-ae14-37b6f5837373",
    })).rejects.toThrow("HTTP 401");
    (0, test_1.expect)(client.__captured.getCasesCalls).toBe(1);
});
(0, test_1.test)("publishScenariosToTestRail construye automationScenarioId sin prefijo duplicado", async () => {
    const client = makeAddCaseRecoveryClient({
        addCaseErrorMessage: "TestRail API error (HTTP 401) at add_case/4903: Unauthorized",
    });
    await (0, test_1.expect)(testrailPublisher.publishScenariosToTestRail(client, {
        projectId: 56,
        suiteId: 1731,
        sectionId: 4903,
        appSlug: "kiosko",
        storyKey: "AA-81",
        cacheKey: "cache-marker",
        scenarios: [
            makeScenario({
                sourceIssueKey: "JIRA-605",
                title: "Escenario marcador",
            }),
        ],
        publishStrategy: "always_create",
        launchId: "23cd1ead-9ca2-4b24-ae14-37b6f5837373",
    })).rejects.toThrow("HTTP 401");
    const preconditions = String(client.__captured.addCaseInputs[0].preconditions ?? "");
    (0, test_1.expect)(preconditions.includes("[automationScenarioId: 23cd1ead-23cd1ead-001]")).toBe(false);
    (0, test_1.expect)(preconditions.includes("[automationScenarioId: 23cd1ead-001]")).toBe(true);
});
