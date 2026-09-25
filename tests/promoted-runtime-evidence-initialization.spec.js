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
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const promoted_spec_runtime_1 = require("../src/automations/runtime/promoted-spec-runtime");
const evidence_recorder_1 = require("../src/evidence/evidence-recorder");
const evidence_paths_1 = require("../src/evidence/evidence-paths");
const discovery_batch_runner_1 = require("../src/server/jobs/discovery-batch-runner");
const job_store_1 = require("../src/server/jobs/job-store");
const runs_1 = require("../src/server/routes/runs");
const EVIDENCE_ROOT = path.join(process.cwd(), ".artifacts", "evidence");
function uniqueId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
async function rmIfExists(targetPath) {
    if (fs.existsSync(targetPath)) {
        await fs.promises.rm(targetPath, { recursive: true, force: true });
    }
}
async function withEnv(updates, fn) {
    const previous = {};
    for (const [key, value] of Object.entries(updates)) {
        previous[key] = process.env[key];
        if (value === undefined)
            delete process.env[key];
        else
            process.env[key] = value;
    }
    try {
        await fn();
    }
    finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined)
                delete process.env[key];
            else
                process.env[key] = value;
        }
    }
}
(0, test_1.test)("explicit section slug is preserved for runtime evidence identity", async () => {
    const appSlug = uniqueId("app");
    const sectionSlug = "detalle-kiosko";
    const scenarioId = `C${Math.floor(Math.random() * 100000)}`;
    const runId = uniqueId("job");
    const scenarioTitle = "Runtime Evidence Init";
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
        logs.push(args.map((arg) => String(arg)).join(" "));
        originalLog(...args);
    };
    try {
        await withEnv({
            EVIDENCE_ENABLED: "true",
            EVIDENCE_PER_SCENARIO_DOCX: "false",
            EVIDENCE_APP_SLUG: appSlug,
            EVIDENCE_SECTION_SLUG: sectionSlug,
            APP_SLUG: appSlug,
            SECTION_SLUG: "default-section",
            SCENARIO_ID: scenarioId,
            SCENARIO_TITLE: scenarioTitle,
            EVIDENCE_RUN_ID: runId,
        }, async () => {
            const fakePage = {
                on: () => undefined,
            };
            const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(fakePage);
            await runtime.finishEvidence();
        });
    }
    finally {
        console.log = originalLog;
    }
    const paths = (0, evidence_paths_1.buildEvidencePaths)({
        appSlug,
        sectionSlug,
        scenarioId,
        scenarioTitle,
        runId,
    });
    (0, test_1.expect)(logs.some((line) => line.includes("[evidence] initialized scenario="))).toBe(true);
    (0, test_1.expect)(logs.some((line) => line.includes("[evidence] init failed"))).toBe(false);
    (0, test_1.expect)(logs.some((line) => line.includes("Cannot use import statement outside a module"))).toBe(false);
    (0, test_1.expect)(logs.some((line) => line.includes("Failed to load the ES module"))).toBe(false);
    (0, test_1.expect)(logs.some((line) => line.includes("perScenarioDocxGenerated=false"))).toBe(true);
    (0, test_1.expect)(logs.some((line) => /\[evidence\]\s+scenario=.*\sdocx=/.test(line))).toBe(false);
    (0, test_1.expect)(fs.existsSync(paths.evidenceJsonPath)).toBe(true);
    (0, test_1.expect)(paths.evidenceJsonPath.includes(`${path.sep}${sectionSlug}${path.sep}`)).toBe(true);
    (0, test_1.expect)(paths.evidenceJsonPath.includes(`${path.sep}default-section${path.sep}`)).toBe(false);
    await rmIfExists(path.join(EVIDENCE_ROOT, appSlug));
});
(0, test_1.test)("generic explicit section slug is propagated without hardcoding", async () => {
    const appSlug = uniqueId("app");
    const sectionSlug = uniqueId("section-ficticia");
    const scenarioId = uniqueId("scenario");
    const runId = uniqueId("run");
    await withEnv({
        EVIDENCE_ENABLED: "true",
        EVIDENCE_APP_SLUG: appSlug,
        EVIDENCE_SECTION_SLUG: sectionSlug,
        APP_SLUG: appSlug,
        SECTION_SLUG: "default-section",
        SCENARIO_ID: scenarioId,
        SCENARIO_TITLE: "Generic Section Propagation",
        EVIDENCE_RUN_ID: runId,
    }, async () => {
        const fakePage = { on: () => undefined };
        const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(fakePage);
        await runtime.finishEvidence();
    });
    const paths = (0, evidence_paths_1.buildEvidencePaths)({
        appSlug,
        sectionSlug,
        scenarioId,
        scenarioTitle: "Generic Section Propagation",
        runId,
    });
    (0, test_1.expect)(fs.existsSync(paths.evidenceJsonPath)).toBe(true);
    (0, test_1.expect)(paths.evidenceJsonPath.includes(`${path.sep}${sectionSlug}${path.sep}`)).toBe(true);
    (0, test_1.expect)(paths.evidenceJsonPath.includes(`${path.sep}default-section${path.sep}`)).toBe(false);
    await rmIfExists(path.join(EVIDENCE_ROOT, appSlug));
});
(0, test_1.test)("missing section falls back to default-section", async () => {
    const appSlug = uniqueId("app");
    const scenarioId = uniqueId("scenario");
    const runId = uniqueId("run");
    await withEnv({
        EVIDENCE_ENABLED: "true",
        EVIDENCE_APP_SLUG: appSlug,
        APP_SLUG: appSlug,
        EVIDENCE_SECTION_SLUG: undefined,
        SECTION_SLUG: undefined,
        SCENARIO_ID: scenarioId,
        SCENARIO_TITLE: "Fallback Section",
        EVIDENCE_RUN_ID: runId,
    }, async () => {
        const fakePage = { on: () => undefined };
        const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(fakePage);
        await runtime.finishEvidence();
    });
    const fallbackPaths = (0, evidence_paths_1.buildEvidencePaths)({
        appSlug,
        sectionSlug: "default-section",
        scenarioId,
        scenarioTitle: "Fallback Section",
        runId,
    });
    (0, test_1.expect)(fs.existsSync(fallbackPaths.evidenceJsonPath)).toBe(true);
    (0, test_1.expect)(fallbackPaths.evidenceJsonPath.includes(`${path.sep}default-section${path.sep}`)).toBe(true);
    await rmIfExists(path.join(EVIDENCE_ROOT, appSlug));
});
(0, test_1.test)("evidence recorder writes simulated functional result artifact", async () => {
    const appSlug = uniqueId("app");
    const sectionSlug = uniqueId("section");
    const scenarioId = uniqueId("scenario");
    const runId = uniqueId("run");
    const recorder = new evidence_recorder_1.EvidenceRecorder({
        appSlug,
        sectionSlug,
        scenarioId,
        scenarioTitle: "Simulated Result",
        runId,
    }, {
        enabled: true,
        docxEnabled: true,
        perScenarioDocx: false,
    });
    await recorder.start();
    recorder.addStepRecord(1, "Paso funcional simulado", { status: "passed" });
    const record = await recorder.finish();
    (0, test_1.expect)(record.steps).toHaveLength(1);
    (0, test_1.expect)(record.steps[0].status).toBe("passed");
    (0, test_1.expect)(record.evidenceJsonPath).toBeDefined();
    (0, test_1.expect)(record.evidenceJsonPath && fs.existsSync(record.evidenceJsonPath)).toBe(true);
    await rmIfExists(path.join(EVIDENCE_ROOT, appSlug));
});
(0, test_1.test)("consolidation counts 4 evidences and keeps documentPath on the same jobId", async () => {
    const appSlug = uniqueId("app");
    const sectionSlug = "detalle-kiosko";
    const job = job_store_1.jobStore.create("discovery-batch", { appSlug, sectionSlug });
    const runId = job.id;
    for (const label of ["A", "B", "C", "D"]) {
        const recorder = new evidence_recorder_1.EvidenceRecorder({
            appSlug,
            sectionSlug,
            scenarioId: uniqueId(`scenario-${label.toLowerCase()}`),
            scenarioTitle: `Scenario ${label}`,
            runId,
        }, {
            enabled: true,
            docxEnabled: true,
            perScenarioDocx: false,
        });
        await recorder.start();
        recorder.addStepRecord(1, `Paso ${label}`, { status: "passed" });
        await recorder.finish();
    }
    const consolidation = await (0, discovery_batch_runner_1.consolidateRunEvidenceForExecution)(runId, appSlug, sectionSlug, "Section");
    (0, test_1.expect)(consolidation.attempted).toBe(true);
    (0, test_1.expect)(consolidation.generated).toBe(true);
    (0, test_1.expect)(consolidation.documentPathPresent).toBe(true);
    (0, test_1.expect)(consolidation.scenarioEvidenceCount).toBe(4);
    (0, test_1.expect)(consolidation.documentPath).toBeDefined();
    (0, test_1.expect)(consolidation.documentPath && fs.existsSync(consolidation.documentPath)).toBe(true);
    job_store_1.jobStore.update(job.id, {
        status: "done",
        summary: {
            totalStories: 4,
            synced: 0,
            passed: 4,
            failed: 0,
            documentAttempted: true,
            documentGenerated: true,
            documentPathPresent: true,
            documentPath: consolidation.documentPath,
            evidenceResults: 4,
        },
    });
    const resolution = (0, runs_1.resolveEvidenceDocxForJob)(job.id);
    (0, test_1.expect)(resolution.status).toBe("ready");
    (0, test_1.expect)(resolution.documentReady).toBe(true);
    (0, test_1.expect)(path.resolve(resolution.documentPath ?? "")).toBe(path.resolve(consolidation.documentPath ?? ""));
    await rmIfExists(path.join(EVIDENCE_ROOT, appSlug));
});
