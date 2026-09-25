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
exports.composeRuntimeDataContext = composeRuntimeDataContext;
exports.startCaseAutomationWorkflow = startCaseAutomationWorkflow;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const test_1 = require("@playwright/test");
const env_1 = require("../config/env");
const testrail_client_1 = require("../clients/testrail.client");
const testrail_normalizer_1 = require("../testrail/testrail-normalizer");
const plans_1 = require("../plans");
const plan_enricher_1 = require("../plans/plan-enricher");
const data_context_1 = require("../data/data-context");
const runner_1 = require("../runner");
const testrail_reporter_1 = require("../testrail/testrail-reporter");
const promote_plan_1 = require("../automations/promote-plan");
const automation_reuse_1 = require("../automations/automation-reuse");
const agent_1 = require("../agent");
const snapshot_gap_detector_1 = require("../agent/snapshot-gap-detector");
const post_execution_reporting_1 = require("../reporting/post-execution-reporting");
const plan_repair_goal_1 = require("./plan-repair-goal");
const page_scanner_1 = require("../explorer/page-scanner");
const registry_1 = require("../registry");
const browser_session_1 = require("../browser/browser-session");
function buildArtifactsDir() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return node_path_1.default.resolve(`.artifacts/cases/${stamp}`);
}
function normalizeDataContextKey(value) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}
function runtimeSourcePriority(source) {
    if (source === "explicit_runtime_input" || source === "user_provided_qa_credentials" || source === "data_override")
        return 0;
    if (source === "runtime_context" || source === "fixture")
        return 1;
    if (source === "suggested_value" || source === "auto_generated")
        return 5;
    return 3;
}
function composeRuntimeDataContext(base, runtimeEntries = []) {
    const entriesByKey = new Map();
    const priorities = new Map();
    for (const entry of [...runtimeEntries, ...base.entries]) {
        const normalizedKey = normalizeDataContextKey(entry.key);
        const priority = runtimeSourcePriority(entry.source);
        if (!entriesByKey.has(normalizedKey) || priority < (priorities.get(normalizedKey) ?? Number.MAX_SAFE_INTEGER)) {
            entriesByKey.set(normalizedKey, { ...entry });
            priorities.set(normalizedKey, priority);
        }
    }
    const entries = Array.from(entriesByKey.values());
    const sensitive = entries.filter((entry) => entry.sensitive).length;
    return {
        entries,
        counts: {
            total: entries.length,
            sensitive,
            nonSensitive: entries.length - sensitive,
        },
    };
}
async function loadSnapshotIfExists() {
    const explorerDir = node_path_1.default.resolve(".artifacts/explorer");
    try {
        const { readdir, readFile } = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
        const files = await readdir(explorerDir);
        const snapshotFile = files.find((f) => f.startsWith("snapshot-") && f.endsWith(".json"));
        if (!snapshotFile) {
            return undefined;
        }
        const content = await readFile(node_path_1.default.join(explorerDir, snapshotFile), "utf-8");
        return JSON.parse(content);
    }
    catch {
        return undefined;
    }
}
async function startCaseAutomationWorkflow(input) {
    const startedAt = new Date().toISOString();
    const artifactsDir = buildArtifactsDir();
    await (0, promises_1.mkdir)(artifactsDir, { recursive: true });
    const session = await (0, browser_session_1.launchRuntimeBrowserSession)({
        browserType: test_1.chromium,
        headless: !input.headed,
        targetUrl: env_1.config.app.baseUrl,
        profilePath: env_1.config.execution.qaBrowserProfilePath,
        channel: env_1.config.execution.qaBrowserChannel,
    });
    const page = session.page;
    try {
        const testRailRuntimeConfig = (0, env_1.requireTestRailConfig)(env_1.config);
        const client = new testrail_client_1.TestRailClient(testRailRuntimeConfig);
        const rawCase = await client.getCase(input.caseId);
        const scenarios = (0, testrail_normalizer_1.normalizeTestRailCases)([rawCase]);
        if (scenarios.length === 0) {
            throw new Error(`No scenario could be generated for case ${input.caseId}.`);
        }
        const scenario = scenarios[0];
        let reuse;
        let reusedPlan;
        if (input.reuseExisting !== false) {
            console.log("[cases:start] Searching for reusable automation...");
            const reuseResult = await (0, automation_reuse_1.findAndCloneReusablePlan)(input.caseId, scenario.title, undefined);
            if (reuseResult) {
                console.log(`[cases:start] Reusable automation found: ${reuseResult.match.entry.id}`);
                console.log(`[cases:start] Reusing automation from case C${reuseResult.match.entry.caseId} for case C${input.caseId}`);
                reusedPlan = reuseResult.plan;
                reuse = {
                    found: true,
                    sourceAutomationId: reuseResult.match.entry.id,
                    sourceCaseId: reuseResult.match.entry.caseId,
                    matchType: reuseResult.match.matchType,
                    confidence: reuseResult.match.confidence
                };
            }
            else {
                console.log("[cases:start] Reuse skipped: no matching automation found.");
                reuse = { found: false, skippedReason: "no_match" };
            }
        }
        else {
            reuse = { found: false, skippedReason: "disabled" };
        }
        const plan = reusedPlan ?? (0, plans_1.normalizeExecutionPlan)((0, plans_1.generateRuleBasedExecutionPlan)(scenario, { includeLogin: true }));
        const planPath = node_path_1.default.join(artifactsDir, `plan-${input.caseId}.json`);
        await (0, promises_1.writeFile)(planPath, JSON.stringify(plan, null, 2), "utf-8");
        const dataContext = composeRuntimeDataContext((0, data_context_1.buildDataContext)(env_1.config), input.runtimeEntries);
        const snapshot = await loadSnapshotIfExists();
        let enrichedPlan = plan;
        if (snapshot && !reusedPlan) {
            const enrichment = (0, plan_enricher_1.enrichExecutionPlanWithSnapshot)({
                plan,
                snapshot,
                dataContext,
                aliases: env_1.config.app.testDataAliases,
                missingInputBehavior: env_1.config.app.missingInputBehavior
            });
            enrichedPlan = enrichment.plan;
        }
        console.log(reusedPlan ? "[cases:start] Executing reused plan..." : "[cases:start] Executing plan...");
        const executionResult = await (0, runner_1.executeExecutionPlan)({
            page,
            plan: enrichedPlan,
            dataContext,
            evidenceDir: node_path_1.default.join(artifactsDir, "evidence"),
            continueOnFailure: input.continueOnFailure,
            appBaseUrl: env_1.config.app.baseUrl,
            runtimeConfig: env_1.config
        });
        const planResult = {
            scenario: enrichedPlan.scenario,
            status: executionResult.status,
            startedAt: executionResult.startedAt,
            finishedAt: executionResult.finishedAt,
            durationMs: executionResult.durationMs,
            evidenceDir: executionResult.evidenceDir,
            steps: executionResult.steps,
            evidenceKind: executionResult.evidenceKind,
            isDetailEvidence: executionResult.isDetailEvidence,
            detailScreenshotRequired: executionResult.detailScreenshotRequired,
            lastActionTarget: executionResult.lastActionTarget,
        };
        const summary = {
            generatedAt: new Date().toISOString(),
            total: 1,
            passed: executionResult.status === "passed" ? 1 : 0,
            failed: executionResult.status === "failed" ? 1 : 0,
            partial: executionResult.status === "partial" ? 1 : 0,
            skipped: executionResult.status === "skipped" ? 1 : 0,
            results: [planResult]
        };
        const resultPath = node_path_1.default.join(artifactsDir, `results-${input.caseId}.json`);
        await (0, runner_1.writePlanExecutionResults)(summary, resultPath);
        let testRailRunId;
        let testRailRunUrl;
        if (input.reportToTestRail !== false) {
            const projectId = input.projectId;
            const suiteId = input.suiteId ?? env_1.config.integrations.testRail?.suiteId;
            const runName = `Automation Run C${input.caseId} ${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}`;
            const reportOutput = await (0, testrail_reporter_1.reportToTestRail)(client, {
                resultsSummary: summary,
                projectId,
                suiteId,
                runName,
                dryRun: input.dryRun ?? false
            });
            testRailRunId = reportOutput.runId;
            testRailRunUrl = reportOutput.runUrl;
        }
        let promotion;
        let handoff;
        let autoRepair;
        const isPlanValidated = enrichedPlan.status === "validated";
        const executionPassed = executionResult.status === "passed";
        let finalPlan = enrichedPlan;
        let finalScenario = scenario;
        let finalSummary = summary;
        let finalResultPath = resultPath;
        let finalExecutionPassed = executionPassed;
        let finalIsPlanValidated = isPlanValidated;
        const agentCfg = (0, agent_1.resolveAgentAutoRepairConfig)(env_1.config);
        const hasSensitivePlanSteps = (p) => {
            return p.steps.some((step) => {
                const meta = step;
                return Boolean(meta.requiresApproval ||
                    meta.isSensitive ||
                    meta.riskLevel === "high" ||
                    (meta.actionCategory && ["destructive", "financial", "submit_final", "irreversible"].includes(meta.actionCategory)));
            });
        };
        const isRecoverableExecutionFailure = (result) => {
            if (result.status === "passed" || result.status === "skipped")
                return false;
            const failed = result.steps.filter((s) => s.status === "failed");
            if (failed.length === 0)
                return false;
            const allErrors = failed.map((s) => (s.error ?? "")).join(" | ").toLowerCase();
            // Hard blockers: missing data/config issues should not trigger auto repair.
            if (allErrors.includes("requires value or valuekey"))
                return false;
            if (allErrors.includes("valuekey") && allErrors.includes("not") && allErrors.includes("available"))
                return false;
            if (allErrors.includes("requires appbaseurl") || allErrors.includes("missing required environment"))
                return false;
            // Generic recoverables: locator/timeouts/visibility/assertions issues.
            if (allErrors.includes("timeout") ||
                allErrors.includes("waiting for") ||
                allErrors.includes("no element") ||
                allErrors.includes("strict mode") ||
                allErrors.includes("to be visible") ||
                allErrors.includes("contain text") ||
                allErrors.includes("to have url")) {
                return true;
            }
            return true;
        };
        if (input.autoHandoff && !isPlanValidated && !reusedPlan) {
            const gapAnalysis = (0, snapshot_gap_detector_1.analyzeSnapshotGaps)(enrichedPlan, snapshot);
            const noPlaywright = true;
            if (gapAnalysis.hasGaps) {
                const diagnosis = (0, snapshot_gap_detector_1.formatGapDiagnosis)(gapAnalysis, noPlaywright);
                console.log(`[cases:start] Snapshot gap detected for case C${input.caseId}:`);
                console.log(diagnosis);
                if (input.dryRun) {
                    handoff = { created: false, dryRun: true, reason: "dry_run" };
                    if (input.autoRepair) {
                        autoRepair = { attempted: false, success: false, dryRun: true, error: "Dry-run mode: would detect snapshot gaps." };
                    }
                }
                else {
                    handoff = {
                        created: false,
                        handoffDir: node_path_1.default.join(artifactsDir, `handoff-C${input.caseId}`),
                        dryRun: false,
                        reason: "plan_needs_discovery"
                    };
                    autoRepair = {
                        attempted: false,
                        success: false,
                        dryRun: false,
                        error: `The requested flow requires browser discovery because target elements are not present in the captured snapshot. Missing: ${gapAnalysis.allMissingTargets.join(", ")}`
                    };
                }
            }
            else if (input.dryRun) {
                handoff = { created: false, dryRun: true, reason: "dry_run" };
                if (input.autoRepair) {
                    autoRepair = { attempted: false, success: false, dryRun: true };
                }
            }
            else {
                const handoffDir = node_path_1.default.join(artifactsDir, `handoff-C${input.caseId}`);
                const goal = (0, plan_repair_goal_1.buildPlanRepairGoal)({
                    caseId: input.caseId,
                    scenarioTitle: enrichedPlan.scenario.title,
                    pendingSteps: enrichedPlan.steps.filter((s) => s.action === "noop")
                });
                const contextPackPath = node_path_1.default.join(handoffDir, "context-pack.json");
                try {
                    const { pack } = await (0, agent_1.buildAgentContextPack)({
                        fullConfig: env_1.config,
                        outputDir: artifactsDir,
                        evidenceDir: node_path_1.default.join(artifactsDir, "evidence"),
                        snapshot,
                        candidatePlanPath: planPath,
                        currentPlan: enrichedPlan,
                        failedReason: "plan_needs_repair",
                        supportedActions: (0, registry_1.listSupportedActions)()
                    });
                    await (0, promises_1.mkdir)(handoffDir, { recursive: true });
                    await (0, promises_1.writeFile)(contextPackPath, JSON.stringify(pack, null, 2), "utf-8");
                }
                catch {
                    // best-effort; handoff continues
                }
                const request = (0, agent_1.buildAgentHandoffRequest)({
                    kind: "plan_repair",
                    goal,
                    contextPackPath,
                    scenario,
                    currentPlan: enrichedPlan,
                    snapshot,
                    dataContext
                });
                const handoffResult = await (0, agent_1.writeAgentHandoffPackage)({ request, outputDir: handoffDir });
                handoff = {
                    created: true,
                    handoffDir,
                    requestPath: handoffResult.requestPath,
                    instructionsPath: handoffResult.instructionsPath,
                    schemaPath: handoffResult.schemaPath,
                    responsePath: handoffResult.responsePath,
                    dryRun: false,
                    reason: "plan_needs_repair"
                };
                if (input.autoRepair && handoff.created) {
                    const codexCommand = env_1.config.integrations.codex?.command ?? "codex";
                    const codexExtraArgsRaw = env_1.config.integrations.codex?.extraArgs ?? "--skip-git-repo-check --sandbox workspace-write";
                    const codexExtraArgs = codexExtraArgsRaw.split(/\s+/).filter(Boolean);
                    const timeoutMs = env_1.config.integrations.codex?.autoRepairTimeoutMs ?? 900000;
                    const promptMode = env_1.config.integrations.codex?.autoRepairPromptMode ?? "compact";
                    const repairResult = await (0, agent_1.runCodexAutoRepair)({
                        handoffDir,
                        requestPath: handoffResult.requestPath,
                        instructionsPath: handoffResult.instructionsPath,
                        responsePath: handoffResult.responsePath,
                        schemaPath: handoffResult.schemaPath,
                        contextPackPath,
                        projectRoot: process.cwd(),
                        timeoutMs,
                        codexCommand,
                        codexExtraArgs,
                        promptMode
                    });
                    if (repairResult.success) {
                        autoRepair = { attempted: true, success: true, dryRun: false, responsePath: repairResult.responsePath };
                        try {
                            const responseContent = await (0, promises_1.readFile)(repairResult.responsePath, "utf-8");
                            const parsedResponse = JSON.parse(responseContent);
                            const normalizedResponse = (0, agent_1.normalizeAgentHandoffResponse)(parsedResponse);
                            const response = normalizedResponse;
                            if (normalizedResponse !== parsedResponse) {
                                await (0, promises_1.writeFile)(repairResult.responsePath, JSON.stringify(normalizedResponse, null, 2), "utf-8");
                            }
                            const availableKeys = request.dataContextSummary?.availableKeys?.map((k) => (typeof k === "string" ? k : k.key)) ?? [];
                            const validation = (0, agent_1.validateAgentHandoffResponse)(response, {
                                availableDataKeys: availableKeys
                            });
                            if (validation.valid && response.plans.length > 0) {
                                finalPlan = response.plans[0];
                                finalIsPlanValidated = finalPlan.status === "validated";
                                if (finalIsPlanValidated) {
                                    const repairExecutionResult = await (0, runner_1.executeExecutionPlan)({
                                        page,
                                        plan: finalPlan,
                                        dataContext,
                                        evidenceDir: node_path_1.default.join(artifactsDir, "evidence-repaired"),
                                        continueOnFailure: input.continueOnFailure,
                                        appBaseUrl: env_1.config.app.baseUrl
                                    });
                                    const repairedPlanResult = {
                                        scenario: finalPlan.scenario,
                                        status: repairExecutionResult.status,
                                        startedAt: repairExecutionResult.startedAt,
                                        finishedAt: repairExecutionResult.finishedAt,
                                        durationMs: repairExecutionResult.durationMs,
                                        evidenceDir: repairExecutionResult.evidenceDir,
                                        steps: repairExecutionResult.steps
                                    };
                                    finalSummary = {
                                        generatedAt: new Date().toISOString(),
                                        total: 1,
                                        passed: repairExecutionResult.status === "passed" ? 1 : 0,
                                        failed: repairExecutionResult.status === "failed" ? 1 : 0,
                                        partial: repairExecutionResult.status === "partial" ? 1 : 0,
                                        skipped: repairExecutionResult.status === "skipped" ? 1 : 0,
                                        results: [repairedPlanResult]
                                    };
                                    finalResultPath = node_path_1.default.join(artifactsDir, `results-${input.caseId}-repaired.json`);
                                    await (0, runner_1.writePlanExecutionResults)(finalSummary, finalResultPath);
                                    finalExecutionPassed = repairExecutionResult.status === "passed";
                                    if (input.reportToTestRail !== false) {
                                        const projectId = input.projectId;
                                        const suiteId = input.suiteId ?? env_1.config.integrations.testRail?.suiteId;
                                        const runName = `Automation Run C${input.caseId} (repaired) ${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}`;
                                        const reportOutput = await (0, testrail_reporter_1.reportToTestRail)(client, {
                                            resultsSummary: finalSummary,
                                            projectId,
                                            suiteId,
                                            runName,
                                            dryRun: input.dryRun ?? false
                                        });
                                        testRailRunId = reportOutput.runId;
                                        testRailRunUrl = reportOutput.runUrl;
                                    }
                                }
                            }
                            else {
                                autoRepair = {
                                    attempted: true,
                                    success: false,
                                    dryRun: false,
                                    error: `Agent response validation failed: ${validation.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`
                                };
                            }
                        }
                        catch (err) {
                            const message = err instanceof Error ? err.message : String(err);
                            autoRepair = { attempted: true, success: false, dryRun: false, error: message };
                        }
                    }
                    else {
                        autoRepair = {
                            attempted: true,
                            success: false,
                            dryRun: false,
                            error: repairResult.error,
                            timedOut: repairResult.timedOut
                        };
                    }
                }
            }
        }
        // Auto-repair for recoverable execution failures (deterministic execution first, Codex fallback)
        if (input.autoRepair &&
            agentCfg.enabled &&
            !finalExecutionPassed &&
            finalPlan.status === "validated" &&
            !hasSensitivePlanSteps(finalPlan) &&
            isRecoverableExecutionFailure(executionResult) &&
            !input.dryRun) {
            console.log("[cases:start] Auto-repair enabled. Preparing Codex handoff...");
            const liveSnapshot = await (0, page_scanner_1.scanCurrentPage)(page);
            for (let attempt = 1; attempt <= agentCfg.maxAttempts; attempt += 1) {
                console.log(`[cases:start] Running Codex CLI (attempt ${attempt}/${agentCfg.maxAttempts})...`);
                const attemptResult = await (0, agent_1.runAgentAutoRepairAttempt)({
                    fullConfig: env_1.config,
                    outputDir: artifactsDir,
                    attemptNumber: attempt,
                    kind: "plan_repair",
                    failureSummary: `execution_failed status=${executionResult.status} failedSteps=${executionResult.steps.filter((s) => s.status === "failed").map((s) => `#${s.index}:${s.action}`).join(",")}`,
                    scenario,
                    currentPlan: finalPlan,
                    snapshot: liveSnapshot
                });
                autoRepair = {
                    attempted: true,
                    success: attemptResult.success,
                    dryRun: false,
                    responsePath: attemptResult.responsePath,
                    error: attemptResult.success ? undefined : attemptResult.reason,
                    timedOut: attemptResult.status === "timeout"
                };
                if (!attemptResult.success) {
                    if (attemptResult.status === "no_proposal") {
                        console.log("[cases:start] AI explorer did not return a proposal.");
                        break;
                    }
                    if (attempt === agentCfg.maxAttempts) {
                        console.log("[cases:start] Auto-repair attempts exhausted.");
                        break;
                    }
                    continue;
                }
                console.log("[cases:start] Codex response validated.");
                console.log("[cases:start] Retrying execution with repaired plan...");
                const repairedPlan = attemptResult.repairedPlan;
                const repairedExec = await (0, runner_1.executeExecutionPlan)({
                    page,
                    plan: repairedPlan,
                    dataContext,
                    evidenceDir: node_path_1.default.join(artifactsDir, `evidence-auto-repaired-attempt-${attempt}`),
                    continueOnFailure: input.continueOnFailure,
                    appBaseUrl: env_1.config.app.baseUrl,
                    runtimeConfig: env_1.config
                });
                finalPlan = repairedPlan;
                finalIsPlanValidated = finalPlan.status === "validated";
                finalExecutionPassed = repairedExec.status === "passed";
                if (finalExecutionPassed && finalIsPlanValidated) {
                    console.log("[cases:start] Retry passed.");
                    const repairedPlanResult = {
                        scenario: finalPlan.scenario,
                        status: repairedExec.status,
                        startedAt: repairedExec.startedAt,
                        finishedAt: repairedExec.finishedAt,
                        durationMs: repairedExec.durationMs,
                        evidenceDir: repairedExec.evidenceDir,
                        steps: repairedExec.steps
                    };
                    finalSummary = {
                        generatedAt: new Date().toISOString(),
                        total: 1,
                        passed: 1,
                        failed: 0,
                        partial: 0,
                        skipped: 0,
                        results: [repairedPlanResult]
                    };
                    finalResultPath = node_path_1.default.join(artifactsDir, `results-${input.caseId}-auto-repaired.json`);
                    await (0, runner_1.writePlanExecutionResults)(finalSummary, finalResultPath);
                    break;
                }
                console.log(`[cases:start] Retry failed with status ${repairedExec.status}.`);
            }
        }
        let postReportingTestRailRunId;
        let postReportingJiraAttached = false;
        if (input.reportToTestRail !== false && finalExecutionPassed && finalIsPlanValidated && !input.dryRun) {
            const sectionId = env_1.config.integrations.testRail?.sectionId
                ? Number(env_1.config.integrations.testRail.sectionId)
                : undefined;
            const projectId = env_1.config.integrations.testRail?.projectId
                ? Number(env_1.config.integrations.testRail.projectId)
                : undefined;
            const suiteId = env_1.config.integrations.testRail?.suiteId
                ? Number(env_1.config.integrations.testRail.suiteId)
                : undefined;
            if (sectionId && projectId) {
                const evidenceDocPath = node_path_1.default.join(artifactsDir, `evidence-C${input.caseId}.docx`);
                const reportingResult = await (0, post_execution_reporting_1.runPostExecutionReporting)({
                    page,
                    caseId: input.caseId,
                    projectId,
                    suiteId,
                    sectionId,
                    jiraIssueKey: env_1.config.integrations.jira?.projectKey
                        ? `${env_1.config.integrations.jira.projectKey}-${input.caseId}`
                        : "AA-79",
                    runName: `Regresion Kiosko Automatizada - C${input.caseId}`,
                    evidenceDocPath,
                    escenarios: finalSummary.results
                });
                postReportingTestRailRunId = reportingResult.testRailRunId;
                postReportingJiraAttached = reportingResult.jiraAttached;
            }
        }
        const shouldPromote = input.autoPromote && finalExecutionPassed && finalIsPlanValidated;
        if (shouldPromote) {
            if (input.dryRun) {
                promotion = { promoted: false, dryRun: true, reason: "dry_run" };
            }
            else {
                const entry = await (0, promote_plan_1.promoteExecutionPlan)({
                    plan: finalPlan,
                    sourcePlanPath: planPath,
                    lastExecutionResultPath: finalResultPath,
                    source: reusedPlan ? "manual" : "rule_based",
                    overwrite: true
                });
                promotion = {
                    promoted: true,
                    automationId: entry.id,
                    planPath: entry.planPath,
                    specPath: entry.specPath,
                    dryRun: false
                };
            }
        }
        else if (input.autoPromote && !finalExecutionPassed) {
            promotion = { promoted: false, dryRun: false, reason: "execution_failed" };
        }
        else if (input.autoPromote && !finalIsPlanValidated) {
            promotion = { promoted: false, dryRun: false, reason: "plan_not_validated" };
        }
        const workflowStatus = finalIsPlanValidated && finalExecutionPassed
            ? "success"
            : (handoff?.reason === "plan_needs_discovery")
                ? "needs_discovery"
                : (!finalIsPlanValidated && input.autoHandoff)
                    ? "needs_agent"
                    : "failed";
        return {
            caseId: input.caseId,
            status: workflowStatus,
            planPath,
            executionResultPath: finalResultPath,
            testRailRunId: postReportingTestRailRunId ?? testRailRunId,
            testRailRunUrl,
            startedAt,
            completedAt: new Date().toISOString(),
            promotion,
            handoff,
            autoRepair,
            reuse,
            postReporting: input.reportToTestRail !== false && finalExecutionPassed && finalIsPlanValidated
                ? { testRailRunId: postReportingTestRailRunId, jiraAttached: postReportingJiraAttached }
                : undefined
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            caseId: input.caseId,
            status: "failed",
            error: message,
            startedAt,
            completedAt: new Date().toISOString()
        };
    }
    finally {
        await session.close();
    }
}
