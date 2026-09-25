"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCaseAutomationStatus = getCaseAutomationStatus;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const automation_index_1 = require("../automations/automation-index");
const app_profile_1 = require("../automations/app-profile");
function computeAutomationStatus(entry, currentProfile) {
    if (!entry) {
        return "not_automated";
    }
    const entryProfile = (0, app_profile_1.normalizeAppSlug)(entry.appSlug ?? entry.appProfile ?? "default");
    if (currentProfile !== "default" && entryProfile !== currentProfile) {
        return "different_profile";
    }
    return entry.status;
}
function mapCaseToSummary(testCase, automationIndex, currentProfile) {
    const entry = automationIndex.get(testCase.id);
    const status = computeAutomationStatus(entry, currentProfile);
    return {
        caseId: testCase.id,
        externalId: testCase.refs,
        title: testCase.title,
        automationStatus: status,
        automationId: entry?.id,
        specPath: entry?.specPath,
        planPath: entry?.planPath,
        lastUpdated: entry?.updatedAt,
        appProfile: entry ? (0, app_profile_1.normalizeAppSlug)(entry.appSlug ?? entry.appProfile ?? "default") : undefined,
        currentProfile: currentProfile !== "default" ? currentProfile : undefined
    };
}
async function loadAllAppIndices() {
    const appsDir = "automations/apps";
    const allEntries = [];
    try {
        const appDirs = await promises_1.default.readdir(appsDir, { withFileTypes: true });
        for (const dirent of appDirs) {
            if (!dirent.isDirectory())
                continue;
            const indexPath = node_path_1.default.join(appsDir, dirent.name, "index.json");
            try {
                const index = await (0, automation_index_1.loadAutomationIndex)(indexPath);
                allEntries.push(...index.automations);
            }
            catch {
                // skip apps without index
            }
        }
    }
    catch {
        // apps dir may not exist yet
    }
    return allEntries;
}
async function getCaseAutomationStatus(cases, indexPath, options) {
    const globalIndex = await (0, automation_index_1.loadAutomationIndex)(indexPath);
    const currentProfile = (0, app_profile_1.normalizeAppSlug)(options?.currentProfile ?? process.env.APP_PROFILE ?? "default");
    const explicitAppFilter = options?.appSlug ? (0, app_profile_1.normalizeAppSlug)(options.appSlug) : undefined;
    // Collect entries from global index + per-app indices
    let allEntries = [...globalIndex.automations];
    if (options?.allApps) {
        const appEntries = await loadAllAppIndices();
        // Merge, dedup by id
        const seen = new Set(allEntries.map((e) => e.id));
        for (const entry of appEntries) {
            if (!seen.has(entry.id)) {
                allEntries.push(entry);
                seen.add(entry.id);
            }
        }
    }
    const automationMap = new Map();
    for (const entry of allEntries) {
        const entrySlug = (0, app_profile_1.normalizeAppSlug)(entry.appSlug ?? entry.appProfile ?? "default");
        if (explicitAppFilter && entrySlug !== explicitAppFilter) {
            continue;
        }
        if (entry.caseId) {
            // Prefer entries matching current profile, or non-different_profile
            const existing = automationMap.get(entry.caseId);
            if (!existing) {
                automationMap.set(entry.caseId, entry);
            }
            else {
                const existingProfile = (0, app_profile_1.normalizeAppSlug)(existing.appSlug ?? existing.appProfile ?? "default");
                const entryProfile = (0, app_profile_1.normalizeAppSlug)(entry.appSlug ?? entry.appProfile ?? "default");
                if (currentProfile !== "default" && currentProfile === entryProfile && existingProfile !== currentProfile) {
                    automationMap.set(entry.caseId, entry);
                }
            }
        }
    }
    const summaries = cases.map((testCase) => mapCaseToSummary(testCase, automationMap, currentProfile));
    const automatedCount = summaries.filter((s) => s.automationStatus === "active" || s.automationStatus === "draft").length;
    return {
        cases: summaries,
        totalCount: summaries.length,
        automatedCount,
        notAutomatedCount: summaries.length - automatedCount,
        fetchedAt: new Date().toISOString()
    };
}
