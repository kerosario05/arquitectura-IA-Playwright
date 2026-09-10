import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { createAIExplorer, type AIExplorer } from "../ai/ai-explorer";
import { scanCurrentPage } from "../explorer/page-scanner";
import { buildTechnicalScreenKey } from "../explorer/page-scanner";
import { buildProposedObjects } from "./proposed-object-builder";
import { waitForPageReady } from "../browser/page-readiness";
import {
  resolveActionTarget,
  resolveAssociatedActionTarget,
  clickResolvedTarget,
  resolveSnapshotElementLocator,
  captureGridCollectionSnapshot,
  compareGridCollection,
  shouldInvokeAiAssistedDiscovery,
  resolveFillTarget,
  type ActiveContainerContext
} from "./target-resolver";
import {
  isProductCardTarget,
  findProductCardClickCandidates,
  tryProductCardClickStrategies,
  type ProductCardClickResult
} from "./product-card-click-resolver";
import {
  recoverMissingIntermediateForFinalTarget,
  type IntermediateRecoveryResult
} from "./intermediate-step-recovery";
import { findBestProductNameMatch, type ProductNameMatchResult } from "./product-name-matcher";
import { isSelectionLikeTarget as isSelectionLikeTargetNew, shouldBlockSemanticFallback, getSelectionConfidenceThreshold, verifyPostClickSemanticMatch, buildSelectionCandidatesFromSnapshot } from "./selection-resolution";
import { resolveLoginForm, type LoginFormResolution } from "./login-resolver";
import { runAiAssistedDiscovery, type AiAssistedDiscoveryConfig } from "./ai-assisted-discovery";
import { runAiRepairOrchestrator } from "../ai/repair/ai-repair-orchestrator";
import { buildAiRepairCaseSummary, formatAiRepairConsoleOutput, type StepWithAiRepair } from "../ai/repair/ai-repair-summary-builder";
import { writeJsonSafe } from "../utils/json-utils";
import { detectPostClickUiChange, type PostClickUiChangeResult } from "./post-click-ui-change-detector";
import {
  inferMissingSelection,
  buildInsertedStepMetadata,
  type MissingSelectionContext,
} from "./missing-selection-detector";
import {
  buildConcreteAssertionsFromExpected,
  resolveAssertionTargets,
  resolveRowScopedAssertion,
  resolveStructuralRowAssertion,
  resolveEntityWithinContainerAssertion,
  type AssertionTargetInput,
  type ExpectedResultConsumption
} from "./assertion-resolver";
import {
  attemptAssertionRecovery,
  classifyAssertionImportance,
  detectConditionalAssertionRisk
} from "./assertion-recovery";
import {
  parseStepIntent,
  type ParsedStepIntent,
  type ActionTargetItem,
  type FillValueSource,
  normalizeParsedTarget
} from "./step-intent-parser";
import type {
  CaseDiscoveryResult,
  DiscoveryStepResult,
  DiscoveredObject
} from "../types/discovery.types";
import type { TestScenario, TestScenarioStep } from "../types/testrail.types";
import type { ExecutionPlan, ExecutionPlanStep, RequiredDataRef, LocatorStrategy, InputIntent } from "../types/execution-plan.types";
import type { ControlIdentity } from "../types/control-identity";
import { buildRuntimeControlIdentity } from "../types/control-identity";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { TestDataMap, TestDataValue, MissingInputBehavior, ExpectedResultMode } from "../types/env.types";
import { config as envConfig } from "../config/env";
import { detectAuthGate, type AuthGateDetection } from "./auth-gate-detector";
import { resolveAuthInputs, validateRequiredInputs, logAuthResolution, type AuthInputResolverConfig } from "./auth-input-resolver";
import { loadRouteProfile } from "../automations/app-profile";
import { resolveMissingIntermediateStep, type MissingIntermediateStepResolution, type DiscoveryCandidate, type DiscoverySnapshot } from "./missing-intermediate-step-resolver";
import { observeRouteTransition, observeRouteCompletionSuccess, saveRouteProfileSuggestions, applyRouteProfileSuggestions, type RouteProfileSuggestion, type RouteProfileLearningConfig } from "./route-profile-learning";
import { appendRouteSuggestionToKnowledge } from "../scenarios/app-knowledge-writer";
import { persistRuntimeTransition } from "../knowledge/runtime-knowledge-persister";
import {
  createAuthGateState,
  shouldSkipStepAsAuthConsumed,
  markFunctionalStepAfterAuth,
  type AuthGateState
} from "./auth-step-classifier";
import { waitForStablePageState, type PageStabilityOptions } from "./page-stability-detector";
import { parseProductConditionTarget, matchesProductCondition, type ProductCondition } from "./product-condition-parser";
import { detectTransientScreen } from "./transient-screen-detector";
import { evaluateEarlyCompletionPolicy, type EarlyCompletionPolicyResult } from "./early-completion-policy";
import { detectSelectionSuccess, isSelectionLikeTarget, isSubmitLikeTarget, promoteToClickableAncestor, type SelectionDiagnostics } from "./selection-state-detector";
import { resolveDataKey, formatDataKeyForLog, type DataKeyResolution } from "../data/data-key-resolver";
import { type AutoGenerateConfig } from "../data/auto-test-data-generator";
import {
  captureAssertionObservationSnapshot,
  diffAssertionObservation,
  classifyNetworkActivity,
  writeAssertionObservationArtifact,
  type AssertionObservationArtifact,
  type AssertionObservationSnapshot,
} from "./assertion-observation";
import {
  runControlledAdvanceProbe,
  type CanonicalAssertionIntent,
  type ControlledAdvanceProbeResult,
} from "./controlled-advance-probe";
import type { AssertionPolarity } from "../scenarios/canonical-scenario";
import { extractTestRailInputRequirements } from "../testrail/testrail-input-requirements-adapter";
import { isAuthTransientNoResponse, resolveAuthTransientRetryMax } from "./auth-transient-retry";
import { isPendingOracleAuthority } from "./oracle-authority";

async function captureRuntimeFieldIdentity(locator: Locator): Promise<string | undefined> {
  return locator.evaluate(function identifyRuntimeField(element) {
    const tag = element.tagName.toLowerCase();
    const id = element.getAttribute("id");
    const testId = element.getAttribute("data-testid");
    const name = element.getAttribute("name");
    const role = element.getAttribute("role");
    const type = element.getAttribute("type");
    const identity = [
      tag,
      id ? `id=${id}` : "",
      testId ? `testid=${testId}` : "",
      name ? `name=${name}` : "",
      role ? `role=${role}` : "",
      type ? `type=${type}` : "",
    ].filter(Boolean).join("|");
    return identity || undefined;
  }).catch(() => undefined);
}

async function captureRuntimeControlIdentity(locator: Locator): Promise<ControlIdentity | undefined> {
  const metadata = await locator.evaluate(function identifyRuntimeControl(element) {
    return {
      tagName: element.tagName,
      inputType: element.getAttribute("type") ?? undefined,
      role: element.getAttribute("role") ?? undefined,
      name: element.getAttribute("name") ?? undefined,
      id: element.getAttribute("id") ?? undefined,
      ariaControls: element.getAttribute("aria-controls") ?? undefined,
    };
  }).catch(() => undefined);
  return metadata ? (buildRuntimeControlIdentity(metadata) ?? undefined) : undefined;
}

export type SafeNetworkEvent = {
  requestId?: string;
  method: string;
  resourceType: string;
  path: string;
  state: "completed" | "pending" | "failed";
  startedAt?: number;
  status?: number;
  statusCategory?: "2xx" | "3xx" | "4xx" | "5xx";
  durationMs?: number;
  failureCategory?: "timeout" | "connection_refused" | "connection_reset" | "dns" | "tls" | "cors" | "cancelled" | "browser_error" | "unknown";
  terminalReason?: "diagnostic_timeout";
  redirectTargetPathSafe?: string;
  redirectObserved?: boolean;
  redirectChain?: SafeRedirectHop[];
  chainCompleted?: boolean;
};

export type SafeRedirectHop = {
  status: number;
  targetPath?: string;
  followupMethod?: string;
  followupPath?: string;
  followupState?: "completed" | "pending" | "failed";
  followupStatus?: number;
  durationMs?: number;
  terminalReason?: "diagnostic_timeout";
};

export const safePathname = (rawUrl: string, baseUrl?: string): string => {
  try {
    return new URL(rawUrl, baseUrl).pathname || "/";
  } catch {
    return "/";
  }
};

export type InitialNavigationErrorInfo = {
  errorType: string;
  errorCode?: string;
  errorMessageSafe: string;
};

export function describeInitialNavigationError(error: unknown): InitialNavigationErrorInfo {
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown } | undefined;
  const message = typeof candidate?.message === "string" ? candidate.message : String(error ?? "unknown error");
  return {
    errorType: typeof candidate?.name === "string" && candidate.name.trim() ? candidate.name : "Error",
    errorCode: typeof candidate?.code === "string" && candidate.code.trim() ? candidate.code : undefined,
    errorMessageSafe: message.replace(/https?:\/\/[^\s)]+/gi, "<url>").replace(/[\r\n]+/g, " ").slice(0, 240)
  };
}

const statusCategory = (status: number): SafeNetworkEvent["statusCategory"] => {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return undefined;
};

const failureCategory = (message: string): SafeNetworkEvent["failureCategory"] => {
  const normalized = message.toLowerCase();
  if (/timeout|timed out/.test(normalized)) return "timeout";
  if (/connection refused|econnrefused/.test(normalized)) return "connection_refused";
  if (/connection reset|connection_reset|econnreset/.test(normalized)) return "connection_reset";
  if (/dns|enotfound|name not resolved/.test(normalized)) return "dns";
  if (/certificate|tls|ssl|err_cert/.test(normalized)) return "tls";
  if (/cors/.test(normalized)) return "cors";
  if (/cancel/.test(normalized)) return "cancelled";
  return "browser_error";
};

export type NetworkObservationWindow = {
  stop(options?: { passiveTail?: boolean }): Promise<SafeNetworkEvent[]>;
  waitForPassiveTail(): Promise<void>;
  hasPending(): boolean;
  getProgressState(): {
    active: boolean;
    progressed: boolean;
    signal?: string;
    pendingCount: number;
    lastProgressAt: number;
  };
};

/** Observes one action window only; request data, headers and query strings are never retained. */
export function startNetworkObservation(page: Page, stepIndex: number, maxEvents = 100, options?: { diagnosticMs?: number }): NetworkObservationWindow {
  const startedAt = new Map<object, number>();
  const events = new Map<object, SafeNetworkEvent>();
  const requestIds = new Map<object, string>();
  let stopped = false;
  let stopping = false;
  let passiveTailActive = false;
  let passiveTailTimer: ReturnType<typeof setTimeout> | undefined;
  let resolvePassiveTail: (() => void) | undefined;
  let passiveTailPromise = Promise.resolve();
  const passiveTailRequests = new Set<object>();
  const passiveTailStartedAt = new Map<object, number>();
  let progressRevision = 0;
  let progressRevisionRead = 0;
  let lastProgressAt = Date.now();
  let lastProgressSignal: string | undefined;
  const noteProgress = (signal: string) => {
    progressRevision += 1;
    lastProgressAt = Date.now();
    lastProgressSignal = signal;
  };
  const passiveTailCleanup = (expired = false) => {
    if (!passiveTailActive) return;
    if (expired) {
      for (const request of passiveTailRequests) passiveLog(request, "diagnosticTailExpired");
    }
    passiveTailActive = false;
    if (passiveTailTimer) clearTimeout(passiveTailTimer);
    page.off("response", onPassiveResponse);
    page.off("requestfinished", onPassiveFinished);
    page.off("requestfailed", onPassiveFailed);
    page.off("close", onPassivePageClose);
    try { (page.context?.() as any)?.off?.("close", onPassiveContextClose); } catch { /* best effort */ }
    passiveTailRequests.clear();
    passiveTailStartedAt.clear();
    resolvePassiveTail?.();
    resolvePassiveTail = undefined;
  };
  const passiveElapsed = (request: object) => Math.max(0, Date.now() - (passiveTailStartedAt.get(request) ?? Date.now()));
  const safeFailureReason = (request: any): string => String(request.failure?.()?.errorText ?? "unknown")
    .replace(/https?:\/\/[^\s]+/gi, "<url>")
    .replace(/[?&](?:token|password|passwd|secret|authorization|username)=[^&\s]*/gi, "")
    .slice(0, 160);
  const removePassiveRequest = (request: object) => {
    passiveTailRequests.delete(request);
    passiveTailStartedAt.delete(request);
    if (passiveTailRequests.size === 0) passiveTailCleanup();
  };
  const passiveLog = (request: object, event: string, extra: Record<string, unknown> = {}) => {
    const observed = events.get(request);
    if (!observed) return;
    console.log(`[network-post-timeout] ${JSON.stringify({
      requestId: requestIds.get(request),
      method: observed.method,
      path: observed.path,
      event,
      elapsedSinceTimeoutMs: passiveElapsed(request),
      ...extra
    })}`);
  };
  const onPassiveResponse = (response: any) => {
    const request = response.request?.() as object;
    if (!passiveTailRequests.has(request)) return;
    const status = Number(response.status?.() ?? 0);
    passiveLog(request, "response", { status });
  };
  const onPassiveFinished = (request: any) => {
    const key = request as object;
    if (!passiveTailRequests.has(key)) return;
    passiveLog(key, "requestfinished");
    removePassiveRequest(key);
  };
  const onPassiveFailed = (request: any) => {
    const key = request as object;
    if (!passiveTailRequests.has(key)) return;
    passiveLog(key, "requestfailed", { failureReason: safeFailureReason(request) });
    removePassiveRequest(key);
  };
  const onPassivePageClose = () => {
    for (const request of passiveTailRequests) passiveLog(request, "pageClosed", { pageClosed: true });
    passiveTailCleanup();
  };
  const onPassiveContextClose = () => {
    for (const request of passiveTailRequests) passiveLog(request, "contextClosed", { contextClosed: true });
    passiveTailCleanup();
  };
  const startPassiveTail = () => {
    const pending = Array.from(events.entries()).filter(([, event]) => event.state === "pending");
    if (pending.length === 0 || passiveTailActive) return;
    passiveTailActive = true;
    for (const [request] of pending) {
      passiveTailRequests.add(request);
      passiveTailStartedAt.set(request, Date.now());
      const event = events.get(request);
      if (event) console.log(`[network-post-timeout] ${JSON.stringify({ requestId: requestIds.get(request), method: event.method, path: event.path, event: "pendingSnapshot", elapsedSinceTimeoutMs: 0 })}`);
    }
    page.on("response", onPassiveResponse);
    page.on("requestfinished", onPassiveFinished);
    page.on("requestfailed", onPassiveFailed);
    page.on("close", onPassivePageClose);
    try { (page.context?.() as any)?.on?.("close", onPassiveContextClose); } catch { /* best effort */ }
    const configuredTailMs = Number(process.env.NETWORK_POST_TIMEOUT_TAIL_MS ?? 250);
    const diagnosticTailMs = Number.isFinite(configuredTailMs) && configuredTailMs > 0 ? configuredTailMs : 250;
    passiveTailPromise = new Promise<void>((resolve) => { resolvePassiveTail = resolve; });
    passiveTailTimer = setTimeout(() => passiveTailCleanup(true), diagnosticTailMs);
  };
  let resolveStop: ((events: SafeNetworkEvent[]) => void) | undefined;
  let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
  let redirectGraceTimer: ReturnType<typeof setTimeout> | undefined;
  let redirectGracePending = false;
  const redirectHops: Array<SafeRedirectHop & { source: object; followup?: object }> = [];
  const envDiagnosticMs = Number(process.env.NETWORK_OBSERVATION_DIAGNOSTIC_MS ?? 0);
  const diagnosticMs = options?.diagnosticMs ?? (Number.isFinite(envDiagnosticMs) && envDiagnosticMs > 0 ? envDiagnosticMs : 0);
  const snapshot = () => Array.from(events.values());
  const hasPending = () => snapshot().some((event) => event.state === "pending");
  const finish = (reason?: "diagnostic_timeout") => {
    if (stopped) return snapshot();
    stopped = true;
    if (diagnosticTimer) clearTimeout(diagnosticTimer);
    if (redirectGraceTimer) clearTimeout(redirectGraceTimer);
    if (reason) {
      for (const event of events.values()) {
        if (event.state === "pending") event.terminalReason = reason;
      }
      for (const hop of redirectHops) {
        if (!hop.followup || hop.followupState === "pending") {
          hop.followupState = "pending";
          hop.terminalReason = reason;
        }
      }
    }
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
    page.off("requestfinished", onRequestFinished);
    const result = snapshot();
    const publicChain = redirectHops.map(({ source: _source, followup: _followup, ...hop }) => ({ ...hop }));
    const chainCompleted = publicChain.every((hop) => !hop.targetPath || Boolean(hop.followupState && hop.followupState !== "pending"));
    for (const event of result) {
      if (event.redirectObserved) {
        event.redirectChain = publicChain;
        event.chainCompleted = chainCompleted;
      }
    }
    console.log(`[network-observation] stepIndex=${stepIndex} requests=${result.length} completed=${result.filter((e) => e.state === "completed").length} pending=${result.filter((e) => e.state === "pending").length} failed=${result.filter((e) => e.state === "failed").length}`);
    resolveStop?.(result);
    resolveStop = undefined;
    return result;
  };
  const settleIfComplete = () => {
    if (!stopping || hasPending()) return;
    const hasUnresolvedRedirect = redirectHops.some((hop) => hop.targetPath && !hop.followupState);
    const hasObservedRedirect = redirectHops.length > 0;
    if (!hasObservedRedirect) {
      finish();
      return;
    }
    if (hasUnresolvedRedirect) {
      if (!redirectGracePending) {
        redirectGracePending = true;
        redirectGraceTimer = setTimeout(() => finish(), Math.min(100, Math.max(10, diagnosticMs)));
      }
      return;
    }
    if (!redirectGracePending) {
      redirectGracePending = true;
      redirectGraceTimer = setTimeout(() => finish(), Math.min(100, Math.max(10, diagnosticMs)));
    }
  };
  const onRequest = (request: any) => {
    if (stopped || events.size >= maxEvents) return;
    const key = request as object;
    startedAt.set(key, Date.now());
    const requestId = `${stepIndex}-${events.size + 1}`;
    requestIds.set(key, requestId);
    const event: SafeNetworkEvent = { requestId, method: String(request.method?.() ?? "GET"), resourceType: String(request.resourceType?.() ?? "other"), path: safePathname(String(request.url?.() ?? "")), state: "pending", startedAt: Date.now() };
    events.set(key, event);
    noteProgress("request_started");
    const redirectedFrom = request.redirectedFrom?.() as object | undefined;
    if (redirectedFrom) {
      const hop = redirectHops.find((candidate) => candidate.source === redirectedFrom && !candidate.followup);
      if (hop) {
        hop.followup = key;
        hop.followupMethod = event.method;
        hop.followupPath = event.path;
        hop.followupState = "pending";
        redirectGracePending = false;
        if (redirectGraceTimer) clearTimeout(redirectGraceTimer);
      }
    }
  };
  const onResponse = (response: any) => {
    const key = response.request?.() as object;
    const event = events.get(key);
    if (!event) return;
    noteProgress("response_received");
    event.state = "completed";
    event.status = Number(response.status?.() ?? 0);
    event.statusCategory = statusCategory(event.status);
    if (event.statusCategory === "3xx") {
      try {
        const location = String(response.headers?.()?.location ?? "").trim();
        event.redirectObserved = true;
        if (location) event.redirectTargetPathSafe = safePathname(location, String(response.url?.() ?? ""));
        redirectHops.push({ status: event.status, targetPath: event.redirectTargetPathSafe, source: key });
      } catch {
        // Redirect metadata is best-effort and never affects functional execution.
      }
    }
    event.durationMs = Math.max(0, Date.now() - (startedAt.get(key) ?? Date.now()));
    const hop = redirectHops.find((candidate) => candidate.source === key);
    if (hop) {
      // The response is terminal for this hop; its follow-up, if any, is tracked separately.
      if (!hop.followup) settleIfComplete();
    }
    const followedHop = redirectHops.find((candidate) => candidate.followup === key);
    if (followedHop) {
      followedHop.followupState = "completed";
      followedHop.followupStatus = event.status;
      followedHop.durationMs = event.durationMs;
    }
    settleIfComplete();
  };
  const onRequestFailed = (request: any) => {
    const key = request as object;
    const event = events.get(key);
    if (!event) return;
    noteProgress("request_failed");
    event.state = "failed";
    event.durationMs = Math.max(0, Date.now() - (startedAt.get(key) ?? Date.now()));
    event.failureCategory = failureCategory(String(request.failure?.()?.errorText ?? ""));
    const followedHop = redirectHops.find((candidate) => candidate.followup === key);
    if (followedHop) {
      followedHop.followupState = "failed";
      followedHop.durationMs = event.durationMs;
    }
    settleIfComplete();
  };
  const onRequestFinished = (request: any) => {
    const key = request as object;
    const event = events.get(key);
    if (!event || event.state !== "pending") return;
    noteProgress("request_finished");
    event.state = "completed";
    event.durationMs = Math.max(0, Date.now() - (startedAt.get(key) ?? Date.now()));
    settleIfComplete();
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onRequestFinished);
  page.on("requestfailed", onRequestFailed);
  return {
    hasPending: () => hasPending(),
    getProgressState: () => {
      const progressed = progressRevision > progressRevisionRead;
      progressRevisionRead = progressRevision;
      return {
        active: hasPending(),
        progressed,
        signal: lastProgressSignal,
        pendingCount: snapshot().filter((event) => event.state === "pending").length,
        lastProgressAt,
      };
    },
    stop: (options?: { passiveTail?: boolean }) => {
      const passiveTailRequested = options?.passiveTail !== false;
      if (stopped) return Promise.resolve(snapshot());
      if (stopping) return new Promise<SafeNetworkEvent[]>((resolve) => { resolveStop = resolve; });
      if (diagnosticMs <= 0) {
        if (passiveTailRequested) startPassiveTail();
        return Promise.resolve(finish());
      }
      stopping = true;
      if (!hasPending()) return Promise.resolve(finish());
      return new Promise<SafeNetworkEvent[]>((resolve) => {
        resolveStop = resolve;
        diagnosticTimer = setTimeout(() => {
          if (passiveTailRequested) startPassiveTail();
          finish("diagnostic_timeout");
        }, diagnosticMs);
      });
    },
    waitForPassiveTail: () => passiveTailPromise
  };
}

export type RuntimeFillObservation = {
  before?: AssertionObservationSnapshot;
  after?: AssertionObservationSnapshot;
  networkEvents: SafeNetworkEvent[];
  committedBy: "blur";
  mutation?: ReturnType<typeof diffAssertionObservation>;
};

/**
 * Commits a row-scoped fill and observes the resulting runtime transition.
 * The primitive is intentionally independent of any application label or URL:
 * it only uses the resolved control, a bounded DOM snapshot, and sanitized
 * network metadata.
 */
export async function fillAndObserveRuntimeInput(input: {
  page: Page;
  locator: Locator;
  value: string;
  stepIndex: number;
  observe?: boolean;
  waitMs?: number;
}): Promise<RuntimeFillObservation> {
  if (!input.observe) {
    await input.locator.fill(input.value);
    return { networkEvents: [], committedBy: "blur" };
  }

  const before = await captureAssertionObservationSnapshot(input.page).catch(() => undefined);
  const observation = startNetworkObservation(input.page, input.stepIndex, 100, { diagnosticMs: input.waitMs ?? 1500 });
  await input.locator.fill(input.value);
  await input.locator.blur().catch(() => undefined);
  await input.page.waitForTimeout(input.waitMs ?? 1500);
  const networkEvents = await observation.stop({ passiveTail: false });
  const after = await captureAssertionObservationSnapshot(input.page).catch(() => undefined);
  const mutation = before && after
    ? diffAssertionObservation(before, after, networkEvents.length > 0)
    : undefined;
  const networkClass = classifyNetworkActivity(
    networkEvents,
    before?.urlPath,
    after?.urlPath,
  );
  console.log(
    `[fill-observation] stepIndex=${input.stepIndex} committedBy=blur `
      + `requestObserved=${networkEvents.length > 0} `
      + `responseObserved=${networkEvents.some((event) => event.state !== "pending")} `
      + `responseStatuses=${networkEvents.filter((event) => event.status !== undefined).map((event) => event.status).join(",") || "none"} `
      + `domMutation=${mutation?.changed ?? false} networkClassification=${networkClass}`,
  );
  return { before, after, networkEvents, committedBy: "blur", mutation };
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Infer product type from candidate text for generic ordinal descriptions
 * Avoids hardcoding dynamic product names with masked numbers
 */
function inferProductType(candidateText: string): string {
  const normalized = normalizeText(candidateText);
  
  if (/dep.A?sito|plazo/i.test(normalized)) return "depósito";
  if (/pr.A?stamo|cr.A?dito|prestamo/i.test(normalized)) return "préstamo";
  if (/cuenta|ahorro|corriente/i.test(normalized)) return "cuenta";
  if (/tarjeta|card|cr.A?dito|debito/i.test(normalized)) return "tarjeta";
  if (/inversion|inversión|fondo/i.test(normalized)) return "inversión";
  if (/seguro|policy/i.test(normalized)) return "seguro";
  if (/transferencia|transfer/i.test(normalized)) return "transferencia";
  if (/pago|payment/i.test(normalized)) return "pago";
  
  return "producto";
}

/**
 * Check if a failed assertion was recovered by later success
 * Returns the step index where recovery happened, or undefined if not recovered
 * 
 * Recovery is target-specific. A different successful action only proves that a
 * transition happened; it cannot satisfy this assertion.
 */
export function findAssertionRecoveryByLaterSuccess(
  failedAssertionTarget: string,
  steps: DiscoveryStepResult[],
  currentIndex: number
): number | undefined {
  const normalizedTarget = normalizeText(failedAssertionTarget);
  
  console.log(`[assertion-recovery] checking failed assertion target="${failedAssertionTarget}" normalized="${normalizedTarget}" from index=${currentIndex}`);
  
  // Look for successful actions/assertions on the same target after the failure
  for (let i = currentIndex; i < steps.length; i++) {
    const step = steps[i];
    const stepTarget = normalizeText(step.targetText || "");
    
    console.log(`[assertion-recovery] checking discovery step ${i}: target="${step.targetText}" normalized="${stepTarget}" status="${step.status}"`);
    
    // Check if this step successfully used the same target
    // Consider as success: found, passed, recovered, repaired, satisfied_by_*
    const isSuccessStatus = [
      "found",
      "satisfied_by_children",
      "satisfied_by_previous_assertion",
      "skipped_after_completion"
    ].includes(step.status);
    
    if (stepTarget === normalizedTarget && isSuccessStatus) {
      console.log(`[assertion-recovery] found later success step=${i} target="${step.targetText}" type=action status=${step.status}`);
      return i;
    }
    
    // Check if this is an assertion that passed on the same target
    if (stepTarget === normalizedTarget && step.assertionStatus === "passed") {
      console.log(`[assertion-recovery] found later success step=${i} target="${step.targetText}" type=assertion assertionStatus=passed`);
      return i;
    }
    
    // Check if this step was recovered/repaired (indicates the target was eventually used successfully)
    if (stepTarget === normalizedTarget && (step.recoveryStatus === "recovered" || step.recoveryStatus === "repaired")) {
      console.log(`[assertion-recovery] found later success step=${i} target="${step.targetText}" recoveryStatus=${step.recoveryStatus}`);
      return i;
    }
  }
  
  console.log(`[assertion-recovery] no later success found for target="${failedAssertionTarget}"`);
  return undefined;
}

/**
 * Get unresolved blocking failures - ignores steps that were recovered or marked as non-blocking
 */
export function reconcileAuthGateAssertionFailures(
  steps: DiscoveryStepResult[],
  authGateEvidence?: {
    detected: boolean;
    detectedAtStepIndex?: number;
    completedAfterStepIndex?: number;
    requirementRefs?: Array<{ requirementId: string; facet?: string; claimId?: string }>;
    requiresAuthFlowCompletion?: boolean;
    stage?: string;
  },
): number {
  let reconciled = 0;
  for (const assertion of steps) {
    if (!(
      (assertion.status === "not_found" || assertion.status === "needs_assertion_resolution")
      && assertion.functionalRequired === true
    )) continue;

    const gate = steps.find((candidate) =>
      candidate.index === assertion.index - 1
      && candidate.authGateDiagnostics?.detected === true
      && (candidate.canonicalRequirementRefs?.length ?? 0) > 0,
    );
    const runtimeGateIsCausal = authGateEvidence?.detected === true
      && authGateEvidence.requiresAuthFlowCompletion !== true
      && (
        authGateEvidence.completedAfterStepIndex === assertion.index - 1
        || authGateEvidence.detectedAtStepIndex === assertion.index
      );
    const completedAuthGateIsCausal = authGateEvidence?.detected === true
      && authGateEvidence.completedAfterStepIndex === assertion.index - 1;
    if (!gate && !runtimeGateIsCausal) continue;

    const sharedLineage = gate?.canonicalRequirementRefs?.some((gateRef) =>
      assertion.canonicalRequirementRefs!.some((assertionRef) => assertionRef.requirementId === gateRef.requirementId),
    ) ?? false;
    const causalDestinationLineage = gate?.canonicalRequirementRefs?.some((gateRef) =>
      ["activation", "action"].includes(gateRef.facet ?? "")
      && assertion.canonicalRequirementRefs!.some((assertionRef) => assertionRef.facet === "destination"),
    ) ?? false;
    const runtimeRequirementLineage = authGateEvidence?.requirementRefs?.some((gateRef) =>
      assertion.canonicalRequirementRefs!.some((assertionRef) => assertionRef.requirementId === gateRef.requirementId),
    ) ?? false;
    if (!runtimeGateIsCausal && !completedAuthGateIsCausal && !sharedLineage && !causalDestinationLineage) continue;
    if (authGateEvidence?.requirementRefs?.length && !runtimeRequirementLineage) continue;

    assertion.runtimeBacked = true;
    assertion.recoveryStatus = "recovered";
    assertion.recoveredBy = "auth_flow";
    assertion.recoveryMetadata = {
      ...(assertion.recoveryMetadata ?? {}),
      originalFailureReason: assertion.error ?? "assertion_not_found",
      recoveredAfterStep: authGateEvidence?.completedAfterStepIndex ?? gate?.index ?? assertion.index - 1,
      recoveredBecause: "auth_gate_completed",
      blocking: false,
    };
    assertion.status = "satisfied_by_previous_assertion";
    assertion.assertionStatus = "passed";
    reconciled++;
  }
  return reconciled;
}

function getUnresolvedBlockingFailures(steps: DiscoveryStepResult[]): DiscoveryStepResult[] {
  let total = 0;
  let blocking = 0;
  let pendingDiscoveryCount = 0;
  let contextualCount = 0;

  const result = steps.filter((s) => {
    total++;
    // Skip if recovered
    if (s.recoveryStatus === "recovered" || s.recoveryStatus === "repaired") {
      return false;
    }

    // Canonical required assertions remain blocking until their own evidence
    // satisfies them, even when they have no runtime backing yet.
    if (s.functionalRequired === true && (s.status === "not_found" || s.status === "needs_assertion_resolution")) {
      blocking++;
      return true;
    }
    
    // Skip if marked as non-blocking by recovery metadata
    const recoveryMeta = (s as any).recoveryMetadata;
    if (recoveryMeta?.blocking === false && s.functionalRequired !== true) {
      return false;
    }
    
    // Skip if recoveredBy is set to a known recovery mechanism
    if (s.recoveredBy && ["auth_flow", "page_stability", "later_success", "retry_after_navigation", "contextual_intermediate_already_satisfied"].includes(s.recoveredBy)) {
      return false;
    }
    
    if (!(s.status === "not_found" || s.status === "needs_assertion_resolution")) {
      return false;
    }

    // Skip pendingDiscovery — requires actual discovery, not a failure
    if ((s as any)?.pendingDiscovery === true) {
      pendingDiscoveryCount++;
      return false;
    }

    if (!s.assertionClassification) {
      blocking++;
      return true;
    }

    const importance = s.assertionImportance ?? "blocking";
    if (s.functionalRequired !== true && (importance === "contextual" || importance === "optional")) {
      contextualCount++;
      return false;
    }

    if (s.conditionalAssertion && s.conditionalRisk === "high") {
      return false;
    }

    blocking++;
    return true;
  });

  console.log(`[blocking-failure-filter] total=${total} blocking=${blocking} pendingDiscovery=${pendingDiscoveryCount} contextual=${contextualCount}`);

  return result;
}

function isPassedAssertion(step: DiscoveryStepResult): boolean {
  const isAssertionRecord = step.action === "assert"
    || step.assertionStatus !== undefined
    || step.assertionClassification !== undefined;
  return isAssertionRecord
    && (step.status === "found"
      || step.status === "satisfied_by_children"
      || step.status === "satisfied_by_previous_assertion"
      || step.assertionStatus === "passed"
      || step.assertionStatus === "satisfied_by_children"
      || step.assertionStatus === "satisfied_by_previous_assertion");
}

function sameAssertionIdentity(failed: DiscoveryStepResult, passed: DiscoveryStepResult): boolean {
  if (typeof failed.index === "number" && typeof passed.index === "number") {
    return failed.index === passed.index;
  }

  return Boolean(
    failed.targetText
    && passed.targetText
    && normalizeText(failed.targetText) === normalizeText(passed.targetText),
  );
}

export function reconcileAssertionFailuresAfterPass(
  steps: DiscoveryStepResult[],
  finalPass?: Pick<DiscoveryStepResult, "index" | "targetText" | "action" | "status" | "assertionStatus">,
): number {
  const passedAssertions = [
    ...steps.filter(isPassedAssertion),
    ...(finalPass && isPassedAssertion(finalPass as DiscoveryStepResult) ? [finalPass as DiscoveryStepResult] : []),
  ];
  let reconciled = 0;

  for (const passedAssertion of passedAssertions) {
    for (const failedAssertion of steps) {
      if (failedAssertion === passedAssertion
        || (failedAssertion.action !== "assert"
          && failedAssertion.assertionStatus === undefined
          && failedAssertion.assertionClassification === undefined)
        || failedAssertion.recoveryStatus === "recovered"
        || failedAssertion.recoveryStatus === "repaired"
        || !(failedAssertion.status === "not_found" || failedAssertion.status === "needs_assertion_resolution")
        || !sameAssertionIdentity(failedAssertion, passedAssertion)) {
        continue;
      }

      failedAssertion.recoveryStatus = "recovered";
      failedAssertion.recoveredBy = "assertion_pass";
      failedAssertion.recoveryMetadata = {
        ...failedAssertion.recoveryMetadata,
        originalFailureReason: failedAssertion.error,
        recoveredAfterStep: passedAssertion.index,
        recoveredBecause: "same_assertion_passed",
        blocking: false,
      };
      failedAssertion.pendingDiscovery = false;
      failedAssertion.error = undefined;
      reconciled++;
    }
  }

  return reconciled;
}

export function reconcileFailureMarkers(
  steps: DiscoveryStepResult[],
  markers: { failedAtStep?: number; failedTarget?: string; failedReason?: string },
): { failedAtStep?: number; failedTarget?: string; failedReason?: string } {
  const unresolved = getUnresolvedBlockingFailures(steps);
  const failedStep = markers.failedAtStep === undefined
    ? undefined
    : steps.find((step) => step.index === markers.failedAtStep);
  const reconciled = Boolean(
    failedStep
    && (failedStep.recoveryStatus === "recovered"
      || failedStep.recoveryStatus === "repaired"
      || failedStep.status === "satisfied_by_previous_assertion"
      || failedStep.status === "satisfied_by_children"
      || failedStep.assertionStatus === "satisfied_by_previous_assertion")
    && !unresolved.some((step) => step.index === markers.failedAtStep),
  );
  return reconciled
    ? { failedAtStep: undefined, failedTarget: undefined, failedReason: undefined }
    : markers;
}

export function calculateUnresolvedBlockingFailures(
  steps: DiscoveryStepResult[],
  authGateEvidence?: {
    detected: boolean;
    detectedAtStepIndex?: number;
    completedAfterStepIndex?: number;
    requirementRefs?: Array<{ requirementId: string; facet?: string; claimId?: string }>;
    requiresAuthFlowCompletion?: boolean;
    stage?: string;
  },
): DiscoveryStepResult[] {
  const candidateFailures = steps.filter((step) =>
    step.functionalRequired === true
    && (step.status === "not_found" || step.status === "needs_assertion_resolution"),
  ).length;
  reconcileAssertionFailuresAfterPass(steps);
  reconcileAuthGateAssertionFailures(steps, authGateEvidence);
  const remaining = getUnresolvedBlockingFailures(steps);
  console.log(`[auth-gate-reconciliation] candidateFailures=${candidateFailures} reconciled=${steps.filter((step) => step.recoveredBy === "auth_flow" && step.recoveryMetadata?.recoveredBecause === "auth_gate_completed").length} remainingBlocking=${remaining.length}`);
  return remaining;
}

function countNonBlockingAssertionFailures(steps: DiscoveryStepResult[]): number {
  return steps.filter((s) => {
    if (!(s.status === "not_found" || s.status === "needs_assertion_resolution")) return false;
    if (!s.assertionClassification) return false;
    const importance = s.assertionImportance ?? "blocking";
    return importance === "contextual" || importance === "optional" || (s.conditionalAssertion === true && s.conditionalRisk === "high");
  }).length;
}

export type DiscoveryAssertionContract = {
  pendingBlockingActions: string[];
  pendingCriticalAssertions: string[];
  unresolvedContextualAssertions: string[];
  satisfiedByEquivalentEvidence: Array<{ assertion: string; evidence: string }>;
  destinationConfirmed: boolean;
};

export type DiscoveryStatusContractResolution = {
  status: CaseDiscoveryResult["status"];
  shouldSkipFullDiscovery: boolean;
  shouldExecuteFunctionalGate: boolean;
  decisionReason?:
    | "only_contextual_assertions_pending"
    | "observable_assertion_requires_discovery"
    | "blocking_assertions_or_actions_pending"
    | "hard_blocking_reason";
};

const DESTINATION_CONFIRMATION_STRUCTURAL_SIGNALS = new Set([
  "satisfied_by_structural_evidence",
  "satisfied_by_form_field_presence",
  "satisfied_by_confirmation_closed",
  "satisfied_by_action_executed",
  "satisfied_by_post_confirmation_navigation",
  "satisfied_by_cart_structure",
  "structurally_satisfied"
]);

const HARD_BLOCKING_FAILURE_REASONS = new Set([
  "target_not_found",
  "wrong_screen",
  "missing_intermediate_step",
  "missing_intermediate_step_to_final_target",
  "target_not_interactable",
  "click_no_transition",
  "precondition_unresolved",
  "needs_setup_resolution",
  "needs_approval",
  "needs_associated_target_resolution",
  "associated_entity_not_found",
  "associated_action_not_found",
  "locator_resolution_failed",
  "fill_target_not_editable",
  "fill_target_not_visible",
  "fill_resolution_failed",
  "fill_resolution_invalid"
]);

function isHardBlockingFailureReason(reason?: string): boolean {
  if (!reason) return false;
  return HARD_BLOCKING_FAILURE_REASONS.has(reason);
}

function normalizeAssertionLabel(step: DiscoveryStepResult): string {
  return (step.targetText ?? step.action ?? "").trim();
}

function assertionRequiresAuthCompletion(assertionText: string): boolean {
  const normalized = normalizeText(assertionText);
  const completionSignals = [
    /\bautenticad[oa]s?\b/,
    /\bauthenticated\b/,
    /\blog(?:ged)?\s*in\b/,
    /\bsesion iniciada\b/,
    /\bsigned in\b/,
    /\bafter login\b/,
    /\bpost[- ]login\b/,
    /\bacceso concedido\b/,
    /\bauth(?:entication)?\s*completed\b/,
    /\bautenticacion completad[ao]\b/,
  ];
  return completionSignals.some((pattern) => pattern.test(normalized));
}

function isAuthGateCompleted(step: DiscoveryStepResult): boolean {
  if (step.recoveredBy === "auth_flow") {
    return true;
  }
  const diagnostics = step.authGateDiagnostics;
  if (!diagnostics) {
    return false;
  }
  if (Boolean(diagnostics.completedBy)) {
    return true;
  }
  const stage = normalizeText(diagnostics.stage ?? "");
  if (!stage) {
    return false;
  }
  return stage.includes("authenticated") || stage.includes("private_menu") || stage.includes("operations");
}

function detectEquivalentAssertionEvidence(step: DiscoveryStepResult, assertionLabel: string): string | undefined {
  if (step.recoveredBy === "auth_flow" || step.authGateDiagnostics?.detected) {
    if (assertionRequiresAuthCompletion(assertionLabel)) {
      return isAuthGateCompleted(step) ? "auth_gate_completed" : undefined;
    }
    return isAuthGateCompleted(step) ? "auth_gate_completed" : "auth_gate_detected";
  }

  if (step.recoveryMetadata?.transitionDetected === true) {
    return "route_transition_detected";
  }

  const structuralSignals = step.structuralSignals ?? [];
  if (structuralSignals.some((signal) => DESTINATION_CONFIRMATION_STRUCTURAL_SIGNALS.has(signal))) {
    return "route_profile_success_signal";
  }

  if (step.assertionStatus === "satisfied_by_children" || step.assertionStatus === "satisfied_by_previous_assertion") {
    return "assertion_relation_satisfied";
  }

  return undefined;
}

function getCanonicalAssertionMetadata(scenario: TestScenario, stepIndex: number): {
  required: boolean;
  refs: Array<{ requirementId: string; facet?: string; claimId?: string }>;
} {
  const scenarioRecord = scenario as TestScenario & {
    stepRequirementRefs?: Array<{ stepIndex: number; requirementId: string; facet?: string }>;
    stepClaims?: Array<{ stepIndex: number; claimId: string; requirementId?: string; facet?: string; required?: boolean; coverable?: boolean }>;
  };
  const refs = (scenarioRecord.stepRequirementRefs ?? []).filter((ref) => ref.stepIndex === stepIndex || ref.stepIndex === stepIndex - 1);
  const claims = scenarioRecord.stepClaims ?? [];
  const canonicalRefs = refs.map((ref) => {
    const claim = claims.find((candidate) =>
      (candidate.stepIndex === ref.stepIndex || candidate.stepIndex === stepIndex || candidate.stepIndex === stepIndex - 1)
      && (!candidate.requirementId || candidate.requirementId === ref.requirementId)
      && (!candidate.facet || !ref.facet || candidate.facet === ref.facet)
    );
    return { requirementId: ref.requirementId, facet: ref.facet, claimId: claim?.claimId };
  });
  const required = canonicalRefs.length > 0 && claims
    .filter((claim) => canonicalRefs.some((ref) => ref.requirementId === claim.requirementId))
    .every((claim) => claim.required !== false && claim.coverable !== false);
  return { required: canonicalRefs.length > 0 && required, refs: canonicalRefs };
}

const OBSERVABLE_REQUIREMENT_FACETS = new Set(["visibility", "text", "label", "content", "heading", "control"]);

export function hasObservableAssertionAuthority(step: Pick<DiscoveryStepResult, "canonicalRequirementRefs" | "assertionDiagnostics">): boolean {
  if (step.assertionDiagnostics?.observableAuthority === true) return true;
  if (step.assertionDiagnostics?.explicitStructuredAssertion === true) return true;
  return (step.canonicalRequirementRefs ?? []).some((ref) => {
    const facet = normalizeText(ref.facet ?? "");
    return OBSERVABLE_REQUIREMENT_FACETS.has(facet)
      || Boolean(ref.claimId && normalizeText(facet).includes("visible"));
  });
}

export type PendingAssertionOracle = {
  backed: boolean;
  consumed?: boolean;
  requirement?: string;
  stepIndex?: number;
  details?: { sourceActionStepIndex?: number; satisfiedBy?: string };
};

/** Reconcile only the pending assertion represented by a supported oracle. */
export function reconcilePendingAssertionsWithBackedOracles(
  steps: DiscoveryStepResult[],
  oracles: PendingAssertionOracle[],
): number {
  let reconciled = 0;
  for (const step of steps) {
    if (!(step.status === "not_found" || step.status === "needs_assertion_resolution")
      || (step as any).pendingDiscovery !== true) continue;
    const assertion = normalizeText(step.targetText ?? step.action);
    const oracle = oracles.find((candidate) => {
      if (candidate.backed !== true || candidate.consumed === false) return false;
      const sameStep = candidate.stepIndex === step.index;
      const sameRequirement = Boolean(candidate.requirement)
        && normalizeText(candidate.requirement ?? "") === assertion;
      const sourceActionMatches = candidate.details?.sourceActionStepIndex === step.index;
      return sameStep || sameRequirement || sourceActionMatches;
    });
    if (!oracle) continue;
    (step as any).pendingDiscovery = false;
    step.recoveryStatus = "recovered";
    step.recoveredBy = "later_success";
    step.recoveryMetadata = {
      ...(step.recoveryMetadata ?? {}),
      blocking: false,
      originalFailureReason: step.error ?? "assertion_not_found",
      recoveredBecause: "backed_observable_oracle",
    };
    step.status = "satisfied_by_previous_assertion";
    step.assertionStatus = "satisfied_by_previous_assertion";
    step.error = undefined;
    reconciled++;
  }
  return reconciled;
}

function isPendingDiscoveryFailureStep(step: DiscoveryStepResult): boolean {
  if (step.recoveryStatus === "recovered" || step.recoveryStatus === "repaired") {
    return false;
  }
  if (step.recoveryMetadata?.blocking === false) {
    return false;
  }
  if (!(step.status === "not_found" || step.status === "needs_assertion_resolution")) {
    return false;
  }
  return true;
}

export function buildDiscoveryAssertionContract(params: {
  steps: DiscoveryStepResult[];
  earlyCompletionSatisfied: boolean;
}): DiscoveryAssertionContract {
  const pendingBlockingActions = new Set<string>();
  const pendingCriticalAssertions = new Set<string>();
  const unresolvedContextualAssertions = new Set<string>();
  const satisfiedByEquivalentEvidence = new Map<string, string>();

  for (const step of params.steps) {
    if (!isPendingDiscoveryFailureStep(step)) {
      continue;
    }

    const assertionLabel = normalizeAssertionLabel(step);
    const isAssertion = Boolean(step.assertionClassification);
    if (!isAssertion) {
      pendingBlockingActions.add(assertionLabel || `step_${step.index}`);
      continue;
    }

    if ((step as any)?.pendingDiscovery !== true) {
      const importance = step.assertionImportance ?? "blocking";
      if (importance === "blocking") {
        pendingCriticalAssertions.add(assertionLabel || `step_${step.index}`);
      }
      continue;
    }

    if (step.functionalRequired === true) {
      pendingCriticalAssertions.add(assertionLabel || `step_${step.index}`);
      continue;
    }

    if (
      assertionRequiresAuthCompletion(assertionLabel) &&
      (step.recoveredBy === "auth_flow" || step.authGateDiagnostics?.detected) &&
      !isAuthGateCompleted(step)
    ) {
      pendingCriticalAssertions.add(assertionLabel || `step_${step.index}`);
      continue;
    }

    const evidence = detectEquivalentAssertionEvidence(step, assertionLabel);
    if (evidence) {
      const key = assertionLabel || `step_${step.index}`;
      if (!satisfiedByEquivalentEvidence.has(key)) {
        satisfiedByEquivalentEvidence.set(key, evidence);
      }
      continue;
    }
    unresolvedContextualAssertions.add(assertionLabel || `step_${step.index}`);
  }

  const destinationConfirmed =
    params.earlyCompletionSatisfied ||
    params.steps.some((step) => step.recoveryMetadata?.transitionDetected === true) ||
    params.steps.some((step) => step.recoveredBy === "auth_flow" || step.authGateDiagnostics?.detected === true) ||
    params.steps.some((step) => (step.structuralSignals ?? []).some((signal) => DESTINATION_CONFIRMATION_STRUCTURAL_SIGNALS.has(signal)));

  return {
    pendingBlockingActions: Array.from(pendingBlockingActions),
    pendingCriticalAssertions: Array.from(pendingCriticalAssertions),
    unresolvedContextualAssertions: Array.from(unresolvedContextualAssertions),
    satisfiedByEquivalentEvidence: Array.from(satisfiedByEquivalentEvidence.entries()).map(([assertion, evidence]) => ({ assertion, evidence })),
    destinationConfirmed
  };
}

export function resolveDiscoveryStatusFromAssertionContract(params: {
  initialStatus: CaseDiscoveryResult["status"];
  unresolvedBlockingFailuresCount: number;
  pendingDiscoveryCount: number;
  someFound: boolean;
  failedReason?: string;
  contract: DiscoveryAssertionContract;
}): DiscoveryStatusContractResolution {
  const hasHardBlockingReason = isHardBlockingFailureReason(params.failedReason);
  const hasBlockingActions = params.contract.pendingBlockingActions.length > 0;
  const hasCriticalAssertions = params.contract.pendingCriticalAssertions.length > 0;
  const hasContextualPending =
    params.contract.unresolvedContextualAssertions.length > 0 ||
    params.contract.satisfiedByEquivalentEvidence.length > 0;

  if (hasHardBlockingReason) {
    return {
      status: params.initialStatus,
      shouldSkipFullDiscovery: false,
      shouldExecuteFunctionalGate: false,
      decisionReason: "hard_blocking_reason"
    };
  }

  if (
    params.unresolvedBlockingFailuresCount === 0 &&
    params.someFound &&
    !hasBlockingActions &&
    !hasCriticalAssertions &&
    hasContextualPending &&
    params.contract.destinationConfirmed
  ) {
    return {
      status: "discovered_passed",
      shouldSkipFullDiscovery: true,
      shouldExecuteFunctionalGate: true,
      decisionReason: "only_contextual_assertions_pending"
    };
  }

  if ((hasBlockingActions || hasCriticalAssertions) && params.initialStatus === "discovered_passed") {
    return {
      status: "discovered_partial",
      shouldSkipFullDiscovery: false,
      shouldExecuteFunctionalGate: false,
      decisionReason: "blocking_assertions_or_actions_pending"
    };
  }

  if (params.pendingDiscoveryCount > 0 && params.initialStatus === "discovered_passed") {
    return {
      status: "discovered_partial",
      shouldSkipFullDiscovery: false,
      shouldExecuteFunctionalGate: false,
      decisionReason: "observable_assertion_requires_discovery"
    };
  }

  return {
    status: params.initialStatus,
    shouldSkipFullDiscovery: false,
    shouldExecuteFunctionalGate: params.initialStatus === "discovered_passed" || params.initialStatus === "repaired_passed"
  };
}

/**
 * Mark failed assertions as recovered if they were resolved by AuthGate, PageStability, or later success
 */
function recoverTransientAssertionFailures(
  steps: DiscoveryStepResult[],
  authGateCompletedAtStep?: number,
  pageStabilizedAtStep?: number
): void {
  const failedAssertions = steps.filter(
    (s) => (s.status === "not_found" || s.status === "needs_assertion_resolution") &&
           s.assertionClassification &&
           !s.recoveryStatus
  );
  
  console.log(`[assertion-recovery] checking ${failedAssertions.length} failed assertion(s) for recovery`);
  
  for (const failedStep of failedAssertions) {
    const target = failedStep.targetText;
    if (!target) continue;
    
    console.log(`[assertion-recovery] checking failed assertion step=${failedStep.index} target="${target}"`);
    
    // Check if recovered by AuthGate
    if (authGateCompletedAtStep !== undefined && authGateCompletedAtStep > failedStep.index) {
      const recoveryIndex = findAssertionRecoveryByLaterSuccess(target, steps, authGateCompletedAtStep);
      if (recoveryIndex !== undefined) {
        failedStep.recoveryStatus = "recovered";
        failedStep.recoveredBy = "auth_flow";
        failedStep.recoveryMetadata = {
          ...failedStep.recoveryMetadata,
          originalFailureReason: failedStep.error,
          recoveredAfterStep: recoveryIndex,
          recoveredBecause: "auth_gate_completed",
          blocking: false
        };
        console.log(`[assertion-recovery] recovered step=${failedStep.index} target="${target}" recoveredBy=auth_flow blocking=false`);
        continue;
      }
    }
    
    // Check if recovered by page stability
    if (pageStabilizedAtStep !== undefined && pageStabilizedAtStep > failedStep.index) {
      const recoveryIndex = findAssertionRecoveryByLaterSuccess(target, steps, pageStabilizedAtStep);
      if (recoveryIndex !== undefined) {
        failedStep.recoveryStatus = "recovered";
        failedStep.recoveredBy = "page_stability";
        failedStep.recoveryMetadata = {
          ...failedStep.recoveryMetadata,
          originalFailureReason: failedStep.error,
          recoveredAfterStep: recoveryIndex,
          recoveredBecause: "page_stabilized",
          blocking: false
        };
        console.log(`[assertion-recovery] recovered step=${failedStep.index} target="${target}" recoveredBy=page_stability blocking=false`);
        continue;
      }
    }
    
    // Check if recovered by later success (without AuthGate)
    // Start searching from the step immediately after the failed assertion
    const recoveryIndex = findAssertionRecoveryByLaterSuccess(target, steps, failedStep.index + 1);
    if (recoveryIndex !== undefined) {
      failedStep.recoveryStatus = "recovered";
      failedStep.recoveredBy = "later_success";
      failedStep.recoveryMetadata = {
        ...failedStep.recoveryMetadata,
        originalFailureReason: failedStep.error,
        recoveredAfterStep: recoveryIndex,
        recoveredBecause: "target_used_successfully_later",
        blocking: false
      };
      console.log(`[assertion-recovery] recovered step=${failedStep.index} target="${target}" recoveredBy=later_success blocking=false`);
    }
  }
}

function envTrue(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.trim().toLowerCase() === "true";
}

function isSnapshotElementEnabled(element: { disabled?: boolean | null }): boolean {
  return element.disabled !== true;
}

function isSnapshotElementClickable(element: {
  visible?: boolean | null;
  type?: string | null;
  role?: string | null;
  tagName?: string | null;
  candidateLocators?: Array<{ strategy: string }>;
}): boolean {
  if (!element.visible) return false;
  const type = String(element.type ?? "").toLowerCase();
  const role = String(element.role ?? "").toLowerCase();
  const tagName = String(element.tagName ?? "").toLowerCase();
  if (["button", "link", "card"].includes(type)) return true;
  if (["button", "link", "option", "listitem"].includes(role)) return true;
  if (["button", "a", "article", "li"].includes(tagName)) return true;
  return Boolean(element.candidateLocators?.some((loc) => loc.strategy === "role" || loc.strategy === "text"));
}

export function extractCleanTarget(action: string): { type: "click" | "assert" | "setup_route" | "skip" | "unknown"; target: string } {
  const intents = parseStepIntent(action);

  const setupIntent = intents.find((i) => i.type === "setup_route");
  if (setupIntent) {
    return { type: "setup_route", target: setupIntent.actionTarget ?? "" };
  }
  const clickIntent = intents.find((i) => i.type === "action_click" || i.type === "action_select");
  if (clickIntent?.actionTarget) {
    return { type: "click", target: clickIntent.actionTarget };
  }

  const assertIntent = intents.find((i) => i.type === "assertion");
  if (assertIntent?.actionTarget) {
    return { type: "assert", target: assertIntent.actionTarget };
  }

  return { type: "unknown", target: action };
}

export function extractAssertionTargets(expectedText: string): string[] {
  if (!expectedText) return [];

  const targets: string[] = [];
  const lines = expectedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Strip leading markdown list markers like "- " or "* "
    const clean = line.replace(/^[-*]\s+/, "").trim();
    if (clean) {
      targets.push(clean);
    }
  }

  return targets;
}

export type ExecutableStep = {
  stepIndex: number;
  originalText: string;
  type: "assertion" | "action_fill" | "action_click" | "action_select" | "optional_action" | "navigation_segment" | "skip";
  target?: string;
  value?: string;
  valueKey?: string;
  valueSource?: FillValueSource;
  isOptional?: boolean;
  source: "action" | "expected" | "expanded_nav";
  inputIntent?: InputIntent;
  requirementRefs?: string[];
  entityScope?: string;
  rowScope?: number;
  rowRelation?: "next" | "added";
  associatedField?: string;
  expectedValueKey?: string;
  triggerStepIndex?: number;
  controlIdentity?: ControlIdentity;
  canonicalAssertion?: import("../scenarios/canonical-scenario").CanonicalAssertion;
  conditionalAction?: import("../scenarios/canonical-scenario").CanonicalConditionalAction;
};

export function projectScenarioInputMetadata(step: {
  inputIntent?: InputIntent;
  requirementRefs?: string[];
}): Pick<ExecutionPlanStep, "inputIntent" | "requirementRefs"> {
  const requirementRefs = step.requirementRefs ?? step.inputIntent?.requirementRefs;
  return {
    ...(step.inputIntent ? { inputIntent: { ...step.inputIntent, ...(step.inputIntent.requirementRefs ? { requirementRefs: [...step.inputIntent.requirementRefs] } : {}) } } : {}),
    ...(requirementRefs ? { requirementRefs: [...requirementRefs] } : {}),
  };
}

export function isFillActionTarget(target: Pick<ActionTargetItem, "actionType" | "valueKey" | "valueSource">): boolean {
  return target.actionType === "action_fill" &&
    Boolean(target.valueKey) &&
    (target.valueSource === "unknown" || target.valueSource === "test_data");
}

/** Product-card escalation requires positive card/detail evidence. */
export function isProductCardClickEligible(input: {
  isFinalProductClick: boolean;
  targetMatchesDetail: boolean;
  isOrdinalBoundToDetail: boolean;
  finalLocatorPresent: boolean;
  detailTargetSource?: string;
}): boolean {
  const hasPositiveDetailEvidence = [
    "targetPath",
    "productAssertion",
    "precedingActionViaAssertion",
    "ordinalAssertionFallback",
    "ordinalActionTarget"
  ].includes(input.detailTargetSource ?? "");

  return input.isFinalProductClick && input.finalLocatorPresent && (
    input.isOrdinalBoundToDetail ||
    (input.targetMatchesDetail && hasPositiveDetailEvidence)
  );
}

export function parseScenarioStepsForDiscovery(scenario: TestScenario): {
  actionTargets: ActionTargetItem[];
  assertionTargets: AssertionTargetInput[];
  skippedActions: { index: number; action: string }[];
  setupIntents: ParsedStepIntent[];
  orderedSteps: ExecutableStep[];
  expectedResultConsumption?: ExpectedResultConsumption[];
  nonExecutableCriteria?: string[];
} {
  const actionTargets: ActionTargetItem[] = [];
  const assertionTargets: AssertionTargetInput[] = [];
  const skippedActions: { index: number; action: string }[] = [];
  const setupIntents: ParsedStepIntent[] = [];
  const orderedSteps: ExecutableStep[] = [];
  let expectedResultConsumption: ExpectedResultConsumption[] | undefined;
  let nonExecutableCriteria: string[] | undefined;

  // Get expected result mode from config (default: context)
  const expectedResultMode: ExpectedResultMode = envConfig.integrations.ai?.expectedResultMode ?? "context";

  console.log(`[expected-result-parser] mode=${expectedResultMode}`);

  const findExistingAssertionByTarget = (target: string): boolean =>
    assertionTargets.some((a) => a.source === "action" && normalizeText(a.target) === normalizeText(target));

  const scenarioRequirementRefs = (scenario as TestScenario & {
    stepRequirementRefs?: Array<{ stepIndex: number; requirementId: string }>;
  }).stepRequirementRefs ?? [];

  for (const step of scenario.steps) {
    const requiredContext = (step as any).requiredContext ?? (step as any).requirement?.requiredContext;
    const canonicalAssertion = step.canonicalAssertion;
    const requirementRefs = step.requirementRefs ?? scenarioRequirementRefs
      .filter((ref) => ref.stepIndex === step.index)
      .map((ref) => ref.requirementId);
    if (canonicalAssertion) {
      const scopedIntent = parseStepIntent(step.action).find((intent) => intent.type === "assertion");
      const assertionTarget = canonicalAssertion.trigger || canonicalAssertion.condition
        ? step.action
        : canonicalAssertion.subject ?? canonicalAssertion.expectedState ?? step.action;
      orderedSteps.push({
        stepIndex: step.index,
        originalText: step.action,
        type: "assertion",
        target: assertionTarget,
        source: "action",
        ...(requirementRefs.length > 0 ? { requirementRefs: [...requirementRefs] } : {}),
        ...(scopedIntent?.entityScope ? { entityScope: scopedIntent.entityScope } : {}),
        ...(scopedIntent?.rowScope !== undefined ? { rowScope: scopedIntent.rowScope } : {}),
        ...(scopedIntent?.rowRelation ? { rowRelation: scopedIntent.rowRelation } : {}),
        ...(scopedIntent?.expectedValueKey ? { expectedValueKey: scopedIntent.expectedValueKey } : {}),
        canonicalAssertion,
      });
      assertionTargets.push({
        index: step.index,
        action: step.action,
        target: assertionTarget,
        source: "action",
        ...(requirementRefs.length > 0 ? { requirementRefs: [...requirementRefs] } : {}),
        ...(scopedIntent?.entityScope ? { entityScope: scopedIntent.entityScope } : {}),
        ...(scopedIntent?.rowScope !== undefined ? { rowScope: scopedIntent.rowScope } : {}),
        ...(scopedIntent?.rowRelation ? { rowRelation: scopedIntent.rowRelation } : {}),
        ...(scopedIntent?.expectedValueKey ? { expectedValueKey: scopedIntent.expectedValueKey } : {}),
        canonicalAssertion,
        ...(requiredContext ? { requiredContext } : {}),
      });
      continue;
    }
    const intents = parseStepIntent(step.action);

    for (const intent of intents) {
      if (intent.type === "precondition_context" || intent.type === "navigation_path" || intent.type === "setup_route") {
        setupIntents.push({ ...intent, originalText: step.action });
      } else if (intent.type === "setup_authentication") {
        setupIntents.push({ ...intent, originalText: step.action, priority: step.index });
      } else if (intent.type === "assertion" && intent.actionTarget && !intent.isOptional) {
        orderedSteps.push({
          stepIndex: step.index,
          originalText: step.action,
          type: "assertion",
          target: intent.actionTarget,
          source: "action",
          ...(requirementRefs.length > 0 ? { requirementRefs: [...requirementRefs] } : {}),
          ...(intent.entityScope ? { entityScope: intent.entityScope } : {}),
          ...(intent.rowScope !== undefined ? { rowScope: intent.rowScope } : {}),
          ...(intent.rowRelation ? { rowRelation: intent.rowRelation } : {}),
          ...(intent.expectedValueKey ? { expectedValueKey: intent.expectedValueKey } : {}),
          ...(intent.canonicalAssertion ? { canonicalAssertion: intent.canonicalAssertion } : {}),
        });
        assertionTargets.push({
          index: step.index,
          action: step.action,
          target: intent.actionTarget,
          source: "action",
          ...(requirementRefs.length > 0 ? { requirementRefs: [...requirementRefs] } : {}),
          ...(intent.entityScope ? { entityScope: intent.entityScope } : {}),
          ...(intent.rowScope !== undefined ? { rowScope: intent.rowScope } : {}),
          ...(intent.rowRelation ? { rowRelation: intent.rowRelation } : {}),
          ...(intent.expectedValueKey ? { expectedValueKey: intent.expectedValueKey } : {}),
          ...(intent.canonicalAssertion ? { canonicalAssertion: intent.canonicalAssertion } : {}),
          ...(requiredContext ? { requiredContext } : {})
        });
      } else if (intent.type === "unknown") {
        assertionTargets.push({
          index: step.index,
          action: step.action,
          target: intent.originalText,
          source: "action",
          ...(requiredContext ? { requiredContext } : {})
        });
      } else if (intent.actionTarget) {
        let targetText = intent.actionTarget;
        let associatedEntity = intent.associatedEntity;

        // composite_action: target the action button, not the product name
        if (intent.type === "composite_action") {
          if (intent.actionVerb === "add_to_cart") {
            targetText = "Add to cart";
          } else if (intent.actionVerb?.startsWith("remove")) {
            targetText = "Remove";
          }
          associatedEntity = intent.associatedEntity ?? intent.actionTarget;
        }

        // select_first_visible_item: use context/category as target, mark semantic role
        if (intent.type === "select_first_visible_item") {
          targetText = intent.context || "first visible item";
          associatedEntity = intent.associatedEntity;
        }

        const item: ActionTargetItem = {
          index: step.index,
          action: step.action,
          target: targetText,
          isOptional: intent.isOptional,
          associatedEntity,
          selectionField: intent.selectionField,
          entityScope: intent.entityScope,
          rowScope: intent.rowScope,
          rowRelation: intent.rowRelation,
          associatedField: intent.associatedField,
          expectedValueKey: intent.expectedValueKey,
          actionType: intent.type,
          semanticRole: intent.semanticRole,
          relationContext: intent.relationContext
        };
        if (intent.conditionalAction) item.conditionalAction = intent.conditionalAction;
        const sourceStep = step as TestScenarioStep;
        const structuredMetadata = projectScenarioInputMetadata({
          ...sourceStep,
          requirementRefs: sourceStep.requirementRefs ?? scenarioRequirementRefs
            .filter((ref) => ref.stepIndex === step.index)
            .map((ref) => ref.requirementId),
        });
        Object.assign(item, structuredMetadata);
        if (intent.valueSource !== undefined) item.valueSource = intent.valueSource;
        if (intent.valueKey) item.valueKey = intent.valueKey;
        if (intent.value !== undefined) item.value = intent.value;
        actionTargets.push(item);
        orderedSteps.push({
          stepIndex: step.index,
          originalText: step.action,
          type: intent.isOptional ? "optional_action" : (intent.type === "action_fill" ? "action_fill" : intent.type === "action_select" || intent.type === "select_first_visible_item" ? "action_select" : "action_click"),
          target: targetText,
          valueKey: intent.valueKey,
          value: intent.value,
          valueSource: item.valueSource,
          isOptional: intent.isOptional,
          source: "action",
          entityScope: intent.entityScope,
          rowScope: intent.rowScope,
          rowRelation: intent.rowRelation,
          associatedField: intent.associatedField,
          expectedValueKey: intent.expectedValueKey,
          conditionalAction: intent.conditionalAction,
          ...structuredMetadata
        });
      }
    }
  }

  // Bind each canonical oracle to the latest structurally relevant action in
  // the scenario sequence. This is lineage, not DOM/text inference: the live
  // resolver receives the same prerequisite identity that the canonical model
  // derived from the source step order.
  const findOracleTrigger = (assertion: AssertionTargetInput): number | undefined => {
    const oracleType = assertion.canonicalAssertion?.oracleType;
    const priorSteps = scenario.steps.filter((candidate) => candidate.index < assertion.index);
    if (priorSteps.length === 0) return undefined;
    if (oracleType === "row_scoped_value") {
      const matchingSource = priorSteps
        .filter((candidate) => {
          const intent = parseStepIntent(candidate.action).find((item) => item.type !== "assertion");
          return intent?.type === "action_fill"
            && (assertion.rowScope === undefined || intent.rowScope === undefined || intent.rowScope === assertion.rowScope)
            && Boolean((candidate as any).valueKey ?? intent.valueKey);
        })
        .at(-1);
      return matchingSource?.index ?? priorSteps.at(-1)?.index;
    }
    if (oracleType === "structural_row_count") {
      const rowAction = priorSteps
        .filter((candidate) => {
          const intent = parseStepIntent(candidate.action).find((item) => item.type !== "assertion");
          return intent?.rowRelation === "added";
        })
        .at(-1);
      return rowAction?.index ?? priorSteps.at(-1)?.index;
    }
    if (oracleType === "entity_within_container") {
      return priorSteps
        .filter((candidate) => parseStepIntent(candidate.action).some((item) => item.type !== "assertion"))
        .at(-1)?.index;
    }
    return undefined;
  };
  for (const assertion of assertionTargets) {
    const triggerStepIndex = findOracleTrigger(assertion);
    if (triggerStepIndex !== undefined) assertion.triggerStepIndex = triggerStepIndex;
  }
  for (const executable of orderedSteps) {
    if (executable.type !== "assertion") continue;
    const source = assertionTargets.find((assertion) => assertion.index === executable.stepIndex);
    if (source?.triggerStepIndex !== undefined) executable.triggerStepIndex = source.triggerStepIndex;
  }

  // Process expected results based on mode
  if (scenario.steps.length > 0) {
    const lastStep = scenario.steps[scenario.steps.length - 1];
    if (lastStep.expected) {
      const expectedTargets = extractAssertionTargets(lastStep.expected);
      
      if (expectedResultMode === "context") {
        // Mode: context - store as non-blocking metadata only
        expectedResultConsumption = expectedTargets.map(text => ({
          originalText: text,
          classification: "non_executable_criteria" as const,
          reason: "mode=context: expected result stored as non-blocking context"
        }));
        nonExecutableCriteria = expectedTargets;
        console.log(`[expected-result-parser] expected results stored as non-blocking context. items=${expectedTargets.length}`);
        console.log(`[discovery:case] Expected result assertions disabled by mode=context`);
      } else if (expectedResultMode === "smart") {
        // Mode: smart - convert only observable assertions, rest as non-executable
        const existingConcreteAssertions = assertionTargets
          .filter((a) => a.source === "action")
          .map((a) => a.target);
        const buildResult = buildConcreteAssertionsFromExpected(expectedTargets, existingConcreteAssertions);
        expectedResultConsumption = buildResult.expectedResultConsumption;
        nonExecutableCriteria = buildResult.nonExecutableCriteria;
        
        for (const target of buildResult.assertions) {
          if (findExistingAssertionByTarget(target)) {
            continue;
          }
          const requiredContext = (lastStep as any).requiredContext ?? (lastStep as any).requirement?.requiredContext;
          assertionTargets.push({ index: lastStep.index, action: target, target, source: "expected", ...(requiredContext ? { requiredContext } : {}) });
          orderedSteps.push({
            stepIndex: lastStep.index,
            originalText: target,
            type: "assertion",
            target,
            source: "expected"
          });
        }
        console.log(`[expected-result-parser] mode=smart: converted ${buildResult.assertions.length} observable assertions, ${nonExecutableCriteria.length} non-executable`);
      } else {
        // Mode: assertions - legacy behavior, convert all to assertions
        const existingConcreteAssertions = assertionTargets
          .filter((a) => a.source === "action")
          .map((a) => a.target);
        const buildResult = buildConcreteAssertionsFromExpected(expectedTargets, existingConcreteAssertions);
        expectedResultConsumption = buildResult.expectedResultConsumption;
        nonExecutableCriteria = buildResult.nonExecutableCriteria;
        
        for (const target of buildResult.assertions) {
          if (findExistingAssertionByTarget(target)) {
            continue;
          }
          const requiredContext = (lastStep as any).requiredContext ?? (lastStep as any).requirement?.requiredContext;
          assertionTargets.push({ index: lastStep.index, action: target, target, source: "expected", ...(requiredContext ? { requiredContext } : {}) });
          orderedSteps.push({
            stepIndex: lastStep.index,
            originalText: target,
            type: "assertion",
            target,
            source: "expected"
          });
        }
        console.log(`[expected-result-parser] mode=assertions: converted ${buildResult.assertions.length} assertions from expected results`);
      }
      
      // Non-executable criteria are tracked in metadata but don't block execution
      // They are logged for diagnostics but not added as assertion targets
      if (nonExecutableCriteria && nonExecutableCriteria.length > 0) {
        console.log(`[discovery:case] Non-executable expected criteria (${nonExecutableCriteria.length}): ${nonExecutableCriteria.map(c => `"${c}"`).join(", ")}`);
      }
      if (expectedResultConsumption && expectedResultConsumption.some(c => c.classification === "covered_by_concrete_assertions")) {
        console.log(`[discovery:case] Expected result covered by concrete assertions from steps`);
      }
    }
  }

  return {
    actionTargets,
    assertionTargets,
    skippedActions,
    setupIntents,
    orderedSteps,
    expectedResultConsumption,
    nonExecutableCriteria
  };
}

type PageState = {
  url: string;
  bodyText: string;
  elementCount: number;
};

async function capturePageState(page: Page): Promise<PageState> {
  const url = page.url();
  const bodyText = await page.evaluate(() => {
    return (document.body?.textContent ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  });
  const elementCount = await page.evaluate(() => document.querySelectorAll("*").length);
  return { url, bodyText, elementCount };
}

/**
 * Dismiss one obstructing dialog only when the next action is outside it and
 * the dialog exposes exactly one generic close control. This is structural
 * recovery for transient overlays; it does not inspect application labels or
 * infer a business action from dialog text.
 */
async function dismissObstructingDialog(page: Page, nextTarget: string): Promise<boolean> {
  const dialogs = page.locator('[role="dialog"], [role="alertdialog"], dialog');
  const visibleDialogs: Locator[] = [];
  for (let index = 0; index < await dialogs.count(); index++) {
    const dialog = dialogs.nth(index);
    if (await dialog.isVisible().catch(() => false)) visibleDialogs.push(dialog);
  }
  if (visibleDialogs.length !== 1) return false;
  const dialog = visibleDialogs[0];
  const targetInsideDialog = await dialog.getByText(nextTarget, { exact: false }).count().catch(() => 0);
  if (targetInsideDialog > 0) return false;

  const namedClose = dialog.getByRole("button", { name: /^(?:close|cerrar|dismiss|descartar|x|×)$/i });
  const namedCount = await namedClose.count().catch(() => 0);
  const structuralClose = dialog.locator('[data-slot="dialog-close"]');
  const structuralCount = await structuralClose.count().catch(() => 0);
  const close = namedCount === 1
    ? namedClose
    : structuralCount === 1
      ? structuralClose
      : undefined;
  if (!close) return false;
  await close.click({ timeout: 3000 });
  await page.waitForTimeout(250);
  console.log(`[dialog-recovery] dismissed=true reason=obstructing_dialog nextActionTargetPresent=${Boolean(nextTarget.trim())}`);
  return true;
}

async function hasBlockingOverlay(page: Page): Promise<boolean> {
  const surfaces = page.locator('[role="dialog"], [role="alertdialog"], dialog, [data-slot="dialog-overlay"]');
  for (let index = 0; index < await surfaces.count(); index++) {
    const surface = surfaces.nth(index);
    const blocking = await surface.evaluate((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && style.pointerEvents !== "none"
        && rect.width > 0
        && rect.height > 0;
    }).catch(() => false);
    if (blocking) return true;
  }
  return false;
}

export function shouldDeferAssertionEvaluation(params: {
  assertionIndex: number;
  currentStepIndex: number;
  triggerStepIndex?: number;
  triggerExecuted?: boolean;
}): boolean {
  return params.triggerStepIndex != null
    && params.assertionIndex > params.triggerStepIndex
    && params.triggerExecuted !== true;
}

export function evaluateEarlyCompletion(
  snapshot: PageSnapshot,
  assertionTargets: AssertionTargetInput[],
  remainingActionTargets: ActionTargetItem[],
  appConfig?: any,
  scheduling?: { currentStepIndex?: number; triggerStepIndex?: number; triggerExecuted?: boolean }
): {
  checked: boolean;
  satisfied: boolean;
  satisfiedAssertions: string[];
  pendingAssertions: string[];
  deferredAssertions: string[];
  blockingAssertions: string[];
  skippedAssertions: string[];
  weakSignals: string[];
  skippedReason?: string;
  skippedRemainingActions: number;
} {
  const GENERIC_DESCRIPTOR_PATTERNS = [
    /informacion principal del producto visible/i,
    /informacion del producto visible/i,
    /detalle visible/i,
    /detalle de producto visible/i,
    /detalle de [a-z0-9 ]+ visible/i,
    /vista de detalle visible/i,
    /datos principales visibles/i
  ];

  function isGenericDescriptorText(text: string): boolean {
    const normalized = normalizeText(text);
    return GENERIC_DESCRIPTOR_PATTERNS.some((p) => p.test(normalized));
  }

  function isDetailDescriptorText(text: string): boolean {
    const normalized = normalizeText(text);
    return /detalle|detail|resumen|informacion/.test(normalized);
  }

  function hasConcreteSubject(text: string): boolean {
    const normalized = normalizeText(text)
      .replace(/informacion|principal|producto|visible|detalle|vista|de|del|la|el|los|las|detail|summary/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalized.split(" ").filter(Boolean).length >= 1;
  }

  function detailSubjectAppearsInSnapshot(text: string): boolean {
    const normalized = normalizeText(text)
      .replace(/detalle|detail|visible|vista|de|del|la|el|los|las/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const subjectTokens = normalized.split(" ").filter(Boolean).filter((t) => t.length > 2 && t !== "producto" && t !== "product");
    if (subjectTokens.length === 0) return false;
    const visibleBlob = normalizeText(`${snapshot.title} ${snapshot.elements.map((el) => `${el.text ?? ""} ${el.label ?? ""} ${el.name ?? ""}`).join(" ")}`);
    const normalizedMatch = subjectTokens.every((t) => visibleBlob.includes(t));
    if (normalizedMatch) return true;

    const rawSubjectTokens = text
      .toLowerCase()
      .replace(/detalle|detail|visible|vista|de|del|la|el|los|las/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .filter((t) => t.length > 2 && t !== "producto" && t !== "product");
    const rawVisibleBlob = `${snapshot.title} ${snapshot.elements.map((el) => `${el.text ?? ""} ${el.label ?? ""} ${el.name ?? ""}`).join(" ")}`.toLowerCase();
    return rawSubjectTokens.length > 0 && rawSubjectTokens.every((t) => rawVisibleBlob.includes(t));
  }

  function inferRequiredContextFromAssertion(text: string): "catalog" | "filtered_list" | "detail" | "cart" | "form" | "confirmation" | "unknown" {
    const normalized = normalizeText(text);
    if (/\bcarrito\b|\bcart\b|\bcheckout\b|\bsubtotal\b|\btotal\b/.test(normalized)) return "cart";
    if (/\bmodal\b|\bdialog\b|\bform\b|\bformulario\b|\bcampo\b|\bfield\b/.test(normalized)) return "form";
    if (/\bconfirm\w*\b|\bsuccess\b|\bexito\b|\bfinaliz\w*\b|\bcompletad\w*\b/.test(normalized)) return "confirmation";
    if (/\bdetalle\b|\bdetail\b|\bdescripcion\b|\bdescription\b|\bimagen\b|\bimage\b|\bprecio\b|\bprice\b/.test(normalized)) return "detail";
    if (/\bfiltro\b|\bfilter\b|\bcategoria\b|\bcategory\b|\bbusqueda\b|\bsearch\b|\bresultad\w*\b/.test(normalized)) return "filtered_list";
    if (/\blistado\b|\bcatalog\w*\b|\bproductos?\b|\bitems?\b|\bcards?\b/.test(normalized)) return "catalog";
    return "unknown";
  }

  function inferCurrentContextFromSnapshot(): "catalog" | "filtered_list" | "detail" | "cart" | "form" | "confirmation" | "unknown" {
    const visibleTexts = snapshot.elements
      .map((el) => normalizeText(`${el.text ?? ""} ${el.label ?? ""} ${el.name ?? ""}`))
      .filter(Boolean);
    const hasCards = snapshot.elements.some((el) => (el.type ?? "").toLowerCase() === "card");
    const hasRows = snapshot.elements.some((el) => ["tr", "li"].includes((el.tagName ?? "").toLowerCase()) || (el.role ?? "").toLowerCase() === "row");
    const hasDialog = snapshot.summary.dialogs > 0 || snapshot.elements.some((el) => ["dialog", "modal"].includes((el.type ?? "").toLowerCase()));
    const hasInputs = snapshot.summary.inputs > 0 || snapshot.elements.some((el) => ["input", "select", "textarea"].includes((el.type ?? "").toLowerCase()));
    const hasHeading = snapshot.elements.some((el) => ["heading", "h1", "h2", "h3"].includes((el.type ?? "").toLowerCase()) || ["h1", "h2", "h3"].includes((el.tagName ?? "").toLowerCase()));
    const hasImage = snapshot.elements.some((el) => (el.tagName ?? "").toLowerCase() === "img" || (el.role ?? "").toLowerCase() === "img");
    const hasMoney = snapshot.elements.some((el) => /(?:USD?\$|EUR|RD\$|\$)\s*\d[\d,.]*|\d[\d,.]*\s*(?:USD|EUR|RD\$)/i.test(`${el.text ?? ""} ${el.label ?? ""} ${el.name ?? ""}`));
    const hasAddToCart = visibleTexts.some((t) => /\badd to cart\b|\bagregar al carrito\b/.test(t));
    const hasCartPageSignal = hasRows || visibleTexts.some((t) => /\bcheckout\b|\bsubtotal\b|\btotal\b|\bshopping cart\b|\bcarrito de compras\b/.test(t));
    const hasSuccessSignal = visibleTexts.some((t) => /\bsuccess\b|\bconfirm\w*\b|\bgracias\b|\bcompletad\w*\b|\bfinalizad\w*\b/.test(t));

    if (hasSuccessSignal) return "confirmation";
    if ((hasDialog && hasInputs) || (hasInputs && snapshot.summary.buttons > 0)) return "form";
    if (hasCartPageSignal) return "cart";
    if (hasAddToCart || (hasHeading && (hasImage || hasMoney))) return "detail";
    if (hasCards || hasRows) return "catalog";
    return "unknown";
  }

  function remainingActionsCanReachContext(requiredContext: string): boolean {
    const blob = remainingActionTargets.map((a) => normalizeText(`${a.action} ${a.target}`)).join(" ");
    if (!blob) return false;
    if (requiredContext === "cart") return /\bcart\b|\bcarrito\b|\bcheckout\b/.test(blob);
    if (requiredContext === "form") return /\babrir\b.*\bform\b|\bopen\b.*\bform\b|\bmodal\b|\bdialog\b|\blogin\b|\bregistr\w*\b/.test(blob);
    if (requiredContext === "confirmation") return /\bsubmit\b|\benviar\b|\bconfirm\w*\b|\bfinaliz\w*\b|\bcompr\w*\b|\bpag\w*\b/.test(blob);
    if (requiredContext === "detail") return /\bview\b|\bdetalle\b|\bdetail\b|\bselect\b|\bseleccionar\b|\bclick\b.*\b(item|producto|card)\b/.test(blob);
    if (requiredContext === "filtered_list") return /\bfiltro\b|\bfilter\b|\bcategoria\b|\bcategory\b|\bbusqueda\b|\bsearch\b/.test(blob);
    return false;
  }

  if (assertionTargets.length === 0) {
    return { checked: false, satisfied: false, satisfiedAssertions: [], pendingAssertions: [], deferredAssertions: [], blockingAssertions: [], skippedAssertions: [], weakSignals: [], skippedRemainingActions: 0 };
  }

  const deferredBeforeTrigger = assertionTargets.filter((assertion) =>
    (() => {
      const currentStepIndex = scheduling?.currentStepIndex ?? Number.POSITIVE_INFINITY;
      const triggerStepIndex = assertion.triggerStepIndex ?? scheduling?.triggerStepIndex;
      const triggerExecuted = assertion.triggerStepIndex !== undefined
        ? currentStepIndex >= assertion.triggerStepIndex
        : scheduling?.triggerExecuted;
      const deferred = shouldDeferAssertionEvaluation({
        assertionIndex: assertion.index,
        currentStepIndex,
        triggerStepIndex,
        triggerExecuted,
      });
      if (deferred) {
        console.log(`[assertion-eligibility] index=${assertion.index} oracleType=${assertion.canonicalAssertion?.oracleType ?? "unstructured"} eligibility=not_eligible_yet triggerStepIndex=${triggerStepIndex ?? "unknown"}`);
      }
      return deferred;
    })()
  );
  const assertionsToResolve = assertionTargets.filter((assertion) => !deferredBeforeTrigger.includes(assertion));
  const resolutionResults = resolveAssertionTargets(snapshot, assertionsToResolve, { appConfig });
  
  const satisfiedAssertions: string[] = [];
  const pendingAssertions: string[] = [];
  const deferredAssertions: string[] = [];
  const skippedAssertions: string[] = [];
  const weakSignals: string[] = [];

  for (const assertion of deferredBeforeTrigger) {
    deferredAssertions.push(assertion.target);
  }

  for (let i = 0; i < resolutionResults.length; i++) {
    const res = resolutionResults[i];
    const input = assertionsToResolve[i];
    const isExpectedSource = input?.source === "expected";

    const isWeakDescriptor = (isExpectedSource && (
      res.classification === "semantic_descriptor" ||
      res.classification === "expected_only" ||
      res.classification === "ambiguous_assertion" ||
      res.classification === "composite_assertion"
    )) || res.isWeakSignal === true;

    const isExpectedDescriptor =
      isExpectedSource &&
      (res.classification === "semantic_descriptor" ||
        res.classification === "composite_assertion" ||
        res.classification === "expected_only" ||
        res.classification === "ambiguous_assertion");
    const isDetailDescriptor = isDetailDescriptorText(res.assertionText);
    const isGenericDescriptor = isGenericDescriptorText(res.assertionText);
    const detailWithConcreteSubject = isDetailDescriptor && hasConcreteSubject(res.assertionText);
    const hasConcreteDetailEvidence = (res.matchedTokens?.length ?? 0) > 0 || Boolean(res.matchedText);
    const detailEvidenceSatisfied = hasConcreteDetailEvidence || detailSubjectAppearsInSnapshot(res.assertionText);
    const keepAsSatisfiedDetail =
      detailWithConcreteSubject &&
      detailEvidenceSatisfied &&
      (
        // Expected detail descriptors with concrete subject become structurally satisfied
        // once equivalent detail evidence is present, even if parser classified them weak.
        (isExpectedSource && (isExpectedDescriptor || res.classification === "structural_assertion")) ||
        (!isExpectedSource && isDetailDescriptor && res.status === "passed")
      );

    // Optional/precondition statuses are skippable
    const isOptionalStatus = 
      res.status === "optional_confirmation_detail_missing" ||
      res.status === "satisfied_by_previous_assertion" ||
      res.status === "precondition_unresolved";

    const isSkippable = (res.status === "skipped_semantic_descriptor") || isWeakDescriptor || isOptionalStatus;
    const contextDecision = (res.assertionDiagnostics as any)?.assertionContextDiagnostics?.decision;
    const inferredRequiredContext = inferRequiredContextFromAssertion(res.assertionText);
    const inferredCurrentContext = inferCurrentContextFromSnapshot();
    const inferredDeferredContext =
      inferredRequiredContext !== "unknown" &&
      inferredCurrentContext !== inferredRequiredContext &&
      remainingActionsCanReachContext(inferredRequiredContext);
    const isDeferredContext = res.reason === "assertion_context_not_reached" || contextDecision === "deferred_until_context" || inferredDeferredContext;
    const isStructurallySatisfied = res.reason === "structurally_satisfied" || contextDecision === "structurally_satisfied";

    const isMandatory = !isSkippable && (
      res.classification === "literal_observable" ||
      res.classification === "structural_assertion" ||
      res.classification === "composite_assertion" ||
      res.classification === "semantic_descriptor"
    );
    const isPreconditionUnresolved = res.status === "precondition_unresolved";
    const shouldTreatPreconditionAsPending =
      isPreconditionUnresolved &&
      !isWeakDescriptor &&
      inferredRequiredContext !== "unknown" &&
      inferredCurrentContext !== inferredRequiredContext &&
      remainingActionTargets.length === 0;

    if (isStructurallySatisfied || keepAsSatisfiedDetail) {
      satisfiedAssertions.push(res.assertionText);
    } else if (shouldTreatPreconditionAsPending) {
      pendingAssertions.push(res.assertionText);
    } else if (isDeferredContext) {
      if (remainingActionTargets.length > 0) {
        deferredAssertions.push(res.assertionText);
      } else if (isMandatory) {
        pendingAssertions.push(res.assertionText);
      } else {
        skippedAssertions.push(res.assertionText);
      }
    } else if ((isExpectedDescriptor || isGenericDescriptor) && !keepAsSatisfiedDetail) {
      skippedAssertions.push(res.assertionText);
      weakSignals.push(res.assertionText);
    } else if (res.status === "passed" || res.status === "satisfied_by_children" || isOptionalStatus) {
      satisfiedAssertions.push(res.assertionText);
    } else if (isSkippable) {
      skippedAssertions.push(res.assertionText);
      if ((res as any).isWeakSignal || isExpectedDescriptor) {
        weakSignals.push(res.assertionText);
      }
    } else if (isMandatory) {
      pendingAssertions.push(res.assertionText);
    } else {
      // Evaluated but not satisfied and not blocking (e.g. passive_visibility that
      // failed with assertion_not_found). Preserve as non-blocking so it is not
      // dropped from early-completion accounting.
      skippedAssertions.push(res.assertionText);
    }
  }

  const hasSensitiveActionsRemaining = remainingActionTargets.some((a: any) => {
    const metadata = a.metadata ?? a;
    const intent = String(metadata.actionIntent ?? "").toLowerCase();
    const status = String(metadata.status ?? "pending").toLowerCase();
    return Boolean(intent) && !["passed", "satisfied", "completed"].includes(status);
  });

  let satisfied = deferredBeforeTrigger.length === 0 && pendingAssertions.length === 0 && satisfiedAssertions.length > 0;
  
  if (hasSensitiveActionsRemaining && satisfied) {
    const explicitMandatorySatisfied = resolutionResults.some(res => 
      (res.classification === "literal_observable" || res.classification === "structural_assertion" || res.classification === "composite_assertion" || res.classification === "semantic_descriptor") &&
      (res.status === "passed" || res.status === "satisfied_by_children")
    );
    if (!explicitMandatorySatisfied) {
      satisfied = false;
    }
  }

  const allSkippedAreWeak = skippedAssertions.length > 0 && weakSignals.length === skippedAssertions.length;
  const skippedReason = skippedAssertions.length > 0
    ? allSkippedAreWeak ? "synthetic_generic_descriptor" : "mixed_descriptors"
    : undefined;

  return {
    checked: true,
    satisfied,
    satisfiedAssertions,
    pendingAssertions,
    deferredAssertions,
    blockingAssertions: pendingAssertions,
    skippedAssertions,
    weakSignals,
    skippedReason,
    skippedRemainingActions: remainingActionTargets.length
  };
}

function hasPageTransition(before: PageState, after: PageState, targetText: string): boolean {
  if (before.url !== after.url) {
    return true;
  }

  const normalizedTarget = normalizeText(targetText);
  const targetDisappeared = !after.bodyText.includes(normalizedTarget);
  if (targetDisappeared) {
    return true;
  }

  const bodyDiffRatio = computeTextDiffRatio(before.bodyText, after.bodyText);
  if (bodyDiffRatio > 0.05) {
    return true;
  }

  if (Math.abs(before.elementCount - after.elementCount) > 5) {
    return true;
  }

  return false;
}

function computeTextDiffRatio(text1: string, text2: string): number {
  const maxLen = Math.max(text1.length, text2.length);
  if (maxLen === 0) return 0;

  let diffChars = 0;
  const len = Math.max(text1.length, text2.length);
  for (let i = 0; i < len; i++) {
    if (text1[i] !== text2[i]) {
      diffChars++;
    }
  }

  return diffChars / maxLen;
}

async function scanAndCollectObjects(
  page: Page,
  stepIndex: number,
  evidenceDir: string
): Promise<{ elementsCount: number; objects: DiscoveredObject[]; url: string; title: string; snapshot: PageSnapshot }> {
  const snapshot = await scanCurrentPage(page);
  const candidates = buildProposedObjects(snapshot.elements);

  const objects: DiscoveredObject[] = [];
  for (const c of candidates) {
    if (c.confidence >= 0.5) {
      objects.push({
        key: c.key,
        name: c.name,
        type: c.type,
        locator: c.locator,
        aliases: [c.name.toLowerCase()],
        discoveredAt: new Date().toISOString(),
        sourceStep: stepIndex,
        confidence: c.confidence
      });
    }
  }

  const evidencePath = path.join(evidenceDir, `step-${stepIndex}-snapshot.json`);
  if (evidenceDir && evidenceDir.trim()) {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(evidencePath, JSON.stringify(snapshot, null, 2), "utf-8");
  }

  return {
    elementsCount: snapshot.elements.length,
    objects,
    url: snapshot.url,
    title: snapshot.title,
    snapshot
  };
}

export type CaseDiscoveryOptions = {
  page: Page;
  scenario: TestScenario;
  evidenceDir: string;
  pendingObjectsPath: string;
  pendingPlansPath: string;
  appBaseUrl: string;
  appSlug?: string;
  testData?: TestDataMap;
  loginAction?: () => Promise<void>;
  loginMode?: "password" | "no_login" | "manual";
  aiAssistedDiscovery?: {
    explorer?: AIExplorer;
    config?: Partial<AiAssistedDiscoveryConfig>;
  };
  env?: Record<string, unknown>;
  missingInputBehavior?: MissingInputBehavior;
  /** Optional evidence recorder for per-step screenshots */
  evidenceRecorder?: import("../evidence/evidence-recorder").EvidenceRecorder;
  /** Per-scenario runtime overrides from QA Lab (dataOverrides) - generic per key */
  scenarioDataOverrides?: Record<string, string>;
  /** Case-scoped runtime entries with explicit provenance from QA Lab. */
  runtimeEntries?: Array<{
    key: string;
    value: string;
    source?: string;
    sensitive?: boolean;
    generated?: boolean;
    verified?: boolean;
    provenance?: string;
    valueRole?: string;
    oracleSource?: string;
  }>;
  /** Per-scenario suggested values from dataRequirements - generic per key */
  scenarioSuggestedData?: Record<string, string>;
  /** Reconcile workflow evidence before the first final blocking/status calculation. */
  beforeFinalStatusCalculation?: (steps: DiscoveryStepResult[]) => number | Promise<number>;
};

function resolveControlledAdvanceAssertions(
  scenario: TestScenario,
): Array<{ index: number; requirement: string; requirementRefs: string[]; intent: CanonicalAssertionIntent; polarity?: AssertionPolarity; advanceAction?: string }> {
  const requirements = (scenario.canonicalRequirements ?? []) as Array<{
    requirementId: string;
    description: string;
    assertionIntents?: CanonicalAssertionIntent[];
    polarity?: AssertionPolarity;
  }>;
  const byId = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const seen = new Set<string>();
  return scenario.steps.flatMap((step) => {
    const refs = Array.isArray(step.requirementRefs) ? step.requirementRefs : [];
    return refs.flatMap((ref) => (byId.get(ref)?.assertionIntents ?? []).flatMap((intent) => {
      const key = `${ref}:${intent}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        index: step.index,
        requirement: step.action,
        requirementRefs: [ref],
        intent,
        polarity: byId.get(ref)?.polarity,
        ...(step.canonicalAssertion?.advanceAction ? { advanceAction: step.canonicalAssertion.advanceAction } : {}),
      }];
    }));
  });
}

function applyControlledAdvanceProbeToSteps(
  steps: DiscoveryStepResult[],
  scenario: TestScenario,
  assertions: Array<{ index: number; requirement: string; requirementRefs: string[]; intent: CanonicalAssertionIntent; polarity?: AssertionPolarity; advanceAction?: string }>,
  result: ControlledAdvanceProbeResult,
): void {
  for (const assertion of assertions) {
    const backed = assertion.intent === "validation_present" ? result.validationObserved : result.blockedObserved;
    const existing = steps.find((step) => step.index === assertion.index);
    const scenarioStep = scenario.steps.find((step) => step.index === assertion.index);
    const next: DiscoveryStepResult = {
      index: assertion.index,
      action: scenarioStep?.action ?? assertion.requirement,
      targetText: assertion.requirement,
      status: backed ? "found" : "needs_assertion_resolution",
      assertionStatus: backed ? "passed" : "needs_assertion_resolution",
      assertionImportance: "blocking",
      runtimeBacked: backed,
      canonicalRequirementRefs: assertion.requirementRefs.map((requirementId) => ({ requirementId })),
      ...(scenarioStep?.canonicalAssertion ? { canonicalAssertion: scenarioStep.canonicalAssertion } : {}),
      assertionDiagnostics: {
        controlledAdvanceProbe: true,
        intent: assertion.intent,
        advanceAction: assertion.advanceAction,
        polarity: assertion.polarity,
        polaritySource: assertion.polarity ? "canonical" : "unresolved",
        candidateFound: result.candidateFound,
        candidateEnabled: result.candidateEnabled,
        attemptPossible: result.attemptPossible,
        resolutionState: result.resolutionState,
        attemptObserved: result.attemptObserved,
        subjectFound: result.subjectFound,
        subjectValidationMutation: result.subjectValidationMutation,
        validationObserved: result.validationObserved,
        transitionOccurred: result.transitionOccurred,
        blockedObserved: result.blockedObserved,
        advanceCausality: result.advanceCausality,
        otherInvalidRequiredControls: result.otherInvalidRequiredControls,
        otherEmptyRequiredControls: result.otherEmptyRequiredControls,
        functionalDefectAssertion13: result.functionalDefectAssertion13,
      },
    };
    if (existing) Object.assign(existing, next);
    else steps.push(next);
  }
}

export function resolveCaseDiscoveryAppSlug(options: Pick<CaseDiscoveryOptions, "appSlug" | "env">): string {
  const explicitAppSlug = typeof options.appSlug === "string" ? options.appSlug.trim() : "";
  if (explicitAppSlug) {
    return explicitAppSlug;
  }
  const envAppSlug = typeof (options.env as any)?.APP_SLUG === "string"
    ? String((options.env as any).APP_SLUG).trim()
    : "";
  return envAppSlug || "default";
}

const DEFAULT_AI_ASSISTED_DISCOVERY_CONFIG: AiAssistedDiscoveryConfig = {
  enabled: false,
  confidenceThreshold: 0.85,
  requireApprovalThreshold: 0.7,
  maxAttempts: 3,
  sensitiveActions: ["fill", "select"]
};

function getAiConstraints(): string[] {
  return [
    "forbid external systems such as Jira",
    "forbid stable registry mutation",
    "disallow invented elements outside snapshot",
    "disallow bypassing framework validations"
  ];
}

export function buildCandidateRequiredData(
  scenario: TestScenario,
  planSteps: ExecutionPlanStep[],
  resolvedKeys?: Set<string>,
): RequiredDataRef[] {
  type CandidateAuthorityRequirement = {
    key: string;
    required?: boolean;
    source?: string;
    provenance?: string;
    sensitive?: boolean;
    valueRole?: "runtime_input" | "expected_oracle" | "runtime_derived_oracle";
    oracleSource?: string;
    dependsOn?: string[];
  };
  const authoritativeRequirements = new Map<string, CandidateAuthorityRequirement>();
  const addRequirements = (requirements: readonly CandidateAuthorityRequirement[] | undefined) => {
    for (const requirement of requirements ?? []) {
      if (!requirement?.key?.trim()) continue;
      const key = requirement.key.trim();
      const existing = authoritativeRequirements.get(key);
      authoritativeRequirements.set(key, existing ? { ...existing, ...requirement, key } : { ...requirement, key });
    }
  };

  // Prefer the current raw TestRail contract, then the Canonical contract,
  // then the runtime projection. None of these are reconstructed from the
  // subset of steps reached before a partial discovery failure.
  if (scenario.raw) {
    addRequirements(extractTestRailInputRequirements(scenario.raw).requirements);
  }
  addRequirements(scenario.canonicalInputRequirements);
  addRequirements(scenario.runtimeInputRequirements);
  const planValueKeys = new Set(
    planSteps.map((step) => step.valueKey?.trim()).filter((key): key is string => Boolean(key)),
  );
  const keys = new Set<string>(authoritativeRequirements.keys());
  for (const key of planValueKeys) keys.add(key);
  return Array.from(keys).map((key) => ({
    key,
    required: authoritativeRequirements.get(key)?.required !== false,
    resolved: (resolvedKeys ?? planValueKeys).has(key),
    ...(authoritativeRequirements.get(key)?.source
      ? { source: authoritativeRequirements.get(key)!.source }
      : authoritativeRequirements.get(key)?.provenance
        ? { source: authoritativeRequirements.get(key)!.provenance }
        : {}),
    ...(authoritativeRequirements.get(key)?.sensitive !== undefined
      ? { sensitive: authoritativeRequirements.get(key)!.sensitive }
      : {}),
    ...(authoritativeRequirements.get(key)?.valueRole
      ? { valueRole: authoritativeRequirements.get(key)!.valueRole }
      : {}),
    ...(authoritativeRequirements.get(key)?.oracleSource
      ? { oracleSource: authoritativeRequirements.get(key)!.oracleSource }
      : {}),
    ...(authoritativeRequirements.get(key)?.dependsOn
      ? { dependsOn: [...authoritativeRequirements.get(key)!.dependsOn!] }
      : {}),
  }));
}

function buildFailureResult(
  scenario: TestScenario,
  steps: DiscoveryStepResult[],
  discoveredObjects: DiscoveredObject[],
  planSteps: ExecutionPlanStep[],
  pendingObjectsPath: string,
  pendingPlansPath: string,
  evidenceDir: string,
  failedAtStep: number,
  failedTarget: string,
  failedReason: string,
  allDiscoveredObjects: DiscoveredObject[]
): CaseDiscoveryResult {
  const requiredData = buildCandidateRequiredData(scenario, planSteps);
  const partialPlan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "needs_discovery",
    scenario: {
      source: "testrail",
      externalId: scenario.externalId,
      caseId: scenario.caseId,
      title: scenario.title
    },
    requiredData,
    steps: planSteps,
    notes: [`Discovery failed at step ${failedAtStep}: ${failedReason} - "${failedTarget}"`],
    createdAt: new Date().toISOString()
  };

  return {
    version: "1.0",
    caseId: scenario.caseId,
    caseTitle: scenario.title,
    discoveredAt: new Date().toISOString(),
    status: "exploration_failed",
    steps,
    discoveredObjects: allDiscoveredObjects,
    candidatePlan: partialPlan,
    pendingObjectsPath,
    pendingPlansPath,
    evidenceDir,
    failedAtStep,
    failedTarget,
    failedReason
  };
}

function isTransientLoadingScreen(snapshot: PageSnapshot): boolean {
  if (!snapshot || !snapshot.elements) return false;

  // Only structured runtime state can establish a transient screen.
  return snapshot.elements.some((el: any) => {
    const role = String(el.role || "").toLowerCase();
    const busy = el.ariaBusy === true || String(el.ariaBusy || "").toLowerCase() === "true" ||
      el["aria-busy"] === true || String(el["aria-busy"] || "").toLowerCase() === "true";
    return busy || role === "progressbar" || role === "status";
  });
}

async function waitForPrivateMenuReadyBeforeTargetResolution(
  page: Page,
  snapshot: PageSnapshot,
  targetName: string,
  evidenceDir: string
): Promise<{ status: "ready" | "blocked" | "timeout"; reason: string; url: string }> {
  const loadingTexts = ["cargando", "loading", "por favor espere", "please wait"];
  const maxAttempts = 12;

  console.log(`[post-otp-gate] start target="${targetName}" ${safeUrlForLog(snapshot.url)}`);

  let attempt = 0;
  let currentSnapshot = snapshot;

  try {
    while (attempt < maxAttempts) {
      attempt++;

      // Check loading state
      const stillLoading = currentSnapshot.elements.some((el: any) =>
        loadingTexts.some(txt => (el.text || el.label || "").toLowerCase().includes(txt))
      );

      // Check if target is visible
      const targetVisible = currentSnapshot.elements.some((el: any) =>
        String(el.text || el.label || "").toLowerCase().includes(String(targetName).toLowerCase())
      );

      // Check if controls/menu items are visible
      const controlCount = currentSnapshot.elements.filter((el: any) =>
        /button|link|menuitem|tab|option/i.test(String(el.role || "")) || el.ariaLabel || el.title || el.testId
      ).length;

      const textCount = currentSnapshot.elements.filter((el: any) =>
        String(el.text || "").trim().length > 0
      ).length;

      const hasControls = controlCount > 0;
      const hasCards = textCount > 2;

      console.log(
        `[post-otp-gate] wait attempt=${attempt} loading=${stillLoading} targetVisible=${targetVisible} controls=${controlCount} ${safeUrlForLog(currentSnapshot.url)}`
      );

      // Ready if target is visible AND screen is stable (no loading indicators)
      if (targetVisible && !stillLoading) {
        console.log(`[post-otp-gate] ready=true reason="target_visible_and_screen_stable" ${safeUrlForLog(currentSnapshot.url)}`);
        return { status: "ready", reason: "target_visible_and_screen_stable", url: currentSnapshot.url };
      }

      // Target visible but still loading — log and continue waiting
      if (targetVisible && stillLoading) {
        console.log(`[post-otp-gate] ready=false reason="target_visible_but_screen_not_stable" loading=${stillLoading} ${safeUrlForLog(currentSnapshot.url)}`);
      }

      if (!stillLoading && hasControls) {
        console.log(`[post-otp-gate] ready=true reason="controls_loaded" ${safeUrlForLog(currentSnapshot.url)}`);
        return { status: "ready", reason: "controls_loaded", url: currentSnapshot.url };
      }

      if (!stillLoading && hasCards && textCount > 2) {
        console.log(`[post-otp-gate] ready=true reason="loading_finished" ${safeUrlForLog(currentSnapshot.url)}`);
        return { status: "ready", reason: "loading_finished", url: currentSnapshot.url };
      }

      // Without configured/runtime landing evidence, remain unresolved.
      if (!isTransientLoadingScreen(currentSnapshot) && !hasControls && authProfile?.privateLanding) {
        if (attempt >= maxAttempts - 2) {
          console.log(
            `[post-otp-gate] blocked reason="private_landing_lost_during_product_loading" ${safeUrlForLog(currentSnapshot.url)}`
          );
          return { status: "blocked", reason: "private_landing_lost_during_product_loading", url: currentSnapshot.url };
        }
      }

      // If still loading and more attempts available, continue waiting
      if (stillLoading && attempt < maxAttempts) {
        await page.waitForTimeout(1000).catch(() => {});
        try {
          const nextCheck = await scanAndCollectObjects(page, 0, evidenceDir);
          currentSnapshot = nextCheck.snapshot;
        } catch (err) {
          // If scan fails, still try to get snapshot via scanCurrentPage
          console.log(`[post-otp-gate] scan error attempt=${attempt}, retrying with scanCurrentPage`);
          try {
            currentSnapshot = await scanCurrentPage(page);
          } catch (err2) {
            // If all scans fail, exit gate as timeout
            console.log(`[post-otp-gate] blocked reason="private_menu_loading_timeout" ${safeUrlForLog(currentSnapshot.url)} error="scan_failed"`);
            return { status: "timeout", reason: "private_menu_loading_timeout", url: currentSnapshot.url };
          }
        }
        continue;
      }

      // If not loading anymore after first check, continue to next attempt
      if (!stillLoading) {
        continue;
      }
    }

    // Exhausted attempts while still loading
    console.log(
      `[post-otp-gate] blocked reason="private_menu_loading_timeout" ${safeUrlForLog(currentSnapshot.url)} attempts=${maxAttempts}`
    );
    return { status: "timeout", reason: "private_menu_loading_timeout", url: currentSnapshot.url };
  } catch (err) {
    // Gate function error - return as blocked to prevent further execution
    console.log(`[post-otp-gate] blocked reason="gate_error" error="${err instanceof Error ? err.message : String(err)}" ${safeUrlForLog(currentSnapshot.url)}`);
    return { status: "blocked", reason: "gate_error", url: currentSnapshot.url };
  }
}

function safeUrlForLog(value: unknown): string {
  if (typeof value !== "string" || !value) return "urlPresent=false";
  try {
    const parsed = new URL(value);
    return `origin="${parsed.origin}" pathname="${parsed.pathname}"`;
  } catch {
    return "urlPresent=true parseable=false";
  }
}

async function captureSessionCheckpoint(page: Page, checkpointName: string, url: string, contextId?: string): Promise<{ origin?: string; contextStable: boolean }> {
  try {
    const contextIdPrev = contextId || "unknown";
    const contextIdCurrent = String(page.context()).substring(0, 16);
    const contextStable = contextIdPrev === contextIdCurrent;

    const cookies = await page.context().cookies();
    const localStorage = await page.evaluate(() => {
      return { entryCount: Object.keys(window.localStorage || {}).length };
    }).catch(() => ({ entryCount: 0 }));

    const sessionStorage = await page.evaluate(() => {
      return { entryCount: Object.keys(window.sessionStorage || {}).length };
    }).catch(() => ({ entryCount: 0 }));

    const urlObj = new URL(url);
    const origin = urlObj.origin;
    const pathname = urlObj.pathname;
    console.log(
      `[auth-session] checkpoint="${checkpointName}" cookies=${cookies.length} ls=${localStorage.entryCount} ss=${sessionStorage.entryCount} ` +
      `origin="${origin}" pathname="${pathname}" contextStable=${contextStable}`
    );

    return { origin, contextStable };
  } catch (error) {
    console.log(`[auth-session] checkpoint="${checkpointName}" error="capture_failed"`);
    return { contextStable: false };
  }
}

async function captureSessionDiagnostics(page: Page, phase: string): Promise<{ origin?: string }> {
  try {
    const cookies = await page.context().cookies();
    const localStorage = await page.evaluate(() => {
      return { entryCount: Object.keys(window.localStorage || {}).length };
    }).catch(() => ({ entryCount: 0 }));

    const sessionStorage = await page.evaluate(() => {
      return { entryCount: Object.keys(window.sessionStorage || {}).length };
    }).catch(() => ({ entryCount: 0 }));

    const urlObj = new URL(page.url());
    const origin = urlObj.origin;
    const pathname = urlObj.pathname;
    console.log(
      `[auth-session] phase="${phase}" cookies=${cookies.length} ls=${localStorage.entryCount} ss=${sessionStorage.entryCount} ` +
      `origin="${origin}" pathname="${pathname}"`
    );

    return { origin };
  } catch (error) {
    console.log(`[auth-session] phase="${phase}" error="diagnostics_failed"`);
    return {};
  }
}

async function tryAuthGateRecovery(
  page: Page,
  snapshot: PageSnapshot,
  options: CaseDiscoveryOptions,
  nextPendingTarget?: string
): Promise<{ recovered: boolean; error?: string; diagnostics?: any; authGateState?: AuthGateState }> {
  const { env, missingInputBehavior = "fail", loginMode } = options;

  if (loginMode === "no_login") {
    console.log(`[auth-gate] Skipped because APP_LOGIN_MODE=no_login`);
    return { recovered: false };
  }

  if (!env) {
    return { recovered: false, error: "No env data provided for auth resolution" };
  }

  const detection = detectAuthGate(snapshot);

  if (!detection.detected) {
    return { recovered: false };
  }

  console.log(`[auth-gate] Detected auth gate: ${detection.gateType} at stage: ${detection.stage} (confidence: ${detection.confidence})`);
  console.log(`[auth-gate] Evidence: ${detection.evidence.join(", ")}`);
  console.log(`[auth-gate] Required inputs: ${detection.requiredInputs.join(", ")}`);
  console.log(`[auth-gate] Virtual keyboard: ${detection.hasVirtualKeyboard}, Native input: ${detection.hasNativeInput}`);

  // Classic username/password screens are executable scenario actions. Do
  // not route them through the customer identification/OTP AuthFlow, which
  // would duplicate the declared login steps and can misclassify the page.
  // AuthFlow remains responsible for non-classic gates.
  if (detection.gateType === "classic_login") {
    console.log(`[auth-gate] classic_login delegated=true owner=scenario_actions`);
    return {
      recovered: false,
      diagnostics: {
        detected: true,
        gateType: detection.gateType,
        stage: detection.stage,
        confidence: detection.confidence,
        requiredInputs: detection.requiredInputs,
        delegated: true,
      },
    };
  }

  if (options.scenario.authIntent === "gate_observation") {
    console.log(`[auth-gate-observation] detected=true action=stop_before_auth`);
    return {
      recovered: true,
      diagnostics: {
        detected: true,
        gateType: detection.gateType,
        stage: detection.stage,
        confidence: detection.confidence,
        requiredInputs: detection.requiredInputs
      }
    };
  }

  const resolverConfig: AuthInputResolverConfig = {
    env,
    missingInputBehavior,
    alias: "defaultClient",
    runtimeEntries: options.runtimeEntries,
  };

  const resolution = resolveAuthInputs(resolverConfig);
  logAuthResolution(resolution);

  const validation = validateRequiredInputs(resolution, detection.requiredInputs, missingInputBehavior);

  if (!validation.valid) {
    console.log(`[auth-gate] Auth input resolution failed: ${validation.errors.join("; ")}`);
    return { recovered: false, error: validation.errors.join("; ") };
  }

  const inputMethod = detection.hasVirtualKeyboard ? "virtual_keyboard" : "native_input";
  const maskedInputs: Record<string, string> = {};
  if (resolution.data.identificationNumber) {
    maskedInputs.identificationNumber = maskValue(resolution.data.identificationNumber);
  }
  if (resolution.data.otp) {
    maskedInputs.otp = "******";
  }

  const inputSource = resolution.sources.identificationNumber || resolution.sources.otp || "unknown";

  console.log(`[auth-gate] Attempting to resolve auth flow...`);

  try {
    const discoveryAppSlug = resolveCaseDiscoveryAppSlug(options);
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const appConfigPath = path.join(process.cwd(), "automations", "apps", discoveryAppSlug, "app.config.json");
    let appConfig: any = null;
    try {
      appConfig = JSON.parse(await fs.readFile(appConfigPath, "utf-8"));
    } catch {}

    const authProfiles = appConfig?.authProfiles ?? {};
    const authProfileRef = appConfig?.authProfile ?? appConfig?.routeProfiles?.private_operations?.authProfile;
    const authProfileName = typeof authProfileRef === "string" ? authProfileRef : "inline";
    const authProfile = typeof authProfileRef === "string" ? authProfiles?.[authProfileRef] : authProfileRef;
    const successSignals: string[] = Array.isArray(authProfile?.successSignals) ? authProfile.successSignals : [];
    const postAuthContinueSteps: Array<{ action?: string; target?: string; timeoutMs?: number }> =
      Array.isArray(authProfile?.postAuthContinueSteps) ? authProfile.postAuthContinueSteps : [];
    const privateLandingSignals: string[] = [
      ...(typeof authProfile?.privateLanding === "string" ? [authProfile.privateLanding] : []),
      ...(Array.isArray(authProfile?.privateLanding) ? authProfile.privateLanding : [])
    ];
    const transientSignals: string[] = Array.isArray(authProfile?.transientLoadingSignals)
      ? authProfile.transientLoadingSignals
      : (Array.isArray(authProfile?.postAuthTransientSignals) ? authProfile.postAuthTransientSignals : []);

    let AuthFlow: any;
    let AUTH_FLOW_IMPLEMENTATION_ID: string | undefined;
    const requestedSpecifier = `../../automations/apps/${discoveryAppSlug}/flows/auth.flow`;
    let selectedSource: "primary" | "none" = "none";

    console.log(`[auth-loader] appSlug=${discoveryAppSlug} requestedSpecifier=${requestedSpecifier} cwd=${process.cwd()}`);
    try {
      const mod = await import(requestedSpecifier);
      // Handle both ESM named exports and CJS default wrapper (tsx interop)
      AuthFlow = mod.AuthFlow || mod.default?.AuthFlow || mod.default;
      AUTH_FLOW_IMPLEMENTATION_ID = mod.AUTH_FLOW_IMPLEMENTATION_ID || mod.default?.AUTH_FLOW_IMPLEMENTATION_ID;
      selectedSource = "primary";
    } catch (loaderErr: any) {
      console.log(`[auth-loader] primaryImportFailed appSlug=${discoveryAppSlug} error=${loaderErr.message}`);
    }

    // Validate implementation
    const verified = Boolean(AuthFlow && AUTH_FLOW_IMPLEMENTATION_ID);
    console.log(`[auth-loader] appSlug=${discoveryAppSlug} selected=${selectedSource} requestedSpecifier=${requestedSpecifier} implementationId=${AUTH_FLOW_IMPLEMENTATION_ID || 'missing'} verified=${verified}`);

    if (!verified) {
      throw new Error(`auth_flow_implementation_unverified: Could not load verified AuthFlow for appSlug=${discoveryAppSlug}. ` +
        `Primary import: ${selectedSource === 'primary' ? 'resolved without implementationId' : 'failed'}. ` +
        `No project-specific auth flow is configured.`);
    }

    const globalThisWithTestData = globalThis as typeof globalThis & {
      __authFlowTestData?: Record<string, unknown>;
    };

    const testDataJson = env.APP_TEST_DATA_JSON;
    const hasTestDataClients = testDataJson && typeof testDataJson === "object" && (testDataJson as any).clients && Object.keys((testDataJson as any).clients).length > 0;

    if (hasTestDataClients) {
      const configuredData = testDataJson as Record<string, unknown>;
      const configuredClients = configuredData.clients as Record<string, Record<string, unknown>>;
      const configuredClient = { ...(configuredClients.defaultClient ?? {}) };
      if (resolution.data.identificationNumber) configuredClient.identificationNumber = resolution.data.identificationNumber;
      if (resolution.data.identificationType) configuredClient.identificationType = resolution.data.identificationType;
      if (resolution.data.otp) configuredClient.otp = resolution.data.otp;
      if (resolution.data.username) configuredClient.username = resolution.data.username;
      if (resolution.data.password) configuredClient.password = resolution.data.password;
      globalThisWithTestData.__authFlowTestData = {
        ...configuredData,
        clients: { ...configuredClients, defaultClient: configuredClient },
      };
    } else {
      globalThisWithTestData.__authFlowTestData = {
        clients: {
          defaultClient: {
            identificationType: resolution.data.identificationType || "cedula",
            identificationNumber: resolution.data.identificationNumber || "",
            otp: resolution.data.otp || "",
            username: resolution.data.username,
            password: resolution.data.password,
            expectedPhoneLast4: resolution.data.expectedPhoneLast4
          }
        },
        defaults: { client: "defaultClient" }
      };
    }

    const authFlow = new AuthFlow(page);
    const landingTarget = typeof authProfile?.privateLanding === "string" ? authProfile.privateLanding : undefined;

    // Capture session BEFORE OTP
    const contextIdStart = String(page.context()).substring(0, 16);
    const beforeOtpResult = await captureSessionCheckpoint(page, "before_otp", page.url(), contextIdStart);

    let result = await authFlow.ensureAuthenticated({
      alias: "defaultClient",
      landing: landingTarget
    });

    // Capture session AFTER OTP click
    const afterOtpResult = await captureSessionCheckpoint(page, "after_otp_click", page.url(), contextIdStart);

    // Capture session at authentication_success or current stage
    await captureSessionDiagnostics(page, "post_otp");
    const authSuccessResult = await captureSessionCheckpoint(page, "authentication_success", page.url(), contextIdStart);
    const hasSignal = (scan: PageSnapshot, values: string[]) => values.some((value) => {
        const normalizedValue = String(value).toLowerCase();
        return scan.elements.some((el: any) => String(el.text || el.label || "").toLowerCase().includes(normalizedValue));
      });
    const detectTransientLoading = (scan: PageSnapshot, url: string) => {
        const configured = transientSignals.length > 0 && hasSignal(scan, transientSignals);
        return { detected: configured, reason: configured ? "configured" : "none" };
      };
    const evaluateLanding = (scan: PageSnapshot, url: string) => {
        const targetVisible = nextPendingTarget
          ? scan.elements.some((el: any) => String(el.text || el.label || "").toLowerCase().includes(String(nextPendingTarget).toLowerCase()))
          : false;
        const privateSignalVisible = successSignals.length > 0 && hasSignal(scan, successSignals);
        const privateLandingVisible = privateLandingSignals.length > 0 &&
          (privateLandingSignals.some((signal) => {
            try {
              const configured = new URL(String(signal), url);
              const current = new URL(url);
              return configured.origin === current.origin && configured.pathname === current.pathname;
            } catch {
              return false;
            }
          }) || hasSignal(scan, privateLandingSignals));
        const structuralPrivateMenu = new URL(url).pathname !== "/" &&
          (scan.elements.filter((el: any) => /button|link/i.test(String(el.role || ""))).length >= 3);
        if (targetVisible) return { valid: true, reason: "target_visible" };
        if (privateSignalVisible) return { valid: true, reason: "private_signal" };
        if (privateLandingVisible) return { valid: true, reason: "private_landing" };
        if (structuralPrivateMenu) return { valid: true, reason: "private_signal" };
        return { valid: false, reason: "unresolved" };
      };
    const buildTransientSnapshot = (scan: PageSnapshot) => {
      const compactTexts = Array.from(new Set(
        scan.elements
          .map((el: any) => String(el.text || el.label || "").trim())
          .filter((value: string) => value.length >= 3)
      )).slice(0, 6);
      const compactControls = Array.from(new Set(
        scan.elements
          .filter((el: any) => /button|link/i.test(String(el.role || "")) || el.testId || el.ariaLabel)
          .map((el: any) => String(el.text || el.label || el.ariaLabel || el.testId || "").trim())
          .filter((value: string) => value.length >= 2)
      )).slice(0, 6);
      const compactLoaders = Array.from(new Set(
        scan.elements
          .filter((el: any) => /progressbar|status|alert/i.test(String(el.role || "")) || /cargando|loading|procesando|espere|success|authenticated/i.test(String(el.text || el.label || "")))
          .map((el: any) => String(el.text || el.label || el.ariaLabel || el.testId || "").trim())
          .filter((value: string) => value.length >= 2)
      )).slice(0, 6);
      return {
        url: scan.url,
        title: scan.title,
        texts: compactTexts,
        controls: compactControls,
        loaders: compactLoaders
      };
    };
    const logConfigSuggestion = (snapshot: ReturnType<typeof buildTransientSnapshot>) => {
      const suggested = {
        transientLoadingSignals: snapshot.loaders.length > 0 ? snapshot.loaders : snapshot.texts.slice(0, 3),
        postAuthContinueSteps: snapshot.controls.length === 1
          ? [{ action: "click", target: snapshot.controls[0] }]
          : [],
        successSignals: [],
        privateLanding: [],
        observedControls: snapshot.controls
      };
      console.log(
        `[auth-resume] configSuggestion kind="postAuthContinue" ` +
        `appSlug="${discoveryAppSlug}" authProfile="${authProfileName}" suggested=${JSON.stringify(suggested)}`
      );
    };
    const executePostAuthContinueSteps = async () => {
        if (postAuthContinueSteps.length === 0) return;
        console.log(`[auth-flow] postAuthContinue started source="authProfile"`);
        for (let idx = 0; idx < postAuthContinueSteps.length; idx++) {
          const step = postAuthContinueSteps[idx];
          let resultLabel = "failed";
          try {
            if (step.action === "click" && step.target) {
              await page.getByText(step.target, { exact: true }).click({ timeout: step.timeoutMs ?? 3000 });
              resultLabel = "passed";
            } else if (step.action === "wait") {
              await page.waitForTimeout(step.timeoutMs ?? 1000);
              resultLabel = "passed";
            }
          } catch {}
          console.log(`[auth-flow] postAuthContinue step=${idx + 1} action="${step.action ?? "unknown"}" result="${resultLabel}"`);
          const continueSnapshot = await scanCurrentPage(page);
          const landingCheck = evaluateLanding(continueSnapshot, page.url());
          console.log(`[auth-resume] landingCheck valid=${landingCheck.valid} reason="${landingCheck.reason}" ${safeUrlForLog(page.url())}`);
          if (landingCheck.valid) {
            return;
          }
        }
      };
    if (!result.success && result.diagnostics?.finalStage === "otp" && resolution.data.otp) {
      console.log(`[auth-gate] continuingAuthFlow stage="otp"`);
      console.log(`[auth-flow] continuing stage=otp reason=auth_gate_still_active`);
      console.log(`[auth-flow] skipFinalize reason=otp_stage_pending`);
      result = await authFlow.ensureAuthenticated({
        alias: "defaultClient",
        landing: landingTarget
      });
    }

    if (result.success) {
      console.log(`[auth-gate] Auth flow completed successfully. Stages: ${result.stagesCompleted.join(", ")}`);
      if (nextPendingTarget) {
        console.log(`[auth-resume] nextPendingTarget="${nextPendingTarget}"`);
      }

      // Check if we're in a transient success page without private landing signals
      const currentUrl = page.url();
      const currentSnapshot = await scanCurrentPage(page);
      const transientState = detectTransientLoading(currentSnapshot, currentUrl);
      const initialLandingCheck = evaluateLanding(currentSnapshot, currentUrl);
      const isTransientSuccessPage = transientState.detected;
      console.log(`[auth-resume] transientLoading detected=${transientState.detected} reason="${transientState.reason}"`);
      console.log(`[auth-resume] landingCheck valid=${initialLandingCheck.valid} reason="${initialLandingCheck.reason}" ${safeUrlForLog(currentUrl)}`);

      if (isTransientSuccessPage && !initialLandingCheck.valid) {
        const transientSnapshot = buildTransientSnapshot(currentSnapshot);
        const redirectingHint = transientSnapshot.texts.some((text) => /redirigiendo|redirecting|menú de operaciones|menu de operaciones/i.test(text));
        const transientRetryAttempts = redirectingHint ? 8 : 3;
        const transientRetryDelayMs = redirectingHint ? 1500 : 800;
        console.log(
          `[auth-resume] transientSnapshot ${safeUrlForLog(transientSnapshot.url)} ` +
          `texts=${JSON.stringify(transientSnapshot.texts)} controls=${JSON.stringify(transientSnapshot.controls)} ` +
          `loaders=${JSON.stringify(transientSnapshot.loaders)}`
        );
        console.log(
          `[auth-flow] postAuthTransient detected=true reason=success_page_without_private_signals ` +
          `${safeUrlForLog(currentUrl)}`
        );

        await executePostAuthContinueSteps();

        let postAuthSnapshot = await scanCurrentPage(page);
        let postAuthUrl = page.url();

        console.log(
          `[auth-flow] postAuthContinue completed ${safeUrlForLog(postAuthUrl)} ` +
          `urlChanged=${postAuthUrl !== currentUrl}`
        );

        let landingCheckAfter = evaluateLanding(postAuthSnapshot, postAuthUrl);
        const authResumeStart = Date.now();
        for (let attempt = 1; attempt <= transientRetryAttempts && !landingCheckAfter.valid; attempt++) {
          await page.waitForTimeout(transientRetryDelayMs).catch(() => {});
          postAuthSnapshot = await scanCurrentPage(page);
          postAuthUrl = page.url();
          landingCheckAfter = evaluateLanding(postAuthSnapshot, postAuthUrl);
          console.log(`[auth-resume] retry attempt=${attempt} ready=${landingCheckAfter.valid} reason="${landingCheckAfter.reason}" ${safeUrlForLog(postAuthUrl)}`);
          console.log(`[auth-resume] landingCheck valid=${landingCheckAfter.valid} reason="${landingCheckAfter.reason}" ${safeUrlForLog(postAuthUrl)}`);
        }
        const authResumeMs = Date.now() - authResumeStart;
        if (landingCheckAfter.valid) {
          console.log(`[auth-resume] fastReady reason="${landingCheckAfter.reason}" durationMs=${authResumeMs}`);
        }

        // If still no private signals after wait, this is unresolved and must be blocked
        if (!landingCheckAfter.valid) {
          const unresolvedSnapshot = buildTransientSnapshot(postAuthSnapshot);
          console.log(
            `[auth-resume] transientSnapshot ${safeUrlForLog(unresolvedSnapshot.url)} ` +
            `texts=${JSON.stringify(unresolvedSnapshot.texts)} controls=${JSON.stringify(unresolvedSnapshot.controls)} ` +
            `loaders=${JSON.stringify(unresolvedSnapshot.loaders)}`
          );
          logConfigSuggestion(unresolvedSnapshot);
          console.log(
            `[auth-resume] blocked reason=post_auth_transient_landing_unresolved ` +
            `target="${nextPendingTarget ?? "unknown"}" ${safeUrlForLog(postAuthUrl)}`
          );
          // Return failure explicitly - DO NOT proceed to normal auth completion
          return {
            recovered: false,
            error: "Post-auth transient page: no landing signals after redirect wait",
            diagnostics: {
              postAuthTransient: true,
              unresolved: true,
              reason: "post_auth_transient_landing_unresolved",
              urlChanged: postAuthUrl !== currentUrl,
              url: postAuthUrl,
              stage: "authenticated_transient_unresolved",
              nextPendingTarget
            }
          };
        }

        // If we got here, post-auth transient WAS resolved (has private signals)
        // Return success with diagnostic flag so caller knows it was transient
        const authGateState = createAuthGateState(
          "authenticated_transient",
          0,
          result.stagesCompleted
        );
        return {
          recovered: true,
          diagnostics: {
            detected: true,
            stage: "authenticated_transient_resolved",
            postAuthTransient: true,
            resolved: true,
            landingReason: landingCheckAfter.reason,
            urlChanged: postAuthUrl !== currentUrl,
            url: postAuthUrl,
            nextPendingTarget,
            requiredInputs: detection.requiredInputs,
            inputSource,
            completedBy: "AuthFlowRunner",
            inputMethod,
            maskedInputs
          },
          authGateState
        };
      }

      if (initialLandingCheck.valid && nextPendingTarget) {
        console.log(`[auth-resume] resumed=true target="${nextPendingTarget}" reason="${initialLandingCheck.reason}"`);
      }

      const authGateState = createAuthGateState(
        "transacciones y servicio",
        0,
        result.stagesCompleted
      );
      return {
        recovered: true,
        diagnostics: {
          detected: true,
          stage: detection.stage,
          requiredInputs: detection.requiredInputs,
          inputSource,
          completedBy: "AuthFlowRunner",
          inputMethod,
          maskedInputs
        },
        authGateState
      };
    } else {
      const finalStage = result.diagnostics?.finalStage;
      const stuckReason = result.diagnostics?.stuckReason;
      const currentUrl = result.diagnostics?.currentUrl;

      // Determine if this is a blocking failure (stuck in auth, not just transient)
      const isBlockingFailure = finalStage &&
        ["identification_input", "phone_confirmation", "otp"].includes(finalStage);

      if (isBlockingFailure) {
        console.log(`[auth-gate] Blocking scenario: auth not completed. finalStage=${finalStage} reason=${stuckReason} ${safeUrlForLog(currentUrl)}`);
        return {
          recovered: false,
          error: `auth_not_completed stage=${finalStage}`,
          diagnostics: {
            detected: true,
            stage: finalStage,
            stuckReason,
            currentUrl,
            isBlockingFailure: true
          }
        };
      }

      console.log(`[auth-gate] Auth flow failed: ${result.error}`);
      return {
        recovered: false,
        error: result.error,
        diagnostics: {
          detected: true,
          gateType: detection.gateType,
          stage: detection.stage,
          confidence: detection.confidence,
          requiredInputs: detection.requiredInputs
        }
      };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(`[auth-gate] Auth flow failed: ${errorMsg}`);
    return {
      recovered: false,
      error: errorMsg,
      diagnostics: {
        detected: true,
        gateType: detection.gateType,
        stage: detection.stage,
        confidence: detection.confidence,
        requiredInputs: detection.requiredInputs
      }
    };
  }
}

function maskValue(value: string | undefined, visibleChars = 4): string {
  if (!value) return "";
  if (value.length <= visibleChars) return "****";
  return "*".repeat(value.length - visibleChars) + value.slice(-visibleChars);
}

/**
 * Whether the scenario text itself explicitly requires an executable login action.
 * This is the ONLY condition under which a plan login step may be emitted.
 * Inference from section privacy, login mode, app profile, or configured
 * credentials is forbidden: auth requirements must be traceable to the scenario.
 */
export function scenarioExplicitlyRequiresAuth(scenario: TestScenario): boolean {
  const steps = scenario.steps ?? [];
  for (const step of steps) {
    const intents = parseStepIntent(step.action);
    if (intents.some((intent) => intent.type === "setup_authentication")) {
      return true;
    }
  }
  return scenario.authIntent === "full_authentication";
}

export function getAuthoritativeSubjectSignals(scenario: TestScenario): string[] {
  const s: any = scenario;
  const candidates: string[] = [];
  const push = (v: any) => { if (typeof v === "string" && v.trim()) candidates.push(v.trim().toLowerCase()); };
  push(s.type); push(s.automationType); push(s.setupStrategy); push(s.database);
  push(s.functionalBranch?.actionIntent); push(s.functionalBranch?.branchId); push(s.functionalBranch?.accessIntent);
  push(s.functionalBranch?.evidenceSource); push(s.branchAssociation?.expectedActionIdentity); push(s.branchAssociation?.actualActionIdentity);
  push(s.scenarioMode); push(s.routeProfile); push((s.raw as any)?.custom_expected); push((s.raw as any)?.custom_preconds);
  // generic scan for subject/intent/requirement fields if present
  push((s as any).subject); push((s as any).intent); push((s as any).subIntent); push((s as any).requirement); push((s as any).requirementId);
  // also include stringified functionalBranch for auth test detection without hardcoding titles
  return candidates.filter(Boolean);
}

export function isAuthenticationTestScenario(scenario: TestScenario, _parsed?: { actionTargets: ActionTargetItem[]; assertionTargets: any[] }): boolean {
  if (scenario.authIntent !== "full_authentication") return false;
  const s: any = scenario;
  const fields = [s.type, s.automationType, s.subject, s.intent, s.subIntent,
    s.requirement?.category, s.requirement?.scope, s.functionalBranch?.category,
    s.functionalBranch?.scope, s.functionalBranch?.actionIntent];
  return fields.some(v => typeof v === "string" && ["authentication_test", "auth_test", "authentication-test"].includes(v.trim().toLowerCase()));
}

export function shouldPerformBusinessFlowAuthSetup(scenario: TestScenario, parsed?: { actionTargets: ActionTargetItem[]; assertionTargets: any[] }): boolean {
  if (scenario.authIntent === "gate_observation") return false;
  if (scenario.authIntent !== "full_authentication") return false;
  if (isAuthenticationTestScenario(scenario, parsed)) return false;
  return true;
}

export function shouldInvokeAuthGateRecovery(authenticationTestDetection: boolean): boolean {
  return authenticationTestDetection !== true;
}

export function getLoginStepsToConsume(parsed: { actionTargets: ActionTargetItem[] }): Set<number> {
  const s = new Set<number>();
  for (const at of parsed.actionTargets) {
    const metadata: any = (at as any).metadata ?? at;
    const intent = String(metadata.actionIntent ?? "").toLowerCase();
    const role = String(metadata.targetRole ?? metadata.routeRole ?? "").toLowerCase();
    if (intent === "authentication" || intent === "authenticate" || role === "authentication") s.add(at.index);
  }
  return s;
}

export function loadProjectAuthProfile(appSlug: string): { profile: any | null; source: string; variantSupport: boolean } {
  try {
    const fsSync = require("node:fs");
    const path = require("node:path");
    const cfgPath = path.join(process.cwd(), "automations", "apps", appSlug, "app.config.json");
    const raw = fsSync.readFileSync(cfgPath, "utf-8");
    const cfg = JSON.parse(raw);
    const authProfiles = cfg?.authProfiles ?? {};
    const authProfileRef = cfg?.authProfile ?? cfg?.routeProfiles?.private_operations?.authProfile;
    const profile = typeof authProfileRef === "string" ? authProfiles?.[authProfileRef] : authProfileRef;
    if (profile) {
      const hasVariant = Boolean(profile.variant || profile.accountType || profile.loginVariant || profile.loginMode);
      return { profile, source: "app_config", variantSupport: hasVariant || true };
    }
    return { profile: null, source: "app_config", variantSupport: false };
  } catch {
    return { profile: null, source: "none", variantSupport: false };
  }
}

export async function runCaseDiscovery(options: CaseDiscoveryOptions): Promise<CaseDiscoveryResult> {
  const { page, scenario, evidenceDir, pendingObjectsPath, pendingPlansPath, appBaseUrl, testData, loginAction } = options;
  const aiConfig: AiAssistedDiscoveryConfig = {
    ...DEFAULT_AI_ASSISTED_DISCOVERY_CONFIG,
    ...options.aiAssistedDiscovery?.config
  };
  const aiExplorer = options.aiAssistedDiscovery?.explorer ?? createAIExplorer();
  
  // Load route profile for ordinal selection and route completion
  const discoveryAppSlug = resolveCaseDiscoveryAppSlug(options);
  const explicitRouteProfile = (options.scenario as any)?.routeProfile;
  const routeProfile = options.aiAssistedDiscovery?.config?.routeCompletion?.useAppProfile !== false ? loadRouteProfile(discoveryAppSlug, explicitRouteProfile) : undefined;
  if (routeProfile) {
    console.log(`[discovery:case] routeProfile loaded appSlug=${discoveryAppSlug} domainTerms=${routeProfile.domainTerms?.length ?? 0} routes=${routeProfile.routes?.length ?? 0}`);
  }

  const steps: DiscoveryStepResult[] = [];
  const allDiscoveredObjects: DiscoveredObject[] = [];
  let activePlanInputMetadata: Pick<ExecutionPlanStep, "inputIntent" | "requirementRefs" | "controlIdentity"> = {};
  const planSteps: ExecutionPlanStep[] = new Proxy([] as ExecutionPlanStep[], {
    get(target, property, receiver) {
      if (property === "push") {
        return (...items: ExecutionPlanStep[]) => target.push(...items.map((item) => ({ ...item, ...activePlanInputMetadata })));
      }
      return Reflect.get(target, property, receiver);
    }
  });
  const executedStepIndices = new Set<number>();
  const executedActionOrders = new Set<number>();
  const skippedActionOrders = new Set<number>();
  const routeProfileSuggestions: RouteProfileSuggestion[] = [];
  const assertionObservations: AssertionObservationArtifact[] = [];
  const routeProfileLearningConfig: RouteProfileLearningConfig = (options as any)?.aiAssistedDiscovery?.config?.routeProfileLearning ?? {
    enabled: false,
    autoApproveThreshold: 0.90,
    autoApply: false,
    minOccurrences: 1,
    blockSensitive: true
  };

  // Evidence capture helper
  const evidenceRec = options.evidenceRecorder;
  let evidenceStepIndex = 0;
  const captureEvStep = async (text: string, status: "passed" | "failed" | "skipped", error?: string, indexOverride?: number): Promise<void> => {
    if (!evidenceRec) return;

    // Exclude validation steps from evidence capture
    if (/^\s*validar\b/i.test(text)) {
      console.log(`[evidence] skipping validation step: "${text}"`);
      return;
    }

    if (indexOverride !== undefined) {
      evidenceStepIndex = indexOverride;
    } else {
      evidenceStepIndex++;
    }
    try {
      const target = text.match(/"([^"]+)"/)?.[1];
      await evidenceRec.captureStep(page, evidenceStepIndex, text, { target, status, errorMessage: error });
      console.log(`[evidence] step ${evidenceStepIndex}: "${text.substring(0, 60)}" status=${status}`);
    } catch {
      // evidence errors are non-fatal
    }
  };

  console.log(`[route-learning] config enabled=${routeProfileLearningConfig.enabled} autoApply=${routeProfileLearningConfig.autoApply} threshold=${routeProfileLearningConfig.autoApproveThreshold}`);
  
  let failedAtStep: number | undefined;
  let failedTarget: string | undefined;
  let failedReason: string | undefined;
  let earlyCompletionSatisfied = false;
  let authGateState: AuthGateState | undefined;
  let authGateCompletedAfterStepIndex: number | undefined; // Track step index after which AuthFlow completed
  let authGateDetectedDuringDiscovery = false; // Track gate detection regardless of completion
  let authGateDetectedAtStepIndex: number | undefined;
  let authGateDetectedStage: string | undefined; // Stage at which the auth gate was detected
  let activeContainer: ActiveContainerContext | undefined;
  const resolvedDataKeys = new Set<string>();
  const runtimeAuthFieldValues = new Map<string, { target: string; value: string }>();
  const runtimeFieldIdentities = new Map<string, string>();
  const runtimeFieldControlIdentities = new Map<string, ControlIdentity>();
  const runtimeFieldLabels = new Map<string, string>();
  let postResumeTargetContext:
    | {
        target: string;
        url: string;
        snapshot: PageSnapshot;
      }
    | undefined;

  const normalizeText = (value: string | undefined): string =>
    String(value ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const resolveRuntimeSubjectIdentity = (assertion: AssertionTargetInput): string | undefined => {
    const subject = normalizeText(assertion.canonicalAssertion?.subject);
    if (!subject) return undefined;
    for (const [key, label] of runtimeFieldLabels.entries()) {
      const labelText = normalizeText(label);
      if (!labelText || !(labelText === subject || labelText.includes(subject) || subject.includes(labelText))) continue;
      const identity = runtimeFieldIdentities.get(key);
      if (identity) return identity;
    }
    return undefined;
  };

  const summarizeSnapshot = (snapshot: PageSnapshot) => {
    const texts = Array.from(new Set(
      snapshot.elements
        .map((el: any) => String(el.text || el.label || el.name || "").trim())
        .filter((value: string) => value.length >= 3)
    )).slice(0, 6);
    const controls = Array.from(new Set(
      snapshot.elements
        .filter((el: any) => /button|link|menuitem|tab|option/i.test(String(el.role || "")) || el.ariaLabel || el.title || el.testId)
        .map((el: any) => String(el.text || el.label || el.name || el.ariaLabel || el.title || el.testId || "").trim())
        .filter((value: string) => value.length >= 2)
    )).slice(0, 8);
    return { texts, controls };
  };

  const isPrivateLandingPath = (_url: string): boolean => false;
  const isPublicOrAuthPath = (_url: string): boolean => false;

  if (evidenceDir && evidenceDir.trim()) {
    await mkdir(evidenceDir, { recursive: true });
  }

  planSteps.push({
    index: planSteps.length + 1,
    action: "navigate",
    description: `Navigate to ${appBaseUrl}`,
    target: "APP_BASE_URL"
  });

  // Audit current contract before gated decision
  const initialRequiresExplicitAuth = scenarioExplicitlyRequiresAuth(scenario);
  const initialAuthProfileInfo = loadProjectAuthProfile(discoveryAppSlug);
  console.log(`[discovery:case] login-step-gate scenario="${scenario.title?.slice(0, 60)}" loginActionProvided=${Boolean(loginAction)} requiresExplicitAuth=${initialRequiresExplicitAuth} authIntent=${scenario.authIntent ?? "undefined"}`);
  console.log(`[auth-contract-audit] authIntent=${scenario.authIntent ?? "undefined"} loginGate=${initialRequiresExplicitAuth} credentialSource=${options.env ? "env/test_data" : "none"} variantSupport=${initialAuthProfileInfo.variantSupport} profileSource=${initialAuthProfileInfo.source}`);
  // Defer actual login plan step until after parsing to handle full_authentication business vs auth-test distinction; no push here yet

  const navigationStartedAt = Date.now();
  console.log(`[initial-navigation] phase=goto_start url=${safePathname(appBaseUrl)}`);
  try {
    await page.goto(appBaseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (error) {
    const details = describeInitialNavigationError(error);
    console.log(`[initial-navigation] phase=goto_error errorType=${details.errorType} errorCode=${details.errorCode ?? "not_observable"} errorMessageSafe=${JSON.stringify(details.errorMessageSafe)}`);
    if (evidenceRec && !(await evidenceRec.captureInitialScreen(page, "full_discovery"))) {
      return {
        version: "1.0",
        caseId: Number(scenario.caseId ?? 0),
        caseTitle: scenario.title,
        discoveredAt: new Date().toISOString(),
        status: "exploration_failed",
        steps: [],
        discoveredObjects: [],
        evidenceDir,
        failedReason: "navigation_failed",
      };
    }
    throw error;
  }
  console.log(`[initial-navigation] phase=goto_complete durationMs=${Date.now() - navigationStartedAt} finalPath=${safePathname(page.url(), appBaseUrl)}`);

  const readinessStartedAt = Date.now();
  console.log(`[initial-readiness] phase=start timeoutMs=5000`);
  try {
    await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
  } catch (error) {
    const details = describeInitialNavigationError(error);
    console.log(`[initial-readiness] phase=complete ready=false durationMs=${Date.now() - readinessStartedAt} reason=readiness_error errorType=${details.errorType} errorCode=${details.errorCode ?? "not_observable"}`);
    throw error;
  }
  console.log(`[initial-readiness] phase=complete ready=true durationMs=${Date.now() - readinessStartedAt} reason=none`);

  if (evidenceRec && !(await evidenceRec.captureInitialScreen(page, "full_discovery"))) {
    return {
      version: "1.0",
      caseId: Number(scenario.caseId ?? 0),
      caseTitle: scenario.title,
      discoveredAt: new Date().toISOString(),
      status: "exploration_failed",
      steps: [],
      discoveredObjects: [],
      evidenceDir,
      failedReason: "initial_readiness_failure",
    };
  }

  const initialScan = await scanAndCollectObjects(page, 0, evidenceDir);
  allDiscoveredObjects.push(...initialScan.objects);

  const parsed = parseScenarioStepsForDiscovery(scenario);
  const actionOrderIndexByTarget = new WeakMap<ActionTargetItem, number>();

  const canonicalAssertionAfterAction = (actionIndex: number): AssertionTargetInput | undefined =>
    parsed.assertionTargets
      .filter((candidate) => candidate.index > actionIndex && candidate.canonicalAssertion)
      .sort((a, b) => a.index - b.index)[0];

  const captureCanonicalFillObservation = async (input: {
    actionTarget: ActionTargetItem;
    before?: AssertionObservationSnapshot;
    fieldIdentity?: string;
    controlIdentity?: ControlIdentity;
    networkEvents?: SafeNetworkEvent[];
  }): Promise<void> => {
    const pending = canonicalAssertionAfterAction(input.actionTarget.index);
    const observationEligible = pending?.canonicalAssertion
      && (pending.canonicalAssertion.trigger === "leave_field" || pending.canonicalAssertion.oracleType === "row_scoped_value");
    if (!observationEligible || !input.before) return;
    const subjectIdentity = resolveRuntimeSubjectIdentity(pending);
    const currentIdentity = input.fieldIdentity
      ?? (input.actionTarget.valueKey ? runtimeFieldIdentities.get(input.actionTarget.valueKey) : undefined);
    const currentControlIdentity = input.controlIdentity
      ?? (input.actionTarget.valueKey ? runtimeFieldControlIdentities.get(input.actionTarget.valueKey) : undefined);
    const subjectControlIdentity = subjectIdentity
      ? [...runtimeFieldControlIdentities.entries()].find(([key]) => runtimeFieldIdentities.get(key) === subjectIdentity)?.[1]
      : undefined;
    const sameExecutedSubject = Boolean(
      (currentIdentity && subjectIdentity && currentIdentity === subjectIdentity)
      || (currentControlIdentity && subjectControlIdentity && currentControlIdentity.fingerprint === subjectControlIdentity.fingerprint),
    );
    if (!sameExecutedSubject) return;
    const after = await captureAssertionObservationSnapshot(page).catch(() => undefined);
    if (!after) return;
    const mutation = diffAssertionObservation(input.before, after, false);
    const refs = pending.requirementRefs ?? [];
    const artifact: AssertionObservationArtifact = {
      version: "1.0",
      caseId: scenario.caseId,
      ...(scenario.canonicalScenarioId ? { scenarioId: scenario.canonicalScenarioId } : {}),
      ...(refs[0] ? { requirementId: refs[0], requirementRefs: [...refs] } : {}),
      triggerActionIdentity: { action: input.actionTarget.action, stepIndex: input.actionTarget.index, target: input.actionTarget.target },
      before: input.before,
      after,
      mutation,
      network: {
        eventCount: input.networkEvents?.length ?? 0,
        classification: classifyNetworkActivity(input.networkEvents ?? [], input.before.urlPath, after.urlPath),
      },
      ...(mutation.validationMutation
        ? { candidate: { oracleType: "runtime_state", targetIdentity: subjectIdentity ?? refs[0], confidence: 0.9, source: "runtime_observation" } }
        : {}),
      createdAt: new Date().toISOString(),
    };
    assertionObservations.push(artifact);
    try {
      await writeAssertionObservationArtifact(evidenceDir, artifact);
    } catch {
      // Diagnostic observation must not change discovery status.
    }
    console.log(
      `[canonical-runtime-observation] scenarioStepIndex=${pending.index} requirementRefs=${refs.length} `
        + `intent=${pending.canonicalAssertion.intent} subjectLineage=${subjectIdentity ? "available" : "unavailable"} `
        + `validationMutation=${mutation.validationMutation} networkEvents=${input.networkEvents?.length ?? 0} associatedError=${after.validationNodes.length > 0}`,
    );
  };

  const recordRuntimeFillObservation = async (input: {
    actionTarget: ActionTargetItem;
    observation: RuntimeFillObservation;
  }): Promise<void> => {
    const { observation } = input;
    if (!observation.before || !observation.after || !observation.mutation) return;
    const artifact: AssertionObservationArtifact = {
      version: "1.0",
      caseId: scenario.caseId,
      triggerActionIdentity: {
        action: input.actionTarget.action,
        stepIndex: input.actionTarget.index,
        target: input.actionTarget.target,
      },
      before: observation.before,
      after: observation.after,
      mutation: observation.mutation,
      network: {
        eventCount: observation.networkEvents.length,
        classification: classifyNetworkActivity(
          observation.networkEvents,
          observation.before.urlPath,
          observation.after.urlPath,
        ),
      },
      ...(observation.mutation.changed
        ? { candidate: { oracleType: "runtime_state", confidence: 0.8, source: "runtime_observation" } }
        : {}),
      createdAt: new Date().toISOString(),
    };
    assertionObservations.push(artifact);
    try {
      await writeAssertionObservationArtifact(evidenceDir, artifact);
    } catch {
      // Diagnostic observation must not change discovery status.
    }
    console.log(
      `[runtime-fill-observation] stepIndex=${input.actionTarget.index} `
        + `mutation=${observation.mutation.changed} networkEvents=${observation.networkEvents.length} `
        + `candidate=${Boolean(artifact.candidate)}`,
    );
  };

  // ── Runtime sanitizer: remove action/assertion steps using fields from wrong target screens ──
  // Runs even on rerun artifacts — protects against cached scenarios with old field assignments.
  const SCREEN_INVALID_FIELDS = new Set(["email", "correo", "rnc", "recipient", "destinatario"]);
  const GENERIC_FIELD_STEPS = /^(completar|ingresar|llenar)\s+(los\s+campos\s+requeridos|datos\s+requeridos|campos\s+obligatorios)\.?$/i;
  const GENERIC_VALIDATION_STEPS = /^validar\s+que\s+se\s+(muestren|muestre)\s+(las\s+validaciones\s+de\s+campos\s+obligatorios|las?\s+validaci[oó]n\s+de\s+campos?)/i;
  const sanitizedActionTargets: ActionTargetItem[] = [];
  for (const at of parsed.actionTargets) {
    const fieldMatch = at.target?.match(/^(?:completar|ingresar|llenar)\s+(?:el\s+campo\s+)?(.+?)(?:\.?\s*$)/i);
    const field = fieldMatch?.[1]?.toLowerCase();
    if (field && SCREEN_INVALID_FIELDS.has(field)) {
      console.log(`[scenario-sanitizer] removedInvalidFieldStep scenario="${scenario.title?.slice(0,60)}" field="${field}" reason=field_not_allowed_for_target_screen`);
      continue;
    }
    // Remove generic "Completar los campos requeridos" — no locator exists for this
    if (GENERIC_FIELD_STEPS.test(at.target ?? "")) {
      console.log(`[scenario-sanitizer] removedGenericFieldAction scenario="${scenario.title?.slice(0,60)}" step="${at.target?.slice(0,60)}" reason=no_concrete_field_target`);
      continue;
    }
    // Remove generic "Validar que se muestren las validaciones..." — not observable
    if (GENERIC_VALIDATION_STEPS.test(at.target ?? "")) {
      console.log(`[scenario-sanitizer] removedGenericValidation step="${at.target?.slice(0,60)}" reason=not_observable`);
      continue;
    }
    sanitizedActionTargets.push(at);
  }
  if (sanitizedActionTargets.length < parsed.actionTargets.length) {
    console.log(`[scenario-sanitizer] sanitized scenario="${scenario.title?.slice(0,60)}" removed=${parsed.actionTargets.length - sanitizedActionTargets.length} actions=${parsed.actionTargets.length}→${sanitizedActionTargets.length}`);

  // Proactive adaptive mode: if executionMode is adaptive, start route discovery now
  const executionMode = (options as any)?.executionMode as string | undefined;
  if (executionMode === "adaptive") {
    console.log(`[adaptive-route] proactiveStart scenario="${scenario.title?.slice(0,60)}" executionMode=adaptive`);
    const targetScreen = (options as any)?.adaptiveContext?.targetScreen as string | undefined;
    const expectedSignals = (options as any)?.adaptiveContext?.expectedScreenSignals as string[] | undefined;
    console.log(`[adaptive-route] targetScreen=${targetScreen ?? "unknown"} expectedSignals=${expectedSignals?.join(",") ?? "none"}`);
  }

  // Visual signal verification helper (check after adaptive steps)
  function verifyTargetScreenSignals(snapshot: any, expectedSignals?: string[]): boolean {
    if (!expectedSignals || expectedSignals.length === 0) return true;
    const texts = (snapshot.elements ?? []).map((e: any) => (e.text || e.label || "").toLowerCase());
    const allText = texts.join(" ");
    return expectedSignals.every(s => allText.includes(s.toLowerCase()));
  }

  function detectProgress(prevSnapshot: any, currentSnapshot: any): boolean {
    if (!prevSnapshot || !currentSnapshot) return false;
    if (prevSnapshot.url !== currentSnapshot.url) return true;
    const prevCount = prevSnapshot.elements?.length ?? 0;
    const currCount = currentSnapshot.elements?.length ?? 0;
    return Math.abs(currCount - prevCount) > 5; // significant DOM change
  }
    parsed.actionTargets.length = 0;
    parsed.actionTargets.push(...sanitizedActionTargets);
  }

  // ── AUTH CONTRACT: business flow with full_authentication as SETUP (project-scoped, no hardcode) ──
  const isAuthTest = isAuthenticationTestScenario(scenario, parsed);
  const shouldSetup = shouldPerformBusinessFlowAuthSetup(scenario, parsed);
  const authProfileInfoForSetup = loadProjectAuthProfile(discoveryAppSlug);
  console.log(`[auth-contract] authIntent=${scenario.authIntent ?? "undefined"} isAuthTest=${isAuthTest} businessSetup=${shouldSetup} projectAuthSource=${authProfileInfoForSetup.source} variantSupport=${authProfileInfoForSetup.variantSupport}`);
  console.log(`[auth-decision] authenticationTestDetection=${isAuthTest} businessFlowAuthSetup=${shouldSetup} gateObservationPreserved=${scenario.authIntent === "gate_observation"}`);
  let businessSetupExecuted = false;
  let businessSetupSuccess = false;
  let loginStepsToConsume: Set<number> | null = null;
  if (shouldSetup) {
    console.log(`[project-auth] appSlug=${discoveryAppSlug} source=${authProfileInfoForSetup.source} variantSupport=${authProfileInfoForSetup.variantSupport} projectIsolationPreserved=true`);
    loginStepsToConsume = getLoginStepsToConsume(parsed);
    if (loginStepsToConsume.size > 0) {
      console.log(`[login-consumption] loginStepsConsumed=${[...loginStepsToConsume].join(",")} doubleLoginPrevented=true reason=business_flow_setup`);
    }
    const firstBusinessTarget = parsed.actionTargets.find((at: any) => {
      const metadata = at.metadata ?? at;
      const scope = String(metadata.scope ?? metadata.targetScope ?? "").toLowerCase();
      const role = String(metadata.targetRole ?? metadata.routeRole ?? metadata.destinationRole ?? "").toLowerCase();
      const intent = String(metadata.actionIntent ?? "").toLowerCase();
      return (scope === "business" || role === "business" || intent === "business") &&
        metadata.executionBacked !== false;
    })?.target;
    const gateRecovery = await tryAuthGateRecovery(page, initialScan.snapshot, options, firstBusinessTarget);
    if (gateRecovery.recovered) {
      businessSetupSuccess = true;
      authGateState = gateRecovery.authGateState;
      authGateDetectedDuringDiscovery = Boolean(gateRecovery.diagnostics?.detected);
      console.log(`[auth-setup] businessFlowAuthSetup executed recovered=${gateRecovery.recovered} gateDetected=${gateRecovery.diagnostics?.detected ?? false}`);
    } else {
      const stillGate = detectAuthGate(initialScan.snapshot);
      if (!stillGate.detected) {
        businessSetupSuccess = true;
        console.log(`[auth-setup] businessFlowAuthSetup no gate detected, treating as already authenticated`);
      } else if (gateRecovery.error?.includes("token")) {
        console.log(`[auth-token-gap] gap=token_challenge_no_config fallback=existing_mechanism`);
      } else {
        console.log(`[auth-setup] businessFlowAuthSetup attempted recovered=false error=${gateRecovery.error ?? "none"}`);
      }
    }
    businessSetupExecuted = true;
  } else if (scenario.authIntent === "gate_observation") {
    console.log(`[gate-observation] preserved=true authIntent=gate_observation will stop before auth per contract`);
  }

  // Defer login plan step emission until now, respecting business setup (prevent double login)
  const finalRequiresExplicitAuth = isAuthTest ? initialRequiresExplicitAuth : (shouldSetup ? false : initialRequiresExplicitAuth);
  if (loginAction && finalRequiresExplicitAuth && !shouldSetup) {
    planSteps.push({ index: planSteps.length + 1, action: "login", description: "Execute login" });
    console.log(`[login-plan] emitted login step for auth test`);
  } else if (shouldSetup) {
    console.log(`[login-plan] login step suppressed for business flow (setup handles auth)`);
  }

  // Task 1: Deduplicat action targets equivalents - normalize generic text
  function normalizeTarget(target: string): string {
    return target
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const deduplicatedActionTargets: ActionTargetItem[] = [];
  for (let i = 0; i < parsed.actionTargets.length; i++) {
    const current = parsed.actionTargets[i];
    const next = parsed.actionTargets[i + 1];

    // If next target is equivalent and no functional steps between them, skip
    if (next && normalizeTarget(current.target) === normalizeTarget(next.target)) {
      console.log(
        `[scenario-normalizer] duplicateActionTargetRemoved scenario=${(scenario as any).displayId || "unknown"} ` +
        `target="${current.target}" reason=consecutive_equivalent_action`
      );
      // Skip current, keep next - next iteration will handle it
      continue;
    }

    deduplicatedActionTargets.push(current);
  }

  // Replace parsed.actionTargets with deduplicated version
  parsed.actionTargets = deduplicatedActionTargets;

  parsed.actionTargets.forEach((target, order) => {
    actionOrderIndexByTarget.set(target, order);
  });
  console.log(`[discovery:case] Parsed action targets: ${parsed.actionTargets.map((t) => t.target).join(", ")}`);
  console.log(`[discovery:case] Parsed assertion targets: ${parsed.assertionTargets.map((t) => t.target).join(", ")}`);
  console.log(`[discovery:case] Action targets details: ${parsed.actionTargets.map((t) => `${t.target}(valueSource=${t.valueSource ?? 'none'},valueKey=${t.valueKey ?? 'none'})`).join(", ")}`);
  console.log(`[discovery:case] Setup intents: ${parsed.setupIntents.map((si) => `${si.type}(valueKey=${si.valueKey ?? 'none'},valueKeys=${si.valueKeys?.join(",") ?? 'none'})`).join(", ")}`);

  // CRITICAL: Detect detail scenario and identify final product click with robust fallbacks
  let detailTarget: string | undefined;
  let finalProductClickStepIndex: number | undefined;
  let detailCriticalAssertions: { target?: string; detailSections?: string[]; actionButtons?: string[] } | undefined;
  let detailTargetSource: "targetPath" | "lastAction" | "productAssertion" | "ordinalAssertionFallback" | undefined;

  console.log(`[detail-runtime] candidates actionTargets=[${parsed.actionTargets.map(t => `"${t.target}"`).join(", ")}]`);
  console.log(`[detail-runtime] candidates assertionTargets=[${parsed.assertionTargets.map(t => `"${t.target}"`).join(", ")}]`);

  // Entry classification must come from structured route metadata, never labels.
  const isStructuredEntryTarget = (target: any): boolean => {
    const metadata = target?.metadata ?? target?.routeMetadata ?? target;
    const role = String(metadata?.routeRole ?? metadata?.destinationRole ?? metadata?.role ?? "").toLowerCase();
    const intent = String(metadata?.actionIntent ?? metadata?.destinationIntent ?? "").toLowerCase();
    return role === "entry" || role === "navigation" || intent === "entry";
  };
  const routeProfileWithPaths = routeProfile as any;

  // FALLBACK A: Try exact targetPath match
  if (routeProfileWithPaths?.targetPaths) {
    console.log(`[detail-runtime] targetPathMatches found=${Object.keys(routeProfileWithPaths.targetPaths).length}`);

  for (const actionTarget of parsed.actionTargets) {
      const actionLabel = actionTarget.target.toLowerCase().trim();

      for (const [pathKey, tp] of Object.entries(routeProfileWithPaths.targetPaths)) {
        const typedTp = tp as any;
        const clickableToDetail = typedTp.productMetadata?.clickableToDetail === true ||
                                   typedTp.productMetadata?.presentationType === "detail_page";

        if (clickableToDetail) {
          const productLabel = (typedTp.productMetadata.productLabel || typedTp.target).toLowerCase().trim();

          if (actionLabel.includes(productLabel) || productLabel.includes(actionLabel)) {
            detailTarget = typedTp.productMetadata.productLabel || typedTp.target;
            finalProductClickStepIndex = actionTarget.index;
            detailTargetSource = "targetPath";
            detailCriticalAssertions = {
              target: detailTarget,
              detailSections: typedTp.productMetadata.detailSections,
              actionButtons: typedTp.productMetadata.actionButtons
            };
            console.log(
              `[detail-runtime] targetPathMatch found pathKey="${pathKey}" ` +
              `actionTarget="${actionTarget.target}" productLabel="${typedTp.productMetadata.productLabel || typedTp.target}"`
            );
            break;
          }
        }
      }
      if (detailTarget) break;
    }
  } else {
    console.log(`[detail-runtime] targetPathMatches found=0 (no routeProfile.targetPaths)`);
  }

  // FALLBACK B: Use last action target that's not entry/intermediate
  if (!detailTarget) {
    console.log(`[detail-runtime] fallback=B trying lastAction`);

    for (let i = parsed.actionTargets.length - 1; i >= 0; i--) {
      const actionTarget = parsed.actionTargets[i];

      // Skip ordinal selection patterns
      if (/seleccionar|primer|primera|elemento.*visible|listado/i.test(actionTarget.target)) {
        console.log(`[detail-runtime] fallback=B skipped actionIndex=${i} target="${actionTarget.target}" reason=ordinal_pattern`);
        continue;
      }

      // Skip targets explicitly classified as entry/navigation.
      if (isStructuredEntryTarget(actionTarget)) {
        console.log(`[detail-runtime] fallback=B skipped actionIndex=${i} reason=structured_entry_role`);
        continue;
      }

      // Skip intermediate category terms

      // Task 1: Check if this action target has nextTarget pending (is intermediate navigation)
      const nextActionTarget = parsed.actionTargets.find(at => at.index > actionTarget.index);
      if (nextActionTarget) {
        console.log(
          `[detail-runtime] ignoredIntermediateAsDetailTarget target="${actionTarget.target}" ` +
          `nextTarget="${nextActionTarget.target}" reason=has_pending_navigation`
        );
        continue;
      }

      // This is likely the product target (final action with no pending targets)
      detailTarget = actionTarget.target;
      finalProductClickStepIndex = actionTarget.index;
      detailTargetSource = "lastAction";
      console.log(
        `[detail-runtime] fallback=B selected actionIndex=${i} target="${actionTarget.target}" ` +
        `index=${actionTarget.index} finalProductClickStepIndex=${finalProductClickStepIndex}`
      );
      break;
    }
  }

  // FALLBACK C: Use main product assertion (exclude sections/buttons)
  if (!detailTarget) {
    console.log(`[detail-runtime] fallback=C trying productAssertion`);

    for (const assertionTarget of parsed.assertionTargets) {
      const assertionLower = assertionTarget.target.toLowerCase().trim();

      // Skip section terms
      if ((assertionTarget as any).metadata?.destinationRole === "section") {
        console.log(`[detail-runtime] fallback=C skipped assertion="${assertionTarget.target}" reason=detail_section`);
        continue;
      }

      // Skip button terms
      if ((assertionTarget as any).metadata?.targetRole === "action") {
        console.log(`[detail-runtime] fallback=C skipped assertion="${assertionTarget.target}" reason=action_button`);
        continue;
      }

      // Skip entry/intermediate terms
      if (isStructuredEntryTarget(assertionTarget)) {
        console.log(`[detail-runtime] fallback=C skipped assertion="${assertionTarget.target}" reason=entry_or_intermediate`);
        continue;
      }

      // Skip generic field labels (not concrete product names)
      // Skip assertions that appear functional but have no concrete entity target.
      // Only assertions backed by ordinal selection or entity metadata can become detailTarget.
      // This prevents screen descriptions ("Listado de X") from being treated as product details.

      // Find the action that immediately precedes this assertion
      const assertionIdx = assertionTarget.index;
      const precedingAction = [...parsed.actionTargets].reverse().find(at => at.index < assertionIdx);

      // Use preceding action as detail target if it exists and is a selection (ordinal/entity)
      const actionMetadata: any = (precedingAction as any)?.metadata ?? precedingAction;
      const actionIsBacked = actionMetadata?.executionBacked === true ||
        actionMetadata?.locatorAuthority === "runtime" ||
        actionMetadata?.runtimeObserved === true ||
        actionMetadata?.transitionValidated === true ||
        actionMetadata?.trustedKnowledge === true;
      const actionIntent = String(actionMetadata?.actionIntent ?? "").toLowerCase();
      const actionRole = String(actionMetadata?.targetRole ?? actionMetadata?.routeRole ?? actionMetadata?.destinationRole ?? "").toLowerCase();
      if (precedingAction && actionIsBacked && (actionIntent === "select" || actionIntent === "navigate" || actionRole === "detail" || actionRole === "entity")) {
        detailTarget = precedingAction.target;
        detailTargetSource = "precedingActionViaAssertion";
        finalProductClickStepIndex = precedingAction.index;
        console.log(`[detail-runtime] fallback=C assertionUsedAsDetail=false precedingAction="${precedingAction.target}" index=${precedingAction.index} source=${detailTargetSource}`);
      } else {
        console.log(`[detail-runtime] fallback=C assertionUsedAsDetail=false reason=no_preceding_selection assertion="${assertionTarget.target}"`);
      }
      break;
    }
  }

  // FALLBACK D: If ordinal exists, use first product assertion (excluding field terms)
  if (!detailTarget) {
    const hasOrdinal = parsed.actionTargets.some(at =>
      /seleccionar|primer|primera|elemento.*visible|listado/i.test(at.target)
    );

    if (hasOrdinal) {
      console.log(`[detail-runtime] fallback=D ordinal detected, trying ordinalAssertionFallback`);

      for (const assertionTarget of parsed.assertionTargets) {
        const assertionLower = assertionTarget.target.toLowerCase().trim();

        // Exclude field/attribute terms when ordinal is detected
        if (!isStructuredEntryTarget(assertionTarget) &&
            (assertionTarget as any).metadata?.destinationRole === "detail") {

          detailTarget = assertionTarget.target;
          detailTargetSource = "ordinalAssertionFallback";

          // Find ordinal action index
          const ordinalAction = parsed.actionTargets.find(at =>
            /seleccionar|primer|primera|elemento.*visible|listado/i.test(at.target)
          );
          finalProductClickStepIndex = ordinalAction?.index;

          console.log(
            `[detail-runtime] fallback=D selected assertion="${assertionTarget.target}" ` +
            `ordinalStepIndex=${finalProductClickStepIndex}`
          );
          break;
        } else if ((assertionTarget as any).metadata?.targetRole === "field") {
          console.log(
            `[detail-runtime] skipped assertion="${assertionTarget.target}" reason=attribute_or_field`
          );
        }
      }

      // If no suitable assertion found for ordinal, defer to ordinal itself as detail target
      if (!detailTarget && hasOrdinal) {
        console.log(`[detail-runtime] ordinal detail target deferred (no suitable assertion found)`);
        detailTargetSource = "ordinalAssertionFallback";
      }
    }
  }

  // FINAL SAFETY NET: if all assertions were field labels, use the ordinal action target
  if (!detailTarget) {
    const ordinalAction = parsed.actionTargets.find(at =>
      /seleccionar|primer|primera|elemento.*visible|listado/i.test(at.target)
    );
    if (ordinalAction) {
      detailTarget = ordinalAction.target;
      detailTargetSource = "ordinalActionTarget";
      finalProductClickStepIndex = ordinalAction.index;
      console.log(`[detail-runtime] fallback=ordinalActionTarget detailTarget="${detailTarget}"`);
    } else {
      const lastAction = parsed.actionTargets[parsed.actionTargets.length - 1];
      if (lastAction) {
        detailTarget = lastAction.target;
        detailTargetSource = "lastActionTarget";
        console.log(`[detail-runtime] fallback=lastActionTarget detailTarget="${detailTarget}"`);
      }
    }
  }

  // Log final resolution
  if (detailTarget) {
    console.log(
      `[detail-runtime] scenario="${scenario.title}" detailTarget="${detailTarget}" ` +
      `source=${detailTargetSource} finalProductClickStepIndex=${finalProductClickStepIndex ?? 'undefined'} ` +
      `criticalAssertions={target:"${detailTarget}", detailSections:[${detailCriticalAssertions?.detailSections?.join(", ") || "inferred"}], ` +
      `actionButtons:[${detailCriticalAssertions?.actionButtons?.join(", ") || "inferred"}]}`
    );

    // Set finalProductClickStepIndex in evidence recorder for validation
    if (evidenceRec && finalProductClickStepIndex !== undefined) {
      evidenceRec.setFinalProductClickStepIndex(finalProductClickStepIndex);
    }
  } else {
    console.log(
      `[detail-runtime] scenario="${scenario.title}" detailTarget=undefined ` +
      `reason=no_fallback_matched actionTargets=${parsed.actionTargets.length} ` +
      `assertionTargets=${parsed.assertionTargets.length}`
    );
  }

  // Detect if this is a detail scenario even if detailTarget wasn't resolved
  const hasDetailAssertions = parsed.assertionTargets.some(at => {
    const metadata: any = (at as any).metadata ?? at;
    const role = String(metadata.routeRole ?? metadata.destinationRole ?? metadata.targetRole ?? "").toLowerCase();
    const intent = String(metadata.actionIntent ?? metadata.destinationIntent ?? "").toLowerCase();
    return role === "detail" || intent === "detail";
  });

  if (hasDetailAssertions && !detailTarget) {
    console.log(
      `[detail-runtime] WARNING scenario="${scenario.title}" hasDetailAssertions=true ` +
      `detailTarget=undefined status=will_block_early_completion`
    );
  }

  // Pre-classify evidence kind BEFORE detail-runtime and markDetailScreenshotRequired.
  // Prevents non-detail scenarios from setting detailEvidence.required=true.
  if (evidenceRec) {
    const lastAction = parsed.actionTargets[parsed.actionTargets.length - 1];
    const lastTarget = lastAction?.target ?? "";
    const lastActionText = lastAction?.action ?? "";
    let kind = "routeEvidence";
    let isDetail = false;
    if (lastActionText === "assert" || lastActionText === "assertVisible") { kind = "assertionEvidence"; }
    else if (lastActionText === "click" && /Continuar|Confirmar|Cancelar|Enviar|Volver|Generar|Imprimir|Descargar/i.test(lastTarget)) { kind = "formEvidence"; }
    else if (lastActionText === "click" && /seleccionar\s+(?:el|la)\s+primer/i.test(lastTarget)) { kind = "selectionEvidence"; }
    else if (lastActionText === "click" && /detalle|consultar\s+detalle/i.test(lastTarget)) { kind = "detailEvidence"; isDetail = true; }
    evidenceRec.setEvidenceClassification(kind, isDetail, lastTarget);
    console.log(`[evidence-classifier] phase=pre_detail_runtime scenario="${scenario.title?.slice(0,60)}" evidenceKind=${kind} isDetail=${isDetail} lastTarget="${lastTarget}"`);
  }

  // Mark detail evidence as required if this is a detail scenario
  if (detailTarget && evidenceRec) {
    evidenceRec.markDetailScreenshotRequired(detailTarget);
  }

  // TASK A: Expand targetPath route to eliminate ordinal selection
  let expandedActionTargets = [...parsed.actionTargets];
  let detailRouteExpanded = false;

  if (detailTarget && routeProfileWithPaths?.targetPaths) {
    const targetPathEntry = routeProfileWithPaths.targetPaths[detailTarget];
    const clickableToDetail = targetPathEntry?.productMetadata?.clickableToDetail === true ||
                               targetPathEntry?.productMetadata?.presentationType === "detail_page";

    if (targetPathEntry && clickableToDetail) {
      const requiredIntermediates = targetPathEntry.requiredIntermediates || [];
      const fullNavigationPath = [...requiredIntermediates, detailTarget];

      console.log(
        `[detail-route-expansion-runtime] scenario="${scenario.title}" target="${detailTarget}" ` +
        `source=targetPath requiredIntermediates=[${requiredIntermediates.join(", ")}] ` +
        `fullPath=[${fullNavigationPath.join(" → ")}]`
      );

      // Build map of existing targets (normalized)
      const existingTargets = new Set(
        expandedActionTargets.map(at => at.target.toLowerCase().trim())
      );

      // Remove ordinal selection steps that would be replaced by exact navigation
      const ordinalPattern = /seleccionar|primer|primera|elemento.*visible|listado/i;
      const targetsToRemove: number[] = [];

      expandedActionTargets.forEach((at, idx) => {
        if (ordinalPattern.test(at.target) || ordinalPattern.test(at.action)) {
          targetsToRemove.push(idx);
          console.log(
            `[detail-route-expansion-runtime] removedOrdinal=true step=${at.index} ` +
            `originalTarget="${at.target}" reason=replaced_with_exact_path`
          );
        }
      });

      // Remove ordinal steps in reverse order to maintain indices
      targetsToRemove.reverse().forEach(idx => {
        expandedActionTargets.splice(idx, 1);
      });

      // Add missing intermediate steps and final detail target
      const stepsToAdd: ActionTargetItem[] = [];
      let maxIndex = Math.max(...expandedActionTargets.map(at => at.index), 0);

      fullNavigationPath.forEach((pathSegment, pathIdx) => {
        const normalizedSegment = pathSegment.toLowerCase().trim();

        // Check if this step already exists
        const alreadyExists = existingTargets.has(normalizedSegment);

        if (!alreadyExists) {
          maxIndex++;
          stepsToAdd.push({
            index: maxIndex,
            action: `Clic en "${pathSegment}".`,
            target: pathSegment,
            semanticRole: pathIdx === fullNavigationPath.length - 1 ? "product" : "category"
          });

          console.log(
            `[detail-route-expansion-runtime] addedStep=true index=${maxIndex} ` +
            `target="${pathSegment}" reason=missing_intermediate`
          );
        } else {
          console.log(
            `[detail-route-expansion-runtime] stepExists=true target="${pathSegment}" ` +
            `reason=already_present`
          );
        }
      });

      // Append new steps
      if (stepsToAdd.length > 0) {
        expandedActionTargets.push(...stepsToAdd);
        detailRouteExpanded = true;

        // Update finalProductClickStepIndex to the exact target click
        const exactTargetStep = stepsToAdd.find(
          step => step.target.toLowerCase().trim() === detailTarget.toLowerCase().trim()
        );
        if (exactTargetStep) {
          finalProductClickStepIndex = exactTargetStep.index;
          console.log(
            `[detail-route-expansion-runtime] updatedFinalProductClickStepIndex=${finalProductClickStepIndex} ` +
            `target="${detailTarget}"`
          );
        }

        console.log(
          `[detail-route-expansion-runtime] expansionComplete=true addedSteps=${stepsToAdd.length} ` +
          `removedOrdinalSteps=${targetsToRemove.length} finalPath=[${fullNavigationPath.join(" → ")}]`
        );
      }
    } else if (detailTarget && !targetPathEntry) {
      // Detail scenario detected but no targetPath defined - mark as blocked
      console.log(
        `[detail-route-expansion-runtime] blocked=true scenario="${scenario.title}" ` +
        `detailTarget="${detailTarget}" reason=needs_route_profile ` +
        `suggestion="Add targetPath for '${detailTarget}' to routeProfile"`
      );
    }
  }

  for (const si of parsed.setupIntents) {
    if (si.type === "navigation_path" && si.path) {
      console.log(`[discovery:case] Parsed setup route (navigation): ${si.path.join(" > ")}`);
    } else if (si.type === "precondition_context") {
      console.log(`[discovery:case] Parsed setup route (context): ${si.context}`);
    } else if (si.type === "setup_route") {
      const target = si.actionTarget === "APP_BASE_URL" ? appBaseUrl : si.actionTarget ?? appBaseUrl;
      console.log(`[discovery:case] Setup route detected: using ${target}`);
    }
  }

  for (const si of parsed.setupIntents) {
    if (si.type === "navigation_path" && si.path) {
      const navTargets = si.path.map((segment, idx) => ({
        index: si.priority + idx,
        action: `Navigate: ${segment}`,
        target: segment
      }));
      expandedActionTargets.unshift(...navTargets);
    }
  }

  if (parsed.skippedActions.length > 0) {
    for (const skipped of parsed.skippedActions) {
      console.log(`[discovery:case] Skipping: ${skipped.action}`);
      steps.push({ index: skipped.index, action: skipped.action, status: "skipped" });
    }
  }

  const orderedItems: Array<{
    index: number;
    type: "action" | "assertion" | "nav_segment";
    actionTarget?: ActionTargetItem;
    executableStep?: ExecutableStep;
    navTarget?: { target: string; action: string };
  }> = [];

  for (const si of parsed.setupIntents) {
    if (si.type === "navigation_path" && si.path) {
      si.path.forEach((segment, idx) => {
        orderedItems.push({
          index: si.priority + idx,
          type: "nav_segment",
          navTarget: { target: segment, action: `Navigate: ${segment}` }
        });
      });
    }
  }

  for (const at of expandedActionTargets) {
    orderedItems.push({ index: at.index, type: "action", actionTarget: at });
  }

  for (const es of parsed.orderedSteps) {
    if (es.type === "assertion" || es.type === "optional_action") {
      orderedItems.push({ index: es.stepIndex, type: "assertion", executableStep: es });
    }
  }

  orderedItems.sort((a, b) => a.index - b.index || 0);

  let currentSnapshot = initialScan.snapshot;
  const reapplyResolvedRuntimeAuthFields = async (): Promise<void> => {
    for (const field of runtimeAuthFieldValues.values()) {
      try {
        const resolution = await resolveFillTarget(page, currentSnapshot, field.target, activeContainer);
        if (resolution.status === "resolved" && resolution.locator) {
          await resolution.locator.fill(field.value);
        }
      } catch {
        // A field may no longer belong to the current screen after a submit.
      }
    }
  };
  const evaluateAndApplyEarlyCompletionAfterAction = async (
    currentIndex: number,
    currentTarget: string,
    currentActionOrder?: number,
    evidenceIndexOverride?: number  // NEW: Allow passing evidence index explicitly
  ): Promise<boolean> => {
    // Use evidence index for screenshot capture to match the actual step index displayed
    const effectiveEvidenceIndex = evidenceIndexOverride ?? evidenceStepIndex;

    // CRITICAL: Capture detail screenshot after final product click
    console.log(
      `[detail-final-click] check currentIndex=${currentIndex} evidenceIndex=${effectiveEvidenceIndex} currentTarget="${currentTarget}" ` +
      `detailTarget="${detailTarget ?? 'undefined'}" ` +
      `finalProductClickStepIndex=${finalProductClickStepIndex ?? 'undefined'} ` +
      `evidenceRec=${evidenceRec ? 'defined' : 'undefined'}`
    );

    // Classify screen intent — requires typed action/assertion metadata from parser.
    // No text heuristics (regex/words). Metadata not yet available at parse time.
    let screenIntent: string = "unknown";
    // Future: when parser produces action.kind, assertion.intent, enable:
    //   selector executed + entity_attribute assertions → "detail"
    //   selector executed + collection assertions → "list"
    //   selector executed alone → "list" (default)
    if (detailTarget && finalProductClickStepIndex === currentIndex) {
      console.log(`[screen-intent] scenario="${scenario.title?.slice(0,50)}" intent=unknown (metadata pending)`);
    }

    if (detailTarget && finalProductClickStepIndex === currentIndex && evidenceRec && screenIntent === "detail") {
      console.log(`[detail-final-click] matched=true target="${detailTarget}" planIndex=${currentIndex} evidenceIndex=${effectiveEvidenceIndex}`);
      console.log(`[detail-screenshot] afterFinalClick=true target="${detailTarget}" evidenceIndex=${effectiveEvidenceIndex}`);
      console.log(`[detail-wait] started target="${detailTarget}" timeoutMs=5000`);

      try {
        const waitStartTime = Date.now();
        let detailReady = false;
        let lastSnapshot: any;
        let strongSignalFound = false;

        // Poll for detail screen signals
        while (Date.now() - waitStartTime < 5000 && !detailReady) {
          const elapsedMs = Date.now() - waitStartTime;

          // Re-scan to check for detail signals
          const pollScan = await scanAndCollectObjects(page, effectiveEvidenceIndex, evidenceDir);
          lastSnapshot = pollScan.snapshot;

          // Check for product name - exact or semantic alias
          let productNameVisible = lastSnapshot.elements.some((el: any) =>
            (el.text || el.label || el.name || "").toLowerCase().includes(detailTarget.toLowerCase())
          );
          if (!productNameVisible) {
            const pollNameMatch = findBestProductNameMatch(detailTarget, lastSnapshot.elements, { minSemanticScore: 0.7, preferHeadings: true });
            productNameVisible = pollNameMatch.matches;
          }

          const detailHeadingVisible = lastSnapshot.elements.some((el: any) => {
            const role = String(el.role ?? el.tagName ?? "").toLowerCase();
            const text = String(el.text ?? el.label ?? el.name ?? "");
            return /heading|h1|h2|h3/.test(role) && normalizeText(text) === normalizeText(detailTarget);
          });
          const detailSectionsVisible = false;
          const actionButtonsVisible = false;

          // Strong signal = heading OR sections (NOT just buttons)
          strongSignalFound = detailHeadingVisible || detailSectionsVisible;
          detailReady = productNameVisible && strongSignalFound;

          console.log(
            `[detail-wait] poll elapsedMs=${elapsedMs} productName=${productNameVisible} ` +
            `detailHeading=${detailHeadingVisible} detailSections=${detailSectionsVisible} ` +
            `actionButtons=${actionButtonsVisible} strongSignal=${strongSignalFound} ready=${detailReady}`
          );

          if (detailReady) {
            console.log(`[detail-wait] completed ready=true elapsedMs=${elapsedMs}`);
            break;
          }

          // Wait before next poll
          await page.waitForTimeout(250);
        }

        if (!detailReady) {
          const elapsedMs = Date.now() - waitStartTime;
          console.log(`[detail-wait] completed ready=false reason=timeout_without_strong_detail_signal elapsedMs=${elapsedMs}`);
        }

        // Capture after state
        const afterUrl = page.url();
        console.log(`[click-proof] afterUrl=${afterUrl}`);

        // Use last polled snapshot for oracle evaluation
        const detailSnapshot = lastSnapshot;

        // Oracle: Validate detail opened with STRONG signals only
        // Re-evaluate from final snapshot to ensure consistency
        const productNameExact = detailSnapshot.elements.some((el: any) =>
          (el.text || el.label || el.name || "").toLowerCase().includes(detailTarget.toLowerCase())
        );

        // Semantic alias matching: handles cases where detail page uses a different
        // commercial name (e.g., "Depósitos a plazo en Pesos" vs "Depósito a Plazo Digital en Pesos")
        let productNameVisible = productNameExact;
        let productNameMatchMode: "exact" | "normalized" | "semantic_alias" | "none" = productNameExact ? "exact" : "none";
        let productNameMatchResult: ProductNameMatchResult | undefined;

        if (!productNameExact) {
          productNameMatchResult = findBestProductNameMatch(
            detailTarget,
            detailSnapshot.elements,
            { minSemanticScore: 0.7, preferHeadings: true }
          );
          if (productNameMatchResult.matches) {
            productNameVisible = true;
            productNameMatchMode = productNameMatchResult.mode;
            console.log(
              `[product-name-match] expected="${detailTarget}" actual="${productNameMatchResult.actualText}" ` +
              `mode=${productNameMatchResult.mode} score=${productNameMatchResult.score.toFixed(2)} ` +
              `matched=[${productNameMatchResult.matchedTokens.join(",")}] extra=[${productNameMatchResult.extraTokens.join(",")}]`
            );
          }
        }

        // Detail evidence comes from the explicit target and runtime transition.
        const detailHeadingVisible = detailSnapshot.elements.some((el: any) => {
          const role = String(el.role ?? el.tagName ?? "").toLowerCase();
          const text = String(el.text ?? el.label ?? el.name ?? "");
          return /heading|h1|h2|h3/.test(role) && normalizeText(text) === normalizeText(detailTarget);
        });
        const detailSectionsVisible = false;
        const actionButtonsVisible = false;

        // Check for navigation transition (URL/DOM change) - additional evidence, not gate
        const urlChanged = afterUrl !== currentSnapshot.url;
        const elementsCountChanged = Math.abs(detailSnapshot.elements.length - currentSnapshot.elements.length) > 5;
        const navigationTransitionDetected = urlChanged || elementsCountChanged;

        // HARDENED ORACLE: Accept detail with STRONG signals AND either productName or action buttons or transition
        // productName alone is NOT required when other strong signals exist
        const strongDetailSignal = detailHeadingVisible || detailSectionsVisible;
        const transitionDetected = urlChanged || elementsCountChanged || navigationTransitionDetected;
        const hasStrongBackupSignal = actionButtonsVisible || transitionDetected || strongDetailSignal;
        const detailScreenVisible = strongDetailSignal && (productNameVisible || actionButtonsVisible || transitionDetected);
        let detailOpened = detailScreenVisible;
        let oracleReason = "";
        if (!detailOpened) {
          oracleReason = !productNameVisible ? "product_name_not_visible" :
                        !strongDetailSignal ? "insufficient_detail_signals" :
                        "no_page_transition";
        } else {
          oracleReason = detailHeadingVisible ? "detail_heading_visible" :
                        detailSectionsVisible ? "detail_sections_and_action_buttons_visible" :
                        "product_name_with_transition";
        }
        // If productName missing but other strong signals exist, downgrade but keep opened
        if (!productNameVisible && detailOpened && (detailSectionsVisible || actionButtonsVisible)) {
          console.log(`[detail-oracle] productNameMissing=true downgraded=true reason=other_strong_detail_signals`);
        }

        console.log(
          `[detail-oracle] target="${detailTarget}" ` +
          `productName=${productNameVisible} productNameMatchMode=${productNameMatchMode} ` +
          `detailHeading=${detailHeadingVisible} detailSections=${detailSectionsVisible} ` +
          `actionButtons=${actionButtonsVisible} urlChanged=${urlChanged} domChanged=${elementsCountChanged} ` +
          `navigationTransition=${navigationTransitionDetected} strongSignal=${strongDetailSignal} ` +
          `detailScreenVisible=${detailScreenVisible} opened=${detailOpened}`
        );

        // Record detailOpened result for evidence gate
        evidenceRec.setDetailOpened(detailOpened);

        // Persist semantic alias learned during detail oracle
        if (detailOpened && productNameMatchMode === "semantic_alias" && productNameMatchResult?.actualText) {
          const aliasSuggestion: RouteProfileSuggestion = {
            appSlug: options.appSlug ?? "default",
            from: detailTarget,
            to: productNameMatchResult.actualText,
            relation: "alias_candidate",
            source: "successful_resolution",
            confidence: productNameMatchResult.score,
            evidence: {
              afterUrl: afterUrl,
              candidateText: productNameMatchResult.actualText,
            },
            status: "pending",
            createdAt: new Date().toISOString()
          };
          routeProfileSuggestions.push(aliasSuggestion);
          console.log(
            `[route-learning] detail alias learned expected="${detailTarget}" ` +
            `actual="${productNameMatchResult.actualText}" score=${productNameMatchResult.score.toFixed(2)} source=detail_oracle`
          );
        }

        if (!detailOpened) {
          const reason = !productNameVisible ? "product_name_not_visible" :
                        !strongDetailSignal ? "insufficient_detail_signals" :
                        "no_page_transition";  // Should not reach with new logic
          console.log(`[detail-oracle] opened=false reason=${reason}`);

          // Do NOT capture detail screenshot if detail didn't open
          console.log(`[detail-screenshot] skipped reason=detail_not_opened`);
        } else {
          // Detail opened successfully - capture screenshot with evidence index and oracle signals
          console.log(`[detail-screenshot] required=true target="${detailTarget}" evidenceIndex=${effectiveEvidenceIndex}`);
          const screenshotResult = await evidenceRec.captureDetailScreenshot(
            page,
            detailTarget,
            effectiveEvidenceIndex,
            {
              validateText: detailTarget,
              detailHeading: detailHeadingVisible,
              detailSections: detailSectionsVisible,
              actionButtons: actionButtonsVisible,
              oracleReason: "detail_loaded"
            }
          );

          if (screenshotResult.captured) {
            console.log(`[detail-screenshot] captured=true target="${detailTarget}" evidenceIndex=${effectiveEvidenceIndex} path=${screenshotResult.screenshotPath}`);
            // Register step record pointing to detail screenshot to avoid duplicating generic screenshot
            evidenceRec.addStepRecord(effectiveEvidenceIndex, `Clic en "${detailTarget}".`, {
              target: detailTarget,
              status: "passed",
              screenshotPath: screenshotResult.screenshotPath,
            });
            console.log(`[detail-screenshot] stepEvidenceReused=true step=${effectiveEvidenceIndex} path=${screenshotResult.screenshotPath}`);
          } else {
            console.log(`[detail-screenshot] captured=false target="${detailTarget}" evidenceIndex=${effectiveEvidenceIndex} reason=${screenshotResult.reason}`);
          }
        }
      } catch (err) {
        console.log(`[detail-screenshot] error target="${detailTarget}" evidenceIndex=${effectiveEvidenceIndex} error=${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      if (!detailTarget) {
        console.log(`[detail-final-click] matched=false reason=no_detailTarget`);
      } else if (finalProductClickStepIndex !== currentIndex) {
        console.log(`[detail-final-click] matched=false reason=index_mismatch expect=${finalProductClickStepIndex} got=${currentIndex}`);
      } else if (!evidenceRec) {
        console.log(`[detail-final-click] matched=false reason=no_evidenceRecorder`);
      }
    }

    const remainingActionTargets = typeof currentActionOrder === "number"
      ? parsed.actionTargets.filter((a) => {
          const order = actionOrderIndexByTarget.get(a);
          return typeof order === "number" && order > currentActionOrder;
        })
      : parsed.actionTargets.filter(a => a.index > currentIndex);
    const policyPendingActions = remainingActionTargets.map((a) => ({
      ...a,
      index: (() => {
        const order = actionOrderIndexByTarget.get(a);
        return typeof order === "number" ? order : a.index;
      })()
    }));

    const earlyCompletion = evaluateEarlyCompletion(
      currentSnapshot,
      parsed.assertionTargets,
      remainingActionTargets,
      (options as any).appConfig,
      {
        currentStepIndex: currentIndex,
        triggerStepIndex: finalProductClickStepIndex,
        triggerExecuted: finalProductClickStepIndex != null && currentIndex >= finalProductClickStepIndex,
      }
    );

    // CRITICAL: Extract critical assertions from targetPath metadata for detail scenarios
    let criticalAssertions: { target?: string; detailSections?: string[]; actionButtons?: string[] } | undefined;
    const routeProfileWithPaths = routeProfile as any; // Type assertion: app config can have targetPaths
    if (routeProfileWithPaths?.targetPaths) {
      // Find matching targetPath by checking assertion targets against product labels
      for (const assertionTarget of parsed.assertionTargets) {
        const assertionLabel = assertionTarget.target.toLowerCase().trim();
        for (const [pathKey, tp] of Object.entries(routeProfileWithPaths.targetPaths)) {
          const typedTp = tp as any;
          if (typedTp.productMetadata?.clickableToDetail) {
            const productLabel = (typedTp.productMetadata.productLabel || typedTp.target).toLowerCase().trim();
            if (assertionLabel.includes(productLabel) || productLabel.includes(assertionLabel)) {
              criticalAssertions = {
                target: typedTp.productMetadata.productLabel || typedTp.target,
                detailSections: typedTp.productMetadata.detailSections,
                actionButtons: typedTp.productMetadata.actionButtons
              };
              console.log(
                `[detail-assertion-gate] scenario=${scenario.title} ` +
                `target="${criticalAssertions.target}" ` +
                `detailSections=[${criticalAssertions.detailSections?.join(", ") || "none"}] ` +
                `actionButtons=[${criticalAssertions.actionButtons?.join(", ") || "none"}]`
              );
              break;
            }
          }
        }
        if (criticalAssertions) break;
      }
    }

    const earlyCompletionPolicy = evaluateEarlyCompletionPolicy({
      pendingActions: policyPendingActions,
      executedStepIndices: executedActionOrders,
      authGateState,
      skippedSteps: Array.from(skippedActionOrders).map((order) => ({
        targetText: "",
        status: "skipped" as const,
        recoveredBy: "auth_flow",
        index: order
      })),
      satisfiedAssertions: earlyCompletion.satisfiedAssertions,
      pendingAssertions: earlyCompletion.pendingAssertions,
      criticalAssertions: criticalAssertions
    });

    const policyDiag = earlyCompletionPolicy.diagnostics;
    console.log(
      `[discovery:case] Early completion evaluation: currentTarget="${currentTarget}", currentIndex=${currentIndex}, executedStepIndices=[${Array.from(executedStepIndices).sort((a, b) => a - b).join(", ")}], pendingActions=[${remainingActionTargets.map(a => `${a.index}:${a.target}`).join(" | ")}], authConsumed=[${policyDiag.classifications.authConsumed.map(t => `"${t}"`).join(", ")}], optional=[${policyDiag.classifications.optional.map(t => `"${t}"`).join(", ")}], duplicateAlreadyExecuted=[${policyDiag.classifications.duplicateAlreadyExecuted.map(t => `"${t}"`).join(", ")}], functionalRequired=[${policyDiag.classifications.functionalRequired.map(t => `"${t}"`).join(", ")}].`
    );

    // CRITICAL: Block early completion if detail screenshot is required but not captured
    // OR if detail scenario detected but detailTarget unresolved
    if (detailTarget && evidenceRec) {
      const detailEvidence = (evidenceRec as any).detailEvidence;
      const detailScreenshotCaptured = detailEvidence?.captured === true && detailEvidence?.screenshotPath;

      // Skip detail gate entirely for non-detail evidence
      if ((evidenceRec as any).isDetailEvidence === false) {
        console.log(`[detail-early-completion-gate] skipped reason=not_detail_evidence evidenceKind=${(evidenceRec as any).evidenceKind}`);
      } else if (!detailScreenshotCaptured) {
        // GENERIC DETAIL TARGET BYPASS: If detailTarget is a generic placeholder
        // ("detalle", "información", "pantalla de detalle") and the action was successful
        // (satisfied assertions exist), the product-card-click worked — don't block.
        const GENERIC_DETAIL_PATTERNS = /^detalle$|^información$|^informacion$|^pantalla de detalle$/i;
        const isGenericDetailTarget = GENERIC_DETAIL_PATTERNS.test(detailTarget);
        const hasSatisfiedAssertions = earlyCompletion.satisfiedAssertions.length > 0;

        if (isGenericDetailTarget && hasSatisfiedAssertions) {
          console.log(
            `[detail-runtime] genericDetailTargetReplaced from="${detailTarget}" ` +
            `to="${earlyCompletion.satisfiedAssertions[0]}" ` +
            `reason=generic_target_with_satisfied_assertions`
          );
          // Don't block — proceed to allow early completion
        } else {
          console.log(
            `[detail-early-completion-gate] blocked=true scenario="${scenario.title}" ` +
            `detailTarget="${detailTarget}" reason=detail_screenshot_not_captured_yet ` +
            `currentStep=${currentIndex}`
          );

          // Don't allow early completion until detail screenshot is captured
          if (earlyCompletion.satisfied && earlyCompletionPolicy.allowed) {
            console.log(
              `[detail-early-completion-gate] overriding early completion policy ` +
              `originalAllowed=true newAllowed=false reason=missing_detail_screenshot`
            );
            return false; // Block early completion
          }
        }
      } else {
        console.log(
          `[detail-early-completion-gate] passed detailScreenshotCaptured=true ` +
          `path=${detailEvidence.screenshotPath}`
        );
      }
    } else if (!detailTarget && hasDetailAssertions) {
      // Detail scenario detected but detailTarget unresolved
      console.log(
        `[detail-early-completion-gate] blocked=true scenario="${scenario.title}" ` +
        `reason=detail_target_unresolved hasDetailAssertions=true currentStep=${currentIndex}`
      );

      if (earlyCompletion.satisfied && earlyCompletionPolicy.allowed) {
        console.log(
          `[detail-early-completion-gate] overriding early completion policy ` +
          `originalAllowed=true newAllowed=false reason=detail_target_unresolved`
        );
        return false; // Block early completion
      }
    }

    console.log(
      `[early-completion-assertions] satisfied=${earlyCompletion.satisfiedAssertions.length}:[${earlyCompletion.satisfiedAssertions.join("|")}] ` +
      `pending=${earlyCompletion.pendingAssertions.length}:[${earlyCompletion.pendingAssertions.join("|")}] ` +
      `skipped=${earlyCompletion.skippedAssertions.length}:[${earlyCompletion.skippedAssertions.join("|")}] ` +
      `deferred=${earlyCompletion.deferredAssertions.length}:[${earlyCompletion.deferredAssertions.join("|")}]`
    );

    if (earlyCompletion.satisfied && earlyCompletionPolicy.allowed) {
      earlyCompletionSatisfied = true;
      console.log(`[discovery:case] Early completion allowed: ${earlyCompletionPolicy.reason}. Skipping remaining actions.`);

      // Persist assertions that MCP actually observed/satisfied so they survive
      // early completion as canonical backed assertion evidence in stepResults.
      const satisfiedAssertionTexts = new Set(earlyCompletion.satisfiedAssertions);
      for (const assertionTarget of parsed.assertionTargets) {
        if (satisfiedAssertionTexts.has(assertionTarget.target)) {
          steps.push({
            index: assertionTarget.index,
            action: assertionTarget.action,
            status: "found",
            targetText: assertionTarget.target,
            assertionStatus: "passed",
            assertionClassification: "passive_visibility",
            matchedText: assertionTarget.target
          } as any);
        }
      }

      // Persist assertions that were evaluated, NOT satisfied, and allowed as
      // contextual/non-blocking (skipped/deferred), so SpecExecutionContract does
      // not reconstruct them later as required=true.
      const nonBlockingNotSatisfiedTexts = new Set([
        ...earlyCompletion.skippedAssertions,
        ...earlyCompletion.deferredAssertions
      ]);
      for (const assertionTarget of parsed.assertionTargets) {
        if (assertionTarget.source === "action" && nonBlockingNotSatisfiedTexts.has(assertionTarget.target)) {
          steps.push({
            index: assertionTarget.index,
            action: assertionTarget.action,
            status: "not_found",
            targetText: assertionTarget.target,
            assertionImportance: "contextual",
            pendingDiscovery: true
          } as any);
        }
      }

      for (const rem of remainingActionTargets) {
        steps.push({
          index: rem.index,
          action: rem.action,
          status: "skipped_after_completion",
          targetText: rem.target,
          error: "Skipped due to early completion validation passing.",
          earlyCompletionPolicyDiagnostics: policyDiag
        } as any);
      }
      return true;
    }

    if (earlyCompletion.satisfied && !earlyCompletionPolicy.allowed) {
      console.log(
        `[discovery:case] Early completion blocked: ${earlyCompletionPolicy.reason}. Pending functional actions: ${earlyCompletionPolicy.pendingFunctionalTargets.join(", ")}`
      );
    }

    if (!earlyCompletion.satisfied && earlyCompletion.pendingAssertions.length > 0) {
      console.log(
        `[discovery:case] Early completion not satisfied at step ${currentIndex}. Pending: [${earlyCompletion.pendingAssertions.map(a => `"${a}"`).join(", ")}]. Satisfied: [${earlyCompletion.satisfiedAssertions.map(a => `"${a}"`).join(", ")}].`
      );
    }

    return false;
  };

  // --- Execute setup_authentication (login) intents ---
  for (const si of parsed.setupIntents) {
    if (si.type !== "setup_authentication") continue;

    const keys = si.valueKeys ?? [];
    const key1 = keys[0] ?? si.valueKey ?? "usuario_valido";
    const key2 = keys[1] ?? "contrasena_valida";

    const testDataMap = testData ?? {};
    const value1 = key1 in testDataMap ? String(testDataMap[key1]) : undefined;
    const value2 = key2 in testDataMap ? String(testDataMap[key2]) : undefined;

    if (!value1 || !value2) {
      const missingKeys = [];
      if (!value1) missingKeys.push(`"${key1}"`);
      if (!value2) missingKeys.push(`"${key2}"`);
      const errorMsg = `Missing test data value for key(s): ${missingKeys.join(", ")}`;

      console.log(`[discovery:case] Setup auth failed: ${errorMsg}`);
      steps.push({
        index: si.priority,
        action: si.originalText,
        status: "not_found",
        targetText: si.originalText,
        error: errorMsg
      });
      failedAtStep = si.priority;
      failedTarget = si.originalText;
      failedReason = "missing_test_data";

      await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
      await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      ).candidatePlan ?? {}, null, 2), "utf-8");

      return buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      );
    }

    console.log(`[discovery:case] Resolving login form for setup authentication...`);
    const loginForm = await resolveLoginForm(page, currentSnapshot, keys);

    if (loginForm.status === "needs_setup_resolution") {
      console.log(`[discovery:case] Login form resolution failed: ${loginForm.diagnosis}`);
      steps.push({
        index: si.priority,
        action: si.originalText,
        status: "needs_setup_resolution",
        targetText: si.originalText,
        error: loginForm.diagnosis,
        attemptedLocators: loginForm.fields.map((f) => f.strategy)
      });
      failedAtStep = si.priority;
      failedTarget = si.originalText;
      failedReason = "needs_setup_resolution";

      await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
      await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      ).candidatePlan ?? {}, null, 2), "utf-8");

      return buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      );
    }

    if (loginForm.confidence < 0.4) {
      console.log(`[discovery:case] Login form confidence too low: ${loginForm.confidence}`);
      steps.push({
        index: si.priority,
        action: si.originalText,
        status: "needs_setup_resolution",
        targetText: si.originalText,
        error: `Login form confidence too low (${loginForm.confidence.toFixed(2)}). ${loginForm.diagnosis}`
      });
      failedAtStep = si.priority;
      failedTarget = si.originalText;
      failedReason = "needs_setup_resolution";

      await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
      await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      ).candidatePlan ?? {}, null, 2), "utf-8");

      return buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      );
    }

    if (loginForm.userField) {
      console.log(`[discovery:case] Login: filling user field with "${value1}"`);
      try {
        await loginForm.userField.locator.fill(value1);
      } catch (err) {
        steps.push({
          index: si.priority,
          action: si.originalText,
          status: "not_found",
          targetText: si.originalText,
          error: `Failed to fill user field: ${err instanceof Error ? err.message : String(err)}`
        });
        failedAtStep = si.priority;
        failedTarget = si.originalText;
        failedReason = "fill_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
      planSteps.push({
        index: planSteps.length + 1,
        action: "fill",
        description: `Login: fill user field (key: ${key1})`,
        target: { strategy: "login_resolver" as any, value: loginForm.userField.matchedText, exact: false },
        valueKey: key1
      });
    }

    if (loginForm.passwordField) {
      console.log(`[discovery:case] Login: filling password field`);
      try {
        await loginForm.passwordField.locator.fill(value2);
      } catch (err) {
        steps.push({
          index: si.priority,
          action: si.originalText,
          status: "not_found",
          targetText: si.originalText,
          error: `Failed to fill password field: ${err instanceof Error ? err.message : String(err)}`
        });
        failedAtStep = si.priority;
        failedTarget = si.originalText;
        failedReason = "fill_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
      planSteps.push({
        index: planSteps.length + 1,
        action: "fill",
        description: `Login: fill password field (key: ${key2})`,
        target: { strategy: "login_resolver" as any, value: "password", exact: false },
        valueKey: key2
      });
    }

    if (loginForm.submitButton) {
      console.log(`[discovery:case] Login: clicking submit button "${loginForm.submitButton.text}"`);
      try {
        await loginForm.submitButton.locator.click();
      } catch (err) {
        steps.push({
          index: si.priority,
          action: si.originalText,
          status: "not_found",
          targetText: si.originalText,
          error: `Failed to click login submit button: ${err instanceof Error ? err.message : String(err)}`
        });
        failedAtStep = si.priority;
        failedTarget = si.originalText;
        failedReason = "click_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
      planSteps.push({
        index: planSteps.length + 1,
        action: "click",
        description: `Login: click submit`,
        target: { strategy: "login_resolver" as any, value: loginForm.submitButton.text, exact: false }
      });
    }

    await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
    const loginScan = await scanAndCollectObjects(page, si.priority, evidenceDir);
    currentSnapshot = loginScan.snapshot;
    allDiscoveredObjects.push(...loginScan.objects);

    steps.push({
      index: si.priority,
      action: si.originalText,
      status: "found",
      targetText: si.originalText,
      snapshotUrl: loginScan.url,
      snapshotTitle: loginScan.title,
      elementsFound: loginScan.elementsCount,
      evidencePath: path.join(evidenceDir, `step-${si.priority}-snapshot.json`)
    });

    console.log(`[discovery:case] Setup authentication completed successfully.`);
    console.log(`[discovery:case] authGateState after setupIntents: ${authGateState ? 'set' : 'not set'}`);
  }

  for (const orderedItem of orderedItems) {
    const sourceMetadata = orderedItem.type === "action"
      ? orderedItem.actionTarget
      : orderedItem.executableStep;
    activePlanInputMetadata = sourceMetadata ? {
      ...projectScenarioInputMetadata(sourceMetadata),
      ...(sourceMetadata.controlIdentity ? { controlIdentity: sourceMetadata.controlIdentity } : {}),
    } : {};
    const currentActionOrder = orderedItem.type === "action" && orderedItem.actionTarget
      ? actionOrderIndexByTarget.get(orderedItem.actionTarget)
      : undefined;

    if (!authGateState && shouldInvokeAuthGateRecovery(isAuthTest)) {
      const proactiveAuthCheck = await tryAuthGateRecovery(
        page,
        currentSnapshot,
        options,
        orderedItem.type === "action" ? orderedItem.actionTarget?.target : undefined
      );

      if (proactiveAuthCheck.diagnostics?.detected === true) {
        authGateDetectedDuringDiscovery = true;
        authGateDetectedAtStepIndex = orderedItem.index;
        if (typeof proactiveAuthCheck.diagnostics?.stage === "string") {
          authGateDetectedStage = proactiveAuthCheck.diagnostics.stage;
        }
      }

      // Gate observation is terminal: scenario.authIntent === "gate_observation"
      // means the scenario objective is to OBSERVE the auth gate, not to authenticate.
      // When tryAuthGateRecovery detected the gate, Discovery is satisfied and must stop.
      if (
        options.scenario.authIntent === "gate_observation" &&
        proactiveAuthCheck.recovered === true &&
        proactiveAuthCheck.diagnostics?.detected === true &&
        proactiveAuthCheck.diagnostics?.unresolved !== true
      ) {
        earlyCompletionSatisfied = true;
        console.log(`[discovery:case] Auth gate observed (gate_observation). Completing discovery early.`);

        const currentTarget = orderedItem.actionTarget?.target ?? orderedItem.navTarget?.target ?? (orderedItem.executableStep as any)?.target ?? "";
        const currentAction = orderedItem.actionTarget?.action ?? orderedItem.navTarget?.action ?? (orderedItem.executableStep as any)?.action ?? "";

        steps.push({
          index: orderedItem.index,
          action: currentAction,
          status: "found",
          targetText: currentTarget,
          assertionStatus: "passed",
          assertionClassification: "auth_gate_observed",
          matchedText: currentTarget,
          authGateDiagnostics: {
            detected: true,
            detectedBeforeStep: currentTarget,
            stage: proactiveAuthCheck.diagnostics?.stage ?? "unknown",
          },
        } as any);

        for (const rem of orderedItems) {
          if (rem.index <= orderedItem.index) continue;
          const remTarget = rem.actionTarget?.target ?? rem.navTarget?.target ?? (rem.executableStep as any)?.target ?? "";
          const remAction = rem.actionTarget?.action ?? rem.navTarget?.action ?? (rem.executableStep as any)?.action ?? "";
          steps.push({
            index: rem.index,
            action: remAction,
            status: "skipped_after_completion",
            targetText: remTarget,
            error: "Skipped due to auth gate observation (gate_observation).",
          } as any);
        }

        break;
      }

      // Check for post-auth transient unresolved (failure case)
      const isPostAuthTransientUnresolved =
        !proactiveAuthCheck.recovered && (
          (proactiveAuthCheck.diagnostics?.postAuthTransient === true &&
            proactiveAuthCheck.diagnostics?.unresolved === true) ||
          proactiveAuthCheck.diagnostics?.stage === "authenticated_transient_unresolved"
        );

      if (isPostAuthTransientUnresolved) {
        console.log(
          `[auth-resume] blocked reason=post_auth_transient_landing_unresolved ` +
          `url="${proactiveAuthCheck.diagnostics?.url}" urlChanged=${proactiveAuthCheck.diagnostics?.urlChanged}`
        );
        console.log(
          `[auth-resume] skipLegacyStableWait reason=post_auth_transient_landing_unresolved`
        );
        console.log(
          `[status-reconcile] evidenceStatus=Fallido caseFinished=failed reason=post_auth_transient_landing_unresolved`
        );

        // Throw error to fail the case - this prevents marking authGateState.completed
        throw new Error(
          `[auth-resume] blocked reason=post_auth_transient_landing_unresolved ` +
          `target="${orderedItem.type === 'action' ? orderedItem.actionTarget?.target : 'unknown'}" ` +
          `url="${proactiveAuthCheck.diagnostics?.url}"`
        );
      }

      if (!proactiveAuthCheck.recovered && proactiveAuthCheck.error?.includes("auth_not_completed")) {
        const blockedTarget = orderedItem.type === "action" ? orderedItem.actionTarget?.target : undefined;
        const blockedStage = proactiveAuthCheck.diagnostics?.stage ?? "unknown";
        console.log(
          `[auth-gate] functionalStepBlocked reason=auth_gate_still_active ` +
          `stage="${blockedStage}" target="${blockedTarget ?? "unknown"}"`
        );
        if (blockedStage === "otp") {
          console.log(`[auth-gate] continuingAuthFlow stage="otp"`);
        }
        throw new Error(
          `[auth-gate] functionalStepBlocked reason=auth_gate_still_active ` +
          `stage="${blockedStage}" target="${blockedTarget ?? "unknown"}"`
        );
      }

      if (proactiveAuthCheck.recovered && proactiveAuthCheck.diagnostics?.unresolved !== true) {
        console.log(`[discovery:case] Proactive auth gate recovery completed before step: ${orderedItem.type}`);
        authGateState = proactiveAuthCheck.authGateState;
        // Track when AuthGate was completed for later AuthFlow insertion
        if (authGateState && authGateState.completed && authGateCompletedAfterStepIndex === undefined) {
          // AuthFlow completed before this step - will be inserted after the previous executed step
          const lastExecutedStepIndex = executedStepIndices.size > 0
            ? Math.max(...Array.from(executedStepIndices))
            : 0;
          authGateCompletedAfterStepIndex = lastExecutedStepIndex;
          console.log(`[discovery:case] AuthGate completed after step index ${authGateCompletedAfterStepIndex} (proactive)`);

          // The AuthFlow was triggered proactively before executing the current step (orderedItem)
          // The step that triggered AuthGate is the PREVIOUS step (the one that was just executed)
          // Set insertion index to be AFTER the previous step
          if (orderedItem.type === "action" && orderedItem.actionTarget) {
            // The previous step is the one that triggered AuthGate
            // Use the actionTarget index - 1 to insert after the previous step
            authGateCompletedAfterStepIndex = orderedItem.actionTarget.index - 1;
            console.log(`[discovery:case] Updated AuthGate insertion index to ${authGateCompletedAfterStepIndex} (after previous step, current=${orderedItem.actionTarget.index}: ${orderedItem.actionTarget.target})`);
          } else {
            // For other types, use orderedItem index - 1
            authGateCompletedAfterStepIndex = orderedItem.index - 1;
            console.log(`[discovery:case] Updated AuthGate insertion index to ${authGateCompletedAfterStepIndex} (orderedItem.index - 1)`);
          }
        }
        const resumedTarget = orderedItem.type === "action" ? orderedItem.actionTarget?.target : undefined;
        const skipLongStableWait = proactiveAuthCheck.diagnostics?.resolved === true ||
          proactiveAuthCheck.diagnostics?.stage === "authenticated_transient_resolved";
        if (skipLongStableWait && resumedTarget) {
          console.log(
            `[auth-resume] resumed=true target="${resumedTarget}" ` +
            `reason="${proactiveAuthCheck.diagnostics?.landingReason ?? "private_landing"}"`
          );
          await page.waitForTimeout(500).catch(() => {});
        } else {
          console.log(`[discovery:case] Waiting for stable page after AuthFlow...`);
        const stabilityResult = await waitForStablePageState(page, {
          timeoutMs: 20000,
          pollMs: 500,
          stableForMs: 1000,
          expectedLandingHints: [
            "transacciones y servicios",
            "transacciones y services",
            "selecciona la operación",
            "selecciona la operacion",
            "generar cartas"
          ]
        });
        console.log(`[discovery:case] Page stability: waited=${stabilityResult.waited}, reason=${stabilityResult.reason}, duration=${stabilityResult.durationMs}ms, ${safeUrlForLog(stabilityResult.finalUrl)}`);
        }
        const scan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
        currentSnapshot = scan.snapshot;
        allDiscoveredObjects.push(...scan.objects);
        if (skipLongStableWait && resumedTarget) {
          postResumeTargetContext = {
            target: resumedTarget,
            url: currentSnapshot.url,
            snapshot: currentSnapshot
          };
          const postResumeSummary = summarizeSnapshot(currentSnapshot);
          console.log(`[auth-resume] skipLongPostResumeWait reason=private_landing_resolved target="${resumedTarget}"`);
        console.log(`[auth-resume] postResumeFastScan target="${resumedTarget}" ${safeUrlForLog(currentSnapshot.url)}`);
          console.log(
            `[auth-resume] postResumeSnapshot target="${resumedTarget}" url="${currentSnapshot.url}" ` +
            `texts=${JSON.stringify(postResumeSummary.texts)} controls=${JSON.stringify(postResumeSummary.controls)}`
          );
        }
      }
    }

    const currentActionTarget = orderedItem.actionTarget;
    
    // Check if this step should be skipped because AuthFlow already handled it
    // Skip if we're on operations menu and the step is the landing target
    if (authGateState && orderedItem.type === "action" && orderedItem.actionTarget) {
      const targetText = orderedItem.actionTarget.target;
      const targetMetadata: any = orderedItem.actionTarget.metadata ?? orderedItem.actionTarget;
      const targetRole = String(targetMetadata.routeRole ?? targetMetadata.destinationRole ?? targetMetadata.targetRole ?? "").toLowerCase();
      const isLandingTarget = targetRole === "entry" || targetRole === "landing";
      const isOnOperationsMenu = authGateState.completed === true;
      
      console.log(`[discovery:case] Skip check: type=${orderedItem.type}, target=${targetText}, isLanding=${isLandingTarget}, isOnMenu=${isOnOperationsMenu}, ${safeUrlForLog(currentSnapshot.url)}`);
      
      if (isLandingTarget && isOnOperationsMenu) {
        console.log(`[discovery:case] Skipping step ${orderedItem.actionTarget.index} (${targetText}) - already on landing page after AuthFlow (${safeUrlForLog(currentSnapshot.url)})`);
        steps.push({
          index: orderedItem.actionTarget.index,
          action: orderedItem.actionTarget.action,
          status: "skipped",
          targetText: orderedItem.actionTarget.target,
          error: "Step consumed by AuthFlow navigation",
          recoveryStatus: "recovered",
          recoveredBy: "auth_flow"
        } as any);
        if (typeof currentActionOrder === "number") {
          skippedActionOrders.add(currentActionOrder);
        }
        // Skip adding to planSteps - AuthFlow already handled this navigation
        continue;
      }
    }

    if (currentActionTarget && authGateState && shouldSkipStepAsAuthConsumed(currentActionTarget.target, authGateState)) {
      console.log(`[discovery:case] Skipping auth-consumed step: ${currentActionTarget.target}`);
      authGateState.skippedAuthSteps.push({
        target: currentActionTarget.target,
        reason: "consumed_by_auth_flow"
      });
      steps.push({
        index: currentActionTarget.index,
        action: currentActionTarget.action,
        status: "skipped",
        targetText: currentActionTarget.target,
        error: `Step consumed by AuthFlow authentication.`,
        recoveryStatus: "recovered",
        recoveredBy: "auth_flow",
        authGateDiagnostics: {
          detected: true,
          detectedBeforeStep: currentActionTarget.target,
          stage: authGateState.stagesCompleted[0],
          requiredInputs: authGateState.consumedAuthTargets,
          completedBy: "AuthFlowRunner",
          maskedInputs: {}
        }
      } as any);
      if (typeof currentActionOrder === "number") {
        skippedActionOrders.add(currentActionOrder);
      }

      // Task 3: Log that auth consumed only the login, next pending target remains
      const nextPendingItems = orderedItems.filter((item, idx) =>
        orderedItems.indexOf(currentActionTarget) < idx &&
        item.type === "action" &&
        item.actionTarget
      );
      const nextPendingTarget = nextPendingItems[0]?.actionTarget?.target;
      if (nextPendingTarget) {
        console.log(`[auth-gate] authConsumed=true nextPendingTarget="${nextPendingTarget}"`);
      }

      planSteps.push({
        index: planSteps.length + 1,
        action: "click",
        description: `AuthFlow handled: ${currentActionTarget.target}`,
        target: { strategy: "text", value: currentActionTarget.target, exact: false }
      });
      continue;
    }

    if (orderedItem.type === "assertion") {
      const es = orderedItem.executableStep!;
      if (es.isOptional) {
        console.log(`[discovery:case] Skipping optional assertion: ${es.target}`);
        steps.push({
          index: es.stepIndex,
          action: es.originalText,
          status: "skipped",
          targetText: es.target,
          error: `Optional assertion skipped.`
        });
        continue;
      }

      // Wait for page stability before evaluating assertion after transition
      const lastActionStep = steps.filter(s => 
        s.status === "found" || s.status === "satisfied_by_children" || s.status === "click_no_transition"
      ).pop();
      const isAfterTransition = lastActionStep && lastActionStep.recoveryMetadata?.transitionDetected === true;
      
      let stabilityDiagnostics: Record<string, unknown> | undefined;
      let snapshotForAssertion = currentSnapshot;
      
      if (isAfterTransition) {
        console.log(`[discovery:case] Waiting for stable page before assertion target="${es.target}"`);
        const stabilityStart = Date.now();
        
        try {
          const stabilityResult = await waitForStablePageState(page, {
            timeoutMs: 10000,
            pollMs: 500,
            stableForMs: 800
          });
          
          stabilityDiagnostics = {
            waited: true,
            reason: stabilityResult.finalStable ? "stabilized" : "timeout",
            durationMs: Date.now() - stabilityStart,
            finalUrl: stabilityResult.finalUrl,
            finalStable: stabilityResult.finalStable,
            transientDetections: stabilityResult.transientDetections?.length ?? 0
          };
          
          console.log(`[discovery:case] Assertion page stability: waited=true reason="${stabilityDiagnostics.reason}" durationMs=${stabilityDiagnostics.durationMs}`);
          
          // Refresh snapshot after stability
          snapshotForAssertion = await scanCurrentPage(page);
          console.log(`[discovery:case] Assertion snapshot refreshed target="${es.target}" visibleButtons=${snapshotForAssertion.elements.filter(e => e.role === "button" && e.visible).length} visibleHeadings=${snapshotForAssertion.elements.filter(e => e.type === "heading" && e.visible).length}`);
        } catch (stabilityError) {
          console.warn(`[discovery:case] Stability wait failed: ${stabilityError instanceof Error ? stabilityError.message : stabilityError}`);
          stabilityDiagnostics = {
            waited: true,
            reason: "error",
            error: stabilityError instanceof Error ? stabilityError.message : String(stabilityError),
            durationMs: Date.now() - stabilityStart
          };
        }
      }

      // Assertion retry mechanism
      const ASSERTION_RETRY_COUNT = 3;
      const ASSERTION_RETRY_INTERVAL_MS = 500;
      let resolutionResults: ReturnType<typeof resolveAssertionTargets> | undefined;
      let retryCount = 0;
      let lastFailureReason: string | undefined;
      const assertionTargetInputs: AssertionTargetInput[] = [{
        index: es.stepIndex,
        action: es.originalText,
        target: es.target ?? "",
        source: "action",
        ...(es.requirementRefs ? { requirementRefs: [...es.requirementRefs] } : {}),
        ...(es.canonicalAssertion ? { canonicalAssertion: es.canonicalAssertion } : {}),
        ...(es.canonicalAssertion ? { subjectControlIdentity: resolveRuntimeSubjectIdentity({
          index: es.stepIndex,
          action: es.originalText,
          target: es.target ?? "",
          source: "action",
          ...(es.requirementRefs ? { requirementRefs: [...es.requirementRefs] } : {}),
          canonicalAssertion: es.canonicalAssertion,
        }) } : {}),
        ...(es.entityScope ? { entityScope: es.entityScope } : {}),
        ...(es.rowScope !== undefined ? { rowScope: es.rowScope } : {}),
        ...(es.rowRelation ? { rowRelation: es.rowRelation } : {}),
        ...(es.expectedValueKey ? { expectedValueKey: es.expectedValueKey } : {}),
        ...(es.triggerStepIndex !== undefined ? { triggerStepIndex: es.triggerStepIndex } : {}),
      }];
      const rowScopedInput = assertionTargetInputs.find((input) => input.rowScope !== undefined && input.expectedValueKey);
      const containmentInput = assertionTargetInputs.find((input) => input.canonicalAssertion?.oracleType === "entity_within_container");
      const structuralRowInput = assertionTargetInputs.find((input) => input.canonicalAssertion?.oracleType === "structural_row_count");
      const exactStructuredAssertion = Boolean(rowScopedInput || containmentInput || structuralRowInput);

      while (retryCount < ASSERTION_RETRY_COUNT) {
        const executedActionsForAssertions = steps
          .filter((step) =>
            step.status === "found" ||
            step.status === "satisfied_by_children" ||
            step.status === "satisfied_by_previous_assertion"
          )
          .map((step) => ({
            action: step.action,
            target: step.targetText ?? "",
            status: "found" as const
          }));

        if (containmentInput) {
          const keys = [...containmentInput.target.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim()).filter(Boolean);
          const values = keys.map((key) => {
            const entry = (options.runtimeEntries ?? []).find((candidate) => candidate.key.trim().toLowerCase() === key.toLowerCase());
            const resolved = entry ? resolveDataKey(key, {
              testData: testData ?? {},
              env: Object.fromEntries(Object.entries(options.env ?? {}).filter(([, value]) => typeof value === "string")) as Record<string, string>,
              missingInputBehavior: options.missingInputBehavior ?? "fail",
              autoGenerateConfig: { enabled: false, generateSensitiveData: false, profile: "qa" },
              runtimeEntries: options.runtimeEntries,
            }) : undefined;
            return { entry, resolved };
          });
          resolutionResults = [await resolveEntityWithinContainerAssertion(page, containmentInput, {
            entityValue: values[0]?.resolved?.status === "resolved" ? values[0].resolved.value : undefined,
            containerValue: values[1]?.resolved?.status === "resolved" ? values[1].resolved.value : undefined,
            entitySource: values[0]?.resolved?.source,
            containerSource: values[1]?.resolved?.source,
            entityVerified: values[0]?.entry ? values[0].entry.generated !== true && values[0].entry.verified !== false : undefined,
            containerVerified: values[1]?.entry ? values[1].entry.generated !== true && values[1].entry.verified !== false : undefined,
          })];
        } else if (rowScopedInput) {
          const expectedEntry = (options.runtimeEntries ?? []).find((entry) =>
            entry.key.trim().toLowerCase() === rowScopedInput.expectedValueKey!.trim().toLowerCase(),
          );
          const expectedResolution = expectedEntry
            ? resolveDataKey(rowScopedInput.expectedValueKey!, {
                testData: testData ?? {},
                env: Object.fromEntries(Object.entries(options.env ?? {}).filter(([, value]) => typeof value === "string")) as Record<string, string>,
                missingInputBehavior: options.missingInputBehavior ?? "fail",
                autoGenerateConfig: { enabled: false, generateSensitiveData: false, profile: "qa" },
                runtimeEntries: options.runtimeEntries,
              })
            : undefined;
          resolutionResults = [await resolveRowScopedAssertion(page, rowScopedInput, {
            expectedValue: expectedResolution?.status === "resolved" ? expectedResolution.value : undefined,
            expectedValueSource: expectedResolution?.source,
            expectedValueVerified: expectedEntry
              ? expectedEntry.verified !== undefined
                ? expectedEntry.verified !== false && expectedEntry.generated !== true
                : expectedEntry.generated !== true && !/synthetic|generated|suggested|demo|default|autogenerated/i.test(expectedEntry.source ?? "")
              : undefined,
          })];
        } else if (structuralRowInput) {
          resolutionResults = [await resolveStructuralRowAssertion(page, structuralRowInput)];
        } else {
          resolutionResults = resolveAssertionTargets(snapshotForAssertion, assertionTargetInputs, {
            executedActions: executedActionsForAssertions,
            appConfig: (options as any).appConfig
          });
        }
        
        // Check if any assertion passed
        const anyPassed = resolutionResults.some(r => r.status === "passed" || r.status === "satisfied_by_children" || r.status === "satisfied_by_previous_assertion");
        
        // Semantic assertion pre-check: resolve by DOM signal before falling back to text matching
        if (!anyPassed && resolutionResults.length > 0 && !exactStructuredAssertion) {
          for (const r of resolutionResults) {
            if (r.status === "failed" || r.status === "needs_assertion_resolution") {
              try {
                const { resolveSemanticAssertion } = await import("../runner/semantic-assertion");
                const result = await resolveSemanticAssertion(page, r.assertionText);
                if (result === "passed") {
                  r.status = "passed";
                  r.reason = "semantic_dom_signal";
                  console.log(`[assertion-semantic] intent=selection_confirmation result=passed reason=semantic_dom_signal text="${r.assertionText.slice(0,60)}"`);
                } else if (result === "not_found") {
                  console.log(`[assertion-semantic] intent=selection_confirmation result=failed reason=no_selection_signal text="${r.assertionText.slice(0,60)}"`);
                }
              } catch { /* semantic resolver not available in this context */ }
            }
          }
        }
        
        if (anyPassed) {
          break; // Success, no need to retry
        }
        
        // Track failure for diagnostics
        const failedAssertions = resolutionResults.filter(r => r.status === "failed" || r.status === "needs_assertion_resolution");
        if (failedAssertions.length > 0) {
          lastFailureReason = failedAssertions[0].reason;
        }
        
        // Retry if not last attempt and assertion failed
        if (retryCount < ASSERTION_RETRY_COUNT - 1 && !anyPassed) {
          console.log(`[discovery:case] Assertion retry ${retryCount + 1}/${ASSERTION_RETRY_COUNT} target="${es.target}" reason="${lastFailureReason}"`);
          await new Promise(resolve => setTimeout(resolve, ASSERTION_RETRY_INTERVAL_MS));
          
          // Refresh snapshot for retry
          try {
            snapshotForAssertion = await scanCurrentPage(page);
          } catch (scanError) {
            console.warn(`[discovery:case] Snapshot refresh failed: ${scanError instanceof Error ? scanError.message : scanError}`);
          }
          
          retryCount++;
        } else {
          break;
        }
      }
      
      // resolutionResults should always be defined after the loop
      if (!resolutionResults) {
        console.error(`[discovery:case] Assertion resolution failed to produce results target="${es.target}"`);
        resolutionResults = [];
      }
      
      for (const assertionResult of resolutionResults) {
        const runtimeAssertionInput = assertionTargetInputs.find((input) => input.index === es.stepIndex);
        const canonicalRuntimeBinding = runtimeAssertionInput?.canonicalAssertion
          ? {
              received: true,
              requirementRefs: runtimeAssertionInput.requirementRefs ?? [],
              intent: runtimeAssertionInput.canonicalAssertion.intent,
              subjectControlIdentity: runtimeAssertionInput.subjectControlIdentity,
            }
          : undefined;
        if (canonicalRuntimeBinding) {
          console.log(
            `[canonical-runtime-binding] scenarioStepIndex=${es.stepIndex} received=true `
              + `requirementRefs=${canonicalRuntimeBinding.requirementRefs.length} `
              + `intent=${canonicalRuntimeBinding.intent} subjectLineage=${canonicalRuntimeBinding.subjectControlIdentity ? "available" : "unavailable"}`,
          );
        }
        const mappedStatus: DiscoveryStepResult["status"] =
          assertionResult.status === "passed"
            ? "found"
            : assertionResult.status === "satisfied_by_children"
              ? "satisfied_by_children"
              : assertionResult.status === "skipped_semantic_descriptor"
                ? "skipped_semantic_descriptor"
                : assertionResult.status === "needs_assertion_resolution"
                  ? "needs_assertion_resolution"
                  : assertionResult.status === "optional_confirmation_detail_missing"
                    ? "optional_confirmation_detail_missing"
                    : assertionResult.status === "satisfied_by_previous_assertion"
                      ? "satisfied_by_previous_assertion"
                      : assertionResult.status === "precondition_unresolved"
                        ? "precondition_unresolved"
                        : "not_found";

        // Determine error message based on status
        let errorMessage: string | undefined = undefined;
        if (assertionResult.status === "failed" || assertionResult.status === "needs_assertion_resolution") {
          errorMessage = assertionResult.reason;
        } else if (assertionResult.status === "optional_confirmation_detail_missing") {
          errorMessage = `Optional confirmation detail: ${assertionResult.reason}`;
        } else if (assertionResult.status === "precondition_unresolved") {
          errorMessage = `Precondition not met: ${assertionResult.reason}`;
        }

        // Build comprehensive diagnostics for assertion
        const assertionDiag: Record<string, unknown> = {
          ...assertionResult.assertionDiagnostics
        };
        
        // Add stability diagnostics
        if (stabilityDiagnostics) {
          assertionDiag.stability = stabilityDiagnostics;
        }
        
        // Add retry diagnostics
        if (retryCount > 0 || lastFailureReason) {
          assertionDiag.retry = {
            count: retryCount,
            maxAttempts: ASSERTION_RETRY_COUNT,
            lastFailureReason: lastFailureReason
          };
        }
        
        // Add back/return alias diagnostics if present
        if (assertionResult.matchReason?.includes("alias") || assertionResult.originalTarget) {
          assertionDiag.backReturnAlias = {
            originalTarget: assertionResult.originalTarget || es.target,
            matchedTarget: assertionResult.matchedTarget,
            matchReason: assertionResult.matchReason,
            aliasResolverUsed: true
          };
        }

        const precedingActionIndex = typeof es.triggerStepIndex === "number"
          ? es.triggerStepIndex
          : Math.max(...[...executedStepIndices].filter((index) => index < es.stepIndex), -1);
        const runtimeFillObservation = [...assertionObservations].reverse().find((observation) =>
          observation.triggerActionIdentity.stepIndex === precedingActionIndex
            && observation.mutation.changed
            && (observation.network.eventCount > 0 || observation.mutation.navigationMutation),
        );
        const runtimeObservationFound = assertionResult.reason === "row_scoped_requires_runtime_observation"
          && Boolean(runtimeFillObservation);
        if (runtimeObservationFound) {
          assertionDiag.runtimeObservation = {
            observed: true,
            triggerStepIndex: precedingActionIndex,
            mutation: runtimeFillObservation!.mutation,
            networkEventCount: runtimeFillObservation!.network.eventCount,
          };
        }

        steps.push({
          index: es.stepIndex,
          action: es.originalText,
          status: mappedStatus,
          targetText: assertionResult.assertionText,
          evidencePath: path.join(evidenceDir, `step-${es.stepIndex}-assertion.json`),
          assertionClassification: assertionResult.classification,
          assertionStatus: assertionResult.status,
          matchedText: assertionResult.matchedText,
          confidence: assertionResult.confidence,
          error: errorMessage,
          closestCandidates: assertionResult.closestCandidates,
          visibleTexts: assertionResult.visibleTexts,
          descriptorTypes: assertionResult.descriptorTypes,
          subject: assertionResult.subject,
          matchedTokens: assertionResult.matchedTokens,
          structuralSignals: assertionResult.structuralSignals,
          childAssertionsUsed: assertionResult.childAssertionsUsed,
          assertionDiagnostics: {
            ...assertionDiag,
            ...(canonicalRuntimeBinding ? { canonicalRuntimeBinding } : {}),
          },
          ...(runtimeAssertionInput?.requirementRefs?.length
            ? { canonicalRequirementRefs: runtimeAssertionInput.requirementRefs.map((requirementId) => ({ requirementId })) }
            : {}),
          ...(runtimeAssertionInput?.canonicalAssertion
            ? { canonicalAssertion: runtimeAssertionInput.canonicalAssertion } as any
            : {})
        });

        if (isPendingOracleAuthority({ reason: assertionResult.reason })) {
          const pendingOracleStep = steps[steps.length - 1] as any;
          pendingOracleStep.oracleStatus = "pending_authority";
          pendingOracleStep.validationBlocker = true;
          pendingOracleStep.pendingDiscovery = true;
          pendingOracleStep.functionalRequired = false;
          pendingOracleStep.assertionImportance = "contextual";
          pendingOracleStep.recoveryMetadata = {
            ...(pendingOracleStep.recoveryMetadata ?? {}),
            blocking: false,
            reason: "oracle_authority_pending",
          };
          console.log(`[oracle-authority] status=pending_authority validationBlocker=true executionBlocker=false key=${runtimeAssertionInput?.expectedValueKey ?? "unresolved"}`);
          continue;
        }

        if (assertionResult.status === "passed" && assertionResult.classification === "literal_observable") {
          planSteps.push({
            index: planSteps.length + 1,
            action: "assertText",
            description: `Assert: ${assertionResult.assertionText}`,
            target: { strategy: "text", value: assertionResult.assertionText, exact: false },
            expected: assertionResult.assertionText
          });
        } else if (assertionResult.status === "failed" || assertionResult.status === "needs_assertion_resolution") {
          // ── LOCAL ASSERTION RECOVERY ──
          // Try to recover failed assertion using accent-insensitive matching, aliases, plural/singular variants, etc.
          const recoveryResult = exactStructuredAssertion
            ? { recovered: false, decision: "not_recovered" as const, matchedText: "", confidence: 0, recoveryAttempts: [] }
            : attemptAssertionRecovery(currentSnapshot, assertionResult.assertionText, {
                routeProfile,
                appConfig: (options as any).appConfig,
                scenarioTitle: scenario.title,
                expectedResult: (scenario as any).expectedResult ?? "",
              });

            const canonicalMetadata = getCanonicalAssertionMetadata(scenario, es.stepIndex);
            const observableAuthority = hasObservableAssertionAuthority({
              canonicalRequirementRefs: canonicalMetadata.refs,
              assertionDiagnostics: assertionResult.assertionDiagnostics,
            });

           // Structured canonical requirements own requiredness. Runtime backing
           // is tracked separately and must never downgrade a required claim.
           let assertionImportance = classifyAssertionImportance(assertionResult.assertionText, {
            scenarioTitle: scenario.title,
            expectedResult: (scenario as any).expectedResult ?? "",
            routeProfile,
          });

          // Detect conditional assertion risk
          const conditionalRisk = detectConditionalAssertionRisk(assertionResult.assertionText, {
            dataRequirement: (scenario as any).dataRequirement,
            routeProfile,
          });

           const recoveryMatchesSameAssertion = recoveryResult.recovered
             && normalizeText(recoveryResult.matchedText ?? "") === normalizeText(assertionResult.assertionText);

           if (recoveryMatchesSameAssertion && (!canonicalMetadata.required || recoveryMatchesSameAssertion)) {
            console.log(`[assertion-recovery] recovered "${assertionResult.assertionText}" -> "${recoveryResult.matchedText}" decision=${recoveryResult.decision} confidence=${recoveryResult.confidence}`);
            // Update step status to recovered
            steps[steps.length - 1].status = "found";
            steps[steps.length - 1].recoveryStatus = "recovered";
            (steps[steps.length - 1] as any).recoveredBy = "local_assertion_recovery";
            (steps[steps.length - 1] as any).recoveryDecision = recoveryResult.decision;
            (steps[steps.length - 1] as any).recoveryAttempts = recoveryResult.recoveryAttempts;
            (steps[steps.length - 1] as any).recoveryConfidence = recoveryResult.confidence;
            (steps[steps.length - 1] as any).matchedText = recoveryResult.matchedText;
             (steps[steps.length - 1] as any).assertionImportance = assertionImportance;
             (steps[steps.length - 1] as any).functionalRequired = canonicalMetadata.required;
             (steps[steps.length - 1] as any).runtimeBacked = true;
             (steps[steps.length - 1] as any).canonicalRequirementRefs = canonicalMetadata.refs;
            (steps[steps.length - 1] as any).conditionalAssertion = conditionalRisk.isConditional;
            (steps[steps.length - 1] as any).conditionalRisk = conditionalRisk.risk;
            // Clear failure markers
            if (failedAtStep === es.stepIndex) {
              failedAtStep = undefined;
              failedTarget = undefined;
              failedReason = undefined;
            }
          } else {
            // Not recovered - set failure metadata
            (steps[steps.length - 1] as any).recoveryAttempts = recoveryResult.recoveryAttempts;
            (steps[steps.length - 1] as any).assertionImportance = assertionImportance;
            (steps[steps.length - 1] as any).conditionalAssertion = conditionalRisk.isConditional;
            (steps[steps.length - 1] as any).conditionalRisk = conditionalRisk.risk;
            (steps[steps.length - 1] as any).conditionalReason = conditionalRisk.reason;

            // isBlockingRequirement: contract marked this assertion as functionally important
            // hasObservableBacking: real observable evidence exists — NOT derived from assertionImportance
            // runtimeFound: resolver found matching text/tokens during execution
             const authGateAuthority = authGateDetectedDuringDiscovery
               && /\b(auth|autentic|identific|otp|flujo)\b/i.test(normalizeText(assertionResult.assertionText));
             const isBlockingRequirement = assertionImportance === "blocking"
               && (observableAuthority || authGateAuthority);

            const hasObservableBacking =
              (assertionResult.structuralSignals?.length ?? 0) > 0 ||
              assertionResult.classification === "literal_observable" ||
              assertionResult.classification === "structural_assertion" ||
              assertionResult.isWeakSignal === false ||
              (() => {
                if (!routeProfile) return false;
                const rp = routeProfile as unknown as Record<string, unknown>;
                const lower = assertionResult.assertionText.toLowerCase();
                const controls = rp.visibleControls;
                if (Array.isArray(controls) && (controls as string[]).some((c: string) => lower.includes(c.toLowerCase()))) return true;
                return false;
              })();

             const runtimeFound =
              assertionResult.matchedText != null ||
              (assertionResult.matchedTokens?.length ?? 0) > 0 ||
              runtimeObservationFound;

             const functionalRequired =
               (observableAuthority || authGateAuthority) && (canonicalMetadata.required || isBlockingRequirement)
               || assertionRequiresAuthCompletion(assertionResult.assertionText);
             (steps[steps.length - 1] as any).functionalRequired = functionalRequired;
             (steps[steps.length - 1] as any).runtimeBacked = hasObservableBacking;
             (steps[steps.length - 1] as any).canonicalRequirementRefs = canonicalMetadata.refs;

             console.log(`[assertion-contract] target="${assertionResult.assertionText}" blocking=${isBlockingRequirement}`);
             console.log(`[assertion-backing] target="${assertionResult.assertionText}" backed=${hasObservableBacking} source=${hasObservableBacking ? "structural" : "none"}`);
             console.log(`[assertion-requiredness] target="${assertionResult.assertionText}" functionalRequired=${functionalRequired} observableAuthority=${observableAuthority} runtimeBacked=${hasObservableBacking} canonical=${canonicalMetadata.refs.length > 0}`);
            console.log(`[assertion-runtime] target="${assertionResult.assertionText}" found=${runtimeFound} observationBacked=${runtimeObservationFound}`);

            if (runtimeFound) {
              console.log(`[assertion-decision] target="${assertionResult.assertionText}" result=passed runtimeFound=true`);
              const currentAssertion = steps[steps.length - 1] as any;
              if (runtimeObservationFound && currentAssertion) {
                currentAssertion.status = "found";
                currentAssertion.assertionStatus = "passed";
                currentAssertion.error = undefined;
                currentAssertion.pendingDiscovery = false;
                currentAssertion.runtimeBacked = true;
                currentAssertion.recoveryStatus = "recovered";
                currentAssertion.recoveredBy = "runtime_observation";
                currentAssertion.recoveryMetadata = {
                  ...(currentAssertion.recoveryMetadata ?? {}),
                  blocking: false,
                  recoveredBecause: "row_scoped_runtime_observation",
                  triggerStepIndex: precedingActionIndex,
                };
              }
              const reconciled = reconcileAssertionFailuresAfterPass(steps, {
                index: es.stepIndex,
                action: "assert",
                status: "found",
                assertionStatus: "passed",
                targetText: assertionResult.assertionText,
              });
              console.log(`[assertion-final-pass-reconciliation] stepIndex=${es.stepIndex} matchedFailures=${reconciled} reconciled=${reconciled}`);
            } else if (isBlockingRequirement && hasObservableBacking) {
              console.log(`[assertion-decision] target="${assertionResult.assertionText}" result=failed blocking=true backed=true runtimeFound=false`);
             } else if (functionalRequired && !hasObservableBacking) {
               console.log(`[assertion-decision] target="${assertionResult.assertionText}" result=discovery_required blocking=true backed=false runtimeFound=false`);
               assertionImportance = "blocking";
               (steps[steps.length - 1] as any).assertionImportance = "blocking";
               (steps[steps.length - 1] as any).pendingDiscovery = true;
               (steps[steps.length - 1] as any).recoveryMetadata = { ...(steps[steps.length - 1] as any).recoveryMetadata, blocking: true };
               console.log(`[assertion-failure-record] target="${assertionResult.assertionText}" blocking=true importance=blocking pendingDiscovery=true reason=observable_assertion_requires_discovery`);
            } else {
              console.log(`[assertion-decision] target="${assertionResult.assertionText}" result=contextual blocking=false runtimeFound=false`);
              assertionImportance = "contextual";
              (steps[steps.length - 1] as any).assertionImportance = "contextual";
              (steps[steps.length - 1] as any).pendingDiscovery = true;
              console.log(`[assertion-failure-record] target="${assertionResult.assertionText}" blocking=false importance=contextual pendingDiscovery=true reason=observable_assertion_requires_discovery`);
            }

            if (assertionImportance === "blocking" && !conditionalRisk.isConditional) {
              if (!failedAtStep && es.source === "action") {
                failedAtStep = es.stepIndex;
                failedTarget = assertionResult.assertionText;
                failedReason = "assertion_not_found_unrecovered";
              }
            } else if (conditionalRisk.isConditional && conditionalRisk.risk === "high") {
              if (!failedAtStep && es.source === "action") {
                failedAtStep = es.stepIndex;
                failedTarget = assertionResult.assertionText;
                failedReason = "conditional_assertion_without_data";
              }
            } else if (assertionImportance === "contextual" || assertionImportance === "optional") {
              console.log(`[assertion-recovery] non-blocking assertion "${assertionResult.assertionText}" importance=${assertionImportance} - not failing scenario`);
            }

            // AI Repair for assertions: attempt assertion_resolution after local recovery fails
            if (assertionResult.status === "needs_assertion_resolution" && envTrue("AI_REPAIR_ENABLED", false) && envTrue("AI_REPAIR_USE_CONTEXT_PACK", true)) {
            const aiAssertionStartTime = Date.now();
            console.log(`[ai-repair:assertion] enabled provider=${process.env.AI_PROVIDER ?? "unknown"} model=${process.env.AI_MODEL ?? "unknown"}`);
            console.log(`[ai-repair:assertion] failure=assertion_not_satisfied target="${assertionResult.assertionText}"`);

            // Build evidence candidates from assertion resolution result
            const evidenceCandidates = [
              ...(assertionResult.visibleTexts?.map((t: string, i: number) => ({
                evidenceId: `ev-text-${i}`,
                type: "text_visible" as const,
                text: t,
                visible: true,
                source: "runtimeEvidenceTrace" as const,
                confidence: 0.8,
                sensitive: false
              })) ?? []),
              ...(assertionResult.closestCandidates?.map((c: any, i: number) => ({
                evidenceId: `ev-candidate-${i}`,
                type: "structural" as const,
                text: c.text ?? c.name ?? c.label,
                visible: c.visible ?? true,
                source: "structuralEvidence" as const,
                confidence: c.confidence ?? 0.7,
                sensitive: false
              })) ?? [])
            ];

            console.log(`[ai-repair:assertion] context evidenceCandidates=${evidenceCandidates.length}`);

            const aiAssertionRepair = await runAiRepairOrchestrator({
              appSlug: discoveryAppSlug,
              failure: "assertion_not_satisfied",
              failureType: "assertion_not_satisfied",
              currentStep: es.originalText,
              currentUrl: page.url(),
              snapshotSummary: {
                title: currentSnapshot.title,
                url: currentSnapshot.url,
                summary: currentSnapshot.summary
              },
              candidates: currentSnapshot.elements.map((el) => ({
                candidateId: el.id,
                role: el.role,
                name: el.name,
                text: el.text,
                visible: Boolean(el.visible),
                enabled: isSnapshotElementEnabled(el),
                clickable: isSnapshotElementClickable(el),
                editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
                sensitive: false
              })),
              runtimeEvidenceTrace: { matchedText: assertionResult.matchedText, confidence: assertionResult.confidence },
              structuralEvidence: assertionResult.structuralSignals,
              feedbackEvidence: steps.slice(-5).map((s) => ({ index: s.index, status: s.status, targetText: s.targetText })),
              pendingAssertions: [assertionResult.assertionText],
              previousActions: steps.filter((s) => s.targetText).map((s) => `${s.action}: ${s.targetText}`),
              previousFills: planSteps.filter((s) => s.action === "fill").map((s) => `${s.description ?? "fill"}:${(s as any).valueKey ?? ""}`),
              constraints: [
                "must_use_existing_evidence_id",
                "no_invented_text",
                "no_selector_invention",
                "no_sensitive_evidence"
              ],
              assertionTarget: assertionResult.assertionText,
              assertionText: assertionResult.assertionText,
              evidenceCandidates,
              currentScreen: {
                url: currentSnapshot.url,
                title: currentSnapshot.title,
                visibleTextSummary: assertionResult.visibleTexts,
                visibleDialogs: [],
                visibleForms: []
              }
            });
            const aiAssertionDuration = Date.now() - aiAssertionStartTime;

            console.log(`[ai-repair:assertion] decision=status ${aiAssertionRepair.status}`);
            console.log(`[ai-repair:assertion] validated=${aiAssertionRepair.status === "repaired_plan" || aiAssertionRepair.status === "no_safe_action" || aiAssertionRepair.status === "needs_more_context"}`);

            // Build comprehensive diagnostics for artifact
            const aiAssertionDiagnostics = {
              enabled: true,
              providerName: aiAssertionRepair.diagnostics.provider ?? "unknown",
              model: process.env.AI_MODEL ?? "unknown",
              failureType: "assertion_not_satisfied",
              assertionTarget: assertionResult.assertionText,
              contextPackSummary: {
                evidenceCandidateCount: evidenceCandidates.length,
                hasSecrets: false,
                maxContextChars: 30000
              },
              decisionStatus: aiAssertionRepair.status,
              validationStatus: aiAssertionRepair.status === "invalid_response" ? "invalid" : aiAssertionRepair.status === "provider_error" ? "error" : "valid",
              selectedEvidenceId: aiAssertionRepair.decision?.evidenceId ?? null,
              evidenceType: aiAssertionRepair.diagnostics.evidenceType ?? null,
              assertionStatus: aiAssertionRepair.decision?.assertionStatus ?? null,
              blockedReason: aiAssertionRepair.diagnostics.errorCode ?? null,
              durationMs: aiAssertionDuration
            };

            (assertionResult as any).aiRepairDiagnostics = aiAssertionDiagnostics;

            // If AI found existing evidence that satisfies assertion, mark as satisfied
            if (aiAssertionRepair.status === "repaired_plan" && aiAssertionRepair.decision?.evidenceId && aiAssertionRepair.decision.assertionStatus === "satisfied_by_existing_evidence") {
              console.log(`[ai-repair:assertion] assertion satisfied by existing evidence: ${aiAssertionRepair.decision.evidenceId}`);
              // Update step status to reflect AI resolution
              steps[steps.length - 1].status = "found";
              steps[steps.length - 1].recoveryStatus = "recovered";
              (steps[steps.length - 1] as any).recoveredBy = "ai_repair";
              (steps[steps.length - 1] as any).aiAssertionDiagnostics = aiAssertionDiagnostics;
              // Clear the failedAtStep marker since assertion was resolved
              if (failedAtStep === es.stepIndex) {
                failedAtStep = undefined;
                failedTarget = undefined;
                failedReason = undefined;
              }
            } else {
              console.log(`[ai-repair:assertion] no safe action or needs more context for assertion`);
              (steps[steps.length - 1] as any).aiAssertionDiagnostics = aiAssertionDiagnostics;
            }
          }
        }
      }
      continue;
    }

    }

    if (orderedItem.type === "nav_segment") {
      const nav = orderedItem.navTarget!;
      if (authGateState && shouldSkipStepAsAuthConsumed(nav.target, authGateState)) {
        console.log(`[discovery:case] Skipping auth-consumed nav segment: ${nav.target}`);
        authGateState.skippedAuthSteps.push({
          target: nav.target,
          reason: "consumed_by_auth_flow"
        });
        steps.push({
          index: orderedItem.index,
          action: nav.action,
          status: "skipped",
          targetText: nav.target,
          error: `Nav segment consumed by AuthFlow authentication.`,
          recoveryStatus: "recovered",
          recoveredBy: "auth_flow",
          authGateDiagnostics: {
            detected: true,
            detectedBeforeStep: nav.target,
            stage: authGateState.stagesCompleted[0],
            requiredInputs: authGateState.consumedAuthTargets,
            completedBy: "AuthFlowRunner",
            maskedInputs: {}
          }
        } as any);
        planSteps.push({
          index: planSteps.length + 1,
          action: "click",
          description: `AuthFlow handled: ${nav.target}`,
          target: { strategy: "text", value: nav.target, exact: false }
        });
        continue;
      }
      console.log(`[discovery:case] Resolving nav segment: ${nav.target}`);
      const navStability = await waitForStablePageState(page, { timeoutMs: 10000, pollMs: 500, stableForMs: 800 });
      if (navStability.waited) {
        console.log(`[discovery:case] Page stability wait before nav: reason=${navStability.reason}, duration=${navStability.durationMs}ms`);
        const scan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
        currentSnapshot = scan.snapshot;
      }
      const resolution = await resolveActionTarget(page, currentSnapshot, nav.target, { routeProfile });
      if (resolution.status !== "resolved" || !resolution.locator) {
        console.log(`[discovery:case] Nav segment not found: ${nav.target}`);

        const scan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const authRecovery = await tryAuthGateRecovery(page, currentSnapshot, options, nav.target);

        if (authRecovery.diagnostics?.detected === true) {
          authGateDetectedDuringDiscovery = true;
          authGateDetectedAtStepIndex = orderedItem.index;
          if (typeof authRecovery.diagnostics?.stage === "string") {
            authGateDetectedStage = authRecovery.diagnostics.stage;
          }
        }

        const unresolvedAuthRecovery =
          !authRecovery.recovered &&
          (authRecovery.diagnostics?.reason === "post_auth_transient_landing_unresolved" ||
            authRecovery.diagnostics?.stage === "authenticated_transient_unresolved");
        if (unresolvedAuthRecovery) {
          console.log(`[auth-resume] skipLegacyStableWait reason=post_auth_transient_landing_unresolved`);
          console.log(`[status-reconcile] evidenceStatus=Fallido caseFinished=failed reason=post_auth_transient_landing_unresolved`);
          throw new Error(`[auth-resume] blocked reason=post_auth_transient_landing_unresolved target="${nav.target}" ${safeUrlForLog(authRecovery.diagnostics?.url)}`);
        }

        // Check for blocking auth failures
        if (!authRecovery.recovered && authRecovery.error?.includes("auth_not_completed")) {
          const stage = authRecovery.diagnostics?.stage;
          const stuckReason = authRecovery.diagnostics?.stuckReason;
          console.log(`[auth-gate] blockingScenarioUntilAuthenticated target="${nav.target}" stage="${stage}" reason="${stuckReason}"`);
          steps.push({
            index: orderedItem.index,
            action: nav.action,
            status: "blocked",
            targetText: nav.target,
            error: `Scenario blocked: AuthGate not completed at stage ${stage} (${stuckReason}). Cannot continue to "${nav.target}".`
          });
          failedAtStep = orderedItem.index;
          failedTarget = nav.target;
          failedReason = "auth_not_completed";
          break;
        }

        if (authRecovery.recovered) {
          console.log(`[discovery:case] Auth gate recovery successful, retrying nav segment...`);
          if (authRecovery.authGateState) {
            authGateState = authRecovery.authGateState;
            // Track when AuthGate was completed for later AuthFlow insertion
            if (authGateState.completed && authGateCompletedAfterStepIndex === undefined) {
              // AuthFlow completed before this step - will be inserted after the previous executed step
              const lastExecutedStepIndex = executedStepIndices.size > 0
                ? Math.max(...Array.from(executedStepIndices))
                : 0;
              authGateCompletedAfterStepIndex = lastExecutedStepIndex;
              console.log(`[discovery:case] AuthGate completed after step index ${authGateCompletedAfterStepIndex}`);
            }
          }

          // Task 1: Detect auth completed by URL/screen
          const authCompletedUrl = page.url();
          const isPrivateMenu = /operations-menu|operaciones|transacciones.*servicios/i.test(authCompletedUrl);
          if (isPrivateMenu) {
            console.log(`[auth-flow] authenticated=true source=private_menu_detected ${safeUrlForLog(authCompletedUrl)}`);
          }

          // Task 4: Determine stage and whether to continue
          console.log(`[auth-gate] stageResolved stage=${isPrivateMenu ? "private_menu" : "unknown"} continue=${isPrivateMenu}`);

          // Task 2: Update snapshot after auth completes - resume scenario properly
          await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
          const authCompletedScan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
          currentSnapshot = authCompletedScan.snapshot;
          allDiscoveredObjects.push(...authCompletedScan.objects);

          console.log(`[auth-gate] completed, resuming scenario target="${nav.target}"`);
          console.log(`[discovery:case] Resuming after auth at step=${orderedItem.index} target="${nav.target}"`);

          const retryResolution = await resolveActionTarget(page, currentSnapshot, nav.target, { routeProfile });
          if (retryResolution.status === "resolved" && retryResolution.locator) {
            await clickResolvedTarget(retryResolution.locator, false);
            console.log(`[post-click-screenshot] waitingAfterClick step=${orderedItem.index} target="${nav.target}"`);
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            await page.waitForTimeout(1000);

            const postClickScan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
            currentSnapshot = postClickScan.snapshot;
            allDiscoveredObjects.push(...postClickScan.objects);

            // Capture evidence after click completes and page stabilizes
            await captureEvStep(nav.action, "passed");

            if (authGateState?.completed) {
              markFunctionalStepAfterAuth(nav.target, authGateState);
            }

            executedStepIndices.add(orderedItem.index);

            steps.push({
              index: orderedItem.index,
              action: nav.action,
              status: "found",
              targetText: nav.target,
              snapshotUrl: postClickScan.url,
              snapshotTitle: postClickScan.title,
              elementsFound: postClickScan.elementsCount,
              evidencePath: path.join(evidenceDir, `step-${orderedItem.index}-snapshot.json`)
            });

            planSteps.push({
              index: planSteps.length + 1,
              action: "click",
              description: nav.action,
              target: { strategy: "text", value: nav.target, exact: false }
            });
            continue;
          }
        }

        steps.push({
          index: orderedItem.index,
          action: nav.action,
          status: "not_found",
          targetText: nav.target,
          error: authRecovery.error
            ? `Nav segment target "${nav.target}" not found. Auth gate recovery attempted but failed: ${authRecovery.error}`
            : `Nav segment target "${nav.target}" not found`
        });
        failedAtStep = orderedItem.index;
        failedTarget = nav.target;
        failedReason = "target_not_found";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      await clickResolvedTarget(resolution.locator, false);
      await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });

      // Capture evidence after click completes and page stabilizes
      await captureEvStep(nav.action, "passed");

      const scan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
      currentSnapshot = scan.snapshot;
      allDiscoveredObjects.push(...scan.objects);

      if (authGateState?.completed) {
        markFunctionalStepAfterAuth(nav.target, authGateState);
      }

      executedStepIndices.add(orderedItem.index);

      steps.push({
        index: orderedItem.index,
        action: nav.action,
        status: "found",
        targetText: nav.target,
        snapshotUrl: scan.url,
        snapshotTitle: scan.title,
        elementsFound: scan.elementsCount,
        evidencePath: path.join(evidenceDir, `step-${orderedItem.index}-snapshot.json`)
      });

      planSteps.push({
        index: planSteps.length + 1,
        action: "click",
        description: nav.action,
        target: { strategy: "text", value: nav.target, exact: false }
      });
      continue;
    }

    const actionTarget = orderedItem.actionTarget;
    if (!actionTarget) {
      console.log(`[value-source] missing target context phase=action stepIndex=${orderedItem.index} targetText=none source=parser`);
      continue;
    }

    const normalizedActionTarget = normalizeParsedTarget<ActionTargetItem>(actionTarget);
    if (!normalizedActionTarget.target) {
      console.log(`[value-source] missing target context phase=action stepIndex=${orderedItem.index} targetText=none source=parser`);
      continue;
    }

    // Conditional actions are evaluated at runtime. They must never be routed
    // through assertion/noop handling or through unconditional dialog recovery.
    const conditionalAction = normalizedActionTarget.conditionalAction;
    if (conditionalAction) {
      const conditionResolution = await resolveActionTarget(page, currentSnapshot, conditionalAction.condition.target, { routeProfile });
      const conditionVisible = conditionResolution.status === "resolved"
        && Boolean(conditionResolution.locator)
        && await conditionResolution.locator!.isVisible().catch(() => false);
      if (!conditionVisible) {
        console.log(`[conditional-action] stepIndex=${orderedItem.index} operation=${conditionalAction.operation} status=conditional_skipped conditionType=${conditionalAction.condition.type}`);
        steps.push({
          index: orderedItem.index,
          action: actionTarget.action,
          status: "skipped",
          targetText: normalizedActionTarget.target,
          snapshotUrl: page.url(),
          snapshotTitle: await page.title().catch(() => ""),
          elementsFound: 0,
          error: "conditional_skipped"
        } as any);
        planSteps.push({
          index: planSteps.length + 1,
          action: conditionalAction.operation,
          description: actionTarget.action,
          target: { strategy: "text", value: conditionalAction.actionTarget, exact: false },
          optional: true,
          conditionalAction
        });
        continue;
      }

      const actionResolution = normalizeText(conditionalAction.actionTarget) === normalizeText(conditionalAction.condition.target)
        ? conditionResolution
        : await resolveActionTarget(page, currentSnapshot, conditionalAction.actionTarget, { routeProfile });
      if (actionResolution.status !== "resolved" || !actionResolution.locator) {
        throw new Error(`[conditional-action] action_target_not_resolved stepIndex=${orderedItem.index}`);
      }
      if (conditionalAction.operation === "select") {
        await actionResolution.locator.click();
      } else {
        await clickResolvedTarget(actionResolution.locator, false);
      }
      await page.waitForTimeout(250);
      const stillIntercepting = await hasBlockingOverlay(page);
      console.log(`[conditional-action] stepIndex=${orderedItem.index} operation=${conditionalAction.operation} status=executed overlayCleared=${!stillIntercepting}`);
      if (stillIntercepting) {
        throw new Error(`[conditional-action] blocker_still_intercepts stepIndex=${orderedItem.index}`);
      }
      const conditionalScan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
      currentSnapshot = conditionalScan.snapshot;
      allDiscoveredObjects.push(...conditionalScan.objects);
      executedStepIndices.add(orderedItem.index);
      steps.push({
        index: orderedItem.index,
        action: actionTarget.action,
        status: "found",
        targetText: normalizedActionTarget.target,
        snapshotUrl: conditionalScan.url,
        snapshotTitle: conditionalScan.title,
        elementsFound: conditionalScan.elementsCount,
        evidencePath: path.join(evidenceDir, `step-${orderedItem.index}-snapshot.json`)
      });
      planSteps.push({
        index: planSteps.length + 1,
        action: conditionalAction.operation,
        description: actionTarget.action,
        target: { strategy: "text", value: conditionalAction.actionTarget, exact: false },
        optional: true,
        conditionalAction
      });
      continue;
    }

    if (await dismissObstructingDialog(page, normalizedActionTarget.target)) {
      const dialogRecoveryScan = await scanAndCollectObjects(page, orderedItem.index, evidenceDir);
      currentSnapshot = dialogRecoveryScan.snapshot;
      allDiscoveredObjects.push(...dialogRecoveryScan.objects);
    }

    if (isFillActionTarget(normalizedActionTarget)) {
      console.log(`[discovery:case] Resolving fill target: ${normalizedActionTarget.target}`);
      
      // Build auto-generate config from env/config
      const env = options.env ?? {};
      const missingInputBehavior = options.missingInputBehavior ?? "fail";
      const autoGenerateTestData = env.AUTO_GENERATE_TEST_DATA === true || env.AUTO_GENERATE_TEST_DATA === "true";
      const autoGenerateSensitiveData = env.AUTO_GENERATE_SENSITIVE_DATA === true || env.AUTO_GENERATE_SENSITIVE_DATA === "true";
      const testDataProfile = (env.APP_TEST_DATA_PROFILE as "demo" | "qa" | "staging" | "production_like") || "qa";
      const autoGenerateConfig: AutoGenerateConfig = {
        enabled: autoGenerateTestData,
        generateSensitiveData: autoGenerateSensitiveData,
        profile: testDataProfile
      };
      
      console.log(`[data-resolver] config: missingInputBehavior=${missingInputBehavior}, autoGenerateTestData=${autoGenerateTestData}, profile=${testDataProfile}, autoGenerateSensitiveData=${autoGenerateSensitiveData}`);
      console.log(`[data-resolver] resolving key="${normalizedActionTarget.valueKey}" field="${normalizedActionTarget.target}"`);
      
      const testDataMap = testData ?? {};
      const testDataAliases = (env.APP_TEST_DATA_ALIASES_JSON as Record<string, string[]>) ?? {};
      const envVars: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) {
        if (typeof v === "string") {
          envVars[k] = v;
        }
      }
      
      // Build per-scenario overrides and suggested data (generic, no hardcode)
      const overrides = (options as any).scenarioDataOverrides as Record<string, string> | undefined;
      let suggestedData = (options as any).scenarioSuggestedData as Record<string, string> | undefined;
      if (!suggestedData) {
        const scAny: any = scenario as any;
        if (Array.isArray(scAny.dataRequirements)) {
          const map: Record<string,string> = {};
          for (const r of scAny.dataRequirements) {
            if (r && r.key && r.suggestedValue) map[r.key] = String(r.suggestedValue);
          }
          if (Object.keys(map).length>0) suggestedData = map;
        }
      }
      const dataResolution = resolveDataKey(normalizedActionTarget.valueKey, {
        testData: testDataMap,
        testDataAliases,
        env: envVars,
        missingInputBehavior,
        autoGenerateConfig,
        field: normalizedActionTarget.target,
        context: scenario.title,
        overrides,
        suggestedData,
        runtimeEntries: options.runtimeEntries,
      });
      
      console.log(formatDataKeyForLog(dataResolution));
      
      if (dataResolution.status === "missing" || dataResolution.status === "missing_sensitive") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
        
        const errorMsg = dataResolution.status === "missing_sensitive"
          ? `Missing sensitive test data value for key "${normalizedActionTarget.valueKey}". Set APP_TEST_DATA_JSON.${normalizedActionTarget.valueKey} or enable AUTO_GENERATE_SENSITIVE_DATA for test data.`
          : `Missing test data value for key "${normalizedActionTarget.valueKey}". Set APP_TEST_DATA_JSON.${normalizedActionTarget.valueKey} or APP_${normalizedActionTarget.valueKey.toUpperCase()}`;
        
        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: normalizedActionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
        });
        
        failedAtStep = actionTarget.index;
        failedTarget = normalizedActionTarget.target;
        failedReason = dataResolution.status === "missing_sensitive" ? "missing_sensitive_test_data" : "missing_test_data";
        
        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");
        
        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
      
      if (dataResolution.status === "skipped") {
        console.log(`[discovery:case] Skipping fill due to missingInputBehavior=skip: ${normalizedActionTarget.valueKey}`);
        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "skipped",
          targetText: normalizedActionTarget.target,
          error: dataResolution.error
        });
        continue;
      }
      
      // Track resolved data keys
      if (normalizedActionTarget.valueKey) {
        resolvedDataKeys.add(normalizedActionTarget.valueKey);
      }

      const fillValue = dataResolution.value!;
      if (normalizedActionTarget.valueKey
        && normalizedActionTarget.valueKey.toLowerCase().startsWith("auth.")
        && ["dataOverrides", "explicit_runtime_input", "user_provided_qa_credentials"].includes(dataResolution.source ?? "")) {
        runtimeAuthFieldValues.set(normalizedActionTarget.valueKey, {
          target: normalizedActionTarget.target,
          value: fillValue,
        });
      }

      const fillStability = await waitForStablePageState(page, { timeoutMs: 10000, pollMs: 500, stableForMs: 800 });
      if (fillStability.waited) {
        console.log(`[discovery:case] Page stability wait before fill: reason=${fillStability.reason}, duration=${fillStability.durationMs}ms`);
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
      }

      const resolution = await resolveFillTarget(page, currentSnapshot, normalizedActionTarget.target, activeContainer, {
        rowScope: normalizedActionTarget.rowScope,
        entityScope: normalizedActionTarget.entityScope,
        associatedField: normalizedActionTarget.associatedField,
      });

      if (resolution.status === "not_found") {
        if (actionTarget.isOptional) {
          console.log(`[discovery:case] Optional fill target not found, skipping: ${normalizedActionTarget.target}`);
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "skipped",
            targetText: normalizedActionTarget.target,
            error: `Optional fill target "${normalizedActionTarget.target}" not found on current page.`
          });
          continue;
        }

        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        // A resolved selection trigger with a failed causal surface is a
        // functional selection failure, not an authentication-gate signal.
        // Do not let generic auth recovery convert it into a false pass.
        const selectionFailureReason = resolution.selectionDiagnostics?.failureReason;
        const authRecovery = selectionFailureReason
          ? {
              recovered: false,
              diagnostics: { detected: false, reason: selectionFailureReason },
              error: `Selection surface resolution failed: ${selectionFailureReason}`,
            }
          : await tryAuthGateRecovery(page, currentSnapshot, options, actionTarget.target);
        if (selectionFailureReason) {
          console.log(`[discovery:case] Auth gate recovery skipped for selection failure reason=${selectionFailureReason}`);
        }
        if (authRecovery.diagnostics?.detected === true) {
          authGateDetectedDuringDiscovery = true;
          authGateDetectedAtStepIndex = actionTarget.index;
          if (typeof authRecovery.diagnostics?.stage === "string") {
            authGateDetectedStage = authRecovery.diagnostics.stage;
          }
        }
        if (
          !authRecovery.recovered &&
          (authRecovery.diagnostics?.reason === "post_auth_transient_landing_unresolved" ||
            authRecovery.diagnostics?.stage === "authenticated_transient_unresolved")
        ) {
          console.log(`[auth-resume] skipLegacyStableWait reason=post_auth_transient_landing_unresolved`);
          console.log(`[status-reconcile] evidenceStatus=Fallido caseFinished=failed reason=post_auth_transient_landing_unresolved`);
          throw new Error(`[auth-resume] blocked reason=post_auth_transient_landing_unresolved target="${actionTarget.target}" ${safeUrlForLog(authRecovery.diagnostics?.url)}`);
        }
        if (authRecovery.recovered) {
          console.log(`[discovery:case] Auth gate recovery successful, retrying fill target...`);
          if (authRecovery.authGateState) {
            authGateState = authRecovery.authGateState;
            // Track when AuthGate was completed for later AuthFlow insertion
            if (authGateState.completed && authGateCompletedAfterStepIndex === undefined) {
              const lastExecutedStepIndex = executedStepIndices.size > 0 
                ? Math.max(...Array.from(executedStepIndices))
                : 0;
              authGateCompletedAfterStepIndex = lastExecutedStepIndex;
              console.log(`[discovery:case] AuthGate completed after step index ${authGateCompletedAfterStepIndex}`);
            }
          }
          await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
          const retryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = retryScan.snapshot;
          allDiscoveredObjects.push(...retryScan.objects);

          const retryResolution = await resolveFillTarget(page, currentSnapshot, actionTarget.target, activeContainer, {
            rowScope: actionTarget.rowScope,
            entityScope: actionTarget.entityScope,
            associatedField: actionTarget.associatedField,
          });
          if (retryResolution.status === "resolved" && retryResolution.locator) {
            console.log(`[discovery:case] Filling target after auth recovery: ${actionTarget.target}`);
            try {
              await retryResolution.locator.fill(fillValue);
              const controlIdentity = await captureRuntimeControlIdentity(retryResolution.locator);
              const identity = await captureRuntimeFieldIdentity(retryResolution.locator);
              if (normalizedActionTarget.valueKey) {
                runtimeFieldLabels.set(normalizedActionTarget.valueKey, normalizedActionTarget.target);
                if (identity) runtimeFieldIdentities.set(normalizedActionTarget.valueKey, identity);
                if (controlIdentity) runtimeFieldControlIdentities.set(normalizedActionTarget.valueKey, controlIdentity);
              }
            } catch (err) {
              const errorMsg = `Fill failed after auth recovery: ${err instanceof Error ? err.message : String(err)}`;
              steps.push({
                index: actionTarget.index,
                action: actionTarget.action,
                status: "not_found",
                targetText: actionTarget.target,
                snapshotUrl: retryScan.url,
                snapshotTitle: retryScan.title,
                elementsFound: retryScan.elementsCount,
                error: errorMsg,
                evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
              });
              failedAtStep = actionTarget.index;
              failedTarget = actionTarget.target;
              failedReason = "fill_failed";
              await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
              await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
                scenario, steps, allDiscoveredObjects, planSteps,
                pendingObjectsPath, pendingPlansPath, evidenceDir,
                failedAtStep, failedTarget, failedReason, allDiscoveredObjects
              ).candidatePlan ?? {}, null, 2), "utf-8");
              return buildFailureResult(
                scenario, steps, allDiscoveredObjects, planSteps,
                pendingObjectsPath, pendingPlansPath, evidenceDir,
                failedAtStep, failedTarget, failedReason, allDiscoveredObjects
              );
            }

            const postFillScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = postFillScan.snapshot;
            allDiscoveredObjects.push(...postFillScan.objects);

            if (authGateState?.completed) {
              markFunctionalStepAfterAuth(actionTarget.target, authGateState);
            }

            executedStepIndices.add(actionTarget.index);

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "found",
              targetText: actionTarget.target,
              snapshotUrl: postFillScan.url,
              snapshotTitle: postFillScan.title,
              elementsFound: postFillScan.elementsCount,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
              semanticRole: actionTarget.semanticRole,
              relationContext: actionTarget.relationContext
            });

            planSteps.push({
              index: planSteps.length + 1,
              action: "fill",
              description: actionTarget.action,
              target: { strategy: "text", value: actionTarget.target, exact: false },
              valueKey: actionTarget.valueKey
            });
            continue;
          }
        }

        const editableCandidatesCount = (resolution as any).editableCandidatesCount ?? 0;
        const errorMsg = `Fill target "${actionTarget.target}" not found on current page. ${editableCandidatesCount} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_found";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status === "not_editable" || resolution.status === "fill_target_not_editable") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const nonEditable = (resolution as any).nonEditableMatch;
        const errorMsg = nonEditable
          ? `Fill target "${actionTarget.target}" matched non-editable element <${nonEditable.tag}>: "${nonEditable.text}". ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`
          : `Fill target "${actionTarget.target}" matched non-editable element. ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_target_not_editable",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators,
          matchedText: nonEditable?.text
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_editable";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status === "not_visible") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill target "${actionTarget.target}" is not visible on current page. ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_target_not_visible",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_visible";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status !== "resolved") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill resolution failed: status="${resolution.status}" reason="${resolution.matchReason}". ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        console.log(`[discovery:case] Fill resolution failed: ${errorMsg}`);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_resolution_failed",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_resolution_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (!resolution.locator) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill resolution invalid: status="resolved" but locator is missing. This is a contract violation.`;

        console.log(`[discovery:case] ${errorMsg}`);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_resolution_invalid",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators,
          locatorStrategy: resolution.locatorStrategy
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_resolution_invalid";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      console.log(`[discovery:case] Filling target: ${actionTarget.target} (strategy: ${resolution.locatorStrategy}, confidence: ${resolution.confidence.toFixed(2)})`);
      const fillObservationCandidate = canonicalAssertionAfterAction(actionTarget.index);
      const observeRuntimeFill = actionTarget.rowScope !== undefined
        && Boolean(fillObservationCandidate?.canonicalAssertion
          && (fillObservationCandidate.canonicalAssertion.trigger === "leave_field"
            || fillObservationCandidate.canonicalAssertion.oracleType === "row_scoped_value"));
      const fillObservationBefore = observeRuntimeFill
        ? await captureAssertionObservationSnapshot(page).catch(() => undefined)
        : undefined;

      try {
        const runtimeFillObservation = await fillAndObserveRuntimeInput({
          page,
          locator: resolution.locator,
          value: fillValue,
          stepIndex: actionTarget.index,
          observe: observeRuntimeFill,
        });
        const fillControlIdentity = await captureRuntimeControlIdentity(resolution.locator);
        const fillIdentity = await captureRuntimeFieldIdentity(resolution.locator);
        if (normalizedActionTarget.valueKey) {
          runtimeFieldLabels.set(normalizedActionTarget.valueKey, normalizedActionTarget.target);
          if (fillIdentity) runtimeFieldIdentities.set(normalizedActionTarget.valueKey, fillIdentity);
          if (fillControlIdentity) runtimeFieldControlIdentities.set(normalizedActionTarget.valueKey, fillControlIdentity);
        }
        await captureCanonicalFillObservation({
          actionTarget,
          before: runtimeFillObservation.before ?? fillObservationBefore,
          fieldIdentity: fillIdentity,
          controlIdentity: fillControlIdentity,
          networkEvents: runtimeFillObservation.networkEvents,
        });
        await recordRuntimeFillObservation({ actionTarget, observation: runtimeFillObservation });
        await reapplyResolvedRuntimeAuthFields();
      } catch (err) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: `Fill failed: ${err instanceof Error ? err.message : String(err)}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
      currentSnapshot = scan.snapshot;
      allDiscoveredObjects.push(...scan.objects);

      // Capture evidence after fill completes
      await captureEvStep(actionTarget.action, "passed");

      if (authGateState?.completed) {
        markFunctionalStepAfterAuth(actionTarget.target, authGateState);
      }

      executedStepIndices.add(actionTarget.index);

      const resolvedTargetName =
        typeof resolution.candidateText === "string" && resolution.candidateText.trim().length > 0
          ? resolution.candidateText.trim()
          : undefined;
      const hasSemanticTargetReconciliation = Boolean(
        resolvedTargetName
        && normalizeText(resolvedTargetName) !== normalizeText(actionTarget.target)
        && resolution.confidence >= aiConfig.confidenceThreshold
      );
      if (hasSemanticTargetReconciliation) {
        console.log(
          `[semantic-reconciliation] expected="${actionTarget.target}" observed="${resolvedTargetName}" equivalent=true confidence=${resolution.confidence.toFixed(2)} source=runtime_snapshot`
        );
      }

      steps.push({
        index: actionTarget.index,
        action: actionTarget.action,
        status: "found",
        targetText: actionTarget.target,
        resolvedTargetName: hasSemanticTargetReconciliation ? resolvedTargetName : undefined,
        snapshotUrl: scan.url,
        snapshotTitle: scan.title,
        elementsFound: scan.elementsCount,
        evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
        semanticRole: actionTarget.semanticRole,
        relationContext: actionTarget.relationContext,
        controlIdentity: normalizedActionTarget.valueKey
          ? runtimeFieldControlIdentities.get(normalizedActionTarget.valueKey)
          : undefined
      });

      planSteps.push({
        index: planSteps.length + 1,
        action: "fill",
        description: actionTarget.action,
        target: { strategy: "text", value: actionTarget.target, exact: false },
        valueKey: actionTarget.valueKey
      });

      continue;
    }

    if (actionTarget.valueSource === "literal" && actionTarget.value) {
      console.log(`[discovery:case] Resolving fill target: ${actionTarget.target}`);
      console.log(`[discovery:case] Using literal value: ${actionTarget.value}`);

      const fillStability2 = await waitForStablePageState(page, { timeoutMs: 10000, pollMs: 500, stableForMs: 800 });
      if (fillStability2.waited) {
        console.log(`[discovery:case] Page stability wait before fill: reason=${fillStability2.reason}, duration=${fillStability2.durationMs}ms`);
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
      }

      const resolution = await resolveFillTarget(page, currentSnapshot, actionTarget.target, activeContainer, {
        rowScope: actionTarget.rowScope,
        entityScope: actionTarget.entityScope,
        associatedField: actionTarget.associatedField,
      });

      if (resolution.status === "not_found") {
        if (actionTarget.isOptional) {
          console.log(`[discovery:case] Optional fill target not found, skipping: ${actionTarget.target}`);
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "skipped",
            targetText: actionTarget.target,
            error: `Optional fill target "${actionTarget.target}" not found on current page.`
          });
          continue;
        }

        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill target "${normalizedActionTarget.target}" not found on current page. ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: normalizedActionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
        });

        failedAtStep = actionTarget.index;
        failedTarget = normalizedActionTarget.target;
        failedReason = "fill_target_not_found";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status === "not_editable" || resolution.status === "fill_target_not_editable") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const nonEditable = (resolution as any).nonEditableMatch;
        const errorMsg = nonEditable
          ? `Fill target "${actionTarget.target}" matched non-editable element <${nonEditable.tag}>: "${nonEditable.text}". ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`
          : `Fill target "${actionTarget.target}" matched non-editable element. ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_target_not_editable",
          targetText: normalizedActionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators,
          matchedText: nonEditable?.text
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_editable";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status === "not_visible") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill target "${actionTarget.target}" is not visible on current page. ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_target_not_visible",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_target_not_visible";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status !== "resolved") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill resolution failed: status="${resolution.status}" reason="${resolution.matchReason}". ${(resolution as any).editableCandidatesCount ?? 0} editable candidates evaluated.`;

        console.log(`[discovery:case] Fill resolution failed: ${errorMsg}`);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_resolution_failed",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_resolution_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (!resolution.locator) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const errorMsg = `Fill resolution invalid: status="resolved" but locator is missing. This is a contract violation.`;

        console.log(`[discovery:case] ${errorMsg}`);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "fill_resolution_invalid",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          attemptedLocators: (resolution as any).attemptedLocators,
          locatorStrategy: resolution.locatorStrategy
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_resolution_invalid";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      console.log(`[discovery:case] Filling target: ${actionTarget.target} (strategy: ${resolution.locatorStrategy}, confidence: ${resolution.confidence.toFixed(2)})`);
      const literalFillObservationCandidate = canonicalAssertionAfterAction(actionTarget.index);
      const observeLiteralRuntimeFill = actionTarget.rowScope !== undefined
        && Boolean(literalFillObservationCandidate?.canonicalAssertion
          && (literalFillObservationCandidate.canonicalAssertion.trigger === "leave_field"
            || literalFillObservationCandidate.canonicalAssertion.oracleType === "row_scoped_value"));
      const literalFillObservationBefore = observeLiteralRuntimeFill
        ? await captureAssertionObservationSnapshot(page).catch(() => undefined)
        : undefined;

      try {
        const runtimeFillObservation = await fillAndObserveRuntimeInput({
          page,
          locator: resolution.locator,
          value: actionTarget.value,
          stepIndex: actionTarget.index,
          observe: observeLiteralRuntimeFill,
        });
        await captureCanonicalFillObservation({
          actionTarget,
          before: runtimeFillObservation.before ?? literalFillObservationBefore,
          fieldIdentity: await captureRuntimeFieldIdentity(resolution.locator),
          controlIdentity: await captureRuntimeControlIdentity(resolution.locator),
          networkEvents: runtimeFillObservation.networkEvents,
        });
        await recordRuntimeFillObservation({ actionTarget, observation: runtimeFillObservation });
      } catch (err) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: `Fill failed: ${err instanceof Error ? err.message : String(err)}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
        });

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "fill_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
      currentSnapshot = scan.snapshot;
      allDiscoveredObjects.push(...scan.objects);

      // Capture evidence after direct fill completes
      await captureEvStep(actionTarget.action, "passed");

      if (authGateState?.completed) {
        markFunctionalStepAfterAuth(actionTarget.target, authGateState);
      }

      executedStepIndices.add(actionTarget.index);

      const runtimeResolvedTargetName =
        typeof resolution.candidateText === "string" && resolution.candidateText.trim().length > 0
          ? resolution.candidateText.trim()
          : undefined;
      const hasRuntimeTargetReconciliation = Boolean(
        runtimeResolvedTargetName
        && normalizeText(runtimeResolvedTargetName) !== normalizeText(actionTarget.target)
        && resolution.confidence >= aiConfig.confidenceThreshold
      );
      if (hasRuntimeTargetReconciliation) {
        console.log(
          `[semantic-reconciliation] expected="${actionTarget.target}" observed="${runtimeResolvedTargetName}" equivalent=true confidence=${resolution.confidence.toFixed(2)} source=runtime_snapshot`
        );
      }

      steps.push({
        index: actionTarget.index,
        action: actionTarget.action,
        status: "found",
        targetText: actionTarget.target,
        resolvedTargetName: hasRuntimeTargetReconciliation ? runtimeResolvedTargetName : undefined,
        snapshotUrl: scan.url,
        snapshotTitle: scan.title,
        elementsFound: scan.elementsCount,
        evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
        semanticRole: actionTarget.semanticRole,
        relationContext: actionTarget.relationContext
      });

      planSteps.push({
        index: planSteps.length + 1,
        action: "fill",
        description: actionTarget.action,
        target: { strategy: "text", value: actionTarget.target, exact: false }
      });

      continue;
    }

    if (actionTarget.associatedEntity) {
      console.log(`[discovery:case] Resolving associated target: ${actionTarget.target} (entity: ${actionTarget.associatedEntity})`);

      const associatedResolution = await resolveAssociatedActionTarget(page, currentSnapshot, actionTarget.target, actionTarget.associatedEntity);
      const diag = associatedResolution.diagnostics;

      if (associatedResolution.status === "resolved") {
        console.log(`[discovery:case] Associated target resolved: ${actionTarget.target} (strategy: ${associatedResolution.locatorStrategy}, confidence: ${associatedResolution.confidence.toFixed(2)})`);

        try {
          await clickResolvedTarget(associatedResolution.locator!, false);
        } catch {
          try {
            await clickResolvedTarget(associatedResolution.locator!, true);
          } catch (err) {
            const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = scan.snapshot;
            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "not_found",
              targetText: actionTarget.target,
              snapshotUrl: scan.url,
              snapshotTitle: scan.title,
              elementsFound: scan.elementsCount,
              error: `Associated action click failed: ${err instanceof Error ? err.message : String(err)}`,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
            });
            failedAtStep = actionTarget.index;
            failedTarget = actionTarget.target;
            failedReason = "click_failed";
            await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
            await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects).candidatePlan ?? {}, null, 2), "utf-8");
            return buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects);
          }
        }

        await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
        allDiscoveredObjects.push(...scan.objects);

        // Capture evidence after associated click completes
        await captureEvStep(actionTarget.action, "passed");

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          semanticRole: actionTarget.semanticRole,
          relationContext: actionTarget.relationContext
        });

        planSteps.push({
          index: planSteps.length + 1,
          action: "click",
          description: `${actionTarget.action} [associated: ${actionTarget.associatedEntity}]`,
          target: { strategy: associatedResolution.locatorStrategy as any, value: actionTarget.target, exact: false }
        });

        continue;
      }

      // Associated resolution failed
      let failedReasonText = associatedResolution.status;
      let errorMsg = `Associated target resolution failed: ${associatedResolution.matchReason}. Action "${actionTarget.target}" with entity "${actionTarget.associatedEntity}".`;
      if (diag.candidateContainers.length > 0) {
        errorMsg += ` Containers: [${diag.candidateContainers.slice(0, 3).map((c) => `${c.tagName}(${c.entityMatchText.slice(0, 30)})`).join(", ")}]`;
      }
      if (diag.candidateActions.length > 0) {
        errorMsg += ` Actions: [${diag.candidateActions.slice(0, 3).map((a) => `"${a.actionText}"(${a.combinedScore.toFixed(2)})`).join(", ")}]`;
      }
      if (diag.reason) {
        errorMsg += ` ${diag.reason}`;
      }

      const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
      currentSnapshot = scan.snapshot;

      steps.push({
        index: actionTarget.index,
        action: actionTarget.action,
        status: "not_found",
        targetText: actionTarget.target,
        snapshotUrl: scan.url,
        snapshotTitle: scan.title,
        elementsFound: scan.elementsCount,
        error: errorMsg,
        evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
      });

      failedAtStep = actionTarget.index;
      failedTarget = actionTarget.target;
      failedReason = associatedResolution.status === "needs_associated_target_resolution" ? "needs_associated_target_resolution" : (associatedResolution.status === "associated_entity_not_found" ? "associated_entity_not_found" : "associated_action_not_found");

      await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
      await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects).candidatePlan ?? {}, null, 2), "utf-8");

      return buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects);
    }

    // Capture evidence after the action completes (below, at step push points)
    const shouldUsePostResumeSnapshot = postResumeTargetContext?.target === actionTarget.target;
    if (shouldUsePostResumeSnapshot) {
      const previousResumeUrl = postResumeTargetContext?.url ?? page.url();
      const currentUrl = page.url();
      if (previousResumeUrl !== currentUrl && isPrivateLandingPath(previousResumeUrl) && isPublicOrAuthPath(currentUrl)) {
        console.log(
          `[auth-resume] lostPrivateLanding beforeTarget="${actionTarget.target}" ` +
          `${safeUrlForLog(previousResumeUrl)} ${safeUrlForLog(currentUrl)}`
        );
        console.log(
          `[auth-resume] blocked reason=private_landing_lost_before_target ` +
          `target="${actionTarget.target}" ${safeUrlForLog(currentUrl)}`
        );
        console.log(`[status-reconcile] evidenceStatus=Fallido caseFinished=failed reason=private_landing_lost_before_target`);
        await captureEvStep(actionTarget.action, "failed", `Private landing lost before resolving "${actionTarget.target}".`);
        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "private_landing_lost_before_target";
        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects).candidatePlan ?? {}, null, 2), "utf-8");
        return buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects);
      }

      const postResumeScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
      currentSnapshot = postResumeScan.snapshot;
      allDiscoveredObjects.push(...postResumeScan.objects);
      postResumeTargetContext = {
        target: actionTarget.target,
        url: currentSnapshot.url,
        snapshot: currentSnapshot
      };
      const postResumeSummary = summarizeSnapshot(currentSnapshot);

      // After successful OTP and landing at private menu, preserve session by NOT reloading/renavigating
      console.log(`[post-otp] preserveSessionMode=true reason="session_lost_on_navigation"`);
      console.log(`[post-otp] noReloadNoGotoNoReauth=true`);

      // Check if we need to wait for private menu to load before resolving target
      const loadingTexts = ["cargando", "loading", "por favor espere", "please wait"];
      const hasLoadingSignal = currentSnapshot.elements.some((el: any) =>
        loadingTexts.some(txt => (el.text || el.label || "").toLowerCase().includes(txt))
      );

      if (hasLoadingSignal && postResumeSummary.controls.length === 0) {
        // Gate: wait for private menu to be ready before proceeding to target resolution
        const gateResult = await waitForPrivateMenuReadyBeforeTargetResolution(page, currentSnapshot, actionTarget.target, evidenceDir);

        if (gateResult.status !== "ready") {
          // Gate blocked or timed out - don't proceed to target resolution
          if (gateResult.status === "blocked") {
            console.log(
              `[auth-resume] blocked reason=${gateResult.reason} target="${actionTarget.target}" url="${gateResult.url}" recovery="disabled_preserve_session"`
            );
          } else if (gateResult.status === "timeout") {
            console.log(
              `[auth-resume] blocked reason=${gateResult.reason} target="${actionTarget.target}" url="${gateResult.url}"`
            );
          }
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "not_found",
            targetText: actionTarget.target,
            error: `${gateResult.reason}`,
            evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
          } as any);
          failedAtStep = actionTarget.index;
          failedTarget = actionTarget.target;
          failedReason = gateResult.reason;
          await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
          await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(scenario, steps, allDiscoveredObjects, planSteps, pendingObjectsPath, pendingPlansPath, evidenceDir, failedAtStep, failedTarget, failedReason, allDiscoveredObjects).candidatePlan ?? {}, null, 2), "utf-8");
          return buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          );
        }

        // Gate passed - update snapshot and proceed to target resolution
        currentSnapshot = await scanAndCollectObjects(page, actionTarget.index, evidenceDir).then(r => r.snapshot);
        console.log(`[post-otp-gate] releaseToTargetResolver target="${actionTarget.target}"`);
      }

      console.log(`[discovery:case] Resolving target: ${actionTarget.target}`);
      const stabilityResult = await waitForStablePageState(page, {
        timeoutMs: 10000,
        pollMs: 500,
        stableForMs: 800
      });
      if (stabilityResult.waited) {
        console.log(`[discovery:case] Page stability wait: reason=${stabilityResult.reason}, duration=${stabilityResult.durationMs}ms`);
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
      }
    }

    // Build route history from previous found steps
    const routeHistory = steps
      .filter(s => s.status === "found" && s.targetText)
      .map(s => s.targetText!);
    
    // Get next target for contextual resolution
    const nextTarget = parsed.actionTargets.find(a => a.index > actionTarget.index)?.target;
    
    // Get previous target from relation context or route history
    const previousTarget = actionTarget.relationContext || routeHistory[routeHistory.length - 1];

    // Selection steps can be backed by runtime data just like fills. Resolve
    // the value through the same provenance-aware resolver before opening a
    // row-scoped editor; no option is inferred from position or demo data.
    let selectionValue: string | undefined;
    if (actionTarget.actionType === "action_select" && actionTarget.valueKey) {
      const runtimeEnv = options.env ?? {};
      const envVars: Record<string, string> = {};
      for (const [key, value] of Object.entries(runtimeEnv)) {
        if (typeof value === "string") envVars[key] = value;
      }
      const selectionResolution = resolveDataKey(actionTarget.valueKey, {
        testData: testData ?? {},
        testDataAliases: (runtimeEnv.APP_TEST_DATA_ALIASES_JSON as Record<string, string[]>) ?? {},
        env: envVars,
        missingInputBehavior: options.missingInputBehavior ?? "fail",
        autoGenerateConfig: {
          enabled: runtimeEnv.AUTO_GENERATE_TEST_DATA === true || runtimeEnv.AUTO_GENERATE_TEST_DATA === "true",
          generateSensitiveData: runtimeEnv.AUTO_GENERATE_SENSITIVE_DATA === true || runtimeEnv.AUTO_GENERATE_SENSITIVE_DATA === "true",
          profile: (runtimeEnv.APP_TEST_DATA_PROFILE as "demo" | "qa" | "staging" | "production_like") || "qa",
        },
        field: actionTarget.target,
        context: scenario.title,
        overrides: (options as any).scenarioDataOverrides as Record<string, string> | undefined,
        suggestedData: (options as any).scenarioSuggestedData as Record<string, string> | undefined,
        runtimeEntries: options.runtimeEntries,
      });
      console.log(formatDataKeyForLog(selectionResolution));
      if (selectionResolution.status === "resolved") {
        selectionValue = selectionResolution.value;
        resolvedDataKeys.add(actionTarget.valueKey);
      }
    }

    const postResumeTargetNorm = normalizeText(actionTarget.target);
    const postResumeCandidates = shouldUsePostResumeSnapshot
      ? currentSnapshot.elements
          .map((el: any) => {
            const values = [
              String(el.text || "").trim(),
              String(el.label || "").trim(),
              String(el.name || "").trim(),
              String(el.ariaLabel || "").trim(),
              String(el.title || "").trim(),
              String(el.testId || "").trim()
            ].filter(Boolean);
            const normalizedValues = values.map(normalizeText).filter(Boolean);
            const exact = normalizedValues.some((value) => value === postResumeTargetNorm);
            const contains = normalizedValues.some((value) => value.includes(postResumeTargetNorm) || postResumeTargetNorm.includes(value));
            if (!exact && !contains) return undefined;
            const strategy = exact
              ? (normalizeText(el.text || el.label || el.name) === postResumeTargetNorm ? "text" : "accessible_name")
              : (el.testId || el.title ? "data_hint" : (/button|link|menuitem/i.test(String(el.role || "")) ? "accessible_name" : "card_text"));
            const clickableBoost = /button|link|menuitem/i.test(String(el.role || "")) ? 2 : 0;
            return {
              element: el,
              strategy,
              score: (exact ? 10 : 5) + clickableBoost,
              label: values[0] || values[1] || values[2] || values[3] || values[4] || values[5] || "(empty)"
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => b.score - a.score)
      : [];
    if (shouldUsePostResumeSnapshot) {
      console.log(
        `[target-resolver] candidates target="${actionTarget.target}" count=${postResumeCandidates.length} ` +
        `top=${JSON.stringify(postResumeCandidates.slice(0, 5).map((candidate: any) => candidate.label))}`
      );
    }

    let resolution = await resolveActionTarget(page, currentSnapshot, actionTarget.target, {
      semanticRole: actionTarget.semanticRole,
      relationContext: actionTarget.relationContext,
      selectionField: actionTarget.selectionField,
      selectionValue,
      rowScope: actionTarget.rowScope,
      entityScope: actionTarget.entityScope,
      associatedField: actionTarget.associatedField,
      activeContainer,
      routeProfile,
      actionText: actionTarget.action,
      nextTarget,
      previousTarget,
      routeHistory,
      expectedTarget: detailTarget && finalProductClickStepIndex === actionTarget.index ? detailTarget : undefined,
    });
    if (shouldUsePostResumeSnapshot && postResumeCandidates.length > 0) {
      const preferredCandidate = postResumeCandidates[0] as any;
      console.log(`[menu-resolver] candidate target="${actionTarget.target}" strategy="${preferredCandidate.strategy}"`);
      const preferredLocator = await resolveSnapshotElementLocator(page, {
        element: preferredCandidate.element,
        target: actionTarget.target,
        candidateText: preferredCandidate.label,
        type: preferredCandidate.element.type,
        tagName: preferredCandidate.element.tagName,
        confidence: 0.95,
        matchReason: `post_resume:${preferredCandidate.strategy}`
      });
      if (preferredLocator.locator) {
        resolution = {
          ...resolution,
          status: "resolved",
          locator: preferredLocator.locator,
          confidence: Math.max(resolution.confidence ?? 0, 0.95),
          locatorStrategy: `post_resume_${preferredCandidate.strategy}`,
          matchReason: `post_resume_${preferredCandidate.strategy}`
        } as typeof resolution;
        console.log(`[menu-resolver] resolved target="${actionTarget.target}" strategy="${preferredCandidate.strategy}"`);
      }
    }

    let finalLocator = resolution.locator;
    let promotedToAncestor = false;

    if (resolution.locator && !resolution.selectionApplied && isSelectionLikeTarget(actionTarget.target, { action: actionTarget.action, actionType: actionTarget.actionType, snapshot: currentSnapshot })) {
      console.log(`[discovery:case] Selection-like target detected: action=${actionTarget.action} target="${actionTarget.target}"`);
      const promotion = await promoteToClickableAncestor(resolution.locator);
      if (promotion.promoted) {
        console.log(`[discovery:case] Promoted locator to clickable ancestor: ${promotion.fromTag} -> ${promotion.toTag}`);
        finalLocator = promotion.locator;
        promotedToAncestor = true;
      } else {
        console.log(`[discovery:case] No clickable ancestor found for selection-like target: ${actionTarget.target}`);
      }
    }

    if (resolution.status === "resolved" && resolution.confidence >= aiConfig.confidenceThreshold && finalLocator) {
      console.log(`[discovery:case] Deterministic target resolved: ${actionTarget.target} (confidence: ${resolution.confidence.toFixed(2)})`);
    }
    
    // Handle contextual intermediate already satisfied - skip click and continue
    if (resolution.locatorStrategy === "contextual_intermediate_already_satisfied") {
      console.log(`[discovery:case] Contextual intermediate already satisfied: ${actionTarget.target}. Continuing without click.`);
      console.log(`[discovery:case] Evidence: ${resolution.alreadySatisfiedEvidence?.candidateText} (${resolution.alreadySatisfiedEvidence?.candidateType})`);
      
      // Mark step as found/recovered without executing click
      steps.push({
        index: actionTarget.index,
        action: actionTarget.action,
        status: "found",
        targetText: actionTarget.target,
        snapshotUrl: currentSnapshot.url,
        snapshotTitle: currentSnapshot.title,
        elementsFound: currentSnapshot.elements.length,
        locatorStrategy: "contextual_intermediate_already_satisfied",
        candidateText: resolution.alreadySatisfiedEvidence?.candidateText,
        recoveredBy: "contextual_intermediate_already_satisfied",
        recoveryMetadata: {
          rationale: `Intermediate variant "${actionTarget.target}" already visible in list. Next step is ordinal selection.`,
          alreadySatisfiedEvidence: resolution.alreadySatisfiedEvidence
        },
        evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
      });
      
      // Continue to next step without clicking
      continue;
    }

    const needsEarlyCompletionCheck =
      resolution.status === "not_found" ||
      resolution.status === "ambiguous" ||
      resolution.status === "locator_resolution_failed" ||
      resolution.confidence < aiConfig.confidenceThreshold;

    // Try parent intermediate recovery before giving up
    if (needsEarlyCompletionCheck && resolution.status !== "resolved" && actionTarget.action === "click") {
      console.log(`[intermediate-recovery] invoked target="${actionTarget.target}" reason=direct_resolution_failed`);
      const { recoverWithParentIntermediate } = await import("./intermediate-step-recovery");
      const recoveryResult = await recoverWithParentIntermediate(page, actionTarget.target, currentSnapshot);
      if (recoveryResult.recovered) {
        console.log(`[target-resolver] resolvedAfterIntermediate target="${actionTarget.target}" parent="${recoveryResult.selectedCandidate?.text}"`);
        // Re-resolve target after successful parent click
        const retryResolution = await resolveActionTarget(page, currentSnapshot, actionTarget.target, {
          routeProfile: options?.routeProfile,
          actionText: actionTarget.action,
        });
        if (retryResolution.status === "resolved" && retryResolution.locator) {
          resolution = retryResolution;
          finalLocator = retryResolution.locator;
          console.log(`[discovery:case] Target resolved after intermediate recovery: ${actionTarget.target}`);
        }
      }
    }

    const earlyCompletion = evaluateEarlyCompletion(
      currentSnapshot,
      parsed.assertionTargets,
      parsed.actionTargets.filter(a => a.index > actionTarget.index),
      (options as any).appConfig,
      {
        currentStepIndex: actionTarget.index,
        triggerStepIndex: finalProductClickStepIndex,
        triggerExecuted: false,
      }
    );
    if (needsEarlyCompletionCheck && earlyCompletion.pendingAssertions.length > 0) {
      console.log(`[discovery:case] Early completion not satisfied at step ${actionTarget.index}. Pending: [${earlyCompletion.pendingAssertions.map(a => `"${a}"`).join(", ")}]. Satisfied: [${earlyCompletion.satisfiedAssertions.map(a => `"${a}"`).join(", ")}].`);
    }

    const aiDecision = shouldInvokeAiAssistedDiscovery({
      resolution,
      confidenceThreshold: aiConfig.confidenceThreshold,
      enabled: aiConfig.enabled
    });

    if (!aiDecision.shouldInvoke && resolution.status === "resolved" && resolution.confidence >= aiConfig.confidenceThreshold) {
      console.log(`[discovery:case] AI-assisted discovery skipped because deterministic confidence is sufficient.`);
    }

    if (aiDecision.shouldInvoke && aiDecision.reason) {
      console.log(`[discovery:case] AI-assisted discovery enabled. Trying AI fallback...`);
      const aiOutcome = await runAiAssistedDiscovery(
        {
          currentGoal: scenario.title,
          currentStep: actionTarget.action,
          target: actionTarget.target,
          snapshot: currentSnapshot,
          resolution,
          previousSteps: steps,
          allowedActions: ["click", "stop", "wait"],
          constraints: getAiConstraints(),
          triggerReason: aiDecision.reason,
          attempt: 1
        },
        {
          explorer: aiExplorer,
          config: aiConfig,
          executeProposal: async (proposal, element) => {
            if (proposal.action !== "click") {
              return {
                success: false,
                reason: `Framework only allows click proposals during case discovery. Received "${proposal.action}".`
              };
            }

            if (!element) {
              return { success: false, reason: "Snapshot candidate was not available for framework execution." };
            }

            const beforeSnapshot = currentSnapshot;
            const beforeState = await capturePageState(page);
            const resolvedElement = await resolveSnapshotElementLocator(page, {
              element,
              target: proposal.target,
              candidateText: element.text ?? element.label ?? element.name ?? element.placeholder ?? proposal.target,
              type: element.type,
              tagName: element.tagName,
              confidence: proposal.confidence,
              matchReason: proposal.reason
            });

            if (!resolvedElement.locator) {
              return {
                success: false,
                reason: `Framework could not resolve a DOM locator from the snapshot candidate. Attempted locators: ${resolvedElement.attemptedLocators.join(" | ")}`
              };
            }

            try {
              await clickResolvedTarget(resolvedElement.locator, false);
            } catch {
              try {
                await clickResolvedTarget(resolvedElement.locator, true);
              } catch (error) {
                return {
                  success: false,
                  reason: `Framework click failed: ${error instanceof Error ? error.message : String(error)}`
                };
              }
            }

            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            const afterState = await capturePageState(page);
            const transitionDetected = hasPageTransition(beforeState, afterState, proposal.target);
            const afterSnapshot = await scanCurrentPage(page);
            const evidencePath = path.join(evidenceDir, `step-${actionTarget.index}-ai-assisted.json`);

            await writeFile(
              evidencePath,
              JSON.stringify(
                {
                  triggerReason: aiDecision.reason,
                  proposal,
                  locatorStrategy: resolvedElement.locatorStrategy,
                  beforeSnapshot,
                  afterSnapshot,
                  transitionDetected,
                  beforeState,
                  afterState
                },
                null,
                2
              ),
              "utf-8"
            );

            return {
              success: transitionDetected,
              transitionDetected,
              evidencePath,
              beforeSnapshot,
              afterSnapshot,
              reason: transitionDetected ? undefined : "AI proposal executed but no transition or assertable change was detected."
            };
          }
        }
      );

      if (aiOutcome.status === "executed") {
        currentSnapshot = aiOutcome.execution.afterSnapshot ?? currentSnapshot;
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;
        allDiscoveredObjects.push(...scan.objects);

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          evidencePath: aiOutcome.execution.evidencePath ?? path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          aiAssisted: true,
          aiProposal: aiOutcome.proposal,
          aiReason: aiDecision.reason,
          semanticRole: actionTarget.semanticRole,
          relationContext: actionTarget.relationContext
        });

      planSteps.push({
        index: planSteps.length + 1,
        action: "fill",
        description: actionTarget.action,
        target: { strategy: "text", value: actionTarget.target, exact: false },
        valueKey: actionTarget.valueKey
      });

        if (authGateState?.completed) {
          markFunctionalStepAfterAuth(actionTarget.target, authGateState);
        }
        executedStepIndices.add(actionTarget.index);
        if (typeof currentActionOrder === "number") {
          executedActionOrders.add(currentActionOrder);
        }
        if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
          break;
        }

        continue;
      }

      if (aiOutcome.status === "ai_candidate_rejected" || aiOutcome.status === "needs_approval") {
        if (aiOutcome.reason && aiOutcome.reason.includes("did not return a proposal")) {
          console.log(`[discovery:case] AI explorer did not return a proposal.`);
        } else {
          console.log(`[discovery:case] AI explorer returned invalid proposal: ${aiOutcome.reason}`);
        }

        const originalReason = resolution.status === "not_found" ? "target_not_found" : resolution.status === "ambiguous" ? "ambiguous_target" : resolution.status;
        console.log(`[discovery:case] Keeping original failure reason: ${originalReason}.`);

        (resolution as any).aiDiagnostics = {
          attempted: true,
          result: aiOutcome.reason && aiOutcome.reason.includes("did not return a proposal") ? "no_proposal" : "invalid_proposal",
          proposal: aiOutcome.proposal
        };

        // Check if we should block low-confidence semantic fallback for selection-like targets
        const isSelectionLike = isSelectionLikeTargetNew(actionTarget.target);
        const selectionThreshold = getSelectionConfidenceThreshold();
        const shouldBlockFallback = isSelectionLike && 
          resolution.confidence < selectionThreshold && 
          resolution.locatorStrategy?.includes("semantic");

        if (resolution.status === "resolved" && resolution.locator && !shouldBlockFallback) {
          console.log(`[discovery:case] AI failed but deterministic locator exists. Using deterministic resolution.`);
          (resolution as any)._aiFailedDeterministicAvailable = true;
        } else if (shouldBlockFallback) {
          console.log(`[discovery:case] Low-confidence semantic selection blocked: target="${actionTarget.target}" confidence=${resolution.confidence.toFixed(2)} threshold=${selectionThreshold}`);
          console.log(`[discovery:case] Will invoke AI selection_resolution or fail safely instead of using low-confidence semantic match.`);
          // Block the fallback by clearing the locator and marking as blocked
          (resolution as any)._selectionFallbackBlocked = true;
          (resolution as any)._aiFailedDeterministicAvailable = false;
          // Clear the locator to prevent click execution
          resolution.locator = undefined;
          resolution.status = "ambiguous" as any;
          // Also clear finalLocator to prevent click at line 3318
          finalLocator = undefined;
        }
      }
    }

    if (!(resolution as any)._aiFailedDeterministicAvailable) {
      if (resolution.status === "not_found") {
        if (shouldUsePostResumeSnapshot) {
          const candidateLabels = postResumeCandidates.slice(0, 8).map((candidate: any) => candidate.label);
          console.log(
            `[target-resolver] failed target="${actionTarget.target}" ` +
            `reason=not_in_post_resume_snapshot candidates=${JSON.stringify(candidateLabels)}`
          );
          console.log(`[status-reconcile] evidenceStatus=Fallido caseFinished=failed reason=target_not_found`);
          await captureEvStep(actionTarget.action, "failed", `Target "${actionTarget.target}" not found in post-resume snapshot.`);
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "not_found",
            targetText: actionTarget.target,
            snapshotUrl: currentSnapshot.url,
            snapshotTitle: currentSnapshot.title,
            elementsFound: currentSnapshot.elements.length,
            error: `Target "${actionTarget.target}" not found in post-resume snapshot.`,
            evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
          } as any);
          failedAtStep = actionTarget.index;
          failedTarget = actionTarget.target;
          failedReason = "target_not_found";
          await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
          await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          ).candidatePlan ?? {}, null, 2), "utf-8");
          return buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          );
        }

        if (actionTarget.isOptional) {
          console.log(`[discovery:case] Optional target not found, skipping: ${actionTarget.target}`);
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "skipped",
            targetText: actionTarget.target,
            error: `Optional target "${actionTarget.target}" not found on current page. ${resolution.candidates?.length ?? 0} candidates evaluated.`
          });
          continue;
        }

        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        // A resolved selection trigger with a failed causal surface is a
        // functional selection failure, not an authentication-gate signal.
        // Keep the original selection diagnostic intact and do not retry the
        // trigger through the generic auth path, which could turn a failed
        // selection into a false-positive click.
        const selectionFailureReason = resolution.selectionDiagnostics?.failureReason;
        const authRecovery = selectionFailureReason
          ? {
              recovered: false,
              diagnostics: { detected: false, reason: selectionFailureReason },
              error: `Selection surface resolution failed: ${selectionFailureReason}`,
            }
          : await tryAuthGateRecovery(page, currentSnapshot, options, actionTarget.target);
        if (selectionFailureReason) {
          console.log(`[discovery:case] Auth gate recovery skipped for selection failure reason=${selectionFailureReason}`);
        }
        if (authRecovery.diagnostics?.detected === true) {
          authGateDetectedDuringDiscovery = true;
          authGateDetectedAtStepIndex = actionTarget.index;
          if (typeof authRecovery.diagnostics?.stage === "string") {
            authGateDetectedStage = authRecovery.diagnostics.stage;
          }
        }
        if (
          !authRecovery.recovered &&
          (authRecovery.diagnostics?.reason === "post_auth_transient_landing_unresolved" ||
            authRecovery.diagnostics?.stage === "authenticated_transient_unresolved")
        ) {
          console.log(`[auth-resume] skipLegacyStableWait reason=post_auth_transient_landing_unresolved`);
          console.log(`[status-reconcile] evidenceStatus=Fallido caseFinished=failed reason=post_auth_transient_landing_unresolved`);
          throw new Error(`[auth-resume] blocked reason=post_auth_transient_landing_unresolved target="${actionTarget.target}" ${safeUrlForLog(authRecovery.diagnostics?.url)}`);
        }
        if (authRecovery.recovered) {
          console.log(`[discovery:case] Auth gate recovery successful, retrying click target...`);
          if (authRecovery.authGateState) {
            authGateState = authRecovery.authGateState;
            // Track when AuthGate was completed for later AuthFlow insertion
            if (authGateState.completed && authGateCompletedAfterStepIndex === undefined) {
              const lastExecutedStepIndex = executedStepIndices.size > 0 
                ? Math.max(...Array.from(executedStepIndices))
                : 0;
              authGateCompletedAfterStepIndex = lastExecutedStepIndex;
              console.log(`[discovery:case] AuthGate completed after step index ${authGateCompletedAfterStepIndex}`);
            }
          }
          await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
          const retryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = retryScan.snapshot;
          allDiscoveredObjects.push(...retryScan.objects);

          const retryResolution = await resolveActionTarget(page, currentSnapshot, actionTarget.target, { routeProfile, actionText: actionTarget.action });
          if (retryResolution.status === "resolved" && retryResolution.locator) {
            await clickResolvedTarget(retryResolution.locator, false);
            console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${actionTarget.target}"`);
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            await page.waitForTimeout(1000);

            const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = postClickScan.snapshot;
            allDiscoveredObjects.push(...postClickScan.objects);

            // Capture evidence after click completes and page stabilizes
            await captureEvStep(actionTarget.action, "passed");

            if (authGateState?.completed) {
              markFunctionalStepAfterAuth(actionTarget.target, authGateState);
            }

            executedStepIndices.add(actionTarget.index);
            if (typeof currentActionOrder === "number") {
              executedActionOrders.add(currentActionOrder);
            }

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "found",
              targetText: actionTarget.target,
              snapshotUrl: postClickScan.url,
              snapshotTitle: postClickScan.title,
              elementsFound: postClickScan.elementsCount,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
              semanticRole: actionTarget.semanticRole,
              relationContext: actionTarget.relationContext
            });

            planSteps.push({
              index: planSteps.length + 1,
              action: "click",
              description: actionTarget.action,
              target: { strategy: "text", value: actionTarget.target, exact: false }
            });
            if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
              break;
            }
            continue;
          }
        }

        const diagnosis = (resolution as any)._diagnosis;
        let errorMsg = `Target "${actionTarget.target}" not found on current page. ${resolution.candidates?.length ?? 0} candidates evaluated.`;
        if (diagnosis && Array.isArray(diagnosis) && diagnosis.length > 0) {
          errorMsg += " Diagnosis: " + JSON.stringify(diagnosis);
        }
        if (selectionFailureReason) {
          errorMsg = `Selection target "${actionTarget.target}" failed: ${selectionFailureReason}.`;
        } else if (authRecovery.error) {
          errorMsg += ` Auth gate recovery attempted but failed: ${authRecovery.error}`;
        }

        // AI repair orchestration (phase 1): target_not_found only, after all local resolvers fail.
        if (envTrue("AI_REPAIR_ENABLED", false) && envTrue("AI_REPAIR_USE_CONTEXT_PACK", true)) {
          const aiCandidates = currentSnapshot.elements.map((el) => ({
            candidateId: el.id,
            role: el.role,
            name: el.name,
            text: el.text,
            visible: Boolean(el.visible),
            enabled: isSnapshotElementEnabled(el),
            clickable: isSnapshotElementClickable(el),
            editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
            semanticRelation: undefined,
            score: resolution.candidates.find((c) => c.elementId === el.id)?.matchScore,
            sensitive: false
          }));

          // Build enhanced AI Repair diagnostics for artifact persistence
          const aiRepairStartTime = Date.now();
          console.log(`[ai-repair] enabled provider=${process.env.AI_REPAIR_PROVIDER?.trim() || process.env.AI_PROVIDER?.trim() || "unknown"} model=${process.env.AI_REPAIR_MODEL?.trim() || process.env.AI_MODEL?.trim() || "unknown"}`);
          console.log(`[ai-repair] failure=target_not_found target="${actionTarget.target}"`);
          console.log(`[ai-repair] context candidates=${aiCandidates.length}`);

          const aiRepair = await runAiRepairOrchestrator({
            appSlug: discoveryAppSlug,
            failure: "target_not_found",
            currentStep: actionTarget.action,
            currentUrl: page.url(),
            snapshotSummary: {
              title: currentSnapshot.title,
              url: currentSnapshot.url,
              summary: currentSnapshot.summary
            },
            candidates: aiCandidates,
            runtimeEvidenceTrace: { attemptedLocators: resolution.attemptedLocators, matchReason: resolution.matchReason },
            structuralEvidence: diagnosis,
            feedbackEvidence: steps.slice(-5).map((s) => ({ index: s.index, status: s.status, targetText: s.targetText })),
            pendingAssertions: parsed.assertionTargets.map((a) => a.target),
            previousActions: steps.filter((s) => s.targetText).map((s) => `${s.action}: ${s.targetText}`),
            previousFills: planSteps.filter((s) => s.action === "fill").map((s) => `${s.description ?? "fill"}:${(s as any).valueKey ?? ""}`),
            constraints: [
              "forbid_action:fill",
              "forbid_action:select",
              "must_return_existing_candidate_id",
              "no_selector_invention"
            ]
          });
          const aiRepairDuration = Date.now() - aiRepairStartTime;

          console.log(`[ai-repair] decision=status ${aiRepair.status}`);
          console.log(`[ai-repair] validated=${aiRepair.status === "repaired_plan" || aiRepair.status === "no_safe_action" || aiRepair.status === "needs_more_context"}`);

          // Build comprehensive diagnostics for artifact
          const aiRepairDiagnostics = {
            enabled: true,
            providerName: aiRepair.diagnostics.provider ?? "unknown",
            model: process.env.AI_MODEL ?? "unknown",
            failureType: "target_not_found",
            target: actionTarget.target,
            contextPackSummary: {
              candidateCount: aiCandidates.length,
              hasSecrets: false, // Context pack redacts secrets internally
              maxContextChars: 30000
            },
            decisionStatus: aiRepair.status,
            validationStatus: aiRepair.status === "invalid_response" ? "invalid" : aiRepair.status === "provider_error" ? "error" : "valid",
            selectedCandidateId: aiRepair.decision?.candidateId ?? null,
            blockedReason: aiRepair.diagnostics.errorCode ?? null,
            durationMs: aiRepairDuration
          };

          (resolution as any).aiRepairDiagnostics = aiRepairDiagnostics;

          if (aiRepair.status === "repaired_plan" && aiRepair.decision?.candidateId) {
            const selected = currentSnapshot.elements.find((el) => el.id === aiRepair.decision!.candidateId);
            if (selected) {
              const resolvedFromAi = await resolveSnapshotElementLocator(page, {
                element: selected,
                target: actionTarget.target,
                candidateText: selected.text ?? selected.label ?? selected.name ?? selected.placeholder ?? actionTarget.target,
                type: selected.type,
                tagName: selected.tagName,
                confidence: aiRepair.decision.confidence ?? 0.5,
                matchReason: `ai_repair:${aiRepair.decision.repairType ?? "target_resolution"}`
              });
              if (resolvedFromAi.locator) {
                await clickResolvedTarget(resolvedFromAi.locator, false).catch(async () => {
                  await clickResolvedTarget(resolvedFromAi.locator!, true);
                });
                console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${actionTarget.target}"`);
                await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                await page.waitForTimeout(1000);

                const aiRecoveredScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                currentSnapshot = aiRecoveredScan.snapshot;
                allDiscoveredObjects.push(...aiRecoveredScan.objects);

                // Capture evidence after AI repair click completes
                await captureEvStep(actionTarget.action, "passed");

                steps.push({
                  index: actionTarget.index,
                  action: actionTarget.action,
                  status: "found",
                  targetText: actionTarget.target,
                  snapshotUrl: aiRecoveredScan.url,
                  snapshotTitle: aiRecoveredScan.title,
                  elementsFound: aiRecoveredScan.elementsCount,
                  evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
                  aiAssisted: true,
                  aiReason: "ai_repair_orchestrator",
                  semanticRole: actionTarget.semanticRole,
                  relationContext: actionTarget.relationContext
                });

                planSteps.push({
                  index: planSteps.length + 1,
                  action: "click",
                  description: actionTarget.action,
                  target: { strategy: "text", value: actionTarget.target, exact: false }
                });

                executedStepIndices.add(actionTarget.index);
                if (typeof currentActionOrder === "number") executedActionOrders.add(currentActionOrder);
                if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
                  break;
                }
                continue;
              }
            }
          }
        }

        // Route completion: attempt to insert missing intermediate step before declaring failure
        const appSlug = options.appSlug ?? "default";
        const routeCompletionConfig = (options as any)?.aiAssistedDiscovery?.config?.routeCompletion;
        const explicitRouteProfile = (options.scenario as any)?.routeProfile;
        const rcRouteProfile = routeCompletionConfig?.useAppProfile !== false ? loadRouteProfile(appSlug, explicitRouteProfile) : undefined;
        
        console.log(`[route-completion] app context appSlug=${appSlug} source=${options.appSlug ? "workflow" : "default-fallback"}`);
        
        const routeCompletionAttempted = routeCompletionConfig?.enabled === true;
        let routeCompletionResolution: MissingIntermediateStepResolution | undefined;
        let routeCompletionDiagnostics: any = undefined;

        if (routeCompletionAttempted) {
          console.log(`[route-completion] attempted step=${actionTarget.index} failure=target_not_found`);
          console.log(`[route-completion] routeProfile loaded=${Boolean(rcRouteProfile)} appSlug=${appSlug}`);
          
          const currentRouteHistory = steps
            .filter((s) => (s as any).status === "passed" && s.targetText)
            .map((s) => s.targetText!);
          
          const lastSuccessfulTarget = currentRouteHistory[currentRouteHistory.length - 1];
          console.log(`[route-completion] routeHistory=[${currentRouteHistory.join(", ")}] lastSuccessfulTarget=${lastSuccessfulTarget ?? "none"}`);
          
          const aiCandidates: DiscoveryCandidate[] = currentSnapshot.elements.map((el) => ({
            candidateId: el.id,
            role: el.role,
            name: el.name,
            text: el.text,
            visible: Boolean(el.visible),
            enabled: isSnapshotElementEnabled(el),
            clickable: isSnapshotElementClickable(el),
            editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
            sensitive: false
          }));

          const snapshot: DiscoverySnapshot = {
            url: currentSnapshot.url,
            title: currentSnapshot.title,
            visibleHeadings: [],
            visibleNavItems: [],
            visibleActions: [],
            visibleTextSummary: []
          };

          const insertedStepsSoFar = (steps as any).insertedSteps?.length ?? 0;

          routeCompletionResolution = resolveMissingIntermediateStep({
            appSlug,
            routeProfile: rcRouteProfile,
            currentRouteHistory,
            currentStepText: actionTarget.action,
            currentTarget: actionTarget.target,
            failureType: "target_not_found",
            snapshot,
            candidates: aiCandidates,
            insertedStepsSoFar,
            config: {
              enabled: routeCompletionConfig?.enabled ?? false,
              minConfidence: routeCompletionConfig?.minConfidence ?? 0.75,
              maxInsertedSteps: routeCompletionConfig?.maxInsertedSteps ?? 1,
              useAppProfile: routeCompletionConfig?.useAppProfile ?? true,
              allowGeneric: routeCompletionConfig?.allowGeneric ?? true
            }
          });

          console.log(`[route-completion] appSlug=${appSlug} routeProfileUsed=${Boolean(rcRouteProfile)}`);

          if (routeCompletionResolution.status === "repaired_plan" && routeCompletionResolution.candidateId) {
            const selectedCandidate = aiCandidates.find((c) => c.candidateId === routeCompletionResolution!.candidateId);
            console.log(`[route-completion] selected candidate="${selectedCandidate?.name ?? selectedCandidate?.text}" source=${routeCompletionResolution.source} confidence=${routeCompletionResolution.confidence}`);

            const selectedElement = currentSnapshot.elements.find((el) => el.id === routeCompletionResolution!.candidateId);

            if (selectedElement) {
              const resolvedInserted = await resolveSnapshotElementLocator(page, {
                element: selectedElement,
                target: routeCompletionResolution.insertedStepText ?? actionTarget.target,
                candidateText: selectedElement.text ?? selectedElement.label ?? selectedElement.name ?? routeCompletionResolution.insertedStepText!,
                type: selectedElement.type,
                tagName: selectedElement.tagName,
                confidence: routeCompletionResolution.confidence ?? 0.75,
                matchReason: "route_completion_intermediate_step"
              });

              if (resolvedInserted.locator) {
                try {
                  await clickResolvedTarget(resolvedInserted.locator, false);
                  console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${routeCompletionResolution.insertedStepText ?? actionTarget.target}"`);
                  await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                  await page.waitForTimeout(1000);
                  console.log(`[route-completion] inserted step executed`);

                  // Capture evidence for inserted route completion step
                  const insertedActionDesc = `Clic en "${routeCompletionResolution.insertedStepText ?? actionTarget.target}".`;
                  await captureEvStep(insertedActionDesc, "passed");

                  const insertedStepResult = {
                    originalStepIndex: actionTarget.index,
                    insertedBeforeStepIndex: actionTarget.index,
                    reason: "missing_intermediate_step",
                    target: routeCompletionResolution.insertedStepText,
                    candidateId: routeCompletionResolution.candidateId,
                    confidence: routeCompletionResolution.confidence,
                    source: routeCompletionResolution.source,
                    executed: true,
                    retrySucceeded: false
                  };

                  if (!(steps as any).insertedSteps) {
                    (steps as any).insertedSteps = [];
                  }
                  (steps as any).insertedSteps.push(insertedStepResult);

                  // Add inserted step to execution plan as a functional step
                  // This preserves the ordinal selection for spec generation
                  const insertedStepIndex = routeCompletionResolution.insertedStepText || actionTarget.target;
                  const isOrdinalSelection = /primer|primera|first|visible|listado/i.test(insertedStepIndex);
                  
                  // Use generic ordinal description if candidate contains dynamic data (masked numbers, etc.)
                  const insertedStepTextSafe = routeCompletionResolution.insertedStepText || "producto";
                  const hasDynamicData = /\*\*\*\s*\d|\d{4}\s*\*\*\*|^\d{3,}/.test(insertedStepTextSafe);
                  const genericOrdinalTarget = hasDynamicData 
                    ? `el primer ${inferProductType(insertedStepTextSafe)} visible del listado`
                    : insertedStepTextSafe;
                  
                  planSteps.push({
                    index: planSteps.length + 1,
                    action: "click",
                    description: genericOrdinalTarget,
                    target: {
                      strategy: "text" as LocatorStrategy,
                      value: genericOrdinalTarget,
                      exact: false,
                      metadata: {
                        originalTarget: actionTarget.target,
                        resolvedTargetName: routeCompletionResolution.insertedStepText,
                        resolvedCandidateId: routeCompletionResolution.candidateId,
                        aiAssisted: false,
                        repairType: "route_completion"
                      }
                    },
                    locatorStrategy: "ordinal_selection",
                    recoveryMetadata: {
                      recoveredBy: "route_completion",
                      ordinalSelectionDiagnostics: {
                        selectionPatternDetected: true,
                        ordinal: "first",
                        selectedCandidateText: routeCompletionResolution.insertedStepText,
                        selectedCandidateId: routeCompletionResolution.candidateId
                      },
                      selectedCandidateId: routeCompletionResolution.candidateId,
                      selectedCandidateText: routeCompletionResolution.insertedStepText,
                      transitionDetected: true,
                      executedAction: "click"
                    }
                  });

                  console.log(`[route-completion] retrying original step`);

                  const rescanAfterInsert = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                  currentSnapshot = rescanAfterInsert.snapshot;

                  const resolvedRetry = await resolveActionTarget(
                    page,
                    currentSnapshot,
                    actionTarget.target,
                    {
                      semanticRole: actionTarget.semanticRole,
                      relationContext: actionTarget.relationContext,
                      activeContainer,
                      routeProfile,
                      actionText: actionTarget.action
                    }
                  );

                  if (resolvedRetry.status === "resolved" && resolvedRetry.locator) {
                    try {
                      await clickResolvedTarget(resolvedRetry.locator, false);
                      console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${actionTarget.target}"`);
                      await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                      await page.waitForTimeout(1000);
                      console.log(`[route-completion] retry succeeded`);

                      // Capture evidence for retry after route completion
                      await captureEvStep(actionTarget.action, "passed");

                      insertedStepResult.retrySucceeded = true;

                      const aiRecoveredScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                      currentSnapshot = aiRecoveredScan.snapshot;
                      allDiscoveredObjects.push(...aiRecoveredScan.objects);

                      // Capture evidence after route completion click completes
                      await captureEvStep(actionTarget.action, "passed");

                      steps.push({
                        index: actionTarget.index,
                        action: actionTarget.action,
                        status: "passed" as any,
                        targetText: actionTarget.target,
                        snapshotUrl: currentSnapshot.url,
                        snapshotTitle: currentSnapshot.title,
                        elementsFound: currentSnapshot.elements.length,
                        recoveredBy: "route_completion" as any,
                        recoveryStatus: "recovered",
                        routeCompletionDiagnostics: {
                          attempted: true,
                          enabled: routeCompletionConfig?.enabled ?? false,
                          appSlug,
                          routeProfileUsed: Boolean(routeProfile),
                          source: routeCompletionResolution.source,
                          selectedCandidateId: routeCompletionResolution.candidateId,
                          selectedCandidateText: routeCompletionResolution.insertedStepText,
                          retrySucceeded: true
                        }
                      });

                      executedStepIndices.add(actionTarget.index);
                      if (typeof currentActionOrder === "number") executedActionOrders.add(currentActionOrder);
                      
                      // Route profile learning: observe successful route completion
                      if (routeProfileLearningConfig.enabled && routeCompletionResolution?.insertedStepText) {
                        const currentRouteHistory = steps
                          .filter((s) => (s as any).status === "passed" || (s as any).status === "found")
                          .filter((s) => s.index !== actionTarget.index) // Exclude current step
                          .map((s) => s.targetText!)
                          .filter(Boolean);
                        const lastSuccessfulTarget = currentRouteHistory[currentRouteHistory.length - 1];
                        
                        const learningResult = observeRouteCompletionSuccess(
                          {
                            target: routeCompletionResolution.insertedStepText,
                            candidateId: routeCompletionResolution.candidateId,
                            source: routeCompletionResolution.source
                          },
                          lastSuccessfulTarget || "entry",
                          options.appSlug ?? "default",
                          routeProfileLearningConfig
                        );
                        
                        if (learningResult.suggestion) {
                          routeProfileSuggestions.push(learningResult.suggestion);
                          console.log(`[route-learning] observed route completion from="${learningResult.suggestion.from}" to="${learningResult.suggestion.to}" relation=${learningResult.suggestion.relation}`);
                        }
                      }
                      
                      if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
                        break;
                      }
                      continue;
                    } catch (retryErr) {
                      console.log(`[route-completion] retry failed`);
                      insertedStepResult.retrySucceeded = false;
                    }
                  } else {
                    console.log(`[route-completion] retry resolution failed status=${resolvedRetry.status}`);
                    insertedStepResult.retrySucceeded = false;
                  }
                } catch (insertErr) {
                  console.log(`[route-completion] inserted step execution failed`);
                }
              }
            }
          } else {
            console.log(`[route-completion] blocked: ${routeCompletionResolution.blockedReason ?? "no_safe_action"}`);
            // Attempt adaptive route discovery
            try {
              const { initAdaptiveRoute, runAdaptiveRouteDiscovery } = await import("./adaptive-route");
              const currentChain = ["navigation", "selection"];
              const required = [["navigation","selection","submit"],["navigation","fill","submit"]];
              const state = initAdaptiveRoute("target_screen", currentChain, required);
              const visibleTexts = currentSnapshot.elements.map((e: any) => e.text || e.label || "").filter(Boolean);
              // Provide AI provider if available for scenario generation
              let aiProvider: any = undefined;
              try {
                const { createScenarioAiProvider } = await import("../scenarios/codex-scenario-generator");
                aiProvider = await createScenarioAiProvider();
              } catch { /* no AI provider */ }
              const result = await runAdaptiveRouteDiscovery(page, state, visibleTexts, aiProvider);
              if (result.result === "reached") {
                console.log(`[adaptive-route] reached targetScreen steps=${result.stepsTaken} learned=${result.learnedSteps.length}`);
              } else {
                console.log(`[adaptive-route] blocked reason=${result.reason} steps=${result.stepsTaken}`);
              }
            } catch { /* adaptive route not available */ }
          }

          routeCompletionDiagnostics = {
            attempted: true,
            enabled: routeCompletionConfig?.enabled ?? false,
            appSlug,
            routeProfileUsed: Boolean(routeProfile),
            source: routeCompletionResolution?.source,
            selectedCandidateId: routeCompletionResolution?.candidateId,
            selectedCandidateText: routeCompletionResolution?.insertedStepText,
            blockedReason: routeCompletionResolution?.blockedReason,
            retrySucceeded: routeCompletionResolution?.status === "repaired_plan" ? (steps as any).insertedSteps?.[(steps as any).insertedSteps.length - 1]?.retrySucceeded : undefined
          };
        }

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: errorMsg,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          resolutionDiagnosis: diagnosis,
          aiDiagnostics: (resolution as any).aiDiagnostics,
          aiRepairDiagnostics: (resolution as any).aiRepairDiagnostics,
          routeCompletionDiagnostics: routeCompletionDiagnostics,
          semanticRole: actionTarget.semanticRole,
          relationContext: actionTarget.relationContext,
          earlyCompletionDiagnostics: earlyCompletion
        } as any);

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "target_not_found";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status === "ambiguous") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const ambiguousReason = actionTarget.associatedEntity
          ? `Ambiguous target: ${resolution.matchReason} (${resolution.candidates?.length ?? 0} matches). Target has associated entity "${actionTarget.associatedEntity}" that could disambiguate context.`
          : `Ambiguous target: ${resolution.matchReason} (${resolution.candidates?.length ?? 0} matches).`;

        // AI Repair for selection: attempt selection_resolution after local resolvers fail due to ambiguity
        if (envTrue("AI_REPAIR_ENABLED", false) && envTrue("AI_REPAIR_USE_CONTEXT_PACK", true)) {
          const aiSelectionStartTime = Date.now();
          console.log(`[ai-repair:selection] enabled provider=${process.env.AI_PROVIDER ?? "unknown"} model=${process.env.AI_MODEL ?? "unknown"}`);
          console.log(`[ai-repair:selection] failure=ambiguous_selection target="${actionTarget.target}"`);

          // Build enriched selection candidates from snapshot with full card context
          // This harvests all visible product cards, not just resolution matches
          const selectionCandidates = buildSelectionCandidatesFromSnapshot(
            currentSnapshot,
            actionTarget.target,
            resolution.candidates
          );

          console.log(`[ai-repair:selection] context selectionCandidates=${selectionCandidates.length} (harvested from snapshot)`);
          if (selectionCandidates.length > 0) {
            console.log(`[ai-repair:selection] top candidates: ${selectionCandidates.slice(0, 3).map(c => `"${c.name}"`).join(", ")}`);
          }

          const aiSelectionRepair = await runAiRepairOrchestrator({
            appSlug: discoveryAppSlug,
            failure: "ambiguous_selection",
            failureType: "ambiguous_selection",
            currentStep: actionTarget.action,
            currentUrl: page.url(),
            snapshotSummary: {
              title: currentSnapshot.title,
              url: currentSnapshot.url,
              summary: currentSnapshot.summary
            },
            candidates: selectionCandidates,
            runtimeEvidenceTrace: { attemptedLocators: resolution.attemptedLocators, matchReason: resolution.matchReason },
            structuralEvidence: [],
            feedbackEvidence: steps.slice(-5).map((s) => ({ index: s.index, status: s.status, targetText: s.targetText })),
            pendingAssertions: parsed.assertionTargets.map((a) => a.target),
            previousActions: steps.filter((s) => s.targetText).map((s) => `${s.action}: ${s.targetText}`),
            previousFills: planSteps.filter((s) => s.action === "fill").map((s) => `${s.description ?? "fill"}:${(s as any).valueKey ?? ""}`),
            constraints: [
              "forbid_action:fill",
              "must_return_existing_candidate_id",
              "no_selector_invention",
              "no_sensitive_selection"
            ],
            selectionTarget: actionTarget.target,
            selectionIntent: actionTarget.action,
            selectionCandidates,
            currentScreen: {
              url: currentSnapshot.url,
              title: currentSnapshot.title,
              visibleHeadings: [],
              visibleLists: [],
              visibleDialogs: []
            }
          });
          const aiSelectionDuration = Date.now() - aiSelectionStartTime;

          console.log(`[ai-repair:selection] decision=status ${aiSelectionRepair.status}`);
          console.log(`[ai-repair:selection] validated=${aiSelectionRepair.status === "repaired_plan" || aiSelectionRepair.status === "no_safe_action" || aiSelectionRepair.status === "needs_more_context"}`);

          // Build comprehensive diagnostics for artifact
          const aiSelectionDiagnostics = {
            enabled: true,
            providerName: String(aiSelectionRepair.diagnostics.provider ?? "unknown"),
            model: process.env.AI_MODEL ?? "unknown",
            failureType: "ambiguous_selection",
            repairType: "selection_resolution" as const,  // NEW: Include repairType for metrics
            selectionTarget: actionTarget.target,
            contextPackSummary: {
              selectionCandidateCount: selectionCandidates.length,
              hasSecrets: false,
              maxContextChars: 30000
            },
            decisionStatus: aiSelectionRepair.status,
            validationStatus: aiSelectionRepair.status === "invalid_response" ? "invalid" : aiSelectionRepair.status === "provider_error" ? "error" : "valid",
            selectedCandidateId: aiSelectionRepair.decision?.candidateId ?? null,
            selectionStatus: aiSelectionRepair.decision?.selectionStatus ?? null,
            blockedReason: (aiSelectionRepair.diagnostics.errorCode as string) ?? null,
            durationMs: aiSelectionDuration
          };

          (resolution as any).aiSelectionRepairDiagnostics = aiSelectionDiagnostics;

          // If AI selected a valid candidate, execute the selection
          if (aiSelectionRepair.status === "repaired_plan" && aiSelectionRepair.decision?.candidateId) {
            const selected = currentSnapshot.elements.find((el) => el.id === aiSelectionRepair.decision!.candidateId);
            if (selected) {
              const resolvedFromAi = await resolveSnapshotElementLocator(page, {
                element: selected,
                target: actionTarget.target,
                candidateText: selected.text ?? selected.label ?? selected.name ?? actionTarget.target,
                type: selected.type,
                tagName: selected.tagName,
                confidence: aiSelectionRepair.decision.confidence ?? 0.5,
                matchReason: `ai_repair:selection_resolution`
              });
              if (resolvedFromAi.locator) {
                await clickResolvedTarget(resolvedFromAi.locator, false).catch(async () => {
                  await clickResolvedTarget(resolvedFromAi.locator!, true);
                });
                console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${actionTarget.target}"`);
                await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                await page.waitForTimeout(1000);

                const aiRecoveredScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                currentSnapshot = aiRecoveredScan.snapshot;
                allDiscoveredObjects.push(...aiRecoveredScan.objects);

                // Capture evidence after AI selection resolution
                await captureEvStep(actionTarget.action, "passed");

                // Resolved target name from AI selection
                const resolvedTargetName = selected.name ?? selected.label ?? selected.text ?? actionTarget.target;
                const resolvedCandidateId = aiSelectionRepair.decision.candidateId;

                steps.push({
                  index: actionTarget.index,
                  action: actionTarget.action,
                  status: "found",
                  targetText: actionTarget.target,
                  resolvedTargetName,  // NEW: Resolved target from AI
                  resolvedCandidateId,  // NEW: Candidate ID selected by AI
                  resolvedLocator: resolvedFromAi.locator.toString(),  // NEW: Actual locator
                  resolvedRole: selected.role ?? selected.type ?? "unknown",  // NEW: Element role
                  snapshotUrl: aiRecoveredScan.url,
                  snapshotTitle: aiRecoveredScan.title,
                  elementsFound: aiRecoveredScan.elementsCount,
                  evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
                  aiAssisted: true,
                  aiReason: "ai_selection_resolution",
                  aiRepairType: "selection_resolution" as const,
                  aiDecisionStatus: "repaired_plan" as const,
                  aiValidationStatus: "valid" as const,
                  aiSelectionRepairDiagnostics: aiSelectionDiagnostics,  // NEW: Include diagnostics for metrics
                  semanticRole: actionTarget.semanticRole,
                  relationContext: actionTarget.relationContext
                });

                planSteps.push({
                  index: planSteps.length + 1,
                  action: "click",
                  description: actionTarget.action,
                  target: { 
                    strategy: "text" as const, 
                    value: resolvedTargetName,  // NEW: Use resolved target name, not original
                    exact: false,
                    // NEW: Metadata for AI-assisted resolution
                    metadata: {
                      originalTarget: actionTarget.target,
                      resolvedTargetName,
                      resolvedCandidateId,
                      aiAssisted: true,
                      aiReason: "ai_selection_resolution",
                      repairType: "selection_resolution",
                      decisionStatus: "repaired_plan",
                      validationStatus: "valid"
                    }
                  }
                });

                executedStepIndices.add(actionTarget.index);
                if (typeof currentActionOrder === "number") executedActionOrders.add(currentActionOrder);
                if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
                  break;
                }
                continue;
              }
            }
          }

          // AI returned no_safe_action or invalid response - fail without click
          if (aiSelectionRepair.status === "no_safe_action") {
            console.log(`[discovery:case] Selection unresolved safely; no click executed.`);
          }
        }

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: ambiguousReason,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          aiDiagnostics: (resolution as any).aiDiagnostics,
          aiSelectionRepairDiagnostics: (resolution as any).aiSelectionRepairDiagnostics,
          semanticRole: actionTarget.semanticRole,
          relationContext: actionTarget.relationContext,
          earlyCompletionDiagnostics: earlyCompletion
        } as any);

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = actionTarget.associatedEntity ? "needs_associated_target_resolution" : "ambiguous_target";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (resolution.status === "locator_resolution_failed") {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "locator_resolution_failed",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: `Semantic target matched, but DOM locator resolution failed. Attempted locators: ${((resolution as any).attemptedLocators ?? []).join(" | ")}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          resolutionDiagnosis: (resolution as typeof resolution & { _diagnosis?: unknown[] })._diagnosis,
          attemptedLocators: (resolution as any).attemptedLocators,
          candidateId: resolution.candidateId,
          semanticRole: actionTarget.semanticRole,
          relationContext: actionTarget.relationContext,
          earlyCompletionDiagnostics: earlyCompletion,
          candidateText: resolution.candidateText,
          aiDiagnostics: (resolution as any).aiDiagnostics
        } as any);

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "locator_resolution_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }

      if (!resolution.locator) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: `Target resolved but no locator found in DOM. Match reason: ${resolution.matchReason}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          aiDiagnostics: (resolution as any).aiDiagnostics
        } as any);

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "locator_not_found";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
    }

    if (resolution.status !== "resolved" || !finalLocator) {
      continue;
    }

    // Pre-click guard: evaluate route completion for weak deterministic resolutions
    const selectionThreshold = getSelectionConfidenceThreshold();
    const isSelectionLikeForPreClick = isSelectionLikeTargetNew(actionTarget.target);
    const isWeakResolution = resolution.confidence < selectionThreshold && isSelectionLikeForPreClick;
    
    let preClickRouteCompletionAttempted = false;
    let preClickRouteCompletionResolution: MissingIntermediateStepResolution | undefined;
    let preClickRouteCompletionDiagnostics: any = undefined;
    let routeCompletionPreventedWeakClick = false;

    if (isWeakResolution) {
      console.log(`[route-completion] pre-click guard evaluating step=${actionTarget.index} target="${actionTarget.target}" confidence=${resolution.confidence.toFixed(2)} strategy=${resolution.locatorStrategy}`);
      
      const appSlug = options.appSlug ?? "default";
      const routeCompletionConfig = (options as any)?.aiAssistedDiscovery?.config?.routeCompletion;
      
      console.log(`[route-completion] app context appSlug=${appSlug} source=${options.appSlug ? "workflow" : "default-fallback"}`);
      console.log(`[route-completion] config enabled=${routeCompletionConfig?.enabled ?? false} minConfidence=${routeCompletionConfig?.minConfidence ?? 0.75} maxInsertedSteps=${routeCompletionConfig?.maxInsertedSteps ?? 1}`);
      
      if (routeCompletionConfig?.enabled !== true) {
        console.log(`[route-completion] skipped: routeCompletion not enabled in config`);
      } else {
        const explicitRouteProfile = (options.scenario as any)?.routeProfile;
        const rcRouteProfile = routeCompletionConfig?.useAppProfile !== false ? loadRouteProfile(appSlug, explicitRouteProfile) : undefined;
        
        if (!rcRouteProfile) {
          console.log(`[route-completion] routeProfile missing appSlug=${appSlug} source=loadRouteProfile returned undefined`);
        } else {
          console.log(`[route-completion] routeProfile loaded appSlug=${appSlug} routes=${rcRouteProfile.routes?.length ?? 0}`);
        }
        
        const currentRouteHistory = steps
          .filter((s) => (s as any).status === "passed" && s.targetText)
          .map((s) => s.targetText!);
        
        console.log(`[route-completion] routeHistory=[${currentRouteHistory.join(", ")}] lastSuccessfulTarget=${currentRouteHistory[currentRouteHistory.length - 1] ?? "none"}`);
        
        const aiCandidates: DiscoveryCandidate[] = currentSnapshot.elements.map((el) => ({
          candidateId: el.id,
          role: el.role,
          name: el.name,
          text: el.text,
          visible: Boolean(el.visible),
          enabled: isSnapshotElementEnabled(el),
          clickable: isSnapshotElementClickable(el),
          editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
          sensitive: false
        }));

        // Log candidates summary
        const clickableCandidates = aiCandidates.filter((c) => c.visible && c.clickable);
        const visibleClickableLabels = clickableCandidates.slice(0, 10).map((c) => c.name ?? c.text ?? "unknown");
        const submitLikeCount = clickableCandidates.filter((c: any) => {
          const metadata = c.metadata ?? c;
          const intent = String(metadata.actionIntent ?? "").toLowerCase();
          const role = String(metadata.targetRole ?? metadata.role ?? "").toLowerCase();
          return intent === "submit" || intent === "confirm" || role === "submit";
        }).length;
        const sensitiveCount = aiCandidates.filter((c) => c.sensitive).length;
        
        console.log(`[route-completion] candidates summary total=${aiCandidates.length} clickable=${clickableCandidates.length} visibleClickable=[${visibleClickableLabels.join(",")}] submitLikeBlocked=${submitLikeCount} sensitiveBlocked=${sensitiveCount}`);

        const snapshot: DiscoverySnapshot = {
          url: currentSnapshot.url,
          title: currentSnapshot.title,
          visibleHeadings: [],
          visibleNavItems: [],
          visibleActions: [],
          visibleTextSummary: []
        };

        const insertedStepsSoFar = (steps as any).insertedSteps?.length ?? 0;

        console.log(`[route-completion] calling resolver failureType=weak_deterministic_resolution insertedStepsSoFar=${insertedStepsSoFar}`);

        preClickRouteCompletionResolution = resolveMissingIntermediateStep({
          appSlug,
          routeProfile: rcRouteProfile,
          currentRouteHistory,
          lastSuccessfulTarget: currentRouteHistory[currentRouteHistory.length - 1],
          currentStepText: actionTarget.action,
          currentTarget: actionTarget.target,
          failureType: "weak_deterministic_resolution",
          snapshot,
          candidates: aiCandidates,
          insertedStepsSoFar,
          config: {
            enabled: routeCompletionConfig?.enabled ?? false,
            minConfidence: routeCompletionConfig?.minConfidence ?? 0.75,
            maxInsertedSteps: routeCompletionConfig?.maxInsertedSteps ?? 1,
            useAppProfile: routeCompletionConfig?.useAppProfile ?? true,
            allowGeneric: routeCompletionConfig?.allowGeneric ?? true
          },
          deterministicResolutionConfidence: resolution.confidence,
          deterministicResolutionStrategy: resolution.locatorStrategy
        });

        preClickRouteCompletionAttempted = true;
        console.log(`[route-completion] attempted step=${actionTarget.index} failure=weak_deterministic_resolution appSlug=${appSlug} routeProfileLoaded=${Boolean(routeProfile)} candidates=${aiCandidates.length}`);
        console.log(`[route-completion] resolver returned status=${preClickRouteCompletionResolution.status} source=${preClickRouteCompletionResolution.source}`);

        if (preClickRouteCompletionResolution.status === "repaired_plan" && preClickRouteCompletionResolution.candidateId) {
          const selectedCandidate = aiCandidates.find((c) => c.candidateId === preClickRouteCompletionResolution!.candidateId);
          console.log(`[route-completion] selected candidate="${selectedCandidate?.name ?? selectedCandidate?.text}" source=${preClickRouteCompletionResolution.source} confidence=${preClickRouteCompletionResolution.confidence}`);

          const selectedElement = currentSnapshot.elements.find((el) => el.id === preClickRouteCompletionResolution!.candidateId);
          
          if (selectedElement) {
            const resolvedInserted = await resolveSnapshotElementLocator(page, {
              element: selectedElement,
              target: preClickRouteCompletionResolution.insertedStepText ?? actionTarget.target,
              candidateText: selectedElement.text ?? selectedElement.label ?? selectedElement.name ?? preClickRouteCompletionResolution.insertedStepText!,
              type: selectedElement.type,
              tagName: selectedElement.tagName,
              confidence: preClickRouteCompletionResolution.confidence ?? 0.75,
              matchReason: "route_completion_intermediate_step"
            });

            if (resolvedInserted.locator) {
              try {
                await clickResolvedTarget(resolvedInserted.locator, false);
                console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${preClickRouteCompletionResolution.insertedStepText ?? actionTarget.target}"`);
                await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                await page.waitForTimeout(1000);
                console.log(`[route-completion] inserted step executed`);

                // Capture evidence for pre-click route completion inserted step
                const insertedActionDesc = `Clic en "${preClickRouteCompletionResolution.insertedStepText ?? actionTarget.target}".`;
                await captureEvStep(insertedActionDesc, "passed");

                const insertedStepResult = {
                  originalStepIndex: actionTarget.index,
                  insertedBeforeStepIndex: actionTarget.index,
                  reason: "missing_intermediate_step",
                  target: preClickRouteCompletionResolution.insertedStepText,
                  candidateId: preClickRouteCompletionResolution.candidateId,
                  confidence: preClickRouteCompletionResolution.confidence,
                  source: preClickRouteCompletionResolution.source,
                  executed: true,
                  retrySucceeded: false
                };

                if (!(steps as any).insertedSteps) {
                  (steps as any).insertedSteps = [];
                }
                (steps as any).insertedSteps.push(insertedStepResult);

                // Add inserted step to execution plan as a functional step
                const insertedStepText = preClickRouteCompletionResolution.insertedStepText || actionTarget.target;
                const isOrdinalSelection = /primer|primera|first|visible|listado/i.test(insertedStepText);
                
                // Use generic ordinal description if candidate contains dynamic data
                const insertedStepTextSafe = preClickRouteCompletionResolution.insertedStepText || "producto";
                const hasDynamicData = /\*\*\*\s*\d|\d{4}\s*\*\*\*|^\d{3,}/.test(insertedStepTextSafe);
                const genericOrdinalTarget = hasDynamicData 
                  ? `el primer ${inferProductType(insertedStepTextSafe)} visible del listado`
                  : insertedStepTextSafe;
                
                planSteps.push({
                  index: planSteps.length + 1,
                  action: "click",
                  description: genericOrdinalTarget,
                  target: {
                    strategy: "text" as LocatorStrategy,
                    value: genericOrdinalTarget,
                    exact: false,
                    metadata: {
                      originalTarget: actionTarget.target,
                      resolvedTargetName: preClickRouteCompletionResolution.insertedStepText,
                      resolvedCandidateId: preClickRouteCompletionResolution.candidateId,
                      aiAssisted: false,
                      repairType: "route_completion"
                    }
                  },
                  locatorStrategy: "ordinal_selection",
                  recoveryMetadata: {
                    recoveredBy: "route_completion",
                    ordinalSelectionDiagnostics: {
                      selectionPatternDetected: true,
                      ordinal: "first",
                      selectedCandidateText: preClickRouteCompletionResolution.insertedStepText,
                      selectedCandidateId: preClickRouteCompletionResolution.candidateId
                    },
                    selectedCandidateId: preClickRouteCompletionResolution.candidateId,
                    selectedCandidateText: preClickRouteCompletionResolution.insertedStepText,
                    transitionDetected: true,
                    executedAction: "click"
                  }
                });

                console.log(`[route-completion] retrying original step`);

                const rescanAfterInsert = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                currentSnapshot = rescanAfterInsert.snapshot;

                  const resolvedRetry = await resolveActionTarget(
                    page,
                    currentSnapshot,
                    actionTarget.target,
                    {
                      semanticRole: actionTarget.semanticRole,
                      relationContext: actionTarget.relationContext,
                      activeContainer,
                      routeProfile,
                      actionText: actionTarget.action
                    }
                  );

                if (resolvedRetry.status === "resolved" && resolvedRetry.locator) {
                  try {
                    await clickResolvedTarget(resolvedRetry.locator, false);
                    console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${actionTarget.target}"`);
                    await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                    await page.waitForTimeout(1000);
                    console.log(`[route-completion] retry succeeded`);

                    // Capture evidence for pre-click route completion retry
                    await captureEvStep(actionTarget.action, "passed");

                    insertedStepResult.retrySucceeded = true;
                    routeCompletionPreventedWeakClick = true;

                    const aiRecoveredScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                    currentSnapshot = aiRecoveredScan.snapshot;
                    allDiscoveredObjects.push(...aiRecoveredScan.objects);

                    steps.push({
                      index: actionTarget.index,
                      action: actionTarget.action,
                      status: "found" as any,
                      targetText: actionTarget.target,
                      snapshotUrl: currentSnapshot.url,
                      snapshotTitle: currentSnapshot.title,
                      elementsFound: currentSnapshot.elements.length,
                      recoveredBy: "route_completion" as any,
                      recoveryStatus: "recovered",
                      routeCompletionDiagnostics: {
                        attempted: true,
                        enabled: routeCompletionConfig?.enabled ?? false,
                        appSlug,
                        routeProfileUsed: Boolean(routeProfile),
                        trigger: "pre_click_weak_resolution",
                        source: preClickRouteCompletionResolution.source,
                        selectedCandidateId: preClickRouteCompletionResolution.candidateId,
                        selectedCandidateText: preClickRouteCompletionResolution.insertedStepText,
                        deterministicResolutionConfidence: resolution.confidence,
                        deterministicResolutionStrategy: resolution.locatorStrategy,
                        retrySucceeded: true
                      }
                    });

                    executedStepIndices.add(actionTarget.index);
                    if (typeof currentActionOrder === "number") executedActionOrders.add(currentActionOrder);
                    
                    // Route profile learning: observe successful route completion (pre-click weak resolution)
                    if (routeProfileLearningConfig.enabled && preClickRouteCompletionResolution?.insertedStepText) {
                      const currentRouteHistory = steps
                        .filter((s) => (s as any).status === "passed" || (s as any).status === "found")
                        .filter((s) => s.index !== actionTarget.index) // Exclude current step
                        .map((s) => s.targetText!)
                        .filter(Boolean);
                      const lastSuccessfulTarget = currentRouteHistory[currentRouteHistory.length - 1];
                      
                      const learningResult = observeRouteCompletionSuccess(
                        {
                          target: preClickRouteCompletionResolution.insertedStepText,
                          candidateId: preClickRouteCompletionResolution.candidateId,
                          source: preClickRouteCompletionResolution.source
                        },
                        lastSuccessfulTarget || "entry",
                        options.appSlug ?? "default",
                        routeProfileLearningConfig
                      );
                      
                      if (learningResult.suggestion) {
                        routeProfileSuggestions.push(learningResult.suggestion);
                        console.log(`[route-learning] observed pre-click route completion from="${learningResult.suggestion.from}" to="${learningResult.suggestion.to}" relation=${learningResult.suggestion.relation}`);
                      }
                    }
                    
                    if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
                      break;
                    }
                    continue;
                  } catch (retryErr) {
                    console.log(`[route-completion] retry failed`);
                    insertedStepResult.retrySucceeded = false;
                  }
                } else {
                  console.log(`[route-completion] retry resolution failed status=${resolvedRetry.status}`);
                  insertedStepResult.retrySucceeded = false;
                }
              } catch (insertErr) {
                console.log(`[route-completion] inserted step execution failed`);
              }
            }
          } else {
            console.log(`[route-completion] blocked: ${preClickRouteCompletionResolution.blockedReason ?? "no_safe_action"} reason="${preClickRouteCompletionResolution.reason}"`);
          }
        } else {
          console.log(`[route-completion] no_safe_action returned reason="${preClickRouteCompletionResolution.reason}"`);
        }

        preClickRouteCompletionDiagnostics = {
          attempted: true,
          enabled: routeCompletionConfig?.enabled ?? false,
          appSlug,
          routeProfileUsed: Boolean(routeProfile),
          trigger: "pre_click_weak_resolution",
          source: preClickRouteCompletionResolution?.source,
          selectedCandidateId: preClickRouteCompletionResolution?.candidateId,
          selectedCandidateText: preClickRouteCompletionResolution?.insertedStepText,
          blockedReason: preClickRouteCompletionResolution?.blockedReason,
          deterministicResolutionConfidence: resolution.confidence,
          deterministicResolutionStrategy: resolution.locatorStrategy
        };
      }
    }

    // Skip click if route completion already succeeded
    if (routeCompletionPreventedWeakClick) {
      continue;
    }

    // AUTH SETUP: consume login functional click if business flow already authenticated (prevent double login)
    if (typeof businessSetupSuccess !== "undefined" && businessSetupSuccess && loginStepsToConsume?.has(actionTarget.index)) {
      console.log(`[double-login-guard] skipping login target index=${actionTarget.index} target="${actionTarget.target}" doubleLoginPrevented=true`);
      continue;
    }

    console.log(`[discovery:case] Clicking target: ${actionTarget.target} (strategy: ${resolution.locatorStrategy}, confidence: ${resolution.confidence.toFixed(2)})`);

    const beforeState = await capturePageState(page);
    const pendingAssertion = parsed.assertionTargets
      .filter((candidate) => candidate.index > actionTarget.index)
      .sort((a, b) => a.index - b.index)[0];
    const assertionObservationBefore: AssertionObservationSnapshot | undefined = pendingAssertion
      ? await captureAssertionObservationSnapshot(page).catch(() => undefined)
      : undefined;
    if (assertionObservationBefore) {
      const refs = getCanonicalAssertionMetadata(scenario, pendingAssertion.index).refs;
      console.log(`[assertion-observation-before] requirementId=${refs[0]?.requirementId ?? "unresolved"} triggerCandidate=${actionTarget.index} observableCount=${assertionObservationBefore.controls.length + assertionObservationBefore.validationNodes.length}`);
    }

    // PRODUCT CARD CLICK: Try escalated click strategies ONLY for final product click
    let productCardClickResult: ProductCardClickResult | undefined;
    const isFinalProductClick = detailTarget && finalProductClickStepIndex === actionTarget.index;

    // Strong gate: only activate for final detail click
    const normalizeForComparison = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9áéíóúñü]/g, "");
    const targetMatchesDetail = detailTarget && (
      normalizeForComparison(actionTarget.target).includes(normalizeForComparison(detailTarget)) ||
      normalizeForComparison(detailTarget).includes(normalizeForComparison(actionTarget.target))
    );

    // Check if this is an ordinal step bound to detail target
    const isOrdinalBoundToDetail = isFinalProductClick &&
      (resolution.locatorStrategy === "ordinal_selection" ||
       (resolution as any).ordinalSelectionDiagnostics?.selectionPatternDetected === true);

    // Get the selected candidate text if this is an ordinal selection
    const ordinalSelectedCandidateText = (resolution as any).recoveryMetadata?.ordinalSelectionDiagnostics?.selectedCandidateText ||
                                         (resolution as any).ordinalSelectionDiagnostics?.selectedCandidateText;

    const shouldUseProductCardClick = isProductCardClickEligible({
      isFinalProductClick: Boolean(isFinalProductClick),
      targetMatchesDetail: Boolean(targetMatchesDetail),
      isOrdinalBoundToDetail: Boolean(isOrdinalBoundToDetail),
      finalLocatorPresent: Boolean(finalLocator),
      detailTargetSource
    });

    if (shouldUseProductCardClick) {
      // For ordinal selection with candidate, use the candidate text, not the detail target
      const clickTarget = isOrdinalBoundToDetail && ordinalSelectedCandidateText
        ? ordinalSelectedCandidateText
        : (isOrdinalBoundToDetail && detailTarget ? detailTarget : actionTarget.target);

      console.log(
        `[product-card-click] activated target="${clickTarget}" ` +
        `originalTarget="${actionTarget.target}" ` +
        `detailTarget="${detailTarget}" stepIndex=${actionTarget.index} ` +
        `finalProductClickStepIndex=${finalProductClickStepIndex} ` +
        `isOrdinal=${isOrdinalBoundToDetail}`
      );

      // INTERMEDIATE RECOVERY: Check if target is visible, if not try to recover missing intermediate step
      let intermediateRecoveryResult: IntermediateRecoveryResult | undefined;

      // When ordinal is bound to a concrete detail target AND has candidate, use the candidate for recovery
      // When ordinal has NO candidate but has detailTarget, use detailTarget
      const effectiveRecoveryTarget = isOrdinalBoundToDetail && ordinalSelectedCandidateText
        ? ordinalSelectedCandidateText
        : (isOrdinalBoundToDetail && detailTarget ? detailTarget : actionTarget.target);

      if (isOrdinalBoundToDetail && ordinalSelectedCandidateText && detailTarget) {
        console.log(
          `[detail-ordinal-binding] skipped reason=ordinal_candidate_preserved ` +
          `originalTarget="${actionTarget.target}" ` +
          `candidate="${ordinalSelectedCandidateText}" ` +
          `detailTarget="${detailTarget}"`
        );
      } else if (isOrdinalBoundToDetail && detailTarget) {
        console.log(
          `[detail-ordinal-binding] originalTarget="${actionTarget.target}" ` +
          `effectiveTarget="${detailTarget}"`
        );
      }

      try {
        intermediateRecoveryResult = await recoverMissingIntermediateForFinalTarget(
          page,
          effectiveRecoveryTarget,
          currentSnapshot,
          routeProfile as any,
          evidenceDir
        );

        if (intermediateRecoveryResult.recovered) {
          console.log(
            `[intermediate-recovery] success recovered=true ` +
            `selectedText="${intermediateRecoveryResult.selectedCandidate?.text}" ` +
            `score=${intermediateRecoveryResult.selectedCandidate?.score.toFixed(2)} ` +
            `urlAfter="${intermediateRecoveryResult.urlAfter}"`
          );

          // Rescan after recovery to get updated snapshot
          const postRecoveryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = postRecoveryScan.snapshot;

          // Record the intermediate step as inserted
          const insertedStep: DiscoveryStepResult = {
            index: actionTarget.index + 0.5, // Fractional index to indicate insertion (after current step)
            action: `Clic en "${intermediateRecoveryResult.selectedCandidate!.text}".`,
            targetText: intermediateRecoveryResult.selectedCandidate!.text,
            status: "found",
            confidence: intermediateRecoveryResult.selectedCandidate!.score,
            locatorStrategy: "intermediate_recovery",
            recoveryStatus: "recovered",
            recoveredBy: "route_completion",
            recoveryMetadata: {
              selectedCandidateText: intermediateRecoveryResult.selectedCandidate!.text,
              score: intermediateRecoveryResult.selectedCandidate!.score,
              rationale: `Intermediate subcategory recovery: URL before="${intermediateRecoveryResult.urlBefore}", after="${intermediateRecoveryResult.urlAfter}"`
            }
          };

          steps.push(insertedStep);

          // Normalize the inserted text for reuse in evidence and route learning
          const normalizedInsertedText = intermediateRecoveryResult.selectedCandidate!.text.replace(/\n/g, " ").trim();

          // Capture evidence screenshot for the intermediate recovered step
          if (evidenceRec) {
            try {
              const intermediateStepIndex = actionTarget.index + 0.5;
              const intermediateStepText = `Clic en "${normalizedInsertedText}"`;
              const intermediateRecord = await evidenceRec.captureStep(
                page,
                intermediateStepIndex,
                intermediateStepText,
                { target: normalizedInsertedText, status: "passed" }
              );
              if (intermediateRecord.screenshotPath) {
                insertedStep.evidencePath = intermediateRecord.screenshotPath;
                console.log(`[intermediate-recovery] evidence screenshot captured step=${intermediateStepIndex} path=${intermediateRecord.screenshotPath}`);
              }
            } catch (evErr: any) {
              console.log(`[intermediate-recovery] evidence screenshot failed: ${evErr.message}`);
            }
          }

          // Persist route profile suggestion
          if (routeProfile) {
            const previousTarget = steps[steps.length - 2]?.targetText?.replace(/\n/g, " ").trim() || "unknown";
            const suggestion: RouteProfileSuggestion = {
              appSlug: options.appSlug ?? "default",
              from: previousTarget,
              to: normalizedInsertedText,
              relation: "intermediate_step",
              source: "successful_transition",
              confidence: intermediateRecoveryResult.selectedCandidate!.score,
              evidence: {
                beforeUrl: intermediateRecoveryResult.urlBefore,
                afterUrl: intermediateRecoveryResult.urlAfter,
                candidateText: normalizedInsertedText,
              },
              status: "pending",
              createdAt: new Date().toISOString()
            };

            routeProfileSuggestions.push(suggestion);

            console.log(
              `[route-learning] intermediate recovery suggestion ` +
              `from="${suggestion.from}" ` +
              `inserted="${suggestion.to}" ` +
              `final="${actionTarget.target}"`
            );
          }
        } else if (!intermediateRecoveryResult.detailTargetVisible) {
          console.log(
            `[intermediate-recovery] failed recovered=false ` +
            `detailTargetVisible=false ` +
            `candidates=${intermediateRecoveryResult.visibleCandidatesCount} ` +
            `reason=no_matching_intermediate_or_target_still_not_visible`
          );

          // If target still not visible after recovery attempt, fail early
          // Don't proceed with product-card-click as it will timeout with exact_text
          const failureReason = "missing_intermediate_step_to_final_target";

          steps.push({
            index: actionTarget.index,
            action: actionTarget.action || `Clic en "${actionTarget.target}".`,
            targetText: actionTarget.target,
            status: "not_found",
            error: `Target "${actionTarget.target}" not visible. Attempted intermediate recovery but no suitable subcategory found. Visible candidates: ${intermediateRecoveryResult.visibleCandidatesCount}. URL: ${intermediateRecoveryResult.urlBefore}`,
            confidence: 0,
            locatorStrategy: "none"
          });

          failedReason = failureReason;
          console.log(`[discovery:case] Failed at step ${actionTarget.index}: ${failureReason}`);
          break;
        }
      } catch (recoveryErr: any) {
        console.log(
          `[intermediate-recovery] error during recovery attempt: ${recoveryErr.message}`
        );
        // Continue with product-card-click if recovery throws
      }

      try {
        // Find clickable candidates within the product card
        const candidates = await findProductCardClickCandidates(
          page,
          finalLocator,
          clickTarget,
          currentSnapshot
        );

        if (candidates.length > 0) {
          console.log(`[product-card-click] found ${candidates.length} clickable candidates`);

          // Task 1: Classify if current step is intermediate navigation
          // Get all remaining items to check if there's a next action target
          const currentItemIndex = orderedItems.findIndex(item =>
            item.type === "action" && item.actionTarget?.index === actionTarget.index
          );
          const remainingItems = orderedItems.slice(currentItemIndex + 1);
          const nextActionTarget = remainingItems.find(item =>
            item.type === "action" && item.actionTarget
          )?.actionTarget;

          const isIntermediateNavigation = !!nextActionTarget;
          if (isIntermediateNavigation) {
            console.log(
              `[navigation-step] classified target="${actionTarget.target}" role=intermediate ` +
              `nextTarget="${nextActionTarget?.target}"`
            );
          }

          // Define detail oracle check for this product
          const preClickUrl = page.url();
          const checkDetailOpened = async (): Promise<boolean> => {
            // Re-scan to get current state
            const checkScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            const checkSnapshot = checkScan.snapshot;
            const postClickUrl = page.url();

            // Task 2: For intermediate navigation, URL/screen change is success
            if (isIntermediateNavigation && postClickUrl !== preClickUrl) {
              console.log(
                `[navigation-step] completed target="${actionTarget.target}" ` +
                `reason=url_changed from="${preClickUrl}" to="${postClickUrl}" ` +
                `nextTarget="${nextActionTarget?.target}"`
              );
              return true;
            }

            // Check for product name - first exact, then semantic alias
            let productNameVisible = checkSnapshot.elements.some((el: any) =>
              (el.text || el.label || el.name || "").toLowerCase().includes(actionTarget.target.toLowerCase())
            );
            let matchMode: "exact" | "normalized" | "semantic_alias" | "none" = productNameVisible ? "exact" : "none";

            if (!productNameVisible) {
              const nameMatch = findBestProductNameMatch(
                actionTarget.target,
                checkSnapshot.elements,
                { minSemanticScore: 0.7, preferHeadings: true }
              );
              if (nameMatch.matches) {
                productNameVisible = true;
                matchMode = nameMatch.mode;
                console.log(
                  `[product-name-match] expected="${actionTarget.target}" actual="${nameMatch.actualText}" ` +
                  `mode=${nameMatch.mode} score=${nameMatch.score.toFixed(2)} ` +
                  `matched=[${nameMatch.matchedTokens.join(",")}] extra=[${nameMatch.extraTokens.join(",")}]`
                );
              }
            }

            // Detail authority comes from the explicit target observed at runtime.
            const detailHeadingVisible = productNameVisible;
            const detailSectionsVisible = false;

            // Strong signal = heading OR sections (NOT just buttons)
            const strongDetailSignal = detailHeadingVisible || detailSectionsVisible;

            // For ordinal auto-inserted steps, use relaxed oracle:
            // opened=true if strong detail signals present, even without exact product name match
            // (product names in list and detail may differ)
            const isOrdinalAutoInserted = isOrdinalBoundToDetail && ordinalSelectedCandidateText;
            const detailOpened = isOrdinalAutoInserted
              ? (strongDetailSignal || detailSectionsVisible)
              : (productNameVisible && strongDetailSignal);

            const openedReason = isOrdinalAutoInserted && strongDetailSignal
              ? "strong_detail_sections"
              : (productNameVisible && strongDetailSignal ? "product_name_with_detail" : "none");

            console.log(
              `[product-card-click] detail-check productName=${productNameVisible} productNameMatchMode=${matchMode} ` +
              `detailHeading=${detailHeadingVisible} detailSections=${detailSectionsVisible} ` +
              `strongSignal=${strongDetailSignal} opened=${detailOpened} reason=${openedReason} ` +
              `isOrdinalAutoInserted=${isOrdinalAutoInserted}`
            );

            return detailOpened;
          };

          // Task 4: Skip escalation for intermediate navigation
          if (isIntermediateNavigation) {
            console.log(
              `[product-card-click] skippedEscalation target="${actionTarget.target}" ` +
              `reason=intermediate_navigation_completed`
            );
            // For intermediate navigation, checkDetailOpened will return true if URL changed
            // This causes tryProductCardClickStrategies to stop after first attempt
            productCardClickResult = await tryProductCardClickStrategies(
              page,
              candidates,
              actionTarget.target,
              checkDetailOpened,
              evidenceDir
            );
          } else {
            // Try escalated click strategies for real detail targets
            productCardClickResult = await tryProductCardClickStrategies(
              page,
              candidates,
              actionTarget.target,
              checkDetailOpened,
              evidenceDir
            );
          }

          console.log(
            `[product-card-click] completed success=${productCardClickResult.success} ` +
            `strategy=${productCardClickResult.strategy ?? "none"} ` +
            `attempts=${productCardClickResult.attemptedStrategies.length}`
          );

          // If product click succeeded, skip standard click
          if (productCardClickResult.success) {
            console.log(
              `[product-card-click] success=true skipping standard click ` +
              `strategy=${productCardClickResult.strategy}`
            );

            // Mark that ordinal product click was successful (for skipping MISMATCH validation)
            const ordinalProductClickSuccess = isOrdinalBoundToDetail && productCardClickResult.success;

            // Update current snapshot after successful product click
            const afterProductClick = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = afterProductClick.snapshot;

            // Wait for page to stabilize
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            console.log("[discovery:case] Waiting after product card click...");

            // Capture evidence for ordinal selection step if it was successful
            if (ordinalProductClickSuccess) {
              const ordinalStepText = actionTarget.target; // "Seleccionar el primer elemento visible del listado"
              const ordinalClickedCandidate = ordinalSelectedCandidateText || "elemento del listado";

              console.log(
                `[evidence] step ${actionTarget.index}: "${ordinalStepText}" status=passed ` +
                `clickedTarget="${ordinalClickedCandidate}"`
              );

              // Capture screenshot of detail after ordinal click
              if (evidenceRec) {
                try {
                  const detailScreenshot = await evidenceRec.captureStep(
                    page,
                    actionTarget.index,
                    ordinalStepText,
                    { target: ordinalClickedCandidate, status: "passed" }
                  );
                  if (detailScreenshot.screenshotPath) {
                    console.log(
                      `[detail-screenshot] capturedAfterOrdinalSelection=true ` +
                      `clickedTarget="${ordinalClickedCandidate}" path=${detailScreenshot.screenshotPath}`
                    );
                  }
                } catch (screenshotErr) {
                  console.log(`[detail-screenshot] captureError=${screenshotErr instanceof Error ? screenshotErr.message : String(screenshotErr)}`);
                }
              }

              // Register ordinal step as passed
              steps.push({
                index: actionTarget.index,
                action: "click",
                status: "found",
                targetText: ordinalStepText,
                candidateText: ordinalClickedCandidate,
                autoInserted: true,
                insertionReason: "missing_intermediate_selection",
                snapshotUrl: currentSnapshot.url,
                snapshotTitle: currentSnapshot.title,
                elementsFound: currentSnapshot.elements.length,
                recoveredBy: "product_card_click_success" as any,
                recoveryMetadata: {
                  strategy: productCardClickResult.strategy,
                  ordinalClickTarget: ordinalClickedCandidate
                }
              } as any);

              // Continue with pending assertions (skip standard click and validation blocks)
              console.log(
                `[ordinal-selection] continuingToPendingAssertions ` +
                `afterOrdinalSuccess=true nextAssertions=${parsed.assertionTargets.filter((a: any) => a.index > actionTarget.index).length}`
              );
            }
          } else {
            // Product click failed - all strategies tried but detail didn't open
            console.log(
              `[product-card-click] failed=true reason=${productCardClickResult.reason} ` +
              `attemptedStrategies=[${productCardClickResult.attemptedStrategies.map(s => s.strategy).join(", ")}]`
            );

            // Mark as failed - target click did not open detail
            const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = scan.snapshot;

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "not_found",
              targetText: actionTarget.target,
              snapshotUrl: scan.url,
              snapshotTitle: scan.title,
              elementsFound: scan.elementsCount,
              error: `Product click did not open detail. Tried strategies: ${productCardClickResult.attemptedStrategies.map(s => s.strategy).join(", ")}`,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
              productCardClickDiagnostics: {
                attemptedStrategies: productCardClickResult.attemptedStrategies,
                reason: productCardClickResult.reason
              }
            } as any);

            failedAtStep = actionTarget.index;
            failedTarget = actionTarget.target;
            failedReason = "target_click_did_not_open_detail";

            await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
            await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
              scenario, steps, allDiscoveredObjects, planSteps,
              pendingObjectsPath, pendingPlansPath, evidenceDir,
              failedAtStep, failedTarget, failedReason, allDiscoveredObjects
            ).candidatePlan ?? {}, null, 2), "utf-8");

            return buildFailureResult(
              scenario, steps, allDiscoveredObjects, planSteps,
              pendingObjectsPath, pendingPlansPath, evidenceDir,
              failedAtStep, failedTarget, failedReason, allDiscoveredObjects
            );
          }
        }
      } catch (err) {
        console.log(
          `[product-card-click] error during escalated click: ` +
          `${err instanceof Error ? err.message : String(err)}`
        );
        // Fall through to standard click
      }
    } else if (isFinalProductClick && !shouldUseProductCardClick) {
      // Log why product-card-click was not activated
      console.log(
        `[product-card-click] skipped target="${actionTarget.target}" ` +
        `reason=not_final_detail_click isFinalClick=${isFinalProductClick} ` +
        `targetMatches=${targetMatchesDetail ?? false} isOrdinal=${isOrdinalBoundToDetail ?? false}`
      );
    }

    const actionNetworkObservation = startNetworkObservation(page, actionTarget.index);
    const authDetectionBeforeClick = detectAuthGate(currentSnapshot);
    const authSubmitAction = authDetectionBeforeClick.detected
      && authDetectionBeforeClick.gateType === "classic_login"
      && authDetectionBeforeClick.continueButtonPresent;
    const rowCreationAction = /\b(?:add|añadir|agregar|insertar|nuevo|nueva|another|otro|otra)\b/i.test(actionTarget.action)
      && /\b(?:row|fila|registro|linea|línea|elemento|item|emplead|entidad|another|otro|otra)\b/i.test(actionTarget.action);
    const rowCreationBefore = rowCreationAction ? await captureGridCollectionSnapshot(page) : undefined;
    let rowCreationDiagnostics: DiscoveryStepResult["rowMutationDiagnostics"];

    // Skip standard click if product card click succeeded
    if (productCardClickResult?.success) {
      // Product card click already executed and validated
      console.log(`[discovery:case] Standard click skipped - product card click succeeded`);
    } else {
      // Standard click execution
      try {
        const isRuntimeBackedSelection = actionTarget.actionType === "action_select" && Boolean(selectionValue);
        const finalTagName = isRuntimeBackedSelection
          ? await finalLocator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "")
          : "";
        if (isRuntimeBackedSelection && resolution.selectionApplied) {
          console.log(`[discovery:case] Runtime-backed custom selection already applied and state verified strategy=${resolution.locatorStrategy ?? "unknown"}`);
        } else if (isRuntimeBackedSelection && finalTagName === "select") {
          await finalLocator.selectOption({ label: selectionValue! }).catch(async () => {
            await finalLocator.selectOption({ value: selectionValue! });
          });
          console.log(`[discovery:case] Runtime-backed selection applied through resolved grid editor strategy=${resolution.locatorStrategy ?? "unknown"}`);
        } else {
          await clickResolvedTarget(finalLocator, false);
        }
      } catch {
        try {
          console.log(`[discovery:case] Retrying with force click...`);
          await clickResolvedTarget(finalLocator, true);
        } catch (err) {
        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        steps.push({
          index: actionTarget.index,
          action: actionTarget.action,
          status: "not_found",
          targetText: actionTarget.target,
          snapshotUrl: scan.url,
          snapshotTitle: scan.title,
          elementsFound: scan.elementsCount,
          error: `Click failed: ${err instanceof Error ? err.message : String(err)}`,
          evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
          aiDiagnostics: (resolution as any).aiDiagnostics
        } as any);

        failedAtStep = actionTarget.index;
        failedTarget = actionTarget.target;
        failedReason = "click_failed";

        await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
        await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        ).candidatePlan ?? {}, null, 2), "utf-8");

        void actionNetworkObservation.stop({ passiveTail: false });
        return buildFailureResult(
          scenario, steps, allDiscoveredObjects, planSteps,
          pendingObjectsPath, pendingPlansPath, evidenceDir,
          failedAtStep, failedTarget, failedReason, allDiscoveredObjects
        );
      }
    }
    } // End of standard click else block

    await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
    console.log("[discovery:case] Waiting after click...");
    // Check for loading indicators post-click before proceeding
    const { waitForStableInteractiveScreen } = await import("../runner/execution-plan-executor");
          let stability = await waitForStableInteractiveScreen(page, {
            progressProbe: () => actionNetworkObservation.getProgressState(),
            waitForPendingTransport: true,
          });
    const actionNetworkEvents = await actionNetworkObservation.stop({
      passiveTail: !stability.stable && stability.reason === "loading_timeout"
    });
    const relevantNetworkEvents = actionNetworkEvents.filter((event) =>
      event.resourceType === "fetch" ||
      event.resourceType === "xhr" ||
      event.resourceType === "document" ||
      event.resourceType === "eventsource" ||
      event.resourceType === "websocket"
    );
    const finalPath = safePathname(page.url());
    const relevantNetworkSettled = relevantNetworkEvents.length > 0 && relevantNetworkEvents.every((event) =>
      event.state === "completed" ||
      (
        event.state === "failed" &&
        event.failureCategory === "browser_error" &&
        event.status !== undefined &&
        event.status >= 200 &&
        event.status < 300 &&
        event.path === finalPath
      )
    );
    const cleanNetworkTransition = relevantNetworkSettled && relevantNetworkEvents.some((event) =>
      event.resourceType === "fetch" || event.resourceType === "xhr" || event.resourceType === "document"
    );
    if (!stability.stable && stability.reason === "loading_timeout" && cleanNetworkTransition) {
      // Some applications keep a decorative loading class mounted after all
      // navigation/data requests have completed. Static assets are not part of
      // the readiness boundary, and a browser-reported 2xx on the final route
      // is not a failed business transition. The network observer is the
      // stronger transition signal in that case.
      console.log(`[screen-stability] cleanNetworkTransition=true relevantEvents=${relevantNetworkEvents.length} finalPath=${finalPath} spinnerTimeoutTolerated=true`);
      stability = { ...stability, stable: true, reason: undefined, waitState: "completed", terminationReason: "stable" };
    }

    // A classic login submit can transiently leave its request pending without
    // producing a response or browser failure. Retry only that generic state,
    // once at most, while the auth surface is still present and no protected
    // surface or terminal auth error has appeared.
    let authTransientRetryUsed = false;
    const authRetryMax = resolveAuthTransientRetryMax(process.env.AUTH_TRANSIENT_RETRY_MAX);
    const authSnapshotAfterFirstAttempt = await scanCurrentPage(page);
    const authDetectionAfterFirstAttempt = detectAuthGate(authSnapshotAfterFirstAttempt);
    const authTerminalErrorVisible = authSnapshotAfterFirstAttempt.elements.some((element: any) => {
      if (element.visible === false) return false;
      const role = String(element.role ?? "").toLowerCase();
      const text = String(element.text ?? element.label ?? element.name ?? "");
      return (role === "alert" || role === "status") && /invalid|incorrect|error|failed|fall[oó]|incorrecta|inv[aá]lida/i.test(text);
    });
    const protectedSurfaceDetected = !authDetectionAfterFirstAttempt.detected
      && authSnapshotAfterFirstAttempt.elements.some((element: any) => element.visible !== false && /button|link|menuitem/i.test(String(element.role ?? "")));
    const responseObserved = actionNetworkEvents.some((event) => event.state !== "pending");
    const requestFailed = actionNetworkEvents.some((event) => event.state === "failed");
    const transientAuth = authSubmitAction && isAuthTransientNoResponse({
      submitClicked: true,
      requestObserved: actionNetworkEvents.length > 0,
      responseObserved,
      requestFailed,
      authSurfacePresent: authDetectionAfterFirstAttempt.detected,
      protectedSurfaceDetected,
      terminalErrorVisible: authTerminalErrorVisible,
      absoluteDeadlineReached: !stability.stable && stability.reason === "loading_timeout",
      events: actionNetworkEvents,
    });
    if (!stability.stable && transientAuth && authRetryMax > 0) {
      authTransientRetryUsed = true;
      console.log(`[auth-transient-retry] classification=AUTH_TRANSIENT_NO_RESPONSE retry=1 max=${authRetryMax} authSurfacePresent=true protectedSurfaceDetected=false terminalErrorVisible=false`);
      await actionNetworkObservation.waitForPassiveTail().catch(() => {});
      const retryObservation = startNetworkObservation(page, actionTarget.index);
      try {
        await clickResolvedTarget(finalLocator, false);
        console.log(`[auth-transient-retry] submitClicked=true`);
      } catch (error) {
        console.log(`[auth-transient-retry] submitClicked=false error="${error instanceof Error ? error.message : "unknown"}"`);
      }
      await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
      const retryStability = await waitForStableInteractiveScreen(page, {
        progressProbe: () => retryObservation.getProgressState(),
        waitForPendingTransport: true,
      });
      const retryEvents = await retryObservation.stop({
        passiveTail: !retryStability.stable && retryStability.reason === "loading_timeout",
      });
      console.log(`[auth-transient-retry] result=${retryStability.stable ? "settled" : "AUTH_TRANSIENT_NO_RESPONSE"} requestObserved=${retryEvents.length > 0} responseObserved=${retryEvents.some((event) => event.state !== "pending")} requestFailed=${retryEvents.some((event) => event.state === "failed")}`);
      if (retryStability.stable) {
        stability = retryStability;
        actionNetworkEvents.splice(0, actionNetworkEvents.length, ...retryEvents);
      }
    }
    console.log(`[network-observation:events] stepIndex=${actionTarget.index} events=${JSON.stringify(actionNetworkEvents)}`);
    console.log(
      `[screen-stability] phase=after_click target="${actionTarget.target}" ` +
      `stable=${stability.stable} signals=${stability.signals.join(",") || "none"} ` +
      `progressSignals=${stability.progressSignals.join(",") || "none"} waitedMs=${stability.waitedMs} ` +
      `waitState=${stability.waitState} relevantPendingRequests=${stability.relevantPendingRequests} ` +
      `lastProgressAgeMs=${stability.lastProgressAgeMs} absoluteDeadlineMs=${stability.absoluteDeadlineMs} ` +
      `terminationReason=${stability.terminationReason}`
    );
    if (!stability.stable) {
      failedAtStep = actionTarget.index;
      failedTarget = actionTarget.target;
      failedReason = authTransientRetryUsed
        ? "auth_transient_no_response_retry_exhausted"
        : stability.reason ?? "loading_timeout";
      console.log(`[discovery:case] Loading state did not settle; stopping before next action reason=${failedReason}`);
      if (failedReason === "loading_timeout" && actionNetworkEvents.some((event) => event.state === "pending")) {
        await actionNetworkObservation.waitForPassiveTail();
      }
      return buildFailureResult(
        scenario, steps, allDiscoveredObjects, planSteps,
        pendingObjectsPath, pendingPlansPath, evidenceDir,
        failedAtStep, failedTarget, failedReason, allDiscoveredObjects
      );
    }
    if (shouldUsePostResumeSnapshot && postResumeTargetContext?.target === actionTarget.target) {
      postResumeTargetContext = undefined;
    }

    // Check if this was an ordinal selection - skip instructive token verification
    const wasOrdinalSelection = resolution.locatorStrategy === "ordinal_selection" ||
                                (resolution as any).ordinalSelectionDiagnostics?.selectionPatternDetected === true;

    // Check if this ordinal step is from auto-inserted missing_intermediate_selection
    const isAutoInsertedOrdinal = wasOrdinalSelection &&
                                  (resolution as any).recoveryMetadata?.ordinalSelectionDiagnostics?.selectedCandidateText;

    // If product-card-click already handled the ordinal successfully, skip validation
    if (productCardClickResult?.success && isOrdinalBoundToDetail && wasOrdinalSelection) {
      console.log(
        `[ordinal-selection] skippedValidation reason=product_card_click_already_handled ` +
        `strategy=${productCardClickResult.strategy}`
      );
    } else if (wasOrdinalSelection) {
      console.log(`[discovery:case] Ordinal selection detected - skipping instructive token verification`);
      console.log(`[discovery:case] Ordinal: ${(resolution as any).ordinalSelectionDiagnostics?.ordinal ?? "unknown"}`);
      console.log(`[discovery:case] Domain term: ${(resolution as any).ordinalSelectionDiagnostics?.domainTerm ?? "none"}`);
      const selectedCandidateText = (resolution as any).ordinalSelectionDiagnostics?.selectedCandidateText ??
                                    (resolution as any).recoveryMetadata?.ordinalSelectionDiagnostics?.selectedCandidateText ??
                                    "unknown";
      console.log(`[discovery:case] Selected candidate: ${selectedCandidateText}`);

      // For auto-inserted ordinal (missing_intermediate_selection), skip assertion comparison
      // Assertions are post-click validation, not pre-click candidate validation
      if (isAutoInsertedOrdinal && detailTarget && finalProductClickStepIndex === actionTarget.index) {
        console.log(
          `[ordinal-selection] assertionMismatchCheckSkipped reason=post_click_assertions ` +
          `originalTarget="${actionTarget.target}" ` +
          `selectedCandidate="${selectedCandidateText}" ` +
          `expectedAssertions="${detailTarget}" postClickValidation=true`
        );
        // Don't fail - assertions will be validated post-click
      } else if (!isAutoInsertedOrdinal && detailTarget && finalProductClickStepIndex === actionTarget.index) {
        // For normal ordinal selections (not auto-inserted), validate candidate matches expected detail
        const selectedNormalized = selectedCandidateText.toLowerCase().trim();
        const expectedNormalized = detailTarget.toLowerCase().trim();

        // Check if selected candidate matches expected detail target
        const candidateMatches = selectedNormalized.includes(expectedNormalized) ||
                                expectedNormalized.includes(selectedNormalized) ||
                                selectedNormalized === expectedNormalized;

        console.log(
          `[ordinal-selection] expectedTarget="${detailTarget}" ` +
          `selectedCandidate="${selectedCandidateText}" match=${candidateMatches}`
        );

        if (!candidateMatches) {
          // Wrong candidate selected - this is a failure
          console.log(
            `[ordinal-selection] MISMATCH detected! expectedTarget="${detailTarget}" ` +
            `selectedCandidate="${selectedCandidateText}" status=failed`
          );

          // Capture current page state for diagnostics
          const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = postClickScan.snapshot;

          // Mark as failed
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "not_found",
            targetText: actionTarget.target,
            snapshotUrl: postClickScan.url,
            snapshotTitle: postClickScan.title,
            elementsFound: postClickScan.elementsCount,
            error: `Wrong ordinal candidate selected. Expected: "${detailTarget}", Selected: "${selectedCandidateText}"`,
            evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`)
          });

          failedAtStep = actionTarget.index;
          failedTarget = actionTarget.target;
          failedReason = "wrong_ordinal_candidate";

          await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
          await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          ).candidatePlan ?? {}, null, 2), "utf-8");

          return buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          );
        } else {
          console.log(`[ordinal-selection] candidate match verified ✓`);
        }
      }
    }

    // Post-click semantic verification for selection-like targets
    // SKIP for ordinal_selection since tokens like "primera", "visible", "listado" are instructions, not UI text
    const isSelectionLike = isSelectionLikeTargetNew(actionTarget.target);
    
    const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
    currentSnapshot = postClickScan.snapshot;

    // Capture evidence after click completes and page stabilizes
    // Skip generic screenshot when detail screenshot will capture the same state
    const willCaptureDetailScreenshot = detailTarget && finalProductClickStepIndex === actionTarget.index && evidenceRec;
    if (willCaptureDetailScreenshot) {
      // Increment evidence index without capturing screenshot - detail capture will use this index
      evidenceStepIndex++;
      console.log(`[detail-screenshot] genericStepScreenshotSkipped=true reason=detail_loaded_screenshot_already_captured step=${actionTarget.index}`);
    } else {
      await captureEvStep(actionTarget.action, "passed");
    }

    // Determine effective target from alias resolution
    const locatorStrategy = (resolution as any)?.locatorStrategy ?? "";
    const candidateText = (resolution as any)?.candidateText ?? "";
    const effectiveTarget = locatorStrategy.includes("alias") ? candidateText : undefined;
    
    // Check for navigation alias + transition: when a navigation/back alias click
    // successfully transitions the page, the alias element disappears and semantic
    // verification against it would falsely fail. Detect this and skip verification.
    let aliasTransitionSkip = false;
    const isNavigationAlias = locatorStrategy.includes("back_navigation_alias") || locatorStrategy.includes("route_profile_alias");
    
    if (isNavigationAlias && effectiveTarget) {
      const afterState: PageState = {
        url: postClickScan.url,
        bodyText: normalizeText(postClickScan.snapshot.elements.map(e => e.text || "").join(" ")),
        elementCount: postClickScan.elementsCount,
      };
      const transitionDetectedAlias = hasPageTransition(beforeState, afterState, effectiveTarget);
      console.log(`[discovery:case] Navigation alias transition check: transition=${transitionDetectedAlias ? "yes" : "no"}`);
      
      if (transitionDetectedAlias) {
        aliasTransitionSkip = true;
        console.log(`[semantic-verification] aliasNavigationAccepted original="${actionTarget.target}" canonical="${effectiveTarget}" reason="transition_detected"`);
      }
    }
    
    if (aliasTransitionSkip) {
      console.log(`[discovery:case] postClickSemanticVerificationSkipped=true skipReason="alias_navigation_transition"`);
    } else if (isSelectionLike && wasOrdinalSelection) {
      // For ordinal_selection, skip instructive token verification
      console.log(`[discovery:case] Ordinal selection post-click verification skipped (instructive tokens)`);
      console.log(`[discovery:case] postClickSemanticVerificationSkipped=true skipReason="ordinal_selection_instruction_tokens"`);
    } else if (isSelectionLike) {
      // Normal selection-like: perform semantic verification
      console.log(`[discovery:case] Performing post-click semantic verification for selection-like target: ${actionTarget.target}`);
      
      const visibleTexts = postClickScan.snapshot.elements
        .filter(e => e.visible && e.text)
        .map(e => e.text!)
        .slice(0, 50);
      
      if (effectiveTarget && effectiveTarget !== actionTarget.target) {
        console.log(`[semantic-verification] aliasAccepted original="${actionTarget.target}" canonical="${effectiveTarget}"`);
      }
      
      const semanticMatch = verifyPostClickSemanticMatch(
        actionTarget.target,
        visibleTexts,
        postClickScan.title,
        effectiveTarget,
      );
      
      if (!semanticMatch.matches) {
        console.log(`[discovery:case] Post-click semantic MISMATCH detected!`);
        console.log(`[discovery:case] Target: ${actionTarget.target}`);
        console.log(`[discovery:case] Missing tokens: ${semanticMatch.missingTokens.join(", ")}`);
        const mismatchReason = semanticMatch.mismatchReason || "post_click_semantic_mismatch";
        console.log(`[discovery:case] Reason: ${mismatchReason}`);
        
        // Post-click route completion recovery: attempt to insert missing intermediate step
        const appSlug = options.appSlug ?? "default";
        const routeCompletionConfig = (options as any)?.aiAssistedDiscovery?.config?.routeCompletion;
        const explicitRouteProfile = (options.scenario as any)?.routeProfile;
        const postRcRouteProfile = routeCompletionConfig?.useAppProfile !== false ? loadRouteProfile(appSlug, explicitRouteProfile) : undefined;
        
        let postClickRouteCompletionAttempted = false;
        let postClickRouteCompletionResolution: MissingIntermediateStepResolution | undefined;
        let postClickRouteCompletionSucceeded = false;
        
        console.log(`[route-completion] post-click app context appSlug=${appSlug} source=${options.appSlug ? "workflow" : "default-fallback"}`);
        console.log(`[route-completion] post-click config enabled=${routeCompletionConfig?.enabled ?? false}`);
        
        if (routeCompletionConfig?.enabled !== true) {
          console.log(`[route-completion] post-click skipped: routeCompletion not enabled in config`);
        } else {
          if (!postRcRouteProfile) {
            console.log(`[route-completion] post-click routeProfile missing appSlug=${appSlug}`);
          } else {
            console.log(`[route-completion] post-click routeProfile loaded appSlug=${appSlug} routes=${postRcRouteProfile.routes?.length ?? 0}`);
          }
          
          const currentRouteHistory = steps
            .filter((s) => (s as any).status === "passed" && s.targetText)
            .map((s) => s.targetText!);
          
          console.log(`[route-completion] post-click routeHistory=[${currentRouteHistory.join(", ")}] lastSuccessfulTarget=${currentRouteHistory[currentRouteHistory.length - 1] ?? "none"}`);
          
          const aiCandidates: DiscoveryCandidate[] = postClickScan.snapshot.elements.map((el) => ({
            candidateId: el.id,
            role: el.role,
            name: el.name,
            text: el.text,
            visible: Boolean(el.visible),
            enabled: isSnapshotElementEnabled(el),
            clickable: isSnapshotElementClickable(el),
            editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
            sensitive: false
          }));

          const clickableCandidates = aiCandidates.filter((c) => c.visible && c.clickable);
          const visibleClickableLabels = clickableCandidates.slice(0, 10).map((c) => c.name ?? c.text ?? "unknown");
          
          console.log(`[route-completion] post-click candidates summary total=${aiCandidates.length} clickable=${clickableCandidates.length} visibleClickable=[${visibleClickableLabels.join(",")}]`);

          const snapshot: DiscoverySnapshot = {
            url: postClickScan.snapshot.url,
            title: postClickScan.snapshot.title,
            visibleHeadings: [],
            visibleNavItems: [],
            visibleActions: [],
            visibleTextSummary: []
          };

          const insertedStepsSoFar = (steps as any).insertedSteps?.length ?? 0;

          console.log(`[route-completion] post-click calling resolver failureType=semantic_mismatch`);

          postClickRouteCompletionResolution = resolveMissingIntermediateStep({
            appSlug,
            routeProfile: postRcRouteProfile,
            currentRouteHistory,
            lastSuccessfulTarget: currentRouteHistory[currentRouteHistory.length - 1],
            currentStepText: actionTarget.action,
            currentTarget: actionTarget.target,
            failureType: "semantic_mismatch",
            snapshot,
            candidates: aiCandidates,
            insertedStepsSoFar,
            config: {
              enabled: routeCompletionConfig?.enabled ?? false,
              minConfidence: routeCompletionConfig?.minConfidence ?? 0.75,
              maxInsertedSteps: routeCompletionConfig?.maxInsertedSteps ?? 1,
              useAppProfile: routeCompletionConfig?.useAppProfile ?? true,
              allowGeneric: routeCompletionConfig?.allowGeneric ?? true
            }
          });

          postClickRouteCompletionAttempted = true;
          console.log(`[route-completion] attempted step=${actionTarget.index} failure=semantic_mismatch appSlug=${appSlug} routeProfileLoaded=${Boolean(routeProfile)} candidates=${aiCandidates.length}`);
          console.log(`[route-completion] resolver returned status=${postClickRouteCompletionResolution.status} source=${postClickRouteCompletionResolution.source}`);

          if (postClickRouteCompletionResolution.status === "repaired_plan" && postClickRouteCompletionResolution.candidateId) {
            const selectedCandidate = aiCandidates.find((c) => c.candidateId === postClickRouteCompletionResolution!.candidateId);
            console.log(`[route-completion] selected candidate="${selectedCandidate?.name ?? selectedCandidate?.text}" source=${postClickRouteCompletionResolution.source} confidence=${postClickRouteCompletionResolution.confidence}`);

            const selectedElement = postClickScan.snapshot.elements.find((el) => el.id === postClickRouteCompletionResolution!.candidateId);

            if (selectedElement) {
              const resolvedInserted = await resolveSnapshotElementLocator(page, {
                element: selectedElement,
                target: postClickRouteCompletionResolution.insertedStepText ?? actionTarget.target,
                candidateText: selectedElement.text ?? selectedElement.label ?? selectedElement.name ?? postClickRouteCompletionResolution.insertedStepText!,
                type: selectedElement.type,
                tagName: selectedElement.tagName,
                confidence: postClickRouteCompletionResolution.confidence ?? 0.75,
                matchReason: "route_completion_intermediate_step"
              });

              if (resolvedInserted.locator) {
                try {
                  await clickResolvedTarget(resolvedInserted.locator, false);
                  console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${postClickRouteCompletionResolution.insertedStepText ?? actionTarget.target}"`);
                  await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                  await page.waitForTimeout(1000);
                  console.log(`[route-completion] inserted step executed`);

                  // Capture evidence for post-click route completion inserted step
                  const insertedActionDesc = `Clic en "${postClickRouteCompletionResolution.insertedStepText ?? actionTarget.target}".`;
                  await captureEvStep(insertedActionDesc, "passed");

                  const insertedStepResult = {
                    originalStepIndex: actionTarget.index,
                    insertedBeforeStepIndex: actionTarget.index,
                    reason: "missing_intermediate_step",
                    target: postClickRouteCompletionResolution.insertedStepText,
                    candidateId: postClickRouteCompletionResolution.candidateId,
                    confidence: postClickRouteCompletionResolution.confidence,
                    source: postClickRouteCompletionResolution.source,
                    executed: true,
                    retrySucceeded: false
                  };

                  if (!(steps as any).insertedSteps) {
                    (steps as any).insertedSteps = [];
                  }
                  (steps as any).insertedSteps.push(insertedStepResult);

                  // Add inserted step to execution plan as a functional step
                  const insertedStepText = postClickRouteCompletionResolution.insertedStepText || actionTarget.target;
                  const isOrdinalSelection = /primer|primera|first|visible|listado/i.test(insertedStepText);
                  
                  // Use generic ordinal description if candidate contains dynamic data
                  const insertedStepTextSafe = postClickRouteCompletionResolution.insertedStepText || "producto";
                  const hasDynamicData = /\*\*\*\s*\d|\d{4}\s*\*\*\*|^\d{3,}/.test(insertedStepTextSafe);
                  const genericOrdinalTarget = hasDynamicData 
                    ? `el primer ${inferProductType(insertedStepTextSafe)} visible del listado`
                    : insertedStepTextSafe;
                  
                  planSteps.push({
                    index: planSteps.length + 1,
                    action: "click",
                    description: genericOrdinalTarget,
                    target: {
                      strategy: "text" as LocatorStrategy,
                      value: genericOrdinalTarget,
                      exact: false,
                      metadata: {
                        originalTarget: actionTarget.target,
                        resolvedTargetName: postClickRouteCompletionResolution.insertedStepText,
                        resolvedCandidateId: postClickRouteCompletionResolution.candidateId,
                        aiAssisted: false,
                        repairType: "route_completion"
                      }
                    },
                    locatorStrategy: "ordinal_selection",
                    recoveryMetadata: {
                      recoveredBy: "route_completion",
                      ordinalSelectionDiagnostics: {
                        selectionPatternDetected: true,
                        ordinal: "first",
                        selectedCandidateText: postClickRouteCompletionResolution.insertedStepText,
                        selectedCandidateId: postClickRouteCompletionResolution.candidateId
                      },
                      selectedCandidateId: postClickRouteCompletionResolution.candidateId,
                      selectedCandidateText: postClickRouteCompletionResolution.insertedStepText,
                      transitionDetected: true,
                      executedAction: "click"
                    }
                  });

                  console.log(`[route-completion] retrying original step`);

                  const rescanAfterInsert = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                  currentSnapshot = rescanAfterInsert.snapshot;

                  const resolvedRetry = await resolveActionTarget(
                    page,
                    currentSnapshot,
                    actionTarget.target,
                    {
                      semanticRole: actionTarget.semanticRole,
                      relationContext: actionTarget.relationContext,
                      activeContainer,
                      routeProfile,
                      actionText: actionTarget.action
                    }
                  );

                  if (resolvedRetry.status === "resolved" && resolvedRetry.locator) {
                    try {
                      await clickResolvedTarget(resolvedRetry.locator, false);
                      console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${actionTarget.target}"`);
                      await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
                      await page.waitForTimeout(1000);

                      // Capture evidence for post-click route completion retry
                      await captureEvStep(actionTarget.action, "passed");

                      // Verify semantic match again after retry
                      const retryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
                      const retryVisibleTexts = retryScan.snapshot.elements
                        .filter(e => e.visible && e.text)
                        .map(e => e.text!)
                        .slice(0, 50);
                      
                      const retrySemanticMatch = verifyPostClickSemanticMatch(
                        actionTarget.target,
                        retryVisibleTexts,
                        retryScan.title,
                        effectiveTarget,
                      );

                      if (retrySemanticMatch.matches) {
                        console.log(`[route-completion] retry succeeded`);
                        insertedStepResult.retrySucceeded = true;
                        postClickRouteCompletionSucceeded = true;

                        currentSnapshot = retryScan.snapshot;
                        allDiscoveredObjects.push(...retryScan.objects);

                        // Route profile learning: observe successful post-click route completion
                        if (routeProfileLearningConfig.enabled && postClickRouteCompletionResolution?.insertedStepText) {
                          const currentRouteHistory = steps
                            .filter((s) => (s as any).status === "passed" || (s as any).status === "found")
                            .filter((s) => s.index !== actionTarget.index) // Exclude current step
                            .map((s) => s.targetText!)
                            .filter(Boolean);
                          const lastSuccessfulTarget = currentRouteHistory[currentRouteHistory.length - 1];
                          
                          const learningResult = observeRouteCompletionSuccess(
                            {
                              target: postClickRouteCompletionResolution.insertedStepText,
                              candidateId: postClickRouteCompletionResolution.candidateId,
                              source: postClickRouteCompletionResolution.source
                            },
                            lastSuccessfulTarget || "entry",
                            options.appSlug ?? "default",
                            routeProfileLearningConfig
                          );
                          
                          if (learningResult.suggestion) {
                            routeProfileSuggestions.push(learningResult.suggestion);
                            console.log(`[route-learning] observed post-click route completion from="${learningResult.suggestion.from}" to="${learningResult.suggestion.to}"`);
                          }
                        }

                        steps.push({
                          index: actionTarget.index,
                          action: actionTarget.action,
                          status: "found" as any,
                          targetText: actionTarget.target,
                          snapshotUrl: currentSnapshot.url,
                          snapshotTitle: currentSnapshot.title,
                          elementsFound: currentSnapshot.elements.length,
                          recoveredBy: "route_completion" as any,
                          recoveryStatus: "recovered",
                          routeCompletionDiagnostics: {
                            attempted: true,
                            enabled: routeCompletionConfig?.enabled ?? false,
                            appSlug,
                            routeProfileUsed: Boolean(routeProfile),
                            trigger: "post_click_semantic_mismatch",
                            source: postClickRouteCompletionResolution.source,
                            selectedCandidateId: postClickRouteCompletionResolution.candidateId,
                            selectedCandidateText: postClickRouteCompletionResolution.insertedStepText,
                            retrySucceeded: true
                          }
                        });

                        executedStepIndices.add(actionTarget.index);
                        if (typeof currentActionOrder === "number") executedActionOrders.add(currentActionOrder);
                        if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
                          break;
                        }
                        continue;
                      } else {
                        console.log(`[route-completion] retry failed semantic verification`);
                        insertedStepResult.retrySucceeded = false;
                      }
                    } catch (retryErr) {
                      console.log(`[route-completion] retry failed`);
                      insertedStepResult.retrySucceeded = false;
                    }
                  } else {
                    console.log(`[route-completion] retry resolution failed status=${resolvedRetry.status}`);
                    insertedStepResult.retrySucceeded = false;
                  }
                } catch (insertErr) {
                  console.log(`[route-completion] inserted step execution failed`);
                }
              }
            }
          } else {
            console.log(`[route-completion] post-click blocked: ${postClickRouteCompletionResolution.blockedReason ?? "no_safe_action"} reason="${postClickRouteCompletionResolution.reason}"`);
          }
        }

        // If route completion didn't recover, proceed with original failure
        if (!postClickRouteCompletionSucceeded) {
          // Mark as failure with semantic mismatch
          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "not_found",
            targetText: actionTarget.target,
            snapshotUrl: postClickScan.url,
            snapshotTitle: postClickScan.title,
            elementsFound: postClickScan.elementsCount,
            error: `Semantic mismatch after click: ${mismatchReason}`,
            evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
            semanticMismatchDiagnostics: {
              target: actionTarget.target,
              matchedTokens: semanticMatch.matchedTokens,
              missingTokens: semanticMatch.missingTokens,
              reason: mismatchReason
            },
            routeCompletionDiagnostics: postClickRouteCompletionAttempted ? {
              attempted: true,
              enabled: routeCompletionConfig?.enabled ?? false,
              appSlug,
              routeProfileUsed: Boolean(routeProfile),
              trigger: "post_click_semantic_mismatch",
              source: postClickRouteCompletionResolution?.source,
              selectedCandidateId: postClickRouteCompletionResolution?.candidateId,
              selectedCandidateText: postClickRouteCompletionResolution?.insertedStepText,
              blockedReason: postClickRouteCompletionResolution?.blockedReason,
              retrySucceeded: false
            } : undefined
          } as any);
          
          failedAtStep = actionTarget.index;
          failedTarget = actionTarget.target;
          failedReason = "semantic_mismatch";
          
          await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
          await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          ).candidatePlan ?? {}, null, 2), "utf-8");
          
          return buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          );
        }
      }
      
      console.log(`[discovery:case] Post-click semantic verification PASSED. Matched tokens: ${semanticMatch.matchedTokens.join(", ")}`);
    }

    const afterState = await capturePageState(page);
    if (rowCreationBefore) {
      const rowCreationAfter = await captureGridCollectionSnapshot(page);
      rowCreationDiagnostics = {
        beforeRowCount: rowCreationBefore.rowCount,
        afterRowCount: rowCreationAfter.rowCount,
        ...compareGridCollection(rowCreationBefore, rowCreationAfter),
        dataset2BoundToNewRow: compareGridCollection(rowCreationBefore, rowCreationAfter).newRowIdentityDistinct,
      };
      console.log(`[grid-row-mutation] beforeRowCount=${rowCreationBefore.rowCount} afterRowCount=${rowCreationAfter.rowCount} rowCountIncreased=${rowCreationDiagnostics.rowCountIncreased} newRowObserved=${rowCreationDiagnostics.newRowObserved} newRowIdentityDistinct=${rowCreationDiagnostics.newRowIdentityDistinct}`);
    }
    if (assertionObservationBefore && pendingAssertion) {
      const assertionObservationAfter = await captureAssertionObservationSnapshot(page).catch(() => undefined);
      if (assertionObservationAfter) {
        const observationDiff = diffAssertionObservation(
          assertionObservationBefore,
          assertionObservationAfter,
          actionNetworkEvents.length > 0,
        );
        const refs = getCanonicalAssertionMetadata(scenario, pendingAssertion.index).refs;
        const requirementId = refs[0]?.requirementId;
        const artifact: AssertionObservationArtifact = {
          version: "1.0",
          caseId: scenario.caseId,
          ...(scenario.canonicalScenarioId ? { scenarioId: scenario.canonicalScenarioId } : {}),
          ...(requirementId ? { requirementId, requirementRefs: refs.map((ref) => ref.requirementId) } : {}),
          triggerActionIdentity: { action: actionTarget.action, stepIndex: actionTarget.index, target: actionTarget.target },
          before: assertionObservationBefore,
          after: assertionObservationAfter,
          mutation: observationDiff,
          network: {
            eventCount: actionNetworkEvents.length,
            classification: classifyNetworkActivity(
              actionNetworkEvents,
              assertionObservationBefore.urlPath,
              assertionObservationAfter.urlPath,
            ),
          },
          ...(observationDiff.validationMutation && requirementId
            ? { candidate: { oracleType: "runtime_state", targetIdentity: requirementId, confidence: 0.8, source: "runtime_observation" } }
            : {}),
          createdAt: new Date().toISOString(),
        };
        assertionObservations.push(artifact);
        try {
          await writeAssertionObservationArtifact(evidenceDir, artifact);
        } catch {
          // Observation artifacts are diagnostic and must not change execution status.
        }
        console.log(`[assertion-observation-after] requirementId=${requirementId ?? "unresolved"} mutationCount=${observationDiff.changedPaths.length} validationMutation=${observationDiff.validationMutation} navigationMutation=${observationDiff.navigationMutation} networkMutation=${observationDiff.networkActivityDetected}`);
        console.log(`[assertion-observable-candidate] requirementId=${requirementId ?? "unresolved"} oracleType=${artifact.candidate?.oracleType ?? "none"} targetIdentity=${artifact.candidate?.targetIdentity ?? "unresolved"} evidenceSource=runtime_observation backedCandidate=false`);
      }
    }
    const transitionDetected = hasPageTransition(beforeState, afterState, actionTarget.target);
    const afterTransitionSnapshot = await scanCurrentPage(page);
    const beforeStructuralFingerprint = currentSnapshot.structuralFingerprint;
    const afterStructuralFingerprint = afterTransitionSnapshot.structuralFingerprint;
    const transitionValidated = Boolean(
      transitionDetected && beforeStructuralFingerprint && afterStructuralFingerprint
    );

    console.log(`[discovery:case] Transition detected: ${transitionDetected ? "yes" : "no"}`);

    if (!transitionDetected) {
      console.log(`[discovery:case] Retrying with force click...`);
      try {
        await clickResolvedTarget(finalLocator, true);
        await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });

        const afterRetryState = await capturePageState(page);
        const retryTransition = hasPageTransition(beforeState, afterRetryState, actionTarget.target);

        console.log(`[discovery:case] Transition after force click: ${retryTransition ? "yes" : "no"}`);

        if (!retryTransition) {
          console.log("[discovery:case] Click did not change page state.");

          // Try JavaScript-native click as last resort before selection evaluation
          try {
            console.log("[discovery:case] Trying JavaScript-native click...");
            await finalLocator.evaluate((el) => {
              if (el instanceof HTMLElement) {
                el.click();
              }
            });
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });

            const afterJsClickState = await capturePageState(page);
            const jsClickTransition = hasPageTransition(beforeState, afterJsClickState, actionTarget.target);
            console.log(`[discovery:case] Transition after JS click: ${jsClickTransition ? "yes" : "no"}`);

            if (jsClickTransition) {
              console.log("[discovery:case] JavaScript click succeeded with transition.");
              const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
              currentSnapshot = postClickScan.snapshot;
              allDiscoveredObjects.push(...postClickScan.objects);

              steps.push({
                index: actionTarget.index,
                action: actionTarget.action,
                status: "found",
                targetText: actionTarget.target,
                snapshotUrl: postClickScan.url,
                snapshotTitle: postClickScan.title,
                elementsFound: postClickScan.elementsCount,
                evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
                semanticRole: actionTarget.semanticRole,
                relationContext: actionTarget.relationContext
              });

              planSteps.push({
                index: planSteps.length + 1,
                action: "click",
                description: actionTarget.action,
                target: { strategy: "text", value: actionTarget.target, exact: false }
              });
              if (typeof currentActionOrder === "number") {
                executedActionOrders.add(currentActionOrder);
              }
              if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
                break;
              }
              continue;
            }
          } catch (jsClickErr) {
            console.log(`[discovery:case] JavaScript click failed: ${jsClickErr instanceof Error ? jsClickErr.message : String(jsClickErr)}`);
          }

          // Post-click UI change detector: check for modal/dialog/form opened without page transition
          const afterStateForUiCheck = await capturePageState(page);
          const afterSnapshotForUiCheck = await scanCurrentPage(page);
          const nextActionTargets = parsed.actionTargets.filter(a => a.index > actionTarget.index).slice(0, 5).map(a => a.target);
          
          const postClickUiResult = await detectPostClickUiChange({
            page,
            target: actionTarget.target,
            actionText: actionTarget.action,
            beforeSnapshot: currentSnapshot,
            afterSnapshot: afterSnapshotForUiCheck,
            nextTargets: nextActionTargets,
            expectedAssertions: parsed.assertionTargets.filter(a => a.index >= actionTarget.index).map(a => a.target)
          });

          console.log(`[discovery:case] Post-click UI change evaluation: target="${actionTarget.target}", success=${postClickUiResult.success}, reason=${postClickUiResult.reason || "none"}, evidence=[${postClickUiResult.evidence.slice(0, 3).join(", ")}]`);

          if (postClickUiResult.success) {
            console.log(`[discovery:case] Post-click UI change accepted without transition: target="${actionTarget.target}"`);
            
            const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = postClickScan.snapshot;
            allDiscoveredObjects.push(...postClickScan.objects);

            if (postClickUiResult.reason && ["modal_opened", "dialog_opened", "form_opened", "panel_opened", "overlay_opened"].includes(postClickUiResult.reason)) {
              const containerElement = postClickScan.snapshot.elements.find(el => {
                const role = el.role?.toLowerCase() || "";
                const tag = el.tagName?.toLowerCase() || "";
                const className = (el as any).className || "";
                return role === "dialog" || role === "alertdialog" || tag === "dialog" || 
                  (el as any).ariaModal === "true" ||
                  ["modal", "dialog", "popup", "overlay", "drawer", "panel", "form"].some(ind => className.toLowerCase().includes(ind));
              });
              
              const containerReason = postClickUiResult.reason as "modal_opened" | "dialog_opened" | "form_opened" | "panel_opened" | "overlay_opened";
              const containerType = containerReason === "modal_opened" ? "modal" :
                                    containerReason === "dialog_opened" ? "dialog" :
                                    containerReason === "form_opened" ? "form" :
                                    containerReason === "panel_opened" ? "panel" : "drawer";
              
              let containerLocator: any = undefined;
              if (containerElement) {
                if (containerElement.domId) {
                  containerLocator = page.locator(`#${containerElement.domId}`);
                } else if (containerElement.className) {
                  const firstClass = containerElement.className.split(/\s+/)[0];
                  if (firstClass) {
                    containerLocator = page.locator(`.${firstClass}`).first();
                  }
                }
                if (!containerLocator && containerElement.tagName) {
                  containerLocator = page.locator(containerElement.tagName).first();
                }
              }
              
              activeContainer = {
                type: containerType,
                reason: containerReason,
                containerElement,
                containerLocator: containerLocator || undefined,
                detectedAt: new Date().toISOString()
              };
              
              console.log(`[discovery:case] Active container set: type="${activeContainer.type}" reason="${activeContainer.reason}"${activeContainer.containerLocator ? ' with locator' : ' (metadata only)'}`);
            }

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "found",
              targetText: actionTarget.target,
              snapshotUrl: postClickScan.url,
              snapshotTitle: postClickScan.title,
              elementsFound: postClickScan.elementsCount,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
              semanticRole: actionTarget.semanticRole,
              relationContext: actionTarget.relationContext,
              postClickDiagnostics: postClickUiResult
            } as any);

            planSteps.push({
              index: planSteps.length + 1,
              action: "click",
              description: actionTarget.action,
              target: { strategy: "text", value: actionTarget.target, exact: false }
            });
            if (typeof currentActionOrder === "number") {
              executedActionOrders.add(currentActionOrder);
            }
            executedStepIndices.add(actionTarget.index);
            if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
              break;
            }
            continue;
          }

        const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
        currentSnapshot = scan.snapshot;

        const stabilityRetry = await waitForStablePageState(page, { timeoutMs: 15000, pollMs: 500, stableForMs: 1000 });
        if (stabilityRetry.waited && stabilityRetry.finalStable) {
          console.log(`[discovery:case] Stability retry after wait: reason=${stabilityRetry.reason}, duration=${stabilityRetry.durationMs}ms`);
          const retryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = retryScan.snapshot;
          allDiscoveredObjects.push(...retryScan.objects);

          const retryResolution = await resolveActionTarget(page, currentSnapshot, actionTarget.target, {
            semanticRole: actionTarget.semanticRole,
            relationContext: actionTarget.relationContext,
            activeContainer,
            routeProfile,
            actionText: actionTarget.action
          });
          if (retryResolution.status === "resolved" && retryResolution.locator) {
            console.log(`[discovery:case] Target found after stability retry: ${actionTarget.target}`);
            await clickResolvedTarget(retryResolution.locator, false);
            console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${actionTarget.target}"`);
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            await page.waitForTimeout(1000);
            const afterState = await capturePageState(page);
            const transitionDetected = hasPageTransition(beforeState, afterState, actionTarget.target);

            const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = postClickScan.snapshot;
            allDiscoveredObjects.push(...postClickScan.objects);

            // Capture evidence after stability retry click
            await captureEvStep(actionTarget.action, "passed");

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "found",
              targetText: actionTarget.target,
              snapshotUrl: postClickScan.url,
              snapshotTitle: postClickScan.title,
              elementsFound: postClickScan.elementsCount,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
              semanticRole: actionTarget.semanticRole,
              relationContext: actionTarget.relationContext
            });

            planSteps.push({
              index: planSteps.length + 1,
              action: "click",
              description: actionTarget.action,
              target: { strategy: "text", value: actionTarget.target, exact: false }
            });
            if (typeof currentActionOrder === "number") {
              executedActionOrders.add(currentActionOrder);
            }
            if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
              break;
            }
            continue;
          }
        }

        const authRecovery = await tryAuthGateRecovery(page, currentSnapshot, options, actionTarget.target);
          if (authRecovery.diagnostics?.detected === true) {
            authGateDetectedDuringDiscovery = true;
            authGateDetectedAtStepIndex = actionTarget.index;
          }
          if (
            !authRecovery.recovered &&
            (authRecovery.diagnostics?.reason === "post_auth_transient_landing_unresolved" ||
              authRecovery.diagnostics?.stage === "authenticated_transient_unresolved")
          ) {
            console.log(`[auth-resume] skipLegacyStableWait reason=post_auth_transient_landing_unresolved`);
            console.log(`[status-reconcile] evidenceStatus=Fallido caseFinished=failed reason=post_auth_transient_landing_unresolved`);
          throw new Error(`[auth-resume] blocked reason=post_auth_transient_landing_unresolved target="${actionTarget.target}" ${safeUrlForLog(authRecovery.diagnostics?.url)}`);
          }
          if (authRecovery.recovered) {
            console.log(`[discovery:case] Auth gate recovery after click_no_transition successful, retrying...`);
            if (authRecovery.authGateState) {
              authGateState = authRecovery.authGateState;
              // Track when AuthGate was completed for later AuthFlow insertion
              if (authGateState.completed && authGateCompletedAfterStepIndex === undefined) {
                const lastExecutedStepIndex = executedStepIndices.size > 0 
                  ? Math.max(...Array.from(executedStepIndices))
                  : 0;
                authGateCompletedAfterStepIndex = lastExecutedStepIndex;
                console.log(`[discovery:case] AuthGate completed after step index ${authGateCompletedAfterStepIndex}`);
              }
            }
            await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
            const retryScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
            currentSnapshot = retryScan.snapshot;
            allDiscoveredObjects.push(...retryScan.objects);

          const retryResolution = await resolveActionTarget(page, currentSnapshot, actionTarget.target, {
            semanticRole: actionTarget.semanticRole,
            relationContext: actionTarget.relationContext,
            activeContainer,
            routeProfile,
            actionText: actionTarget.action
          });
            if (retryResolution.status === "resolved" && retryResolution.locator) {
              await clickResolvedTarget(retryResolution.locator, false);
              console.log(`[post-click-screenshot] waitingAfterClick step=${actionTarget.index} target="${actionTarget.target}"`);
              await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
              await page.waitForTimeout(1000);

              const postClickScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
              currentSnapshot = postClickScan.snapshot;
              allDiscoveredObjects.push(...postClickScan.objects);

              // Capture evidence after auth gate recovery retry
              await captureEvStep(actionTarget.action, "passed");

              steps.push({
                index: actionTarget.index,
                action: actionTarget.action,
                status: "found",
                targetText: actionTarget.target,
                snapshotUrl: postClickScan.url,
                snapshotTitle: postClickScan.title,
                elementsFound: postClickScan.elementsCount,
                evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
                semanticRole: actionTarget.semanticRole,
                relationContext: actionTarget.relationContext
              });

              planSteps.push({
                index: planSteps.length + 1,
                action: "click",
                description: actionTarget.action,
                target: { strategy: "text", value: actionTarget.target, exact: false }
              });
              if (typeof currentActionOrder === "number") {
                executedActionOrders.add(currentActionOrder);
              }
              if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
                break;
              }
              continue;
            }
          }

          const selectionDiagnostics = await detectSelectionSuccess({
            page,
            snapshot: currentSnapshot,
            target: actionTarget.target,
            locator: finalLocator,
            beforeSnapshot: beforeState as any,
            afterSnapshot: afterState as any,
            nextTarget: parsed.actionTargets.find(a => a.index > actionTarget.index)?.target,
            action: actionTarget.action,
            actionType: actionTarget.actionType
          });

          if (promotedToAncestor) {
            selectionDiagnostics.promotedToClickableAncestor = true;
          }

          console.log(`[discovery:case] Selection evaluation after no-transition: target="${actionTarget.target}", selectionLike=${selectionDiagnostics.selectionLike}, success=${selectionDiagnostics.success}, reason=${selectionDiagnostics.reason}, evidence=[${selectionDiagnostics.evidence.join(", ")}]`);

          if (selectionDiagnostics.selectionLike && selectionDiagnostics.success) {
            console.log(`[discovery:case] Selection click accepted without transition: ${actionTarget.target}. Reason: ${selectionDiagnostics.reason}. Evidence: [${selectionDiagnostics.evidence.join(", ")}]`);

            executedStepIndices.add(actionTarget.index);
            if (typeof currentActionOrder === "number") {
              executedActionOrders.add(currentActionOrder);
            }

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "found",
              targetText: actionTarget.target,
              snapshotUrl: scan.url,
              snapshotTitle: scan.title,
              elementsFound: scan.elementsCount,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
              semanticRole: actionTarget.semanticRole,
              relationContext: actionTarget.relationContext,
              selectionDiagnostics
            } as any);

            planSteps.push({
              index: planSteps.length + 1,
              action: "click",
              description: actionTarget.action,
              target: { strategy: "text", value: actionTarget.target, exact: false }
            });
            continue;
          }

          if (selectionDiagnostics.selectionLike && !isSubmitLikeTarget(actionTarget.target, actionTarget.action)) {
            console.log(`[discovery:case] Selection-like target accepted without clear transition: ${actionTarget.target}. Continuing to next step.`);

            executedStepIndices.add(actionTarget.index);
            if (typeof currentActionOrder === "number") {
              executedActionOrders.add(currentActionOrder);
            }

            steps.push({
              index: actionTarget.index,
              action: actionTarget.action,
              status: "found",
              targetText: actionTarget.target,
              snapshotUrl: scan.url,
              snapshotTitle: scan.title,
              elementsFound: scan.elementsCount,
              evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
              semanticRole: actionTarget.semanticRole,
              relationContext: actionTarget.relationContext,
              selectionDiagnostics: { ...selectionDiagnostics, noTransitionAccepted: true }
            } as any);

            planSteps.push({
              index: planSteps.length + 1,
              action: "click",
              description: actionTarget.action,
              target: { strategy: "text", value: actionTarget.target, exact: false }
            });
            continue;
          }

          steps.push({
            index: actionTarget.index,
            action: actionTarget.action,
            status: "click_no_transition",
            targetText: actionTarget.target,
            snapshotUrl: scan.url,
            snapshotTitle: scan.title,
            elementsFound: scan.elementsCount,
            error: authRecovery.error
              ? `Click completed but no page transition. Auth gate recovery attempted but failed: ${authRecovery.error}`
              : "Click completed but no page transition or DOM change was detected.",
            evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
            aiDiagnostics: (resolution as any).aiDiagnostics,
            selectionDiagnostics: selectionDiagnostics.selectionLike ? selectionDiagnostics : undefined
          } as any);

          await writeFile(
            path.join(evidenceDir, `step-${actionTarget.index}-before.json`),
            JSON.stringify({ state: beforeState }, null, 2),
            "utf-8"
          );
          await writeFile(
            path.join(evidenceDir, `step-${actionTarget.index}-after.json`),
            JSON.stringify({ state: afterRetryState }, null, 2),
            "utf-8"
          );

          failedAtStep = actionTarget.index;
          failedTarget = actionTarget.target;
          failedReason = "click_no_transition";

          await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
          await writeFile(pendingPlansPath, JSON.stringify(buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          ).candidatePlan ?? {}, null, 2), "utf-8");

          return buildFailureResult(
            scenario, steps, allDiscoveredObjects, planSteps,
            pendingObjectsPath, pendingPlansPath, evidenceDir,
            failedAtStep, failedTarget, failedReason, allDiscoveredObjects
          );
        }
      } catch {
        console.log("[discovery:case] Force click failed.");
      }
    }

    const scan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
    currentSnapshot = scan.snapshot;
    allDiscoveredObjects.push(...scan.objects);

    // Route profile learning: observe successful transitions
    if (transitionDetected && routeProfileLearningConfig.enabled) {
      const currentRouteHistory = steps
        .filter((s) => (s as any).status === "passed" || (s as any).status === "found")
        .map((s) => s.targetText!)
        .filter(Boolean);
      const lastSuccessfulTarget = currentRouteHistory[currentRouteHistory.length - 1];

      // Only a previous executable action (not an assertion/validation/wait) can be the
      // source of a learned transition; assertions must not change edge identity.
      const isAssertionLikeStepLocal = (s: any): boolean => {
        const metadata = s.metadata ?? s;
        const action = String(metadata.actionIntent ?? metadata.action ?? "").toLowerCase();
        const type = String(metadata.type ?? metadata.stepType ?? "").toLowerCase();
        const scope = String(metadata.scope ?? metadata.category ?? "").toLowerCase();
        return Boolean(s.assertionStatus || s.assertionClassification) ||
          type === "assertion" || action === "assert" || scope === "assertion";
      };
      let lastSuccessfulActionTarget: string | undefined;
      for (let i = steps.length - 1; i >= 0; i--) {
        const s = steps[i] as any;
        if ((s.index ?? i) >= actionTarget.index) continue;
        if ((s.status === "passed" || s.status === "found") && s.targetText && !isAssertionLikeStepLocal(s)) {
          lastSuccessfulActionTarget = s.targetText;
          break;
        }
      }

      const learningResult = observeRouteTransition({
        from: lastSuccessfulActionTarget || "entry",
        to: actionTarget.target,
        beforeUrl: beforeState.url,
        afterUrl: afterState.url,
        beforeSnapshotPath: path.join(evidenceDir, `step-${actionTarget.index}-before.json`),
        afterSnapshotPath: path.join(evidenceDir, `step-${actionTarget.index}-after.json`),
        candidateId: resolution.candidateId,
        candidateText: resolution.candidateText,
        locatorSummary: resolution.locatorStrategy,
        clickable: true,
        visible: true,
        sensitive: false,
        submitLike: false,
        riskyAction: false,
        transitionDetected,
        ...(beforeStructuralFingerprint ? { beforeStructuralFingerprint } : {}),
        ...(afterStructuralFingerprint ? { afterStructuralFingerprint } : {}),
        ...(beforeStructuralFingerprint ? { beforeTechnicalScreenKey: buildTechnicalScreenKey(beforeState.url, beforeStructuralFingerprint) } : {}),
        ...(afterStructuralFingerprint ? { afterTechnicalScreenKey: buildTechnicalScreenKey(afterState.url, afterStructuralFingerprint) } : {}),
        transitionValidated
      }, options.appSlug ?? "default", routeProfileLearningConfig);

      if (transitionValidated && beforeStructuralFingerprint && afterStructuralFingerprint) {
        const beforeTechnicalScreenKey = buildTechnicalScreenKey(beforeState.url, beforeStructuralFingerprint);
        const afterTechnicalScreenKey = buildTechnicalScreenKey(afterState.url, afterStructuralFingerprint);
        if (beforeTechnicalScreenKey && afterTechnicalScreenKey) {
          persistRuntimeTransition(options.appSlug ?? "default", {
            sourceTechnicalScreenKey: beforeTechnicalScreenKey,
            destinationTechnicalScreenKey: afterTechnicalScreenKey,
            transitionValidated: true,
            actionLocatorIdentity: resolution.candidateId ?? resolution.locatorStrategy,
            actionDescription: actionTarget.action,
          });
        }
      }
      
      if (learningResult.suggestion) {
        routeProfileSuggestions.push(learningResult.suggestion);
        console.log(`[route-learning] observed transition from="${learningResult.suggestion.from}" to="${learningResult.suggestion.to}" confidence=${learningResult.suggestion.confidence.toFixed(2)} status=${learningResult.suggestion.status}`);
      } else if (learningResult.reason) {
        console.log(`[route-learning] skipped: ${learningResult.reason}`);
      }
    }

    // Wait for server-side loading states to complete (e.g., "Generando...")
    if (transitionDetected) {
      try {
        const loadingDone = await page.waitForFunction(() => {
          const bodyText = document.body.textContent || "";
          const loadingPatterns = ["generando", "cargando", "procesando", "loading", "preparando"];
          return !loadingPatterns.some(p => bodyText.toLowerCase().includes(p));
        }, { timeout: 30000 });
        if (loadingDone) {
          console.log("[discovery:case] Loading state completed, re-scanning...");
          await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
          const postLoadScan = await scanAndCollectObjects(page, actionTarget.index, evidenceDir);
          currentSnapshot = postLoadScan.snapshot;
          allDiscoveredObjects.push(...postLoadScan.objects);
          // Extra stability check: ensure no spinners/skeleton remain
          const postLoadStability = await waitForStableInteractiveScreen(page);
          if (postLoadStability.signals.length > 0) {
            console.log(`[screen-stability] phase=after_loading_complete stable=${postLoadStability.stable} signals=${postLoadStability.signals.join(",")} waitedMs=${postLoadStability.waitedMs}`);
          }
        }
      } catch {
        console.log("[discovery:case] Loading state wait timed out, continuing with current snapshot.");
      }
    }

    if (authGateState?.completed) {
      markFunctionalStepAfterAuth(actionTarget.target, authGateState);
    }

    executedStepIndices.add(actionTarget.index);
    if (typeof currentActionOrder === "number") {
      executedActionOrders.add(currentActionOrder);
    }

    steps.push({
      index: actionTarget.index,
      action: actionTarget.action,
      status: "found",
      targetText: actionTarget.target,
      snapshotUrl: scan.url,
      snapshotTitle: scan.title,
      elementsFound: scan.elementsCount,
      evidencePath: path.join(evidenceDir, `step-${actionTarget.index}-snapshot.json`),
      semanticRole: actionTarget.semanticRole,
      relationContext: actionTarget.relationContext,
      controlIdentity: currentSnapshot.elements.find((element) => element.id === resolution.candidateId)?.controlIdentity,
      locatorStrategy: resolution.locatorStrategy,
      ...(rowCreationDiagnostics ? { rowMutationDiagnostics: rowCreationDiagnostics } : {}),
      recoveryMetadata: (resolution.locatorStrategy === "ordinal_selection" || 
                        resolution.locatorStrategy === "contextual_intermediate_already_satisfied"
        ? {
            recoveredBy: resolution.locatorStrategy === "ordinal_selection" ? "ordinal_selection" as const : "contextual_intermediate_already_satisfied" as const,
            rationale: resolution.matchReason,
            ordinalSelectionDiagnostics: (resolution as any).ordinalSelectionDiagnostics ? {
              selectionPatternDetected: (resolution as any).ordinalSelectionDiagnostics.selectionPatternDetected,
              ordinal: (resolution as any).ordinalSelectionDiagnostics.ordinal,
              domainTerm: (resolution as any).ordinalSelectionDiagnostics.domainTerm,
              domainTermSource: (resolution as any).ordinalSelectionDiagnostics.domainTermSource,
              selectedCandidateText: (resolution as any).ordinalSelectionDiagnostics.selectedCandidateText,
              selectedCandidateId: (resolution as any).ordinalSelectionDiagnostics.selectedCandidateId
            } : undefined,
            alreadySatisfiedEvidence: (resolution as any).alreadySatisfiedEvidence,
            selectedCandidateId: resolution.candidateId,
            selectedCandidateText: resolution.candidateText,
            segmentIndex: 0,
            transitionDetected,
            executedAction: actionTarget.action
          }
        : undefined) as any
    });

      const planControlIdentity = currentSnapshot.elements.find((element) => element.id === resolution.candidateId)?.controlIdentity;
      activePlanInputMetadata = {
        ...activePlanInputMetadata,
        ...(planControlIdentity ? { controlIdentity: planControlIdentity } : {}),
      };
      const planResolvedTargetName =
        typeof resolution.candidateText === "string" && resolution.candidateText.trim().length > 0
          ? resolution.candidateText.trim()
          : undefined;
      const planHasRuntimeReconciliation = Boolean(
        planResolvedTargetName
        && normalizeText(planResolvedTargetName) !== normalizeText(actionTarget.target)
        && resolution.confidence >= aiConfig.confidenceThreshold
      );
      planSteps.push({
        index: planSteps.length + 1,
        action: "click",
        description: actionTarget.action,
        target: { 
          strategy: (resolution.locatorStrategy || "text") as LocatorStrategy, 
          value: planHasRuntimeReconciliation ? planResolvedTargetName! : actionTarget.target,
          exact: false,
          metadata: (resolution.locatorStrategy === "ordinal_selection" || planHasRuntimeReconciliation) ? {
            originalTarget: actionTarget.target,
            resolvedTargetName: planHasRuntimeReconciliation ? planResolvedTargetName : resolution.candidateText,
            resolvedCandidateId: resolution.candidateId,
            aiAssisted: false,
            repairType: resolution.locatorStrategy === "ordinal_selection" ? "ordinal_selection" : "target_resolution",
            decisionStatus: "resolved",
            validationStatus: "passed",
            confidence: resolution.confidence
          } : undefined
        },
        locatorStrategy: resolution.locatorStrategy,
        controlIdentity: planControlIdentity,
        recoveryMetadata: resolution.locatorStrategy === "ordinal_selection" || 
                          resolution.locatorStrategy === "contextual_intermediate_already_satisfied"
          ? {
              recoveredBy: resolution.locatorStrategy === "ordinal_selection" ? "ordinal_selection" : "contextual_intermediate_already_satisfied",
              rationale: resolution.matchReason,
              ordinalSelectionDiagnostics: (resolution as any).ordinalSelectionDiagnostics ? {
                selectionPatternDetected: (resolution as any).ordinalSelectionDiagnostics.selectionPatternDetected,
                ordinal: (resolution as any).ordinalSelectionDiagnostics.ordinal,
                domainTerm: (resolution as any).ordinalSelectionDiagnostics.domainTerm,
                domainTermSource: (resolution as any).ordinalSelectionDiagnostics.domainTermSource,
                selectedCandidateText: (resolution as any).ordinalSelectionDiagnostics.selectedCandidateText,
                selectedCandidateId: (resolution as any).ordinalSelectionDiagnostics.selectedCandidateId
              } : undefined,
              alreadySatisfiedEvidence: (resolution as any).alreadySatisfiedEvidence,
              selectedCandidateId: resolution.candidateId,
              selectedCandidateText: resolution.candidateText,
              segmentIndex: 0,
              transitionDetected,
              executedAction: actionTarget.action
            }
          : undefined
      });

    if (await evaluateAndApplyEarlyCompletionAfterAction(actionTarget.index, actionTarget.target, currentActionOrder, evidenceStepIndex)) {
      break;
    }
  }

  // A canonical blocking intent may require one controlled submit attempt to
  // make validation and non-transition behavior observable. This is a bounded
  // probe over structural submit semantics, never a text-specific click.
  const controlledAdvanceAssertions = resolveControlledAdvanceAssertions(scenario);
  let controlledAdvanceProbe: ControlledAdvanceProbeResult | undefined;
  const unresolvedControlledAssertions = controlledAdvanceAssertions.filter((assertion) => {
    const existing = steps.find((step) => step.index === assertion.index);
    return existing?.assertionStatus !== "passed" && existing?.status !== "found";
  });
  if (unresolvedControlledAssertions.length > 0) {
    const intents = [...new Set(unresolvedControlledAssertions.map((assertion) => assertion.intent))];
    console.log(`[controlled-advance-probe] eligible=true intents=${intents.join(",")} unresolvedAssertions=${unresolvedControlledAssertions.length}`);
    const subjectRuntimeIdentities = new Set(runtimeFieldIdentities.values());
    const canonicalValidationRefs = new Set(
      unresolvedControlledAssertions
        .filter((assertion) => assertion.intent === "validation_present")
        .flatMap((assertion) => assertion.requirementRefs),
    );
    const triggerObservation = [...assertionObservations].reverse().find((observation) =>
      observation.mutation.validationMutation
      && observation.requirementRefs?.some((requirementRef) => canonicalValidationRefs.has(requirementRef))
      && observation.candidate?.targetIdentity
      && subjectRuntimeIdentities.has(observation.candidate.targetIdentity),
    ) ?? (assertionObservations.length > 0
      ? assertionObservations[assertionObservations.length - 1]
      : undefined);
    controlledAdvanceProbe = await runControlledAdvanceProbe({
      page,
      intent: intents,
      advanceAction: unresolvedControlledAssertions.find((assertion) => assertion.advanceAction)?.advanceAction,
      subjectIdentities: [...new Set(runtimeFieldIdentities.values())],
      subjectControlIdentities: [...runtimeFieldControlIdentities.values()],
      subjectInputApplied: runtimeFieldIdentities.size > 0,
      ...(triggerObservation ? { triggerObservation: { before: triggerObservation.before, after: triggerObservation.after } } : {}),
    });
    console.log(
      `[controlled-advance-probe] candidateFound=${controlledAdvanceProbe.candidateFound} `
      + `candidateEnabled=${controlledAdvanceProbe.candidateEnabled} attemptPossible=${controlledAdvanceProbe.attemptPossible} `
      + `resolutionState=${controlledAdvanceProbe.resolutionState} `
      + `candidateResolutionSource=${controlledAdvanceProbe.candidateResolutionSource ?? "none"} `
      + `attemptObserved=${controlledAdvanceProbe.attemptObserved} beforeCaptured=${controlledAdvanceProbe.beforeCaptured} `
      + `afterCaptured=${controlledAdvanceProbe.afterCaptured} validationMutation=${controlledAdvanceProbe.validationMutation} `
      + `subjectFound=${controlledAdvanceProbe.subjectFound} subjectValidationMutation=${controlledAdvanceProbe.subjectValidationMutation} `
      + `validationObserved=${controlledAdvanceProbe.validationObserved} transitionOccurred=${controlledAdvanceProbe.transitionOccurred} `
      + `advanceCausality=${controlledAdvanceProbe.advanceCausality} otherInvalidRequired=${controlledAdvanceProbe.otherInvalidRequiredControls} `
      + `blockedObserved=${controlledAdvanceProbe.blockedObserved} functionalDefectAssertion13=${controlledAdvanceProbe.functionalDefectAssertion13} `
      + `networkEvents=${controlledAdvanceProbe.networkEvents.length}`,
    );
    applyControlledAdvanceProbeToSteps(steps, scenario, unresolvedControlledAssertions, controlledAdvanceProbe);
  } else {
    console.log("[controlled-advance-probe] eligible=false reason=no_unresolved_canonical_blocking_assertion");
  }

  // Reconcile backed workflow evidence before any final blocker/status decision.
  const reconciledBeforeFinalStatus = options.beforeFinalStatusCalculation
    ? await options.beforeFinalStatusCalculation(steps)
    : 0;
  if (reconciledBeforeFinalStatus > 0) {
    failedAtStep = undefined;
    failedTarget = undefined;
    failedReason = undefined;
    console.log(`[observable-oracle-reconciliation] reconciled=${reconciledBeforeFinalStatus} before=first_blocking_failure_calculation`);
  }

  // Recover transient assertion failures BEFORE calculating final status
  let unresolvedBlockingFailures = calculateUnresolvedBlockingFailures(steps, {
    detected: authGateDetectedDuringDiscovery,
    detectedAtStepIndex: authGateDetectedAtStepIndex,
    completedAfterStepIndex: authGateCompletedAfterStepIndex,
    requiresAuthFlowCompletion: finalRequiresExplicitAuth,
    stage: authGateDetectedStage,
  });
  // Find when AuthGate was completed (if at all)
  const authGateCompletedAtStep = steps.findIndex(
    (s) => s.recoveredBy === "auth_flow" && s.index > 0
  );
  
  // Recover assertions that failed before AuthGate but were resolved after
  if (authGateCompletedAtStep >= 0 || steps.some(s => s.status === "found" && s.index > 0)) {
    recoverTransientAssertionFailures(
      steps,
      authGateCompletedAtStep >= 0 ? authGateCompletedAtStep : undefined,
      undefined // pageStabilizedAtStep - could be added if needed
    );
    unresolvedBlockingFailures = calculateUnresolvedBlockingFailures(steps, {
      detected: authGateDetectedDuringDiscovery,
      detectedAtStepIndex: authGateDetectedAtStepIndex,
      completedAfterStepIndex: authGateCompletedAfterStepIndex,
      requiresAuthFlowCompletion: finalRequiresExplicitAuth,
      stage: authGateDetectedStage,
    });
  }
  
  // Log recovery results
  const recoveredSteps = steps.filter(s => s.recoveryStatus === "recovered");
  if (recoveredSteps.length > 0) {
    console.log(`[discovery:case] Recovered ${recoveredSteps.length} transient assertion failure(s):`);
    for (const step of recoveredSteps) {
      console.log(`  - step=${step.index} target="${step.targetText}" recoveredBy=${step.recoveredBy} blocking=false`);
    }
  }

  // Calculate status based on UNRESOLVED blocking failures (not historical failures)
  const nonBlockingAssertionFailures = countNonBlockingAssertionFailures(steps);
  const foundSteps = steps.filter((s) => s.status === "found" || s.status === "satisfied_by_children" || (s.status === "skipped_after_completion" && earlyCompletionSatisfied)).length;
  const totalSteps = steps.filter((s) => s.status !== "skipped").length;
  const allFound = (foundSteps === totalSteps && totalSteps > 0 && unresolvedBlockingFailures.length === 0) || earlyCompletionSatisfied;
  const someFound = foundSteps > 0 || earlyCompletionSatisfied;
  
  // Clear failedReason if all failures were recovered
  let effectiveFailedReason = failedReason;
  let effectiveFailedAtStep = failedAtStep;
  let effectiveFailedTarget = failedTarget;
  
  const reconciledFailureMarkers = reconcileFailureMarkers(steps, { failedAtStep, failedTarget, failedReason });
  const failedMarkerReconciled = failedAtStep !== undefined && reconciledFailureMarkers.failedAtStep === undefined;

  if (unresolvedBlockingFailures.length === 0 && failedReason && (!isHardBlockingFailureReason(failedReason) || failedMarkerReconciled)) {
    // All failures were recovered - clear failedReason
    console.log(`[discovery:case] All failures recovered, clearing failedReason='${failedReason}'`);
    effectiveFailedReason = undefined;
    effectiveFailedAtStep = undefined;
    effectiveFailedTarget = undefined;
  } else if (unresolvedBlockingFailures.length === 0 && failedReason && isHardBlockingFailureReason(failedReason)) {
    console.log(`[discovery:case] preserving hard blocking failedReason='${failedReason}'`);
  } else if (unresolvedBlockingFailures.length > 0) {
    // Still have unresolved failures - use the first one
    const firstUnresolved = unresolvedBlockingFailures[0];
    effectiveFailedReason = firstUnresolved.error || "assertion_not_found";
    effectiveFailedAtStep = firstUnresolved.index;
    effectiveFailedTarget = firstUnresolved.targetText;
    console.log(`[discovery:case] unresolvedBlockingFailures=${unresolvedBlockingFailures.length}, using failedReason='${effectiveFailedReason}'`);
  } else {
    // No unresolved blocking failures (all were pendingDiscovery or contextual)
    console.log(`[discovery:case] unresolvedBlockingFailures=0 after assertion recovery`);
  }

  if (nonBlockingAssertionFailures > 0) {
    console.log(`[discovery:case] nonBlockingAssertionFailures=${nonBlockingAssertionFailures} ignored for blocking status`);
  }

  let status: CaseDiscoveryResult["status"] = effectiveFailedReason === "needs_approval"
    ? "needs_approval"
    : effectiveFailedReason === "needs_assertion_resolution"
      ? "needs_assertion_resolution"
      : effectiveFailedReason === "needs_setup_resolution"
        ? "needs_setup_resolution"
        : effectiveFailedReason === "needs_associated_target_resolution"
          ? "needs_associated_target_resolution"
          : effectiveFailedReason === "associated_entity_not_found"
            ? "needs_associated_target_resolution"
            : effectiveFailedReason === "associated_action_not_found"
              ? "needs_associated_target_resolution"
              : effectiveFailedReason === "missing_intermediate_step_to_final_target"
                ? "exploration_failed"
              : !effectiveFailedReason && failedReason
                ? "discovered_passed"
                : allFound
                  ? "discovered_passed"
                  : someFound
                    ? "discovered_partial"
                    : "exploration_failed";

  const pendingDiscoveryCount = steps.filter(s => (s as any)?.pendingDiscovery === true).length;
  const assertionContract = buildDiscoveryAssertionContract({
    steps,
    earlyCompletionSatisfied
  });

  for (const resolved of assertionContract.satisfiedByEquivalentEvidence) {
    console.log(
      `[assertion-resolution] assertion="${resolved.assertion}" classification=contextual evidence=${resolved.evidence} decision=satisfied_by_equivalent_evidence`
    );
  }
  if (assertionContract.destinationConfirmed) {
    for (const assertion of assertionContract.unresolvedContextualAssertions) {
      console.log(
        `[assertion-resolution] assertion="${assertion}" classification=contextual destinationConfirmed=true decision=non_blocking_warning`
      );
    }
  }

  const statusResolution = resolveDiscoveryStatusFromAssertionContract({
    initialStatus: status,
    unresolvedBlockingFailuresCount: unresolvedBlockingFailures.length,
    pendingDiscoveryCount,
    someFound,
    failedReason: effectiveFailedReason ?? failedReason,
    contract: assertionContract
  });

  if (statusResolution.status !== status) {
    const reason = statusResolution.decisionReason ?? "observable_assertion_requires_discovery";
    console.log(`[status-reconcile] before=${status} pendingDiscovery=${pendingDiscoveryCount}`);
    status = statusResolution.status;
    console.log(`[status-reconcile] after=${status} reason=${reason}`);
  }

  if (statusResolution.shouldSkipFullDiscovery) {
    console.log("[full-discovery] decision=skipped reason=only_contextual_assertions_pending");
    console.log("[functional-gate] decision=execute reason=navigation_confirmed_no_blocking_pending");
    console.log(
      `[discovery-result] blockingActions=${assertionContract.pendingBlockingActions.length} criticalAssertions=${assertionContract.pendingCriticalAssertions.length} contextualWarnings=${assertionContract.unresolvedContextualAssertions.length} destinationConfirmed=${assertionContract.destinationConfirmed} status=discovered`
    );
    effectiveFailedReason = undefined;
    effectiveFailedAtStep = undefined;
    effectiveFailedTarget = undefined;
  }
   
  // Log status reconciliation
  if (failedReason && !effectiveFailedReason) {
    console.log(`[discovery:case] status reconciled: discovered_partial -> discovered_passed (all failures recovered no blockers)`);
  }

  const requiredData = buildCandidateRequiredData(scenario, planSteps, resolvedDataKeys);

  const discoverySatisfied = status === "discovered_passed" || status === "repaired_passed";
  const candidatePlan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: discoverySatisfied ? "validated" : "needs_discovery",
    scenario: {
      source: "testrail",
      externalId: scenario.externalId,
      caseId: scenario.caseId,
      title: scenario.title
    },
    requiredData,
    steps: planSteps,
    notes: [
      ...(discoverySatisfied
        ? ["Discovery completed successfully. All targets and concrete assertions passed."]
        : [`Discovery partial: ${foundSteps}/${totalSteps} navigations/assertions satisfied.`]),
      ...(statusResolution.shouldSkipFullDiscovery && assertionContract.unresolvedContextualAssertions.length > 0
        ? [`Contextual assertions kept as non-blocking warnings: ${assertionContract.unresolvedContextualAssertions.join("; ")}`]
        : []),
      ...(nonBlockingAssertionFailures > 0
        ? [`Review needed: ${nonBlockingAssertionFailures} non-blocking assertion failure(s) were ignored for pass/fail reconciliation.`]
        : []),
      ...(recoveredSteps.length > 0
        ? [`Recovered ${recoveredSteps.length} transient assertion failure(s) - see step recovery metadata for details.`]
        : [])
    ],
    createdAt: new Date().toISOString(),
    // AuthFlow metadata for spec generation
    metadata: authGateCompletedAfterStepIndex !== undefined || authGateDetectedDuringDiscovery
      ? {
          authFlowRequired: authGateCompletedAfterStepIndex !== undefined,
          authFlowInsertionAfterStepIndex: authGateCompletedAfterStepIndex,
          authFlowAlias: "defaultClient",
          authFlowLanding: "transactions_menu",
          authGateDetectedDuringDiscovery: true,
          authGateStage: authGateDetectedStage ?? "unknown"
        }
      : undefined
  };

  await writeFile(pendingObjectsPath, JSON.stringify(allDiscoveredObjects, null, 2), "utf-8");
  await writeFile(pendingPlansPath, JSON.stringify(candidatePlan, null, 2), "utf-8");

  // Generate AI Repair case-level summary
  // Collect all AI repair diagnostics variants (target_resolution, selection_resolution, route_recovery, assertion_resolution)
  const stepsWithAiRepair: StepWithAiRepair[] = steps.map(s => {
    // Normalize all AI repair diagnostics variants to common format
    const aiRepairDiagnostics = (s as any).aiRepairDiagnostics;
    const aiSelectionRepairDiagnostics = (s as any).aiSelectionRepairDiagnostics;
    const aiRouteRepairDiagnostics = (s as any).aiRouteRepairDiagnostics;
    const aiAssertionRepairDiagnostics = (s as any).aiAssertionRepairDiagnostics;
    
    // Use the first available diagnostics variant
    let diagnostics = aiRepairDiagnostics || aiSelectionRepairDiagnostics || aiRouteRepairDiagnostics || aiAssertionRepairDiagnostics;
    
    // Enrich with selection-specific fields if present
    if (aiSelectionRepairDiagnostics && diagnostics) {
      diagnostics = {
        ...diagnostics,
        selectedCandidateId: aiSelectionRepairDiagnostics.selectedCandidateId ?? diagnostics.selectedCandidateId,
        selectionStatus: aiSelectionRepairDiagnostics.selectionStatus ?? diagnostics.selectionStatus
      };
    }
    
    // Include resolved target info for selection_resolution
    const resolvedTargetName = (s as any).resolvedTargetName;
    const resolvedCandidateId = (s as any).resolvedCandidateId;
    
    if (resolvedTargetName && diagnostics) {
      diagnostics = {
        ...diagnostics,
        target: diagnostics.target ?? (s as any).targetText,
        resolvedTargetName,
        resolvedCandidateId: resolvedCandidateId ?? diagnostics.selectedCandidateId
      };
    }
    
    return {
      index: s.index,
      targetText: s.targetText,
      action: s.action,
      aiRepairDiagnostics: diagnostics
    };
  });
  const aiRepairSummary = buildAiRepairCaseSummary(stepsWithAiRepair, discoveryAppSlug);
  
  // Save AI Repair summary to artifact
  const aiRepairSummaryPath = path.join(evidenceDir, "ai-repair-summary.json");
  await writeJsonSafe(aiRepairSummaryPath, aiRepairSummary);
  
  // Print AI Repair summary to console
  console.log("");
  console.log(formatAiRepairConsoleOutput(aiRepairSummary));

  // Save route profile learning suggestions
  if (routeProfileLearningConfig.enabled) {
    try {
      const suggestionsPath = await saveRouteProfileSuggestions(
        routeProfileSuggestions,
        evidenceDir,
        options.appSlug ?? "default",
        scenario.caseId
      );
      
      if (suggestionsPath) {
        const approved = routeProfileSuggestions.filter((s) => s.status === "auto_approved");
        const pending = routeProfileSuggestions.filter((s) => s.status === "pending");
        
        console.log(`[route-learning] summary: ${approved.length} auto_approved, ${pending.length} pending`);
      }

      if (!routeProfileLearningConfig.autoApply) {
        console.log(`[route-learning] autoApply skipped reason=disabled`);
      } else {
        const approvedSuggestions = routeProfileSuggestions.filter(
          (suggestion) => suggestion.status === "auto_approved"
        );
        if (approvedSuggestions.length === 0) {
          console.log(`[route-learning] autoApply skipped reason=no_auto_approved`);
        } else if (!discoveryAppSlug || discoveryAppSlug === "default") {
          console.log(`[route-learning] autoApply skipped reason=missing_app_slug`);
        } else {
          try {
            const applyResult = await applyRouteProfileSuggestions(
              discoveryAppSlug,
              approvedSuggestions,
              path.join(process.cwd(), "automations")
            );
            if (applyResult.error) {
              console.log(`[route-learning] autoApply failed error=${applyResult.error}`);
            } else {
              console.log(`[route-learning] autoApply applied=${applyResult.applied} approved=${approvedSuggestions.length} changes=${applyResult.changes?.length ?? 0}`);
            }
          } catch (err) {
            console.log(`[route-learning] autoApply failed error=${err instanceof Error ? err.message : String(err)}`);
          }

          let persisted = 0;
          let duplicates = 0;
          let failed = 0;
          const automationsRoot = path.join(process.cwd(), "automations");
          for (const suggestion of approvedSuggestions) {
            try {
              const knowledgeResult = await appendRouteSuggestionToKnowledge(
                discoveryAppSlug,
                suggestion,
                automationsRoot
              );
              if (knowledgeResult.error) {
                failed++;
                console.log(`[route-learning] knowledge persist failed actionTarget="${suggestion.to}" error=${knowledgeResult.error}`);
              } else if (knowledgeResult.persisted && knowledgeResult.duplicate) {
                duplicates++;
              } else if (knowledgeResult.persisted) {
                persisted++;
              } else {
                failed++;
              }
            } catch (err) {
              failed++;
              console.log(`[route-learning] knowledge persist failed actionTarget="${suggestion.to}" error=${err instanceof Error ? err.message : String(err)}`);
            }
          }
          console.log(`[route-learning] knowledge persisted=${persisted} duplicates=${duplicates} failed=${failed}`);
        }
      }
    } catch (err) {
      console.log(`[route-learning] failed to save suggestions: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Remove the duplicate recoverTransientAssertionFailures call - already done above
  // (keeping this as a no-op for safety but it's redundant now)

  return {
    version: "1.0",
    caseId: scenario.caseId,
    caseTitle: scenario.title,
    discoveredAt: new Date().toISOString(),
    status,
    steps,
    discoveredObjects: allDiscoveredObjects,
    candidatePlan,
    pendingObjectsPath,
    pendingPlansPath,
    evidenceDir,
    failedAtStep: effectiveFailedAtStep,
    failedTarget: effectiveFailedTarget,
    failedReason: effectiveFailedReason,
    aiRepairSummary,
    assertionObservations,
    ...(controlledAdvanceProbe ? { controlledAdvanceProbe } : {})
  };
}

export function printCaseDiscoverySummary(result: CaseDiscoveryResult): void {
  console.log("");
  console.log("=== Case Discovery Results ===");
  console.log(`Case: C${result.caseId} - ${result.caseTitle}`);
  console.log(`Status: ${result.status}`);
  console.log(`Discovered at: ${result.discoveredAt}`);
  console.log("");

  console.log("Steps:");
  for (const step of result.steps) {
    const icon = step.status === "found" ? "✓" : step.status === "not_found" ? "✗" : step.status === "click_no_transition" ? "⚠" : "-";
    console.log(`  ${icon} Step ${step.index}: ${step.action}`);
    if (step.targetText) {
      console.log(`    Target: ${step.targetText}`);
    }
    if (step.error) {
      console.log(`    Error: ${step.error}`);
    }
    if (step.attemptedLocators && step.attemptedLocators.length > 0) {
      console.log(`    Attempted locators: ${step.attemptedLocators.join(" | ")}`);
    }
    if (step.evidencePath) {
      console.log(`    Evidence: ${step.evidencePath}`);
    }
  }

  console.log("");
  console.log(`Discovered objects: ${result.discoveredObjects.length}`);
  if (result.discoveredObjects.length > 0) {
    const byType: Record<string, number> = {};
    for (const obj of result.discoveredObjects) {
      byType[obj.type] = (byType[obj.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(byType)) {
      console.log(`  ${type}: ${count}`);
    }
  }

  console.log("");
  console.log(`Pending objects: ${result.pendingObjectsPath ?? "N/A"}`);
  console.log(`Pending plans: ${result.pendingPlansPath ?? "N/A"}`);
  console.log(`Evidence dir: ${result.evidenceDir ?? "N/A"}`);

  if (result.candidatePlan) {
    console.log("");
    console.log(`Candidate plan steps: ${result.candidatePlan.steps.length}`);
    console.log(`Candidate plan status: ${result.candidatePlan.status}`);
  }

  if (result.failedAtStep) {
    console.log("");
    console.log(`Failed at step: ${result.failedAtStep}`);
    console.log(`Failed target: ${result.failedTarget ?? "unknown"}`);
    if (result.failedReason) {
      console.log(`Failed reason: ${result.failedReason}`);
    }
  }
}
