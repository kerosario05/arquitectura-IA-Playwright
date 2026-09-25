"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFlowRegistryPath = getFlowRegistryPath;
exports.loadFlowRegistry = loadFlowRegistry;
exports.saveFlowRegistry = saveFlowRegistry;
exports.ensureFlowRegistry = ensureFlowRegistry;
exports.findFlowByIntent = findFlowByIntent;
exports.registerFlowCandidate = registerFlowCandidate;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const app_profile_1 = require("./app-profile");
const REGISTRY_VERSION = "1.0";
function createEmptyRegistry(appSlug) {
    return {
        version: REGISTRY_VERSION,
        appSlug,
        flows: [],
        updatedAt: new Date().toISOString()
    };
}
function getFlowRegistryPath(appProfile, outputRoot) {
    const paths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, undefined, outputRoot);
    return paths.flowsIndexPath;
}
async function loadFlowRegistry(appProfile, outputRoot) {
    const registryPath = getFlowRegistryPath(appProfile, outputRoot);
    try {
        const raw = await promises_1.default.readFile(registryPath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return createEmptyRegistry(appProfile.appSlug);
    }
}
async function saveFlowRegistry(registry, appProfile, outputRoot) {
    const registryPath = getFlowRegistryPath(appProfile, outputRoot);
    registry.updatedAt = new Date().toISOString();
    await promises_1.default.mkdir(node_path_1.default.dirname(registryPath), { recursive: true });
    await promises_1.default.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}
async function ensureFlowRegistry(appProfile, outputRoot) {
    const registryPath = getFlowRegistryPath(appProfile, outputRoot);
    try {
        await promises_1.default.access(registryPath);
        return loadFlowRegistry(appProfile, outputRoot);
    }
    catch {
        const empty = createEmptyRegistry(appProfile.appSlug);
        await saveFlowRegistry(empty, appProfile, outputRoot);
        return empty;
    }
}
function findFlowByIntent(registry, intent) {
    return registry.flows.find((f) => f.name.toLowerCase().includes(intent.toLowerCase()) && f.status === "active");
}
async function registerFlowCandidate(registry, candidate) {
    const existing = registry.flows.find((f) => f.name === candidate.name && f.status !== "active");
    if (existing)
        return { registry, created: false };
    const now = new Date().toISOString();
    const flow = {
        id: `flow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: candidate.name,
        filePath: node_path_1.default.join("flows", `${candidate.name.replace(/\s+/g, "-").toLowerCase()}.flow.ts`),
        steps: candidate.steps,
        requiredDataKeys: candidate.requiredDataKeys ?? [],
        sensitiveActions: candidate.sensitiveActions ?? [],
        reusableAcrossCases: false,
        confidence: candidate.confidence ?? 0.5,
        status: "candidate",
        createdAt: now,
        updatedAt: now
    };
    registry.flows.push(flow);
    return { registry, created: true };
}
