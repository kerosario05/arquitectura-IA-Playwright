"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRediscoveryProvenanceLine = buildRediscoveryProvenanceLine;
exports.buildDiscoveryBatchChecklistIdentity = buildDiscoveryBatchChecklistIdentity;
exports.resolveDiscoveryBatchIssueKeyMetadata = resolveDiscoveryBatchIssueKeyMetadata;
exports.buildDiscoveryBatchDefectDedupeKey = buildDiscoveryBatchDefectDedupeKey;
exports.parsePromotedFunctionalFailure = parsePromotedFunctionalFailure;
exports.loadPromotedEntriesForRouting = loadPromotedEntriesForRouting;
exports.selectCandidateEntryForCase = selectCandidateEntryForCase;
exports.validatePromotedEntryForExecution = validatePromotedEntryForExecution;
exports.validatePromotedBootstrapContract = validatePromotedBootstrapContract;
exports.resolvePromotedSpecTargetFromEntries = resolvePromotedSpecTargetFromEntries;
exports.specUsesPromotedPom = specUsesPromotedPom;
exports.resolvePromotedSpecForExecution = resolvePromotedSpecForExecution;
exports.isPersistedDiscoveryPromotionSuccessful = isPersistedDiscoveryPromotionSuccessful;
exports.resolvePostDiscoveryExecutionAdmission = resolvePostDiscoveryExecutionAdmission;
exports.resolveRouteFromValidation = resolveRouteFromValidation;
exports.supportsTargetedDiscoveryPreview = supportsTargetedDiscoveryPreview;
exports.resolveRediscoveryIntent = resolveRediscoveryIntent;
exports.buildDiscoveryPreviewArgs = buildDiscoveryPreviewArgs;
exports.computeFunctionalExecutionSnapshot = computeFunctionalExecutionSnapshot;
exports.parseEvidenceInitializationResult = parseEvidenceInitializationResult;
exports.buildMixedExecutionPlan = buildMixedExecutionPlan;
exports.buildCaseSchedule = buildCaseSchedule;
exports.buildDiscoveryBatchArgs = buildDiscoveryBatchArgs;
exports.buildTestPromotedArgs = buildTestPromotedArgs;
exports.buildPromotedExecutionEnv = buildPromotedExecutionEnv;
exports.buildRuntimeContextPath = buildRuntimeContextPath;
exports.normalizeRuntimeEntry = normalizeRuntimeEntry;
exports.buildBatchResultPath = buildBatchResultPath;
exports.writeRuntimeContextIfPresent = writeRuntimeContextIfPresent;
exports.deleteRuntimeContextIfExists = deleteRuntimeContextIfExists;
exports.buildDiscoveryChildEnv = buildDiscoveryChildEnv;
exports.readStructuredChildResult = readStructuredChildResult;
exports.consolidateRunEvidenceForExecution = consolidateRunEvidenceForExecution;
exports.buildDiscoveryBatchExecutionPlan = buildDiscoveryBatchExecutionPlan;
exports.startDiscoveryBatchRun = startDiscoveryBatchRun;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const run_evidence_recorder_1 = require("../../evidence/run-evidence-recorder");
const evidence_paths_1 = require("../../evidence/evidence-paths");
const automation_index_1 = require("../../automations/automation-index");
const automation_reuse_1 = require("../../automations/automation-reuse");
const case_contract_evaluator_1 = require("../../automations/case-contract-evaluator");
const scenario_normalizer_1 = require("../../automations/scenario-normalizer");
const env_1 = require("../../config/env");
const testrail_client_1 = require("../../clients/testrail.client");
const project_case_runtime_value_service_1 = require("../../db/project-case-runtime-value-service");
const testrail_normalizer_1 = require("../../testrail/testrail-normalizer");
const job_store_1 = require("./job-store");
const testrail_result_sync_1 = require("./testrail-result-sync");
const defect_checklist_store_1 = require("../services/defect-checklist-store");
const defect_content_builder_1 = require("../services/defect-content-builder");
const ROOT = node_path_1.default.resolve(__dirname, "..", "..", "..");
const APPS_ROOT = node_path_1.default.join(ROOT, "automations", "apps");
const DISCOVERY_RUNTIME_TMP_DIR = node_path_1.default.join(ROOT, ".artifacts", "tmp", "discovery-runtime");
const DISCOVERY_CASE_FINISHED_RE = /\[discovery:batch\] Case C(\d+)\s+finished:\s+([a-z_]+)(?:\s+\((\d+)ms\))?/i;
const RUNTIME_MODULE_MODE = (() => {
    try {
        return (new Function("return typeof module !== 'undefined' && module.exports ? 'cjs' : 'esm';"))();
    }
    catch {
        return "unknown";
    }
})();
function buildRediscoveryProvenanceLine(input) {
    const parts = ["[rediscovery-provenance]", `boundary=${input.boundary}`];
    if (input.sourceEndpoint)
        parts.push(`sourceEndpoint=${input.sourceEndpoint}`);
    if (input.jobType)
        parts.push(`jobType=${input.jobType}`);
    if (input.correlationField && input.correlationValue)
        parts.push(`${input.correlationField}=${input.correlationValue}`);
    if (input.jobId)
        parts.push(`jobId=${input.jobId}`);
    if (input.caseId !== undefined)
        parts.push(`caseId=${input.caseId}`);
    if (input.boundary === "intent_output") {
        parts.push(`explicit=${input.explicit === true}`, `source=${input.source ?? "none"}`);
    }
    else {
        const present = input.value !== undefined;
        parts.push(`propertyPresent=${present}`, `value=${present ? input.value : "undefined"}`, `type=${present ? typeof input.value : "undefined"}`);
        if (input.valueSource)
            parts.push(`valueSource=${input.valueSource}`);
    }
    return parts.join(" ");
}
const PROMOTED_ACTION_FAILURE_RE = /Promoted\s+([a-z_]+)\s+failed\s+at\s+step\s+(\d+)(?:\s+target="([^"]*)")?/i;
const PROMOTED_CURRENT_URL_RE = /currentUrl="([^"]+)"/i;
const PROMOTED_MATCHED_LOCATOR_RE = /matchedLocatorStrategy="([^"]+)"/i;
function buildDiscoveryBatchChecklistIdentity(input) {
    const launchId = nonEmptyString(input.launchId);
    if (launchId)
        return `launch:${launchId}`;
    const jobId = nonEmptyString(input.jobId);
    return jobId ? `job:${jobId}` : "job:unknown";
}
function resolveDiscoveryBatchIssueKeyMetadata(input) {
    const explicit = nonEmptyString(input.jiraKey);
    if (explicit)
        return explicit;
    const sourceIssueKeys = new Set();
    for (const entry of input.publishedCases ?? []) {
        const sourceIssueKey = nonEmptyString(entry.sourceIssueKey);
        if (sourceIssueKey)
            sourceIssueKeys.add(sourceIssueKey);
    }
    if (sourceIssueKeys.size !== 1)
        return undefined;
    const [resolved] = Array.from(sourceIssueKeys);
    return resolved;
}
function buildDiscoveryBatchDefectDedupeKey(input) {
    const scenarioId = nonEmptyString(input.scenarioId) ?? `C${input.caseId}`;
    return `${input.jobId}::${input.caseId}::${scenarioId}`;
}
function parsePromotedFunctionalFailure(lines) {
    let failedAtStep;
    let failedTarget;
    let failureReason;
    let errorMessage;
    let currentUrl;
    let matchedLocatorStrategy;
    for (const line of lines) {
        const actionMatch = PROMOTED_ACTION_FAILURE_RE.exec(line);
        if (actionMatch) {
            const action = actionMatch[1]?.trim().toLowerCase();
            const parsedStep = Number(actionMatch[2]);
            failedAtStep = Number.isFinite(parsedStep) ? parsedStep : failedAtStep;
            failedTarget = nonEmptyString(actionMatch[3]) ?? failedTarget;
            failureReason = action ? `promoted_${action}_failed` : "promoted_action_failed";
            errorMessage ??= line;
        }
        const currentUrlMatch = PROMOTED_CURRENT_URL_RE.exec(line);
        if (currentUrlMatch) {
            currentUrl = nonEmptyString(currentUrlMatch[1]) ?? currentUrl;
        }
        const locatorMatch = PROMOTED_MATCHED_LOCATOR_RE.exec(line);
        if (locatorMatch) {
            matchedLocatorStrategy = nonEmptyString(locatorMatch[1]) ?? matchedLocatorStrategy;
        }
        if (!errorMessage && /error|failed|exception/i.test(line)) {
            errorMessage = line;
        }
    }
    return {
        failedAtStep,
        failedTarget,
        failureReason,
        errorMessage,
        currentUrl,
        matchedLocatorStrategy,
    };
}
function isPositiveCaseId(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function normalizeSectionSlug(value) {
    const normalized = (value ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return normalized || "default-section";
}
function nonEmptyString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function roundToTwoDecimals(value) {
    return Math.round(value * 100) / 100;
}
const REUSABLE_PROMOTED_STATUSES = new Set([
    "active",
    "draft",
    "inline_debug_only",
]);
const BLOCKED_PROMOTED_STATUSES = new Set([
    "disabled",
    "needs_page_object",
    "needs_page_method",
    "needs_component_object",
    "needs_flow",
]);
function normalizeAppSlug(value) {
    const normalized = (value ?? "").trim().toLowerCase();
    return normalized || "default";
}
function toAbsoluteFromRoot(value) {
    if (!value)
        return undefined;
    const normalized = value.replace(/[\\/]+/g, node_path_1.default.sep);
    return node_path_1.default.isAbsolute(normalized) ? normalized : node_path_1.default.resolve(ROOT, normalized);
}
function isPathInside(rootPath, targetPath) {
    const rel = node_path_1.default.relative(rootPath, targetPath);
    return rel === "" || (!rel.startsWith("..") && !node_path_1.default.isAbsolute(rel));
}
function normalizePathForMatch(value) {
    return value.replace(/\\/g, "/").toLowerCase();
}
function extractSectionSlugFromSpecPath(specPath) {
    const normalized = normalizePathForMatch(specPath);
    const match = normalized.match(/\/sections\/([^/]+)\//);
    return match?.[1];
}
async function loadPromotedEntriesForRouting(appSlug) {
    const entries = [];
    const globalIndex = await (0, automation_index_1.loadAutomationIndex)();
    entries.push(...globalIndex.automations);
    const normalizedApp = nonEmptyString(appSlug);
    if (!normalizedApp)
        return entries;
    const appIndexPath = node_path_1.default.join("automations", "apps", normalizedApp, "index.json");
    const appIndex = await (0, automation_index_1.loadAutomationIndex)(appIndexPath);
    entries.push(...appIndex.automations);
    return entries;
}
function selectCandidateEntryForCase(caseId, entries, appSlug) {
    const normalizedApp = nonEmptyString(appSlug) ? normalizeAppSlug(appSlug) : undefined;
    const candidates = entries.filter((entry) => entry.caseId === caseId);
    if (candidates.length === 0)
        return undefined;
    if (!normalizedApp)
        return candidates[0];
    const ownedCandidates = candidates.filter((entry) => normalizeAppSlug(entry.appSlug ?? entry.appProfile) === normalizedApp);
    if (ownedCandidates.length === 0)
        return undefined;
    const uniqueCandidates = new Map();
    for (const entry of ownedCandidates) {
        const identity = `${entry.id.trim()}\u0000${normalizeAppSlug(entry.appSlug ?? entry.appProfile)}`;
        if (!uniqueCandidates.has(identity))
            uniqueCandidates.set(identity, entry);
    }
    return uniqueCandidates.size === 1 ? Array.from(uniqueCandidates.values())[0] : undefined;
}
function validatePromotedEntryForExecution(input) {
    const entry = input.entry;
    if (!entry) {
        return { reusable: false, blocked: false, reason: "no_promoted_entry" };
    }
    if (entry.caseId !== input.caseId) {
        return { reusable: false, blocked: false, reason: "case_id_mismatch" };
    }
    const normalizedApp = nonEmptyString(input.appSlug) ? normalizeAppSlug(input.appSlug) : undefined;
    const entryApp = normalizeAppSlug(entry.appSlug ?? entry.appProfile);
    if (normalizedApp && entryApp !== normalizedApp) {
        return { reusable: false, blocked: false, reason: "app_slug_mismatch" };
    }
    if (BLOCKED_PROMOTED_STATUSES.has(entry.status)) {
        return { reusable: false, blocked: true, reason: `blocked_status_${entry.status}` };
    }
    if (!REUSABLE_PROMOTED_STATUSES.has(entry.status)) {
        return { reusable: false, blocked: false, reason: `status_${entry.status}` };
    }
    if (entry.specVerificationStatus === "failed") {
        return { reusable: false, blocked: false, reason: "spec_verification_failed" };
    }
    const specPath = toAbsoluteFromRoot(entry.specPath);
    const planPath = toAbsoluteFromRoot(entry.planPath);
    const fileExists = input.fileExists ?? node_fs_1.default.existsSync;
    if (!specPath || !fileExists(specPath)) {
        return { reusable: false, blocked: false, reason: "missing_spec_file" };
    }
    if (!planPath || !fileExists(planPath)) {
        return { reusable: false, blocked: false, reason: "missing_plan_file" };
    }
    const appRoot = normalizedApp ? node_path_1.default.join(APPS_ROOT, normalizedApp) : undefined;
    if (appRoot && !isPathInside(appRoot, specPath)) {
        return { reusable: false, blocked: false, reason: "spec_outside_app_scope" };
    }
    const expectedSection = nonEmptyString(input.sectionSlug) ? normalizeSectionSlug(input.sectionSlug) : undefined;
    if (expectedSection) {
        const discoveredSection = extractSectionSlugFromSpecPath(specPath);
        if (discoveredSection && discoveredSection !== expectedSection) {
            return { reusable: false, blocked: false, reason: "section_slug_mismatch" };
        }
    }
    const normalizedSpecPath = normalizePathForMatch(specPath);
    const caseMatch = normalizedSpecPath.match(/\/cases\/c(\d+)(?:[-/])[^/]*\/case\.spec\.ts$/)
        ?? normalizedSpecPath.match(/\/cases\/c(\d+)\/case\.spec\.ts$/);
    if (!caseMatch || Number(caseMatch[1]) !== input.caseId) {
        return { reusable: false, blocked: false, reason: "spec_not_in_case_tree" };
    }
    const appConfigPath = toAbsoluteFromRoot(entry.appConfigPath);
    if (appConfigPath && !fileExists(appConfigPath)) {
        return { reusable: false, blocked: false, reason: "missing_app_config" };
    }
    const bootstrap = validatePromotedBootstrapContract({ caseId: input.caseId, specPath, planPath });
    console.log(`[promoted-bootstrap] caseId=${input.caseId} initialNavigationDeclared=${bootstrap.initialNavigationDeclared} currentUrl=not_started bootstrapContractValid=${bootstrap.valid}`);
    if (!bootstrap.valid) {
        return { reusable: false, blocked: false, reason: "stale_promoted_spec_bootstrap" };
    }
    return { reusable: true, blocked: false, reason: "promoted_spec_valid", specPath };
}
function validatePromotedBootstrapContract(input) {
    try {
        const plan = JSON.parse(node_fs_1.default.readFileSync(input.planPath, "utf-8"));
        const initialNavigationDeclared = (plan.steps ?? []).some((step) => step.action === "navigate");
        if (!initialNavigationDeclared)
            return { valid: true, initialNavigationDeclared: false };
        const spec = node_fs_1.default.readFileSync(input.specPath, "utf-8");
        const valid = /createPromotedSpecRuntime\s*\(/.test(spec)
            && /process\.env\.APP_BASE_URL/.test(spec)
            && /page\.goto\s*\(/.test(spec)
            && /createPromotedSpecRuntime[\s\S]*?try\s*\{/.test(spec);
        return { valid, initialNavigationDeclared: true };
    }
    catch {
        return { valid: false, initialNavigationDeclared: true };
    }
}
function resolvePromotedSpecTargetFromEntries(input) {
    const entry = selectCandidateEntryForCase(input.caseId, input.entries, input.appSlug);
    const structuralValidation = validatePromotedEntryForExecution({ ...input, entry });
    if (!structuralValidation.reusable || !entry || !structuralValidation.specPath) {
        return structuralValidation;
    }
    let specText;
    try {
        specText = node_fs_1.default.readFileSync(structuralValidation.specPath, "utf8");
    }
    catch {
        return { reusable: false, blocked: false, reason: "missing_spec_file" };
    }
    const sectionSlug = nonEmptyString(input.sectionSlug)
        ?? extractSectionSlugFromSpecPath(structuralValidation.specPath)
        ?? "";
    const integrity = (0, automation_reuse_1.validatePromotedArtifactForReuse)(entry, {
        specPath: structuralValidation.specPath,
        specExists: true,
        specText,
        appSlug: input.appSlug ?? entry.appSlug ?? entry.appProfile ?? "",
        sectionSlug,
        caseId: input.caseId,
    });
    if (!integrity.valid) {
        return {
            reusable: false,
            blocked: false,
            reason: integrity.reason ?? "promoted_artifact_invalid",
        };
    }
    if (specUsesPromotedPom(specText) && entry.pomStatus !== "promoted") {
        return { reusable: false, blocked: false, reason: "pom_not_promoted" };
    }
    return { reusable: true, blocked: false, reason: "promoted_spec_valid", specPath: structuralValidation.specPath };
}
function specUsesPromotedPom(specText) {
    const imports = specText.match(/(?:from\s*["']|import\s*["']|require\(\s*["'])([^"']+)["']/g) ?? [];
    return imports.some((statement) => {
        const modulePath = statement.replace(/^.*?["']|["'].*$/g, "").replace(/\\/g, "/").toLowerCase();
        return /(?:^|\/)(?:pages|components)\//.test(modulePath)
            || /(?:^|\/)[^/]+\.(?:page|component)(?:\.[cm]?[jt]s)?$/.test(modulePath);
    });
}
async function resolvePromotedSpecForExecution(input) {
    const entries = await loadPromotedEntriesForRouting(input.appSlug);
    const candidate = selectCandidateEntryForCase(input.caseId, entries, input.appSlug);
    const validation = resolvePromotedSpecTargetFromEntries({ ...input, entries });
    console.log(`[promoted-spec-resolution] caseId=${input.caseId} appSlug=${input.appSlug ?? ""} sectionSlug=${input.sectionSlug ?? ""} ` +
        `entryFound=${candidate ? "true" : "false"} specPath=${validation.specPath ?? "none"} valid=${validation.reusable ? "true" : "false"} reason=${validation.reason}`);
    return validation;
}
function isPersistedDiscoveryPromotionSuccessful(input) {
    return input.discoveredState === "promoted" && input.reusable;
}
function resolvePostDiscoveryExecutionAdmission(input) {
    if (input.contextOnly === true) {
        const admitted = input.childStatus === "discovered_passed" && input.contextMaterialized === true;
        return {
            admitted,
            reason: admitted
                ? "context_materialized"
                : input.childStatus !== "discovered_passed"
                    ? `child_status_${input.childStatus ?? "unknown"}`
                    : "context_materialization_missing",
        };
    }
    const validation = resolvePromotedSpecTargetFromEntries(input);
    const admitted = input.childStatus === "promoted"
        && input.promotionPersisted
        && validation.reusable
        && Boolean(validation.specPath);
    const reason = admitted
        ? "promoted_spec_valid_after_full_discovery"
        : input.childStatus !== "promoted"
            ? `child_status_${input.childStatus ?? "unknown"}`
            : !input.promotionPersisted
                ? "promotion_not_persisted"
                : validation.reason;
    return { admitted, reason, specPath: admitted ? validation.specPath : undefined };
}
function resolveRouteFromValidation(input) {
    const rediscoveryIntent = input.rediscoveryIntent ?? input.forceRediscovery;
    if (rediscoveryIntent) {
        return {
            caseId: input.caseId,
            appSlug: input.appSlug,
            route: "full_discovery",
            reason: "explicit_rediscovery_requested",
            specPath: input.validation.specPath,
        };
    }
    if (input.validation.reusable) {
        return {
            caseId: input.caseId,
            appSlug: input.appSlug,
            route: "promoted_reuse",
            reason: input.validation.reason,
            specPath: input.validation.specPath,
        };
    }
    if (input.validation.blocked) {
        return {
            caseId: input.caseId,
            appSlug: input.appSlug,
            route: "blocked",
            reason: input.validation.reason,
            specPath: input.validation.specPath,
        };
    }
    if (input.contractEvaluation) {
        const recommendedRoute = input.contractEvaluation.recommendedRoute;
        if (recommendedRoute === "targeted_discovery" && input.targetedDiscoverySupported !== true) {
            return {
                caseId: input.caseId,
                appSlug: input.appSlug,
                route: "full_discovery",
                reason: "targeted_discovery_not_supported",
                specPath: input.validation.specPath,
            };
        }
        return {
            caseId: input.caseId,
            appSlug: input.appSlug,
            route: recommendedRoute,
            reason: input.contractEvaluation.reasonCode,
            specPath: input.validation.specPath,
        };
    }
    return {
        caseId: input.caseId,
        appSlug: input.appSlug,
        route: "full_discovery",
        reason: input.validation.reason,
        specPath: input.validation.specPath,
    };
}
function hasConfiguredRouteProfile(appConfig) {
    if (!appConfig)
        return false;
    const profile = appConfig.routeProfile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile))
        return false;
    const asRecord = profile;
    const entry = Array.isArray(asRecord.entry) ? asRecord.entry : [];
    const entrySteps = Array.isArray(asRecord.entrySteps) ? asRecord.entrySteps : [];
    const aliases = asRecord.aliases && typeof asRecord.aliases === "object"
        ? Object.keys(asRecord.aliases)
        : [];
    const domainTerms = asRecord.domainTerms && typeof asRecord.domainTerms === "object"
        ? Object.keys(asRecord.domainTerms)
        : [];
    return entry.length > 0 || entrySteps.length > 0 || aliases.length > 0 || domainTerms.length > 0;
}
const TARGETED_DISCOVERY_SUPPORTED = false;
function supportsTargetedDiscoveryPreview() {
    return TARGETED_DISCOVERY_SUPPORTED;
}
function resolveRediscoveryIntent(input) {
    const overwrite = input.overwrite === true;
    const rerunIntent = input.rerunActive === true;
    const rediscoveryIntent = input.forceRediscovery === true;
    const source = rediscoveryIntent
        ? "user_request"
        : (overwrite || rerunIntent)
            ? (input.executePromotedSpecs === true ? "legacy_default" : "job_default")
            : "none";
    return {
        explicit: rediscoveryIntent,
        rerunIntent,
        rediscoveryIntent,
        source,
        overwrite,
        rerunActive: rerunIntent,
    };
}
function buildDiscoveryPreviewArgs(input) {
    const args = [
        "run",
        "discovery:preview",
        "--",
        "--input",
        input.previewPath,
        "--app",
        input.appSlug,
    ];
    if (input.routeProfile)
        args.push("--route-profile-json", JSON.stringify(input.routeProfile));
    if (input.autoPromote !== false)
        args.push("--auto-promote");
    if (input.autoPom !== false)
        args.push("--auto-pom");
    if (input.headed === true)
        args.push("--headed");
    if (input.deferEvidenceConsolidation === true)
        args.push("--defer-evidence-consolidation");
    return args;
}
function computeFunctionalExecutionSnapshot(input) {
    const requested = Math.max(0, Math.floor(input.requested));
    const completed = Math.max(0, Math.floor(input.completed));
    const executed = Math.max(0, Math.floor(input.executed));
    const passed = Math.max(0, Math.floor(input.passed));
    const failed = Math.max(0, Math.floor(input.failed));
    const skipped = Math.max(0, Math.floor(input.skipped));
    const processed = passed + failed;
    const progressPercent = requested > 0
        ? roundToTwoDecimals((completed / requested) * 100)
        : 0;
    const passRate = processed > 0
        ? roundToTwoDecimals((passed / processed) * 100)
        : null;
    return {
        requested,
        completed,
        executed,
        passed,
        failed,
        skipped,
        progressPercent,
        passRate,
    };
}
function parseEvidenceInitializationResult(lines) {
    const initialized = lines.some((line) => /\[evidence\]\s+initialized\b/i.test(line));
    if (initialized) {
        return { initialized: true, reason: "none" };
    }
    const initFailed = lines.find((line) => /\[evidence\]\s+init failed:/i.test(line));
    if (initFailed && /outside a module|failed to load the es module/i.test(initFailed)) {
        return { initialized: false, reason: "esm_cjs_boundary_violation" };
    }
    if (lines.some((line) => /Failed to load the ES module/i.test(line))) {
        return { initialized: false, reason: "esm_cjs_boundary_violation" };
    }
    if (initFailed) {
        return { initialized: false, reason: "evidence_initialization_failed" };
    }
    if (lines.some((line) => /\[evidence\]\s+disabled\b/i.test(line))) {
        return { initialized: false, reason: "evidence_disabled" };
    }
    return { initialized: false, reason: "evidence_initialization_unknown" };
}
function resolvePublishedCaseSourceGroup(entry) {
    if (!entry)
        return "testrail_case";
    const explicitSource = entry.sourceType;
    if (explicitSource === "jira_preview" || explicitSource === "testrail_case") {
        return explicitSource;
    }
    const hasPreviewOrigin = Boolean(nonEmptyString(entry.executionScenarioId)
        || nonEmptyString(entry.launchScenarioId)
        || nonEmptyString(entry.sourceIssueKey));
    return hasPreviewOrigin ? "jira_preview" : "testrail_case";
}
function buildMixedExecutionPlan(params) {
    const sourceByCaseId = new Map();
    for (const entry of params.publishedCases ?? []) {
        if (!isPositiveCaseId(entry.caseId))
            continue;
        if (!sourceByCaseId.has(entry.caseId)) {
            sourceByCaseId.set(entry.caseId, entry);
        }
    }
    const seen = new Set();
    const planned = [];
    const appendCase = (caseId) => {
        if (!isPositiveCaseId(caseId) || seen.has(caseId))
            return;
        seen.add(caseId);
        planned.push({
            caseId,
            sourceGroup: resolvePublishedCaseSourceGroup(sourceByCaseId.get(caseId)),
            originalIndex: planned.length,
        });
    };
    for (const caseId of params.caseIds ?? []) {
        appendCase(caseId);
    }
    for (const entry of params.publishedCases ?? []) {
        appendCase(entry.caseId);
    }
    const jiraPreviewCases = planned.filter((entry) => entry.sourceGroup === "jira_preview");
    const testRailCases = planned.filter((entry) => entry.sourceGroup === "testrail_case");
    const mode = jiraPreviewCases.length > 0 && testRailCases.length > 0
        ? "mixed"
        : jiraPreviewCases.length > 0
            ? "jira_only"
            : "testrail_only";
    return {
        mode,
        jiraPreviewCases,
        testRailCases,
        orderedCases: [...jiraPreviewCases, ...testRailCases],
    };
}
function buildCaseSchedule(plan) {
    let jiraIndex = 0;
    let trIndex = 0;
    return plan.orderedCases.map((entry, index) => {
        const groupIndex = entry.sourceGroup === "jira_preview"
            ? (jiraIndex += 1)
            : (trIndex += 1);
        return {
            ...entry,
            groupIndex,
            overallIndex: index + 1,
        };
    });
}
function buildDiscoveryBatchArgs(params, caseIds) {
    const runnerInputContextOnly = params.contextOnly;
    console.log(`[context-only-trace] boundary=runner inputValue=${runnerInputContextOnly === undefined ? "undefined" : runnerInputContextOnly}`);
    const caseIdsStr = caseIds.join(",");
    const args = [
        "run",
        "discovery:batch",
        "--",
        "--case-ids",
        caseIdsStr,
    ];
    if (params.appSlug)
        args.push("--app", params.appSlug);
    if (params.contextOnly === true)
        args.push("--context-only");
    if (params.overwrite === true)
        args.push("--overwrite");
    if (params.autoPromote !== false)
        args.push("--auto-promote");
    if (params.autoPom !== false)
        args.push("--auto-pom");
    if (params.rerunActive === true)
        args.push("--rerun-active");
    console.log(`[context-only-trace] boundary=runner argsContainContextOnly=${args.includes("--context-only")}`);
    if (params.headed)
        args.push("--headed");
    if (params.testRailProjectId !== undefined)
        args.push("--testrail-project-id", String(params.testRailProjectId));
    if (params.testRailSuiteId !== undefined)
        args.push("--testrail-suite-id", String(params.testRailSuiteId));
    if (params.testRailSectionId !== undefined)
        args.push("--testrail-section-id", String(params.testRailSectionId));
    return args;
}
function positiveManifestId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : undefined;
}
function loadLaunchTestRailIdentity(params) {
    if (!params.launchId)
        return params;
    try {
        const manifestPath = node_path_1.default.join(ROOT, ".artifacts", "scenario-launch-runs", params.launchId, "launch-manifest.json");
        const manifest = JSON.parse(node_fs_1.default.readFileSync(manifestPath, "utf-8"));
        const testRail = manifest.testRail ?? {};
        return {
            ...params,
            testRailProjectId: params.testRailProjectId ?? positiveManifestId(testRail.projectId),
            testRailSuiteId: params.testRailSuiteId ?? positiveManifestId(testRail.suiteId),
            testRailSectionId: params.testRailSectionId ?? positiveManifestId(testRail.sectionId),
        };
    }
    catch {
        return params;
    }
}
function buildContractPreviewArtifactPath(jobId, caseId) {
    return node_path_1.default.join(ROOT, ".artifacts", "tmp", "case-contract-preview", jobId, `c${caseId}`, "preview-scenarios.json");
}
function buildContractPreviewEnv(params, jobId) {
    const resolvedAppSlug = nonEmptyString(params.appSlug);
    const resolvedSectionSlug = nonEmptyString(params.sectionSlug);
    const resolvedSectionName = nonEmptyString(params.sectionName);
    return {
        ...process.env,
        EVIDENCE_RUN_ID: jobId,
        ...(resolvedAppSlug ? { APP_SLUG: resolvedAppSlug } : {}),
        ...(resolvedSectionSlug ? { SECTION_SLUG: resolvedSectionSlug } : {}),
        ...(resolvedSectionName ? { SECTION_NAME: resolvedSectionName } : {}),
        ...(resolvedAppSlug ? { EVIDENCE_APP_SLUG: resolvedAppSlug } : {}),
        ...(resolvedSectionSlug ? { EVIDENCE_SECTION_SLUG: resolvedSectionSlug } : {}),
    };
}
function buildTestPromotedArgs(params, caseId) {
    const args = [
        "run",
        "test:promoted",
        "--",
        "--case-id",
        String(caseId),
        "--workers",
        "1",
    ];
    if (params.appSlug)
        args.push("--app", params.appSlug);
    if (params.sectionSlug)
        args.push("--section", params.sectionSlug);
    if (params.headed)
        args.push("--headed");
    return args;
}
function buildPromotedExecutionEnv(params, jobId, baseEnv = process.env, runtimeContextPath) {
    const resolvedAppSlug = nonEmptyString(params.appSlug);
    const resolvedSectionSlug = nonEmptyString(params.sectionSlug);
    const resolvedSectionName = nonEmptyString(params.sectionName);
    const forceHeadlessForAutomation = params.headed !== true;
    return {
        ...baseEnv,
        EVIDENCE_RUN_ID: jobId,
        ...(resolvedAppSlug ? { APP_SLUG: resolvedAppSlug } : {}),
        ...(resolvedSectionSlug ? { SECTION_SLUG: resolvedSectionSlug } : {}),
        ...(resolvedSectionName ? { SECTION_NAME: resolvedSectionName } : {}),
        ...(resolvedAppSlug ? { EVIDENCE_APP_SLUG: resolvedAppSlug } : {}),
        ...(resolvedSectionSlug ? { EVIDENCE_SECTION_SLUG: resolvedSectionSlug } : {}),
        ...(runtimeContextPath ? { DISCOVERY_RUNTIME_CONTEXT: runtimeContextPath } : {}),
        ...(forceHeadlessForAutomation
            ? {
                AUTOMATION_HEADLESS: "true",
                AUTOMATION_SOURCE: "qa_lab_automatic",
            }
            : {}),
    };
}
function log(jobId, line) {
    job_store_1.jobStore.appendLog(jobId, line);
}
function buildRuntimeContextPath(jobId, runtimeDir = DISCOVERY_RUNTIME_TMP_DIR) {
    return node_path_1.default.join(runtimeDir, `${jobId}.json`);
}
const AUTH_RUNTIME_KEYS = new Set([
    "auth.company_identifier",
    "auth.identification_number",
    "auth.identification_type",
    "auth.username",
    "auth.password",
    "auth.otp",
    "auth.pin",
    "auth.token",
    "identificationnumber",
    "identificationtype",
    "username",
    "password",
    "otp",
    "pin",
    "token",
    "identity_provider",
    "app_username",
    "app_password",
    "otp_secret",
]);
function normalizeRuntimeKey(key) {
    return key
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}
/** Translate the UI's user-entered runtime marker into internal authority markers. */
function normalizeRuntimeEntry(entry) {
    if (entry.source !== "manual_runtime")
        return entry;
    const source = AUTH_RUNTIME_KEYS.has(normalizeRuntimeKey(entry.key))
        ? "user_provided_qa_credentials"
        : "explicit_runtime_input";
    return { ...entry, source };
}
function normalizeRuntimeEntriesByCase(entriesByCase) {
    return Object.fromEntries(Object.entries(entriesByCase).map(([caseId, entries]) => [
        caseId,
        Array.isArray(entries) ? entries.map(normalizeRuntimeEntry) : [],
    ]));
}
function buildBatchResultPath(jobId) {
    return node_path_1.default.join(ROOT, ".artifacts", "tmp", "discovery-batch-results", `${jobId}.json`);
}
function writeRuntimeContextIfPresent(jobId, params, runtimeDir = DISCOVERY_RUNTIME_TMP_DIR) {
    const byCase = params.runtimeEntriesByCase;
    if (!byCase || typeof byCase !== "object" || Array.isArray(byCase))
        return undefined;
    const entries = normalizeRuntimeEntriesByCase(byCase);
    const hasAny = Object.values(entries).some((list) => Array.isArray(list) && list.length > 0);
    if (!hasAny)
        return undefined;
    const targetPath = buildRuntimeContextPath(jobId, runtimeDir);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(targetPath), { recursive: true });
    // A job id is the runtime-context identity. Invalidate any residue before
    // materializing the new case-scoped values, even if a previous attempt left
    // a file behind after an interrupted process.
    try {
        node_fs_1.default.unlinkSync(targetPath);
    }
    catch (error) {
        if (error?.code !== "ENOENT")
            throw error;
    }
    node_fs_1.default.writeFileSync(targetPath, JSON.stringify(entries), { encoding: "utf-8", mode: 0o600 });
    try {
        node_fs_1.default.chmodSync(targetPath, 0o600);
    }
    catch {
        // Windows ACLs do not always expose POSIX chmod semantics. The file is
        // still created in the caller-owned temporary directory and removed in
        // the runner's finally block.
    }
    return targetPath;
}
function logRuntimeInputAuthority(jobId, params) {
    const byCase = params.runtimeEntriesByCase;
    const entries = byCase && typeof byCase === "object" && !Array.isArray(byCase)
        ? Object.values(normalizeRuntimeEntriesByCase(byCase)).flatMap((value) => Array.isArray(value) ? value : [])
        : [];
    const credentials = entries.filter((entry) => Boolean(entry && typeof entry === "object"
        && typeof entry.key === "string"
        && typeof entry.value === "string"
        && entry.source === "user_provided_qa_credentials"
        && entry.value.trim()));
    const explicit = entries.filter((entry) => Boolean(entry && typeof entry === "object"
        && typeof entry.key === "string"
        && typeof entry.value === "string"
        && entry.source === "explicit_runtime_input"
        && entry.value.trim()));
    if (credentials.length > 0) {
        log(jobId, "runtimeInputAuthority=user_provided_qa_credentials fallbackUsed=false autoGenerated=false demoDataUsed=false staleContextUsed=false");
    }
    for (const entry of credentials) {
        log(jobId, `key=${entry.key} source=user_provided_qa_credentials present=true`);
    }
    for (const entry of explicit) {
        log(jobId, `runtimeInputKey=${entry.key} source=explicit_runtime_input present=true fallbackUsed=false autoGenerated=false`);
    }
}
async function deleteRuntimeContextIfExists(jobId, runtimeDir = DISCOVERY_RUNTIME_TMP_DIR) {
    const targetPath = buildRuntimeContextPath(jobId, runtimeDir);
    try {
        await node_fs_1.default.promises.unlink(targetPath);
    }
    catch (err) {
        if (err?.code !== "ENOENT")
            throw err;
    }
}
function buildDiscoveryChildEnv(base, runtimeContextPath, batchResultPath) {
    if (!runtimeContextPath && !batchResultPath)
        return base;
    return {
        ...base,
        ...(runtimeContextPath ? { DISCOVERY_RUNTIME_CONTEXT: runtimeContextPath } : {}),
        ...(batchResultPath ? { DISCOVERY_BATCH_RESULT_PATH: batchResultPath } : {}),
    };
}
async function readStructuredChildResult(resultPath, caseId) {
    try {
        const parsed = JSON.parse(await node_fs_1.default.promises.readFile(resultPath, "utf8"));
        const entry = parsed.cases?.find((candidate) => candidate.caseId === caseId);
        return entry ? { status: entry.status, contextMaterialized: entry.contextMaterialized === true } : undefined;
    }
    catch {
        return undefined;
    }
}
async function runCommand(jobId, cmd, args, env, onLine) {
    const lines = [];
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(cmd, args, {
            shell: true,
            cwd: ROOT,
            env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        job_store_1.jobStore.update(jobId, { process: child });
        const attachStream = (stream) => {
            if (!stream)
                return;
            let pending = "";
            stream.on("data", (chunk) => {
                pending += chunk.toString();
                const segments = pending.split(/\r?\n/);
                pending = segments.pop() ?? "";
                for (const segment of segments) {
                    const line = segment.trimEnd();
                    if (!line.trim())
                        continue;
                    lines.push(line);
                    log(jobId, line);
                    onLine?.(line);
                }
            });
            stream.on("end", () => {
                const line = pending.trimEnd();
                if (!line.trim())
                    return;
                lines.push(line);
                log(jobId, line);
                onLine?.(line);
            });
        };
        attachStream(child.stdout);
        attachStream(child.stderr);
        child.on("error", (err) => {
            job_store_1.jobStore.update(jobId, { process: undefined });
            reject(err);
        });
        child.on("close", (code) => {
            job_store_1.jobStore.update(jobId, { process: undefined });
            resolve({ exitCode: typeof code === "number" ? code : 1, lines });
        });
    });
}
function listEvidenceJsonFiles(dir) {
    if (!node_fs_1.default.existsSync(dir))
        return [];
    const files = [];
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current)
            continue;
        let entries;
        try {
            entries = node_fs_1.default.readdirSync(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const full = node_path_1.default.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (entry.name === "evidence.json")
                files.push(full);
        }
    }
    return files;
}
function collectPromotedCaseIds(caseIds, appSlug) {
    const targets = new Set(caseIds);
    const found = new Set();
    if (targets.size === 0 || !node_fs_1.default.existsSync(APPS_ROOT))
        return found;
    const roots = appSlug
        ? [node_path_1.default.join(APPS_ROOT, appSlug)]
        : node_fs_1.default.readdirSync(APPS_ROOT, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => node_path_1.default.join(APPS_ROOT, entry.name));
    for (const root of roots) {
        if (!node_fs_1.default.existsSync(root))
            continue;
        const stack = [root];
        while (stack.length > 0 && found.size < targets.size) {
            const current = stack.pop();
            if (!current)
                continue;
            let entries;
            try {
                entries = node_fs_1.default.readdirSync(current, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".artifacts")
                    continue;
                const full = node_path_1.default.join(current, entry.name);
                const prefixedMatch = /^c(\d+)(?:$|-)/i.exec(entry.name);
                const numericMatch = /^(\d+)$/.exec(entry.name);
                const matchedId = Number(prefixedMatch?.[1] ?? numericMatch?.[1] ?? 0);
                if (targets.has(matchedId)) {
                    const hasSpec = node_fs_1.default.existsSync(node_path_1.default.join(full, "case.spec.ts")) || node_fs_1.default.existsSync(node_path_1.default.join(full, "spec.ts"));
                    if (hasSpec)
                        found.add(matchedId);
                }
                stack.push(full);
            }
        }
    }
    return found;
}
function publishedEntryByCaseId(caseId, publishedCases) {
    return (publishedCases ?? []).find((entry) => entry.caseId === caseId);
}
function readCaseEvidenceFailureSnapshot(input) {
    const safeAppSlug = (input.appSlug ?? "").trim() || "default";
    const safeSectionSlug = normalizeSectionSlug(input.sectionSlug);
    const runPaths = (0, evidence_paths_1.buildEvidenceRunPaths)({
        appSlug: safeAppSlug,
        sectionSlug: safeSectionSlug,
        sectionName: input.sectionName,
        runId: input.runId,
    });
    const candidateEvidencePath = node_path_1.default.join(runPaths.scenariosDir, `C${input.caseId}`, "evidence.json");
    if (!node_fs_1.default.existsSync(candidateEvidencePath))
        return undefined;
    try {
        const raw = node_fs_1.default.readFileSync(candidateEvidencePath, "utf-8");
        const parsed = JSON.parse(raw);
        const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
        const failedStep = steps.find((step) => String(step.status ?? "").toLowerCase() === "failed");
        const failedAtStep = typeof failedStep?.stepIndex === "number" ? failedStep.stepIndex : undefined;
        const failedTarget = nonEmptyString(failedStep?.target);
        const errorMessage = nonEmptyString(failedStep?.errorMessage);
        const screenshotPath = nonEmptyString(failedStep?.screenshotPath) ?? nonEmptyString(failedStep?.evidencePath);
        const successfulSteps = steps
            .filter((step) => String(step.status ?? "").toLowerCase() === "passed" && typeof step.stepIndex === "number")
            .sort((a, b) => Number(a.stepIndex ?? 0) - Number(b.stepIndex ?? 0));
        const lastSuccessful = successfulSteps[successfulSteps.length - 1];
        return {
            scenarioId: nonEmptyString(parsed.scenarioId),
            scenarioTitle: nonEmptyString(parsed.scenarioTitle),
            failedAtStep,
            failedTarget,
            errorMessage,
            screenshotPath,
            evidenceJsonPath: candidateEvidencePath,
            lastSuccessfulStep: lastSuccessful && typeof lastSuccessful.stepIndex === "number"
                ? {
                    stepIndex: lastSuccessful.stepIndex,
                    action: nonEmptyString(lastSuccessful.action),
                    target: nonEmptyString(lastSuccessful.target),
                    evidencePath: nonEmptyString(lastSuccessful.evidencePath) ?? nonEmptyString(lastSuccessful.screenshotPath),
                }
                : undefined,
        };
    }
    catch (err) {
        console.warn(`[defect-checklist] unable to parse evidence snapshot runId=${input.runId} caseId=${input.caseId} error=${err?.message ?? String(err)}`);
        return undefined;
    }
}
function countDefectsForJob(list, jobId) {
    return list.defects.filter((defect) => defect.jobId === jobId).length;
}
function parseNumericCaseId(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0)
        return value;
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    const normalized = trimmed.startsWith("C") ? trimmed.slice(1) : trimmed;
    const parsed = Number(normalized);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
function upsertChecklistDefect(input) {
    const now = new Date().toISOString();
    const dedupeKey = buildDiscoveryBatchDefectDedupeKey({
        jobId: input.jobId,
        caseId: input.caseId,
        scenarioId: input.scenarioId,
    });
    const severity = (0, defect_content_builder_1.inferDefectSeverity)(input.failureReasonText, input.scenarioId, input.scenarioTitle);
    const description = (0, defect_content_builder_1.buildStructuredDefectDescription)({
        scenarioId: input.scenarioId,
        scenarioTitle: input.scenarioTitle,
        failureReason: input.failureReasonText,
        technicalContext: input.technicalContext,
        jobId: input.jobId,
    });
    const title = (0, defect_content_builder_1.buildDefectTitle)({
        scenarioId: input.scenarioId,
        scenarioTitle: input.scenarioTitle,
        severity: severity.severity,
        technicalContext: input.technicalContext,
        failureReason: input.failureReasonText,
        expectedResult: input.expectedResult,
    });
    const existing = input.list.defects.find((defect) => {
        const context = defect.technicalContext;
        if (context?.dedupeKey === dedupeKey)
            return true;
        const existingCaseId = parseNumericCaseId(context?.testRailCaseId ?? context?.caseId);
        return defect.jobId === input.jobId && existingCaseId === input.caseId;
    });
    if (existing) {
        existing.jobId = input.jobId;
        existing.scenarioId = input.scenarioId;
        existing.scenarioTitle = input.scenarioTitle;
        existing.description = description;
        existing.severity = severity.severity;
        existing.severityReason = severity.severityReason;
        existing.title = title;
        existing.evidenceUrl = input.evidencePath;
        existing.technicalContext = input.technicalContext;
        existing.updatedAt = now;
        input.list.updatedAt = now;
        defect_checklist_store_1.defectChecklistStore.persist();
        return {
            action: "updated",
            defectCount: countDefectsForJob(input.list, input.jobId),
            dedupeKey,
        };
    }
    defect_checklist_store_1.defectChecklistStore.addDefect(input.checklistIdentity, {
        description,
        severity: severity.severity,
        severityReason: severity.severityReason,
        jobId: input.jobId,
        scenarioId: input.scenarioId,
        scenarioTitle: input.scenarioTitle,
        title,
        evidenceUrl: input.evidencePath,
        technicalContext: input.technicalContext,
    });
    const refreshed = defect_checklist_store_1.defectChecklistStore.get(input.checklistIdentity) ?? input.list;
    return {
        action: "created",
        defectCount: countDefectsForJob(refreshed, input.jobId),
        dedupeKey,
    };
}
async function consolidateRunEvidenceForExecution(runId, appSlug, sectionSlug, sectionName) {
    const safeAppSlug = (appSlug ?? "").trim() || "default";
    const safeSectionSlug = normalizeSectionSlug(sectionSlug);
    const paths = (0, evidence_paths_1.buildEvidenceRunPaths)({
        appSlug: safeAppSlug,
        sectionSlug: safeSectionSlug,
        sectionName,
        runId,
    });
    const evidenceFiles = listEvidenceJsonFiles(paths.scenariosDir);
    if (evidenceFiles.length === 0) {
        return {
            attempted: true,
            generated: false,
            documentPathPresent: false,
            scenarioEvidenceCount: 0,
            error: "no_scenario_evidence_found",
        };
    }
    try {
        const recorder = new run_evidence_recorder_1.RunEvidenceRecorder({
            appSlug: safeAppSlug,
            sectionSlug: safeSectionSlug,
            sectionName,
            runId,
        });
        await recorder.start();
        for (const evidenceJsonPath of evidenceFiles) {
            await recorder.addScenarioFromFile(evidenceJsonPath);
        }
        await recorder.finish();
        const generated = node_fs_1.default.existsSync(paths.docxPath);
        return {
            attempted: true,
            generated,
            documentPathPresent: generated,
            ...(generated ? { documentPath: paths.docxPath } : {}),
            scenarioEvidenceCount: evidenceFiles.length,
            ...(generated ? {} : { error: "consolidated_docx_missing" }),
        };
    }
    catch (err) {
        return {
            attempted: true,
            generated: false,
            documentPathPresent: false,
            scenarioEvidenceCount: evidenceFiles.length,
            error: err?.message ?? String(err),
        };
    }
}
function buildDiscoveryBatchExecutionPlan(requestedCaseIds, promotedBefore, promotedAfter) {
    const requested = Array.from(new Set(requestedCaseIds.filter(isPositiveCaseId)));
    const alreadyPromotedCaseIds = requested.filter((id) => promotedBefore.has(id));
    const executableCaseIds = requested.filter((id) => promotedAfter.has(id));
    const notExecutableCaseIds = requested.filter((id) => !promotedAfter.has(id));
    const requiresDiscoveryCaseIds = requested.filter((id) => !promotedBefore.has(id));
    return {
        requestedCaseIds: requested,
        alreadyPromotedCaseIds,
        executableCaseIds,
        notExecutableCaseIds,
        requiresDiscoveryCaseIds,
    };
}
function startLegacyDiscoveryBatchRun(jobId, params, runtimeContextPath) {
    const caseIds = Array.from(new Set((params.caseIds ?? []).filter(isPositiveCaseId)));
    if (caseIds.length === 0) {
        job_store_1.jobStore.update(jobId, {
            status: "failed",
            completedAt: new Date().toISOString(),
        });
        log(jobId, "[run:discovery-batch] Error: no caseIds provided");
        return;
    }
    const caseIdsStr = caseIds.join(",");
    const jobContextOnly = params.contextOnly;
    log(jobId, `[context-only-trace] boundary=job jobHasField=${Object.prototype.hasOwnProperty.call(params, "contextOnly")} jobValue=${jobContextOnly === undefined ? "undefined" : jobContextOnly}`);
    const args = buildDiscoveryBatchArgs(params, caseIds);
    const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const childEnv = buildDiscoveryChildEnv(process.env, runtimeContextPath);
    log(jobId, `[run:discovery-batch] caseIds=${caseIdsStr} appSlug=${params.appSlug ?? "N/A"}`);
    log(jobId, `[run:discovery-batch] command=${cmd} ${args.join(" ")}`);
    log(jobId, `[run:discovery-batch] jobId=${jobId}`);
    if (runtimeContextPath)
        log(jobId, `[run:discovery-batch] runtimeContext=${runtimeContextPath}`);
    log(jobId, "[run:discovery-batch] started");
    job_store_1.jobStore.update(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
        summary: {
            totalStories: 0,
            synced: 0,
            passed: 0,
            failed: 0,
            caseIds,
            command: `${cmd} ${args.join(" ")}`,
        },
    });
    void runCommand(jobId, cmd, args, childEnv)
        .then((result) => {
        job_store_1.jobStore.update(jobId, {
            status: result.exitCode === 0 ? "done" : "failed",
            completedAt: new Date().toISOString(),
            exitCode: result.exitCode,
        });
        log(jobId, `[run:discovery-batch] Proceso terminado — código de salida: ${result.exitCode}`);
    })
        .catch((err) => {
        job_store_1.jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString() });
        log(jobId, `[run:discovery-batch] Error al iniciar proceso: ${err.message}`);
    })
        .finally(async () => {
        await deleteRuntimeContextIfExists(jobId);
        job_store_1.jobStore.clearTransientParams(jobId);
    });
}
async function startDiscoveryBatchExecutionFlow(jobId, params, runtimeContextPath) {
    log(jobId, buildRediscoveryProvenanceLine({
        boundary: "runner_input",
        jobId,
        value: params.forceRediscovery,
        valueSource: "params.forceRediscovery",
    }));
    const mixedPlan = buildMixedExecutionPlan({
        caseIds: params.caseIds ?? [],
        publishedCases: params.publishedCases,
    });
    const scheduledCases = buildCaseSchedule(mixedPlan);
    const executionCaseIds = scheduledCases.map((entry) => entry.caseId);
    if (executionCaseIds.length === 0) {
        job_store_1.jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString() });
        log(jobId, "[run:discovery-batch] Error: no caseIds provided");
        return;
    }
    const planOrder = mixedPlan.mode === "mixed"
        ? "jira_preview_then_testrail"
        : mixedPlan.mode === "jira_only"
            ? "jira_only"
            : "testrail_only";
    log(jobId, `[execution-plan] jobId=${jobId} mode=${mixedPlan.mode} jiraPreviewCount=${mixedPlan.jiraPreviewCases.length} testRailCount=${mixedPlan.testRailCases.length} total=${scheduledCases.length} order=${planOrder}`);
    const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const requestedAppSlug = nonEmptyString(params.appSlug);
    const effectiveAppSlug = requestedAppSlug ?? "default";
    const rediscoveryIntent = resolveRediscoveryIntent({
        forceRediscovery: params.forceRediscovery,
        overwrite: params.overwrite,
        rerunActive: params.rerunActive,
        executePromotedSpecs: params.executePromotedSpecs,
    });
    log(jobId, buildRediscoveryProvenanceLine({
        boundary: "intent_input",
        jobId,
        value: params.forceRediscovery,
        valueSource: "params.forceRediscovery",
    }));
    log(jobId, buildRediscoveryProvenanceLine({
        boundary: "intent_output",
        jobId,
        explicit: rediscoveryIntent.explicit,
        source: rediscoveryIntent.source,
    }));
    const forceRediscovery = rediscoveryIntent.explicit;
    const targetedDiscoverySupported = supportsTargetedDiscoveryPreview();
    const routeDecisions = new Map();
    const fullDiscoveryCommandParams = {
        ...params,
        // An explicit rediscovery request must be able to re-run an already active
        // artifact. The legacy flags remain inert unless forceRediscovery is true.
        overwrite: forceRediscovery ? true : rediscoveryIntent.overwrite,
        rerunActive: forceRediscovery ? true : rediscoveryIntent.rerunActive,
    };
    const promotedEntriesBefore = await loadPromotedEntriesForRouting(effectiveAppSlug);
    const appConfig = await (0, scenario_normalizer_1.loadAppConfig)(effectiveAppSlug);
    const routeProfileConfigured = hasConfiguredRouteProfile(appConfig);
    let testRailClient = null;
    let testRailClientError;
    if (!forceRediscovery) {
        try {
            testRailClient = new testrail_client_1.TestRailClient((0, env_1.requireTestRailConfig)(env_1.config));
        }
        catch (err) {
            testRailClientError = err?.message ?? String(err);
        }
    }
    const initialSnapshot = computeFunctionalExecutionSnapshot({
        requested: executionCaseIds.length,
        completed: 0,
        executed: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
    });
    const baseSummary = {
        totalStories: initialSnapshot.requested,
        total: initialSnapshot.requested,
        synced: 0,
        passed: initialSnapshot.passed,
        failed: initialSnapshot.failed,
        completed: initialSnapshot.completed,
        requested: initialSnapshot.requested,
        executed: initialSnapshot.executed,
        skipped: initialSnapshot.skipped,
        progressPercent: initialSnapshot.progressPercent,
        progress: initialSnapshot.progressPercent,
        passRate: initialSnapshot.passRate,
        caseIds: executionCaseIds,
        requestedCases: initialSnapshot.requested,
        executedCases: initialSnapshot.executed,
        notExecutableCases: 0,
        command: `${cmd} run test:promoted -- --workers 1`,
    };
    const checklistIdentity = buildDiscoveryBatchChecklistIdentity({
        jobId,
        launchId: params.launchId,
    });
    const checklistIssueKeyMetadata = resolveDiscoveryBatchIssueKeyMetadata(params);
    const checklistList = defect_checklist_store_1.defectChecklistStore.getOrCreate(checklistIdentity);
    const checklistUrl = `/checklist/${checklistList.urlSlug}?jobId=${encodeURIComponent(jobId)}`;
    const initialDefectCount = countDefectsForJob(checklistList, jobId);
    job_store_1.jobStore.update(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
        summary: baseSummary,
        checklistUrl,
        defectCount: initialDefectCount,
        ...(checklistIssueKeyMetadata ? { issueKey: checklistIssueKeyMetadata } : {}),
    });
    log(jobId, `[defect-checklist] started identity=${checklistIdentity} issueKey=${checklistIssueKeyMetadata ?? "none"} defectCount=${initialDefectCount}`);
    if (params.launchId) {
        (0, testrail_result_sync_1.updateLaunchManifestJobId)(params.launchId, jobId);
    }
    let passed = 0;
    let failed = 0;
    let completed = 0;
    let executed = 0;
    let skipped = 0;
    let nonExecutableFailed = 0;
    let synced = 0;
    let syncFailed = 0;
    let evidenceInitializationFailures = 0;
    const caseResults = [];
    const groupCaseCount = {
        jira_preview: mixedPlan.jiraPreviewCases.length,
        testrail_case: mixedPlan.testRailCases.length,
    };
    const groupStartedAt = new Map();
    const markGroupStart = (sourceGroup) => {
        groupStartedAt.set(sourceGroup, Date.now());
        log(jobId, `[source-group] jobId=${jobId} sourceGroup=${sourceGroup} action=start caseCount=${groupCaseCount[sourceGroup]} durationMs=0 reason=none`);
    };
    const markGroupEnd = (sourceGroup, action, reason) => {
        const startedAt = groupStartedAt.get(sourceGroup);
        const durationMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
        log(jobId, `[source-group] jobId=${jobId} sourceGroup=${sourceGroup} action=${action} caseCount=${groupCaseCount[sourceGroup]} durationMs=${durationMs} reason=${reason}`);
    };
    if (groupCaseCount.jira_preview === 0) {
        markGroupEnd("jira_preview", "skipped", "empty_group");
    }
    if (groupCaseCount.testrail_case === 0) {
        markGroupEnd("testrail_case", "skipped", "empty_group");
    }
    let activeGroup;
    const updateProgressSummary = (caseId) => {
        const snapshot = computeFunctionalExecutionSnapshot({
            requested: executionCaseIds.length,
            completed,
            executed,
            passed,
            failed,
            skipped,
        });
        job_store_1.jobStore.update(jobId, {
            summary: {
                ...(job_store_1.jobStore.get(jobId)?.summary ?? baseSummary),
                completed: snapshot.completed,
                requested: snapshot.requested,
                executed: snapshot.executed,
                passed: snapshot.passed,
                failed: snapshot.failed,
                skipped: snapshot.skipped,
                progressPercent: snapshot.progressPercent,
                progress: snapshot.progressPercent,
                passRate: snapshot.passRate,
                requestedCases: snapshot.requested,
                executedCases: snapshot.executed,
                notExecutableCases: nonExecutableFailed,
                caseResults: [...caseResults],
                evidenceInitializationFailures,
                synced,
                syncFailed,
            },
        });
        log(jobId, `[functional-case-result] jobId=${jobId} caseId=${caseId} completed=${snapshot.completed} requested=${snapshot.requested} executed=${snapshot.executed} passed=${snapshot.passed} failed=${snapshot.failed} skipped=${snapshot.skipped} progressPercent=${snapshot.progressPercent} passRate=${snapshot.passRate ?? "null"}`);
        return snapshot;
    };
    const syncChecklistMetadata = () => {
        const list = defect_checklist_store_1.defectChecklistStore.get(checklistIdentity) ?? checklistList;
        const defectCount = countDefectsForJob(list, jobId);
        job_store_1.jobStore.update(jobId, {
            checklistUrl,
            defectCount,
            ...(checklistIssueKeyMetadata ? { issueKey: checklistIssueKeyMetadata } : {}),
        });
        return defectCount;
    };
    const recordPreFunctionalFailure = async (input) => {
        completed += 1;
        failed += 1;
        nonExecutableFailed += 1;
        caseResults.push({
            caseId: input.caseId,
            status: "failed",
            completedAt: input.completedAt,
            durationMs: input.durationMs,
            reason: input.reasonCode,
            scenarioId: input.scenarioId,
            scenarioTitle: input.scenarioTitle,
            sourceType: input.sourceGroup,
            appSlug: nonEmptyString(params.appSlug),
            sectionSlug: nonEmptyString(params.sectionSlug),
            launchId: nonEmptyString(params.launchId),
            failureReason: input.reasonCode,
            errorMessage: input.errorMessage,
        });
        const checklist = defect_checklist_store_1.defectChecklistStore.getOrCreate(checklistIdentity);
        const upsertResult = upsertChecklistDefect({
            list: checklist,
            checklistIdentity,
            jobId,
            caseId: input.caseId,
            scenarioId: input.scenarioId,
            scenarioTitle: input.scenarioTitle,
            failureReasonText: input.errorMessage,
            technicalContext: {
                dedupeKey: buildDiscoveryBatchDefectDedupeKey({ jobId, caseId: input.caseId, scenarioId: input.scenarioId }),
                reasonCode: input.reasonCode,
                discoveryStatus: "failed",
                rawError: input.errorMessage,
                testRailCaseId: input.caseId,
                testRailRunId: params.testRunId,
                caseId: input.caseId,
                scenarioId: input.scenarioId,
                sourceType: input.sourceGroup,
                appSlug: nonEmptyString(params.appSlug),
                sectionSlug: nonEmptyString(params.sectionSlug),
                status: "failed",
                failureReason: input.reasonCode,
                errorMessage: input.errorMessage,
                launchId: nonEmptyString(params.launchId),
            },
        });
        const defectCount = syncChecklistMetadata();
        log(jobId, `[defect-checklist] upsert key=${upsertResult.dedupeKey} identity=${checklistIdentity} caseId=${input.caseId} scenarioId=${input.scenarioId} action=${upsertResult.action} defectCount=${defectCount} sourceType=${input.sourceGroup}`);
        log(jobId, `[execution-phase] jobId=${jobId} caseId=${input.caseId} phase=functional durationMs=${input.durationMs} result=failed reason=${input.reasonCode}`);
        log(jobId, `[case-lifecycle] jobId=${jobId} caseId=${input.caseId} sourceGroup=${input.sourceGroup} phase=functional result=failed durationMs=${input.durationMs} reason=${input.reasonCode}`);
        if (params.testRunId && isPositiveCaseId(params.testRunId)) {
            const syncResult = await (0, testrail_result_sync_1.syncDiscoveryResultToTestRail)({
                runId: params.testRunId,
                caseId: input.caseId,
                scenarioId: input.scenarioId,
                discoveryStatus: "failed",
                title: input.scenarioTitle,
                errorMessage: input.errorMessage,
                durationMs: input.durationMs,
                launchId: params.launchId,
                appSlug: params.appSlug,
                sectionSlug: params.sectionSlug,
            });
            if (syncResult.syncStatus === "synced")
                synced += 1;
            if (syncResult.syncStatus === "failed")
                syncFailed += 1;
            if (params.launchId) {
                (0, testrail_result_sync_1.updateLaunchManifestWithResult)(params.launchId, {
                    scenarioId: input.scenarioId,
                    caseId: input.caseId,
                    discoveryStatus: "failed",
                    testRailStatusId: syncResult.statusId,
                    syncStatus: syncResult.syncStatus,
                    syncedAt: syncResult.syncedAt,
                    error: syncResult.error,
                }, scheduledCases.length);
            }
        }
        log(jobId, `[case-lifecycle] jobId=${jobId} caseId=${input.caseId} sourceGroup=${input.sourceGroup} phase=result result=failed durationMs=${Math.max(0, Date.now() - input.caseLifecycleStartedAt)} reason=${input.reasonCode}`);
        log(jobId, `[case-schedule] jobId=${jobId} caseId=${input.caseId} sourceGroup=${input.sourceGroup} groupIndex=${input.groupIndex} overallIndex=${input.overallIndex} action=failed`);
        updateProgressSummary(input.caseId);
    };
    for (const scheduledCase of scheduledCases) {
        const caseId = scheduledCase.caseId;
        const sourceGroup = scheduledCase.sourceGroup;
        const scenarioRef = publishedEntryByCaseId(caseId, params.publishedCases);
        if (activeGroup !== sourceGroup) {
            if (activeGroup) {
                markGroupEnd(activeGroup, "completed", "group_cases_processed");
            }
            markGroupStart(sourceGroup);
            activeGroup = sourceGroup;
        }
        const caseLifecycleStartedAt = Date.now();
        log(jobId, `[case-schedule] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} groupIndex=${scheduledCase.groupIndex} overallIndex=${scheduledCase.overallIndex} action=start`);
        job_store_1.jobStore.update(jobId, {
            currentCase: `C${caseId}`,
            summary: {
                ...(job_store_1.jobStore.get(jobId)?.summary ?? baseSummary),
                currentCaseIndex: scheduledCase.overallIndex,
                totalCases: executionCaseIds.length,
            },
        });
        const resolveStartedAt = Date.now();
        const candidate = selectCandidateEntryForCase(caseId, promotedEntriesBefore, effectiveAppSlug);
        const persistedValidation = validatePromotedEntryForExecution({
            caseId,
            appSlug: effectiveAppSlug,
            sectionSlug: params.sectionSlug,
            entry: candidate,
        });
        const validation = scenarioRef?.executionSource === "mcp_required"
            ? { reusable: false, blocked: false, reason: scenarioRef.reasonCode ?? "mcp_required", specPath: persistedValidation.specPath }
            : persistedValidation;
        let contractEvaluation;
        let contractScenario;
        let contractMetadata;
        let contractSectionId;
        let contractValidationResult = "skipped";
        let contractValidationReason = validation.reason;
        const contractValidationStartedAt = Date.now();
        log(jobId, `[rediscovery-intent] jobId=${jobId} caseId=${caseId} explicit=${rediscoveryIntent.explicit} source=${rediscoveryIntent.source} overwrite=${rediscoveryIntent.overwrite} rerunActive=${rediscoveryIntent.rerunActive}`);
        if (!validation.reusable && !validation.blocked && !forceRediscovery) {
            if (!testRailClient) {
                contractValidationResult = "failed";
                contractValidationReason = "case_contract_fetch_unavailable";
                log(jobId, `[case-contract-evaluation] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} sufficient=false recommendedRoute=full_discovery gapCount=0 reason=${testRailClientError ?? contractValidationReason}`);
            }
            else {
                try {
                    const rawCase = await testRailClient.getCase(caseId);
                    const normalizedCase = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
                    contractMetadata = (0, case_contract_evaluator_1.extractCaseContractMetadata)(rawCase);
                    contractScenario = (0, case_contract_evaluator_1.buildMcpScenarioContractFromTestRailCase)({
                        scenario: normalizedCase,
                        appSlug: effectiveAppSlug,
                        metadata: contractMetadata,
                    });
                    contractSectionId = normalizedCase.sectionId;
                    contractEvaluation = (0, case_contract_evaluator_1.evaluateCaseContractSufficiency)({
                        scenario: contractScenario,
                        appSlug: effectiveAppSlug,
                        sectionSlug: params.sectionSlug,
                        metadata: contractMetadata,
                        hasRouteProfileConfig: routeProfileConfigured,
                    });
                    contractValidationReason = contractEvaluation.reasonCode;
                    contractValidationResult = contractEvaluation.recommendedRoute === "blocked"
                        ? "failed"
                        : "completed";
                    log(jobId, `[case-contract-evaluation] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} sufficient=${contractEvaluation.sufficient} recommendedRoute=${contractEvaluation.recommendedRoute} gapCount=${contractEvaluation.gaps.length} reason=${contractEvaluation.reasonCode}`);
                }
                catch (err) {
                    contractValidationResult = "failed";
                    contractValidationReason = "case_contract_fetch_failed";
                    log(jobId, `[case-contract-evaluation] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} sufficient=false recommendedRoute=full_discovery gapCount=0 reason=${contractValidationReason}:${err?.message ?? String(err)}`);
                }
            }
        }
        else if (forceRediscovery) {
            contractValidationReason = "explicit_rediscovery_requested";
        }
        else if (validation.blocked) {
            contractValidationResult = "failed";
            contractValidationReason = validation.reason;
        }
        else if (validation.reusable) {
            contractValidationReason = "promoted_spec_valid";
        }
        let route = resolveRouteFromValidation({
            caseId,
            appSlug: effectiveAppSlug,
            forceRediscovery,
            rediscoveryIntent: rediscoveryIntent.rediscoveryIntent,
            targetedDiscoverySupported,
            contractEvaluation,
            validation,
        });
        if (route.reason === "targeted_discovery_not_supported" && contractValidationResult === "completed") {
            contractValidationReason = "targeted_discovery_not_supported";
        }
        routeDecisions.set(caseId, route);
        log(jobId, `[execution-route] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} route=${route.route} reason=${route.reason} specPath=${route.specPath ?? "none"}`);
        const resolveDurationMs = Math.max(0, Date.now() - resolveStartedAt);
        log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=resolve durationMs=${resolveDurationMs} result=completed reason=${route.reason}`);
        log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=contract_validation durationMs=${Math.max(0, Date.now() - contractValidationStartedAt)} result=${contractValidationResult} reason=${contractValidationReason}`);
        log(jobId, `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=contract_validation result=${contractValidationResult} durationMs=${Math.max(0, Date.now() - contractValidationStartedAt)} reason=${contractValidationReason}`);
        log(jobId, `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=resolve result=completed durationMs=${resolveDurationMs} reason=${route.reason}`);
        const prepareStartedAt = Date.now();
        let prepareResult = "skipped";
        let prepareReason = route.reason;
        let promotionResult = route.route === "promoted_reuse" ? "skipped" : "completed";
        let promotionReason = route.route === "promoted_reuse" ? "promoted_reuse" : route.reason;
        let promotionDurationMs = 0;
        const runFullDiscoveryForCase = async (currentRoute) => {
            const fullDiscoveryArgs = buildDiscoveryBatchArgs(fullDiscoveryCommandParams, [caseId]);
            let discoveredState;
            let runnerContextMaterialized = false;
            let promotionPersisted = false;
            let discoveryDurationMs = 0;
            log(jobId, `[run:discovery-batch] caseIds=${caseId} appSlug=${params.appSlug ?? "N/A"}`);
            log(jobId, `[run:discovery-batch] command=${cmd} ${fullDiscoveryArgs.join(" ")}`);
            const discoveryResult = await runCommand(jobId, cmd, fullDiscoveryArgs, buildDiscoveryChildEnv(process.env, runtimeContextPath, buildBatchResultPath(jobId)), (line) => {
                const persistedMatch = /\[discovery:workflow\].*promotionPersisted=(true|false)/i.exec(line);
                if (persistedMatch)
                    promotionPersisted = persistedMatch[1].toLowerCase() === "true";
                const match = DISCOVERY_CASE_FINISHED_RE.exec(line);
                if (!match)
                    return;
                const parsedCaseId = Number(match[1]);
                if (parsedCaseId !== caseId)
                    return;
                discoveredState = match[2].toLowerCase();
                const parsedDuration = Number(match[3] ?? 0);
                if (Number.isFinite(parsedDuration) && parsedDuration >= 0) {
                    discoveryDurationMs = parsedDuration;
                }
            });
            const structuredChildResult = await readStructuredChildResult(buildBatchResultPath(jobId), caseId);
            runnerContextMaterialized = structuredChildResult?.contextMaterialized === true;
            if (structuredChildResult?.status)
                discoveredState = structuredChildResult.status;
            log(jobId, `[structured-child-result] caseId=${caseId} childStatus=${discoveredState ?? "unknown"} contextMaterialized=${runnerContextMaterialized}`);
            if (discoveryResult.exitCode !== 0) {
                const blockedRoute = {
                    caseId,
                    appSlug: effectiveAppSlug,
                    route: "blocked",
                    reason: "full_discovery_failed",
                    specPath: currentRoute.specPath,
                };
                prepareResult = "failed";
                prepareReason = "full_discovery_failed";
                promotionResult = "failed";
                promotionReason = "full_discovery_failed";
                log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=full_discovery durationMs=${discoveryDurationMs} result=failed reason=full_discovery_failed`);
                return blockedRoute;
            }
            const promotedEntriesAfter = await loadPromotedEntriesForRouting(effectiveAppSlug);
            const admission = resolvePostDiscoveryExecutionAdmission({
                caseId,
                appSlug: effectiveAppSlug,
                sectionSlug: params.sectionSlug,
                childStatus: discoveredState,
                contextOnly: params.contextOnly === true,
                contextMaterialized: runnerContextMaterialized,
                promotionPersisted,
                entries: promotedEntriesAfter,
            });
            log(jobId, `[post-discovery-execution-admission] caseId=${caseId} childStatus=${discoveredState ?? "unknown"} promotionPersisted=${promotionPersisted ? "true" : "false"} promotedSpecResolved=${admission.specPath ? "true" : "false"} admitted=${admission.admitted ? "true" : "false"} reason=${admission.reason}`);
            if (admission.admitted) {
                if (params.contextOnly === true) {
                    const contextMaterializedRoute = {
                        caseId,
                        appSlug: effectiveAppSlug,
                        route: "blocked",
                        reason: "context_materialized",
                    };
                    prepareResult = "completed";
                    prepareReason = "context_materialized";
                    promotionResult = "skipped";
                    promotionReason = "context_only";
                    log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=full_discovery durationMs=${discoveryDurationMs} result=completed reason=context_materialized`);
                    log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=pom durationMs=0 result=skipped reason=context_only`);
                    log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=promotion durationMs=0 result=skipped reason=context_only`);
                    return contextMaterializedRoute;
                }
                const discoveredRoute = {
                    caseId,
                    appSlug: effectiveAppSlug,
                    route: "full_discovery",
                    reason: discoveredState === "promoted" ? "full_discovery_promoted" : "promoted_spec_valid_after_full_discovery",
                    specPath: admission.specPath,
                };
                prepareResult = "completed";
                prepareReason = discoveredRoute.reason;
                promotionResult = "completed";
                promotionReason = "handled_inside_discovery_batch";
                log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=full_discovery durationMs=${discoveryDurationMs} result=completed reason=${discoveredState ?? "completed"}`);
                log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=pom durationMs=0 result=completed reason=handled_inside_discovery_batch`);
                log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=promotion durationMs=0 result=completed reason=handled_inside_discovery_batch`);
                return discoveredRoute;
            }
            const blockedReason = `full_discovery_${admission.reason}`;
            prepareResult = "failed";
            prepareReason = blockedReason;
            promotionResult = "failed";
            promotionReason = blockedReason;
            log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=full_discovery durationMs=${discoveryDurationMs} result=failed reason=${blockedReason}`);
            log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=pom durationMs=0 result=failed reason=${blockedReason}`);
            log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=promotion durationMs=0 result=failed reason=${blockedReason}`);
            return {
                caseId,
                appSlug: effectiveAppSlug,
                route: "blocked",
                reason: blockedReason,
                specPath: admission.specPath,
            };
        };
        if (route.route === "automation_from_case_contract" || route.route === "targeted_discovery") {
            if (!contractScenario || !contractMetadata) {
                route = {
                    caseId,
                    appSlug: effectiveAppSlug,
                    route: "full_discovery",
                    reason: "case_contract_missing_for_fast_path",
                    specPath: route.specPath,
                };
                log(jobId, `[execution-route] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} route=full_discovery reason=case_contract_missing_for_fast_path specPath=${route.specPath ?? "none"}`);
            }
            else {
                const previewPreparationStartedAt = Date.now();
                const previewPath = buildContractPreviewArtifactPath(jobId, caseId);
                node_fs_1.default.mkdirSync(node_path_1.default.dirname(previewPath), { recursive: true });
                const virtualCase = (0, case_contract_evaluator_1.buildVirtualCaseFromContract)({
                    scenario: contractScenario,
                    index: 0,
                    sectionSlug: params.sectionSlug,
                    sectionName: params.sectionName,
                    sectionId: contractSectionId,
                    testRailCaseId: caseId,
                    metadata: contractMetadata,
                });
                node_fs_1.default.writeFileSync(previewPath, JSON.stringify([virtualCase], null, 2), "utf-8");
                const previewArgs = buildDiscoveryPreviewArgs({
                    previewPath,
                    appSlug: effectiveAppSlug,
                    routeProfile: params.routeProfile,
                    autoPromote: params.autoPromote,
                    autoPom: params.autoPom,
                    headed: params.headed,
                    deferEvidenceConsolidation: true,
                });
                const previewPreparationDurationMs = Math.max(0, Date.now() - previewPreparationStartedAt);
                log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=preview_preparation durationMs=${previewPreparationDurationMs} result=completed reason=${route.reason}`);
                log(jobId, `[run:discovery-preview] caseId=${caseId} appSlug=${effectiveAppSlug}`);
                log(jobId, `[run:discovery-preview] command=${cmd} ${previewArgs.join(" ")}`);
                const previewStartedAt = Date.now();
                const previewResult = await runCommand(jobId, cmd, previewArgs, buildContractPreviewEnv(params, jobId));
                const previewDurationMs = Math.max(0, Date.now() - previewStartedAt);
                if (route.route === "targeted_discovery") {
                    log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=targeted_discovery durationMs=${previewDurationMs} result=${previewResult.exitCode === 0 ? "completed" : "failed"} reason=${route.reason}`);
                }
                if (previewResult.exitCode !== 0) {
                    route = {
                        caseId,
                        appSlug: effectiveAppSlug,
                        route: "full_discovery",
                        reason: `${route.route}_pipeline_failed`,
                        specPath: route.specPath,
                    };
                    log(jobId, `[execution-route] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} route=full_discovery reason=${route.reason} specPath=${route.specPath ?? "none"}`);
                }
                else {
                    const promotedEntriesAfterPreview = await loadPromotedEntriesForRouting(effectiveAppSlug);
                    const promotedCandidate = selectCandidateEntryForCase(caseId, promotedEntriesAfterPreview, effectiveAppSlug);
                    const promotedValidation = validatePromotedEntryForExecution({
                        caseId,
                        appSlug: effectiveAppSlug,
                        sectionSlug: params.sectionSlug,
                        entry: promotedCandidate,
                    });
                    if (promotedValidation.reusable) {
                        route = {
                            caseId,
                            appSlug: effectiveAppSlug,
                            route: route.route,
                            reason: `${route.route}_promoted`,
                            specPath: promotedValidation.specPath,
                        };
                        prepareResult = "completed";
                        prepareReason = route.reason;
                        promotionResult = "completed";
                        promotionReason = "handled_inside_discovery_preview";
                        promotionDurationMs = previewDurationMs;
                        log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=pom durationMs=${previewDurationMs} result=completed reason=handled_inside_discovery_preview`);
                        log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=promotion durationMs=0 result=completed reason=handled_inside_discovery_preview`);
                    }
                    else {
                        route = {
                            caseId,
                            appSlug: effectiveAppSlug,
                            route: "full_discovery",
                            reason: `${route.route}_promotion_incomplete`,
                            specPath: promotedValidation.specPath,
                        };
                        log(jobId, `[execution-route] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} route=full_discovery reason=${route.reason} specPath=${route.specPath ?? "none"}`);
                    }
                }
            }
        }
        if (route.route === "full_discovery") {
            route = await runFullDiscoveryForCase(route);
        }
        else if (route.route === "promoted_reuse") {
            prepareResult = "skipped";
            prepareReason = "promoted_reuse";
            promotionResult = "skipped";
            promotionReason = "promoted_reuse";
        }
        else if (route.route === "blocked") {
            prepareResult = "failed";
            prepareReason = route.reason;
            promotionResult = "failed";
            promotionReason = route.reason;
        }
        routeDecisions.set(caseId, route);
        const prepareDurationMs = (prepareResult === "skipped" && promotionResult === "skipped")
            ? 0
            : Math.max(0, Date.now() - prepareStartedAt);
        log(jobId, `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=prepare result=${prepareResult} durationMs=${prepareDurationMs} reason=${prepareReason}`);
        log(jobId, `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=promotion result=${promotionResult} durationMs=${promotionDurationMs} reason=${promotionReason}`);
        const scenarioId = scenarioRef?.executionScenarioId ?? scenarioRef?.scenarioId ?? `TR-CASE-${caseId}`;
        const scenarioTitle = nonEmptyString(scenarioRef?.title) ?? `C${caseId}`;
        if (route.route === "blocked") {
            if (route.reason === "context_materialized") {
                completed += 1;
                skipped += 1;
                updateProgressSummary(caseId);
                continue;
            }
            const blockedReason = route.reason;
            await recordPreFunctionalFailure({
                caseId,
                sourceGroup,
                scenarioId,
                scenarioTitle,
                reasonCode: blockedReason,
                errorMessage: `Case cannot continue before functional execution: ${blockedReason}`,
                durationMs: 0,
                completedAt: new Date().toISOString(),
                caseLifecycleStartedAt,
                groupIndex: scheduledCase.groupIndex,
                overallIndex: scheduledCase.overallIndex,
            });
            continue;
        }
        const testArgs = buildTestPromotedArgs(params, caseId);
        log(jobId, `[run:functional-execution] caseId=${caseId} command=${cmd} ${testArgs.join(" ")}`);
        const functionalStartedAt = Date.now();
        const promotedExecutionEnv = buildPromotedExecutionEnv(params, jobId, process.env, runtimeContextPath);
        const testResult = await runCommand(jobId, cmd, testArgs, promotedExecutionEnv);
        const caseCompletedAt = new Date().toISOString();
        const functionalDurationMs = Math.max(0, Date.now() - functionalStartedAt);
        const noTestsFound = testResult.lines.some((line) => /No tests found/i.test(line));
        if (noTestsFound) {
            log(jobId, `[evidence-initialization] caseId=${caseId} initialized=false moduleMode=${RUNTIME_MODULE_MODE} reason=no_tests_found`);
            await recordPreFunctionalFailure({
                caseId,
                sourceGroup,
                scenarioId,
                scenarioTitle,
                reasonCode: "no_promoted_spec_found",
                errorMessage: "No promoted spec found for functional execution.",
                durationMs: functionalDurationMs,
                completedAt: caseCompletedAt,
                caseLifecycleStartedAt,
                groupIndex: scheduledCase.groupIndex,
                overallIndex: scheduledCase.overallIndex,
            });
            continue;
        }
        const evidenceInit = parseEvidenceInitializationResult(testResult.lines);
        if (!evidenceInit.initialized) {
            evidenceInitializationFailures += 1;
        }
        log(jobId, `[evidence-initialization] caseId=${caseId} initialized=${evidenceInit.initialized} moduleMode=${RUNTIME_MODULE_MODE} reason=${evidenceInit.reason}`);
        const discoveryStatus = testResult.exitCode === 0 ? "passed" : "failed";
        const failureDetails = discoveryStatus === "failed"
            ? parsePromotedFunctionalFailure(testResult.lines)
            : {};
        const evidenceFailure = discoveryStatus === "failed"
            ? readCaseEvidenceFailureSnapshot({
                runId: jobId,
                caseId,
                appSlug: params.appSlug,
                sectionSlug: params.sectionSlug,
                sectionName: params.sectionName,
            })
            : undefined;
        const failedStep = failureDetails.failedAtStep ?? evidenceFailure?.failedAtStep;
        const failedTarget = failureDetails.failedTarget ?? evidenceFailure?.failedTarget;
        const screenshotPath = nonEmptyString(evidenceFailure?.screenshotPath);
        const evidencePath = screenshotPath ?? nonEmptyString(evidenceFailure?.evidenceJsonPath);
        const failureReasonCode = nonEmptyString(failureDetails.failureReason)
            ?? (typeof failedStep === "number" ? "promoted_step_failed" : "functional_execution_failed");
        const failureMessage = nonEmptyString(failureDetails.errorMessage)
            ?? nonEmptyString(evidenceFailure?.errorMessage)
            ?? nonEmptyString(testResult.lines[testResult.lines.length - 1])
            ?? "Functional execution failed";
        completed += 1;
        if (discoveryStatus === "passed")
            passed += 1;
        else
            failed += 1;
        executed += 1;
        if (discoveryStatus === "passed" && params.appSlug) {
            const runtimeEntries = params.runtimeEntriesByCase?.[String(caseId)] ?? [];
            if (runtimeEntries.length > 0) {
                try {
                    const confirmedPersisted = await (0, project_case_runtime_value_service_1.persistConfirmedRuntimeValues)({
                        projectSlug: params.appSlug,
                        caseId,
                        values: runtimeEntries.map((entry) => ({
                            key: entry.key,
                            value: entry.value,
                            semanticType: entry.semanticType,
                            fieldKind: entry.fieldKind,
                            datasetIdentity: entry.datasetIdentity,
                            contractVersion: entry.contractVersion,
                            verified: true,
                        })),
                    });
                    log(jobId, `[runtime-replay] caseId=${caseId} confirmedPersisted=${confirmedPersisted} secretsPersistedRaw=false`);
                }
                catch (error) {
                    log(jobId, `[runtime-replay] caseId=${caseId} confirmedPersisted=0 persistenceWarning=${error instanceof Error ? error.message : "unknown_error"}`);
                }
            }
        }
        caseResults.push({
            caseId,
            status: discoveryStatus,
            completedAt: caseCompletedAt,
            durationMs: functionalDurationMs,
            reason: discoveryStatus === "failed" ? failureReasonCode : discoveryStatus,
            scenarioId,
            scenarioTitle,
            sourceType: sourceGroup,
            appSlug: nonEmptyString(params.appSlug),
            sectionSlug: nonEmptyString(params.sectionSlug),
            launchId: nonEmptyString(params.launchId),
            failedStep,
            failedTarget,
            failureReason: discoveryStatus === "failed" ? failureReasonCode : undefined,
            errorMessage: discoveryStatus === "failed" ? failureMessage : undefined,
            screenshotPath,
            evidencePath,
        });
        if (discoveryStatus === "failed") {
            const technicalContext = {
                dedupeKey: buildDiscoveryBatchDefectDedupeKey({ jobId, caseId, scenarioId }),
                reasonCode: failureReasonCode,
                discoveryStatus,
                failedAtStep: failedStep,
                failedTarget,
                rawError: failureMessage,
                evidenceDir: evidenceFailure?.evidenceJsonPath ? node_path_1.default.dirname(evidenceFailure.evidenceJsonPath) : undefined,
                evidencePath,
                lastSuccessfulStep: evidenceFailure?.lastSuccessfulStep,
                testRailCaseId: caseId,
                testRailRunId: params.testRunId,
                caseId,
                scenarioId,
                sourceType: sourceGroup,
                appSlug: nonEmptyString(params.appSlug),
                sectionSlug: nonEmptyString(params.sectionSlug),
                status: discoveryStatus,
                failureReason: failureReasonCode,
                errorMessage: failureMessage,
                screenshotPath,
                evidenceJsonPath: nonEmptyString(evidenceFailure?.evidenceJsonPath),
                launchId: nonEmptyString(params.launchId),
                currentUrl: nonEmptyString(failureDetails.currentUrl),
                matchedLocatorStrategy: nonEmptyString(failureDetails.matchedLocatorStrategy),
            };
            const technicalContextRecord = technicalContext;
            Object.keys(technicalContextRecord).forEach((key) => {
                if (technicalContextRecord[key] === undefined) {
                    delete technicalContextRecord[key];
                }
            });
            if (technicalContext.lastSuccessfulStep) {
                const lastSuccessfulStep = technicalContext.lastSuccessfulStep;
                Object.keys(lastSuccessfulStep).forEach((key) => {
                    const typedKey = key;
                    if (lastSuccessfulStep[typedKey] === undefined) {
                        delete lastSuccessfulStep[typedKey];
                    }
                });
                if (Object.keys(lastSuccessfulStep).length === 0) {
                    delete technicalContext.lastSuccessfulStep;
                }
            }
            const checklist = defect_checklist_store_1.defectChecklistStore.getOrCreate(checklistIdentity);
            const upsertResult = upsertChecklistDefect({
                list: checklist,
                checklistIdentity,
                jobId,
                caseId,
                scenarioId,
                scenarioTitle,
                failureReasonText: failureMessage,
                technicalContext: Object.keys(technicalContext).length > 0 ? technicalContext : undefined,
                evidencePath,
            });
            const defectCount = syncChecklistMetadata();
            log(jobId, `[defect-checklist] upsert key=${upsertResult.dedupeKey} identity=${checklistIdentity} caseId=${caseId} scenarioId=${scenarioId} action=${upsertResult.action} defectCount=${defectCount} sourceType=${sourceGroup}`);
        }
        log(jobId, `[execution-phase] jobId=${jobId} caseId=${caseId} phase=functional durationMs=${functionalDurationMs} result=${discoveryStatus === "passed" ? "completed" : "failed"} reason=${discoveryStatus}`);
        log(jobId, `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=functional result=${discoveryStatus === "passed" ? "completed" : "failed"} durationMs=${functionalDurationMs} reason=${discoveryStatus}`);
        if (params.testRunId && isPositiveCaseId(params.testRunId)) {
            const syncResult = await (0, testrail_result_sync_1.syncDiscoveryResultToTestRail)({
                runId: params.testRunId,
                caseId,
                scenarioId,
                discoveryStatus,
                title: scenarioRef?.title,
                launchId: params.launchId,
                appSlug: params.appSlug,
                sectionSlug: params.sectionSlug,
            });
            if (syncResult.syncStatus === "synced")
                synced += 1;
            if (syncResult.syncStatus === "failed")
                syncFailed += 1;
            if (params.launchId) {
                (0, testrail_result_sync_1.updateLaunchManifestWithResult)(params.launchId, {
                    scenarioId,
                    caseId,
                    discoveryStatus,
                    testRailStatusId: syncResult.statusId,
                    syncStatus: syncResult.syncStatus,
                    syncedAt: syncResult.syncedAt,
                    error: syncResult.error,
                }, scheduledCases.length);
            }
        }
        log(jobId, `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=result result=${discoveryStatus === "passed" ? "completed" : "failed"} durationMs=${Math.max(0, Date.now() - caseLifecycleStartedAt)} reason=${discoveryStatus}`);
        log(jobId, `[case-schedule] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} groupIndex=${scheduledCase.groupIndex} overallIndex=${scheduledCase.overallIndex} action=${discoveryStatus === "passed" ? "completed" : "failed"}`);
        updateProgressSummary(caseId);
    }
    if (activeGroup) {
        markGroupEnd(activeGroup, "completed", "group_cases_processed");
    }
    job_store_1.jobStore.update(jobId, { currentCase: null });
    log(jobId, `[functional-execution] requested=${executionCaseIds.length} executed=${executed} passed=${passed} failed=${failed} skipped=${skipped}`);
    const finalSnapshot = computeFunctionalExecutionSnapshot({
        requested: executionCaseIds.length,
        completed,
        executed,
        passed,
        failed,
        skipped,
    });
    const consolidationStartedAt = Date.now();
    const documentResult = finalSnapshot.executed > 0
        ? await consolidateRunEvidenceForExecution(jobId, params.appSlug, params.sectionSlug, params.sectionName)
        : {
            attempted: false,
            generated: false,
            documentPathPresent: false,
            scenarioEvidenceCount: 0,
        };
    const consolidationDurationMs = Math.max(0, Date.now() - consolidationStartedAt);
    const consolidationResult = finalSnapshot.executed === 0
        ? "skipped"
        : (documentResult.generated ? "completed" : "failed");
    log(jobId, `[evidence-consolidation] jobId=${jobId} trigger=job_completed scenarioCount=${documentResult.scenarioEvidenceCount} generationCount=1 result=${consolidationResult} durationMs=${consolidationDurationMs}`);
    const effectiveReasonCode = finalSnapshot.executed === 0
        ? "cases_not_executable"
        : undefined;
    const reasonCode = effectiveReasonCode
        ?? (!documentResult.generated
            ? (evidenceInitializationFailures > 0 ? "evidence_initialization_failed" : "document_generation_failed")
            : undefined);
    log(jobId, `[document-generation] jobId=${jobId} executedResults=${finalSnapshot.executed} evidenceResults=${documentResult.scenarioEvidenceCount} attempted=${documentResult.attempted} generated=${documentResult.generated} documentPathPresent=${documentResult.documentPathPresent} reason=${reasonCode ?? "ready"}`);
    if (params.launchId) {
        const finalStatus = failed > 0 || syncFailed > 0 ? "completed_with_failures" : "completed";
        (0, testrail_result_sync_1.finalizeLaunchManifest)(params.launchId, finalStatus, syncFailed, finalSnapshot.completed);
    }
    const finalChecklist = defect_checklist_store_1.defectChecklistStore.get(checklistIdentity) ?? checklistList;
    const finalDefectCount = countDefectsForJob(finalChecklist, jobId);
    const summary = {
        ...baseSummary,
        synced,
        syncFailed,
        requested: finalSnapshot.requested,
        completed: finalSnapshot.completed,
        executed: finalSnapshot.executed,
        passed: finalSnapshot.passed,
        failed: finalSnapshot.failed,
        skipped: finalSnapshot.skipped,
        progressPercent: finalSnapshot.progressPercent,
        progress: finalSnapshot.progressPercent,
        passRate: finalSnapshot.passRate,
        requestedCases: finalSnapshot.requested,
        executedCases: finalSnapshot.executed,
        notExecutableCases: nonExecutableFailed,
        caseResults: [...caseResults],
        reasonCode,
        documentAttempted: documentResult.attempted,
        documentGenerated: documentResult.generated,
        documentPathPresent: documentResult.documentPathPresent,
        ...(documentResult.documentPath ? { documentPath: documentResult.documentPath } : {}),
        scenarioEvidenceCount: documentResult.scenarioEvidenceCount,
        evidenceResults: documentResult.scenarioEvidenceCount,
        evidenceInitializationFailures,
        checklistIdentity,
        checklistUrl,
        defectCount: finalDefectCount,
        ...(documentResult.error ? { documentError: documentResult.error } : {}),
    };
    job_store_1.jobStore.update(jobId, {
        status: "done",
        completedAt: new Date().toISOString(),
        exitCode: 0,
        summary,
        checklistUrl,
        defectCount: finalDefectCount,
        ...(checklistIssueKeyMetadata ? { issueKey: checklistIssueKeyMetadata } : {}),
    });
}
function startDiscoveryBatchRun(jobId) {
    const job = job_store_1.jobStore.getInternal(jobId);
    if (!job)
        return;
    const params = loadLaunchTestRailIdentity(job.params);
    const runtimeContextPath = writeRuntimeContextIfPresent(jobId, params);
    logRuntimeInputAuthority(jobId, params);
    if (params.executePromotedSpecs === true) {
        void startDiscoveryBatchExecutionFlow(jobId, params, runtimeContextPath)
            .catch((err) => {
            job_store_1.jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString() });
            log(jobId, `[run:discovery-batch] Error al ejecutar flujo de ejecución: ${err?.message ?? String(err)}`);
        })
            .finally(async () => {
            await deleteRuntimeContextIfExists(jobId);
            job_store_1.jobStore.clearTransientParams(jobId);
        });
        return;
    }
    startLegacyDiscoveryBatchRun(jobId, params, runtimeContextPath);
}
