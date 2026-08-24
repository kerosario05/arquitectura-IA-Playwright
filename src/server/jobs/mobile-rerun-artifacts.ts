import fs from "node:fs";
import path from "node:path";
import type { MobileFailureCategory, MobileLaunchExecutionParams, MobileLaunchScenario } from "./mobile-launch-execution-runner";
import { repairUtf8Mojibake } from "../../mobile/mobile-text-normalization";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MOBILE_RERUN_ARTIFACTS_DIR = path.join(ROOT, ".artifacts", "mobile-launch-runs");

export type MobileExecutionRerunManifest = {
  kind: "mobile-launch-execution";
  schemaVersion: 1;
  jobId: string;
  createdAt: string;
  sourceJobId?: string;
  params: MobileLaunchExecutionParams;
};

export type MobileExecutionRerunResult = {
  scenarioId: string;
  status: "passed" | "failed" | "blocked";
  failureCategory?: MobileFailureCategory;
  firstFailureStep?: number;
  firstFailureStepIndex?: number;
  firstFailureReasonCode?: string;
};

function normalizeMobileScenarioText(scenario: MobileLaunchScenario): MobileLaunchScenario {
  return {
    ...scenario,
    scenarioId: repairUtf8Mojibake(scenario.scenarioId),
    title: repairUtf8Mojibake(scenario.title),
    steps: scenario.steps.map((step) => ({
      ...step,
      description: typeof step.description === "string" ? repairUtf8Mojibake(step.description) : step.description,
      value: typeof step.value === "string" ? repairUtf8Mojibake(step.value) : step.value,
      target: step.target
        ? {
          ...step.target,
          value: repairUtf8Mojibake(step.target.value),
        }
        : step.target,
      requiredNextTarget: step.requiredNextTarget
        ? {
          ...step.requiredNextTarget,
          value: repairUtf8Mojibake(step.requiredNextTarget.value),
        }
        : step.requiredNextTarget,
    })),
    requiredData: scenario.requiredData?.map((field) => ({
      ...field,
      key: repairUtf8Mojibake(field.key),
      label: repairUtf8Mojibake(field.label),
      exampleValue: repairUtf8Mojibake(field.exampleValue),
      defaultValue: typeof field.defaultValue === "string" ? repairUtf8Mojibake(field.defaultValue) : field.defaultValue,
      options: field.options?.map((option) => repairUtf8Mojibake(option)),
      applyTargetTemplate: field.applyTargetTemplate
        ? {
          ...field.applyTargetTemplate,
          value: repairUtf8Mojibake(field.applyTargetTemplate.value),
        }
        : field.applyTargetTemplate,
    })),
  };
}

export function normalizeMobileLaunchExecutionParams(params: MobileLaunchExecutionParams): MobileLaunchExecutionParams {
  const normalizedScenarios = params.scenarios.map((scenario) => normalizeMobileScenarioText(scenario));
  const normalizedOverrides = params.dataOverrides
    ? Object.fromEntries(
      Object.entries(params.dataOverrides).map(([scenarioId, overridesByStep]) => [
        repairUtf8Mojibake(scenarioId),
        Object.fromEntries(
          Object.entries(overridesByStep).map(([stepIndex, value]) => [stepIndex, repairUtf8Mojibake(value)])
        ),
      ]),
    )
    : undefined;
  return {
    ...params,
    launchId: repairUtf8Mojibake(params.launchId),
    appSlug: repairUtf8Mojibake(params.appSlug),
    sectionSlug: typeof params.sectionSlug === "string" ? repairUtf8Mojibake(params.sectionSlug) : params.sectionSlug,
    avdName: typeof params.avdName === "string" ? repairUtf8Mojibake(params.avdName) : params.avdName,
    apkPath: typeof params.apkPath === "string" ? repairUtf8Mojibake(params.apkPath) : params.apkPath,
    appPackage: typeof params.appPackage === "string" ? repairUtf8Mojibake(params.appPackage) : params.appPackage,
    appActivity: typeof params.appActivity === "string" ? repairUtf8Mojibake(params.appActivity) : params.appActivity,
    scenarios: normalizedScenarios,
    dataOverrides: normalizedOverrides,
  };
}

function ensureMobileRerunDir(jobId: string): string {
  const dir = path.join(MOBILE_RERUN_ARTIFACTS_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getMobileExecutionManifestPath(jobId: string): string {
  return path.join(MOBILE_RERUN_ARTIFACTS_DIR, jobId, "mobile-execution-manifest.json");
}

export function getMobileExecutionResultsPath(jobId: string): string {
  return path.join(MOBILE_RERUN_ARTIFACTS_DIR, jobId, "mobile-execution-results.json");
}

export function persistMobileExecutionManifest(
  jobId: string,
  params: MobileLaunchExecutionParams,
  options?: { sourceJobId?: string },
): string {
  const dir = ensureMobileRerunDir(jobId);
  const manifestPath = path.join(dir, "mobile-execution-manifest.json");
  const normalized = normalizeMobileLaunchExecutionParams(params);
  const manifest: MobileExecutionRerunManifest = {
    kind: "mobile-launch-execution",
    schemaVersion: 1,
    jobId,
    createdAt: new Date().toISOString(),
    sourceJobId: options?.sourceJobId,
    params: normalized,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  return manifestPath;
}

export function readMobileExecutionManifest(jobId: string): MobileExecutionRerunManifest | null {
  const manifestPath = getMobileExecutionManifestPath(jobId);
  if (!fs.existsSync(manifestPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as MobileExecutionRerunManifest;
  if (parsed?.kind !== "mobile-launch-execution" || !parsed?.params) return null;
  return {
    ...parsed,
    params: normalizeMobileLaunchExecutionParams(parsed.params),
  };
}

export function persistMobileExecutionResults(jobId: string, results: MobileExecutionRerunResult[]): string {
  const dir = ensureMobileRerunDir(jobId);
  const resultsPath = path.join(dir, "mobile-execution-results.json");
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), "utf-8");
  return resultsPath;
}

export function readMobileExecutionResults(jobId: string): MobileExecutionRerunResult[] | null {
  const resultsPath = getMobileExecutionResultsPath(jobId);
  if (!fs.existsSync(resultsPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(resultsPath, "utf-8")) as MobileExecutionRerunResult[];
  if (!Array.isArray(parsed)) return null;
  return parsed;
}
