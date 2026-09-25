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
const path = __importStar(require("node:path"));
const express_1 = __importDefault(require("express"));
const test_1 = require("@playwright/test");
const ai_provider_types_1 = require("../src/ai/ai-provider.types");
const appium_server_manager_1 = require("../src/mobile/appium-server-manager");
const android_sdk_1 = require("../src/mobile/android-sdk");
const emulator_manager_1 = require("../src/mobile/emulator-manager");
const mobile_scenario_generator_1 = require("../src/scenarios/mobile-scenario-generator");
const job_store_1 = require("../src/server/jobs/job-store");
const mobile_test_runner_1 = require("../src/server/jobs/mobile-test-runner");
const mobile_scenario_generation_manager_1 = require("../src/server/jobs/mobile-scenario-generation-manager");
const mobile_1 = require("../src/server/routes/mobile");
function createExistsSync(paths) {
    const normalized = new Set(paths.map((p) => path.resolve(p).toLowerCase()));
    return (targetPath) => normalized.has(path.resolve(targetPath).toLowerCase());
}
const jiraConfig = {
    baseUrl: "https://jira.example.local",
    email: "qa@example.local",
    apiToken: "token",
    acceptanceCriteriaField: "customfield_12345",
};
const issueAA88 = {
    key: "AA-88",
    summary: "Flujo móvil",
    description: "Descripción",
    acceptanceCriteria: "Criterios",
    labels: [],
    components: [],
    status: "To Do",
    issueType: "Story",
};
test_1.test.describe("mobile android sdk resolver", () => {
    (0, test_1.test)("resolves explicit SDK path when binaries exist", () => {
        const sdkHome = "C:\\Android\\Sdk";
        const existsSync = createExistsSync([
            sdkHome,
            path.join(sdkHome, "platform-tools", "adb.exe"),
            path.join(sdkHome, "emulator", "emulator.exe"),
        ]);
        const resolved = (0, android_sdk_1.resolveAndroidSdk)({
            env: { ANDROID_HOME: sdkHome },
            existsSync,
            platform: "win32",
        });
        (0, test_1.expect)(resolved.sdkHome).toBe(path.resolve(sdkHome));
        (0, test_1.expect)(resolved.adbPath).toContain("adb.exe");
        (0, test_1.expect)(resolved.emulatorPath).toContain("emulator.exe");
    });
    (0, test_1.test)("rejects unexpanded env literals and falls back to LOCALAPPDATA SDK", () => {
        const localAppData = "C:\\Users\\someone\\AppData\\Local";
        const fallbackSdk = path.join(localAppData, "Android", "Sdk");
        const existsSync = createExistsSync([
            fallbackSdk,
            path.join(fallbackSdk, "platform-tools", "adb.exe"),
            path.join(fallbackSdk, "emulator", "emulator.exe"),
        ]);
        const resolved = (0, android_sdk_1.resolveAndroidSdk)({
            env: {
                ANDROID_HOME: "$env:LOCALAPPDATA\\Android\\Sdk",
                LOCALAPPDATA: localAppData,
            },
            existsSync,
            platform: "win32",
        });
        (0, test_1.expect)(resolved.sdkHome).toBe(path.resolve(fallbackSdk));
    });
    (0, test_1.test)("fails with actionable error when adb is missing", () => {
        const sdkHome = "C:\\Android\\Sdk";
        const existsSync = createExistsSync([
            sdkHome,
            path.join(sdkHome, "emulator", "emulator.exe"),
        ]);
        (0, test_1.expect)(() => (0, android_sdk_1.resolveAndroidSdk)({
            env: { ANDROID_HOME: sdkHome },
            existsSync,
            platform: "win32",
        })).toThrow(/adb binary is missing/i);
    });
});
test_1.test.describe("mobile appium status refresh", () => {
    test_1.test.beforeEach(() => {
        (0, appium_server_manager_1.__resetAppiumServerStateForTesting)();
        (0, appium_server_manager_1.__resetHttpStatusCheckerForTesting)();
    });
    test_1.test.afterEach(() => {
        (0, appium_server_manager_1.__resetAppiumServerStateForTesting)();
        (0, appium_server_manager_1.__resetHttpStatusCheckerForTesting)();
    });
    (0, test_1.test)("marks external server as ready when /status responds ok", async () => {
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: true, status: 200 }));
        const status = await (0, appium_server_manager_1.refreshStatus)(4723);
        (0, test_1.expect)(status.status).toBe("ready");
        (0, test_1.expect)(status.ready).toBe(true);
        (0, test_1.expect)(status.external).toBe(true);
        (0, test_1.expect)(status.running).toBe(true);
        (0, test_1.expect)(status.port).toBe(4723);
    });
    (0, test_1.test)("returns to stopped when previously external server is no longer reachable", async () => {
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: true, status: 200 }));
        await (0, appium_server_manager_1.refreshStatus)(4723);
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: false, status: 0 }));
        const status = await (0, appium_server_manager_1.refreshStatus)(4723);
        (0, test_1.expect)(status.status).toBe("stopped");
        (0, test_1.expect)(status.ready).toBe(false);
        (0, test_1.expect)(status.running).toBe(false);
        (0, test_1.expect)(status.external).toBe(false);
    });
});
test_1.test.describe("mobile scenario generation diagnostics", () => {
    async function runWithProvider(completeJson) {
        const provider = {
            providerType: "fake",
            providerName: "fake",
            model: "fake-model",
            completeJson,
        };
        return (0, mobile_scenario_generator_1.generateMobileScenarios)(jiraConfig, "AA", 10, undefined, 50, undefined, {
            loadIssues: async () => [issueAA88],
            createProvider: async () => provider,
            logger: { log: () => undefined, error: () => undefined },
        });
    }
    (0, test_1.test)("uses scenario_generation purpose and keeps valid scenarios", async () => {
        let capturedPurpose;
        const result = await runWithProvider(async (request) => {
            capturedPurpose = request.purpose;
            return {
                rawText: JSON.stringify({
                    scenarios: [
                        {
                            sourceIssueKey: "AA-88",
                            title: "Escenario válido",
                            steps: [
                                { action: "launchApp", description: "Abrir app" },
                                { action: "click", description: "Tap botón", target: { strategy: "accessibilityId", value: "btnIngresar" } },
                            ],
                            expectedResult: "Pantalla abierta",
                            preconditions: ["Usuario registrado"],
                        },
                    ],
                }),
                parsedJson: {
                    scenarios: [
                        {
                            sourceIssueKey: "AA-88",
                            title: "Escenario válido",
                            steps: [
                                { action: "launchApp", description: "Abrir app" },
                                { action: "click", description: "Tap botón", target: { strategy: "accessibilityId", value: "btnIngresar" } },
                            ],
                            expectedResult: "Pantalla abierta",
                            preconditions: ["Usuario registrado"],
                        },
                    ],
                },
                model: "fake-model",
                providerName: "fake",
                durationMs: 10,
                diagnostics: { exitCode: 0 },
            };
        });
        (0, test_1.expect)(capturedPurpose).toBe("scenario_generation");
        (0, test_1.expect)(result.scenarios).toHaveLength(1);
        (0, test_1.expect)(result.rejected).toHaveLength(0);
        (0, test_1.expect)(result.diagnosticsByIssue["AA-88"]?.finalScenarioCount).toBe(1);
    });
    (0, test_1.test)("classifies contract mismatch when provider payload shape is invalid", async () => {
        const result = await runWithProvider(async () => ({
            rawText: "{\"unexpected\":true}",
            parsedJson: { unexpected: true },
            model: "fake-model",
            providerName: "fake",
            durationMs: 8,
            diagnostics: { exitCode: 0 },
        }));
        (0, test_1.expect)(result.scenarios).toHaveLength(0);
        (0, test_1.expect)(result.rejected).toEqual([{ sourceIssueKey: "AA-88", reason: "ai_contract_mismatch" }]);
        (0, test_1.expect)(result.diagnosticsByIssue["AA-88"]?.contractValid).toBe(false);
        (0, test_1.expect)(result.diagnosticsByIssue["AA-88"]?.classifiedReason).toBe("ai_contract_mismatch");
    });
    (0, test_1.test)("classifies dropped scenarios when all fail normalization", async () => {
        const result = await runWithProvider(async () => ({
            rawText: JSON.stringify({
                scenarios: [
                    {
                        sourceIssueKey: "AA-88",
                        title: "Escenario inválido",
                        steps: [{ action: "click", description: "Falta target" }],
                    },
                ],
            }),
            parsedJson: {
                scenarios: [
                    {
                        sourceIssueKey: "AA-88",
                        title: "Escenario inválido",
                        steps: [{ action: "click", description: "Falta target" }],
                    },
                ],
            },
            model: "fake-model",
            providerName: "fake",
            durationMs: 7,
            diagnostics: { exitCode: 0 },
        }));
        (0, test_1.expect)(result.scenarios).toHaveLength(0);
        (0, test_1.expect)(result.rejected).toEqual([{ sourceIssueKey: "AA-88", reason: "all_scenarios_dropped" }]);
        (0, test_1.expect)(result.diagnosticsByIssue["AA-88"]?.normalizationDroppedCount).toBe(1);
        (0, test_1.expect)(result.diagnosticsByIssue["AA-88"]?.dropReasons).toContain("missing_step_target");
    });
    (0, test_1.test)("maps provider invalid JSON failure with diagnostics", async () => {
        const result = await runWithProvider(async () => {
            throw new ai_provider_types_1.AiProviderError("ai_provider_invalid_json", "invalid json", {
                exitCode: 21,
                stdout: "oops",
            });
        });
        (0, test_1.expect)(result.scenarios).toHaveLength(0);
        (0, test_1.expect)(result.rejected).toEqual([{ sourceIssueKey: "AA-88", reason: "ai_invalid_json" }]);
        (0, test_1.expect)(result.diagnosticsByIssue["AA-88"]?.providerExitCode).toBe(21);
        (0, test_1.expect)(result.diagnosticsByIssue["AA-88"]?.rawOutputLength).toBe(4);
    });
    (0, test_1.test)("filters mobile generation by selectedIssueKeys", async () => {
        let providerCalls = 0;
        const provider = {
            providerType: "fake",
            providerName: "fake",
            model: "fake-model",
            completeJson: async () => {
                providerCalls++;
                return {
                    rawText: JSON.stringify({
                        scenarios: [
                            {
                                sourceIssueKey: "AA-88",
                                title: "Escenario",
                                steps: [{ action: "launchApp", description: "Abrir app" }],
                                expectedResult: "OK",
                            },
                        ],
                    }),
                    parsedJson: {
                        scenarios: [
                            {
                                sourceIssueKey: "AA-88",
                                title: "Escenario",
                                steps: [{ action: "launchApp", description: "Abrir app" }],
                                expectedResult: "OK",
                            },
                        ],
                    },
                    model: "fake-model",
                    providerName: "fake",
                    durationMs: 5,
                    diagnostics: { exitCode: 0 },
                };
            },
        };
        const result = await (0, mobile_scenario_generator_1.generateMobileScenarios)(jiraConfig, "AA", 10, undefined, 50, undefined, {
            loadIssues: async () => [
                issueAA88,
                { ...issueAA88, key: "AA-99", summary: "Otra HU" },
            ],
            createProvider: async () => provider,
            logger: { log: () => undefined, error: () => undefined },
            selectedIssueKeys: ["AA-88"],
        });
        (0, test_1.expect)(providerCalls).toBe(1);
        (0, test_1.expect)(result.issuesFound).toBe(1);
        (0, test_1.expect)(result.scenarios[0]?.sourceIssueKey).toBe("AA-88");
    });
});
test_1.test.describe("mobile test runner preflight", () => {
    (0, test_1.test)("fails early with actionable error when apkPath does not exist", async () => {
        const job = job_store_1.jobStore.create("mobile-test-run", {
            avdName: "test-avd",
            apkPath: "C:\\path\\that\\does-not-exist.apk",
            steps: [{ action: "launchApp", description: "Abrir app" }],
        });
        await (0, mobile_test_runner_1.startMobileTestRunJob)(job.id);
        const updated = job_store_1.jobStore.get(job.id);
        (0, test_1.expect)(updated).toBeDefined();
        (0, test_1.expect)(updated?.status).toBe("failed");
        (0, test_1.expect)(updated?.errorMessage).toContain("APK file not found at path");
    });
});
test_1.test.describe("mobile router status endpoints", () => {
    test_1.test.beforeEach(() => {
        (0, appium_server_manager_1.__resetAppiumServerStateForTesting)();
        (0, appium_server_manager_1.__resetHttpStatusCheckerForTesting)();
        (0, emulator_manager_1.__resetAdbRunnerForTesting)();
        (0, emulator_manager_1.__resetEmulatorStateForTesting)();
    });
    test_1.test.afterEach(() => {
        (0, appium_server_manager_1.__resetAppiumServerStateForTesting)();
        (0, appium_server_manager_1.__resetHttpStatusCheckerForTesting)();
        (0, emulator_manager_1.__resetAdbRunnerForTesting)();
        (0, emulator_manager_1.__resetEmulatorStateForTesting)();
    });
    (0, test_1.test)("appium/status responds with refreshed status contract", async () => {
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: true, status: 200 }));
        const app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use("/api/mobile", mobile_1.mobileRouter);
        const server = await new Promise((resolve, reject) => {
            const s = app.listen(0, "127.0.0.1", () => resolve(s));
            s.once("error", reject);
        });
        const address = server.address();
        (0, test_1.expect)(address).not.toBeNull();
        const port = address?.port;
        (0, test_1.expect)(typeof port).toBe("number");
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/mobile/appium/status`);
            const payload = await response.json();
            (0, test_1.expect)(response.status).toBe(200);
            (0, test_1.expect)(payload.ok).toBe(true);
            (0, test_1.expect)(payload.status).toBe("ready");
            (0, test_1.expect)(payload.ready).toBe(true);
        }
        finally {
            await new Promise((resolve) => server.close(() => resolve()));
        }
    });
    (0, test_1.test)("emulator/start is idempotent when an emulator is already running", async () => {
        (0, emulator_manager_1.__setAdbRunnerForTesting)(async (args) => {
            if (args[0] === "devices") {
                return {
                    exitCode: 0,
                    stdout: "List of devices attached\r\nemulator-5554\tdevice\r\n",
                    stderr: "",
                };
            }
            return { exitCode: 0, stdout: "", stderr: "" };
        });
        await (0, emulator_manager_1.startEmulator)("Pixel_7_Pro", { headless: true });
        const app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use("/api/mobile", mobile_1.mobileRouter);
        const server = await new Promise((resolve, reject) => {
            const s = app.listen(0, "127.0.0.1", () => resolve(s));
            s.once("error", reject);
        });
        const address = server.address();
        (0, test_1.expect)(address).not.toBeNull();
        const port = address?.port;
        (0, test_1.expect)(typeof port).toBe("number");
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/mobile/emulator/start`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ avdName: "Pixel_7_Pro", headless: true }),
            });
            const payload = await response.json();
            (0, test_1.expect)(response.status).toBe(202);
            (0, test_1.expect)(payload.ok).toBe(true);
            (0, test_1.expect)(payload.reused).toBe(true);
            (0, test_1.expect)(payload.message).toContain("reusing existing instance");
        }
        finally {
            await new Promise((resolve) => server.close(() => resolve()));
        }
    });
    (0, test_1.test)("stopEmulator preserves reused external emulator by default", async () => {
        const adbCalls = [];
        (0, emulator_manager_1.__setAdbRunnerForTesting)(async (args) => {
            adbCalls.push(args);
            if (args[0] === "devices") {
                return {
                    exitCode: 0,
                    stdout: "List of devices attached\r\nemulator-5554\tdevice\r\n",
                    stderr: "",
                };
            }
            return { exitCode: 0, stdout: "", stderr: "" };
        });
        await (0, emulator_manager_1.startEmulator)("Pixel_7_Pro", { headless: true });
        const logs = [];
        await (0, emulator_manager_1.stopEmulator)((line) => logs.push(line));
        (0, test_1.expect)(adbCalls.some((args) => args.includes("emu") && args.includes("kill"))).toBe(false);
        (0, test_1.expect)(logs.some((line) => line.includes("emulatorCleanup action=preserve reason=reused_external_emulator"))).toBe(true);
    });
    (0, test_1.test)("stopEmulator still preserves external emulator even with explicit caller metadata", async () => {
        const adbCalls = [];
        (0, emulator_manager_1.__setAdbRunnerForTesting)(async (args) => {
            adbCalls.push(args);
            if (args[0] === "devices") {
                return {
                    exitCode: 0,
                    stdout: "List of devices attached\r\nemulator-5554\tdevice\r\n",
                    stderr: "",
                };
            }
            return { exitCode: 0, stdout: "", stderr: "" };
        });
        await (0, emulator_manager_1.startEmulator)("Pixel_7_Pro", { headless: true });
        const logs = [];
        await (0, emulator_manager_1.stopEmulator)((line) => logs.push(line), {
            caller: "unit-test",
            runId: "run-stop-1",
        });
        (0, test_1.expect)(adbCalls.some((args) => args.includes("emu") && args.includes("kill"))).toBe(false);
        (0, test_1.expect)(logs.some((line) => line.includes("emulatorCleanup action=preserve reason=reused_external_emulator"))).toBe(true);
    });
});
test_1.test.describe("mobile async scenario generation endpoints", () => {
    test_1.test.afterEach(() => {
        (0, mobile_scenario_generation_manager_1.__setMobileScenarioGenerationRunnerForTesting)(null);
        (0, mobile_scenario_generation_manager_1.__resetMobileScenarioGenerationStateForTesting)();
    });
    (0, test_1.test)("reuses same generation job for concurrent equivalent requests", async () => {
        let release = null;
        (0, mobile_scenario_generation_manager_1.__setMobileScenarioGenerationRunnerForTesting)(async (_input, handlers) => {
            handlers.onIssuesResolved(["AA-94", "AA-93"]);
            handlers.onIssueStart({ issueKey: "AA-94", index: 0, total: 2, startedAt: new Date().toISOString() });
            await new Promise((resolve) => { release = resolve; });
            handlers.onIssueCompleted({
                issueKey: "AA-94",
                index: 0,
                total: 2,
                status: "completed",
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 5,
                scenarios: [{ scenarioId: "MOBILE-AA-94-001", sourceIssueKey: "AA-94", title: "S1", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] }],
                rejected: [],
                diagnostics: {
                    providerExitCode: 0,
                    rawOutputLength: 12,
                    parsed: true,
                    contractValid: true,
                    rawScenarioCount: 1,
                    rawRejectedCount: 0,
                    normalizationDroppedCount: 0,
                    dropReasons: [],
                    finalScenarioCount: 1,
                    finalRejectedCount: 0,
                    classifiedReason: undefined,
                },
            });
            handlers.onIssueStart({ issueKey: "AA-93", index: 1, total: 2, startedAt: new Date().toISOString() });
            handlers.onIssueCompleted({
                issueKey: "AA-93",
                index: 1,
                total: 2,
                status: "completed",
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 5,
                scenarios: [{ scenarioId: "MOBILE-AA-93-001", sourceIssueKey: "AA-93", title: "S2", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] }],
                rejected: [],
                diagnostics: {
                    providerExitCode: 0,
                    rawOutputLength: 12,
                    parsed: true,
                    contractValid: true,
                    rawScenarioCount: 1,
                    rawRejectedCount: 0,
                    normalizationDroppedCount: 0,
                    dropReasons: [],
                    finalScenarioCount: 1,
                    finalRejectedCount: 0,
                    classifiedReason: undefined,
                },
            });
            return {
                scenarios: [
                    { scenarioId: "MOBILE-AA-94-001", sourceIssueKey: "AA-94", title: "S1", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] },
                    { scenarioId: "MOBILE-AA-93-001", sourceIssueKey: "AA-93", title: "S2", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] },
                ],
                rejected: [],
                issuesFound: 2,
                diagnosticsByIssue: {
                    "AA-94": {
                        providerExitCode: 0,
                        rawOutputLength: 12,
                        parsed: true,
                        contractValid: true,
                        rawScenarioCount: 1,
                        rawRejectedCount: 0,
                        normalizationDroppedCount: 0,
                        dropReasons: [],
                        finalScenarioCount: 1,
                        finalRejectedCount: 0,
                        classifiedReason: undefined,
                    },
                    "AA-93": {
                        providerExitCode: 0,
                        rawOutputLength: 12,
                        parsed: true,
                        contractValid: true,
                        rawScenarioCount: 1,
                        rawRejectedCount: 0,
                        normalizationDroppedCount: 0,
                        dropReasons: [],
                        finalScenarioCount: 1,
                        finalRejectedCount: 0,
                        classifiedReason: undefined,
                    },
                },
            };
        });
        const app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use("/api/mobile", mobile_1.mobileRouter);
        const server = await new Promise((resolve, reject) => {
            const s = app.listen(0, "127.0.0.1", () => resolve(s));
            s.once("error", reject);
        });
        const address = server.address();
        const port = address?.port;
        try {
            const payload = {
                projectKey: "AA",
                sprintId: 10,
                appSlug: "app-conversacional-bsc",
                selectedIssueKeys: ["AA-93", "AA-94"],
            };
            const firstRes = await fetch(`http://127.0.0.1:${port}/api/mobile/scenarios/generation`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });
            const secondRes = await fetch(`http://127.0.0.1:${port}/api/mobile/scenarios/generation`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });
            const firstBody = await firstRes.json();
            const secondBody = await secondRes.json();
            (0, test_1.expect)(firstRes.status).toBe(202);
            (0, test_1.expect)(secondRes.status).toBe(202);
            (0, test_1.expect)(firstBody.generationJobId).toBe(secondBody.generationJobId);
            (0, test_1.expect)(firstBody.reused).toBe(false);
            (0, test_1.expect)(secondBody.reused).toBe(true);
            const runningRes = await fetch(`http://127.0.0.1:${port}/api/mobile/scenarios/generation/${firstBody.generationJobId}`);
            const runningBody = await runningRes.json();
            (0, test_1.expect)(runningRes.status).toBe(200);
            (0, test_1.expect)(runningBody.status === "running" || runningBody.status === "pending").toBeTruthy();
            (0, test_1.expect)(Array.isArray(runningBody.issueProgress)).toBeTruthy();
            release?.();
            await (0, mobile_scenario_generation_manager_1.__awaitMobileScenarioGenerationForTesting)(firstBody.generationJobId);
            const doneRes = await fetch(`http://127.0.0.1:${port}/api/mobile/scenarios/generation/${firstBody.generationJobId}`);
            const doneBody = await doneRes.json();
            (0, test_1.expect)(doneRes.status).toBe(200);
            (0, test_1.expect)(doneBody.status).toBe("completed");
            (0, test_1.expect)(doneBody.result?.scenarios?.length).toBe(2);
            (0, test_1.expect)(doneBody.testRunId).toBeUndefined();
            (0, test_1.expect)(doneBody.publishedCases).toBeUndefined();
        }
        finally {
            await new Promise((resolve) => server.close(() => resolve()));
        }
    });
});
