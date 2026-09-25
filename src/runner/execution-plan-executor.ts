import { expect, type Page } from "@playwright/test";
import type { DataContext } from "../data/data-context";
import { assertValidExecutionPlan } from "../plans";
import type { ExecutionPlan, ExecutionPlanStep } from "../types/execution-plan.types";
import type { PlanExecutionResult, PlanExecutionStatus, StepExecutionResult } from "../types/plan-execution.types";
import type { FullConfig } from "../types/env.types";
import { resolveLocatorFromPlanTarget } from "./plan-target-resolver";
import { resolveStepValue } from "./plan-value-resolver";
import { captureStepScreenshot } from "./step-evidence";
import { extractRuntimeUiSnapshot } from "../knowledge/runtime-knowledge-extractor";
import { persistRuntimeSnapshot, persistRuntimeRoute } from "../knowledge/runtime-knowledge-persister";
import { ensureSupportingCheckbox, ensureSupportingMultiselect, resolveSupportingDate, selectSupportingAutocomplete, selectSupportingCombobox, selectSupportingOption, selectSupportingRadio } from "./runtime-field-capability";
import { resolveSupportingAutofill, type ResolvableObservedControl } from "./supporting-autofill";
import type { RuntimeInputRequirement } from "../testrail/testrail-runtime-transformer";
import { AsyncOperationProgressLease } from "./async-operation-progress-lease";

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
export type ScreenProgressProbe = boolean | {
  active?: boolean;
  progressed?: boolean;
  signal?: string;
  pendingCount?: number;
  requestFailed?: boolean;
  lastProgressAt?: number;
};

export type ScreenCompletionProbeResult = {
  completed: boolean;
  signal?: string;
};

export type ScreenStabilityResult = {
  stable: boolean;
  waitedMs: number;
  signals: string[];
  progressSignals: string[];
  relevantPendingRequests: number;
  activeAsyncOperation: boolean;
  stallThresholdReached: boolean;
  lastProgressAgeMs: number;
  idleDeadlineMs: number;
  hardSafetyDeadlineMs: number;
  absoluteDeadlineMs: number;
  waitState: "stalled" | "active_pending" | "active_async_operation" | "completed" | "failed";
  terminationReason: "stable" | "stalled" | "absolute_deadline_reached" | "request_failed" | "page_closed" | "context_closed";
  reason?: "loading_timeout";
};

/**
 * Wait for a stable screen while preserving the original bounded absolute
 * deadline. A request observed by the action watcher is an active operation
 * for the whole action window, even when it emits no new lifecycle event for
 * longer than the stall threshold. Unrelated resource types are excluded by
 * the watcher/probe and cannot prolong this wait.
 */
