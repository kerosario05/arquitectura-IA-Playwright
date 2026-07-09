import { expect, type Page } from "@playwright/test";
import type { DataContext } from "../data/data-context";
import { assertValidExecutionPlan } from "../plans";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PlanExecutionResult, PlanExecutionStatus, StepExecutionResult } from "../types/plan-execution.types";
import type { FullConfig } from "../types/env.types";
import { resolveLocatorFromPlanTarget } from "./plan-target-resolver";
import { resolveStepValue } from "./plan-value-resolver";
import { captureStepScreenshot } from "./step-evidence";
import { extractRuntimeUiSnapshot } from "../knowledge/runtime-knowledge-extractor";
import { persistRuntimeSnapshot, persistRuntimeRoute } from "../knowledge/runtime-knowledge-persister";

function extractTargetLabel(target: ExecutionPlanStep["target"]): string {
  if (!target || target === "APP_BASE_URL") return "";
  if (typeof target === "string") return target;
  return target.value ?? target.hint ?? target.name ?? "";
}

export async function executeExecutionPlan(input: {
  page: Page;
  plan: ExecutionPlan;
  dataContext: DataContext;
  evidenceDir: string;
  continueOnFailure?: boolean;
  appBaseUrl?: string;
  runtimeConfig?: FullConfig;
}): Promise<PlanExecutionResult> {
  assertValidExecutionPlan(input.plan);

  const startedAt = new Date();
  const steps = [...input.plan.steps].sort((a, b) => a.index - b.index);
  const stepResults: StepExecutionResult[] = [];
  let fatalError: string | undefined;
  let aborted = false;
  const runtimeSnapshots: Awaited<ReturnType<typeof extractRuntimeUiSnapshot>>[] = [];
  const executedClickTargets: string[] = [];
  const executedSteps: string[] = [];

  for (const step of steps) {
    if (aborted) {
      const now = new Date().toISOString();
      stepResults.push({
        index: step.index,
        action: step.action,
        status: "skipped",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        error: "Skipped because previous step failed."
      });
      continue;
    }

    const stepStart = Date.now();
    const startedAtStep = new Date(stepStart).toISOString();
    let stepStatus: StepExecutionResult["status"] = "passed";
    let errorMessage: string | undefined;

    try {
      switch (step.action) {
        case "navigate": {
          if (step.target === "APP_BASE_URL") {
            const runtimeBaseUrl = input.runtimeConfig?.app.baseUrl ?? input.appBaseUrl;
            if (!runtimeBaseUrl) {
              throw new Error("navigate APP_BASE_URL requires appBaseUrl in executor input.");
            }
            await input.page.goto(runtimeBaseUrl, { waitUntil: "domcontentloaded" });
            executedSteps.push(`Navegar a "${runtimeBaseUrl}".`);
          } else if (step.target) {
            const locator = resolveLocatorFromPlanTarget(input.page, step.target);
            await locator.first().click();
            const navLabel = extractTargetLabel(step.target);
            if (navLabel) executedSteps.push(`Navegar a "${navLabel}".`);
          } else {
            throw new Error("navigate requires target.");
          }
          runtimeSnapshots.push(await extractRuntimeUiSnapshot(input.page));
          break;
        }
        case "login":
          break;
        case "click": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("click requires concrete target.");
          }
          await resolveLocatorFromPlanTarget(input.page, step.target).first().click();
          const targetLabel = extractTargetLabel(step.target);
          if (targetLabel) {
            executedSteps.push(`Clic en "${targetLabel}".`);
            executedClickTargets.push(targetLabel);
          }
          runtimeSnapshots.push(await extractRuntimeUiSnapshot(input.page));
          break;
        }
        case "fill": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("fill requires concrete target.");
          }
          const value = resolveStepValue({ step, dataContext: input.dataContext });
          if (value === undefined) {
            throw new Error("fill requires value or valueKey.");
          }
          await resolveLocatorFromPlanTarget(input.page, step.target).first().fill(value);
          break;
        }
        case "select": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("select requires concrete target.");
          }
          const value = resolveStepValue({ step, dataContext: input.dataContext });
          if (value === undefined) {
            throw new Error("select requires value or valueKey.");
          }
          await resolveLocatorFromPlanTarget(input.page, step.target).first().selectOption(value);
          break;
        }
        case "check": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("check requires concrete target.");
          }
          await resolveLocatorFromPlanTarget(input.page, step.target).first().check();
          break;
        }
        case "uncheck": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("uncheck requires concrete target.");
          }
          await resolveLocatorFromPlanTarget(input.page, step.target).first().uncheck();
          break;
        }
        case "press": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("press requires concrete target.");
          }
          const value = resolveStepValue({ step, dataContext: input.dataContext });
          if (!value) {
            throw new Error("press requires value or valueKey.");
          }
          await resolveLocatorFromPlanTarget(input.page, step.target).first().press(value);
          break;
        }
        case "waitFor": {
          if (step.target && step.target !== "APP_BASE_URL") {
            await resolveLocatorFromPlanTarget(input.page, step.target).first().waitFor({ timeout: step.timeoutMs });
          } else {
            await input.page.waitForTimeout(step.timeoutMs ?? 1000);
          }
          break;
        }
        case "assertVisible": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("assertVisible requires concrete target.");
          }
          await expect(resolveLocatorFromPlanTarget(input.page, step.target).first()).toBeVisible({ timeout: step.timeoutMs });
          break;
        }
        case "assertText": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("assertText requires concrete target.");
          }
          if (!step.expected) {
            throw new Error("assertText requires expected.");
          }
          await expect(resolveLocatorFromPlanTarget(input.page, step.target).first()).toContainText(step.expected);
          break;
        }
        case "assertUrl": {
          if (!step.expected) {
            throw new Error("assertUrl requires expected.");
          }
          const expected = step.expected;
          if (expected.startsWith("^") || expected.includes(".*")) {
            await expect(input.page).toHaveURL(new RegExp(expected));
          } else {
            await expect(input.page).toHaveURL(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          }
          break;
        }
        case "screenshot":
          break;
        case "noop":
          stepStatus = "skipped";
          break;
        default:
          throw new Error(`Unsupported step action: ${step.action}`);
      }
    } catch (error) {
      stepStatus = "failed";
      errorMessage = error instanceof Error ? error.message : String(error);
      if (!input.continueOnFailure) {
        aborted = true;
        fatalError = errorMessage;
      }
    }

    const finishedAtMs = Date.now();
    const result: StepExecutionResult = {
      index: step.index,
      action: step.action,
      status: stepStatus,
      startedAt: startedAtStep,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - stepStart,
      error: errorMessage
    };

    if ((step.evidence && stepStatus !== "skipped") || stepStatus === "failed" || step.action === "screenshot") {
      try {
        result.screenshotPath = await captureStepScreenshot({
          page: input.page,
          evidenceDir: input.evidenceDir,
          stepIndex: step.index,
          action: step.action,
          status: stepStatus === "failed" ? "failed" : "passed"
        });
      } catch (screenshotError) {
        console.log(`[executor] screenshot failed for step ${step.index}: ${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`);
      }
    }

    stepResults.push(result);
  }

  const endedAt = new Date();
  const failedCount = stepResults.filter((item) => item.status === "failed").length;
  const passedCount = stepResults.filter((item) => item.status === "passed").length;
  const skippedCount = stepResults.filter((item) => item.status === "skipped").length;

  let status: PlanExecutionStatus;
  if (failedCount === 0 && passedCount === 0 && skippedCount > 0) {
    status = "skipped";
  } else if (failedCount === 0) {
    status = "passed";
  } else if (input.continueOnFailure) {
    status = "partial";
  } else {
    status = "failed";
  }

  // Persist runtime knowledge if any snapshots were captured
  if (runtimeSnapshots.length > 0 && input.runtimeConfig?.app) {
    const appSlug = input.runtimeConfig.app.appProfile ?? input.runtimeConfig.app.name ?? "default";
    if (appSlug === "default") {
      console.warn(`[knowledge-persister] appSlugFallback=default reason=missing_appProfile_and_appName caseId=${input.plan.scenario.caseId ?? "unknown"} scenario="${input.plan.scenario.title.slice(0, 60)}"`);
    }
    const issueKey = input.plan.scenario.externalId ?? String(input.plan.scenario.caseId ?? "");
    const scenarioTitle = input.plan.scenario.title;
    const fromSnapshot = runtimeSnapshots[runtimeSnapshots.length - 1];

    persistRuntimeSnapshot(appSlug, fromSnapshot, {
      issueKey,
      scenarioTitle,
      status: status as "passed" | "failed" | "partial",
    });

    if (executedClickTargets.length > 0 && executedSteps.length > 0) {
      persistRuntimeRoute(appSlug, executedSteps, [...new Set(executedClickTargets)], {
        issueKey,
        scenarioTitle,
        status: status as "passed" | "failed" | "partial",
      });
    }
  }

  return {
    scenario: input.plan.scenario,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    evidenceDir: input.evidenceDir,
    steps: stepResults,
    error: fatalError
  };
}
