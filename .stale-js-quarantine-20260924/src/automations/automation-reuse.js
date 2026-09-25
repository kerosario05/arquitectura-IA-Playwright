"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFunctionalCode = extractFunctionalCode;
exports.normalizeTitle = normalizeTitle;
exports.validatePromotedArtifactForReuse = validatePromotedArtifactForReuse;
exports.findReusableAutomation = findReusableAutomation;
exports.loadAutomationPlan = loadAutomationPlan;
exports.cloneExecutionPlan = cloneExecutionPlan;
exports.findAndCloneReusablePlan = findAndCloneReusablePlan;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const automation_index_1 = require("./automation-index");
const execution_plan_validator_1 = require("../plans/execution-plan-validator");
const FUNCTIONAL_CODE_RE = /\bC(\d{4,6})\b/;
function extractFunctionalCode(title) {
    const match = title.match(FUNCTIONAL_CODE_RE);
    return match ? `C${match[1]}` : undefined;
}
function normalizeTitle(title) {
    return title
        .replace(/\bC\d{4,6}\b\s*[-–—]?\s*/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}
function validatePromotedArtifactForReuse(entry, physical) {
    if (entry.status !== "active")
        return { valid: false, reason: "not_active" };
    if (entry.specVerificationStatus !== "passed")
        return { valid: false, reason: "verification_not_passed" };
    const rawEntry = entry;
    const promotion = rawEntry.promotion ?? rawEntry;
    if (promotion.promotionPersisted !== true)
        return { valid: false, reason: "promotion_not_persisted" };
    if (!physical.specExists)
        return { valid: false, reason: "promoted_spec_missing" };
    if (typeof promotion.promotedSpecHash !== "string" || !promotion.promotedSpecHash) {
        return { valid: false, reason: "promoted_spec_hash_missing" };
    }
    if (typeof promotion.promotedSpecPath !== "string" || !promotion.promotedSpecPath) {
        return { valid: false, reason: "promoted_spec_missing" };
    }
    const entrySpecPath = node_path_1.default.resolve(entry.specPath);
    const physicalSpecPath = node_path_1.default.resolve(physical.specPath);
    if (entry.appSlug !== physical.appSlug
        || entry.caseId !== physical.caseId
        || entrySpecPath !== physicalSpecPath
        || node_path_1.default.resolve(promotion.promotedSpecPath) !== physicalSpecPath
        || !physical.sectionSlug
        || !node_path_1.default.normalize(physicalSpecPath).toLowerCase().includes(`${node_path_1.default.sep}sections${node_path_1.default.sep}${physical.sectionSlug.toLowerCase()}${node_path_1.default.sep}`)
        || !node_path_1.default.basename(node_path_1.default.dirname(physicalSpecPath)).toLowerCase().startsWith("c")) {
        return { valid: false, reason: "identity_mismatch" };
    }
    const physicalHash = (0, node_crypto_1.createHash)("sha256").update(physical.specText ?? "", "utf8").digest("hex");
    if (physicalHash !== promotion.promotedSpecHash)
        return { valid: false, reason: "promoted_spec_hash_mismatch" };
    return { valid: true };
}
function findReusableAutomation(targetCaseId, targetTitle, automations, physicalContexts) {
    const targetCode = extractFunctionalCode(targetTitle);
    const targetNormalized = normalizeTitle(targetTitle);
    const sameCaseMatch = automations.find((entry) => entry.caseId === targetCaseId && entry.status === "active"
        && (!physicalContexts || (() => {
            const physical = physicalContexts.get(entry.id);
            return physical !== undefined && validatePromotedArtifactForReuse(entry, physical).valid;
        })()));
    if (sameCaseMatch) {
        return {
            entry: sameCaseMatch,
            matchType: "same_case",
            confidence: 1
        };
    }
    let bestMatch;
    for (const entry of automations) {
        if (entry.caseId === targetCaseId) {
            continue;
        }
        if (entry.status !== "active") {
            continue;
        }
        if (physicalContexts) {
            const physical = physicalContexts.get(entry.id);
            if (!physical || !validatePromotedArtifactForReuse(entry, physical).valid)
                continue;
        }
        const entryCode = extractFunctionalCode(entry.title);
        const entryNormalized = normalizeTitle(entry.title);
        if (targetCode && entryCode && targetCode === entryCode) {
            const match = { entry, matchType: "functional_code", confidence: 0.95 };
            if (!bestMatch || match.confidence > bestMatch.confidence) {
                bestMatch = match;
            }
            continue;
        }
        if (targetNormalized && entryNormalized && targetNormalized === entryNormalized && targetNormalized.length > 5) {
            const match = { entry, matchType: "normalized_title", confidence: 0.8 };
            if (!bestMatch || match.confidence > bestMatch.confidence) {
                bestMatch = match;
            }
        }
    }
    return bestMatch;
}
async function loadAutomationPlan(planPath) {
    const content = await promises_1.default.readFile(planPath, "utf-8");
    return JSON.parse(content);
}
function cloneExecutionPlan(plan, newCaseId, newTitle, sourceAutomationId) {
    const clonedScenario = {
        ...plan.scenario,
        caseId: newCaseId,
        title: newTitle
    };
    return {
        ...plan,
        scenario: clonedScenario,
        notes: [
            ...(plan.notes ?? []),
            `Reused from automation: ${sourceAutomationId}`
        ]
    };
}
async function findAndCloneReusablePlan(targetCaseId, targetTitle, indexPath) {
    const index = await (0, automation_index_1.loadAutomationIndex)(indexPath);
    if (index.automations.length === 0) {
        return undefined;
    }
    const physicalContexts = new Map();
    await Promise.all(index.automations.filter((entry) => entry.status === "active").map(async (entry) => {
        const specPath = node_path_1.default.resolve(entry.specPath);
        try {
            physicalContexts.set(entry.id, {
                specPath,
                specExists: true,
                specText: await promises_1.default.readFile(specPath, "utf8"),
                appSlug: entry.appSlug ?? "",
                sectionSlug: specPath.match(/[\\/]sections[\\/]([^\\/]+)[\\/]cases[\\/]/i)?.[1] ?? "",
                caseId: entry.caseId ?? 0,
            });
        }
        catch {
            physicalContexts.set(entry.id, { specPath, specExists: false, appSlug: entry.appSlug ?? "", sectionSlug: "", caseId: entry.caseId ?? 0 });
        }
    }));
    const match = findReusableAutomation(targetCaseId, targetTitle, index.automations, physicalContexts);
    if (!match) {
        return undefined;
    }
    const plan = await loadAutomationPlan(match.entry.planPath);
    const validation = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    if (!validation.valid) {
        return undefined;
    }
    const clonedPlan = cloneExecutionPlan(plan, targetCaseId, targetTitle, match.entry.id);
    return { plan: clonedPlan, match };
}