export async function waitForStableInteractiveScreen(
  page: Page,
  options?: {
    progressProbe?: () => ScreenProgressProbe;
    completionProbe?: () => Promise<ScreenCompletionProbeResult>;
    waitForPendingTransport?: boolean;
    absoluteDeadlineMs?: number;
  },
): Promise<ScreenStabilityResult> {
  const start = Date.now();
  console.log(
    `[async-wait-provenance] implementationId=completion-probe-authoritative-v1 ` +
    `completionProbeProvided=${Boolean(options?.completionProbe)}`,
  );
  const idleWindowMs = Number(process.env.LOADING_STABILITY_TIMEOUT_MS) || 8000;
  const hardSafetyCapEnv = process.env.ASYNC_OPERATION_HARD_SAFETY_CAP_MS
    ?? process.env.LOADING_STABILITY_HARD_SAFETY_CAP_MS
    ?? process.env.LOADING_STABILITY_ABSOLUTE_DEADLINE_MS;
  const configuredHardSafetyCap = options?.absoluteDeadlineMs
    ?? (hardSafetyCapEnv === undefined ? 120000 : Number(hardSafetyCapEnv));
  const hardSafetyCapMs = Number.isFinite(configuredHardSafetyCap) && configuredHardSafetyCap > 0
    ? Math.max(idleWindowMs, configuredHardSafetyCap)
    : Math.max(idleWindowMs, 120000);
  const absoluteDeadlineAt = start + hardSafetyCapMs;
  const progressLease = new AsyncOperationProgressLease({
    startedAt: start,
    idleWindowMs,
    hardSafetyCapMs,
  });
  const pollMs = Math.min(250, Math.max(10, Math.floor(idleWindowMs / 4)));
  const signals: string[] = [];
  const progressSignals: string[] = [];
  let loadingObserved = false;
  let loadingCurrentlyDetected = false;
  let clearPolls = 0;
  let pageClosed = false;
  let contextClosed = false;
  let requestFailed = false;
  const pendingRelevantRequests = new Set<object>();
  let probePendingCount = 0;
  let probeActive = false;
  let lastProbeProgressAt = start;
  // websocket/eventsource are long-lived by nature — a persistent connection that never
  // "finishes" must never count as a pending request that blocks readiness or masks stability.
  const relevantResourceTypes = new Set(["document", "xhr", "fetch"]);
  const isRelevant = (request: any) => relevantResourceTypes.has(String(request.resourceType?.() ?? "other"));
  const noteProgress = (signal: string) => {
    progressLease.recordMeaningfulProgress();
    if (!progressSignals.includes(signal)) progressSignals.push(signal);
  };
  const onRequest = (request: any) => {
    if (isRelevant(request)) {
      pendingRelevantRequests.add(request as object);
      noteProgress("request_started");
    }
  };
  const onResponse = (response: any) => {
    const request = response.request?.();
    if (isRelevant(request)) {
      pendingRelevantRequests.delete(request as object);
      noteProgress("response_received");
    }
  };
  const onRequestFinished = (request: any) => {
    if (isRelevant(request)) {
      pendingRelevantRequests.delete(request as object);
      noteProgress("request_finished");
    }
  };
  const onRequestFailed = (request: any) => {
    if (!isRelevant(request)) return;
    pendingRelevantRequests.delete(request as object);
    // FIRST_LOSS fix: a request the browser itself cancelled BECAUSE the page is navigating away
    // (Playwright reports this as `requestfailed` with an abort/cancel errorText, e.g.
    // `net::ERR_ABORTED`) is not an application failure -- it is the ordinary side effect of the
    // very transition this wait may exist to confirm (a login form's Enter/submit navigating to
    // the next screen). Physical evidence: a press-caused navigation's own in-flight ancillary
    // request was cancelled by that same navigation, and the wait (no `completionProbe`, as every
    // post-press/post-click stabilization call has none) treated it as unconditionally terminal,
    // aborting well before the new screen ever loaded. Detected generically from the browser's own
    // cancellation vocabulary -- never from resourceType, URL, or any app-specific text -- so a
    // genuine transport/server failure (a different errorText) keeps its existing terminal
    // behavior below, for every caller, with or without a completionProbe.
    const errorText = String(request.failure?.()?.errorText ?? "");
    const cancelledByNavigation = /aborted|cancell?ed/i.test(errorText);
    noteProgress(cancelledByNavigation ? "request_cancelled_by_navigation" : "request_failed");
    if (cancelledByNavigation) return;
    // FIRST_LOSS fix: a `completionProbe` is COMPLETION AUTHORITY (established for the generic
    // idle-screen branch two tickets ago) -- an unrelated ancillary request (xhr/fetch, never
    // the top-level document) failing anywhere on the page must never immediately abort a wait
    // whose own target-scoped probe is still legitimately polling toward success. Physical
    // evidence: a background list-loading request failed mid-page-load while the real fill
    // target was already correctly identified but still disabled -- the wait terminated with
    // `terminationReason: "request_failed"` well before the target could ever become enabled,
    // even though that failure had nothing to do with the target itself. A DOCUMENT-load
    // failure is always terminal regardless (the page itself may now be broken), and ANY
    // relevant-type failure remains terminal when no `completionProbe` exists at all --
    // preserving the exact pre-existing behavior for every other caller of this shared wait
    // (post-click/post-navigate/post-press stabilization, none of which pass a completionProbe).
    const resourceType = String(request.resourceType?.() ?? "other");
    if (resourceType === "document" || !options?.completionProbe) {
      requestFailed = true;
    }
  };
  const onPageClose = () => { pageClosed = true; };
  const onContextClose = () => { contextClosed = true; };
  const pageEvents = page as Page & { on?: (event: string, listener: (...args: any[]) => void) => unknown; off?: (event: string, listener: (...args: any[]) => void) => unknown };
  const supportsPageEvents = typeof pageEvents.on === "function" && typeof pageEvents.off === "function";
  const cleanup = () => {
    if (supportsPageEvents) {
      pageEvents.off!("request", onRequest);
      pageEvents.off!("response", onResponse);
      pageEvents.off!("requestfinished", onRequestFinished);
      pageEvents.off!("requestfailed", onRequestFailed);
      pageEvents.off!("close", onPageClose);
    }
    try { (page.context?.() as any)?.off?.("close", onContextClose); } catch { /* best effort */ }
  };
  // Playwright pages are event emitters, but keeping this probe usable with
  // lightweight page doubles is important: stability is also a pre-browser
  // contract gate and must not fail merely because the observer is absent.
  if (supportsPageEvents) {
    pageEvents.on("request", onRequest);
    pageEvents.on("response", onResponse);
    pageEvents.on("requestfinished", onRequestFinished);
    pageEvents.on("requestfailed", onRequestFailed);
    pageEvents.on("close", onPageClose);
  }
  try { (page.context?.() as any)?.on?.("close", onContextClose); } catch { /* best effort */ }

  const readProgressProbe = (): { active: boolean; progressed: boolean; requestFailed: boolean } => {
    const raw = options?.progressProbe?.();
    if (typeof raw === "boolean") {
      probeActive = raw;
      probePendingCount = raw ? Math.max(1, probePendingCount) : 0;
      return { active: raw, progressed: false, requestFailed: false };
    }
    if (!raw) {
      probeActive = false;
      probePendingCount = 0;
      return { active: false, progressed: false, requestFailed: false };
    }
    probeActive = raw.active === true || (raw.pendingCount ?? 0) > 0;
    probePendingCount = Math.max(0, Number(raw.pendingCount ?? 0));
    let progressed = raw.progressed === true;
    if (typeof raw.lastProgressAt === "number" && raw.lastProgressAt > lastProbeProgressAt) {
      lastProbeProgressAt = raw.lastProgressAt;
      progressed = true;
    }
    if (progressed) {
      noteProgress(raw.signal || "probe_progress");
    }
    if (raw.signal && !progressSignals.includes(raw.signal)) progressSignals.push(raw.signal);
    return { active: probeActive, progressed, requestFailed: raw.requestFailed === true };
  };

  // Loading text patterns (lowercase for matching)
  const LOADING_TEXTS = /cargando|procesando|consultando|buscando|generando|espere|por favor espere|redirigiendo|loading|please wait/i;
  let lastLoggedAsyncState: string | undefined;
  const logAsyncState = (state: string, relevantPendingCount: number, loadingSignal: boolean) => {
    if (lastLoggedAsyncState === state) return;
    lastLoggedAsyncState = state;
    const now = Date.now();
    console.log(
      `[async-wait] state=${state} elapsedMs=${now - start} ` +
      `idleBudgetRemainingMs=${Math.max(0, progressLease.idleDeadline - now)} ` +
      `hardBudgetRemainingMs=${Math.max(0, progressLease.hardSafetyDeadline - now)} ` +
      `relevantPendingRequests=${relevantPendingCount} loadingSignal=${loadingSignal} ` +
      `lastMeaningfulProgressAgeMs=${Math.max(0, now - progressLease.lastMeaningfulProgressAt)}`
    );
  };

  while (Date.now() < absoluteDeadlineAt) {
    let loadingDetected = false;
    let lastCompletionProbeSatisfied: boolean | undefined;

    if (pageClosed || contextClosed) break;

    if (options?.completionProbe) {
      const completion = await options.completionProbe().catch(() => ({ completed: false } as ScreenCompletionProbeResult));
      lastCompletionProbeSatisfied = completion.completed === true;
      if (completion.completed) {
        if (completion.signal && !signals.includes(completion.signal)) signals.push(completion.signal);
        const waited = Date.now() - start;
        cleanup();
        return {
          stable: true,
          waitedMs: waited,
          signals,
          progressSignals,
          relevantPendingRequests: Math.max(pendingRelevantRequests.size, probePendingCount),
          activeAsyncOperation: false,
          stallThresholdReached: Date.now() - start >= idleWindowMs,
          lastProgressAgeMs: Math.max(0, Date.now() - progressLease.lastMeaningfulProgressAt),
          idleDeadlineMs: progressLease.idleDeadline,
          hardSafetyDeadlineMs: progressLease.hardSafetyDeadline,
          absoluteDeadlineMs: absoluteDeadlineAt,
          waitState: "completed",
          terminationReason: "stable",
        };
      }
    }

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
      cleanup();
      break;
    }

    // A continuously visible loading indicator (spinner/aria-busy/loading text/disabled
    // overlay) IS itself evidence the operation is progressing, even when no tracked network
    // request is in flight (a WebSocket-driven or already-prefetched load, for example). Idle
    // timeout must never fire while this positive signal is still present — only network
    // signals renewed the idle deadline before, so a purely DOM-driven load silently ran out
    // the idle budget after ~idleWindowMs even with the full hard safety budget still available.
    if (loadingDetected) noteProgress("dom_loading_signal");

    // SPA route transitions can have no visible spinner while their fetch or
    // dynamically imported route chunk is still pending. Treat that pending
    // transport as a readiness signal so the next scan does not run against
    // the previous screen. The probe remains bounded by the existing wait
    // budget and is agnostic to the application or route.
    const probeState = readProgressProbe();
    if (probeState.requestFailed) requestFailed = true;
    const relevantPendingCount = Math.max(pendingRelevantRequests.size, probePendingCount);
    if (requestFailed) {
      logAsyncState("request_failed", relevantPendingCount, loadingDetected);
      break;
    }
    if (!loadingDetected && options?.waitForPendingTransport === true && probeState.active) {
      loadingDetected = true;
      if (!signals.includes("network_pending")) signals.push("network_pending");
    }

    if (!loadingDetected && relevantPendingCount > 0) {
      loadingDetected = true;
      if (!signals.includes("network_pending")) signals.push("network_pending");
    }
    loadingCurrentlyDetected = loadingDetected;

    if (loadingDetected && relevantPendingCount === 0 && Date.now() >= progressLease.idleDeadline) {
      logAsyncState("idle", relevantPendingCount, true);
      break;
    }
    if (loadingDetected || relevantPendingCount > 0) {
      logAsyncState("active", relevantPendingCount, loadingDetected);
    }

    if (!loadingDetected && relevantPendingCount === 0) {
      // FIRST_LOSS fix: COMPLETION PROBE AUTHORITY. When a `completionProbe` is supplied, an
      // idle/loading-free screen is never itself success on its own -- only `completion.completed
      // === true` (checked at the top of every loop iteration, above) may return `stable: true`.
      // Physical evidence (a recorded fill target still disabled while unrelated app data kept
      // loading) showed this generic "nothing is loading" branch returning `terminationReason:
      // "stable"` even though the SAME iteration's `completionProbe()` had just returned
      // `completed: false` -- `screenStable=true` was silently treated as if it meant
      // `targetReady=true`. Idle time spent here is charged against the SAME idle budget any
      // other stall already uses (renewed by real network progress exactly as before), so a
      // target that will never become ready still fails closed well before the hard safety cap,
      // never waiting indefinitely.
      if (options?.completionProbe) {
        const idleDeadlineReached = Date.now() >= progressLease.idleDeadline;
        console.log(
          `[async-wait] completionProbeProvided=true completionProbeSatisfied=${lastCompletionProbeSatisfied === true} ` +
          `screenStable=true loadingSignal=${loadingDetected} relevantPendingRequests=${relevantPendingCount} ` +
          `terminationReason=${idleDeadlineReached ? "stalled" : "polling"}`
        );
        if (idleDeadlineReached) {
          logAsyncState("idle_probe_unsatisfied", relevantPendingCount, false);
          break;
        }
        await page.waitForTimeout(pollMs);
        continue;
      }
      // Extra stability: wait one more poll cycle to confirm DOM settled
      if (loadingObserved && clearPolls === 0) {
      clearPolls = 1;
      await page.waitForTimeout(pollMs);
      continue;
      }
      await page.waitForTimeout(pollMs);
      const waited = Date.now() - start;
      cleanup();
      logAsyncState("success", 0, false);
      return {
        stable: true,
        waitedMs: waited,
        signals,
        progressSignals,
        relevantPendingRequests: Math.max(pendingRelevantRequests.size, probePendingCount),
        activeAsyncOperation: false,
        stallThresholdReached: Date.now() - start >= idleWindowMs,
        lastProgressAgeMs: Math.max(0, Date.now() - progressLease.lastMeaningfulProgressAt),
        idleDeadlineMs: progressLease.idleDeadline,
        hardSafetyDeadlineMs: progressLease.hardSafetyDeadline,
        absoluteDeadlineMs: absoluteDeadlineAt,
        waitState: "completed",
        terminationReason: "stable",
      };
    }

    loadingObserved = true;
    clearPolls = 0;
    await page.waitForTimeout(pollMs);
  }

  const waited = Date.now() - start;
  cleanup();
  const now = Date.now();
  const relevantPendingCount = Math.max(pendingRelevantRequests.size, probePendingCount);
  const activePending = relevantPendingCount > 0 || probeActive;
  const activeAsyncOperation = !requestFailed && !pageClosed && !contextClosed && (
    activePending || (loadingCurrentlyDetected && now < progressLease.idleDeadline)
  );
  const idleStallReached = !activePending && loadingCurrentlyDetected && now >= progressLease.idleDeadline;
  const terminationReason = pageClosed
    ? "page_closed"
    : contextClosed
      ? "context_closed"
      : requestFailed
        ? "request_failed"
        : now >= absoluteDeadlineAt && activeAsyncOperation
          ? "absolute_deadline_reached"
          : "stalled";
  if (terminationReason === "request_failed") logAsyncState("request_failed", relevantPendingCount, loadingCurrentlyDetected);
  else if (terminationReason === "page_closed") logAsyncState("page_closed", relevantPendingCount, loadingCurrentlyDetected);
  else if (terminationReason === "context_closed") logAsyncState("context_closed", relevantPendingCount, loadingCurrentlyDetected);
  else if (terminationReason === "absolute_deadline_reached") logAsyncState("hard_timeout", relevantPendingCount, loadingCurrentlyDetected);
  else if (idleStallReached) logAsyncState("idle", relevantPendingCount, loadingCurrentlyDetected);
  return {
    stable: false,
    waitedMs: waited,
    signals,
    progressSignals,
    relevantPendingRequests: relevantPendingCount,
    activeAsyncOperation,
    stallThresholdReached: waited >= idleWindowMs,
    lastProgressAgeMs: Math.max(0, Date.now() - progressLease.lastMeaningfulProgressAt),
    idleDeadlineMs: progressLease.idleDeadline,
    hardSafetyDeadlineMs: progressLease.hardSafetyDeadline,
    absoluteDeadlineMs: absoluteDeadlineAt,
    waitState: terminationReason === "request_failed" || terminationReason === "page_closed" || terminationReason === "context_closed"
      ? "failed"
      : activeAsyncOperation && terminationReason === "absolute_deadline_reached"
        ? "active_async_operation"
        : "stalled",
    terminationReason,
    reason: "loading_timeout",
  };
}

