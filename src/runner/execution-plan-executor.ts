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

/**
 * Classify scenario evidence kind from its steps — no hardcoded HUs or entities.
 * Determines whether detail screenshots are required.
 */
function classifyEvidenceKind(steps: ExecutionPlanStep[]): { kind: string; lastActionTarget: string; isDetail: boolean } {
  const lastStep = steps[steps.length - 1];
  const lastAction = lastStep?.action ?? "";
  const lastTarget = extractTargetLabel(lastStep?.target);

  // Assertion-only scenarios are not detail flows
  if (lastAction === "assert" || lastAction === "assertVisible" || lastAction === "assertText") {
    return { kind: "assertionEvidence", lastActionTarget: lastTarget, isDetail: false };
  }

  // Button-click endings indicate wizard/form/confirmation, not detail
  if (lastAction === "click" && /Continuar|Confirmar|Cancelar|Enviar|Volver|Generar|Imprimir|Descargar/i.test(lastTarget)) {
    return { kind: "formEvidence", lastActionTarget: lastTarget, isDetail: false };
  }

  // Selection flows: ordinal entity selection is selectionEvidence, not detail
  if (lastAction === "click" && /seleccionar\s+el\s+primer|seleccionar\s+la\s+primer/i.test(lastTarget)) {
    return { kind: "selectionEvidence", lastActionTarget: lastTarget, isDetail: false };
  }

  // Detail flows: the last action is opening/viewing a specific entity's detail page
  if (lastAction === "click" && /detalle|consultar\s+(?:el\s+)?detalle|abrir\s+detalle/i.test(lastTarget)) {
    return { kind: "detailEvidence", lastActionTarget: lastTarget, isDetail: true };
  }

  return { kind: "routeEvidence", lastActionTarget: lastTarget, isDetail: false };
}

function extractTargetLabel(target: ExecutionPlanStep["target"]): string {
  if (!target || target === "APP_BASE_URL") return "";
  if (typeof target === "string") return target;
  return target.value ?? target.hint ?? target.name ?? "";
}

import { resolveSemanticAssertion } from "./semantic-assertion";

/**
 * Wait for the page to be stable — no loading spinners, skeleton screens, or transition text.
 * Universal: detects loading states by aria attributes, common text patterns, and DOM elements.
 * Timeout is configurable via env LOADING_STABILITY_TIMEOUT_MS (default 8000ms).
 */
export async function waitForStableInteractiveScreen(page: Page): Promise<{ stable: boolean; waitedMs: number; signals: string[] }> {
  const start = Date.now();
  const timeout = Number(process.env.LOADING_STABILITY_TIMEOUT_MS) || 8000;
  const pollMs = 250;
  const signals: string[] = [];

  // Loading text patterns (lowercase for matching)
  const LOADING_TEXTS = /cargando|procesando|consultando|buscando|generando|espere|por favor espere|redirigiendo|loading|please wait/i;

  while (Date.now() - start < timeout) {
    let loadingDetected = false;

    try {
      // 1. aria-busy on body or main containers
      const busyElements = await page.locator('[aria-busy="true"]').count();
      if (busyElements > 0) { loadingDetected = true; if (!signals.includes("aria-busy")) signals.push("aria-busy"); }

      // 2. Common loading text visible anywhere on the page
      const loadingTextEl = page.locator("text=" + /cargando|procesando|consultando|buscando|generando|espere|redirigiendo|loading/i.source);
      const loadingTextCount = await loadingTextEl.count();
      if (loadingTextCount > 0) {
        const isVisible = await loadingTextEl.first().isVisible().catch(() => false);
        if (isVisible) { loadingDetected = true; if (!signals.includes("loading_text")) signals.push("loading_text"); }
      }

      // 3. Spinner/progress elements
      const spinnerCount = await page.locator('[role="progressbar"], .spinner, .loader, .skeleton, .shimmer, [class*="spin"], [class*="load"]').count();
      const visibleSpinners = await page.locator('[role="progressbar"], .spinner, .loader, .skeleton, .shimmer, [class*="spin"]:visible, [class*="load"]:visible').count();
      if (visibleSpinners > 0) { loadingDetected = true; if (!signals.includes("spinner")) signals.push("spinner"); }

      // 4. Button/input disabled during loading (overlay pattern)
      const disabledDuringLoad = await page.locator('button[disabled], input[disabled]').count();
      if (disabledDuringLoad > 5 && spinnerCount > 0) { loadingDetected = true; if (!signals.includes("disabled_overlay")) signals.push("disabled_overlay"); }

    } catch {
      // Page may have navigated or closed — exit wait
      break;
    }

    if (!loadingDetected) {
      // Extra stability: wait one more poll cycle to confirm DOM settled
      await page.waitForTimeout(pollMs);
      const waited = Date.now() - start;
      return { stable: true, waitedMs: waited, signals };
    }

    await page.waitForTimeout(pollMs);
  }

  const waited = Date.now() - start;
  return { stable: false, waitedMs: waited, signals };
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
      // Wait for screen stability before resolving targets/clicks/assertions.
      // Skip for navigate (already waits for domcontentloaded) and login steps.
      const needsStabilityWait = step.action !== "navigate" && step.action !== "login";
      if (needsStabilityWait) {
        const stability = await waitForStableInteractiveScreen(input.page);
        const targetLabel = extractTargetLabel(step.target);
        if (!stability.stable) {
          console.log(`[screen-stability] stable=false reason=timeout signals=${stability.signals.join(",")} waitedMs=${stability.waitedMs} target="${targetLabel}"`);
        } else if (stability.signals.length > 0) {
          console.log(`[screen-stability] stable=true signals=${stability.signals.join(",")} waitedMs=${stability.waitedMs} target="${targetLabel}"`);
        }
      }

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
            // Post-navigation: wait for screen to stabilize
            const navStability = await waitForStableInteractiveScreen(input.page);
            if (navStability.signals.length > 0) {
              console.log(`[screen-stability] phase=after_navigate target="${navLabel}" stable=${navStability.stable} signals=${navStability.signals.join(",")} waitedMs=${navStability.waitedMs}`);
            }
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
          // Wait for post-click screen stability before capturing evidence
          const postStability = await waitForStableInteractiveScreen(input.page);
          if (postStability.signals.length > 0) {
            console.log(`[screen-stability] phase=after_click target="${targetLabel}" stable=${postStability.stable} signals=${postStability.signals.join(",")} waitedMs=${postStability.waitedMs}`);
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
          const targetLabel = extractTargetLabel(step.target);
          // Try semantic assertion first (observable patterns, not literal text)
          const semanticResult = await resolveSemanticAssertion(input.page, targetLabel);
          if (semanticResult === "passed") {
            console.log(`[assertion] semantic resolved target="${targetLabel}" result=passed`);
            break;
          }
          if (semanticResult === "not_found") {
            throw new Error(`Semantic assertion failed for "${targetLabel}". Expected observable DOM signal not found.`);
          }
          // Fallback: default text-based visibility check
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

  // Classify evidence kind — determines whether detail screenshot is required
  const evidence = classifyEvidenceKind(steps);

  console.log(`[evidence-classifier] scenario="${input.plan.scenario.title?.slice(0,60)}" evidenceKind=${evidence.kind} isDetail=${evidence.isDetail} lastActionTarget="${evidence.lastActionTarget}"`);

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
    error: fatalError,
    evidenceKind: evidence.kind,
    isDetailEvidence: evidence.isDetail,
    detailScreenshotRequired: evidence.isDetail,
    lastActionTarget: evidence.lastActionTarget,
  };
}
