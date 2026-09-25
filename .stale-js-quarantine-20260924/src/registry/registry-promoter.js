"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRegistryPromotionReport = buildRegistryPromotionReport;
exports.applyRegistryPromotion = applyRegistryPromotion;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const automation_naming_1 = require("../automations/automation-naming");
const assertion_resolver_1 = require("../discovery/assertion-resolver");
const execution_plan_validator_1 = require("../plans/execution-plan-validator");
const index_1 = require("./index");
const DEFAULT_REGISTRY_PATH = node_path_1.default.resolve("src/registry/object-registry.json");
const GLOBAL_NAVIGATION_TOKENS = new Set([
    "back",
    "cancel",
    "close",
    "exit",
    "home",
    "logout",
    "menu",
    "return",
    "salir",
    "volver",
    "cerrar",
    "cancelar",
    "inicio",
    "menu"
]);
function normalizeText(value) {
    return (value ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
}
function normalizeAliases(aliases) {
    return [...new Set((aliases ?? []).map((alias) => normalizeText(alias)).filter(Boolean))].sort();
}
function normalizeLocator(locator) {
    return JSON.stringify({
        strategy: locator.strategy,
        value: normalizeText(locator.value),
        role: normalizeText(locator.role),
        name: normalizeText(locator.name),
        exact: locator.exact ?? false
    });
}
function isActionableObject(object) {
    return ["button", "link", "input", "select", "checkbox", "radio"].includes(object.type)
        || object.locator.strategy === "role" && ["button", "link"].includes(normalizeText(object.locator.role));
}
function isSectionLike(object) {
    return object.type === "section" || object.type === "card" || object.type === "text" || object.type === "table";
}
function isGlobalNavigationObject(object) {
    const tokens = new Set([
        ...normalizeText(object.key).split(/[\s_\-]+/).filter(Boolean),
        ...normalizeText(object.name).split(/\s+/).filter(Boolean),
        ...normalizeAliases(object.aliases).flatMap((alias) => alias.split(/\s+/).filter(Boolean))
    ]);
    for (const token of tokens) {
        if (GLOBAL_NAVIGATION_TOKENS.has(token)) {
            return true;
        }
    }
    return false;
}
function planUsesObject(plan, object) {
    const targetTexts = new Set();
    for (const step of plan.steps) {
        if (step.target && typeof step.target === "object") {
            if (step.target.value)
                targetTexts.add(normalizeText(step.target.value));
            if (step.target.name)
                targetTexts.add(normalizeText(step.target.name));
            if (step.target.hint)
                targetTexts.add(normalizeText(step.target.hint));
        }
        if (step.expected)
            targetTexts.add(normalizeText(step.expected));
    }
    const candidates = new Set([
        normalizeText(object.key),
        normalizeText(object.name),
        normalizeText(object.locator.value),
        normalizeText(object.locator.name),
        ...normalizeAliases(object.aliases)
    ]);
    for (const candidate of candidates) {
        if (candidate && targetTexts.has(candidate)) {
            return true;
        }
    }
    return false;
}
function validatePromotablePlan(plan) {
    const warnings = [];
    const validation = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    if (!validation.valid || plan.status !== "validated") {
        throw new Error("Discovered plan is not eligible for promotion because it is not validated.");
    }
    if (!plan.scenario.caseId || !plan.scenario.title) {
        throw new Error("Discovered plan must include scenario.caseId and scenario.title.");
    }
    if (!plan.steps.length) {
        throw new Error("Discovered plan must include executable steps.");
    }
    for (const step of plan.steps) {
        if (step.action === "assertText" && step.expected) {
            const classification = (0, assertion_resolver_1.classifyAssertion)(step.expected);
            if (classification === "semantic_descriptor" || classification === "composite_assertion" || classification === "ambiguous_assertion") {
                throw new Error(`Discovered plan contains weak literal assertion "${step.expected}".`);
            }
        }
    }
    if (!plan.steps.some((step) => step.action !== "noop")) {
        throw new Error("Discovered plan does not contain executable steps.");
    }
    warnings.push(...validation.issues.filter((issue) => issue.level === "warning").map((issue) => issue.message));
    return warnings;
}
function deduplicatePendingObjects(objects) {
    const byKey = new Map();
    const byNameAndType = new Map();
    const duplicatesMerged = [];
    const conflicts = [];
    for (const object of objects) {
        const normalizedKey = normalizeText(object.key);
        const normalizedLocator = normalizeLocator(object.locator);
        const normalizedNameAndType = `${normalizeText(object.name)}::${object.type}`;
        const existing = byKey.get(normalizedKey);
        if (existing) {
            const existingLocator = normalizeLocator(existing.locator);
            if (existingLocator === normalizedLocator) {
                const preferred = (existing.confidence >= object.confidence ? existing : object);
                const dropped = preferred === existing ? object : existing;
                byKey.set(normalizedKey, preferred);
                byNameAndType.set(normalizedNameAndType, preferred);
                duplicatesMerged.push({
                    keptKey: preferred.key,
                    droppedKeys: [dropped.key],
                    reason: "Same normalized key and locator."
                });
                continue;
            }
            conflicts.push({
                key: object.key,
                existingLocator,
                incomingLocator: normalizedLocator,
                reason: "Same normalized key with different locator."
            });
            continue;
        }
        const existingByNameAndType = byNameAndType.get(normalizedNameAndType);
        if (existingByNameAndType && normalizeText(existingByNameAndType.key) !== normalizedKey) {
            const existingByNameAndTypeLocator = normalizeLocator(existingByNameAndType.locator);
            if (existingByNameAndTypeLocator === normalizedLocator) {
                const preferred = (existingByNameAndType.confidence >= object.confidence ? existingByNameAndType : object);
                const dropped = preferred === existingByNameAndType ? object : existingByNameAndType;
                byKey.delete(normalizeText(dropped.key));
                byKey.set(normalizeText(preferred.key), preferred);
                byNameAndType.set(normalizedNameAndType, preferred);
                duplicatesMerged.push({
                    keptKey: preferred.key,
                    droppedKeys: [dropped.key],
                    reason: "Equivalent normalized name/type and locator; kept higher confidence candidate."
                });
                continue;
            }
            const preferred = (existingByNameAndType.confidence >= object.confidence ? existingByNameAndType : object);
            const dropped = preferred === existingByNameAndType ? object : existingByNameAndType;
            byKey.delete(normalizeText(dropped.key));
            byKey.set(normalizeText(preferred.key), preferred);
            byNameAndType.set(normalizedNameAndType, preferred);
            duplicatesMerged.push({
                keptKey: preferred.key,
                droppedKeys: [dropped.key],
                reason: "Same normalized name and equivalent type; kept higher confidence candidate."
            });
            continue;
        }
        byKey.set(normalizedKey, object);
        byNameAndType.set(normalizedNameAndType, object);
    }
    return {
        deduped: Array.from(byKey.values()),
        duplicatesMerged,
        conflicts
    };
}
function filterObjectsForPromotion(objects, plan, options) {
    const objectsToPromote = [];
    const objectsSkipped = [];
    for (const object of objects) {
        if (object.confidence < options.confidenceThreshold) {
            objectsSkipped.push({ object, reason: `Below confidence threshold ${options.confidenceThreshold}.` });
            continue;
        }
        const usedByPlan = planUsesObject(plan, object);
        const actionable = isActionableObject(object);
        const globalNavigation = isGlobalNavigationObject(object);
        const sectionLike = isSectionLike(object);
        if (options.excludeGlobalNavigation && globalNavigation && !usedByPlan) {
            objectsSkipped.push({ object, reason: "Excluded global/navigation object not used by plan." });
            continue;
        }
        if (actionable && usedByPlan) {
            objectsToPromote.push({
                key: object.key,
                name: object.name,
                type: object.type,
                locator: object.locator,
                aliases: object.aliases,
                stable: true,
                tags: ["promoted", "discovery", `confidence:${object.confidence.toFixed(2)}`]
            });
            continue;
        }
        if (sectionLike && !options.includeSections) {
            objectsSkipped.push({ object, reason: "Informational/section object filtered by default." });
            continue;
        }
        if (sectionLike && options.includeSections && usedByPlan) {
            objectsToPromote.push({
                key: object.key,
                name: object.name,
                type: object.type,
                locator: object.locator,
                aliases: object.aliases,
                stable: true,
                tags: ["promoted", "discovery", "section", `confidence:${object.confidence.toFixed(2)}`]
            });
            continue;
        }
        objectsSkipped.push({ object, reason: "Object is not actionable for stable promotion or not used by the validated plan." });
    }
    return { objectsToPromote, objectsSkipped };
}
function reconcileWithStableRegistry(objectsToPromote, registry) {
    const duplicatesMerged = [];
    const conflicts = [];
    const stableByKey = new Map(registry.objects.map((object) => [normalizeText(object.key), object]));
    const filtered = [];
    for (const object of objectsToPromote) {
        const existing = stableByKey.get(normalizeText(object.key));
        if (!existing) {
            filtered.push(object);
            continue;
        }
        if (normalizeLocator(existing.locator) === normalizeLocator(object.locator)) {
            duplicatesMerged.push({
                keptKey: existing.key,
                droppedKeys: [object.key],
                reason: "Already present in stable registry with same locator."
            });
            continue;
        }
        conflicts.push({
            key: object.key,
            existingLocator: normalizeLocator(existing.locator),
            incomingLocator: normalizeLocator(object.locator),
            reason: "Stable registry already contains the same key with a different locator."
        });
    }
    return { objectsToPromote: filtered, duplicatesMerged, conflicts };
}
async function readPendingArtifacts(fromDir) {
    const objectsPath = node_path_1.default.join(fromDir, "discovered-objects.pending.json");
    const planPath = node_path_1.default.join(fromDir, "discovered-plans.pending.json");
    const [objectsContent, planContent] = await Promise.all([
        promises_1.default.readFile(objectsPath, "utf-8"),
        promises_1.default.readFile(planPath, "utf-8")
    ]);
    return {
        objects: JSON.parse(objectsContent),
        plan: JSON.parse(planContent)
    };
}
async function writeRegistryWithBackup(registry, registryPath) {
    const backupPath = `${registryPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await promises_1.default.copyFile(registryPath, backupPath);
    await (0, index_1.saveObjectRegistry)(registry, registryPath);
    return backupPath;
}
async function buildRegistryPromotionReport(options, registryPath = DEFAULT_REGISTRY_PATH) {
    const fromDir = node_path_1.default.resolve(options.fromDir);
    const registry = await (0, index_1.loadObjectRegistry)(registryPath);
    const { objects, plan } = await readPendingArtifacts(fromDir);
    const warnings = validatePromotablePlan(plan);
    const { deduped, duplicatesMerged, conflicts } = deduplicatePendingObjects(objects);
    const filteredPromotion = filterObjectsForPromotion(deduped, plan, options);
    const reconciled = reconcileWithStableRegistry(options.promoteObjects ? filteredPromotion.objectsToPromote : [], registry);
    return {
        mode: options.approve ? "approved" : "dry_run",
        fromDir,
        objectsToPromote: reconciled.objectsToPromote,
        objectsSkipped: filteredPromotion.objectsSkipped,
        duplicatesMerged: [...duplicatesMerged, ...reconciled.duplicatesMerged],
        conflicts: [...conflicts, ...reconciled.conflicts],
        planToPromote: options.promotePlan || options.promoteAutomation ? plan : undefined,
        automationToCreate: options.promoteAutomation
            ? {
                id: (0, automation_naming_1.buildAutomationId)({
                    externalId: plan.scenario.externalId,
                    caseId: plan.scenario.caseId,
                    title: plan.scenario.title
                }),
                caseId: plan.scenario.caseId,
                title: plan.scenario.title
            }
            : undefined,
        warnings,
        registryPath,
        registryWritten: false
    };
}
async function applyRegistryPromotion(report, registryPath = DEFAULT_REGISTRY_PATH) {
    if (!report.objectsToPromote.length) {
        return report;
    }
    const registry = await (0, index_1.loadObjectRegistry)(registryPath);
    const existingByKey = new Map(registry.objects.map((object) => [normalizeText(object.key), object]));
    const nextObjects = [...registry.objects];
    for (const object of report.objectsToPromote) {
        const existing = existingByKey.get(normalizeText(object.key));
        if (existing) {
            const sameLocator = normalizeLocator(existing.locator) === normalizeLocator(object.locator);
            if (!sameLocator) {
                throw new Error(`Registry conflict while promoting key "${object.key}". Existing stable registry uses a different locator.`);
            }
            continue;
        }
        nextObjects.push(object);
    }
    const nextRegistry = {
        ...registry,
        objects: nextObjects,
        updatedAt: new Date().toISOString()
    };
    const validation = (0, index_1.validateObjectRegistry)(nextRegistry);
    if (!validation.valid) {
        const errors = validation.issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join("; ");
        throw new Error(`Promoted registry is invalid: ${errors}`);
    }
    const backupPath = await writeRegistryWithBackup(nextRegistry, registryPath);
    return {
        ...report,
        registryWritten: true,
        backupPath
    };
}