async function retryCausalPlanStep(page: Page, step: ExecutionPlan["steps"][number], dataContext: DataContext): Promise<void> {
  if (!step.target || step.target === "APP_BASE_URL") throw new Error("Causal retry requires a concrete target.");
  const locator = resolveLocatorFromPlanTarget(page, step.target).first();
  if (step.action === "click") {
    await locator.click();
    return;
  }
  if (step.action === "fill") {
    if (step.value !== undefined || step.valueKey !== undefined) {
      const value = resolveStepValue({ step, dataContext });
      if (value === undefined) throw new Error("fill requires value or valueKey.");
      await locator.fill(value);
      return;
    }
    if (step.supportingStrategy?.kind === "date_valid_value") {
      await resolveSupportingDate(locator, { strategy: "valid_in_range" });
      return;
    }
  }
  if (step.action === "select") {
    if (step.value !== undefined || step.valueKey !== undefined) {
      const value = resolveStepValue({ step, dataContext });
      if (value === undefined) throw new Error("select requires value or valueKey.");
      await locator.selectOption(value);
      return;
    }
    if (step.supportingStrategy?.kind === "select_valid_option") {
      const value = await selectSupportingOption(locator, { strategy: "first_valid" });
      await locator.selectOption(value);
      return;
    }
    if (step.supportingStrategy?.kind === "combobox_valid_option") {
      await selectSupportingCombobox(locator, { strategy: "first_valid" });
      return;
    }
    if (step.supportingStrategy?.kind === "autocomplete_valid_option") {
      await selectSupportingAutocomplete(locator, { strategy: "first_valid" });
      return;
    }
    if (step.supportingStrategy?.kind === "multiselect_valid_options") {
      await ensureSupportingMultiselect(locator, { strategy: "ensure_valid_selection" });
      return;
    }
  }
  if (step.action === "check") {
    if (step.supportingStrategy?.kind === "radio_valid_option") {
      await selectSupportingRadio(locator, { strategy: "first_valid" });
      return;
    }
    if (step.supportingStrategy?.kind === "checkbox_required_state") {
      await ensureSupportingCheckbox(locator, { strategy: "ensure_checked" });
      return;
    }
    await locator.check();
    return;
  }
  throw new Error(`Unsupported causal retry action: ${step.action}`);
}

