import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { prepareRerun } from "../src/server/jobs/rerun-runner";
import { persistMobileExecutionManifest, persistMobileExecutionResults } from "../src/server/jobs/mobile-rerun-artifacts";

const ROOT = path.resolve(__dirname, "..");
const PREVIEW_DIR = path.join(ROOT, ".artifacts", "scenario-preview-runs");

function cleanupDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

test("rerun preview continues loading preview-scenarios.json", () => {
  const sourceJobId = `preview-rerun-${Date.now()}`;
  const artifactDir = path.join(PREVIEW_DIR, sourceJobId);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, "preview-scenarios.json"),
    JSON.stringify([
      {
        id: "scenario-1",
        displayId: "scenario-1",
        sourceIssueKey: "AA-1",
        title: "Preview scenario",
        steps: ["step 1"],
        expectedResult: "ok",
        appSlug: "app-preview",
      },
    ], null, 2),
    "utf-8",
  );
  try {
    const prepared = prepareRerun(sourceJobId, "all", "scenario-preview");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.jobType).toBe("scenario-preview");
    expect(prepared.selectedCount).toBe(1);
    expect(prepared.scenarios[0]?.title).toBe("Preview scenario");
  } finally {
    cleanupDir(artifactDir);
  }
});

test("rerun mobile loads original scenarios and data overrides from mobile manifest", () => {
  const sourceJobId = `mobile-rerun-${Date.now()}`;
  const mojibakeSelector = "Â¿AÃºn no tienes usuario o cuenta?";
  persistMobileExecutionManifest(sourceJobId, {
    launchId: "launch-1",
    testRunId: 123,
    appSlug: "app-mobile",
    apkPath: "C:\\apps\\mobile.apk",
    appPackage: "com.example.app",
    publishedCases: [
      { caseId: 101, scenarioId: "MOBILE-AA-1-001" },
      { caseId: 102, scenarioId: "MOBILE-AA-1-002" },
    ],
    scenarios: [
      {
        scenarioId: "MOBILE-AA-1-001",
        title: "Escenario 1",
        steps: [
          {
            action: "click",
            actionRole: "open_selector",
            expectedState: "selector_open",
            target: { strategy: "accessibilityId", value: mojibakeSelector },
          },
          {
            action: "click",
            actionRole: "select_option",
            expectedState: "option_selected",
            requiredNextTarget: { strategy: "id", value: "com.example:id/document" },
            target: { strategy: "androidUiAutomator", value: 'new UiSelector().text("Cédula de identidad")' },
          },
          { action: "fill", target: { strategy: "id", value: "com.example:id/document" }, value: "402-12345678-9" },
        ],
        requiredData: [
          {
            key: "tipo_documento",
            label: "Tipo de documento",
            kind: "select",
            stepIndex: 0,
            exampleValue: "Cédula de identidad",
            sensitive: false,
            options: ["Cédula de identidad", "Pasaporte"],
            applyTargetTemplate: { strategy: "androidUiAutomator", value: 'new UiSelector().text("{{value}}")' },
          },
        ],
      },
      {
        scenarioId: "MOBILE-AA-1-002",
        title: "Escenario 2",
        steps: [{ action: "click", target: { strategy: "accessibilityId", value: "Continuar" } }],
      },
    ],
    dataOverrides: {
      "MOBILE-AA-1-001": { 0: "valor 1" },
      "MOBILE-AA-1-002": { 0: "valor 2" },
    },
  });
  persistMobileExecutionResults(sourceJobId, [
    { scenarioId: "MOBILE-AA-1-001", status: "failed", failureCategory: "automation_failure" },
    { scenarioId: "MOBILE-AA-1-002", status: "passed" },
  ]);

  const preparedAll = prepareRerun(sourceJobId, "all", "mobile-launch-execution");
  expect(preparedAll.ok).toBe(true);
  if (!preparedAll.ok) return;
  expect(preparedAll.jobType).toBe("mobile-launch-execution");
  expect(preparedAll.mobileParams.scenarios).toHaveLength(2);
  expect(preparedAll.mobileParams.dataOverrides?.["MOBILE-AA-1-001"]?.[0]).toBe("valor 1");
  expect(preparedAll.mobileParams.scenarios[0]?.steps[0]?.target?.value).toBe("¿Aún no tienes usuario o cuenta?");
  expect(preparedAll.mobileParams.scenarios[0]?.steps[0]?.actionRole).toBe("open_selector");
  expect(preparedAll.mobileParams.scenarios[0]?.steps[1]?.actionRole).toBe("select_option");
  expect(preparedAll.mobileParams.scenarios[0]?.steps[1]?.requiredNextTarget?.value).toBe("com.example:id/document");

  const preparedFailed = prepareRerun(sourceJobId, "failed_only", "mobile-launch-execution");
  expect(preparedFailed.ok).toBe(true);
  if (!preparedFailed.ok) return;
  expect(preparedFailed.jobType).toBe("mobile-launch-execution");
  expect(preparedFailed.mobileParams.scenarios).toHaveLength(1);
  expect(preparedFailed.mobileParams.scenarios[0]?.scenarioId).toBe("MOBILE-AA-1-001");
  expect(Object.keys(preparedFailed.mobileParams.dataOverrides ?? {})).toEqual(["MOBILE-AA-1-001"]);

  cleanupDir(path.join(ROOT, ".artifacts", "mobile-launch-runs", sourceJobId));
});

test("missing mobile manifest returns explicit mobile rerun error", () => {
  const sourceJobId = `mobile-missing-${Date.now()}`;
  const prepared = prepareRerun(sourceJobId, "all", "mobile-launch-execution");
  expect(prepared.ok).toBe(false);
  if (prepared.ok) return;
  expect(prepared.error).toBe("missing_mobile_rerun_manifest");
});

test("mobile rerun enriches missing select requiredData from route profile even with mojibake target", () => {
  const sourceJobId = `mobile-rerun-enrich-${Date.now()}`;
  persistMobileExecutionManifest(sourceJobId, {
    launchId: "launch-enrich-1",
    testRunId: 321,
    appSlug: "app-conversacional-bsc",
    apkPath: "C:\\apps\\mobile.apk",
    appPackage: "com.example.app",
    publishedCases: [{ caseId: 201, scenarioId: "MOBILE-AA-94-001" }],
    scenarios: [
      {
        scenarioId: "MOBILE-AA-94-001",
        title: "Escenario con selector mojibake",
        steps: [
          { action: "click", target: { strategy: "androidUiAutomator", value: 'new UiSelector().text("CÃ©dula de identidad")' } },
          { action: "fill", target: { strategy: "androidUiAutomator", value: 'new UiSelector().className("android.widget.EditText").instance(0)' }, value: "402-12345678-9" },
        ],
        requiredData: [],
      },
    ],
    dataOverrides: {
      "MOBILE-AA-94-001": { 0: "Cédula de identidad", 1: "402-12345678-9" },
    },
  });
  const prepared = prepareRerun(sourceJobId, "all", "mobile-launch-execution");
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  const scenario = prepared.mobileParams.scenarios[0];
  expect(scenario?.requiredData?.some((field) => field.kind === "select" && field.stepIndex === 0)).toBe(true);
  cleanupDir(path.join(ROOT, ".artifacts", "mobile-launch-runs", sourceJobId));
});
