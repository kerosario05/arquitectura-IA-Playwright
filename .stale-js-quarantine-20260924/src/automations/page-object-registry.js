"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPageObjectRegistryPath = getPageObjectRegistryPath;
exports.loadPageObjectRegistry = loadPageObjectRegistry;
exports.savePageObjectRegistry = savePageObjectRegistry;
exports.ensurePageObjectRegistry = ensurePageObjectRegistry;
exports.findPageObjectByScreenSignature = findPageObjectByScreenSignature;
exports.findMethodForIntent = findMethodForIntent;
exports.findCandidatePageObjectByScreenSignature = findCandidatePageObjectByScreenSignature;
exports.findReusableMethod = findReusableMethod;
exports.findMethodBySemanticIntent = findMethodBySemanticIntent;
exports.registerPageObjectCandidate = registerPageObjectCandidate;
exports.registerMethodCandidate = registerMethodCandidate;
exports.markPageObjectActive = markPageObjectActive;
exports.markMethodActive = markMethodActive;
exports.registerComponentCandidate = registerComponentCandidate;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const pom_ownership_1 = require("../types/pom-ownership");
const app_profile_1 = require("./app-profile");
const REGISTRY_VERSION = "1.0";
const REGISTRY_READ_RETRIES = 3;
const REGISTRY_RETRY_DELAY_MS = 50;
function createEmptyRegistry(appSlug) {
    return {
        version: REGISTRY_VERSION,
        appSlug,
        pageObjects: [],
        componentCandidates: [],
        updatedAt: new Date().toISOString()
    };
}
function isMissingFileError(error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
function isTransientFsError(error) {
    const code = error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    return code === "EBUSY" || code === "EPERM" || code === "EACCES" || code === "EMFILE" || code === "ENFILE";
}
async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function readRegistryFileWithRetry(registryPath) {
    for (let attempt = 0; attempt <= REGISTRY_READ_RETRIES; attempt++) {
        try {
            return await promises_1.default.readFile(registryPath, "utf-8");
        }
        catch (error) {
            if (isMissingFileError(error)) {
                return undefined;
            }
            if (isTransientFsError(error) && attempt < REGISTRY_READ_RETRIES) {
                await delay(REGISTRY_RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            throw error;
        }
    }
    return undefined;
}
function parseRegistryJson(raw, registryPath) {
    try {
        return JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Invalid JSON in page object registry at "${registryPath}". ` +
            `The file exists but could not be parsed. ` +
            `Cause: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function writeFileAtomic(filePath, content) {
    const dir = node_path_1.default.dirname(filePath);
    const tempPath = node_path_1.default.join(dir, `${node_path_1.default.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    await promises_1.default.mkdir(dir, { recursive: true });
    await promises_1.default.writeFile(tempPath, content, "utf-8");
    try {
        await promises_1.default.rename(tempPath, filePath);
    }
    catch (error) {
        if (isTransientFsError(error) || (error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
            await promises_1.default.rm(filePath, { force: true });
            await promises_1.default.rename(tempPath, filePath);
        }
        else {
            await promises_1.default.rm(tempPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
}
function getPageObjectRegistryPath(appProfile, outputRoot) {
    const paths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, undefined, outputRoot);
    return paths.pageObjectsIndexPath;
}
async function loadPageObjectRegistry(appProfile, outputRoot) {
    const registryPath = getPageObjectRegistryPath(appProfile, outputRoot);
    await promises_1.default.mkdir(node_path_1.default.dirname(registryPath), { recursive: true });
    const raw = await readRegistryFileWithRetry(registryPath);
    if (raw === undefined) {
        return createEmptyRegistry(appProfile.appSlug);
    }
    return parseRegistryJson(raw, registryPath);
}
async function savePageObjectRegistry(registry, appProfile, outputRoot) {
    const registryPath = getPageObjectRegistryPath(appProfile, outputRoot);
    registry.updatedAt = new Date().toISOString();
    await writeFileAtomic(registryPath, JSON.stringify(registry, null, 2));
}
async function ensurePageObjectRegistry(appProfile, outputRoot) {
    const registryPath = getPageObjectRegistryPath(appProfile, outputRoot);
    try {
        await promises_1.default.access(registryPath);
        return loadPageObjectRegistry(appProfile, outputRoot);
    }
    catch {
        const empty = createEmptyRegistry(appProfile.appSlug);
        await savePageObjectRegistry(empty, appProfile, outputRoot);
        return empty;
    }
}
function findPageObjectByScreenSignature(registry, screenSignature) {
    return registry.pageObjects.find((po) => po.screenSignature === screenSignature && po.status === "active");
}
function findMethodForIntent(pageObject, intent) {
    if (!pageObject)
        return undefined;
    return pageObject.methods.find((m) => m.intent === intent && m.available);
}
function findCandidatePageObjectByScreenSignature(registry, screenSignature) {
    return registry.pageObjects.find((po) => po.screenSignature === screenSignature);
}
function findReusableMethod(registry, intent, screenSignature) {
    if (screenSignature) {
        const po = findPageObjectByScreenSignature(registry, screenSignature);
        const method = findMethodForIntent(po, intent);
        if (po && method)
            return { pageObject: po, method };
    }
    for (const po of registry.pageObjects.filter((p) => p.status === "active")) {
        const method = po.methods.find((m) => m.intent === intent && m.available);
        if (method)
            return { pageObject: po, method };
    }
    return undefined;
}
function findMethodBySemanticIntent(registry, intent, step) {
    const preferredOwner = pom_ownership_1.INTENT_PREFERRED_OWNER[intent];
    if (preferredOwner) {
        const ownerPO = registry.pageObjects.find((po) => po.className === preferredOwner && po.status === "active");
        if (ownerPO) {
            // First try to find by intent
            let method = ownerPO.methods.find((m) => m.intent === intent && m.status === "active" && m.available);
            // Fallback: try to find by method name using METHOD_INTENT_NAME_MAP
            if (!method) {
                const expectedMethodName = pom_ownership_1.METHOD_INTENT_NAME_MAP[intent];
                if (expectedMethodName) {
                    method = ownerPO.methods.find((m) => m.name === expectedMethodName && m.status === "active" && m.available);
                }
            }
            if (method)
                return { pageObject: ownerPO, method };
        }
    }
    const allowedClasses = pom_ownership_1.INTENT_CLASS_OWNERSHIP[intent];
    for (const po of registry.pageObjects.filter((p) => p.status === "active")) {
        if (allowedClasses && !allowedClasses.includes(po.className))
            continue;
        // First try to find by intent
        let method = po.methods.find((m) => m.intent === intent && m.status === "active" && m.available);
        // Fallback: try to find by method name using METHOD_INTENT_NAME_MAP
        if (!method) {
            const expectedMethodName = pom_ownership_1.METHOD_INTENT_NAME_MAP[intent];
            if (expectedMethodName) {
                method = po.methods.find((m) => m.name === expectedMethodName && m.status === "active" && m.available);
            }
        }
        if (method)
            return { pageObject: po, method };
    }
    return undefined;
}
function registerPageObjectCandidate(registry, candidate) {
    const now = new Date().toISOString();
    const existing = registry.pageObjects.find((po) => po.screenSignature === candidate.screenSignature);
    if (existing) {
        if (!existing.sourcePlanIds.includes(candidate.sourcePlanId)) {
            existing.sourcePlanIds.push(candidate.sourcePlanId);
        }
        return { registry, created: false };
    }
    const entry = {
        id: `po_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        className: candidate.className,
        filePath: node_path_1.default.join("pages", `${candidate.className.replace(/Page$/, "").toLowerCase().replace(/-/g, "")}.page.ts`),
        screenSignature: candidate.screenSignature,
        methods: (candidate.methods ?? []).map((m) => ({
            name: m.name,
            intent: m.intent,
            parameters: m.parameters ?? [],
            available: false,
            source: "candidate",
            sensitive: false,
            confidence: candidate.confidence,
            status: "candidate"
        })),
        confidence: candidate.confidence,
        status: "candidate",
        sourcePlanIds: [candidate.sourcePlanId],
        caseIds: [],
        createdAt: now,
        updatedAt: now
    };
    registry.pageObjects.push(entry);
    return { registry, created: true };
}
function registerMethodCandidate(registry, pageObjectId, candidate) {
    const po = registry.pageObjects.find((p) => p.id === pageObjectId);
    if (!po)
        return { registry, created: false };
    const existing = po.methods.find((m) => m.intent === candidate.intent);
    if (existing) {
        const existingSource = existing.source ?? "";
        if (!existingSource.includes(candidate.sourceActionId)) {
            existing.source = existingSource ? `${existingSource},${candidate.sourceActionId}` : candidate.sourceActionId;
        }
        if (candidate.parameters && candidate.parameters.length > 0 && existing.parameters.length === 0) {
            existing.parameters = [...candidate.parameters];
        }
        return { registry, created: false };
    }
    const now = new Date().toISOString();
    const method = {
        name: candidate.name,
        intent: candidate.intent,
        parameters: candidate.parameters ?? [],
        available: false,
        source: candidate.sourceActionId,
        sensitive: candidate.sensitive ?? false,
        confidence: candidate.confidence ?? 0.5,
        status: "candidate"
    };
    po.methods.push(method);
    po.updatedAt = now;
    return { registry, created: true };
}
function markPageObjectActive(registry, pageObjectId) {
    const po = registry.pageObjects.find((p) => p.id === pageObjectId);
    if (!po || po.status === "active")
        return false;
    po.status = "active";
    po.updatedAt = new Date().toISOString();
    return true;
}
function markMethodActive(registry, pageObjectId, methodName) {
    const po = registry.pageObjects.find((p) => p.id === pageObjectId);
    if (!po)
        return false;
    const method = po.methods.find((m) => m.name === methodName);
    if (!method || method.status === "active")
        return false;
    method.status = "active";
    method.available = true;
    po.updatedAt = new Date().toISOString();
    return true;
}
function registerComponentCandidate(registry, candidate) {
    const existing = registry.componentCandidates.find((cc) => cc.componentSignature === candidate.componentSignature);
    if (existing)
        return { registry, created: false };
    const now = new Date().toISOString();
    registry.componentCandidates.push({
        id: `comp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: candidate.name,
        className: candidate.className,
        filePath: node_path_1.default.join("components", `${candidate.className.replace(/Component$/, "").toLowerCase()}.component.ts`),
        componentSignature: candidate.componentSignature,
        methods: [],
        confidence: candidate.confidence,
        status: "candidate",
        createdAt: now,
        updatedAt: now
    });
    return { registry, created: true };
}