export async function executeExecutionPlan(input: {
  page: Page;
  plan: ExecutionPlan;
  dataContext: DataContext;
  evidenceDir: string;
  continueOnFailure?: boolean;
  appBaseUrl?: string;
  runtimeConfig?: FullConfig;
  supportingAutofill?: {
    runtimeRequirements: RuntimeInputRequirement[];
    observedControls: ResolvableObservedControl[];
    executionSeed: string | number;
    causal: boolean;
  };
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
          const locator = resolveLocatorFromPlanTarget(input.page, step.target).first();
          const hasExplicitValue = step.value !== undefined || step.valueKey !== undefined;
          if (hasExplicitValue) {
            const value = resolveStepValue({ step, dataContext: input.dataContext });
            if (value === undefined) throw new Error("fill requires value or valueKey.");
            await locator.fill(value);
          } else if (step.supportingStrategy?.kind === "date_valid_value") {
            await resolveSupportingDate(locator, { strategy: "valid_in_range" });
          } else {
            throw new Error("fill requires value, valueKey, or supportingStrategy.");
          }
          break;
        }
        case "select": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("select requires concrete target.");
          }
          const locator = resolveLocatorFromPlanTarget(input.page, step.target).first();
          const hasExplicitValue = step.value !== undefined || step.valueKey !== undefined;
          if (hasExplicitValue) {
            const value = resolveStepValue({ step, dataContext: input.dataContext });
            if (value === undefined) throw new Error("select requires value or valueKey.");
            await locator.selectOption(value);
          } else if (step.supportingStrategy?.kind === "select_valid_option") {
            const value = await selectSupportingOption(locator, { strategy: "first_valid" });
            await locator.selectOption(value);
          } else if (step.supportingStrategy?.kind === "combobox_valid_option") {
            await selectSupportingCombobox(locator, { strategy: "first_valid" });
          } else if (step.supportingStrategy?.kind === "autocomplete_valid_option") {
            await selectSupportingAutocomplete(locator, { strategy: "first_valid" });
          } else if (step.supportingStrategy?.kind === "multiselect_valid_options") {
            await ensureSupportingMultiselect(locator, { strategy: "ensure_valid_selection" });
          } else {
            throw new Error("select requires value, valueKey, or supportingStrategy.");
          }
          break;
        }
        case "check": {
          if (!step.target || step.target === "APP_BASE_URL") {
            throw new Error("check requires concrete target.");
          }
          const locator = resolveLocatorFromPlanTarget(input.page, step.target).first();
          if (step.value !== undefined || step.valueKey !== undefined) {
            await locator.check();
          } else if (step.supportingStrategy?.kind === "radio_valid_option") {
            await selectSupportingRadio(locator, { strategy: "first_valid" });
          } else if (step.supportingStrategy?.kind === "checkbox_required_state") {
            await ensureSupportingCheckbox(locator, { strategy: "ensure_checked" });
          } else {
            await locator.check();
          }
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
      const autofillConfig = input.supportingAutofill;
      if (autofillConfig?.causal === true) {
        const autofill = await resolveSupportingAutofill({
          page: input.page,
          executionPlan: steps,
          runtimeRequirements: autofillConfig.runtimeRequirements,
          observedControls: autofillConfig.observedControls,
          dependentAction: { causal: true },
          executionSeed: autofillConfig.executionSeed,
          retryDependentAction: () => retryCausalPlanStep(input.page, step, input.dataContext),
        });
        if (autofill.retryAttempted) {
          stepStatus = "passed";
          errorMessage = undefined;
        }
      }
      if (!input.continueOnFailure) {
        aborted = stepStatus === "failed";
        fatalError = stepStatus === "failed" ? errorMessage : undefined;
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
