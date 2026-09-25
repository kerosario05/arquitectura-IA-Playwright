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
exports.buildEvidenceRunDir = buildEvidenceRunDir;
exports.buildEvidenceRunPaths = buildEvidenceRunPaths;
exports.buildEvidenceScenarioDir = buildEvidenceScenarioDir;
exports.buildEvidencePaths = buildEvidencePaths;
exports.buildScreenshotFilename = buildScreenshotFilename;
exports.validateNoPathTraversal = validateNoPathTraversal;
const path = __importStar(require("node:path"));
function sanitizeSlug(input) {
    if (input.includes("..") || input.includes("/") || input.includes("\\")) {
        throw new Error(`Path traversal detected in slug: ${input}`);
    }
    return input.replace(/[^a-zA-Z0-9_-]/g, "").trim();
}
function buildEvidenceRunDir(context) {
    const root = context.outputRoot ?? ".artifacts/evidence";
    const appSlug = sanitizeSlug(context.appSlug);
    const sectionSlug = sanitizeSlug(context.sectionSlug);
    const runId = sanitizeSlug(context.runId);
    if (!appSlug || !sectionSlug || !runId) {
        throw new Error(`Invalid run context: appSlug=${context.appSlug} sectionSlug=${context.sectionSlug} runId=${context.runId}`);
    }
    return path.join(root, appSlug, sectionSlug, "runs", runId);
}
function buildEvidenceRunPaths(context) {
    const runDir = buildEvidenceRunDir(context);
    const scenariosDir = path.join(runDir, "scenarios");
    return {
        runDir,
        scenariosDir,
        evidenceJsonPath: path.join(runDir, "evidence-run.json"),
        docxPath: path.join(runDir, "evidencia.docx"),
    };
}
function buildEvidenceScenarioDir(context) {
    const root = context.outputRoot ?? ".artifacts/evidence";
    const appSlug = sanitizeSlug(context.appSlug);
    const sectionSlug = sanitizeSlug(context.sectionSlug);
    const scenarioId = sanitizeSlug(context.scenarioId);
    if (!appSlug || !sectionSlug || !scenarioId) {
        throw new Error(`Invalid evidence context: appSlug=${context.appSlug} sectionSlug=${context.sectionSlug} scenarioId=${context.scenarioId}`);
    }
    // If runId is provided, use runs structure
    if (context.runId) {
        const runId = sanitizeSlug(context.runId);
        return path.join(root, appSlug, sectionSlug, "runs", runId, "scenarios", scenarioId);
    }
    // Legacy: direct scenario dir (for standalone discovery)
    return path.join(root, appSlug, sectionSlug, scenarioId);
}
function buildEvidencePaths(context) {
    const scenarioDir = buildEvidenceScenarioDir(context);
    const screenshotsDir = path.join(scenarioDir, "screenshots");
    const snapshotsDir = path.join(scenarioDir, "snapshots");
    return {
        scenarioDir,
        screenshotsDir,
        snapshotsDir,
        evidenceJsonPath: path.join(scenarioDir, "evidence.json"),
        docxPath: path.join(scenarioDir, "evidencia.docx"),
    };
}
function buildScreenshotFilename(stepIndex, stepText) {
    const sanitized = stepText
        .toLowerCase()
        .replace(/[^a-z0-9áéíóúñü\s]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .substring(0, 50);
    const indexStr = Number.isInteger(stepIndex)
        ? String(stepIndex).padStart(3, "0")
        : `${String(Math.floor(stepIndex)).padStart(3, "0")}-5`;
    return `step-${indexStr}-${sanitized}.png`;
}
function validateNoPathTraversal(input) {
    const normalized = path.normalize(input);
    if (normalized.includes("..")) {
        throw new Error(`Path traversal detected: ${input}`);
    }
    return normalized;
}
