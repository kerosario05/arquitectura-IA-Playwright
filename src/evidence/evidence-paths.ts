import * as path from "node:path";
import type { EvidenceScenarioContext, EvidenceRunContext } from "./evidence-types";

function sanitizeSlug(input: string): string {
  if (input.includes("..") || input.includes("/") || input.includes("\\")) {
    throw new Error(`Path traversal detected in slug: ${input}`);
  }
  return input.replace(/[^a-zA-Z0-9_-]/g, "").trim();
}

export function buildEvidenceRunDir(context: EvidenceRunContext): string {
  const root = context.outputRoot ?? ".artifacts/evidence";
  const appSlug = sanitizeSlug(context.appSlug);
  const sectionSlug = sanitizeSlug(context.sectionSlug);
  const runId = sanitizeSlug(context.runId);

  if (!appSlug || !sectionSlug || !runId) {
    throw new Error(`Invalid run context: appSlug=${context.appSlug} sectionSlug=${context.sectionSlug} runId=${context.runId}`);
  }

  return path.join(root, appSlug, sectionSlug, "runs", runId);
}

export function buildEvidenceRunPaths(context: EvidenceRunContext): {
  runDir: string;
  scenariosDir: string;
  evidenceJsonPath: string;
  docxPath: string;
} {
  const runDir = buildEvidenceRunDir(context);
  const scenariosDir = path.join(runDir, "scenarios");
  return {
    runDir,
    scenariosDir,
    evidenceJsonPath: path.join(runDir, "evidence-run.json"),
    docxPath: path.join(runDir, "evidencia.docx"),
  };
}

export function buildEvidenceScenarioDir(context: EvidenceScenarioContext): string {
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

export function buildEvidencePaths(context: EvidenceScenarioContext): {
  scenarioDir: string;
  screenshotsDir: string;
  snapshotsDir: string;
  evidenceJsonPath: string;
  docxPath: string;
} {
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

export function buildScreenshotFilename(stepIndex: number, stepText: string): string {
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

export function validateNoPathTraversal(input: string): string {
  const normalized = path.normalize(input);
  if (normalized.includes("..")) {
    throw new Error(`Path traversal detected: ${input}`);
  }
  return normalized;
}
