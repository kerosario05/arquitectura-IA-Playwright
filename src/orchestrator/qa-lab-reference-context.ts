import fs from "node:fs";
import path from "node:path";
import type { QaLabReference } from "./types";

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/;
const SAFE_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Resolves only known Discovery artifact locations and a tightly allowlisted command shape. */
export function enrichDiscoveryJobReference(repoRoot: string, reference: QaLabReference): QaLabReference {
  if (reference.kind !== "discovery-job" || !SAFE_ID.test(reference.id)) return reference;
  const jobDir = path.resolve(repoRoot, ".artifacts", "scenario-preview-runs", reference.id);
  const allowedRoot = path.resolve(repoRoot, ".artifacts", "scenario-preview-runs") + path.sep;
  if (!jobDir.startsWith(allowedRoot)) return reference;
  const inputPath = path.join(jobDir, "preview-scenarios.json");
  const resultPath = path.join(jobDir, "results.json");
  let appSlug: string | undefined;
  let sourceRecordingId: string | undefined;
  let priorStatus: string | undefined;
  let priorPromotionAllowed: boolean | undefined;
  if (fs.existsSync(inputPath)) {
    try {
      const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as Record<string, unknown>;
      if (typeof input.appSlug === "string" && SAFE_SLUG.test(input.appSlug)) appSlug = input.appSlug;
      if (typeof input.recordingId === "string" && SAFE_ID.test(input.recordingId)) sourceRecordingId = input.recordingId;
    } catch { /* Malformed historical input remains context only. */ }
  }
  if (fs.existsSync(resultPath)) {
    try {
      const result = JSON.parse(fs.readFileSync(resultPath, "utf8")) as { cases?: Array<Record<string, unknown>> };
      const item = result.cases?.[0];
      if (typeof item?.appSlug === "string" && SAFE_SLUG.test(item.appSlug)) appSlug ??= item.appSlug;
      if (typeof item?.recordingId === "string" && SAFE_ID.test(item.recordingId)) sourceRecordingId ??= item.recordingId;
      if (typeof item?.status === "string") priorStatus = item.status;
      if (typeof item?.promotionAllowed === "boolean") priorPromotionAllowed = item.promotionAllowed;
    } catch { /* A corrupt historical result cannot authorize execution. */ }
  }
  const args = ["run", "discovery:preview", "--", "--input", inputPath];
  if (appSlug) args.push("--app", appSlug);
  args.push("--overwrite", "--auto-promote", "--auto-pom", "--rerun-active");
  return { ...reference, ...(appSlug ? { projectSlug: appSlug } : {}), ...(fs.existsSync(inputPath) ? { inputPath } : {}), ...(sourceRecordingId ? { sourceRecordingId } : {}), ...(priorStatus ? { priorStatus } : {}), ...(priorPromotionAllowed === undefined ? {} : { priorPromotionAllowed }), ...(fs.existsSync(inputPath) && appSlug ? { validatedCommand: args } : {}) };
}

/** Resolves a recording only from its exact saved app artifact; never guesses a project from the UUID. */
export function enrichRecordingReference(repoRoot: string, reference: QaLabReference): QaLabReference {
  if (reference.kind !== "recording" || !SAFE_ID.test(reference.id)) return reference;
  const appsRoot = path.resolve(repoRoot, "automations", "apps");
  if (!fs.existsSync(appsRoot)) return reference;
  for (const entry of fs.readdirSync(appsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SAFE_SLUG.test(entry.name)) continue;
    const scenarioFile = path.resolve(appsRoot, entry.name, "recordings", reference.id, "scenarios.json");
    const allowed = path.resolve(appsRoot, entry.name, "recordings") + path.sep;
    if (!scenarioFile.startsWith(allowed) || !fs.existsSync(scenarioFile)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(scenarioFile, "utf8")) as Array<Record<string, unknown>>;
      const scenario = parsed.find((item) => Array.isArray(item.webSteps));
      const webSteps = Array.isArray(scenario?.webSteps) ? scenario.webSteps as Array<Record<string, unknown>> : [];
      const steps: string[] = [];
      let runtimeUrl: string | undefined;
      for (const step of webSteps) {
        const action = typeof step.action === "string" ? step.action.toLowerCase() : "";
        const value = typeof step.value === "string" ? step.value.trim() : "";
        const target = step.target && typeof step.target === "object" ? step.target as Record<string, unknown> : {};
        const targetValue = typeof target.value === "string" ? target.value.split("|").at(-1)?.trim() ?? "" : "";
        if (action === "navigate" && value) {
          try { const url = new URL(value); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) { runtimeUrl ??= url.toString(); steps.push(`navigate ${url.toString()}`); } } catch { /* Ignore malformed recorded navigation targets. */ }
          continue;
        }
        if (["fill", "type", "press", "input"].includes(action)) break; // Never copy recorded values/credentials into the new TaskContract.
        if (action === "click" && /^\d+$/.test(targetValue)) break;
        if (action === "click" && targetValue) steps.push(`click ${JSON.stringify(targetValue)}`);
      }
      return { ...reference, projectSlug: entry.name, ...(runtimeUrl ? { runtimeUrl } : {}), ...(steps.length ? { steps } : {}) };
    } catch { /* A malformed artifact cannot authorize a physical run. */ }
  }
  return reference;
}
