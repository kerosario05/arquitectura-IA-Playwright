"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const job_store_1 = require("../src/server/jobs/job-store");
const scenario_preview_runner_1 = require("../src/server/jobs/scenario-preview-runner");
function makeMcpScenario(overrides = {}) {
    return {
        sourceIssueKey: overrides.sourceIssueKey ?? "PROJ-1",
        title: overrides.title ?? "Test scenario",
        steps: overrides.steps ?? ["Step 1"],
        preconditions: overrides.preconditions ?? [],
        expectedResult: overrides.expectedResult ?? "Result",
        type: overrides.type ?? "functional",
        database: overrides.database ?? "",
        isConverted: overrides.isConverted ?? 0,
        automationType: overrides.automationType ?? "e2e",
        setupStrategy: overrides.setupStrategy ?? "default",
        appSlug: overrides.appSlug ?? "test-app",
        targetAppSlug: overrides.targetAppSlug,
        targetAppName: overrides.targetAppName,
        routeProfile: overrides.routeProfile ?? "",
        dataRequirements: overrides.dataRequirements ?? "",
        nonExecutableCriteria: overrides.nonExecutableCriteria ?? "",
        mcpExecutable: overrides.mcpExecutable ?? true,
        caseId: overrides.caseId,
        validation: overrides.validation ?? { valid: true, errors: [], warnings: [] },
    };
}
function validateScenarioPreviewRequest(body) {
    const scenarios = body.scenarios;
    if (!scenarios || scenarios.length === 0) {
        return { ok: false, status: 400, error: "invalid_preview_scenarios", message: "No hay escenarios válidos para ejecutar." };
    }
    const validScenarios = scenarios.filter((s) => s.mcpExecutable === true && s.validation?.valid !== false);
    if (validScenarios.length === 0) {
        return { ok: false, status: 400, error: "invalid_preview_scenarios", message: "No hay escenarios válidos para ejecutar." };
    }
    for (const sc of validScenarios) {
        if (!sc.steps || sc.steps.length === 0) {
            return { ok: false, status: 400, error: "invalid_preview_scenarios", message: `El escenario "${sc.sourceIssueKey}" no tiene steps.` };
        }
    }
    const appSlug = body.appSlug;
    const targetAppSlug = body.targetAppSlug;
    if (!appSlug && !targetAppSlug) {
        return { ok: false, status: 400, error: "invalid_preview_scenarios", message: "appSlug es requerido." };
    }
    const requiresTestRailSync = body.publishToTestRail === true || body.createTestRun === true || body.reportResults === true;
    if (requiresTestRailSync) {
        if (!body.testrailProjectId || !body.testrailSuiteId || !body.testrailSectionId) {
            return {
                ok: false,
                status: 400,
                error: "invalid_preview_scenarios",
                message: "projectId, suiteId y sectionId son requeridos para publicar y reportar en TestRail.",
            };
        }
    }
    return { ok: true };
}
// ── Route validation tests ──
(0, test_1.test)("scenario-preview route: returns 400 if scenarios is missing", () => {
    const result = validateScenarioPreviewRequest({});
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.error).toBe("invalid_preview_scenarios");
        (0, test_1.expect)(result.message).toBe("No hay escenarios válidos para ejecutar.");
    }
});
(0, test_1.test)("scenario-preview route: returns 400 if scenarios is empty array", () => {
    const result = validateScenarioPreviewRequest({ scenarios: [] });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.error).toBe("invalid_preview_scenarios");
    }
});
(0, test_1.test)("scenario-preview route: returns 400 if scenario is not mcpExecutable", () => {
    const result = validateScenarioPreviewRequest({
        scenarios: [makeMcpScenario({ mcpExecutable: false })],
    });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.error).toBe("invalid_preview_scenarios");
    }
});
(0, test_1.test)("scenario-preview route: returns 400 if scenario is invalid", () => {
    const result = validateScenarioPreviewRequest({
        scenarios: [makeMcpScenario({ validation: { valid: false, errors: ["Invalid"], warnings: [] } })],
    });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
    }
});
(0, test_1.test)("scenario-preview route: returns 400 if scenario has no steps", () => {
    const result = validateScenarioPreviewRequest({
        scenarios: [makeMcpScenario({ steps: [] })],
        appSlug: "kiosko",
    });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.message).toContain("no tiene steps");
    }
});
(0, test_1.test)("scenario-preview route: returns 400 if appSlug is missing", () => {
    const result = validateScenarioPreviewRequest({
        scenarios: [makeMcpScenario()],
    });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.status).toBe(400);
        (0, test_1.expect)(result.message).toContain("appSlug es requerido");
    }
});
(0, test_1.test)("scenario-preview route: accepts valid scenarios with appSlug", () => {
    const result = validateScenarioPreviewRequest({
        scenarios: [makeMcpScenario({ sourceIssueKey: "AA-81", caseId: undefined })],
        appSlug: "kiosko",
    });
    (0, test_1.expect)(result.ok).toBe(true);
});
(0, test_1.test)("scenario-preview route: accepts valid scenarios with targetAppSlug", () => {
    const result = validateScenarioPreviewRequest({
        scenarios: [makeMcpScenario({ targetAppSlug: "kiosko" })],
        targetAppSlug: "kiosko",
    });
    (0, test_1.expect)(result.ok).toBe(true);
});
(0, test_1.test)("scenario-preview route: requires TestRail ids when publish/report flags are enabled", () => {
    const result = validateScenarioPreviewRequest({
        scenarios: [makeMcpScenario({ targetAppSlug: "kiosko" })],
        appSlug: "kiosko",
        publishToTestRail: true,
        createTestRun: true,
        reportResults: true,
    });
    (0, test_1.expect)(result.ok).toBe(false);
    if (!result.ok) {
        (0, test_1.expect)(result.message).toContain("projectId, suiteId y sectionId");
    }
});
// ── Job store tests ──
(0, test_1.test)("jobStore: creates scenario-preview job with correct type", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [makeMcpScenario()],
        appSlug: "kiosko",
    });
    (0, test_1.expect)(job.type).toBe("scenario-preview");
    (0, test_1.expect)(job.status).toBe("queued");
});
(0, test_1.test)("jobStore: scenario-preview job is retrievable", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [makeMcpScenario({ sourceIssueKey: "AA-81" })],
        appSlug: "kiosko",
    });
    const retrieved = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(retrieved).toBeDefined();
    (0, test_1.expect)(retrieved?.type).toBe("scenario-preview");
});
(0, test_1.test)("jobStore: scenario-preview job appears in list", () => {
    const before = job_store_1.jobStore.list().length;
    job_store_1.jobStore.create("scenario-preview", { scenarios: [makeMcpScenario()], appSlug: "kiosko" });
    const after = job_store_1.jobStore.list().length;
    (0, test_1.expect)(after).toBe(before + 1);
});
// ── Runner tests ──
(0, test_1.test)("runner: fails job when scenarios is empty", () => {
    const job = job_store_1.jobStore.create("scenario-preview", { scenarios: [] });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("no scenarios provided"))).toBe(true);
});
(0, test_1.test)("runner: fails job when scenarios is missing", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {});
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("no scenarios provided"))).toBe(true);
});
(0, test_1.test)("runner: fails job when no valid mcpExecutable scenarios", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [makeMcpScenario({ mcpExecutable: false })],
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("no valid mcpExecutable"))).toBe(true);
});
(0, test_1.test)("runner: starts job with valid scenarios and saves artifacts", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [
            makeMcpScenario({ sourceIssueKey: "AA-81", title: "Visualizar categorías" }),
            makeMcpScenario({ sourceIssueKey: "AA-82", title: "Seleccionar producto" }),
        ],
        appSlug: "kiosko",
        targetAppSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("running");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("scenarios=2"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("appSlug=kiosko"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("Saved 2 scenarios"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("PREVIEW-001"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("PREVIEW-002"))).toBe(true);
});
(0, test_1.test)("runner: uses functional appSlug (targetAppSlug)", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [makeMcpScenario({ targetAppSlug: "kiosko" })],
        appSlug: "arquitectura-automatizacion",
        targetAppSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("running");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("appSlug=kiosko"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("[scenario-preview] requestedAppSlug=arquitectura-automatizacion"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("scenarioTargetAppSlug=kiosko"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("effectiveTargetAppSlug=kiosko"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("command=npm.cmd run discovery:preview -- --input"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("--app kiosko"))).toBe(true);
});
(0, test_1.test)("runner: sectionName metadata does not replace functional appSlug", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [
            makeMcpScenario({
                title: "Detalle_KIOSKO",
                sourceIssueKey: "AA-900",
                targetAppSlug: "kiosko",
                appSlug: "kiosko",
            }),
        ],
        appSlug: "kiosko",
        targetAppSlug: "kiosko",
        sectionName: "Kiosko / REGRESION-KIOSKO",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("running");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("effectiveTargetAppSlug=kiosko"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("sectionSlug=kiosko-regresion-kiosko"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("metadataOnly=true"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("--app kiosko"))).toBe(true);
});
(0, test_1.test)("runner: requested technical appSlug and technical scenario target does not resolve to section-derived slug", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [
            makeMcpScenario({
                title: "Escenario técnico",
                sourceIssueKey: "AA-910",
                targetAppSlug: "kiosko-regresion-kiosko",
                appSlug: "tests",
            }),
        ],
        appSlug: "tests",
        targetAppSlug: "tests",
        sectionName: "Kiosko / REGRESION-KIOSKO",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.errorMessage).toContain("section-derived");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("effectiveTargetAppSlug=kiosko-regresion-kiosko"))).toBe(false);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("--app kiosko-regresion-kiosko"))).toBe(false);
});
(0, test_1.test)("runner: default without valid routeProfile does not execute scenario-preview", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [
            makeMcpScenario({
                sourceIssueKey: "AA-911",
                title: "Sin perfil",
                targetAppSlug: "default",
            }),
        ],
        appSlug: "default",
        targetAppSlug: "default",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.errorMessage).toContain("technical/non-executable");
    (0, test_1.expect)(updated?.errorMessage).toContain("routeProfile");
});
(0, test_1.test)("runner: writes diagnostic error when only sectionName exists but no functional app is found", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [
            makeMcpScenario({
                sourceIssueKey: "AA-901",
                title: "Escenario sin pista funcional",
                targetAppSlug: undefined,
            }),
        ],
        appSlug: "tests",
        sectionName: "Kiosko / REGRESION-KIOSKO",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.errorMessage).toContain("technical/non-executable");
    const artifactDir = node_path_1.default.join(process.cwd(), ".artifacts", "scenario-preview-runs", job.id);
    const results = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(artifactDir, "results.json"), "utf-8"));
    (0, test_1.expect)(results.error).toBe("invalid_target_app_slug");
    (0, test_1.expect)(results.diagnostics?.requestedAppSlug).toBe("tests");
    (0, test_1.expect)(results.diagnostics?.scenarioTargetAppSlugs).toEqual([]);
    (0, test_1.expect)(results.diagnostics?.sectionName).toBe("Kiosko / REGRESION-KIOSKO");
    (0, test_1.expect)(results.diagnostics?.sectionSlug).toBe("kiosko-regresion-kiosko");
    (0, test_1.expect)(results.diagnostics?.titlesSample?.[0]).toContain("Escenario sin pista funcional");
});
(0, test_1.test)("runner: logs include scenario titles", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [
            makeMcpScenario({ sourceIssueKey: "AA-81", title: "Visualizar categorías principales" }),
        ],
        appSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("running");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("Visualizar categorías principales"))).toBe(true);
});
(0, test_1.test)("runner: does not call discovery:batch", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [makeMcpScenario()],
        appSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("running");
    // The command should use discovery:preview, not discovery:batch
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("discovery:preview"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("discovery:batch"))).toBe(false);
});
(0, test_1.test)("runner: summary includes scenario count", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [
            makeMcpScenario({ sourceIssueKey: "AA-81" }),
            makeMcpScenario({ sourceIssueKey: "AA-82" }),
            makeMcpScenario({ sourceIssueKey: "AA-83" }),
        ],
        appSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.summary?.totalStories).toBe(3);
});
(0, test_1.test)("runner: logs include command and child started before execution", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [makeMcpScenario({ sourceIssueKey: "AA-81" })],
        appSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("running");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("command=npm.cmd"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("child started pid="))).toBe(true);
});
(0, test_1.test)("runner: logs include finalSteps after normalization", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [makeMcpScenario({ sourceIssueKey: "AA-81", title: "Test" })],
        appSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("running");
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("finalSteps scenario=PREVIEW-001"))).toBe(true);
});
(0, test_1.test)("runner: preserves targetAppSlug in preview-scenarios json", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [
            makeMcpScenario({ sourceIssueKey: "AA-81", title: "Visualizar categorías", targetAppSlug: "kiosko" }),
            makeMcpScenario({ sourceIssueKey: "AA-82", title: "Seleccionar producto", targetAppSlug: "kiosko" }),
        ],
        appSlug: "tests",
        targetAppSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    test_1.expect.poll(() => job_store_1.jobStore.get(job.id)?.status).toBe("done");
    const finished = job_store_1.jobStore.get(job.id);
    const previewPath = node_path_1.default.join(finished?.summary?.artifactsDir ?? "", "preview-scenarios.json");
    const preview = JSON.parse(node_fs_1.default.readFileSync(previewPath, "utf-8"));
    (0, test_1.expect)(preview.every((scenario) => scenario.targetAppSlug === "kiosko")).toBe(true);
});
(0, test_1.test)("runner: fails with errorMessage when no scenarios provided", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [],
        appSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.errorMessage).toBe("No scenarios provided");
    (0, test_1.expect)(updated?.summary?.errorMessage).toBe("No scenarios provided");
});
(0, test_1.test)("runner: fails with errorMessage when no valid mcpExecutable scenarios", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [
            makeMcpScenario({ sourceIssueKey: "AA-81", mcpExecutable: false }),
        ],
        appSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.errorMessage).toBe("No valid mcpExecutable scenarios");
    (0, test_1.expect)(updated?.summary?.errorMessage).toBe("No valid mcpExecutable scenarios");
});
(0, test_1.test)("runner: summary includes scenarioCount on failure", () => {
    const job = job_store_1.jobStore.create("scenario-preview", {
        scenarios: [
            makeMcpScenario({ sourceIssueKey: "AA-81", mcpExecutable: false }),
            makeMcpScenario({ sourceIssueKey: "AA-82", mcpExecutable: false }),
        ],
        appSlug: "kiosko",
    });
    (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id);
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.summary?.totalStories).toBe(2);
});
