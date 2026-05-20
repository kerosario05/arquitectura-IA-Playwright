import { expect, type Page } from "@playwright/test";
import type { DataContext } from "../data/data-context";
import { assertValidExecutionPlan } from "../plans";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PlanExecutionResult, PlanExecutionStatus, StepExecutionResult } from "../types/plan-execution.types";
import type { FullConfig } from "../types/env.types";
import { resolveLocatorFromPlanTarget } from "./plan-target-resolver";
import { resolveStepValue } from "./plan-value-resolver";
import { captureStepScreenshot } from "./step-evidence";

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
          } else if (step.target) {
            const locator = resolveLocatorFromPlanTarget(input.page, step.target);
            await locator.first().click();
          } else {
            throw new Error("navigate requires target.");
          }
          break;
        }
        case "login":
          break;
        case "click": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("click requires concrete target.");
          }
          await resolveLocatorFromPlanTarget(input.page, step.target).first().click();
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
      result.screenshotPath = await captureStepScreenshot({
        page: input.page,
        evidenceDir: input.evidenceDir,
        stepIndex: step.index,
        action: step.action,
        status: stepStatus === "failed" ? "failed" : "passed"
      });
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
