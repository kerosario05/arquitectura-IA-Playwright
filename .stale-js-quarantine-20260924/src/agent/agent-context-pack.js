"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAgentContextPack = buildAgentContextPack;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const app_profile_1 = require("../automations/app-profile");
const automation_index_1 = require("../automations/automation-index");
const safe_data_context_1 = require("./safe-data-context");
const data_context_1 = require("../data/data-context");
const DEFAULTS = {
    maxObjects: 50,
    maxPlans: 10,
    maxRoutes: 10,
    maxSnapshotCandidates: 50,
    includePending: true,
    includePromoted: true,
    includeOtherApps: false
};
function normalizeText(text) {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function tokenize(text) {
    const stop = new Set(["de", "la", "el", "los", "las", "y", "o", "en", "por", "para", "con", "sin", "al", "del", "the", "a", "an", "to", "for", "on", "in", "at", "by"]);
    return normalizeText(text)
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !stop.has(t));
}
function computeTokenOverlapScore(query, candidate) {
    const q = new Set(tokenize(query));
    const c = new Set(tokenize(candidate));
    if (q.size === 0 || c.size === 0)
        return 0;
    let overlap = 0;
    for (const t of q) {
        if (c.has(t))
            overlap += 1;
    }
    return overlap / Math.max(q.size, 1);
}
async function readJsonIfExists(filePath) {
    try {
        const content = await promises_1.default.readFile(filePath, "utf-8");
        return { value: JSON.parse(content) };
    }
    catch (err) {
        if (err instanceof Error && "code" in err && err.code === "ENOENT") {
            return { warning: `Context file not found: ${filePath}` };
        }
        return { warning: `Failed to read context file: ${filePath}. ${err instanceof Error ? err.message : String(err)}` };
    }
}
function extractRouteFromPlan(plan) {
    const route = [];
    for (const step of plan.steps) {
        if (step.action !== "click" && step.action !== "navigate")
            continue;
        if (!step.target || step.target === "APP_BASE_URL")
            continue;
        if (typeof step.target !== "object")
            continue;
        const val = (step.target.name ?? step.target.value ?? "").trim();
        if (val)
            route.push(val.slice(0, 80));
    }
    return route.slice(0, 12);
}
async function buildAgentContextPack(input) {
    const options = { ...DEFAULTS, ...(input.options ?? {}) };
    const warnings = [];
    const appProfile = (0, app_profile_1.deriveAppProfile)({
        appProfile: input.fullConfig.app.appProfile,
        appName: input.fullConfig.app.name,
        baseUrl: input.fullConfig.app.baseUrl
    });
    const appSlug = appProfile.appSlug;
    const repoAppPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile);
    const promotedAppConfig = (0, app_profile_1.loadPromotedAppConfigSync)({ appSlug });
    const redactedAppConfig = promotedAppConfig ? (0, app_profile_1.redactPromotedAppConfigForLogs)(promotedAppConfig) : undefined;
    if (!promotedAppConfig) {
        warnings.push(`No promoted app.config.json found for appSlug '${appSlug}'. Expected at ${repoAppPaths.configPath}`);
    }
    const safeData = (0, safe_data_context_1.buildSafeDataContextSummary)((0, data_context_1.buildDataContext)(input.fullConfig));
    const knownObjects = [];
    if (options.includePending && input.pendingObjectsPath) {
        const { value, warning } = await readJsonIfExists(input.pendingObjectsPath);
        if (warning)
            warnings.push(warning);
        if (Array.isArray(value)) {
            for (const obj of value) {
                const text = [obj.name, ...(obj.aliases ?? [])].filter(Boolean).join(" ");
                const score = input.failedTarget ? computeTokenOverlapScore(input.failedTarget, text) : 0;
                knownObjects.push({
                    key: obj.key,
                    name: obj.name,
                    type: obj.type,
                    aliases: obj.aliases,
                    locator: obj.locator,
                    confidence: obj.confidence,
                    source: "current_run_pending",
                    score
                });
            }
        }
    }
    knownObjects.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.confidence ?? 0) - (a.confidence ?? 0));
    if (knownObjects.length > options.maxObjects) {
        warnings.push(`knownObjects limited to ${options.maxObjects} (had ${knownObjects.length}).`);
        knownObjects.length = options.maxObjects;
    }
    const knownPlans = [];
    const knownRoutes = [];
    if (options.includePromoted) {
        const appIndexPath = repoAppPaths.indexPath;
        const appIndex = await (0, automation_index_1.loadAutomationIndex)(appIndexPath).catch((err) => {
            warnings.push(`Failed to load app automation index at ${appIndexPath}: ${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        });
        if (appIndex) {
            for (const entry of appIndex.automations) {
                const planPath = entry.planPath;
                const score = input.failedTarget ? computeTokenOverlapScore(input.failedTarget, `${entry.title ?? ""}`) : 0;
                knownPlans.push({
                    id: entry.id,
                    caseId: entry.caseId,
                    externalId: entry.externalId,
                    title: entry.title,
                    status: entry.status,
                    source: entry.source,
                    planPath,
                    createdAt: entry.createdAt,
                    updatedAt: entry.updatedAt,
                    score
                });
            }
        }
    }
    // Rank: same caseId/externalId first, then status, then similarity score.
    const currentCaseId = input.currentPlan?.scenario.caseId;
    const currentExternalId = input.currentPlan?.scenario.externalId;
    knownPlans.sort((a, b) => {
        const aSame = (currentCaseId && a.caseId === currentCaseId) || (currentExternalId && a.externalId === currentExternalId);
        const bSame = (currentCaseId && b.caseId === currentCaseId) || (currentExternalId && b.externalId === currentExternalId);
        if (aSame !== bSame)
            return aSame ? -1 : 1;
        const aActive = a.status === "active";
        const bActive = b.status === "active";
        if (aActive !== bActive)
            return aActive ? -1 : 1;
        return (b.score ?? 0) - (a.score ?? 0);
    });
    if (knownPlans.length > options.maxPlans) {
        warnings.push(`knownPlans limited to ${options.maxPlans} (had ${knownPlans.length}).`);
        knownPlans.length = options.maxPlans;
    }
    // Build knownRoutes from top plans (load only those plan files).
    for (const planMeta of knownPlans.slice(0, options.maxRoutes)) {
        if (!planMeta.planPath)
            continue;
        const { value, warning } = await readJsonIfExists(planMeta.planPath);
        if (warning) {
            warnings.push(warning);
            continue;
        }
        if (!value)
            continue;
        const route = extractRouteFromPlan(value);
        if (route.length === 0)
            continue;
        knownRoutes.push({
            route,
            sourcePlanId: planMeta.id,
            score: input.failedTarget ? computeTokenOverlapScore(input.failedTarget, route.join(" ")) : 0
        });
        planMeta.route = route;
    }
    knownRoutes.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (knownRoutes.length > options.maxRoutes) {
        knownRoutes.length = options.maxRoutes;
    }
    const snapshotCandidates = [];
    const snapshot = input.snapshot;
    if (snapshot) {
        for (const el of snapshot.elements) {
            if (!el.visible)
                continue;
            snapshotCandidates.push({
                id: el.id,
                type: el.type,
                text: el.text,
                label: el.label,
                placeholder: el.placeholder,
                name: el.name,
                role: el.role,
                tagName: el.tagName,
                dataTestid: el.dataTestid,
                domId: el.domId,
                href: el.href,
                ariaLabel: el.ariaLabel,
                title: el.title,
                className: el.className,
                candidateLocatorsCount: Array.isArray(el.candidateLocators) ? el.candidateLocators.length : 0
            });
        }
    }
    // Rank snapshot candidates by failedTarget similarity, then locator richness.
    if (input.failedTarget) {
        snapshotCandidates.sort((a, b) => {
            const aText = [a.text, a.label, a.placeholder, a.name, a.ariaLabel, a.title].filter(Boolean).join(" ");
            const bText = [b.text, b.label, b.placeholder, b.name, b.ariaLabel, b.title].filter(Boolean).join(" ");
            const sa = computeTokenOverlapScore(input.failedTarget, aText);
            const sb = computeTokenOverlapScore(input.failedTarget, bText);
            return sb - sa || (b.candidateLocatorsCount - a.candidateLocatorsCount);
        });
    }
    if (snapshotCandidates.length > options.maxSnapshotCandidates) {
        warnings.push(`snapshotCandidates limited to ${options.maxSnapshotCandidates} (had ${snapshotCandidates.length}).`);
        snapshotCandidates.length = options.maxSnapshotCandidates;
    }
    const pack = {
        version: "1.0",
        createdAt: new Date().toISOString(),
        app: {
            appSlug,
            profileName: input.fullConfig.app.appProfile,
            baseUrl: input.fullConfig.app.baseUrl,
            baseUrlHash: appProfile.baseUrlHash
        },
        case: input.currentPlan?.scenario
            ? { caseId: input.currentPlan.scenario.caseId, title: input.currentPlan.scenario.title, source: input.currentPlan.scenario.source }
            : undefined,
        failure: {
            failedReason: input.failedReason,
            failedTarget: input.failedTarget,
            failedAtStep: input.failedAtStep
        },
        currentRun: {
            outputDir: node_path_1.default.resolve(input.outputDir),
            evidenceDir: input.evidenceDir ? node_path_1.default.resolve(input.evidenceDir) : undefined,
            snapshotPath: input.snapshotPath ? node_path_1.default.resolve(input.snapshotPath) : undefined,
            candidatePlanPath: input.candidatePlanPath ? node_path_1.default.resolve(input.candidatePlanPath) : undefined,
            pendingObjectsPath: input.pendingObjectsPath ? node_path_1.default.resolve(input.pendingObjectsPath) : undefined,
            pendingPlansPath: input.pendingPlansPath ? node_path_1.default.resolve(input.pendingPlansPath) : undefined
        },
        knownObjects,
        knownPlans,
        knownRoutes,
        snapshotCandidates,
        supportedActions: input.supportedActions,
        safeData: {
            availableKeys: safeData.availableKeys ?? [],
            redacted: true
        },
        constraints: {
            codexMustOnlyWriteAgentResponseJson: true,
            doNotRunPlaywright: true,
            doNotModifyStableRegistry: true,
            doNotApproveObjectsAutomatically: true,
            doNotInventData: true
        },
        warnings
    };
    // Attach a redacted app config snapshot as a warningless hint (kept out of safeData).
    if (redactedAppConfig) {
        pack.appConfig = redactedAppConfig;
    }
    return { pack, appSlug };
}
