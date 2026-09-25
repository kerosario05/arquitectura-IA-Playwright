import fs from "node:fs";
import path from "node:path";
import type { Page, Request } from "@playwright/test";
import type { AssertionPolarity } from "../../scenarios/canonical-scenario";
import type { AppRouteProfile } from "../../types/env.types";
import { capturePageDiagnostics, waitForListReadiness } from "../../browser/promoted-spec-helpers";
import { waitForStablePageState } from "../../discovery/page-stability-detector";
import { waitForStableInteractiveScreen } from "../../runner/execution-plan-executor";
import { waitForPageReady } from "../../browser/page-readiness";
import { EvidenceRecorder } from "../../evidence/evidence-recorder";
import { loadEvidenceConfig } from "../../evidence/evidence-types";
import { normalizeSemanticText } from "../semantic-text-normalization";
import { findSemanticTargetMatch, type SemanticMatchOptions } from "./semantic-target-matcher";
import { resolveActionTarget, recordedLocatorFactory, resolveRecordedStructuralOwner } from "../../discovery/target-resolver";
import { hasCausalSelectionTransition, type InteractiveState } from "../../discovery/selection-state-verification";
import type { RecordedLocator, RecordedTechnicalTarget } from "../../recording/session-trace.types";
import type { PlaywrightRecorderEvidence, SemanticRuntimeEvidence } from "../../recording/structural-owner-identity";
import { scanCurrentPage } from "../../explorer/page-scanner";
import {
  parseTechnicalTargetRefs,
  resolvePromotedFieldIdentityFromPersistedContract,
  semanticNameFromRef,
  type PromotedFieldTargetIdentity,
} from "./promoted-field-target-contract";

/**
 * Wiring/observability fix (recordingId=1f9415f3-...): physical evidence across several runs
 * showed a `[promoted-step]` log added in one edit reach the physical process while a LATER
 * edit's `[runtime:boundary]` logs (inside the SAME function, `ensureInitialEvidence`) never
 * did -- even on step 1, the very first, unconditional call. That split is impossible from a
 * single fresh load of this file (both logs are plain, unconditional statements in the same
 * function); it is the signature of a STALE, previously-loaded copy of this exact module frozen
 * in memory by whatever process actually executes the promoted spec, from a point in time
 * between those two edits. No stale `.ts`-shadowing `.js` file survives anywhere in this
 * module's import chain (verified/quarantined). This marker makes that condition unambiguous
 * for the NEXT physical run: it fires exactly once, when this module is first evaluated, and its
 * `version`/`loadedAt`/`pid` are also carried on every `[promoted-step]` line below. If a future
 * run's `[promoted-step]` lines carry an OLDER version than the one in this source file at that
 * time (or if this exact marker line is absent while step logs still appear), the executing
 * process is provably running a cached/stale copy of this module and must be restarted -- no
 * further code change in this file can fix that from the inside.
 */
export const PROMOTED_SPEC_RUNTIME_MODULE_VERSION = "2026-09-24T18-boundary-diagnostics-v1";
console.log(
  `[runtime:module-loaded] file=src/automations/runtime/promoted-spec-runtime.ts ` +
  `version=${PROMOTED_SPEC_RUNTIME_MODULE_VERSION} loadedAt=${new Date().toISOString()} pid=${process.pid}`,
);

export type SafeReplayStep = {
  stepIndex: number;
  actionIntent: string;
  target: string;
  action?: () => Promise<void>;
  replay?: () => Promise<void>;
  sensitive?: boolean;
};

export type PromotedExpectedEffect =
  | "none"
  | "navigation"
  | "modal_or_form_or_navigation"
  | "ui_change"
  /**
   * A structured Recording selection/toggle click (recorded ARIA role option/checkbox/radio/
   * switch/tab, verified non-positional control lineage -- see deterministic-spec-compiler.ts's
   * `isSelectionLikeRecordedRole`/`hasUniqueControlLineage`). Completion authority is a causal
   * transition on the SAME resolved target's own state (`hasCausalSelectionTransition`, the exact
   * shared CORE Discovery's own `target_selection_state_changed` signal already uses) -- never
   * the generic route/DOM-mutation checks `ui_change` requires.
   */
  | "selection_state_change";

/** Read the SAME structured interactive-state shape Discovery's `readInteractiveState` reads
 *  (checked/aria-checked/selected/aria-pressed/value) from an already-resolved promoted locator.
 *  Never re-derives the causal comparison itself -- `hasCausalSelectionTransition` (imported) is
 *  the single shared CORE both Discovery and promoted runtime compare against. */
async function readPromotedInteractiveState(locator: any): Promise<InteractiveState | undefined> {
  if (!locator) return undefined;
  return locator.evaluate((element: any) => ({
    ...(typeof element.checked === "boolean" ? { checked: element.checked } : {}),
    ariaChecked: element.getAttribute("aria-checked"),
    ...(typeof element.selected === "boolean" ? { selected: element.selected } : {}),
    ariaPressed: element.getAttribute("aria-pressed"),
    ...(typeof element.value === "string" ? { value: element.value } : {}),
  })).catch(() => undefined);
}

type PromotedSelectionStateProbe = {
  locator: any;
  before: InteractiveState | undefined;
  strategy: string;
};

function selectionRuntimeSnapshot(state: InteractiveState | undefined): string {
  return [
    `checked=${state?.checked ?? "absent"}`,
    `selected=${state?.selected ?? "absent"}`,
    `ariaSelected=not_observed`,
    `ariaChecked=${state?.ariaChecked ?? "absent"}`,
    `dataState=not_observed`,
    `classStateRelevant=not_observed`,
  ].join(" ");
}

async function capturePromotedSelectionStateProbe(
  page: Page,
  target: string,
  targetIdentity: PromotedFieldTargetIdentity | undefined,
): Promise<PromotedSelectionStateProbe | undefined> {
  const technicalProbeCandidates = await Promise.all(
    (targetIdentity?.technicalTargetRefs ?? [])
      .map(parseSerializedTechnicalTargetString)
      .filter((candidate): candidate is RecordedLocator => Boolean(candidate))
      .map(async (candidate) => {
        const locator = recordedLocatorFactory(page, candidate, true);
        const count = locator ? await locator.count().catch(() => 0) : 0;
        const visible = count === 1 && await locator!.isVisible().catch(() => false);
        const enabled = visible && await locator!.isEnabled().catch(() => false);
        return locator && visible && enabled ? { locator, strategy: `recorded:${candidate.strategy}` } : undefined;
      }),
  );
  const resolvedTechnicalCandidates = technicalProbeCandidates.filter((candidate): candidate is { locator: any; strategy: string } => Boolean(candidate));
  const resolved = resolvedTechnicalCandidates.length === 1
    ? resolvedTechnicalCandidates[0]
    : (targetIdentity?.technicalTargetRefs.length ?? 0) === 0
      ? await resolvePromotedFieldLocator(page, target, { targetIdentity }).catch(() => undefined)
      : undefined;
  const probe = resolved ? { locator: resolved.locator, before: await readPromotedInteractiveState(resolved.locator), strategy: resolved.strategy } : undefined;
  console.log(
    `[selection-runtime] phase=before_dispatch targetIdentity=${targetIdentity?.technicalTargetRefs.join(",") ?? "none"} ` +
    `probeAvailable=${Boolean(probe)} strategy=${probe?.strategy ?? "unresolved"} snapshot="${selectionRuntimeSnapshot(probe?.before)}"`,
  );
  return probe;
}

type PromotedActionSurfaceSnapshot = {
  url: string;
  signature: string;
  /**
   * FIRST_LOSS fix (runId=preview-2026-09-24T19-08-48): `signature` only ever covers a narrow
   * interactive-control selector (button/a/[role]/input/textarea/select/h1-h6) -- a real screen
   * transition whose new content is plain rendered text (a confirmation message, an OTP-sent
   * countdown, an instructional paragraph) never touches it at all, even though the page
   * genuinely changed. Physical evidence: a click on a recorded, uniquely-resolved target
   * produced a new screen ("Verificacion de Usuario", "Reenviar codigo en ... segundos") with no
   * URL change and no signature delta, so `postActionStability` reported
   * `no_observable_post_action_outcome` for an action that demonstrably had a real effect.
   * `innerText` is the browser's own rendered-text accessor -- it already excludes
   * display:none/visibility:hidden content per the render tree, generically, for any project,
   * with no selector/text/business-content authored here.
   */
  contentFingerprint: string;
  targetVisible: boolean;
  surfaceCount: number;
};

type PromotedActionOutcome = PromotedActionSurfaceSnapshot & {
  navigationObserved: boolean;
  routeChanged: boolean;
  domTransitionObserved: boolean;
  newBusinessSurfaceObserved: boolean;
  inPlaceOutcomeObserved: boolean;
  targetDisappeared: boolean;
};

function effectiveExpectedEffect(
  requested: PromotedExpectedEffect | string | undefined,
  identity?: PromotedFieldTargetIdentity,
): PromotedExpectedEffect {
  if (requested === "none") return "none";
  if (identity?.expectedRouteTransition) return "navigation";
  if (identity?.expectedInPlaceTransition) return "ui_change";
  if (requested === "navigation" || requested === "modal_or_form_or_navigation" || requested === "ui_change" || requested === "selection_state_change") {
    return requested;
  }
  // Legacy generated specs used human-readable expectedEffect text. The persisted interaction
  // remains the authority when available; without it, require a real DOM outcome rather than
  // treating a no-op as success.
  return "ui_change";
}

function isRetryableTargetClickError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /detached|not attached|intercepts pointer events|another element would receive the click|not receiving pointer events|target closed/i.test(message);
}

export async function clickPromotedLocatorWithBoundedReresolution(
  resolved: { locator: any },
  resolveFresh: () => Promise<{ locator: any } | undefined>,
  timeoutMs: number,
): Promise<{ locator: any; reResolved: boolean }> {
  try {
    await withTimeout(resolved.locator.click({ timeout: timeoutMs, noWaitAfter: true }), timeoutMs, "native click");
    return { locator: resolved.locator, reResolved: false };
  } catch (error) {
    if (!isRetryableTargetClickError(error)) throw error;
    const freshResolved = await resolveFresh();
    if (!freshResolved?.locator) throw error;
    await withTimeout(
      freshResolved.locator.click({ timeout: timeoutMs, noWaitAfter: true }),
      timeoutMs,
      "native click after bounded re-resolution",
    );
    return { locator: freshResolved.locator, reResolved: true };
  }
}

/**
 * Press twin of `clickPromotedLocatorWithBoundedReresolution`: dispatches a target-scoped
 * `locator.press(key)`, never `.click()` and never a `page.keyboard` fallback -- the key is an
 * argument to the resolved target's own press action, never a locator itself.
 */
export async function pressPromotedLocatorWithBoundedReresolution(
  resolved: { locator: any },
  resolveFresh: () => Promise<{ locator: any } | undefined>,
  timeoutMs: number,
  key: string,
): Promise<{ locator: any; reResolved: boolean }> {
  try {
    await withTimeout(resolved.locator.press(key, { timeout: timeoutMs, noWaitAfter: true }), timeoutMs, "native press");
    return { locator: resolved.locator, reResolved: false };
  } catch (error) {
    if (!isRetryableTargetClickError(error)) throw error;
    const freshResolved = await resolveFresh();
    if (!freshResolved?.locator) throw error;
    await withTimeout(
      freshResolved.locator.press(key, { timeout: timeoutMs, noWaitAfter: true }),
      timeoutMs,
      "native press after bounded re-resolution",
    );
    return { locator: freshResolved.locator, reResolved: true };
  }
}

async function capturePromotedActionSurfaceSnapshot(page: Page, target: string): Promise<PromotedActionSurfaceSnapshot> {
  const normalizedTarget = normalizeSemanticText(target).toLowerCase();
  return page.evaluate((expectedTarget) => {
    const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
    const visible = (element: Element) => {
      const node = element as HTMLElement;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const fingerprintValue = (value: string) => {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return `${value.length}:${hash >>> 0}`;
    };
    const visibleControls = Array.from(document.querySelectorAll("button, a, [role=button], [role=link], [role=dialog], input, textarea, select, [contenteditable=true], h1, h2, h3, h4, h5, h6"))
      .filter(visible)
      .map((element) => {
        const state = [
          element.getAttribute("aria-expanded") || "",
          element.getAttribute("aria-checked") || "",
          element.getAttribute("aria-selected") || "",
          element.getAttribute("aria-pressed") || "",
          element.getAttribute("data-state") || "",
          (element as HTMLButtonElement).disabled ? "disabled" : "enabled",
          (element as HTMLInputElement).checked ? "checked" : "unchecked",
        ].join("/");
        const value = "value" in element ? String((element as HTMLInputElement).value ?? "") : element.getAttribute("contenteditable") === "true" ? element.textContent || "" : "";
        return `${element.tagName.toLowerCase()}|${normalize(element.textContent || "")}|${state}|valueFingerprint=${fingerprintValue(value)}`;
      })
      .filter((value) => value.length > 1);
    const targetVisible = visibleControls.some((value) => normalize(value).includes(expectedTarget));
    const contentFingerprint = fingerprintValue(normalize((document.body as HTMLElement).innerText || ""));
    return {
      url: window.location.href,
      signature: visibleControls.slice(0, 250).join("\n"),
      contentFingerprint,
      targetVisible,
      surfaceCount: document.querySelectorAll("main, [role=main], [role=dialog], [role=grid], form").length,
    };
  }, normalizedTarget);
}

type PromotedActionSurfaceSnapshotOutcome =
  | { status: "available"; snapshot: PromotedActionSurfaceSnapshot }
  | { status: "timeout" }
  | { status: "error"; error: string };

/**
 * FIRST_LOSS fix (recordingId=1f9415f3-...): `capturePromotedActionSurfaceSnapshot` (a
 * `page.evaluate` walking the whole visible control surface) had no deadline of its own either,
 * and -- worse -- `clickPromotedTarget` was calling it BEFORE `detectHomeResetOrInactivity`, so
 * the session-diagnostic timeout fix could never even be reached: physical evidence showed the
 * runtime hang for the full 90s test timeout with no `[runtime:diagnostic]` log at all. Bounded
 * here by the SAME `actionTimeoutMs` the rest of the runtime already uses (never a second
 * independent budget), with an explicit status (`available`/`timeout`/`error`) instead of the
 * previous silent `.catch(() => undefined)` -- a timeout or error still yields no snapshot
 * (never fabricates a signature), but is now observable, and `clickPromotedTarget` only calls
 * this AFTER the session diagnostic + replay handling have already run.
 */
async function capturePromotedActionSurfaceSnapshotBounded(
  page: Page,
  target: string,
  timeoutMs: number,
): Promise<PromotedActionSurfaceSnapshotOutcome> {
  let timeoutRef: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<PromotedActionSurfaceSnapshotOutcome>((resolve) => {
    timeoutRef = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });
  try {
    return await Promise.race([
      capturePromotedActionSurfaceSnapshot(page, target).then((snapshot): PromotedActionSurfaceSnapshotOutcome => ({ status: "available", snapshot })),
      timeoutPromise,
    ]);
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timeoutRef) clearTimeout(timeoutRef);
  }
}

export type PromotedRuntimeConfig = {
  enabled: boolean;
  actionTimeoutMs: number;
  stabilityTimeoutMs: number;
  retryEnabled: boolean;
  captureDiagnostics: boolean;
  evidenceEnabled: boolean;
};

type PromotedAuthBoundaryAttempt = {
  attempt: number;
  browserStarted: true;
  contextStarted: true;
  pageStarted: true;
  loginRequestObserved: boolean;
  loginRequestStartedAt?: number;
  loginResponseObserved: boolean;
  loginResponseAt?: number;
  loginStatus?: number;
  loginRequestFinished: boolean;
  loginRequestFinishedAt?: number;
  loginRequestFailed: boolean;
  loginRequestFailureText?: string;
  requestPending: boolean;
  redirectObserved: boolean;
  urlChanged: boolean;
  loadingIndicatorObserved: boolean;
  authSurfaceStillVisible: boolean;
  postLoginSurfaceObserved: boolean;
  businessSurfaceReached: boolean;
  failureClassification: string;
  authRejected: boolean;
  applicationError: boolean;
  functionalBusinessExecutionStarted: boolean;
  oracleEvaluationStarted: boolean;
};

export type PromotedRuntimeDiagnostics = {
  currentUrl: string;
  actionIntent: string;
  target: string;
  stepIndex: number;
  timeoutMs: number;
  activeContainer?: string;
  lastDialogMessage?: string;
  stability?: Record<string, unknown>;
  retryAttempted: boolean;
  screenshotPath?: string;
  previousActiveContainer?: string;
  refreshedActiveContainer?: string;
  matchingFieldFound?: boolean;
  fallbackUsed?: "none" | "active_container" | "refreshed_container" | "page" | "callback";
  searchedContainers?: number;
  discardedReason?: string;
  matchedLocatorStrategy?: string;
  // Native fill tracking
  fillPath?: "native_runtime" | "pom_callback" | "page_fallback" | "failed";
  nativeFillAttempted?: boolean;
  nativeFillSucceeded?: boolean;
  nativeFillError?: string;
  callbackAttempted?: boolean;
  callbackSucceeded?: boolean;
  callbackError?: string;
  verificationAttempted?: boolean;
  verificationSucceeded?: boolean;
  verificationSkippedReason?: string;
  // Native click tracking
  clickPath?: "native_runtime" | "pom_callback" | "page_fallback" | "failed";
  nativeClickAttempted?: boolean;
  nativeClickSucceeded?: boolean;
  nativeClickError?: string;
  expectedEffect?: string;
  effectDetected?: boolean;
  valueKey?: string;
  technicalTargetRefs?: string[];
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
  targetIdentity?: string;
  surfaceIdentity?: string;
  containerIdentity?: string;
  fieldIdentity?: string;
  fieldCandidateCount?: number;
};

export type PromotedActionOptions = {
  stepIndex: number;
  target: string;
  actionIntent: string;
  expectedEffect?: PromotedExpectedEffect;
  sensitive?: boolean;
  routeProfile?: AppRouteProfile;
  action: () => Promise<void>;
  evidenceDir?: string;
  valueKey?: string;
  technicalTargetRefs?: string[];
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
};

export type PromotedFillOptions = {
  stepIndex: number;
  field?: string;
  target?: string;
  value: string;
  sensitive?: boolean;
  actionIntent?: string;
  fill: () => Promise<void>;
  fillInActiveContainer?: () => Promise<void>;
  fillInPage?: () => Promise<void>;
  ensureEditable?: () => Promise<void>;
  valueKey?: string;
  technicalTargetRefs?: string[];
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
  entityScope?: string;
  targetIdentity?: string;
  surfaceIdentity?: string;
  containerIdentity?: string;
  fieldIdentity?: string;
  evidenceDir?: string;
  /**
   * Structured auth-gate credential authority transported from the compiled contract step
   * (`SpecExecutionContractStep.authGateExpected`). When true, a `fill_form_field` is compatible
   * with the login/auth-gate screen; a business fill (absent/false) stays fail-closed there.
   */
  authGateExpected?: boolean;
};

function normalizePromotedFieldAlias(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

const KNOWN_RECORDED_LOCATOR_STRATEGIES = new Set([
  "css", "data-testid", "aria-label", "placeholder", "label", "text", "role",
]);

/**
 * FIRST_LOSS fix (jobId 4bcae275-38d7-487c-926a-24cd882cb8a3): a technical target already
 * serialized in the recorded `strategy:value` convention (e.g. "role:textbox|Contraseña", the
 * SAME format `recordedLocatorFactory` already parses for the authoritative Recording/direct-
 * replay resolver) arrives at `pressPromotedTarget` as a flat string, since its API has no
 * separate structured field. Treating that string as a human field label (via
 * `resolvePromotedFieldLocator`'s fuzzy text search) degrades real structural authority into a
 * text guess that can never uniquely match. This detects the SAME serialization convention and
 * hands it directly to the SAME shared parser Recording already trusts, never inventing a
 * second role/name parser.
 */
export function parseSerializedTechnicalTargetString(target: string): RecordedLocator | undefined {
  const separator = target.indexOf(":");
  if (separator <= 0) return undefined;
  const strategy = target.slice(0, separator).trim().toLowerCase();
  const value = target.slice(separator + 1).trim();
  if (!KNOWN_RECORDED_LOCATOR_STRATEGIES.has(strategy) || !value) return undefined;
  return { strategy, value };
}

export type PromotedPressOptions = {
  stepIndex: number;
  field?: string;
  target?: string;
  key: string;
  actionIntent?: string;
  expectedEffect?: PromotedExpectedEffect;
  valueKey?: string;
  technicalTargetRefs?: string[];
  evidenceDir?: string;
};

export function resolvePromotedFieldTarget(options: { field?: unknown; target?: unknown }): string {
  const field = typeof options.field === "string" && options.field.trim() !== "" ? options.field : undefined;
  const target = typeof options.target === "string" && options.target.trim() !== "" ? options.target : undefined;
  if (field && target && normalizePromotedFieldAlias(field) !== normalizePromotedFieldAlias(target)) {
    throw new Error("conflicting_field_target: field and legacy target aliases differ");
  }
  const resolved = field ?? target;
  if (!resolved) throw new Error("invalid_context_action_target: field or target is required");
  return resolved;
}

export function runtimeEnvNameForValueKey(valueKey: string): string {
  const normalized = valueKey.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `PROMOTED_${normalized}`;
}

/**
 * Pure env-patch materializer for ALREADY-RESOLVED promoted runtime values -- never resolves
 * data itself (callers own resolution/authority). Applies the exact same PROMOTED_<KEY> naming
 * convention resolvePromotedRuntimeValue (above) and the deterministic compiler's
 * dataRefEnvExpression both already use, plus the same PROMOTED_RUNTIME_DATA_OVERRIDES_JSON
 * fallback shape resolvePromotedRuntimeValue already consults -- one authority, no second
 * protocol. Secrets exist only in the returned env patch; never logged, never returned in any
 * other form.
 */
export function materializePromotedRuntimeEnv(resolvedValues: Record<string, string>): NodeJS.ProcessEnv {
  const patch: NodeJS.ProcessEnv = {};
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(resolvedValues)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    patch[runtimeEnvNameForValueKey(key)] = value;
    overrides[key] = value;
  }
  if (Object.keys(overrides).length > 0) {
    patch.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON = JSON.stringify(overrides);
  }
  return patch;
}

function resolvePromotedRuntimeValue(valueKey: string | undefined): string | undefined {
  if (!valueKey?.trim()) return undefined;
  const direct = process.env[runtimeEnvNameForValueKey(valueKey)];
  if (typeof direct === "string" && direct.trim() !== "") return direct;
  const raw = process.env.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON;
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalizedKey = valueKey.trim().toLowerCase();
    const found = Object.entries(parsed).find(([key, value]) =>
      key.trim().toLowerCase() === normalizedKey && typeof value === "string" && value.trim() !== "",
    );
    return found ? String(found[1]) : undefined;
  } catch {
    return undefined;
  }
}

function rowScopeFromPromotedRef(rowRef?: string): number | undefined {
  const match = rowRef?.match(/(?:^|:)row:(\d+)$/) ?? rowRef?.match(/(\d+)$/);
  if (!match) return undefined;
  const row = Number.parseInt(match[1], 10);
  return Number.isFinite(row) && row > 0 ? row : undefined;
}

function rowScopeFromEntityScope(entityScope?: string): number | undefined {
  const match = entityScope?.match(/(?:^|[_:])entity[_:]?(\d+)$/i);
  if (!match) return undefined;
  const row = Number.parseInt(match[1], 10);
  return Number.isFinite(row) && row > 0 ? row : undefined;
}

async function resolvePromotedSelectionOption(
  page: Page,
  value: string | undefined,
  timeoutMs: number,
): Promise<{ locator: any; strategy: string } | undefined> {
  if (!value?.trim()) return undefined;
  const candidates = [
    { strategy: "structured:selection-option-role", locator: () => page.getByRole("option", { name: value, exact: true }) },
    { strategy: "structured:selection-option-text", locator: () => page.getByText(value, { exact: true }) },
  ];
  for (const candidate of candidates) {
    try {
      const locator = candidate.locator();
      if (await locator.count() !== 1) continue;
      if (!(await locator.isVisible({ timeout: timeoutMs }).catch(() => false))) continue;
      if (await locator.isDisabled({ timeout: timeoutMs }).catch(() => false)) continue;
      return { locator, strategy: candidate.strategy };
    } catch {
      // Try the next semantic option strategy.
    }
  }
  return undefined;
}

export type PromotedAssertOptions = {
  stepIndex: number;
  target: string;
  description?: string;
  polarity?: AssertionPolarity;
  expectedUrl?: string;
  assertion: () => Promise<void>;
  evidenceDir?: string;
};

export function evaluatePromotedAssertionState(
  currentUrl: string,
  descriptor: { polarity?: AssertionPolarity; expectedUrl?: string },
): boolean {
  if (descriptor.polarity !== "positive" && descriptor.polarity !== "negative") {
    throw new Error("PROMOTED_ASSERTION_POLARITY_UNRESOLVED");
  }
  if (typeof descriptor.expectedUrl !== "string" || descriptor.expectedUrl.trim() === "") {
    throw new Error("PROMOTED_ASSERTION_DESCRIPTOR_UNRESOLVED");
  }
  const matchesExpected = currentUrl.includes(descriptor.expectedUrl);
  return descriptor.polarity === "positive" ? matchesExpected : !matchesExpected;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.trim().toLowerCase() === "true";
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringFromEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function maskIfSensitive(value: string, sensitive?: boolean): string {
  if (!sensitive) return value;
  if (value.length <= 4) return "***";
  return `${"*".repeat(Math.min(8, value.length - 2))}${value.slice(-2)}`;
}

export function loadPromotedRuntimeConfigFromEnv(): PromotedRuntimeConfig {
  return {
    enabled: boolFromEnv("PROMOTED_RUNTIME_ENABLED", true),
    actionTimeoutMs: numberFromEnv("PROMOTED_RUNTIME_ACTION_TIMEOUT_MS", 15000),
    stabilityTimeoutMs: numberFromEnv("PROMOTED_RUNTIME_STABILITY_TIMEOUT_MS", 10000),
    retryEnabled: boolFromEnv("PROMOTED_RUNTIME_RETRY_ENABLED", true),
    captureDiagnostics: boolFromEnv("PROMOTED_RUNTIME_CAPTURE_DIAGNOSTICS", true),
    evidenceEnabled: boolFromEnv("EVIDENCE_ENABLED", true),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutRef: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutRef = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutRef) clearTimeout(timeoutRef);
  }
}

export type PromotedClickFailureClass =
  | "ACTION_NOT_DISPATCHED"
  | "ACTION_CALLBACK_TIMEOUT"
  | "ACTION_EFFECT_OBSERVED_CALLBACK_UNRESOLVED"
  | "ACTION_FAILED";

/**
 * scenarioStepIndex=4 (recording d8dbd8f9-b353-4175-b365-e5f8957bae36): withTimeout races
 * options.action() against a synthetic timer but never cancels the raced-away promise, so a real
 * Playwright action can still be running — and can still change the page — after this method has
 * already given up waiting on it (phase=start currentUrl=/product-subcategory... vs
 * phase=failed currentUrl=/ for that job, with no click actually confirmed). A blanket
 * "click_not_resolved" label misreported that as "nothing happened" when the URL demonstrably
 * changed. This distinguishes what is actually knowable from the collected diagnostics: whether
 * neither a native click nor a callback was ever attempted, whether OUR wrapper's own timeout
 * fired (vs. options.action() throwing a real error of its own), and whether the page moved at
 * all while we were waiting. Pure and exported for hermetic testing.
 */
export function classifyClickFailure(input: {
  nativeClickAttempted: boolean;
  callbackAttempted: boolean;
  callbackError?: string;
  nativeClickError?: string;
  urlChangedDuringAction: boolean;
}): PromotedClickFailureClass {
  if (!input.nativeClickAttempted && !input.callbackAttempted) return "ACTION_NOT_DISPATCHED";
  const isWrapperTimeout = /timed out after \d+ms$/.test(input.callbackError ?? "") || /timed out after \d+ms$/.test(input.nativeClickError ?? "");
  if (!isWrapperTimeout) return "ACTION_FAILED";
  return input.urlChangedDuringAction ? "ACTION_EFFECT_OBSERVED_CALLBACK_UNRESOLVED" : "ACTION_CALLBACK_TIMEOUT";
}

async function detectActiveContainer(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const selector = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.modal.show',
      'form:has(input, textarea, select)'
    ].join(",");
    const candidate = document.querySelector(selector) as HTMLElement | null;
    if (!candidate) return undefined;
    const id = candidate.id ? `#${candidate.id}` : "";
    const role = candidate.getAttribute("role") || candidate.tagName.toLowerCase();
    return `${role}${id}`;
  }).catch(() => undefined);
}

type ContainerCandidate = {
  selector: string;
  descriptor: string;
  visible: boolean;
  editableCount: number;
  matchingFieldFound: boolean;
  rank: number;
  fieldSignals?: string[];
};

function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

export async function findBestActiveContainerForField(page: Page, fieldName?: string): Promise<{
  best?: ContainerCandidate;
  candidates: ContainerCandidate[];
}> {
  const normalizedField = normalizeText(normalizeSemanticText(fieldName ?? ""));
  const rawCandidates = await page.evaluate((field) => {
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.modal.show',
      '.modal.in',
      '[data-drawer]',
      '[data-popup]',
      'form',
      '.drawer',
      '.popup',
      'table',
      '[role="grid"]'
    ];

    const isVisible = (el: Element): boolean => {
      const node = el as HTMLElement;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const buildSelector = (el: Element, idx: number): string => {
      const node = el as HTMLElement;
      if (node.id) return `#${node.id}`;
      const role = node.getAttribute("role");
      if (role) return `[role="${role}"]`;
      const marker = `container-${idx}`;
      node.setAttribute("data-promoted-runtime-container", marker);
      return `${node.tagName.toLowerCase()}[data-promoted-runtime-container="${marker}"]`;
    };

    const unique = new Set<Element>();
    for (const selector of selectors) {
      for (const el of Array.from(document.querySelectorAll(selector))) {
        unique.add(el);
      }
    }

    const list: Array<{
      selector: string;
      descriptor: string;
      visible: boolean;
      editableCount: number;
      matchingFieldFound: boolean;
      rank: number;
      fieldSignals: string[];
    }> = [];

    let idx = 0;
    for (const container of Array.from(unique)) {
      idx += 1;
      const editableCount = container.querySelectorAll("input:not([disabled]), textarea:not([disabled]), select:not([disabled])").length;
      const visible = isVisible(container);
      const fieldSignals = [
        container.textContent || "",
        ...Array.from(container.querySelectorAll("input, textarea, select")).flatMap((item) => {
          const node = item as HTMLInputElement;
          return [
            node.name || "",
            node.id || "",
            node.getAttribute("aria-label") || "",
            node.getAttribute("placeholder") || "",
            node.getAttribute("data-testid") || "",
          ];
        }),
      ];
      const role = container.getAttribute("role") || container.tagName.toLowerCase();
      const id = (container as HTMLElement).id ? `#${(container as HTMLElement).id}` : "";
      const descriptor = `${role}${id}`;
      const selector = buildSelector(container, idx);
      const rank = (visible ? 10 : 0) + editableCount;
      list.push({ selector, descriptor, visible, editableCount, matchingFieldFound: false, rank, fieldSignals });
    }

    list.sort((a, b) => b.rank - a.rank);
    return list;
  }, normalizedField);

  const candidates = rawCandidates.map(({ fieldSignals, ...candidate }) => ({
    ...candidate,
    matchingFieldFound: fieldName
      ? fieldSignals.some((signal) => normalizeText(normalizeSemanticText(signal)).includes(normalizedField))
      : false,
  })).map((candidate) => ({
    ...candidate,
    rank: candidate.rank + (candidate.matchingFieldFound ? 100 : 0),
  })).sort((a, b) => b.rank - a.rank);

  const valid = candidates.filter((c) => c.visible && c.editableCount > 0);
  const best = valid.find((c) => (fieldName ? c.matchingFieldFound : true)) ?? valid[0];
  return { best, candidates };
}

/**
 * Resolves a field locator using multiple strategies within a container or page scope.
 * Returns the locator, strategy used, and field properties.
 */
export async function resolvePromotedFieldLocator(
  page: Page,
  field: string,
  options?: {
    containerLocator?: string;
    timeoutMs?: number;
    targetIdentity?: PromotedFieldTargetIdentity;
    technicalTargetRefs?: string[];
  }
): Promise<{
  locator: any;
  strategy: string;
  scope: "container" | "page";
  visible: boolean;
  enabled: boolean;
  editable: boolean;
} | undefined> {
  const normalizedField = normalizeText(normalizeSemanticText(field));
  const timeoutMs = options?.timeoutMs ?? 5000;
  const container = options?.containerLocator
    ? page.locator(options.containerLocator)
    : undefined;

  const identity = options?.targetIdentity ?? (options?.technicalTargetRefs
    ? { technicalTargetRefs: options.technicalTargetRefs }
    : undefined);

  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const validateEditableCandidate = async (locator: any, scope: "container" | "page", strategy: string) => {
    const count = await locator.count().catch(() => 0);
    if (count !== 1) return undefined;
    const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
    if (!visible) return undefined;
    const disabled = await locator.isDisabled({ timeout: timeoutMs }).catch(() => true);
    if (disabled) return undefined;
    const tagName = await locator.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "");
    if (!["input", "textarea", "select"].includes(tagName)) return undefined;
    return { locator, strategy, scope, visible: true, enabled: true, editable: true };
  };

  const resolveStructuredCandidate = async (): Promise<{
    locator: any;
    strategy: string;
    scope: "container" | "page";
    visible: boolean;
    enabled: boolean;
    editable: boolean;
  } | undefined> => {
    if (!identity || identity.technicalTargetRefs.length === 0) return undefined;
    const parsed = parseTechnicalTargetRefs(identity.technicalTargetRefs);
    const fieldFromIdentity = semanticNameFromRef(parsed.cellRef) ?? semanticNameFromRef(parsed.headerRef) ?? field;
    const hintedPlaceholder = parsed.inputHint;
    const gridLocators: any[] = [];
    if (parsed.gridRef) {
      const grids = page.locator('table, [role="grid"]');
      const gridCount = await grids.count().catch(() => 0);
      if (gridCount === 1) {
        gridLocators.push(grids);
      } else if (gridCount > 1 && fieldFromIdentity) {
        const matchingGrids = grids.filter({ hasText: new RegExp(escapeRegExp(fieldFromIdentity), "i") });
        if (await matchingGrids.count().catch(() => 0) === 1) gridLocators.push(matchingGrids);
      }
    }

    const resolveStructuredTableCell = async (): Promise<{ cell: any; control?: any } | undefined> => {
      if (!parsed.gridRef || !fieldFromIdentity) return undefined;
      const marker = `promoted-runtime-cell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const marked = await page.evaluate(({ headerName, markerName }) => {
        const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
        const isVisible = (element: Element) => {
          const node = element as HTMLElement;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
        };
        const normalizedHeader = normalize(headerName);
        for (const table of Array.from(document.querySelectorAll("table, [role=grid]"))) {
          if (!isVisible(table)) continue;
          const rows = Array.from(table.querySelectorAll("tr, [role=row]"));
          const headerRow = rows.find((row) => Array.from(row.children).some((cell) => {
            const slot = cell.getAttribute("data-slot");
            return cell.tagName.toLowerCase() === "th" || slot === "table-head";
          }));
          if (!headerRow) continue;
          const headerIndex = Array.from(headerRow.children).findIndex((cell) => {
            const text = normalize(cell.textContent || "");
            return text === normalizedHeader || text.includes(normalizedHeader);
          });
          if (headerIndex < 0) continue;
          const cells = rows
            .filter((row) => row !== headerRow && isVisible(row) && row.children.length > headerIndex)
            .map((row) => row.children[headerIndex])
            .filter(isVisible);
          if (cells.length !== 1) continue;
          cells[0].setAttribute("data-promoted-runtime-cell", markerName);
          return true;
        }
        return false;
      }, { headerName: fieldFromIdentity, markerName: marker }).catch(() => false);
      if (!marked) return undefined;
      const cell = page.locator(`[data-promoted-runtime-cell="${marker}"]`);
      const control = cell.locator("button, [role=button]");
      if (await control.count().catch(() => 0) !== 1) return { cell };
      if (!(await control.isVisible({ timeout: timeoutMs }).catch(() => false))) return { cell };
      if (await control.isDisabled({ timeout: timeoutMs }).catch(() => true)) return { cell };
      return { cell, control };
    };

    // Header/cell identity is the authority for dynamic grids. Resolve and
    // scope the editor to that cell before considering any page-wide input;
    // otherwise the only currently mounted editor can receive another field's
    // value while the requested display cell remains untouched.
    const structuralCell = await resolveStructuredTableCell();
    if (structuralCell) {
      const cell = structuralCell.cell;
      if (hintedPlaceholder) {
        const byPlaceholder = cell.getByPlaceholder(hintedPlaceholder, { exact: true });
        const resolved = await validateEditableCandidate(byPlaceholder, "container", "structured:grid-cell:placeholder");
        if (resolved) return resolved;
      }
      const structuredFields = cell.locator("input, textarea, select");
      const resolved = await validateEditableCandidate(structuredFields, "container", "structured:grid-cell:editable");
      if (resolved) return resolved;
      if (structuralCell.control) {
        await structuralCell.control.click({ timeout: timeoutMs }).catch(() => undefined);
        if (hintedPlaceholder) {
          const activatedField = cell.getByPlaceholder(hintedPlaceholder, { exact: true });
          await activatedField.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
          const activated = await validateEditableCandidate(activatedField, "container", "structured:grid-cell:activated-placeholder");
          if (activated) return activated;
        }
        const activatedFields = cell.locator("input, textarea, select");
        const activated = await validateEditableCandidate(activatedFields, "container", "structured:grid-cell:activated-editor");
        if (activated) return activated;
      }
    }

    for (const grid of gridLocators) {
      let scope = grid;
      const cells = grid.locator('td, [role="gridcell"]');
      if (fieldFromIdentity) {
        const matchingCells = cells.filter({ hasText: new RegExp(escapeRegExp(fieldFromIdentity), "i") });
        if (await matchingCells.count().catch(() => 0) === 1) scope = matchingCells;
      }
      if (hintedPlaceholder) {
        const byPlaceholder = scope.getByPlaceholder(hintedPlaceholder, { exact: true });
        const resolved = await validateEditableCandidate(byPlaceholder, "container", "structured:grid-cell:placeholder");
        if (resolved) return resolved;
      }
      const structuredFields = scope.locator("input, textarea, select");
      const resolved = await validateEditableCandidate(structuredFields, "container", "structured:grid-cell:editable");
      if (resolved) return resolved;
    }

    const activation = await resolveStructuredTableCell();
    if (activation) {
      if (activation.control) {
        await activation.control.click({ timeout: timeoutMs });
        if (hintedPlaceholder) {
          const activatedField = activation.cell.getByPlaceholder(hintedPlaceholder, { exact: true });
          await activatedField.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
          const resolved = await validateEditableCandidate(activatedField, "page", "structured:grid-cell:activated-placeholder");
          if (resolved) return resolved;
        }
        const activatedFields = activation.cell.locator("input, textarea, select");
        const resolved = await validateEditableCandidate(activatedFields, "container", "structured:grid-cell:activated-editor");
        if (resolved) return resolved;
      }
    }

    if (hintedPlaceholder) {
      const byPlaceholder = page.getByPlaceholder(hintedPlaceholder, { exact: true });
      const resolved = await validateEditableCandidate(byPlaceholder, "page", "structured:placeholder");
      if (resolved) return resolved;
    }
    return undefined;
  };

  const structured = await resolveStructuredCandidate();
  if (structured) return structured;

  // Dynamic grids may be re-mounted immediately after a preceding selection.
  // Re-observe the structural surface once before allowing a legacy callback
  // to take authority over the current contract.
  const identityRefs = identity?.technicalTargetRefs ?? [];
  if (identityRefs.length > 0 && parseTechnicalTargetRefs(identityRefs).gridRef) {
    await page.locator('table, [role="grid"]').waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
    const reobservedStructured = await resolveStructuredCandidate();
    if (reobservedStructured) return reobservedStructured;
  }

  const resolveSemanticCandidate = async (scopeLocator: any, scope: "container" | "page") => {
    const fields = scopeLocator.locator("input, textarea, select");
    const count = await fields.count().catch(() => 0);
    const matches: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const candidate = fields.nth(index);
      const signals = await candidate.evaluate((element: Element) => {
        const node = element as HTMLInputElement;
        const signals = [
          node.getAttribute("aria-label") || "",
          node.getAttribute("placeholder") || "",
          node.getAttribute("name") || "",
          node.id || "",
        ];
        if (node.id) {
          const label = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
          if (label?.textContent) signals.push(label.textContent);
        }
        const ancestorLabel = node.closest("label");
        if (ancestorLabel?.textContent) signals.push(ancestorLabel.textContent);
        return signals;
      }).catch(() => [] as string[]);
      const matchesTarget = signals.some((signal: unknown) =>
        typeof signal === "string"
        && signal.trim() !== ""
        && normalizeText(normalizeSemanticText(signal)).includes(normalizedField)
      );
      if (matchesTarget) matches.push(index);
    }
    if (matches.length !== 1) return { matched: matches.length > 0, ambiguous: matches.length > 1 };

    const locator = fields.nth(matches[0]);
    const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
    if (!visible) return { matched: true, ambiguous: false };
    const disabled = await locator.isDisabled({ timeout: timeoutMs }).catch(() => true);
    if (disabled) return { matched: true, ambiguous: false };
    const tagName = await locator.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "");
    if (!["input", "textarea", "select"].includes(tagName)) return { matched: true, ambiguous: false };
    return {
      matched: true,
      ambiguous: false,
      result: { locator, strategy: `${scope}:semanticCandidate`, scope, visible: true, enabled: true, editable: true },
    };
  };

  if (container) {
    const containerCandidate = await resolveSemanticCandidate(container, "container");
    if (containerCandidate.ambiguous || containerCandidate.matched) return containerCandidate.result;
  }
  const pageCandidate = await resolveSemanticCandidate(page, "page");
  if (pageCandidate.ambiguous || pageCandidate.matched) return pageCandidate.result;

  const strategies: Array<{
    name: string;
    scope: "container" | "page";
    build: () => any;
  }> = [
    // Container-scoped strategies (preferred when activeContainer is set)
    {
      name: "activeContainer:getByLabel",
      scope: "container",
      build: () => container?.getByLabel(new RegExp(normalizedField, "i"))
    },
    {
      name: "activeContainer:getByPlaceholder",
      scope: "container",
      build: () => container?.getByPlaceholder(new RegExp(normalizedField, "i"))
    },
    {
      name: "activeContainer:getByRoleTextboxName",
      scope: "container",
      build: () => container?.getByRole("textbox", { name: new RegExp(normalizedField, "i") })
    },
    {
      name: "activeContainer:inputByName",
      scope: "container",
      build: () => container?.locator(`input[name="${normalizedField}"], textarea[name="${normalizedField}"]`)
    },
    {
      name: "activeContainer:inputById",
      scope: "container",
      build: () => container?.locator(`input[id*="${normalizedField}"], textarea[id*="${normalizedField}"]`)
    },
    {
      name: "activeContainer:inputByAriaLabel",
      scope: "container",
      build: () => container?.locator(`[aria-label*="${normalizedField}"]`)
    },
    {
      name: "activeContainer:nearLabel",
      scope: "container",
      build: () => {
        const label = container?.getByText(new RegExp(normalizedField, "i"), { exact: false });
        return label?.locator("xpath=following-sibling::input | following-sibling::textarea | following::input[1] | following::textarea[1]");
      }
    },
    // Page-scoped fallback strategies
    {
      name: "page:getByLabel",
      scope: "page",
      build: () => page.getByLabel(new RegExp(normalizedField, "i"))
    },
    {
      name: "page:getByPlaceholder",
      scope: "page",
      build: () => page.getByPlaceholder(new RegExp(normalizedField, "i"))
    },
    {
      name: "page:getByRoleTextboxName",
      scope: "page",
      build: () => page.getByRole("textbox", { name: new RegExp(normalizedField, "i") })
    },
    {
      name: "page:inputByName",
      scope: "page",
      build: () => page.locator(`input[name="${normalizedField}"], textarea[name="${normalizedField}"]`)
    },
    {
      name: "page:inputById",
      scope: "page",
      build: () => page.locator(`input[id*="${normalizedField}"], textarea[id*="${normalizedField}"]`)
    }
  ];

  for (const strat of strategies) {
    // Skip container strategies if no container
    if (strat.scope === "container" && !container) continue;

    try {
      const locator = strat.build();
      if (!locator) continue;

      // Check if locator is valid
      const count = await locator.count();
      if (count === 0) continue;

      const element = locator.first();
      const visible = await element.isVisible({ timeout: timeoutMs }).catch(() => false);
      if (!visible) continue;

      const enabled = await element.isDisabled({ timeout: timeoutMs }).catch(() => true);
      if (enabled) continue; // isDisabled returns true if disabled, we want enabled

      // Check if editable (input, textarea, select)
      const tagName = await element.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "");
      const isEditable = ["input", "textarea", "select"].includes(tagName);
      if (!isEditable) continue;

      return {
        locator: element,
        strategy: strat.name,
        scope: strat.scope,
        visible: true,
        enabled: true,
        editable: true
      };
    } catch {
      // Try next strategy
      continue;
    }
  }

  return undefined;
}

/**
 * Resolves a clickable target locator (button, link, submit, action) using multiple strategies.
 * Returns the locator, strategy used, and element properties.
 */
export async function resolvePromotedClickableLocator(
  page: Page,
  target: string,
  options?: {
    containerLocator?: string;
    timeoutMs?: number;
    actionKind?: "submit" | "link" | "button" | "action";
    actionIntent?: string;
    targetIdentity?: PromotedFieldTargetIdentity;
  }
): Promise<{
  locator: any;
  strategy: string;
  scope: "container" | "page";
  visible: boolean;
  enabled: boolean;
  clickable: boolean;
} | undefined> {
  // Alias resolution for return_to_list intent
  // Maps various "back to list" phrases to the common "Volver" button
  let effectiveTarget = target;
  if (options?.actionIntent === "return_to_list") {
    const returnToListAliases = [
      /volver al listado/i,
      /volver al listado de productos/i,
      /volver al listado principal/i,
      /regresar al listado/i,
      /volver al list/i,
      /regresar al list/i,
      /back to list/i,
      /back to listing/i
    ];
    
    const normalizedTarget = normalizeText(target);
    if (returnToListAliases.some(alias => alias.test(target) || alias.test(normalizedTarget))) {
      // Try to find "Volver" button first
      const volverButton = page.getByRole('button', { name: 'Volver', exact: true });
      if (await volverButton.count() > 0) {
        const isVisible = await volverButton.isVisible().catch(() => false);
        if (isVisible) {
          console.log(`[runtime:return_to_list] Mapped "${target}" -> "Volver" button (alias resolution)`);
          return {
            locator: volverButton,
            strategy: "return_to_list_alias:Volver",
            scope: "page",
            visible: true,
            enabled: true,
            clickable: true
          };
        }
      }
      
      // Fallback: "Atrás" button
      const atrasButton = page.getByRole('button', { name: /atrás|atras/i });
      if (await atrasButton.count() > 0) {
        const isVisible = await atrasButton.first().isVisible().catch(() => false);
        if (isVisible) {
          console.log(`[runtime:return_to_list] Mapped "${target}" -> "Atrás" button (alias resolution)`);
          return {
            locator: atrasButton.first(),
            strategy: "return_to_list_alias:Atrás",
            scope: "page",
            visible: true,
            enabled: true,
            clickable: true
          };
        }
      }
      
      // Use normalized target for further resolution
      effectiveTarget = "Volver";
      console.log(`[runtime:return_to_list] Using fallback target "${effectiveTarget}" for "${target}"`);
    }
  }
  
  const normalizedTarget = normalizeText(effectiveTarget);
  const locatorTarget = normalizeSemanticText(effectiveTarget).trim() || effectiveTarget.trim();
  const escapedLocatorTarget = locatorTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const timeoutMs = options?.timeoutMs ?? 5000;
  const actionKind = options?.actionKind;
  const actionIntent = options?.actionIntent;
  const container = options?.containerLocator
    ? page.locator(options.containerLocator)
    : undefined;

  const resolveStructuredTableControl = async () => {
    const identity = options?.targetIdentity;
    const parsedIdentity = identity ? parseTechnicalTargetRefs(identity.technicalTargetRefs) : {};
    const hasButtonReference = Boolean(identity?.technicalTargetRefs.some((ref) => ref.startsWith("role:button|")));
    const hasSelectionReference = parsedIdentity.semanticRole === "selection";
    if (!identity || (!hasButtonReference && !hasSelectionReference)) return undefined;
    const marker = `promoted-runtime-target-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const marked = await page.evaluate(({ headerName, markerName }) => {
      const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
      const isVisible = (element: Element) => {
        const node = element as HTMLElement;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const normalizedHeader = normalize(headerName);
      for (const table of Array.from(document.querySelectorAll("table, [role=grid]"))) {
        if (!isVisible(table)) continue;
        const rows = Array.from(table.querySelectorAll("tr, [role=row]"));
        const headerRows = rows.filter((row) => Array.from(row.children).some((cell) => {
          const slot = cell.getAttribute("data-slot");
          return cell.tagName.toLowerCase() === "th" || slot === "table-head";
        }));
        for (const headerRow of headerRows) {
          const headerCells = Array.from(headerRow.children);
          const headerIndex = headerCells.findIndex((cell) => {
            const text = normalize(cell.textContent || "");
            return text === normalizedHeader || text.includes(normalizedHeader);
          });
          if (headerIndex < 0) continue;
          const bodyRows = rows.filter((row) => row !== headerRow && isVisible(row) && row.children.length > headerIndex);
          const controls = bodyRows.flatMap((row) => {
            const cell = row.children[headerIndex];
            return Array.from(cell.querySelectorAll("button, input, textarea, select")).filter(isVisible);
          });
          if (controls.length !== 1) continue;
          controls[0].setAttribute("data-promoted-runtime-target", markerName);
          return true;
        }
      }
      return false;
    }, { headerName: effectiveTarget, markerName: marker }).catch(() => false);
    if (!marked) return undefined;
    const locator = page.locator(`[data-promoted-runtime-target="${marker}"]`);
    const count = await locator.count().catch(() => 0);
    if (count !== 1) return undefined;
    const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
    const disabled = await locator.isDisabled({ timeout: timeoutMs }).catch(() => true);
    if (!visible || disabled) return undefined;
    return { locator, strategy: "structured:table-header-column", scope: "page" as const, visible: true, enabled: true, clickable: true };
  };

  const structuredTableControl = await resolveStructuredTableControl();
  if (structuredTableControl) return structuredTableControl;

  const strategies: Array<{
    name: string;
    scope: "container" | "page";
    build: () => any;
  }> = [
    // Container-scoped strategies (preferred when activeContainer is set)
    {
      name: "activeContainer:getByRoleButtonName",
      scope: "container",
      build: () => container?.getByRole("button", { name: new RegExp(escapedLocatorTarget, "i"), exact: false })
    },
    {
      name: "activeContainer:getByRoleLinkName",
      scope: "container",
      build: () => container?.getByRole("link", { name: new RegExp(escapedLocatorTarget, "i"), exact: false })
    },
    {
      name: "activeContainer:getByTextExact",
      scope: "container",
      build: () => container?.getByText(locatorTarget, { exact: true })
    },
    {
      name: "activeContainer:buttonByText",
      scope: "container",
      build: () => container?.locator(`button:has-text("${normalizedTarget}"), input[type="button"]:has-text("${normalizedTarget}")`)
    },
    {
      name: "activeContainer:inputSubmitByValue",
      scope: "container",
      build: () => container?.locator(`input[type="submit"][value*="${normalizedTarget}"]`)
    },
    {
      name: "activeContainer:ariaLabel",
      scope: "container",
      build: () => container?.locator(`[aria-label*="${normalizedTarget}"]`)
    },
    {
      name: "activeContainer:testId",
      scope: "container",
      build: () => container?.locator(`[data-testid="${normalizedTarget}"]`)
    },
    // Page-scoped fallback strategies
    {
      name: "page:getByRoleButtonName",
      scope: "page",
      build: () => page.getByRole("button", { name: new RegExp(escapedLocatorTarget, "i"), exact: false })
    },
    {
      name: "page:getByRoleLinkName",
      scope: "page",
      build: () => page.getByRole("link", { name: new RegExp(escapedLocatorTarget, "i"), exact: false })
    },
    {
      name: "page:getByTextExact",
      scope: "page",
      build: () => page.getByText(locatorTarget, { exact: true })
    },
    {
      name: "page:buttonByText",
      scope: "page",
      build: () => page.locator(`button:has-text("${normalizedTarget}"), input[type="button"]:has-text("${normalizedTarget}")`)
    },
    {
      name: "page:inputSubmitByValue",
      scope: "page",
      build: () => page.locator(`input[type="submit"][value*="${normalizedTarget}"]`)
    },
    {
      name: "page:ariaLabel",
      scope: "page",
      build: () => page.locator(`[aria-label*="${normalizedTarget}"]`)
    },
    {
      name: "page:testId",
      scope: "page",
      build: () => page.locator(`[data-testid="${normalizedTarget}"]`)
    }
  ];

  for (const strat of strategies) {
    // Skip container strategies if no container
    if (strat.scope === "container" && !container) continue;

    try {
      const locator = strat.build();
      if (!locator) continue;

      // Check if locator is valid
      const count = await locator.count();
      if (count === 0) continue;

      const element = locator.first();
      const visible = await element.isVisible({ timeout: timeoutMs }).catch(() => false);
      if (!visible) continue;

      const disabled = await element.isDisabled({ timeout: timeoutMs }).catch(() => true);
      if (disabled) continue; // isDisabled returns true if disabled, skip disabled elements

      // Check if clickable (button, link, input[type=submit/button], or has click handler)
      const tagName = await element.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "");
      const type = await element.evaluate((el: Element) => (el as HTMLInputElement).type || "").catch(() => "");
      const isClickable = 
        ["button", "a", "input"].includes(tagName) ||
        (tagName === "input" && ["submit", "button", "reset"].includes(type)) ||
        await element.evaluate((el: Element) => el.getAttribute("onclick") !== null || el.getAttribute("role") === "button").catch(() => false);
      
      if (!isClickable) continue;

      return {
        locator: element,
        strategy: strat.name,
        scope: strat.scope,
        visible: true,
        enabled: true,
        clickable: true
      };
    } catch {
      // Try next strategy
      continue;
    }
  }

  // Semantic fallback for category/product/item selection
  // Only apply semantic matching for navigation/selection intents, not for sensitive actions
  const semanticIntents = ["select_category", "select_product", "select_item_by_text", "select_visible_item_by_ordinal", "return_to_list", "select"];
  const intentForSemantic = actionIntent || (semanticIntents.includes(actionKind || "") ? actionKind : undefined);
  
  if (intentForSemantic && semanticIntents.includes(intentForSemantic)) {
    const semanticOptions: SemanticMatchOptions = {
      timeoutMs: Math.min(timeoutMs, 3000),
      actionIntent: intentForSemantic,
      minScore: 0.65,
      allowAmbiguity: false,
      excludeSensitive: true
    };
    
    // Prefer categories/filters over product cards for category selection
    if (intentForSemantic === "select_category") {
      semanticOptions.preferTypes = ["button", "link", "heading"];
      semanticOptions.excludeTypes = ["card"];
    } else if (intentForSemantic === "select_product") {
      semanticOptions.preferTypes = ["card", "list_item", "button", "link"];
    } else if (intentForSemantic === "return_to_list") {
      semanticOptions.preferTypes = ["button", "link"];
    }
    
    const semanticResult = await findSemanticTargetMatch(page, target, semanticOptions);
    
    if (semanticResult.status === "exact" || semanticResult.status === "semantic") {
      const candidate = semanticResult.candidate!;
      const tagName = await candidate.locator.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "");
      const type = await candidate.locator.evaluate((el: Element) => (el as HTMLInputElement).type || "").catch(() => "");
      const isClickable = 
        ["button", "a", "input"].includes(tagName) ||
        (tagName === "input" && ["submit", "button", "reset"].includes(type)) ||
        await candidate.locator.evaluate((el: Element) => el.getAttribute("onclick") !== null || el.getAttribute("role") === "button").catch(() => false);
      
      if (isClickable) {
        return {
          locator: candidate.locator,
          strategy: `semantic:${candidate.type}:${semanticResult.reason}`,
          scope: "page",
          visible: candidate.visible,
          enabled: candidate.enabled,
          clickable: true
        };
      }
    }
    
    // Ambiguity error with diagnostics
    if (semanticResult.status === "ambiguous") {
      throw new Error(
        `semantic_target_ambiguous: target="${target}" ` +
        `bestCandidates=[${semanticResult.candidates?.slice(0, 2).map(c => 
          `{ text:"${c.text}", score:${c.score.toFixed(2)}, type:"${c.type}" }`
        ).join(", ")}] ` +
        `reason="${semanticResult.reason}"`
      );
    }
    
    // Not found error with diagnostics
    if (semanticResult.status === "not_found") {
      throw new Error(
        `semantic_target_not_found: target="${target}" actionIntent="${intentForSemantic}" ` +
        `bestCandidates=[${semanticResult.diagnostics.candidateScores.slice(0, 3).map(c => 
          `{ text:"${c.text}", score:${c.score.toFixed(2)}, type:"${c.type}" }`
        ).join(", ")}] ` +
        `reason="${semanticResult.reason}"`
      );
    }
  }

  return undefined;
}

async function captureDiagnosticsIfNeeded(
  page: Page,
  diagnostics: PromotedRuntimeDiagnostics,
  evidenceDir?: string,
  enabled?: boolean
): Promise<PromotedRuntimeDiagnostics> {
  if (!enabled) return diagnostics;
  const outputDir = evidenceDir ?? path.join(process.cwd(), ".artifacts", "promoted-runtime");
  fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `step-${String(diagnostics.stepIndex).padStart(3, "0")}.png`;
  const screenshotPath = path.join(outputDir, fileName);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  return { ...diagnostics, screenshotPath };
}

async function shouldUseSafeForceClick(
  page: Page,
  locator: any,
  options: { actionIntent: string; target: string },
  error: unknown
): Promise<boolean> {
  if (options.actionIntent !== "open_module") return false;
  if (!/consulta de balance/i.test(options.target)) return false;

  const message = error instanceof Error ? error.message : String(error);
  const isInterceptError =
    /intercepts pointer events/i.test(message) ||
    /another element would receive the click/i.test(message) ||
    /element is not receiving pointer events/i.test(message);

  if (!isInterceptError) return false;

  const overlayVisible = await page
    .locator('text=/cargando productos|por favor espere/i')
    .first()
    .isVisible()
    .catch(() => false);

  if (!overlayVisible) return false;

  const targetVisible = await locator.isVisible().catch(() => false);
  const targetEnabled = await locator.isEnabled().catch(() => false);
  return targetVisible && targetEnabled;
}

export function doesVisibleFieldSignalMatch(signals: unknown[], target: string): boolean {
  if (typeof target !== "string" || target.trim() === "") return false;
  const normalizedTarget = normalizeSemanticText(target).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return signals.some((signal) =>
    typeof signal === "string"
    && signal.trim() !== ""
    && normalizeSemanticText(signal).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(normalizedTarget)
  );
}

export function contextualFieldSignalTarget(target: string): string {
  return semanticNameFromRef(target) ?? target;
}

export type VisibleFieldSignalsCapture = {
  signals: string[];
  captureError?: string;
};

/** A login-labelled button requires independent auth-surface evidence. */
export function isLoginScreenContext(
  visibleButtons: string[],
  isOnAuthGate: boolean,
): boolean {
  return isOnAuthGate
    && visibleButtons.some((button) => /iniciar|login|sign in|ingresar/i.test(button))
    && !visibleButtons.some((button) => /continuar|next|submit|confirmar/i.test(button));
}

export async function captureVisibleFieldSignals(page: Page): Promise<VisibleFieldSignalsCapture> {
  try {
    const signals = await page.locator("input:visible, textarea:visible, select:visible").evaluateAll((elements) => {
    const signals: string[] = [];
    for (const element of elements) {
      const attributes = ["aria-label", "name", "placeholder", "id"];
      for (const attribute of attributes) {
        const value = element.getAttribute(attribute);
        if (value) signals.push(value);
      }
      if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label?.textContent) signals.push(label.textContent);
      }
      const parentLabel = element.closest("label");
      if (parentLabel?.textContent) signals.push(parentLabel.textContent);
    }
    return signals;
    });
    return { signals };
  } catch (error) {
    return {
      signals: [],
      captureError: error instanceof Error ? error.name : typeof error,
    };
  }
}

/**
 * Validate screen context before executing context-dependent actions
 * Prevents executing deep functional actions from wrong screen (Home/Login/Menu)
 */
export async function validateScreenContextForAction(
  page: Page,
  options: { 
    target: string; 
    actionIntent: string; 
    stepIndex: number;
    expectedOwnerPage?: string;
    lastSelectionStep?: { selectedTarget: string; stepIndex: number };
    /**
     * Structured auth-gate credential authority for this step (transported from the compiled
     * contract). REQUIRED for a `fill_form_field` to be allowed on an auth/login screen: a step
     * without it (a business form fill) stays fail-closed there.
     */
    authGateExpected?: boolean;
  }
): Promise<void> {
  const CONTEXT_DEPENDENT_ACTIONS = new Set([
    "select_product", "select_category", "click_primary_action",
    "submit_form", "confirm_action", "fill_form_field",
    "select_first_visible_item", "select_first_visible_product",
    "select_first_visible_card", "select_first_visible_row",
    "select_visible_item_by_ordinal", "open_module", "return_to_list"
  ]);
  
  if (!CONTEXT_DEPENDENT_ACTIONS.has(options.actionIntent)) {
    return;
  }

  if (typeof options.target !== "string" || options.target.trim() === "") {
    throw new Error(`invalid_context_action_target: target is required for '${options.actionIntent}' at step ${options.stepIndex}`);
  }
  
  // Capture current page state
  const pageDiag = await capturePageDiagnostics(page);
  const currentUrl = pageDiag.currentUrl;
  const visibleButtons = pageDiag.visibleButtons.filter((value): value is string => typeof value === "string" && value.trim() !== "");
  const visibleHeadings = pageDiag.visibleHeadings.filter((value): value is string => typeof value === "string" && value.trim() !== "");
  const normalizedTarget = options.target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const visibleFieldCapture = options.actionIntent === "fill_form_field"
    ? await captureVisibleFieldSignals(page)
    : { signals: [] };
  const visibleFieldSignals = visibleFieldCapture.signals;
  
  // Check for clear signals of being on wrong screen
  const isOnHomeScreen = currentUrl === "/" || currentUrl === "" || 
    visibleHeadings.some(h => /home|inicio|welcome|bienvenid/i.test(h));
  const isOnMenuScreen = visibleHeadings.some(h => /menu|operaciones|module/i.test(h)) &&
    visibleButtons.length > 0 && 
    !visibleButtons.some(b => /producto|item|card|select/i.test(b));
  
  // Check for AuthGate/Identification screen
  const isOnAuthGate = /client-identification|identification|auth|login/i.test(currentUrl) ||
    visibleHeadings.some(h => /identificaci|identification|auth|login/i.test(h));
  const isOnLoginScreen = isLoginScreenContext(visibleButtons, isOnAuthGate);
  
  const isOnWrongScreen = isOnHomeScreen || isOnLoginScreen || isOnMenuScreen || isOnAuthGate;

  if (options.actionIntent === "return_to_list") {
    const hasBackControl =
      visibleButtons.some(b => /volver|atras|atrás|back/i.test(b)) ||
      visibleHeadings.some(h => /detalle|detail/i.test(h));
    if (!hasBackControl && options.lastSelectionStep) {
      throw new Error(
        `detail_reentry_required: Expected detail page before return_to_list. ` +
        `Target "${options.target}" not available on current screen. ` +
        `currentUrl="${currentUrl}" visibleButtons=[${visibleButtons.join(", ")}] ` +
        `visibleHeadings=[${visibleHeadings.join(", ")}] stepIndex=${options.stepIndex} ` +
        `lastSelectionStep=step=${options.lastSelectionStep.stepIndex} target="${options.lastSelectionStep.selectedTarget}" `
      );
    }
  }
  
  if (isOnWrongScreen) {
    // Check if target exists on current page
    const genericTargetExists = visibleButtons.some(b =>
      b.toLowerCase().includes(normalizedTarget)
    ) || visibleHeadings.some(h =>
      h.toLowerCase().includes(normalizedTarget)
    );
    const targetExists = genericTargetExists || (
      options.actionIntent === "fill_form_field" && doesVisibleFieldSignalMatch(
        visibleFieldSignals,
        contextualFieldSignalTarget(options.target),
      )
    );
    
    // A matching field cannot authorize a contextual BUSINESS fill on a real auth surface:
    // credential controls are legitimately visible there. But an AUTH credential fill IS
    // compatible with the auth surface it was recorded on -- authorized ONLY by the step's own
    // structured auth-gate authority (`authGateExpected`, transported from the contract), never by
    // the field text or by "some field happens to be visible on a login screen".
    const authGateBlocksContextualFill =
      isOnAuthGate
      && options.actionIntent === "fill_form_field"
      && !(options.authGateExpected === true && targetExists);
    if (!targetExists || authGateBlocksContextualFill) {
      if (options.actionIntent === "fill_form_field") {
        const semanticTarget = contextualFieldSignalTarget(options.target);
        const signalMetadata = visibleFieldSignals
          .slice(0, 5)
          .map((signal) => normalizeSemanticText(signal).slice(0, 80));
        console.log(
          `[screen-context-field-signals] target=${semanticTarget} count=${visibleFieldSignals.length} ` +
          `signals=${JSON.stringify(signalMetadata)} captureError=${visibleFieldCapture.captureError ?? "none"}`,
        );
      }
      // Special handling for open_module when on AuthGate
      if (options.actionIntent === "open_module" && isOnAuthGate) {
        throw new Error(
          `auth_required_before_open_module: Cannot execute '${options.actionIntent}' on target "${options.target}" ` +
          `because authentication is required but not completed. ` +
          `currentUrl="${currentUrl}" visibleButtons=[${visibleButtons.join(", ")}] ` +
          `visibleHeadings=[${visibleHeadings.join(", ")}] stepIndex=${options.stepIndex} ` +
          `actionIntent="${options.actionIntent}" ` +
          `screenSignals={isOnAuthGate:${isOnAuthGate}} ` +
          `suggestedFix="Call AuthFlow.ensureAuthenticated() before openModule() in the spec"`
        );
      }
      
      throw new Error(
        `wrong_screen_before_contextual_action: Cannot execute '${options.actionIntent}' on target "${options.target}" ` +
        `because current screen does not match required context. ` +
        `currentUrl="${currentUrl}" visibleButtons=[${visibleButtons.join(", ")}] ` +
        `visibleHeadings=[${visibleHeadings.join(", ")}] stepIndex=${options.stepIndex} ` +
        `actionIntent="${options.actionIntent}" ` +
        `screenSignals={isOnHomeScreen:${isOnHomeScreen}, isOnLoginScreen:${isOnLoginScreen}, isOnMenuScreen:${isOnMenuScreen}, isOnAuthGate:${isOnAuthGate}} ` +
        `suggestedFix="Ensure navigation/module/auth steps precede this action in the spec"`
      );
    }
  }
  
  // Special handling for click_primary_action when on list page but target not visible
  // This handles cases where we need to re-enter detail page before executing primary action
  if (options.actionIntent === "click_primary_action" && options.lastSelectionStep) {
    // Check if we're on a list page (has product cards/items but not detail-specific elements)
    const isOnListPage = visibleButtons.some(b => /producto|item|card|select|dep|cuenta|tarjeta|balance/i.test(b)) &&
      !visibleHeadings.some(h => /detalle|detail|informaci|information del producto/i.test(h));
    
    if (isOnListPage) {
      // Check if the primary action target exists on current page
      const primaryActionExists = visibleButtons.some(b => 
        b.toLowerCase().includes(normalizedTarget)
      );
      
      if (!primaryActionExists) {
        // Throw specific error that can be caught for re-entry attempt
        throw new Error(
          `detail_reentry_required: Expected to be on DetailPage but currently on list page. ` +
          `Target "${options.target}" not visible. ` +
          `currentUrl="${currentUrl}" visibleButtons=[${visibleButtons.join(", ")}] ` +
          `visibleHeadings=[${visibleHeadings.join(", ")}] stepIndex=${options.stepIndex} ` +
          `actionIntent="${options.actionIntent}" expectedOwnerPage="${options.expectedOwnerPage || 'unknown'}" ` +
          `lastSelectionStep=${options.lastSelectionStep ? `step=${options.lastSelectionStep.stepIndex} target="${options.lastSelectionStep.selectedTarget}"` : "none"} ` +
          `suggestedFix="Re-execute the product/item selection step before click_primary_action"`
        );
      }
    }
  }
}

/**
 * Detect if page has returned to home due to inactivity/session timeout
 */
export type HomeResetOrInactivityResult = {
  detected: boolean;
  reason?: "inactivity_message" | "home_url_with_iniciar" | "session_reset" | "session_expiring_warning" | "session_diagnostics_timeout";
  visibleTexts?: string[];
  visibleButtons?: string[];
  currentUrl?: string;
};

const DEFAULT_SESSION_DIAGNOSTICS_TIMEOUT_MS = 10000;

/**
 * FIRST_LOSS fix (recordingId=1f9415f3-...): `capturePageDiagnostics` (a sequence of independent
 * Playwright reads: title, heading/button/text scans, list readiness) had no bounded deadline of
 * its own. Physical evidence showed the promoted runtime hang here for the FULL 90s Playwright
 * test timeout, with no log at all between `[promoted-step] stepIndex=N phase=start` and the
 * global timeout -- never reaching `runtime:session_reset`, `safeReplayContext`, or the click
 * itself. Bounded here by `timeoutMs` (the caller's own already-configured action timeout, never
 * a second independent budget) so this boundary always resolves before the global test timeout
 * and always logs, win or lose. A timed-out diagnostic is reported as its OWN explicit
 * `session_diagnostics_timeout` classification -- fail-closed, `detected: true` -- never silently
 * collapsed into "nothing detected", since incomplete data can never prove the page is clean.
 */
export async function detectHomeResetOrInactivity(
  page: Page,
  timeoutMs: number = DEFAULT_SESSION_DIAGNOSTICS_TIMEOUT_MS,
): Promise<HomeResetOrInactivityResult> {
  console.log(`[TRACE-5] entered=detectHomeResetOrInactivity`);
  const startedAt = Date.now();
  const currentUrlAtEntry = (() => { try { return page.url(); } catch { return "(unknown)"; } })();
  console.log(`[runtime:diagnostic] phase=start currentUrl=${currentUrlAtEntry} timeoutMs=${timeoutMs}`);

  const pageDiag = await capturePageDiagnostics(page, { timeoutMs });
  const durationMs = Date.now() - startedAt;

  if (pageDiag.diagnosticStatus === "timeout") {
    console.log(
      `[runtime:diagnostic] phase=end status=timeout currentUrl=${pageDiag.currentUrl} durationMs=${durationMs} detected=true reason=session_diagnostics_timeout`,
    );
    return { detected: true, reason: "session_diagnostics_timeout", currentUrl: pageDiag.currentUrl };
  }

  const currentUrl = pageDiag.currentUrl;
  const visibleTexts = pageDiag.visibleTexts;
  const visibleButtons = pageDiag.visibleButtons;
  const visibleHeadings = pageDiag.visibleHeadings;

  // Check for inactivity messages
  const inactivityPatterns = [
    /volviendo al inicio/i,
    /volvió a la pantalla de inicio/i,
    /inactividad/i,
    /sess(?:ion)? (?:time.?out|expired)/i,
    /sess(?:ion)? reset/i,
    /por inactividad/i
  ];

  // FIRST_LOSS fix (recordingId=1f9415f3-...): a session-timeout WARNING (the app's own
  // countdown dialog offering to keep the session alive, shown BEFORE the session actually
  // resets) is a distinct, earlier stage of the same generic multiproject session-lifecycle
  // concept the patterns above already cover for the AFTER-reset stage -- never Fenix/Santa
  // Cruz-specific text, just the common "session about to expire" phrasing pattern any
  // session-managed app can show. Without this, a click landing behind/blocked by this warning
  // produced a genuinely correct `no_observable_post_action_outcome` (nothing DID observably
  // change), but the runtime never recognized WHY, misreporting a session precondition as an
  // undifferentiated click failure instead of the already-existing, more actionable
  // `session_reset_unrecoverable` classification below.
  const sessionExpiringWarningPatterns = [
    /a punto de expirar/i,
    /sesión.{0,40}(?:límite máximo|tiempo máximo)/i,
    /session.{0,40}(?:about to expire|expiring|time limit)/i,
    /sess(?:ion)? (?:will|is about to) expire/i,
  ];

  const hasInactivityMessage = visibleTexts.some(t =>
    inactivityPatterns.some(p => p.test(t))
  ) || visibleHeadings.some(h =>
    inactivityPatterns.some(p => p.test(h))
  );

  const hasSessionExpiringWarning = visibleTexts.some(t =>
    sessionExpiringWarningPatterns.some(p => p.test(t))
  ) || visibleHeadings.some(h =>
    sessionExpiringWarningPatterns.some(p => p.test(h))
  );

  // Check for home URL with only "Iniciar" button (fresh session state)
  const isRootLikeUrl = currentUrl === "/" || currentUrl === "" || /https?:\/\/[^/]+\/?$/.test(currentUrl);
  const isOnHomeWithIniciar = isRootLikeUrl &&
    visibleButtons.some(b => /iniciar|login|ingresar/i.test(b)) &&
    visibleButtons.length <= 3; // Home should have few buttons

  const logAndReturn = (result: HomeResetOrInactivityResult): HomeResetOrInactivityResult => {
    const status = result.detected ? "detected" : "not_detected";
    console.log(
      `[runtime:diagnostic] phase=end status=${status} currentUrl=${currentUrl} durationMs=${Date.now() - startedAt} ` +
      `detected=${result.detected} reason=${result.reason ?? "none"}`,
    );
    return result;
  };

  if (hasInactivityMessage) {
    return logAndReturn({ detected: true, reason: "inactivity_message", visibleTexts, visibleButtons, currentUrl });
  }

  if (hasSessionExpiringWarning) {
    return logAndReturn({ detected: true, reason: "session_expiring_warning", visibleTexts, visibleButtons, currentUrl });
  }

  if (isOnHomeWithIniciar) {
    return logAndReturn({ detected: true, reason: "home_url_with_iniciar", visibleTexts, visibleButtons, currentUrl });
  }

  return logAndReturn({ detected: false });
}

/**
 * Check if an action intent is safe to replay
 * return_to_list is NOT safe to replay - it consumes context (detail page), doesn't produce it
 */
function isSafeActionToReplay(actionIntent: string): boolean {
  const SAFE_ACTIONS = new Set([
    "start_session", "open_home", "open_module", "open_product_information",
    "select_category", "select_product", "select_visible_item_by_ordinal",
    "select_first_visible_item", "select_first_visible_product", "select_first_visible_card",
    "navigate",
    // Deterministic spec compiler's own transported replay entries (see
    // `PreviousStepReplay`/`buildPreviousStepReplaysLiteral` in deterministic-spec-compiler.ts):
    // a prior recorded click/fill/press step, replayed via its OWN already-compiled callback --
    // never a business-mutating action (payment/submit/delete/etc), never fabricated. A
    // credential fill is still excluded here, individually, via `sensitive: true` on that one
    // entry -- this label only governs the non-sensitive identification/navigation steps.
    "restore_recorded_context"
    // NOTE: return_to_list is NOT safe - it requires being on detail page (consumes context)
  ]);
  
  const UNSAFE_ACTIONS = new Set([
    "submit_form", "confirm_action", "payment", "transfer", "send",
    "accept_terms", "delete", "fill_form_field", "click_primary_action",
    "return_to_list"  // Explicitly unsafe - requires detail page context
  ]);
  
  if (UNSAFE_ACTIONS.has(actionIntent)) return false;
  if (SAFE_ACTIONS.has(actionIntent)) return true;
  
  // Default: be conservative, don't replay unknown actions
  return false;
}

export type PromotedClickOptions = PromotedActionOptions & {
  previousSteps?: SafeReplayStep[];
  previousStepReplays?: SafeReplayStep[];
  lastSelectionStep?: { stepIndex: number; selectedTarget: string };
  lastSelectionReplay?: () => Promise<void>;
  expectedOwnerPage?: string;
  /** Selection callbacks may contain the control-opening action and own the exact target resolution. */
  skipNativeTargetResolution?: boolean;
  valueKey?: string;
  technicalTargetRefs?: string[];
  /**
   * A certified structural identity (owner/stableDirectAttributes/stableDescendants/
   * semanticShape/landmarkAncestor) rich enough for the shared resolveRecordedStructuralOwner
   * resolver to use -- the SAME shape Discovery's own recording replay already resolves.
   * Set ONLY by the deterministic compiler for certified_structural authority with a usable
   * owner. When present, this is the SOLE authority for this click: exigent, fail-closed, never
   * falls back to a weaker locator/text/positional match.
   */
  structuralTarget?: RecordedTechnicalTarget;
  /**
   * Field-relation hint (e.g. "asociado a X") transported from the scenario/plan for
   * `runtime_resolution_required` clicks only -- never a certification. Lets this click retry
   * via the SAME shared field-scoped resolver (resolveActionTarget's
   * tryFieldScopedStructuralFallback) Discovery's own live walk already used for this step.
   */
  associatedField?: string;
  /**
   * LAST-RESORT, EXECUTION-ONLY authority (see `SemanticRuntimeEvidence`'s own doc). Set only for
   * `runtime_resolution_required` clicks whose owner/structural/related-control evidence all
   * failed at capture but a `SemanticRuntimeEvidence` was captured for the raw target. Never a
   * certification, never upgrades `technicalReady`/`promotionReady`.
   */
  semanticRuntimeEvidence?: SemanticRuntimeEvidence;
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
};

type OrdinalSelectionRuntimeCandidate = {
  locator: any;
  text: string;
  selector: string;
  type: string;
  role?: string;
  tagName?: string;
  visible: boolean;
  enabled: boolean;
  domainRelated: boolean;
  productLike: boolean;
};

const ORDINAL_PATTERNS = [
  { pattern: /(?:la|el|los|las)\s+primer[oa]?\b/i, ordinal: "first" as const },
  { pattern: /(?:la|el|los|las)\s+primera?\b/i, ordinal: "first" as const },
  { pattern: /(?:la|el|los|las)\s+segunda?\b/i, ordinal: "second" as const },
  { pattern: /(?:la|el|los|las)\s+tercera?\b/i, ordinal: "third" as const },
  { pattern: /(?:la|el|los|las)\s+(?:última|ultima)\b/i, ordinal: "last" as const },
  { pattern: /\bfirst\b/i, ordinal: "first" as const },
  { pattern: /\bsecond\b/i, ordinal: "second" as const },
  { pattern: /\bthird\b/i, ordinal: "third" as const },
  { pattern: /\blast\b/i, ordinal: "last" as const },
];

const ORDINAL_GENERIC_TERMS = [
  "producto", "productos", "item", "items", "elemento", "elementos", "fila", "filas",
  "card", "cards", "cuenta", "cuentas", "tarjeta", "tarjetas", "beneficiario", "beneficiarios",
  "registro", "registros", "solicitud", "solicitudes", "resultado", "resultados", "row", "rows",
  "list item", "listitem"
];

const ORDINAL_INSTRUCTIONAL_PATTERNS = [
  /selecciona/i,
  /elige\s+(el|la|un|una|el\s+tipo)/i,
  /elige/i,
  /escoge/i,
  /escoge/i,
  /select/i,
  /choose/i,
  /pick/i,
  /ver detalles/i,
  /detalles?/i,
  /ayuda/i,
  /help/i,
  /seleccione\s+una?\s+opci[oó]n/i,
  /choose\s+an?\s+option/i,
  /select\s+an?\s+option/i,
];

function normalizeOrdinalText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractOrdinalFromText(text: string): "first" | "second" | "third" | "last" | null {
  const normalized = normalizeOrdinalText(text);
  for (const { pattern, ordinal } of ORDINAL_PATTERNS) {
    if (pattern.test(normalized)) return ordinal;
  }
  return null;
}

function buildOrdinalDomainTerms(routeProfile?: AppRouteProfile): string[] {
  const terms = new Set<string>(ORDINAL_GENERIC_TERMS.map(normalizeOrdinalText));
  for (const term of routeProfile?.domainTerms ?? []) {
    const normalized = normalizeOrdinalText(term);
    if (normalized) terms.add(normalized);
    if (normalized && !normalized.endsWith("s")) terms.add(`${normalized}s`);
  }
  return [...terms];
}

function extractDomainTermFromText(target: string, routeProfile?: AppRouteProfile): string | undefined {
  const normalized = normalizeOrdinalText(target);
  const terms = buildOrdinalDomainTerms(routeProfile);
  const matched = terms.find(term => term && normalized.includes(term));
  if (!matched) return undefined;
  return matched.replace(/s$/, "");
}

function isInstructionalText(text: string): boolean {
  const normalized = normalizeOrdinalText(text);
  return ORDINAL_INSTRUCTIONAL_PATTERNS.some(pattern => pattern.test(normalized));
}

function isOrdinalCandidateText(text: string): boolean {
  const normalized = normalizeOrdinalText(text);
  if (!normalized) return false;
  if (isInstructionalText(normalized)) return false;
  if (/^(selecciona|elige|escoge|select|choose|pick)\b/i.test(normalized)) return false;
  if (normalized.endsWith(":")) return false; // texts ending with colon are instructions, not items
  if (normalized.length > 80) return false;
  if ((normalized.match(/[.!?]/g) ?? []).length > 1) return false;
  if (normalized.length < 2) return false;
  return true;
}

function isProductLikeText(text: string, domainTerm?: string): boolean {
  const normalized = normalizeOrdinalText(text);
  if (!normalized) return false;
  if (domainTerm && normalized.includes(normalizeOrdinalText(domainTerm))) return true;
  return ORDINAL_GENERIC_TERMS.some(term => normalized.includes(normalizeOrdinalText(term)));
}

function isGlobalOrdinalControl(text: string, routeProfile?: AppRouteProfile): boolean {
  const normalized = normalizeOrdinalText(text);
  const blocked = new Set([
    "volver", "atras", "atrás", "back", "regresar", "return",
    "finalizar sesion", "finalizar sesión", "cerrar sesion", "cerrar sesión",
    "logout", "sign out", "salir", "solicitar", "request",
    "cancelar", "cancel", "confirmar", "confirm", "aceptar", "accept",
    "continuar", "continue", "siguiente", "next", "menu principal", "main menu"
  ]);
  if (blocked.has(normalized)) return true;
  for (const label of routeProfile?.blockedLabels ?? []) {
    if (normalized.includes(normalizeOrdinalText(label))) return true;
  }
  return false;
}

function isOrdinalSelectionActionIntent(actionIntent?: string): boolean {
  return actionIntent === "select_visible_item_by_ordinal";
}

async function resolveOrdinalSelectionOnPage(
  page: Page,
  options: { target: string; actionIntent: string; routeProfile?: AppRouteProfile; expectedTarget?: string }
): Promise<{ locator: any; text: string; selector: string; ordinal: string; domainTerm?: string; candidateCount: number } | null> {
  if (!isOrdinalSelectionActionIntent(options.actionIntent)) return null;

  const ordinal = extractOrdinalFromText(options.target);
  const domainTerm = extractDomainTermFromText(options.target, options.routeProfile);
  if (!ordinal) return null;

  const pageDiag = await capturePageDiagnostics(page).catch(() => null);

  const selectors = [
    'button:visible',
    '[role="button"]:visible',
    'a:visible',
    '[role="link"]:visible',
    'article:visible',
    '[role="listitem"]:visible',
    '[role="row"]:visible',
    '[class*="card"]:visible',
  ];

  const seen = new Set<string>();
  const candidates: OrdinalSelectionRuntimeCandidate[] = [];

  for (const selector of selectors) {
    const locatorGroup = page.locator(selector);
    const count = await locatorGroup.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const locator = locatorGroup.nth(index);
      try {
        const visible = await locator.isVisible().catch(() => false);
        if (!visible) continue;
        const enabled = await locator.isEnabled().catch(() => false);
        if (!enabled) continue;
        const text = ((await locator.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
        if (!isOrdinalCandidateText(text)) continue;
        const tagName = await locator.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "");
        const role = await locator.getAttribute("role").catch(() => undefined) ?? undefined;
        const isHeading = /^h[1-6]$/.test(tagName) || role === "heading";
        const isCardLike = /article|li|div|section|row/i.test(tagName) || /card|item|row|product/i.test(text);
        const isClickable = ["button", "a", "input"].includes(tagName) || role === "button" || role === "link" || isCardLike || isHeading;
        if (!isClickable) continue;
        const selectorKey = `${tagName}:${role ?? ""}:${text}`;
        if (seen.has(selectorKey)) continue;
        seen.add(selectorKey);
        let finalLocator = locator;
        if (isHeading) {
          const container = locator.locator('xpath=ancestor::article[1] | ancestor::li[1] | ancestor::section[1] | ancestor::div[contains(@class,"card")][1] | ancestor::div[contains(@class,"item")][1]');
          const containerCount = await container.count().catch(() => 0);
          if (containerCount > 0) {
            finalLocator = container.first();
          }
        }
        candidates.push({
          locator: finalLocator,
          text,
          selector,
          type: isHeading ? "heading" : isCardLike ? "card" : tagName === "button" ? "button" : tagName === "a" ? "link" : "item",
          role,
          tagName,
          visible,
          enabled,
          domainRelated: Boolean(domainTerm ? normalizeOrdinalText(text).includes(normalizeOrdinalText(domainTerm)) : isProductLikeText(text)),
          productLike: isProductLikeText(text, domainTerm),
        });
      } catch {
        continue;
      }
    }
  }

  if (candidates.length === 0 && pageDiag?.visibleButtons?.length) {
    for (const text of pageDiag.visibleButtons) {
      if (!isOrdinalCandidateText(text)) continue;
      const normalizedText = normalizeOrdinalText(text);
      const domainRelated = Boolean(domainTerm ? normalizedText.includes(normalizeOrdinalText(domainTerm)) : isProductLikeText(text));
      const productLike = isProductLikeText(text, domainTerm);
      if (!domainRelated && !productLike) continue;
      try {
        const locator = page.getByRole("button", { name: new RegExp(escapeRegex(text), "i") });
        candidates.push({
          locator,
          text,
          selector: `visibleButton:${text}`,
          type: "button",
          role: "button",
          tagName: "button",
          visible: true,
          enabled: true,
          domainRelated,
          productLike,
        });
      } catch {
        continue;
      }
    }
  }

  // Step 1: Prefer domain-related + product-like, then domain-related or product-like
  const safe = candidates.filter(c => c.visible && c.enabled && c.domainRelated && c.productLike);
  const ordered = safe.length > 0 ? safe : candidates.filter(c => c.visible && c.enabled && (c.domainRelated || c.productLike));
  
  // Step 2a: Exclude navigation controls like "Volver", "Salir"
  const navRejected = ordered.filter(c => isGlobalOrdinalControl(c.text, options.routeProfile));
  for (const nav of navRejected) {
    console.log(`[ordinal-selection-runtime] rejected navigation candidate="${nav.text}"`);
  }
  let nonNav = ordered.filter(c => !isGlobalOrdinalControl(c.text, options.routeProfile));
  
  // Step 2b: For ordinal item selection, separate generic categories from specific items.
  // A single-word label like "Tarjetas", "Cuentas", "Préstamos" is typically a section
  // heading/category, not a selectable item. Multi-word labels like "Préstamo Personal",
  // "Cuenta de Ahorro", "Tarjeta de Crédito" are specific items.
  const CATEGORY_NOUNS = new Set([
    "tarjetas", "cuentas", "prestamos", "préstamos", "depósitos", "depositos",
    "productos", "servicios", "categorías", "categorias", "solicitudes",
    "usuarios", "reportes", "documentos", "planes", "facturas", "ordenes", "órdenes",
    "sucursales", "beneficiarios", "registros", "resultados"
  ]);

  const categoryRejected: typeof candidates = [];
  const productCandidates: typeof candidates = [];
  for (const c of nonNav) {
    const text = c.text.trim().toLowerCase();
    const wordCount = text.split(/\s+/).length;
    const isSingleCategoryWord = wordCount === 1 && CATEGORY_NOUNS.has(text);
    if (isSingleCategoryWord) {
      categoryRejected.push(c);
      console.log(`[ordinal-selection-runtime] rejected category candidate="${c.text}" reason=generic_category_not_item`);
    } else {
      productCandidates.push(c);
    }
  }

  // Step 2c: If expectedTarget is specified (from detailTarget), rank candidates by match
  const expectedTarget = options.expectedTarget;
  if (expectedTarget && productCandidates.length > 0) {
    console.log(`[ordinal-selection] expectedTarget="${expectedTarget}"`);
    const normalizedExpected = normalizeOrdinalText(expectedTarget);

    // Score each candidate by match with expectedTarget
    const scored = productCandidates.map(c => {
      const normalizedText = normalizeOrdinalText(c.text);
      let score = 0;
      let reason = "no_match";
      let hasVariantConflict = false;

      // Exact match after normalization
      if (normalizedText === normalizedExpected) { score = 1.0; reason = "exact_match"; }
      else if (normalizedText.includes(normalizedExpected) || normalizedExpected.includes(normalizedText)) { score = 0.9; reason = "expected_target_match"; }
      else {
        // Token-based matching
        const expectedTokens = normalizedExpected.split(/\s+/).filter(t => t.length > 2);
        const candidateTokens = normalizedText.split(/\s+/).filter(t => t.length > 2);
        let matches = 0;
        for (const et of expectedTokens) {
          if (candidateTokens.some(ct => ct.includes(et) || et.includes(ct))) matches++;
        }
        const tokenScore = expectedTokens.length > 0 ? matches / expectedTokens.length : 0;
        if (tokenScore >= 0.6) { score = 0.7 + 0.2 * tokenScore; reason = "token_match"; }

        // Detect variant conflict: candidate has variant token that expected doesn't
        const variantTokens = ["pesos", "dólares", "dolares", "euros", "personal", "comercial", "clásica", "clasica", "gold", "platinum", "infinite"];
        for (const vt of variantTokens) {
          const inExpected = normalizedExpected.includes(vt);
          const inCandidate = normalizedText.includes(vt);
          if (inCandidate && !inExpected) { hasVariantConflict = true; score *= 0.3; reason = "variant_conflict"; console.log(`[ordinal-selection] candidate text="${c.text}" match=false reason=variant_conflict expectedVariant="${normalizedExpected.match(/pesos|dólares|dolares|euros|personal|comercial|clásica|clasica|gold|platinum|infinite/)?.[0] ?? "?"}" actualVariant="${vt}"`); }
        }
      }

      return { candidate: c, score, reason };
    });

    scored.sort((a, b) => b.score - a.score);
    const bestScore = scored[0].score;

    if (bestScore >= 0.7) {
      // Reorder productCandidates by score
      productCandidates.length = 0;
      for (const s of scored) {
        if (s.score === bestScore) productCandidates.push(s.candidate);
      }
      console.log(`[ordinal-selection] selected best match score=${bestScore.toFixed(2)} reason="${scored[0].reason}"`);
    }
  }

  // If only one non-nav candidate remains, accept it (even if single-word, it's the only option)
  if (productCandidates.length === 0 && nonNav.length === 1) {
    console.log(`[ordinal-selection-runtime] accepted only non-nav candidate="${nonNav[0].text}" reason=single_non_nav_candidate`);
    productCandidates.push(nonNav[0]);
  }
  
  // Prefer product candidates; for product domain, never fall back to categories
  const isProductDomain = Boolean(domainTerm && normalizeOrdinalText(domainTerm) === "producto");
  let candidatesToUse: typeof candidates;
  if (productCandidates.length > 0) {
    candidatesToUse = productCandidates;
  } else if (isProductDomain) {
    candidatesToUse = [];
  } else {
    candidatesToUse = nonNav;
  }
  const selected = candidatesToUse.length > 0 ? candidatesToUse[0] : undefined;
  if (selected) {
    console.log(`[ordinal-selection-runtime] ordinal=${ordinal} domainTerm=${domainTerm ?? "generic"} candidateCount=${candidates.length} selectedText="${selected.text}"`);
    return { ...selected, ordinal, domainTerm, candidateCount: candidates.length };
  }

  // Step 3: Empty candidates or none passed filters — fall back to pageDiag
  // Ensure pageDiag is available (retry if first capture failed)
  const effectiveDiag = pageDiag ?? await capturePageDiagnostics(page).catch(() => null);
  const visibleButtons = effectiveDiag?.visibleButtons ?? [];
  const visibleHeadingsDiag = effectiveDiag?.visibleHeadings ?? [];

  const firstVisibleButton = visibleButtons.find(text =>
    isOrdinalCandidateText(text) &&
    !isGlobalOrdinalControl(text, options.routeProfile) &&
    isProductLikeText(text, domainTerm)
  );
  if (firstVisibleButton) {
    return {
      locator: page.getByRole("button", { name: new RegExp(escapeRegex(firstVisibleButton), "i") }).first(),
      text: firstVisibleButton,
      selector: `visibleButton:${firstVisibleButton}`,
      ordinal,
      domainTerm,
      candidateCount: Math.max(candidates.length, visibleButtons.length),
    };
  }

  const firstHeading = visibleHeadingsDiag.find(text => isOrdinalCandidateText(text) && !isInstructionalText(text));
  if (firstHeading) {
    const headingLocator = page.getByRole("heading", { name: new RegExp(escapeRegex(firstHeading), "i") }).first();
    const headingContainer = headingLocator.locator('xpath=ancestor::article[1] | ancestor::li[1] | ancestor::section[1] | ancestor::div[contains(@class,"card")][1] | ancestor::div[contains(@class,"item")][1]').first();
    return {
      locator: headingContainer,
      text: firstHeading,
      selector: `visibleHeading:${firstHeading}`,
      ordinal,
      domainTerm,
      candidateCount: Math.max(candidates.length, visibleHeadingsDiag.length),
    };
  }

  // Step 4: Single product-like candidate from CSS selectors (no pageDiag needed)
  const allProductLike = candidates.filter(c => c.visible && c.enabled && c.productLike);
  if (allProductLike.length === 1) {
    return { ...allProductLike[0], ordinal, domainTerm, candidateCount: candidates.length };
  }
  
  return null;
}

export class PromotedSpecRuntime {
  private readonly config: PromotedRuntimeConfig;
  private lastDialogMessage?: string;
  private activeContainer?: { selector: string; descriptor: string };
  private activeContainerDiscardReason?: string;
  private lastSelectionStep?: { selectedTarget: string; stepIndex: number; timestamp: number };
  private evidenceRecorder?: any;
  private evidenceStepIndex = 0;
  private evidenceInitState: "pending" | "initialized" | "disabled" | "failed" = "pending";
  private evidenceInitReason?: string;
  private evidenceInitPromise?: Promise<void>;
  private initialNavigationEnsured = false;
  private initialScreenCapturePromise?: Promise<void>;
  private readonly loginRequests = new Set<Request>();
  private readonly authBoundary = {
    loginRequestObserved: false,
    loginPageUrl: undefined as string | undefined,
    loginRequestStartedAt: undefined as number | undefined,
    loginResponseObserved: false,
    loginResponseAt: undefined as number | undefined,
    loginStatus: undefined as number | undefined,
    loginRequestFinished: false,
    loginRequestFinishedAt: undefined as number | undefined,
    loginRequestFailed: false,
    loginRequestFailureText: undefined as string | undefined,
    authSubmitObserved: false,
    functionalBusinessExecutionStarted: false,
    oracleEvaluationStarted: false,
  };

  constructor(private readonly page: Page, config?: Partial<PromotedRuntimeConfig>) {
    this.config = { ...loadPromotedRuntimeConfigFromEnv(), ...config };
    this.attachAuthBoundaryObserver();
    this.page.on("dialog", async (dialog) => {
      this.lastDialogMessage = dialog.message();
      this.activeContainerDiscardReason = "dialog_seen_mark_container_stale";
      const lower = dialog.message().toLowerCase();
      const sensitive = /(password|otp|token|transfer|payment|loan|prestamo|contract|contrato)/i.test(lower);
      if (sensitive) {
        await dialog.dismiss().catch(() => undefined);
      } else {
        await dialog.accept().catch(() => undefined);
      }
    });

    // Initialize evidence recorder if EVIDENCE_ENABLED
    this.evidenceInitPromise = this.initEvidence().catch((err: any) => {
      this.evidenceInitState = "failed";
      this.evidenceInitReason = err?.message ?? "unknown_error";
      console.log(`[evidence] init error: ${this.evidenceInitReason}`);
    });
  }

  private attachAuthBoundaryObserver(): void {
    this.page.on("request", (request) => {
      if (request.method().toUpperCase() !== "POST" || !this.isLoginRequestUrl(request.url())) return;
      this.loginRequests.add(request);
      if (!this.authBoundary.loginRequestObserved) {
        this.authBoundary.loginRequestObserved = true;
        this.authBoundary.loginRequestStartedAt = Date.now();
        this.authBoundary.loginPageUrl = this.page.url();
      }
    });
    this.page.on("response", (response) => {
      const request = response.request();
      if (!this.loginRequests.has(request)) return;
      this.authBoundary.loginResponseObserved = true;
      this.authBoundary.loginResponseAt ??= Date.now();
      this.authBoundary.loginStatus ??= response.status();
    });
    this.page.on("requestfinished", (request) => {
      if (!this.loginRequests.has(request)) return;
      this.authBoundary.loginRequestFinished = true;
      this.authBoundary.loginRequestFinishedAt = Date.now();
    });
    this.page.on("requestfailed", (request) => {
      if (!this.loginRequests.has(request)) return;
      this.authBoundary.loginRequestFailed = true;
      this.authBoundary.loginRequestFinished = true;
      this.authBoundary.loginRequestFinishedAt = Date.now();
      this.authBoundary.loginRequestFailureText = request.failure()?.errorText;
    });
  }

  private isLoginRequestUrl(url: string): boolean {
    try {
      const pathname = new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
      return pathname === "/login" || pathname.endsWith("/login");
    } catch {
      return /\/login(?:$|[?#])/i.test(url);
    }
  }

  private isAuthSubmitTarget(target: string): boolean {
    return /continuar|iniciar sesión|iniciar sesion|login|sign in|submit|ingresar/i.test(target);
  }

  private async markBoundaryProgress(): Promise<void> {
    if (!this.authBoundary.authSubmitObserved) return;
    const currentUrl = this.page.url();
    const onLoginSurface = this.isLoginRequestUrl(currentUrl);
    if (!onLoginSurface) {
      this.authBoundary.functionalBusinessExecutionStarted = true;
    }
  }

  private async emitAuthBoundaryAttempt(): Promise<void> {
    const pageDiag = await capturePageDiagnostics(this.page).catch(() => undefined);
    const currentUrl = this.page.url();
    const authSurfaceStillVisible = this.isLoginRequestUrl(currentUrl)
      || Boolean(pageDiag?.visibleButtons.some((text) => /continuar|iniciar sesión|iniciar sesion|iniciando sesión|iniciando sesion|login|ingresar/i.test(text)));
    const loadingIndicatorObserved = Boolean(
      pageDiag?.loadingDetected
      || pageDiag?.skeletonDetected
      || pageDiag?.visibleButtons.some((text) => /cargando|loading|iniciando sesión|iniciando sesion|procesando/i.test(text)),
    );
    const postLoginSurfaceObserved = this.authBoundary.authSubmitObserved && !authSurfaceStillVisible;
    const businessSurfaceReached = postLoginSurfaceObserved && !loadingIndicatorObserved;
    const authRejected = this.authBoundary.loginStatus === 401
      || this.authBoundary.loginStatus === 403
      || Boolean(pageDiag?.visibleTexts.some((text) => /credencial|contraseña incorrecta|contrasena incorrecta|usuario inválido|usuario invalido|autenticación fallida|autenticacion fallida|invalid password|invalid credential/i.test(text)));
    const applicationError = !authRejected && Boolean(pageDiag?.visibleTexts.some((text) => /\b(?:error|exception|fall[oó]|failed)\b/i.test(text)));
    const requestPending = this.authBoundary.loginRequestObserved
      && !this.authBoundary.loginRequestFinished
      && !this.authBoundary.loginRequestFailed;
    // The auth request already succeeded and the route already left the login surface — the
    // ONLY reason this attempt isn't businessSurfaceReached yet is that the business surface is
    // still loading. That is a normal, transient state, never a navigation failure: a real
    // POST_AUTH_NAVIGATION_FAILURE means the request is still pending or the app never actually
    // left the login surface at all.
    const stillLoadingBusinessSurface = postLoginSurfaceObserved && loadingIndicatorObserved && !requestPending;
    const failureClassification = businessSurfaceReached
      ? "BUSINESS_SURFACE_REACHED"
      : authRejected
        ? "AUTH_REJECTED"
        : stillLoadingBusinessSurface
          ? "POST_AUTH_LOADING"
          : this.authBoundary.loginRequestObserved && (requestPending || loadingIndicatorObserved || authSurfaceStillVisible)
            ? "POST_AUTH_NAVIGATION_FAILURE"
            : "PROMOTED_RUNTIME_FAILURE";
    const attempt = Number(process.env.PROMOTED_RUNTIME_ATTEMPT ?? "1");
    const payload: PromotedAuthBoundaryAttempt = {
      attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
      browserStarted: true,
      contextStarted: true,
      pageStarted: true,
      loginRequestObserved: this.authBoundary.loginRequestObserved,
      loginRequestStartedAt: this.authBoundary.loginRequestStartedAt,
      loginResponseObserved: this.authBoundary.loginResponseObserved,
      loginResponseAt: this.authBoundary.loginResponseAt,
      loginStatus: this.authBoundary.loginStatus,
      loginRequestFinished: this.authBoundary.loginRequestFinished,
      loginRequestFinishedAt: this.authBoundary.loginRequestFinishedAt,
      loginRequestFailed: this.authBoundary.loginRequestFailed,
      loginRequestFailureText: this.authBoundary.loginRequestFailureText,
      requestPending,
      redirectObserved: Boolean(this.authBoundary.loginPageUrl && currentUrl !== this.authBoundary.loginPageUrl),
      urlChanged: Boolean(this.authBoundary.loginPageUrl && currentUrl !== this.authBoundary.loginPageUrl),
      loadingIndicatorObserved,
      authSurfaceStillVisible,
      postLoginSurfaceObserved,
      businessSurfaceReached,
      failureClassification,
      authRejected,
      applicationError,
      functionalBusinessExecutionStarted: this.authBoundary.functionalBusinessExecutionStarted,
      oracleEvaluationStarted: this.authBoundary.oracleEvaluationStarted,
    };
    console.log(`[promoted-runtime-attempt] ${JSON.stringify(payload)}`);
  }

  /** Initialize evidence recorder from env config */
  private async initEvidence(): Promise<void> {
    try {
      const cfg = loadEvidenceConfig();
      if (!cfg.enabled) {
        this.evidenceInitState = "disabled";
        this.evidenceInitReason = "config_disabled";
        console.log("[evidence] disabled reason=config_disabled");
        return;
      }
      this.evidenceRecorder = new EvidenceRecorder(
        {
          appSlug: stringFromEnv("EVIDENCE_APP_SLUG", "APP_SLUG") ?? "default",
          sectionSlug: stringFromEnv("EVIDENCE_SECTION_SLUG", "SECTION_SLUG") ?? "default-section",
          sectionName: process.env.SECTION_NAME,
          scenarioId: stringFromEnv("SCENARIO_ID") ?? "unknown",
          scenarioTitle: stringFromEnv("SCENARIO_TITLE") ?? "unknown",
          runId: process.env.EVIDENCE_RUN_ID,
          outputRoot: cfg.outputRoot,
          analystName: cfg.analystName || process.env.EVIDENCE_ANALYST_NAME,
        },
        cfg,
      );
      await this.evidenceRecorder.start();
      this.evidenceInitState = "initialized";
      this.evidenceInitReason = undefined;
      console.log(`[evidence] initialized scenario=${process.env.SCENARIO_ID || "unknown"}`);
    } catch (err: any) {
      this.evidenceInitState = "failed";
      this.evidenceInitReason = err?.message ?? "unknown_error";
      console.log(`[evidence] init failed: ${this.evidenceInitReason}`);
    }
  }

  private async ensureEvidenceInitialized(): Promise<void> {
    if (!this.evidenceInitPromise) return;
    await this.evidenceInitPromise;
  }

  /**
   * A promoted candidate is not guaranteed to arrive already navigated (unlike the promoted
   * case.spec.ts template, generated candidates sometimes call clickPromotedTarget directly on
   * a fresh, unnavigated page). Discovery's own bootstrap (case-discovery.ts) always does
   * goto(appBaseUrl) -> waitForPageReady before its first action; the promoted runtime must
   * offer the same guarantee instead of assuming the caller already navigated, reusing the same
   * shared readiness primitive rather than the ad hoc DOM poll in captureInitialScreen.
   */
  private async ensureInitialNavigation(): Promise<void> {
    if (this.initialNavigationEnsured) return;
    this.initialNavigationEnsured = true;

    const appSlug = process.env.APP_SLUG ?? "unknown";
    const appBaseUrl = process.env.APP_BASE_URL;
    const resolvedUrlSource = appBaseUrl ? "child_env" : "none";
    const currentUrl = this.page.url();
    const onAppSurface = Boolean(appBaseUrl) && this.isOnAppSurface(currentUrl, appBaseUrl!);
    const navigationRequired = !onAppSurface;
    let gotoInvoked = false;

    // Distinguished from the parent-side [promoted-initial-navigation] log (spec-generation-hybrid.ts,
    // phase=launch_context / resolvedUrlSource=appProfile.baseUrl) by phase=runtime and
    // resolvedUrlSource=child_env: this line reports what the spawned Playwright process actually saw.
    const logBoundary = (readinessReady: boolean, readinessReason: string, currentUrlAfter: string) => {
      console.log(
        `[promoted-initial-navigation] phase=runtime appSlug=${appSlug} rawAppBaseUrl=${appBaseUrl ? "present" : "missing"} resolvedUrlSource=${resolvedUrlSource} currentUrlBefore=${currentUrl} navigationRequired=${navigationRequired} gotoInvoked=${gotoInvoked} currentUrlAfter=${currentUrlAfter} readinessReady=${readinessReady} readinessReason=${readinessReason}`
      );
    };

    if (navigationRequired) {
      if (!appBaseUrl) {
        logBoundary(false, "app_base_url_missing", currentUrl);
        throw new Error("initial_readiness_failure: APP_BASE_URL is required to navigate before first business action");
      }
      console.log(`[initial-navigation] phase=goto_start url=${appBaseUrl}`);
      try {
        await this.page.goto(appBaseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        gotoInvoked = true;
      } catch (error: any) {
        logBoundary(false, "navigation_failed", this.page.url());
        throw new Error(`initial_readiness_failure: navigation_failed reason=${error?.message ?? "unknown_error"}`);
      }
      console.log(`[initial-navigation] phase=goto_complete finalPath=${this.page.url()}`);
    } else {
      console.log(`[initial-navigation] phase=skipped reason=already_on_app_surface url=${currentUrl}`);
    }

    const readinessStartedAt = Date.now();
    console.log(`[initial-readiness] phase=start timeoutMs=5000`);
    try {
      await waitForPageReady(this.page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
    } catch (error: any) {
      console.log(`[initial-readiness] phase=complete ready=false durationMs=${Date.now() - readinessStartedAt} reason=readiness_error`);
      logBoundary(false, "readiness_error", this.page.url());
      throw new Error(`initial_readiness_failure: readiness_error reason=${error?.message ?? "unknown_error"}`);
    }
    console.log(`[initial-readiness] phase=complete ready=true durationMs=${Date.now() - readinessStartedAt} reason=none`);
    logBoundary(true, "none", this.page.url());
  }

  private isOnAppSurface(currentUrl: string, appBaseUrl: string): boolean {
    if (!currentUrl || currentUrl === "about:blank") return false;
    try {
      return new URL(currentUrl).origin === new URL(appBaseUrl).origin;
    } catch {
      return false;
    }
  }

  /**
   * FIRST_LOSS fix (recordingId=1f9415f3-...): every `clickPromotedTarget`/`fillPromotedField`/
   * `pressPromotedTarget` call reaches `ensureInitialEvidence()` first, but this used to
   * unconditionally re-invoke `captureInitialScreen` on EVERY single step, not just the first --
   * physical evidence showed step 6 hang inside this exact preparation (no
   * `runtime:session_reset`/click-dispatch log ever followed `[promoted-step] stepIndex=6
   * phase=start`) rather than in target resolution or the click itself. Guarded by ONE shared
   * Promise, assigned synchronously before any `await` runs, so two steps racing into
   * `ensureInitialEvidence()` back-to-back can never both start their own capture -- the second
   * always awaits the SAME in-flight (or already-settled) promise. A first-call failure is
   * cached as-is (never silently retried into a later "success"): every subsequent call re-awaits
   * that same rejected promise and observes the identical explicit failure.
   */
  private async captureInitialScreenOnce(): Promise<void> {
    if (!this.initialScreenCapturePromise) {
      this.initialScreenCapturePromise = (async () => {
        if (!this.evidenceRecorder) return;
        // ensureInitialNavigation() just proved readiness via the shared waitForPageReady
        // primitive; tell captureInitialScreen to trust that instead of re-deriving readiness
        // through its own independent DOM poll (see evidence-recorder.ts).
        const captured = await this.evidenceRecorder.captureInitialScreen(this.page, "promoted_reuse", undefined, { alreadyReady: true });
        if (!captured) throw new Error("initial_readiness_failure");
      })();
    }
    await this.initialScreenCapturePromise;
  }

  /**
   * FIRST_LOSS fix (recordingId=1f9415f3-...): even after the reordering (session diagnostic
   * before the DOM snapshot) and the stale-.js-module cleanup, physical evidence still showed
   * step 6 hang with zero log output between `[promoted-step] stepIndex=6 phase=start` and the
   * global test timeout -- never reaching `[runtime:diagnostic] phase=start`. On a step AFTER
   * the first (steps 1-5 already warmed every guard), `ensureInitialNavigation`/
   * `ensureEvidenceInitialized`/`captureInitialScreenOnce` all early-return via their own
   * idempotency guards, but NONE of those fast-path returns emit any log at all -- so a genuine
   * hang inside any one of them (or inside whatever it's still awaiting) was completely
   * invisible, and previously completely UNBOUNDED on the steady-state path (only the FIRST
   * call's own internal sub-timeouts -- goto/readiness -- ever bounded anything). Each boundary
   * is now wrapped in its own timed, logged race: a genuine timeout throws an explicit,
   * fail-closed error (never silently treated as done) and is now provably observable on the
   * next physical run, whichever boundary (if any) is the real culprit.
   */
  private async boundedRuntimeBoundary<T>(label: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
    console.log(`[TRACE-4] entered=boundedRuntimeBoundary label=${label}`);
    const startedAt = Date.now();
    console.log(`[runtime:boundary] phase=start boundary=${label} timeoutMs=${timeoutMs}`);
    let timeoutRef: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutRef = setTimeout(
        () => reject(new Error(`runtime_boundary_timeout:${label}: boundary did not settle within ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      const result = await Promise.race([fn(), timeoutPromise]);
      console.log(`[runtime:boundary] phase=end boundary=${label} status=completed durationMs=${Date.now() - startedAt}`);
      return result;
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.startsWith("runtime_boundary_timeout:");
      console.log(
        `[runtime:boundary] phase=end boundary=${label} status=${isTimeout ? "timeout" : "error"} ` +
        `durationMs=${Date.now() - startedAt} detail=${JSON.stringify(error instanceof Error ? error.message : String(error))}`,
      );
      throw error;
    } finally {
      if (timeoutRef) clearTimeout(timeoutRef);
    }
  }

  private async ensureInitialEvidence(): Promise<void> {
    console.log(`[TRACE-2] entered=ensureInitialEvidence`);
    // The FIRST call's own navigation may legitimately take as long as its own internal
    // sub-budgets (goto timeout 60000ms + readiness 5000ms) -- bounded generously here so a
    // genuinely slow-but-valid first navigation is never falsely killed by the shorter action
    // timeout; every later call returns via `initialNavigationEnsured` near-instantly regardless.
    const navigationTimeoutMs = Math.max(this.config.actionTimeoutMs, 65000);
    console.log(`[TRACE-3a] about_to_call=boundedRuntimeBoundary label=ensure_initial_navigation`);
    await this.boundedRuntimeBoundary("ensure_initial_navigation", navigationTimeoutMs, () => this.ensureInitialNavigation());
    console.log(`[TRACE-3b] about_to_call=boundedRuntimeBoundary label=ensure_evidence_initialized`);
    await this.boundedRuntimeBoundary("ensure_evidence_initialized", this.config.actionTimeoutMs, () => this.ensureEvidenceInitialized());
    console.log(`[TRACE-3c] about_to_call=boundedRuntimeBoundary label=capture_initial_screen_once`);
    await this.boundedRuntimeBoundary("capture_initial_screen_once", this.config.actionTimeoutMs, () => this.captureInitialScreenOnce());
  }

  /** Capture evidence for a single step */
  private async captureEvidenceStep(
    stepText: string,
    status: "passed" | "failed" | "skipped",
    errorMessage?: string,
    options?: { sourceStepIndex?: number; target?: string }
  ): Promise<void> {
    await this.ensureEvidenceInitialized();
    if (!this.evidenceRecorder) return;

    this.evidenceStepIndex++;
    try {
      const target = options?.target ?? stepText.match(/"([^"]+)"/)?.[1];
      await this.evidenceRecorder.captureStep(this.page, this.evidenceStepIndex, stepText, {
        target,
        status,
        errorMessage,
        sourceStepIndex: options?.sourceStepIndex,
      });
    } catch (err: any) {
      console.log(`[evidence] step capture failed: ${err.message}`);
    }
  }

  /** Capture evidence for a click target step */
  private async captureClickStep(target: string, status: "passed" | "failed" | "skipped", errorMessage?: string, sourceStepIndex?: number): Promise<void> {
    if (!this.evidenceRecorder) return;
    const stepText = `Clic en "${target}".`;
    await this.captureEvidenceStep(stepText, status, errorMessage, { target, sourceStepIndex });
  }

  /**
   * Call at the end of a spec to finalize evidence (saves evidence.json and generates
   * evidencia.docx). A generated candidate always calls this from its own `finally` block, right
   * after every required action/oracle step has already settled (passed or thrown) — so entry
   * into this method is the practical, always-instrumentable boundary between "business logic
   * done" and "framework finalization", and its return is the last thing that happens before the
   * candidate's own test() function body returns to Playwright. See
   * promoted-runtime-lifecycle.test.ts for why a true test_body_return/fixture_teardown_* marker
   * cannot be emitted from here: those happen inside the generated candidate file and Playwright
   * itself, outside this class.
   */
  async finishEvidence(): Promise<void> {
    console.log(`[promoted-runtime-lifecycle] phase=test_business_complete currentUrl=${this.page.url()}`);
    await this.emitAuthBoundaryAttempt();
    await this.ensureEvidenceInitialized();
    if (!this.evidenceRecorder) {
      if (this.evidenceInitState === "failed") {
        console.log(`[evidence] unavailable reason=initialization_failed detail=${this.evidenceInitReason ?? "unknown"}`);
      } else if (this.evidenceInitState === "disabled") {
        console.log(`[evidence] disabled`);
      }
      console.log(`[promoted-runtime-lifecycle] phase=test_body_return currentUrl=${this.page.url()}`);
      return;
    }
    console.log(`[promoted-runtime-lifecycle] phase=finish_evidence_start currentUrl=${this.page.url()}`);
    try {
      if (!this.evidenceRecorder.hasInitialScreenEvidence) {
        await this.evidenceRecorder.captureInitialScreen(this.page, "promoted_reuse");
      }
      const record = await this.evidenceRecorder.finish();
      const perScenarioDocxGenerated = Boolean(
        record.docxPath
        && fs.existsSync(record.docxPath),
      );
      console.log(
        `[evidence] scenario=${record.scenarioId} status=${record.status} perScenarioDocxGenerated=${perScenarioDocxGenerated} steps=${record.steps.length} screenshots=${record.steps.filter((s: any) => s.screenshotPath).length}`,
      );
    } catch (err: any) {
      console.log(`[evidence] finish failed: ${err.message}`);
    }
    console.log(`[promoted-runtime-lifecycle] phase=finish_evidence_complete currentUrl=${this.page.url()}`);
    console.log(`[promoted-runtime-lifecycle] phase=test_body_return currentUrl=${this.page.url()}`);
  }

  async waitForPromotedUiStable(stepIndex: number, target: string): Promise<void> {
    if (!this.config.enabled) return;
    const stability = await waitForStablePageState(this.page, {
      timeoutMs: this.config.stabilityTimeoutMs,
      pollMs: 500,
      stableForMs: 700
    });
    if (!stability.finalStable) {
      throw new Error(`UI not stable after step ${stepIndex} target="${target}"`);
    }
  }

  async handlePromotedDialogOrAlert(): Promise<string | undefined> {
    return this.lastDialogMessage;
  }

  /**
   * Attempt safe replay of previous steps to restore context after home reset
   */
  async safeReplayContext(
    previousSteps: SafeReplayStep[],
    targetStepIndex: number
  ): Promise<{
    success: boolean;
    replayedSteps: number[];
    stoppedAt?: number;
    reason?: string;
  }> {
    const replayedSteps: number[] = [];
    
    const stepsToReplay = previousSteps.filter(
      s => s.stepIndex < targetStepIndex && isSafeActionToReplay(s.actionIntent) && !s.sensitive
    );
    
    if (stepsToReplay.length === 0) {
      return { success: false, replayedSteps, reason: "no_safe_steps_to_replay" };
    }
    
    console.log(`[runtime:replay] Attempting to replay ${stepsToReplay.length} safe step(s) to restore context`);
    
    for (const step of stepsToReplay) {
      try {
        console.log(`[runtime:replay] Replaying step ${step.stepIndex}: ${step.actionIntent} "${step.target}"`);
        
        // FIRST_LOSS fix (recordingId=1f9415f3-...): the compiled replay callback itself (a
        // recorded locator's own `.click()`/`.fill()`, verbatim from the original step -- see
        // `PreviousStepReplay` in deterministic-spec-compiler.ts) carries no timeout of its own,
        // and neither did this call site. Physical evidence: after a `session_expiring_warning`
        // detection (the page never actually left the CURRENT screen -- it's a still-open
        // countdown dialog, not a reset back to the recorded step's original surface), the
        // replayed locator genuinely never became actionable, and Playwright's own auto-wait
        // retried with NO bound of its own until the outer 90s test watchdog fired -- masking a
        // normal, already-handled "this recorded step's surface isn't here anymore" case as a
        // full test timeout instead of the existing, already-correct `replay_failed_at_step_N`
        // fail-closed path below. Bounded here by the SAME `actionTimeoutMs` every other action
        // in this runtime already uses -- never a new locator, never nth/first/last/positional
        // authority, never a second replay attempt.
        if (step.replay && typeof step.replay === 'function') {
          await withTimeout(step.replay(), this.config.actionTimeoutMs, `replay step ${step.stepIndex}`);
        } else if (step.action && typeof step.action === 'function') {
          await withTimeout(step.action(), this.config.actionTimeoutMs, `replay step ${step.stepIndex}`);
        } else {
          console.warn(`[runtime:replay] Step ${step.stepIndex} has no executable callback`);
          return { 
            success: false, 
            replayedSteps, 
            stoppedAt: step.stepIndex, 
            reason: `step_${step.stepIndex}_missing_replay_callback` 
          };
        }
        
        replayedSteps.push(step.stepIndex);
        await this.waitForPromotedUiStable(step.stepIndex, step.target);
      } catch (error) {
        console.warn(`[runtime:replay] Failed to replay step ${step.stepIndex}: ${error instanceof Error ? error.message : String(error)}`);
        return { 
          success: false, 
          replayedSteps, 
          stoppedAt: step.stepIndex, 
          reason: `replay_failed_at_step_${step.stepIndex}` 
        };
      }
    }
    
    console.log(`[runtime:replay] Successfully replayed ${replayedSteps.length} step(s)`);
    return { success: true, replayedSteps };
  }

  /**
   * Check if current page is already a list page (for return_to_list handling)
   */
  async checkIfAlreadyOnListPage(pageDiag: {
    currentUrl: string;
    visibleButtons: string[];
    visibleHeadings: string[];
    visibleTexts: string[];
  }): Promise<boolean> {
    const { currentUrl, visibleButtons, visibleHeadings, visibleTexts } = pageDiag;
    
    // Signals that indicate we're on a list page
    const listPageSignals = {
      // Multiple product cards/items visible
      hasMultipleItems: visibleButtons.length >= 2,
      
      // Heading indicates list/module
      hasListHeading: visibleHeadings.some(h => 
        /consulta|listado|productos|productos|balance|transacciones|menu/i.test(h)
      ),
      
      // No detail-specific elements
      noDetailSignals: !visibleHeadings.some(h => 
        /detalle|detail|informaci|information del producto|finalizar sesi|log out|log out/i.test(h)
      ) && !visibleButtons.some(b =>
        /finalizar sesi|log out|log out|más detalles|ver detalles|informaci|details/i.test(b)
      ),
      
      // Has product selection buttons/cards
      hasProductButtons: visibleButtons.some(b =>
        /dep|cuenta|tarjeta|producto|item|card|balance|préstamo|prestamo/i.test(b)
      )
    };
    
    const isOnListPage = 
      listPageSignals.hasMultipleItems &&
      listPageSignals.hasListHeading &&
      listPageSignals.noDetailSignals &&
      listPageSignals.hasProductButtons;
    
    if (isOnListPage) {
      console.log(`[runtime:list_check] List page detected: hasMultipleItems=${listPageSignals.hasMultipleItems} hasListHeading=${listPageSignals.hasListHeading} noDetailSignals=${listPageSignals.noDetailSignals} hasProductButtons=${listPageSignals.hasProductButtons}`);
    }
    
    return isOnListPage;
  }

  private async ensureContextForOrdinalSelection(options: {
    target: string;
    stepIndex: number;
    previousStepReplays?: SafeReplayStep[];
    previousSteps?: SafeReplayStep[];
    routeProfile?: AppRouteProfile;
  }): Promise<void> {
    const replaySteps = options.previousStepReplays || options.previousSteps || [];
    const readyBeforeReplay = await waitForListReadiness(this.page, { timeoutMs: 1500, pollMs: 250, minCards: 1 });
    if (readyBeforeReplay.ready) return;

    const currentDiag = await capturePageDiagnostics(this.page).catch(() => undefined);
    const nonGlobalButtons = (currentDiag?.visibleButtons ?? []).filter((text) =>
      isOrdinalCandidateText(text) &&
      !isGlobalOrdinalControl(text, options.routeProfile) &&
      !isInstructionalText(text)
    );
    const nonGlobalHeadings = (currentDiag?.visibleHeadings ?? []).filter((text) =>
      isOrdinalCandidateText(text) && !isInstructionalText(text)
    );
    const hasVisibleOrdinalCandidate = nonGlobalButtons.length >= 2 || nonGlobalHeadings.length >= 2;

    if (hasVisibleOrdinalCandidate) return;

    if (replaySteps.length > 0) {
      console.log(`[runtime:ordinal_context] list not ready, replaying ${replaySteps.length} prior step(s) before ordinal target="${options.target}" stepIndex=${options.stepIndex}`);
      const replayResult = await this.safeReplayContext(replaySteps, options.stepIndex);
      if (replayResult.success) {
        const readyAfterReplay = await waitForListReadiness(this.page, { timeoutMs: 4000, pollMs: 250, minCards: 1 });
        if (readyAfterReplay.ready) return;
      }
    }

    const pageDiag = await capturePageDiagnostics(this.page);
    const expectedContext = options.routeProfile?.domainTerms?.length
      ? `list_context:${options.routeProfile.domainTerms.join("|")}`
      : "list_context";
    throw new Error(
      `missing_runtime_context_for_ordinal: target="${options.target}" actionIntent="select_visible_item_by_ordinal" ` +
      `expectedContext="${expectedContext}" currentUrl="${pageDiag.currentUrl}" ` +
      `visibleHeadings=[${pageDiag.visibleHeadings.join(", ")}] visibleButtons=[${pageDiag.visibleButtons.join(", ")}] ` +
      `replayStepsCount=${replaySteps.length} stepIndex=${options.stepIndex} ` +
      `suggestedFix="Reproduce the full navigation path before ordinal selection, including entry/module/category/list"` 
    );
  }

  /**
   * Executes a click using a certified structural identity, via the SAME shared
   * resolveRecordedStructuralOwner resolver Discovery's own recording replay already uses --
   * never a second/parallel structural resolver, never a fabricated CSS/positional fallback.
   * Fails closed (throws) if the resolver cannot produce exactly one visible, enabled element;
   * the caller (clickPromotedTarget) never falls back to the bare ref-based locator/callback
   * path for this authority once it has been declared.
   */
  private async clickPromotedTargetViaStructuralAuthority(options: PromotedClickOptions): Promise<void> {
    const previousUrl = this.page.url();
    const expectedEffect = options.expectedEffect ?? "ui_change";
    const targetIdentity = resolvePromotedFieldIdentityFromPersistedContract(options.stepIndex, options.target, {
      valueKey: options.valueKey,
      technicalTargetRefs: options.technicalTargetRefs,
    });
    const resolvedExpectedEffect = effectiveExpectedEffect(expectedEffect, targetIdentity);
    const beforeActionSnapshot = this.config.enabled
      ? await capturePromotedActionSurfaceSnapshot(this.page, options.target).catch(() => undefined)
      : undefined;

    const resolution = await resolveRecordedStructuralOwner(this.page, options.structuralTarget);
    if (!resolution) {
      throw new Error(
        `Promoted click failed at step ${options.stepIndex} target="${options.target}". ` +
        `reason=structural_authority_not_unique_or_unresolved ` +
        `suggestedFix="Certified structural authority did not resolve to exactly one visible, enabled element -- never falls back to a weaker locator, text match, or position."`
      );
    }
    console.log(
      `[promoted-click-structural] stepIndex=${options.stepIndex} strategy=${resolution.strategy} ` +
      `matchCount=${resolution.currentMatchCount}`
    );
    const selectionStateProbe = resolvedExpectedEffect === "selection_state_change"
      ? { locator: resolution.locator, before: await readPromotedInteractiveState(resolution.locator), strategy: resolution.strategy }
      : undefined;
    await resolution.locator.click();
    await this.postActionStability(previousUrl, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target, selectionStateProbe);
    if (expectedEffect !== "none") await this.refreshActiveContainer();
  }

  async clickPromotedTarget(options: PromotedClickOptions): Promise<void> {
    console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=start currentUrl=${this.page.url()} runtimeModuleVersion=${PROMOTED_SPEC_RUNTIME_MODULE_VERSION}`);
    await this.markBoundaryProgress();
    console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=boundary_progress_done`);
    if (this.isAuthSubmitTarget(options.target)) {
      this.authBoundary.authSubmitObserved = true;
    }
    console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=ensure_initial_evidence_start`);
    console.log(`[runtime-sequence] after_ensure_initial_evidence_start version=${PROMOTED_SPEC_RUNTIME_MODULE_VERSION} stepIndex=${options.stepIndex}`);
    console.log(`[TRACE-1] stepIndex=${options.stepIndex} about_to_call=ensureInitialEvidence`);
    await this.ensureInitialEvidence();
    console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=ensure_initial_evidence_done`);

    // Certified structural authority (deterministic compiler, kind=certified_structural with a
    // usable owner) is a SEPARATE, exigent path -- reuses the exact same resolver Discovery's
    // own recording replay already trusts, never the bare ref-based locator/callback machinery
    // below. Fail-closed by construction (resolveRecordedStructuralOwner already requires
    // deterministicStructuralIdentity/non-ambiguity/count===1/visible/enabled): never falls back
    // to a weaker locator when this authority was declared but doesn't resolve.
    if (options.structuralTarget) {
      await this.clickPromotedTargetViaStructuralAuthority(options);
      return;
    }

    const previousUrl = this.page.url();
    const expectedEffect = options.expectedEffect ?? "ui_change";
    let retryAttempted = false;
    const targetIdentity = resolvePromotedFieldIdentityFromPersistedContract(options.stepIndex, options.target, {
      valueKey: options.valueKey,
      technicalTargetRefs: options.technicalTargetRefs,
    });
    const resolvedExpectedEffect = effectiveExpectedEffect(expectedEffect, targetIdentity);

    const replaySteps = options.previousStepReplays || options.previousSteps;
    const isInitialHomeEntryAction =
      options.actionIntent === "start_session" ||
      options.actionIntent === "open_home" ||
      /^(iniciar|inicio|home|start)$/i.test(options.target.trim());

    console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=home_reset_check_start`);
    // FIRST_LOSS fix (recordingId=1f9415f3-...): the session diagnostic must run BEFORE any
    // non-essential DOM snapshot -- `beforeActionSnapshot` (used only for the LATER post-click
    // comparison, never for target resolution or session detection) previously ran first here,
    // so a hang/slow read inside it could keep the runtime from ever reaching
    // `detectHomeResetOrInactivity`'s own bounded timeout at all. STEP 1 (session detection) and
    // STEP 1a (replay-or-fail-closed) now come strictly first; the surface snapshot moves to
    // right before it is actually needed, below.
    //
    // Defense-in-depth (recordingId=1f9415f3-...): `detectHomeResetOrInactivity` already logs its
    // own `[runtime:diagnostic] phase=start` as its very first (synchronous) statement and bounds
    // its own internal work via `capturePageDiagnostics`'s `timeoutMs` -- by ordinary JS
    // execution semantics that log MUST fire in the same synchronous stretch as this call. If a
    // future change (or an execution environment this repo cannot control) ever breaks that
    // guarantee, this OUTER boundary still makes the call itself observable and bounded: its own
    // start/end log is emitted from THIS synchronous call site (never dependent on the callee
    // ever running at all), and a hang here still fails closed via `actionTimeoutMs` instead of
    // silently consuming the full global test timeout.
    const homeReset = await this.boundedRuntimeBoundary(
      "detect_home_reset_or_inactivity",
      this.config.actionTimeoutMs,
      () => detectHomeResetOrInactivity(this.page, this.config.actionTimeoutMs),
    );
    if (homeReset.detected && !isInitialHomeEntryAction) {
      console.log(`[runtime:session_reset] detected: reason="${homeReset.reason}" currentUrl="${homeReset.currentUrl}" stepIndex=${options.stepIndex}`);

      // FIRST_LOSS fix (recordingId=1f9415f3-...): `session_expiring_warning` is a still-open
      // countdown dialog on the SAME screen the action was targeting -- unlike every other
      // `homeReset.reason` here, it is never a reset back to the recorded flow's starting
      // surface (see `detectHomeResetOrInactivity`'s own doc). `previousStepReplays` targets an
      // EARLIER recorded surface (e.g. the landing page's own entry link) that provably is not
      // present on the CURRENT surface -- physical evidence already confirmed the resulting
      // replay attempt fails closed correctly, but only after burning a full bounded timeout on
      // a target that could never have resolved. Recognizing this classification up front skips
      // that doomed attempt and fails closed immediately with a distinct, honest reason -- never
      // a silent success, never a new recovery locator/heuristic, never touching the diagnostic
      // patterns or the timeout itself.
      if (homeReset.reason === "session_expiring_warning") {
        throw new Error(
          `session_expiring_warning_unrecoverable: Session-expiry warning detected on the current surface (not a context reset); ` +
          `recorded replay targets belong to an earlier surface and are not present here. ` +
          `currentUrl="${homeReset.currentUrl}" stepIndex=${options.stepIndex} target="${options.target}" actionIntent="${options.actionIntent}" ` +
          `suggestedFix="Dismiss/extend the session before this step runs, or increase the session timeout"`
        );
      }

      if (replaySteps && replaySteps.length > 0) {
        console.log(`[runtime:session_reset] replaying steps count=${replaySteps.length}`);
        const replayResult = await this.safeReplayContext(replaySteps, options.stepIndex);
        
        if (replayResult.success) {
          console.log(`[runtime:session_reset] replay succeeded: replayedSteps=[${replayResult.replayedSteps.join(", ")}]`);
        } else {
          console.log(`[runtime:session_reset] replay failed: ${replayResult.reason}`);
          throw new Error(
            `session_reset_unrecoverable_replay_failed: Home reset detected but safe replay failed. ` +
            `reason="${replayResult.reason}" currentUrl="${homeReset.currentUrl}" ` +
            `previousStepsCount=${replaySteps.length} stepIndex=${options.stepIndex} ` +
            `target="${options.target}" actionIntent="${options.actionIntent}" ` +
            `suggestedFix="Regenerate spec or increase session timeout"`
          );
        }
      } else {
        throw new Error(
          `session_reset_unrecoverable_missing_replay_callback: Home reset detected but cannot recover context. ` +
          `reason="${homeReset.reason}" currentUrl="${homeReset.currentUrl}" ` +
          `previousStepsCount=${replaySteps?.length || 0} stepIndex=${options.stepIndex} ` +
          `target="${options.target}" actionIntent="${options.actionIntent}" ` +
          `suggestedFix="Regenerate spec with previousStepReplays callbacks or increase session timeout"`
        );
      }
    }

    // Surface snapshot for the LATER post-click comparison only -- deliberately captured only
    // now, after the session diagnostic/replay boundary above has already run. Bounded by the
    // same `actionTimeoutMs` the rest of the runtime uses; a timeout/error yields no snapshot
    // (never a fabricated signature), exactly as the previous silent `.catch(() => undefined)`
    // already tolerated -- only the deadline and the explicit status log are new.
    const beforeSnapshotOutcome = this.config.enabled
      ? await capturePromotedActionSurfaceSnapshotBounded(this.page, options.target, this.config.actionTimeoutMs)
      : undefined;
    if (beforeSnapshotOutcome) {
      console.log(
        `[runtime:before-snapshot] stepIndex=${options.stepIndex} status=${beforeSnapshotOutcome.status}` +
        (beforeSnapshotOutcome.status === "error" ? ` error=${JSON.stringify(beforeSnapshotOutcome.error)}` : ""),
      );
    }
    const beforeActionSnapshot = beforeSnapshotOutcome?.status === "available" ? beforeSnapshotOutcome.snapshot : undefined;

    // STEP 2: Special handling for return_to_list: check if already on list page
    if (options.actionIntent === "return_to_list") {
      const pageDiag = await capturePageDiagnostics(this.page);
      const alreadyOnList = await this.checkIfAlreadyOnListPage(pageDiag);
      
      if (alreadyOnList) {
        console.log(`[runtime:return_to_list] Already on list page, marking as satisfied: currentUrl="${pageDiag.currentUrl}"`);
        return;
      }
    }
    
    if (isOrdinalSelectionActionIntent(options.actionIntent)) {
      await this.ensureContextForOrdinalSelection({
        target: options.target,
        stepIndex: options.stepIndex,
        previousStepReplays: options.previousStepReplays,
        previousSteps: options.previousSteps,
        routeProfile: options.routeProfile
      });
    }

    // STEP 3: Validate screen context before executing context-dependent actions
    try {
      await validateScreenContextForAction(this.page, {
        target: options.target,
        actionIntent: options.actionIntent,
        stepIndex: options.stepIndex,
        expectedOwnerPage: options.expectedOwnerPage,
        lastSelectionStep: options.lastSelectionStep
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("detail_reentry_required")) {
        // Detail re-entry required - attempt replay if callback available
        if (options.lastSelectionReplay) {
          console.log(`[runtime:detail_reentry] Executing lastSelectionReplay callback for step=${options.lastSelectionStep?.stepIndex || 'unknown'} target="${options.lastSelectionStep?.selectedTarget || 'unknown'}"`);
          try {
            await options.lastSelectionReplay();
            console.log(`[runtime:detail_reentry] Replay succeeded, retrying target resolution`);
            // After successful replay, continue with normal flow (don't throw)
          } catch (replayError) {
            console.log(`[runtime:detail_reentry] Replay failed: ${replayError instanceof Error ? replayError.message : String(replayError)}`);
            throw new Error(
              `detail_reentry_replay_failed: Could not re-enter detail page to execute "${options.target}". ` +
              `lastSelectionStep=${options.lastSelectionStep ? `step=${options.lastSelectionStep.stepIndex} target="${options.lastSelectionStep.selectedTarget}"` : "none"} ` +
              `replayError="${replayError instanceof Error ? replayError.message : String(replayError)}" ` +
              `suggestedFix="Ensure the selection step callback is executable and navigates to detail page."`
            );
          }
        } else {
          // No replay callback available - this is a framework limitation
          throw new Error(
            `detail_reentry_required: Expected to be on DetailPage but currently on list page. ` +
            `Target "${options.target}" not visible. ` +
            `currentUrl="${(await capturePageDiagnostics(this.page)).currentUrl}" ` +
            `lastSelectionStep=${options.lastSelectionStep ? `step=${options.lastSelectionStep.stepIndex} target="${options.lastSelectionStep.selectedTarget}"` : "none"} ` +
            `suggestedFix="This is a known framework limitation. The selection step needs an action callback for replay. ` +
            `Please regenerate the spec or manually add the selection step before the primary action in the spec."`
          );
        }
      } else {
        throw error;
      }
    }

    // New diagnostics for native click tracking
    let clickPath: PromotedRuntimeDiagnostics["clickPath"] = "failed";
    let nativeClickAttempted = false;
    let nativeClickSucceeded = false;
    let nativeClickError: string | undefined;
    let callbackAttempted = false;
    let callbackSucceeded = false;
    let callbackError: string | undefined;
    let effectDetected = false;
    let fallbackUsed: PromotedRuntimeDiagnostics["fallbackUsed"] = "none";
    let matchedLocatorStrategy = "unknown";

    // Post-selection detail state verification
    // If previous step was a selection and current step expects detail page, verify we navigated
    if (this.lastSelectionStep && options.actionIntent === "click_primary_action") {
      const selectionDiag = await this.verifyDetailStateAfterSelection(options.target);
      if (!selectionDiag.reachedDetail) {
        throw new Error(
          `selection_did_not_reach_expected_detail_state: After selecting "${this.lastSelectionStep.selectedTarget}", ` +
          `expected to be on detail page but still on list/source page. ` +
          `currentUrl="${selectionDiag.currentUrl}" visibleButtons=[${selectionDiag.visibleButtons.join(", ")}] ` +
          `visibleHeadings=[${selectionDiag.visibleHeadings.join(", ")}] nextStepTarget="${options.target}" ` +
          `nextStepIntent="${options.actionIntent}" expectedOwnerPage="DetailPage" ` +
          `sourcePageSignature="ListPage" destinationPageExpectedSignals=["primary_action_button", "detail_heading"]`
        );
      }
      this.lastSelectionStep = undefined;
    }

    // Guard: Verify target is visible before executing primary action
    // This prevents calling POM methods on wrong page/state
    if (options.actionIntent === "click_primary_action" || options.actionIntent === "expect_primary_action_visible") {
      try {
        // First try exact role/link match
        const targetLocator = this.page.getByRole('button', { name: new RegExp(options.target, 'i') })
          .or(this.page.getByRole('link', { name: new RegExp(options.target, 'i') }));
        let isVisible = await targetLocator.isVisible({ timeout: 5000 }).catch(() => false);
        
        // Semantic fallback if exact match fails
        if (!isVisible) {
          const semanticResult = await findSemanticTargetMatch(this.page, options.target, {
            timeoutMs: 3000,
            actionIntent: "click_primary_action",
            minScore: 0.75,
            preferTypes: ["button", "link"],
            excludeSensitive: false
          });
          
          if (semanticResult.status === "exact" || semanticResult.status === "semantic") {
            isVisible = await semanticResult.candidate!.locator.isVisible().catch(() => false);
          }
        }
        
        if (!isVisible) {
          // Capture page state for diagnostics
          const pageDiag = await capturePageDiagnostics(this.page);
          throw new Error(
            `wrong_screen_before_primary_action: Target "${options.target}" not visible on current page. ` +
            `currentUrl="${pageDiag.currentUrl}" visibleButtons=[${pageDiag.visibleButtons.join(", ")}] ` +
            `visibleHeadings=[${pageDiag.visibleHeadings.join(", ")}] stepIndex=${options.stepIndex} ` +
            `actionIntent="${options.actionIntent}" expectedOwnerPage="DetailPage"`
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("wrong_screen_before_primary_action")) {
          throw error;
        }
        // Continue with normal flow if visibility check fails for other reasons
      }
    }

    const selectionStateProbe = resolvedExpectedEffect === "selection_state_change"
      ? await capturePromotedSelectionStateProbe(this.page, options.target, targetIdentity)
      : undefined;

    // Step 1: Try native runtime click with resolved locator. A selection
    // callback can own both opening the control and choosing the option; in
    // that contract the semantic field label is not itself a clickable target.
    nativeClickAttempted = true;
    const containerSelector = this.activeContainer?.selector;
    let resolved:
      | Awaited<ReturnType<typeof resolvePromotedClickableLocator>>
      | undefined;
    
    try {
      if (options.skipNativeTargetResolution) {
        nativeClickAttempted = false;
        nativeClickError = "selection_callback_owns_target_resolution";
      } else {
      const ordinalResolved = await resolveOrdinalSelectionOnPage(this.page, {
        target: options.target,
        actionIntent: options.actionIntent,
        routeProfile: options.routeProfile,
        expectedTarget: (options as any).expectedTarget,
      });

      if (ordinalResolved) {
        matchedLocatorStrategy = `ordinal_selection:${ordinalResolved.ordinal}:${ordinalResolved.domainTerm ?? "generic"}:${ordinalResolved.selector}`;
        const previousUrlOrdinal = this.page.url();
        try {
          await withTimeout(ordinalResolved.locator.click({ timeout: this.config.actionTimeoutMs, noWaitAfter: true }), this.config.actionTimeoutMs, "ordinal click");
        } catch {
          try {
            await withTimeout(
              ordinalResolved.locator.click({ timeout: this.config.actionTimeoutMs, force: true, noWaitAfter: true }),
              this.config.actionTimeoutMs,
              "ordinal force click"
            );
          } catch (ordinalForceError) {
            try {
              await withTimeout(
                ordinalResolved.locator.evaluate((el: Element) => {
                  (el as HTMLElement).click();
                }),
                this.config.actionTimeoutMs,
                "ordinal dom click"
              );
              nativeClickError = undefined;
            } catch (ordinalDomError) {
              nativeClickError = ordinalDomError instanceof Error ? ordinalDomError.message : String(ordinalDomError);
            }
          }
        }
        if (!nativeClickError) {
          nativeClickSucceeded = true;
          clickPath = "native_runtime";
          fallbackUsed = "page";
          await this.postActionStability(previousUrlOrdinal, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target, selectionStateProbe);
          if (expectedEffect === "modal_or_form_or_navigation" || expectedEffect === "ui_change") {
            await this.refreshActiveContainer();
          }
          effectDetected = true;
          console.log(
            `[ordinal-selection-runtime] ordinal=${ordinalResolved.ordinal} domainTerm=${ordinalResolved.domainTerm ?? "none"} ` +
            `candidateCount=${ordinalResolved.candidateCount} selectedText="${ordinalResolved.text}" selectedLocator="${matchedLocatorStrategy}"`
          );
        }
      }

      if (nativeClickSucceeded) {
        // Ordinal selection handled without semantic matching.
      } else {
      const hasStructuredCheckboxReference = Boolean(
        targetIdentity?.technicalTargetRefs.some((ref) => ref.startsWith("role:checkbox|")),
      );
      const parsedTargetRefs = targetIdentity ? parseTechnicalTargetRefs(targetIdentity.technicalTargetRefs) : {};
      const entityRowScope = rowScopeFromEntityScope(targetIdentity?.entityScope);
      // The recorded structural owner (ownerTag + stable descendants + semanticShape) is the
      // exact authority Recording replay already resolves this same click with — reused here
      // via the same resolveActionTarget -> resolveRecordedTechnicalTarget ->
      // resolveRecordedStructuralOwner chain (src/discovery/target-resolver.ts), never a second
      // implementation. It is tried before every text/role strategy below because it is
      // fail-closed by construction (resolveRecordedStructuralOwner returns undefined on zero
      // or ambiguous matches, never a guess) — unlike getByText/getByRole against `options.target`,
      // which a display label spanning multiple DOM nodes (heading + description concatenated)
      // can never satisfy no matter how long the timeout.
      const recordedStructuralResolution = targetIdentity?.recordedTechnicalTargets?.length
        ? await resolveActionTarget(
          this.page,
          await scanCurrentPage(this.page),
          options.target,
          {
            actionType: "action_click",
            recordingActionType: "click",
            recordedTechnicalTargets: targetIdentity.recordedTechnicalTargets,
          },
        ).catch(() => undefined)
        : undefined;
      const structuredCheckboxResolution = hasStructuredCheckboxReference
        ? await resolveActionTarget(
          this.page,
          await scanCurrentPage(this.page),
          options.target,
          {
            actionType: "action_click",
            recordingActionType: "check",
            rowScope: entityRowScope ?? rowScopeFromPromotedRef(parsedTargetRefs.rowRef),
            rowRef: entityRowScope ? undefined : parsedTargetRefs.rowRef,
            entityScope: targetIdentity?.entityScope,
            rowRelation: targetIdentity?.rowRelation === "added" || targetIdentity?.rowRelation === "next"
              ? targetIdentity.rowRelation
              : undefined,
          },
        ).catch(() => undefined)
        : undefined;
      // Field-scoped fallback retry (runtime_resolution_required clicks only -- see
      // PromotedClickOptions.associatedField doc comment). Reuses the SAME shared resolver
      // (resolveActionTarget -> tryFieldScopedStructuralFallback) Discovery's own live walk
      // already used to pass this step, only attempted when the stronger authorities above
      // didn't resolve. Never certifies/upgrades resolutionState -- a plain retry hint.
      const associatedFieldResolution = !recordedStructuralResolution?.locator
        && !structuredCheckboxResolution?.locator
        && options.associatedField
        ? await resolveActionTarget(
          this.page,
          await scanCurrentPage(this.page),
          options.target,
          {
            actionType: "action_click",
            recordingActionType: "click",
            associatedField: options.associatedField,
          },
        ).catch(() => undefined)
        : undefined;
      // LAST-RESORT, EXECUTION-ONLY: certified/structural/field-scoped tiers above, then semantic
      // runtime evidence, then the generic text/role fallback below. Reuses the SAME shared
      // resolveActionTarget -> resolveSemanticRuntimeTarget chain, never a second implementation.
      // Never certifies/upgrades resolutionState/technicalReady/promotionReady.
      const semanticRuntimeResolution = !recordedStructuralResolution?.locator
        && !structuredCheckboxResolution?.locator
        && !associatedFieldResolution?.locator
        && options.semanticRuntimeEvidence
        ? await resolveActionTarget(
          this.page,
          await scanCurrentPage(this.page),
          options.target,
          {
            actionType: "action_click",
            recordingActionType: "click",
            semanticRuntimeEvidence: options.semanticRuntimeEvidence,
          },
        ).catch(() => undefined)
        : undefined;
      const recorderRuntimeResolution = !recordedStructuralResolution?.locator
        && !structuredCheckboxResolution?.locator
        && !associatedFieldResolution?.locator
        && !semanticRuntimeResolution?.locator
        && options.playwrightRecorderEvidence
        ? await resolveActionTarget(
          this.page,
          await scanCurrentPage(this.page),
          options.target,
          {
            actionType: "action_click",
            recordingActionType: "click",
            playwrightRecorderEvidence: options.playwrightRecorderEvidence,
          },
        ).catch(() => undefined)
        : undefined;
      resolved = recordedStructuralResolution?.status === "resolved" && recordedStructuralResolution.locator
        ? {
          locator: recordedStructuralResolution.locator,
          strategy: recordedStructuralResolution.locatorStrategy ?? "recorded:structural-owner",
          scope: "page" as const,
          visible: true,
          enabled: true,
          clickable: true,
        }
        : structuredCheckboxResolution?.status === "resolved" && structuredCheckboxResolution.locator
        ? {
          locator: structuredCheckboxResolution.locator,
          strategy: structuredCheckboxResolution.locatorStrategy ?? "structured:grid-row-checkbox",
          scope: "page" as const,
          visible: true,
          enabled: true,
          clickable: true,
        }
        : associatedFieldResolution?.status === "resolved" && associatedFieldResolution.locator
        ? {
          locator: associatedFieldResolution.locator,
          strategy: associatedFieldResolution.locatorStrategy ?? "field_scoped_structural_certification",
          scope: "page" as const,
          visible: true,
          enabled: true,
          clickable: true,
        }
        : semanticRuntimeResolution?.status === "resolved" && semanticRuntimeResolution.locator
        ? {
          locator: semanticRuntimeResolution.locator,
          strategy: semanticRuntimeResolution.locatorStrategy ?? "semantic_runtime_evidence",
          scope: "page" as const,
          visible: true,
          enabled: true,
          clickable: true,
        }
        : recorderRuntimeResolution?.status === "resolved" && recorderRuntimeResolution.locator
        ? {
          locator: recorderRuntimeResolution.locator,
          strategy: recorderRuntimeResolution.locatorStrategy ?? "recorded:playwright-recorder",
          scope: "page" as const,
          visible: true,
          enabled: true,
          clickable: true,
        }
        : await resolvePromotedClickableLocator(this.page, options.target, {
          containerLocator: containerSelector,
          targetIdentity,
          timeoutMs: this.config.actionTimeoutMs,
          actionKind: options.actionIntent as "submit" | "link" | "button" | "action",
          actionIntent: options.actionIntent
        });

      if (resolved && resolved.locator) {
        matchedLocatorStrategy = resolved.strategy;
        console.log(`[runtime:click-resolution] step=${options.stepIndex} target="${options.target}" strategy="${resolved.strategy}" scope=${resolved.scope}`);
        
        // Dispatch the click separately from outcome observation. Waiting for Playwright's
        // implicit navigation here can time out on SPA/in-place transitions even though the
        // application received the click.
        const clickResult = await clickPromotedLocatorWithBoundedReresolution(
          resolved,
          async () => resolvePromotedClickableLocator(this.page, options.target, {
            containerLocator: containerSelector,
            targetIdentity,
            timeoutMs: this.config.actionTimeoutMs,
            actionKind: options.actionIntent as "submit" | "link" | "button" | "action",
            actionIntent: options.actionIntent,
          }),
          this.config.actionTimeoutMs,
        );
        if (clickResult.reResolved) matchedLocatorStrategy = `${resolved.strategy}:bounded_reresolution`;
        resolved = { ...resolved, locator: clickResult.locator };
        nativeClickSucceeded = true;
        clickPath = "native_runtime";
        fallbackUsed = resolved.scope === "container" ? "active_container" : "page";
        
        // Handle expected effects
        await this.postActionStability(previousUrl, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target, selectionStateProbe);
        
        // Refresh active container if modal/form/dialog expected
        if (expectedEffect === "modal_or_form_or_navigation" || expectedEffect === "ui_change") {
          await this.refreshActiveContainer();
        }
        
        effectDetected = true;
      }
      }
      }
    } catch (error) {
      if (isOrdinalSelectionActionIntent(options.actionIntent)) {
        nativeClickError = error instanceof Error ? error.message : String(error);
      }
      if (typeof resolved !== "undefined" && resolved?.locator) {
        const canSafeForceClick = await shouldUseSafeForceClick(this.page, resolved.locator, options, error);
        if (canSafeForceClick) {
          try {
            await withTimeout(
              resolved.locator.click({ timeout: this.config.actionTimeoutMs, force: true }),
              this.config.actionTimeoutMs,
              "native safe force click"
            );
            nativeClickSucceeded = true;
            clickPath = "native_runtime";
            fallbackUsed = resolved.scope === "container" ? "active_container" : "page";
            matchedLocatorStrategy = `${resolved.strategy}:safe_force_click`;
            await this.postActionStability(previousUrl, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target, selectionStateProbe);
            if (expectedEffect === "modal_or_form_or_navigation" || expectedEffect === "ui_change") {
              await this.refreshActiveContainer();
            }
            effectDetected = true;
          } catch (forceError) {
            nativeClickError = forceError instanceof Error ? forceError.message : String(forceError);
          }
        } else {
          nativeClickError = error instanceof Error ? error.message : String(error);
        }
      } else {
        nativeClickError = error instanceof Error ? error.message : String(error);
      }
      // Continue to callback fallback
    }

    // Step 2: If native click didn't succeed, try callback POM fallback
    if (!nativeClickSucceeded) {
      callbackAttempted = true;
      try {
        if (resolvedExpectedEffect === "selection_state_change") {
          console.log(`[selection-runtime] phase=before_callback snapshot="${selectionRuntimeSnapshot(selectionStateProbe ? await readPromotedInteractiveState(selectionStateProbe.locator) : undefined)}"`);
        }
        await withTimeout(options.action(), this.config.actionTimeoutMs, "click callback");
        clickPath = "pom_callback";
        fallbackUsed = "callback";
        matchedLocatorStrategy = matchedLocatorStrategy === "unknown" ? "callback" : matchedLocatorStrategy;
        
        // Handle expected effects
        await this.postActionStability(previousUrl, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target, selectionStateProbe);
        if (expectedEffect !== "none") await this.refreshActiveContainer();
        callbackSucceeded = true;
        effectDetected = true;
      } catch (error) {
        callbackError = error instanceof Error ? error.message : String(error);
        console.log(`[runtime:click-callback-failure] step=${options.stepIndex} target="${options.target}" error="${callbackError}"`);
        
        // Retry if enabled and not sensitive
        if (this.config.retryEnabled && !options.sensitive && !retryAttempted) {
          retryAttempted = true;
          try {
            if (resolvedExpectedEffect === "selection_state_change") {
              console.log(`[selection-runtime] phase=before_retry snapshot="${selectionRuntimeSnapshot(selectionStateProbe ? await readPromotedInteractiveState(selectionStateProbe.locator) : undefined)}"`);
            }
            await withTimeout(options.action(), this.config.actionTimeoutMs, "click retry");
            clickPath = "pom_callback";
            await this.postActionStability(previousUrl, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target, selectionStateProbe);
            if (expectedEffect !== "none") await this.refreshActiveContainer();
            callbackSucceeded = true;
            effectDetected = true;
          } catch (retryError) {
            callbackError = `Retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`;
          }
        }
      }
    }

    // Step 3: Error handling with enhanced diagnostics
    if (!nativeClickSucceeded && !callbackSucceeded) {
      const pageDiag = await capturePageDiagnostics(this.page);
      if (isOrdinalSelectionActionIntent(options.actionIntent)) {
        throw new Error(
          `ordinal_selection_no_safe_candidate: target="${options.target}" actionIntent="${options.actionIntent}" ` +
          `currentUrl="${pageDiag.currentUrl}" visibleButtons=[${pageDiag.visibleButtons.join(", ")}] ` +
          `visibleHeadings=[${pageDiag.visibleHeadings.join(", ")}] ` +
          `reason="${nativeClickError || callbackError || "unknown"}"`
        );
      }
      const diagnostics = await captureDiagnosticsIfNeeded(
        this.page,
        {
          currentUrl: this.page.url(),
          actionIntent: options.actionIntent,
          target: options.target,
          stepIndex: options.stepIndex,
          timeoutMs: this.config.actionTimeoutMs,
          activeContainer: this.activeContainer?.descriptor,
          lastDialogMessage: this.lastDialogMessage,
          stability: pageDiag as unknown as Record<string, unknown>,
          retryAttempted,
          // New diagnostics
          clickPath,
          nativeClickAttempted,
          nativeClickSucceeded,
          nativeClickError,
          callbackAttempted,
          callbackSucceeded,
          callbackError,
          expectedEffect,
          effectDetected,
          fallbackUsed,
          matchedLocatorStrategy
        },
        options.evidenceDir,
        this.config.captureDiagnostics
      );
      
      // Check for home reset/inactivity BEFORE throwing generic click error
      // This prevents semantic_target_not_found when the real issue is session timeout
      const homeResetFromDiagnostics = await this.boundedRuntimeBoundary(
        "detect_home_reset_or_inactivity_pre_throw",
        this.config.actionTimeoutMs,
        () => detectHomeResetOrInactivity(this.page, this.config.actionTimeoutMs),
      );
      if (homeResetFromDiagnostics.detected) {
        console.log(`[runtime:session_reset] detected from diagnostics before throw: reason="${homeResetFromDiagnostics.reason}" currentUrl="${homeResetFromDiagnostics.currentUrl}"`);

        // Same classification fix as the earlier guard: a still-open expiry warning is not a
        // context reset, so a recorded-earlier-surface replay target is provably not present
        // here either -- fail closed immediately instead of burning a bounded timeout on it.
        if (homeResetFromDiagnostics.reason === "session_expiring_warning") {
          throw new Error(
            `session_expiring_warning_unrecoverable: Session-expiry warning detected on the current surface (not a context reset); ` +
            `recorded replay targets belong to an earlier surface and are not present here. ` +
            `currentUrl="${homeResetFromDiagnostics.currentUrl}" stepIndex=${options.stepIndex} target="${options.target}" actionIntent="${options.actionIntent}" ` +
            `suggestedFix="Dismiss/extend the session before this step runs, or increase the session timeout"`
          );
        }

        if (replaySteps && replaySteps.length > 0) {
          console.log(`[runtime:session_reset] attempting replay from diagnostics: steps=${replaySteps.length}`);
          const replayResult = await this.safeReplayContext(replaySteps, options.stepIndex);
          
          if (replayResult.success) {
            console.log(`[runtime:session_reset] replay succeeded, retrying target="${options.target}"`);
            // Retry the original action after successful replay
            try {
              if (options.actionIntent === "return_to_list" && options.lastSelectionReplay) {
                await options.lastSelectionReplay();
              }
              await options.action();
              await this.waitForPromotedUiStable(options.stepIndex, options.target);
              return; // Success after replay
            } catch (retryError) {
              // Retry failed, throw original error
            }
          } else {
            console.log(`[runtime:session_reset] replay failed: ${replayResult.reason}`);
          }
        }
        
        // Throw session reset error instead of generic click error
        throw new Error(
          `session_reset_unrecoverable: Home reset detected but recovery failed. ` +
          `reason="${homeResetFromDiagnostics.reason}" currentUrl="${homeResetFromDiagnostics.currentUrl}" ` +
          `stepIndex=${options.stepIndex} target="${options.target}" actionIntent="${options.actionIntent}" ` +
          `previousStepsCount=${replaySteps?.length || 0} ` +
          `suggestedFix="Regenerate spec with previousSteps metadata or increase session timeout"`
        );
      }
      
      await this.captureClickStep(options.target, "failed", `clickPath=${clickPath} native=${nativeClickError || "?"} callback=${callbackError || "?"}`, options.stepIndex);
      // `withTimeout` (Promise.race) never cancels the raced-away promise: when it rejects with
      // its own synthetic "<label> timed out after Nms" error, the underlying options.action()
      // call (e.g. a real Playwright .click()) can still be running, and can still produce a
      // real page effect after we've already given up waiting on it (see [promoted-step]
      // phase=start currentUrl=/product-subcategory... vs phase=failed currentUrl=/ for
      // scenarioStepIndex=4, recording d8dbd8f9-b353-4175-b365-e5f8957bae36). A blanket
      // "click_not_resolved" label would misreport that as "nothing happened" when the URL
      // demonstrably changed. Distinguish what is actually knowable from here: whether OUR
      // wrapper's own timeout fired (vs. options.action() throwing its own real error), and
      // whether the page moved at all in the meantime.
      const finalUrl = this.page.url();
      const failureClass = classifyClickFailure({
        nativeClickAttempted,
        callbackAttempted,
        callbackError,
        nativeClickError,
        urlChangedDuringAction: finalUrl !== previousUrl,
      });
      const exactRuntimeError = callbackError ?? nativeClickError ?? "unknown";
      console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=failed failureClass=${failureClass} currentUrl=${finalUrl}`);
      throw new Error(
        `Promoted click failed at step ${options.stepIndex} target="${options.target}". ` +
        `failureClass=${failureClass} exactRuntimeError=${JSON.stringify(exactRuntimeError)} currentUrl=${finalUrl} ` +
        `clickPath=${clickPath} nativeClickAttempted=${nativeClickAttempted} nativeClickSucceeded=${nativeClickSucceeded} ` +
        `callbackAttempted=${callbackAttempted} callbackSucceeded=${callbackSucceeded} ` +
        `retryAttempted=${String(retryAttempted)} diagnostics=${JSON.stringify(diagnostics)}`
      );
    }

    // Capture evidence after successful click
    await this.captureClickStep(options.target, "passed", undefined, options.stepIndex);
    console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=passed currentUrl=${this.page.url()}`);
  }

  async fillPromotedField(options: PromotedFillOptions): Promise<void> {
    await this.markBoundaryProgress();
    await this.ensureInitialEvidence();
    if (options.playwrightRecorderEvidence?.kind === "segmented_input") {
      await this.fillSegmentedInput(options);
      return;
    }
    const resolvedField = resolvePromotedFieldTarget(options);
    const masked = maskIfSensitive(options.value, options.sensitive);
    const targetIdentity = resolvePromotedFieldIdentityFromPersistedContract(options.stepIndex, resolvedField, {
      valueKey: options.valueKey,
      technicalTargetRefs: options.technicalTargetRefs,
    }) ?? {
      valueKey: options.valueKey,
      technicalTargetRefs: options.technicalTargetRefs ?? [],
      entityScope: options.entityScope,
      targetIdentity: options.targetIdentity,
      surfaceIdentity: options.surfaceIdentity,
      containerIdentity: options.containerIdentity,
      fieldIdentity: options.fieldIdentity,
    };
    if (targetIdentity.technicalTargetRefs.length > 0 || targetIdentity.valueKey) {
      console.log(
        `[runtime:field-resolution] step=${options.stepIndex} field="${resolvedField}" ` +
        `valueKey="${targetIdentity.valueKey ?? "none"}" ` +
        `technicalTargetRefs=${targetIdentity.technicalTargetRefs.join(",") || "none"} ` +
        `surface="${targetIdentity.surfaceIdentity ?? "none"}" ` +
        `container="${targetIdentity.containerIdentity ?? "none"}" ` +
        `fieldIdentity="${targetIdentity.fieldIdentity ?? "none"}"`,
      );
    }
    const previousActiveContainer = this.activeContainer?.descriptor;
    const refresh = await this.refreshActiveContainerForField(resolvedField);
    const refreshedActiveContainer = this.activeContainer?.descriptor;
    const searchedContainers = refresh.candidates.length;
    
    // Validate screen context before executing context-dependent actions
    await validateScreenContextForAction(this.page, {
      target: resolvedField,
      actionIntent: options.actionIntent ?? "fill_form_field",
      stepIndex: options.stepIndex,
      ...(options.authGateExpected ? { authGateExpected: true } : {}),
    });
    const recorderRuntimeResolution = options.playwrightRecorderEvidence
      ? await resolveActionTarget(
        this.page,
        await scanCurrentPage(this.page),
        resolvedField,
        { actionType: "action_fill", recordingActionType: "fill", playwrightRecorderEvidence: options.playwrightRecorderEvidence },
      ).catch(() => undefined)
      : undefined;
    
    // New diagnostics for native fill tracking
    let fillPath: PromotedRuntimeDiagnostics["fillPath"] = "failed";
    let nativeFillAttempted = false;
    let nativeFillSucceeded = false;
    let nativeFillError: string | undefined;
    let callbackAttempted = false;
    let callbackSucceeded = false;
    let callbackError: string | undefined;
    let verificationAttempted = false;
    let verificationSucceeded = false;
    let verificationSkippedReason: string | undefined;
    
    let fallbackUsed: PromotedRuntimeDiagnostics["fallbackUsed"] = "none";
    let matchedLocatorStrategy = "unknown";

    // Step 1: Try native runtime fill with resolved locator
    if (recorderRuntimeResolution?.status === "resolved" || (refresh.best && refresh.best.matchingFieldFound) || targetIdentity.technicalTargetRefs.length > 0) {
      nativeFillAttempted = true;
      const containerSelector = refresh.best?.selector;
      
      try {
          const parsedTargetRefs = parseTechnicalTargetRefs(targetIdentity.technicalTargetRefs);
          const entityRowScope = rowScopeFromEntityScope(targetIdentity.entityScope);
          const structuralResolution = (entityRowScope || parsedTargetRefs.rowRef)
            ? await resolveActionTarget(
              this.page,
              await scanCurrentPage(this.page),
              resolvedField,
              {
                actionType: "action_fill",
                recordingActionType: "fill",
                rowScope: entityRowScope ?? rowScopeFromPromotedRef(parsedTargetRefs.rowRef),
                rowRef: entityRowScope ? undefined : parsedTargetRefs.rowRef,
                entityScope: targetIdentity.entityScope,
                associatedField: resolvedField,
              },
            ).catch(() => undefined)
            : undefined;
          const resolved = recorderRuntimeResolution?.status === "resolved" && recorderRuntimeResolution.locator
            ? {
              locator: recorderRuntimeResolution.locator,
              strategy: recorderRuntimeResolution.locatorStrategy ?? "recorded:playwright-recorder",
              scope: "page" as const,
              visible: true,
              enabled: true,
              editable: true,
            }
            : structuralResolution?.status === "resolved" && structuralResolution.locator
            ? {
              locator: structuralResolution.locator,
              strategy: structuralResolution.locatorStrategy ?? "structured:grid-cell-editor",
              scope: "page" as const,
              visible: true,
              enabled: true,
              editable: true,
            }
            : await resolvePromotedFieldLocator(this.page, resolvedField, {
              containerLocator: refresh.best ? containerSelector : undefined,
              targetIdentity,
              timeoutMs: this.config.actionTimeoutMs
            });

        if (resolved && resolved.locator) {
          matchedLocatorStrategy = resolved.strategy;
          
          // Fill with options.value (the hydrated value)
          await withTimeout(resolved.locator.fill(options.value), this.config.actionTimeoutMs, "native fill");
          nativeFillSucceeded = true;
          const fieldHasValueAfterFill = await resolved.locator.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => Boolean(element.value)).catch(() => false);
          const targetVisible = await resolved.locator.isVisible().catch(() => false);
          const targetEnabled = targetVisible && !(await resolved.locator.isDisabled().catch(() => true));
          const targetEditable = targetVisible && await resolved.locator.isEditable().catch(() => false);
          console.log(`[promoted-fill-state] stepIndex=${options.stepIndex} targetResolved=true valueResolved=${options.value !== undefined} valueNonEmpty=${Boolean(options.value)} fieldHasValueAfterFill=${fieldHasValueAfterFill} targetVisible=${targetVisible} targetEnabled=${targetEnabled} targetEditable=${targetEditable}`);
          fillPath = "native_runtime";
          fallbackUsed = resolved.scope === "container" ? "active_container" : "page";
          
          // Verify fill when safe (non-sensitive)
          if (!options.sensitive) {
            verificationAttempted = true;
            try {
              const filledValue = await resolved.locator.inputValue({ timeout: 2000 });
              if (filledValue === options.value) {
                verificationSucceeded = true;
              } else {
                verificationSkippedReason = "value_mismatch";
              }
            } catch {
              verificationSkippedReason = "verification_unavailable";
            }
          } else {
            verificationSkippedReason = "sensitive_value";
          }
        }
      } catch (error) {
        nativeFillError = error instanceof Error ? error.message : String(error);
        // Continue to callback fallback
      }
    }

    // Step 2: If native fill didn't succeed, try callback POM fallback
    if (!nativeFillSucceeded) {
      callbackAttempted = true;
      if (options.ensureEditable) {
        try {
          await withTimeout(options.ensureEditable(), this.config.actionTimeoutMs, "fill editable check");
        } catch (error) {
          callbackError = `Editable check failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      if (!callbackSucceeded && callbackError === undefined) {
        if (this.activeContainer && options.fillInActiveContainer) {
          try {
            await withTimeout(options.fillInActiveContainer(), this.config.actionTimeoutMs, "fill active container");
            callbackSucceeded = true;
            fillPath = "pom_callback";
            fallbackUsed = previousActiveContainer === refreshedActiveContainer ? "active_container" : "refreshed_container";
            matchedLocatorStrategy = matchedLocatorStrategy === "unknown" ? "active_container" : matchedLocatorStrategy;
          } catch (error) {
            callbackError = `Active container fill failed: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      }
      if (!callbackSucceeded && callbackError === undefined) {
        if (options.fillInPage) {
          try {
            await withTimeout(options.fillInPage(), this.config.actionTimeoutMs, "fill page fallback");
            callbackSucceeded = true;
            fillPath = "pom_callback";
            fallbackUsed = "page";
            matchedLocatorStrategy = matchedLocatorStrategy === "unknown" ? "page_fallback" : matchedLocatorStrategy;
          } catch (error) {
            callbackError = `Page fill failed: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      }
      if (!callbackSucceeded && callbackError === undefined && options.fill) {
        try {
          await withTimeout(options.fill(), this.config.actionTimeoutMs, "fill action");
          callbackSucceeded = true;
          fillPath = "pom_callback";
          fallbackUsed = "page";
          matchedLocatorStrategy = matchedLocatorStrategy === "unknown" ? "fill_callback" : matchedLocatorStrategy;
        } catch (error) {
          callbackError = `Fill callback failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      if (!callbackSucceeded && callbackError === undefined) {
        callbackError = "No fill callback available";
      }
    }

    // Commit dynamic editors before the next action.  Grid cells commonly keep
    // the last value in a focused editor until blur, which can leave a valid
    // action button disabled even though the DOM displays the hydrated value.
    // This is intentionally generic: it does not identify or hardcode a field.
    try {
      const focusedEditor = this.page.locator(":focus");
      if (await focusedEditor.count() === 1) {
        await focusedEditor.blur({ timeout: this.config.actionTimeoutMs });
      }
    } catch {
      // Blur is a best-effort commit signal; fill success remains authoritative.
    }

    // Step 3: Wait for UI stability
    try {
      await this.waitForPromotedUiStable(options.stepIndex, resolvedField);
    } catch (error) {
      // Don't fail the fill, but log it
      verificationSkippedReason = "stability_check_failed";
    }

    // Step 4: Error handling with enhanced diagnostics
    if (!nativeFillSucceeded && !callbackSucceeded) {
      const diagnostics = await captureDiagnosticsIfNeeded(
        this.page,
        {
          currentUrl: this.page.url(),
          actionIntent: "fill",
          target: resolvedField,
          stepIndex: options.stepIndex,
          timeoutMs: this.config.actionTimeoutMs,
          activeContainer: this.activeContainer?.descriptor,
          lastDialogMessage: this.lastDialogMessage,
          retryAttempted: false,
          previousActiveContainer: previousActiveContainer ?? "none",
          refreshedActiveContainer: refreshedActiveContainer ?? "none",
          matchingFieldFound: refresh.best?.matchingFieldFound ?? false,
          fallbackUsed,
          searchedContainers,
          discardedReason: this.activeContainerDiscardReason ?? "none",
          matchedLocatorStrategy,
          valueKey: targetIdentity.valueKey,
          technicalTargetRefs: targetIdentity.technicalTargetRefs,
          targetIdentity: targetIdentity.targetIdentity,
          surfaceIdentity: targetIdentity.surfaceIdentity,
          containerIdentity: targetIdentity.containerIdentity,
          fieldIdentity: targetIdentity.fieldIdentity,
          fieldCandidateCount: refresh.candidates.reduce((count, candidate) => count + candidate.editableCount, 0),
          // New diagnostics
          fillPath,
          nativeFillAttempted,
          nativeFillSucceeded,
          nativeFillError,
          callbackAttempted,
          callbackSucceeded,
          callbackError,
          verificationAttempted,
          verificationSucceeded,
          verificationSkippedReason
        },
        options.evidenceDir,
        this.config.captureDiagnostics
      );
      throw new Error(
        `Promoted fill failed at step ${options.stepIndex} field="${resolvedField}" value="${masked}". ` +
        `fillPath=${fillPath} nativeFillAttempted=${nativeFillAttempted} nativeFillSucceeded=${nativeFillSucceeded} ` +
        `callbackAttempted=${callbackAttempted} callbackSucceeded=${callbackSucceeded} ` +
        `diagnostics=${JSON.stringify(diagnostics)}`
      );
    }
  }

  /** Execute one recorder-captured segmented component after revalidating its unique scope and
   * exact homogeneous segment count. Segment order is the component contract, never a locator
   * authority; no positional selector is emitted or persisted. */
  async fillSegmentedInput(options: PromotedFillOptions): Promise<void> {
    const evidence = options.playwrightRecorderEvidence;
    const segmentCount = evidence?.segmentCount;
    const scopeIdentity = evidence?.scopeIdentity;
    if (!evidence || evidence.kind !== "segmented_input" || !segmentCount || segmentCount < 2 || !scopeIdentity) {
      throw new Error(`segmented_input_evidence_incomplete: stepIndex=${options.stepIndex}`);
    }
    if (options.value.length !== segmentCount) {
      throw new Error(`segmented_input_segment_count_mismatch: stepIndex=${options.stepIndex}`);
    }
    await validateScreenContextForAction(this.page, {
      target: options.target,
      actionIntent: options.actionIntent ?? "fill_form_field",
      stepIndex: options.stepIndex,
    });
    const scope = recordedLocatorFactory(this.page, {
      strategy: "css",
      value: scopeIdentity.strategy === "css"
        ? scopeIdentity.value
        : scopeIdentity.strategy === "id"
          ? `[id="${scopeIdentity.value.replace(/"/g, "\\\"")}"]`
          : `[data-testid="${scopeIdentity.value.replace(/"/g, "\\\"")}"]`,
      confidence: 1,
    }, true);
    if (!scope || await scope.count() !== 1) throw new Error(`segmented_input_scope_not_unique: stepIndex=${options.stepIndex}`);
    // FIRST_LOSS fix (jobId 722cf70a-...): the scope for a segmented token also contains its own
    // Continuar submit button (input type=submit), which the bare "input" selector matched too --
    // confirmed against a real page (6 real input[type=text] boxes + 1 input[type=submit]
    // Continuar in the same recorded scope), inflating the count past segmentCount even though
    // every real digit box resolved correctly. Segment boxes are always text-entry controls.
    const segments = await scope.locator('input:not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]),textarea,[contenteditable="true"],[role="textbox"]').all();
    if (segments.length !== segmentCount) throw new Error(`segmented_input_segment_count_mismatch: stepIndex=${options.stepIndex}`);
    for (const segment of segments) {
      if (!(await segment.isVisible()) || await segment.isDisabled() || !(await segment.isEditable())) {
        throw new Error(`segmented_input_segment_not_actionable: stepIndex=${options.stepIndex}`);
      }
    }
    for (let index = 0; index < segments.length; index += 1) {
      await segments[index].fill(options.value[index]);
    }
    console.log(`[promoted-segmented-input] stepIndex=${options.stepIndex} segmentCount=${segmentCount} valueKey=${options.valueKey ?? "none"}`);
  }

  /**
   * FIRST_LOSS fix (jobId 210649bd-ee18-4259-9ed7-b5af2f90d873): no runtime method existed for a
   * target-scoped keyboard press at all, so a candidate given `operation=press` had no matching
   * API and substituted `clickPromotedTarget` -- clicking a locator built from the KEY text
   * ("Enter") rather than pressing that key on the recorded target. This method reuses the SAME
   * field-scoped target resolution `fillPromotedField` uses (the recorded target here, a
   * textbox, is a field -- not a button/link, so the click-oriented resolver's aliasing is the
   * wrong fit) and the SAME shared `postActionStability` every other action already uses. It
   * dispatches `resolvedTarget.press(key)` exclusively -- never `.click()`, never a
   * `page.keyboard` fallback, and never treats the key as a locator.
   */
  async pressPromotedTarget(options: PromotedPressOptions): Promise<void> {
    console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=start currentUrl=${this.page.url()}`);
    await this.markBoundaryProgress();
    await this.ensureInitialEvidence();
    const resolvedField = resolvePromotedFieldTarget(options);
    const previousUrl = this.page.url();
    const targetIdentity = resolvePromotedFieldIdentityFromPersistedContract(options.stepIndex, resolvedField, {
      valueKey: options.valueKey,
      technicalTargetRefs: options.technicalTargetRefs,
    }) ?? {
      valueKey: options.valueKey,
      technicalTargetRefs: options.technicalTargetRefs ?? [],
    };
    await validateScreenContextForAction(this.page, {
      target: resolvedField,
      actionIntent: options.actionIntent ?? "press_key",
      stepIndex: options.stepIndex,
    });

    // FIRST_LOSS fix: a target already serialized in the recorded `strategy:value` convention
    // (structural authority) must never be degraded into a fuzzy human-field-label search --
    // resolved through the SAME shared locator factory Recording's own successful resolution
    // already uses, and fails closed here (never falls through to the fuzzy path) if it does not
    // resolve to exactly one visible, enabled candidate.
    // Diagnostic instrumentation only (jobId 8069c3da-2aca-4987-a33a-5d408a0e023a): no
    // resolution/retry/candidate-list/parser behavior changed -- phase-by-phase tracing plus an
    // exception log-and-rethrow, added because the prior single [promoted-press-resolution] log
    // never printed at all in a real failing run, so the failure point had to be narrowed further
    // than the existing instrumentation could show.
    console.log(`[promoted-press-trace] phase=method_entry step=${options.stepIndex} currentUrl=${this.page.url()}`);
    let serialized: ReturnType<typeof parseSerializedTechnicalTargetString>;
    let structuralLocator: ReturnType<typeof recordedLocatorFactory>;
    let matchCount = 0;
    try {
      console.log(`[promoted-press-trace] phase=before_parse step=${options.stepIndex} currentUrl=${this.page.url()}`);
      serialized = parseSerializedTechnicalTargetString(resolvedField);
      console.log(`[promoted-press-trace] phase=after_parse step=${options.stepIndex} strategy=${serialized?.strategy ?? "n/a"} currentUrl=${this.page.url()}`);
      if (serialized) {
        const exactUsed = false;
        console.log(`[promoted-press-trace] phase=before_factory step=${options.stepIndex} strategy=${serialized.strategy} exact=${exactUsed} currentUrl=${this.page.url()}`);
        structuralLocator = recordedLocatorFactory(this.page, serialized, exactUsed);
        console.log(`[promoted-press-trace] phase=after_factory step=${options.stepIndex} strategy=${serialized.strategy} exact=${exactUsed} currentUrl=${this.page.url()}`);
        console.log(`[promoted-press-trace] phase=before_count step=${options.stepIndex} strategy=${serialized.strategy} exact=${exactUsed} currentUrl=${this.page.url()}`);
        matchCount = structuralLocator ? await structuralLocator.count().catch(() => 0) : 0;
        console.log(`[promoted-press-trace] phase=after_count step=${options.stepIndex} strategy=${serialized.strategy} exact=${exactUsed} matchCount=${matchCount} currentUrl=${this.page.url()}`);
      }
    } catch (error) {
      console.log(
        `[promoted-press-trace] phase=exception step=${options.stepIndex} failedPhase=parse_or_factory_or_count ` +
        `errorName=${error instanceof Error ? error.name : typeof error} ` +
        `errorMessage=${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
    if (serialized) {
      const exactUsed = false;
      const parsedRoleOrTag = serialized.strategy === "role" ? serialized.value.split("|")[0]?.trim() : undefined;
      console.log(
        `[promoted-press-resolution] step=${options.stepIndex} parsedStrategy=${serialized.strategy} ` +
        `parsedRole=${parsedRoleOrTag ?? "n/a"} exact=${exactUsed} matchCount=${matchCount} currentUrl=${this.page.url()}`
      );
      if (matchCount !== 1) {
        const reason = matchCount === 0 ? "target_not_resolved" : "target_ambiguous";
        console.log(`[promoted-press-resolution] step=${options.stepIndex} result=failed reason=${reason} matchCount=${matchCount}`);
        throw new Error(
          `Promoted press failed at step ${options.stepIndex} target="${options.target}" key="${options.key}". ` +
          `reason=${reason} matchCount=${matchCount} strategy="${serialized.strategy}"`
        );
      }
      const visible = await structuralLocator!.isVisible({ timeout: this.config.actionTimeoutMs }).catch(() => false);
      const enabled = visible && !(await structuralLocator!.isDisabled({ timeout: this.config.actionTimeoutMs }).catch(() => true));
      console.log(`[promoted-press-resolution] step=${options.stepIndex} phase=visibility_check visible=${visible} enabled=${enabled}`);
      if (!visible || !enabled) {
        const reason = !visible ? "target_not_visible" : "target_not_enabled";
        console.log(`[promoted-press-resolution] step=${options.stepIndex} result=failed reason=${reason} visible=${visible} enabled=${enabled}`);
        throw new Error(
          `Promoted press failed at step ${options.stepIndex} target="${options.target}" key="${options.key}". ` +
          `reason=${reason} visible=${visible} enabled=${enabled} strategy="${serialized.strategy}"`
        );
      }
      console.log(`[runtime:press-resolution] step=${options.stepIndex} target="${options.target}" key="${options.key}" strategy="recorded:${serialized.strategy}" scope=page`);
      const targetEditable = await structuralLocator!.isEditable().catch(() => false);
      const targetHasValueBeforePress = await structuralLocator!.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => Boolean(element.value)).catch(() => false);
      const activeElementMatchesTargetBeforePress = await structuralLocator!.evaluate((element: Element) => document.activeElement === element).catch(() => false);
      console.log(`[promoted-press-dispatch] stepIndex=${options.stepIndex} targetResolved=true targetVisible=${visible} targetEnabled=${enabled} targetEditable=${targetEditable} targetHasValueBeforePress=${targetHasValueBeforePress} activeElementMatchesTargetBeforePress=${activeElementMatchesTargetBeforePress} dispatchMethod=locator.press dispatchStarted=true`);
      try {
        await pressPromotedLocatorWithBoundedReresolution(
          { locator: structuralLocator },
          async () => {
            const fresh = recordedLocatorFactory(this.page, serialized);
            return fresh && (await fresh.count().catch(() => 0)) === 1 ? { locator: fresh } : undefined;
          },
          this.config.actionTimeoutMs,
          options.key,
        );
      } catch (error) {
        throw new Error(
          `Promoted press failed at step ${options.stepIndex} target="${options.target}" key="${options.key}". ` +
          `reason=press_dispatch_failed error="${error instanceof Error ? error.message : String(error)}"`
        );
      }
      await this.waitForPromotedPressTransition(previousUrl, options.expectedEffect ?? "ui_change", targetIdentity, options.target);
      return;
    }

    const resolved = await resolvePromotedFieldLocator(this.page, resolvedField, {
      targetIdentity,
      technicalTargetRefs: options.technicalTargetRefs,
      timeoutMs: this.config.actionTimeoutMs,
    });
    if (!resolved || !resolved.locator) {
      throw new Error(
        `Promoted press failed at step ${options.stepIndex} target="${options.target}" key="${options.key}". ` +
        `reason=target_not_resolved`
      );
    }
    console.log(`[runtime:press-resolution] step=${options.stepIndex} target="${options.target}" key="${options.key}" strategy="${resolved.strategy}" scope=${resolved.scope}`);
    try {
      await pressPromotedLocatorWithBoundedReresolution(
        resolved,
        () => resolvePromotedFieldLocator(this.page, resolvedField, {
          targetIdentity,
          technicalTargetRefs: options.technicalTargetRefs,
          timeoutMs: this.config.actionTimeoutMs,
        }),
        this.config.actionTimeoutMs,
        options.key,
      );
    } catch (error) {
      throw new Error(
        `Promoted press failed at step ${options.stepIndex} target="${options.target}" key="${options.key}". ` +
        `reason=press_dispatch_failed error="${error instanceof Error ? error.message : String(error)}"`
      );
    }
    await this.waitForPromotedPressTransition(previousUrl, options.expectedEffect ?? "ui_change", targetIdentity, options.target);
  }

  async selectPromotedItem(options: PromotedActionOptions): Promise<void> {
    // Track selection step for post-selection detail verification
    this.lastSelectionStep = {
      selectedTarget: options.target,
      stepIndex: options.stepIndex,
      timestamp: Date.now()
    };

    await this.markBoundaryProgress();
    await this.ensureInitialEvidence();
    const targetIdentity = resolvePromotedFieldIdentityFromPersistedContract(options.stepIndex, options.target, {
      valueKey: options.valueKey,
      technicalTargetRefs: options.technicalTargetRefs,
    });
    const runtimeValue = resolvePromotedRuntimeValue(targetIdentity?.valueKey ?? options.valueKey);
    const targetRefs = targetIdentity?.technicalTargetRefs ?? [];
    const parsedTargetRefs = parseTechnicalTargetRefs(targetRefs);
    if (
      targetIdentity
      && runtimeValue
      && (parsedTargetRefs.semanticRole === "selection" || targetIdentity.semanticType === "selection")
    ) {
      const previousUrl = this.page.url();
      let option = await resolvePromotedSelectionOption(this.page, runtimeValue, this.config.actionTimeoutMs);
      let openerStrategy = "already-open";
      if (!option) {
        const opener = await resolvePromotedClickableLocator(this.page, options.target, {
          targetIdentity,
          timeoutMs: this.config.actionTimeoutMs,
          actionKind: "button",
          actionIntent: "select",
        });
        if (!opener?.locator) {
          throw new Error(
            `structured_selection_control_unresolved: stepIndex=${options.stepIndex} `
            + `target="${options.target}" valueKey="${targetIdentity.valueKey ?? "none"}"`,
          );
        }
        openerStrategy = opener.strategy;
        await withTimeout(opener.locator.click({ timeout: this.config.actionTimeoutMs }), this.config.actionTimeoutMs, "structured selection opener");
        const waitCandidates = [
          this.page.getByRole("option", { name: runtimeValue, exact: true }),
          this.page.getByText(runtimeValue, { exact: true }),
        ];
        for (const waitCandidate of waitCandidates) {
          await waitCandidate.waitFor({ state: "visible", timeout: this.config.actionTimeoutMs }).catch(() => undefined);
        }
        option = await resolvePromotedSelectionOption(this.page, runtimeValue, this.config.actionTimeoutMs);
      }
      if (!option) {
        // Reuse the canonical structured resolver for keyboard/typeahead
        // selections whose option surface is not present in the DOM. The
        // generated callback remains out of authority for this path.
        const selectionField = semanticNameFromRef(parsedTargetRefs.headerRef)
          ?? semanticNameFromRef(parsedTargetRefs.cellRef)
          ?? options.target;
        const structuredResolution = await resolveActionTarget(
          this.page,
          await scanCurrentPage(this.page),
          options.target,
          {
            actionType: "action_select",
            recordingActionType: "select",
            selectionField,
            selectionValue: runtimeValue,
            rowScope: rowScopeFromPromotedRef(parsedTargetRefs.rowRef),
            rowRef: parsedTargetRefs.rowRef,
            entityScope: targetIdentity.entityScope,
            associatedField: selectionField,
          },
        ).catch(() => undefined);
        if (structuredResolution?.status === "resolved" && structuredResolution.selectionApplied) {
          await this.postActionStability(previousUrl, "none");
          console.log(
            `[runtime:selection-resolution] step=${options.stepIndex} target="${options.target}" `
            + `valueKey="${targetIdentity.valueKey ?? "none"}" `
            + `openerStrategy="${openerStrategy}" `
            + `optionStrategy="${structuredResolution.locatorStrategy ?? "selection_keyboard_typeahead"}" `
            + `callbackSuppressed=true`,
          );
          await this.captureClickStep(options.target, "passed", undefined, options.stepIndex);
          return;
        }
        throw new Error(
          `structured_selection_option_unresolved: stepIndex=${options.stepIndex} `
          + `target="${options.target}" valueKey="${targetIdentity.valueKey ?? "none"}"`,
        );
      }
      await withTimeout(option.locator.click({ timeout: this.config.actionTimeoutMs }), this.config.actionTimeoutMs, "structured selection option");
      await this.postActionStability(previousUrl, "none");
      console.log(
        `[runtime:selection-resolution] step=${options.stepIndex} target="${options.target}" `
        + `valueKey="${targetIdentity.valueKey ?? "none"}" openerStrategy="${openerStrategy}" `
        + `optionStrategy="${option.strategy}" callbackSuppressed=true`,
      );
      await this.captureClickStep(options.target, "passed", undefined, options.stepIndex);
      return;
    }

    await this.clickPromotedTarget({
      ...options,
      actionIntent: "select",
      expectedEffect: options.expectedEffect ?? "none",
      skipNativeTargetResolution: true,
    });
  }

  async expectPromotedVisible(options: PromotedAssertOptions): Promise<void> {
    console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=start currentUrl=${this.page.url()}`);
    this.authBoundary.oracleEvaluationStarted = true;
    await this.ensureInitialEvidence();
    const stepText = options.description?.trim() || `Validar que se muestre "${options.target}".`;
    try {
      if (options.polarity !== "positive" && options.polarity !== "negative") {
        throw new Error("PROMOTED_ASSERTION_POLARITY_UNRESOLVED");
      }
      if (options.polarity === "negative" && !options.expectedUrl) {
        throw new Error("PROMOTED_ASSERTION_DESCRIPTOR_UNRESOLVED");
      }
      if (options.expectedUrl) {
        const stateMatches = evaluatePromotedAssertionState(this.page.url(), options);
        if (!stateMatches) throw new Error("PROMOTED_ASSERTION_STATE_MISMATCH");
      } else {
        await withTimeout(options.assertion(), this.config.actionTimeoutMs, "assert visible");
      }
      await this.captureEvidenceStep(stepText, "passed", undefined, {
        sourceStepIndex: options.stepIndex,
        target: options.target
      });
      console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=passed currentUrl=${this.page.url()}`);
    } catch (error) {
      await this.captureEvidenceStep(stepText, "failed", error instanceof Error ? error.message : String(error), {
        sourceStepIndex: options.stepIndex,
        target: options.target
      });
      console.log(`[promoted-step] stepIndex=${options.stepIndex} phase=failed failureClass=assertion_not_satisfied currentUrl=${this.page.url()}`);
      const diagnostics = await captureDiagnosticsIfNeeded(
        this.page,
        {
          currentUrl: this.page.url(),
          actionIntent: "assertVisible",
          target: options.target,
          stepIndex: options.stepIndex,
          timeoutMs: this.config.actionTimeoutMs,
          activeContainer: this.activeContainer?.descriptor,
          lastDialogMessage: this.lastDialogMessage,
          retryAttempted: false
        },
        options.evidenceDir,
        this.config.captureDiagnostics
      );
      throw new Error(
        `Promoted assertion failed at step ${options.stepIndex} target="${options.target}". diagnostics=${JSON.stringify(diagnostics)} cause=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async verifyDetailStateAfterSelection(nextTarget: string): Promise<{
    reachedDetail: boolean;
    currentUrl: string;
    visibleButtons: string[];
    visibleHeadings: string[];
  }> {
    // Wait for potential navigation after selection
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(1000);
    
    const pageDiag = await capturePageDiagnostics(this.page);
    
    // Check if we're still on a list/subcategory page
    const listPageIndicators = [
      /selecciona/i, /elige/i, /select/i, /choose/i,
      /listado/i, /lista/i, /list/i,
      /subcategoria/i, /subcategory/i
    ];
    
    const isStillOnListPage = pageDiag.visibleHeadings.some(h => listPageIndicators.some(r => r.test(h)));
    
    // Check if primary action button is visible (detail page indicator)
    const primaryActionVisible = pageDiag.visibleButtons.some(b => 
      b.toLowerCase().includes(nextTarget.toLowerCase())
    );
    
    // Check for detail page indicators
    const detailIndicators = [
      /detalle/i, /detail/i, /resumen/i, /summary/i,
      /información/i, /information/i, /datos/i
    ];
    
    const hasDetailHeading = pageDiag.visibleHeadings.some(h => detailIndicators.some(r => r.test(h)));
    
    // Consider it reached detail if:
    // 1. Primary action is visible, OR
    // 2. Has detail heading AND not on list page
    const reachedDetail = primaryActionVisible || (hasDetailHeading && !isStillOnListPage);
    
    return {
      reachedDetail,
      currentUrl: pageDiag.currentUrl,
      visibleButtons: pageDiag.visibleButtons,
      visibleHeadings: pageDiag.visibleHeadings
    };
  }

  private async waitForPromotedPressTransition(
    previousUrl: string,
    expectedEffect: PromotedExpectedEffect,
    targetIdentity: PromotedFieldTargetIdentity | undefined,
    target: string,
  ): Promise<void> {
    if (!this.config.enabled || expectedEffect === "none") return;
    const before = await capturePromotedActionSurfaceSnapshot(this.page, target).catch(() => undefined);
    // FIRST_LOSS fix (jobId e9a6c64b-2da2-4643-a855-6ea29e09a916): with no explicit
    // expectedRouteTransition/expectedInPlaceTransition on targetIdentity, the previous
    // completionProbe treated ANY observable DOM mutation (routeChanged || domTransitionObserved
    // || targetDisappeared) as authoritative "press completed" -- a transient, non-navigational
    // change (a loading spinner, a disabled-state toggle, a blur) satisfied it long before a real
    // async navigation actually finished. An explicit expectation still gets its own
    // outcome-specific completionProbe (completion authority, unchanged); with no explicit
    // expectation, this now falls through to the shared wait's own generic/adaptive stability
    // check instead -- no completionProbe is passed, so a bare DOM mutation can never be treated
    // as authoritative on its own (same generic mode already used elsewhere, e.g.
    // execution-plan-executor.ts's own post-navigate/post-press stabilization calls).
    const hasExplicitExpectation = targetIdentity?.expectedRouteTransition === true
      || targetIdentity?.expectedInPlaceTransition === true;
    console.log(
      `[promoted-press-wait] completionProbeCreated=${hasExplicitExpectation} sharedWaitCall=true ` +
      `explicitExpectation=${hasExplicitExpectation}`,
    );
    let outcomeObserved = false;
    const stability = hasExplicitExpectation
      ? await waitForStableInteractiveScreen(this.page, {
          completionProbe: async () => {
            const current = await capturePromotedActionSurfaceSnapshot(this.page, target).catch(() => undefined);
            if (!current) return { completed: false };
            const routeChanged = current.url !== previousUrl;
            const domTransitionObserved = Boolean(before && before.signature !== current.signature);
            outcomeObserved = targetIdentity!.expectedRouteTransition === true ? routeChanged : domTransitionObserved;
            return {
              completed: outcomeObserved,
              signal: routeChanged ? "route_changed" : domTransitionObserved ? "dom_transition" : undefined,
            };
          },
        })
      : await waitForStableInteractiveScreen(this.page);
    if (hasExplicitExpectation) {
      if (stability.stable && outcomeObserved) return;
      const reason = targetIdentity?.expectedRouteTransition === true
        ? "expected_route_transition_not_observed"
        : "expected_in_place_transition_not_observed";
      throw new Error(
        `Post-click stability check failed. expectedEffect=${expectedEffect} reason=${reason} ` +
        `target="${target}" previousUrl="${previousUrl}" currentUrl="${this.page.url()}"`,
      );
    }
    if (stability.stable) return;
    throw new Error(
      `Post-click stability check failed. expectedEffect=${expectedEffect} reason=no_observable_post_action_outcome ` +
      `target="${target}" previousUrl="${previousUrl}" currentUrl="${this.page.url()}"`,
    );
  }

  private async postActionStability(
    previousUrl: string,
    expectedEffect: PromotedExpectedEffect,
    targetIdentity?: PromotedFieldTargetIdentity,
    beforeSnapshot?: PromotedActionSurfaceSnapshot,
    target?: string,
    selectionStateProbe?: PromotedSelectionStateProbe,
  ): Promise<void> {
    if (!this.config.enabled) return;
    if (expectedEffect === "none") return;
    // Same-surface selection/toggle completion authority: a causal transition on the CURRENT
    // action's own already-resolved target, never the generic route/DOM-mutation checks below.
    // Reuses the SAME field resolver every other promoted action already goes through -- never a
    // second resolver -- and the SAME `hasCausalSelectionTransition` CORE Discovery uses.
    const selectionProbe = expectedEffect === "selection_state_change"
      ? selectionStateProbe ?? await capturePromotedSelectionStateProbe(this.page, target ?? "", targetIdentity)
      : undefined;
    const selectionBefore = selectionProbe?.before;
    const before = beforeSnapshot ?? await capturePromotedActionSurfaceSnapshot(this.page, target ?? "").catch(() => undefined);
    const startedAt = Date.now();
    let lastOutcome: PromotedActionOutcome | undefined;
    let selectionObservationLogged = false;
    while (Date.now() - startedAt < this.config.stabilityTimeoutMs) {
      if (expectedEffect === "selection_state_change") {
        const selectionAfter = selectionProbe ? await readPromotedInteractiveState(selectionProbe.locator) : undefined;
        const transitionDetected = hasCausalSelectionTransition(selectionBefore, selectionAfter);
        if (!selectionObservationLogged) {
          selectionObservationLogged = true;
          console.log(
            `[selection-runtime] phase=after_dispatch probeAvailable=${Boolean(selectionProbe)} ` +
            `before="${selectionRuntimeSnapshot(selectionBefore)}" ` +
            `snapshot="${selectionRuntimeSnapshot(selectionAfter)}" transitionDetected=${transitionDetected}`,
          );
        }
        if (transitionDetected) {
          console.log(`[runtime:post-action] target="${target ?? "unknown"}" expectedEffect=selection_state_change signal=target_selection_state_changed`);
          return;
        }
        await this.page.waitForTimeout(100);
        continue;
      }
      const current = await capturePromotedActionSurfaceSnapshot(this.page, target ?? "").catch(() => undefined);
      if (current) {
        const routeChanged = current.url !== previousUrl;
        // FIRST_LOSS fix (runId=preview-2026-09-24T19-08-48): `signature` alone only covers a
        // narrow interactive-control selector -- a real in-place transition whose new content is
        // plain rendered text (a confirmation message, an OTP-sent countdown) never moved it, so
        // a genuine effect was reported as `no_observable_post_action_outcome`. `contentFingerprint`
        // (the browser's own rendered `innerText`, generic, no business text/selector authored
        // here) is an equally real, CORE signal of "the page's visible content changed" -- either
        // one changing is sufficient, neither on its own is required.
        const domTransitionObserved = Boolean(
          before && (before.signature !== current.signature || before.contentFingerprint !== current.contentFingerprint),
        );
        const targetDisappeared = Boolean(before?.targetVisible && !current.targetVisible);
        const newBusinessSurfaceObserved = routeChanged || domTransitionObserved
          || Boolean(before && before.surfaceCount !== current.surfaceCount);
        const inPlaceOutcomeObserved = !routeChanged && domTransitionObserved;
        lastOutcome = {
          ...current,
          navigationObserved: routeChanged,
          routeChanged,
          domTransitionObserved,
          newBusinessSurfaceObserved,
          inPlaceOutcomeObserved,
          targetDisappeared,
        };
        const outcomeSatisfied = expectedEffect === "navigation"
          ? routeChanged
          : expectedEffect === "modal_or_form_or_navigation"
            ? routeChanged || domTransitionObserved
            : domTransitionObserved;
        if (outcomeSatisfied) {
          console.log(
            `[runtime:post-action] target="${target ?? "unknown"}" expectedEffect=${expectedEffect} ` +
            `navigationObserved=${routeChanged} routeChanged=${routeChanged} domTransitionObserved=${domTransitionObserved} ` +
            `newBusinessSurfaceObserved=${newBusinessSurfaceObserved} inPlaceOutcomeObserved=${inPlaceOutcomeObserved}`,
          );
          await this.waitForPromotedUiStable(-1, target ?? "post_action");
          if (expectedEffect === "modal_or_form_or_navigation") await this.refreshActiveContainer();
          return;
        }
      }
      await this.page.waitForTimeout(100);
    }
    const reason = targetIdentity?.expectedRouteTransition
      ? "expected_route_transition_not_observed"
      : targetIdentity?.expectedInPlaceTransition
        ? "expected_in_place_transition_not_observed"
        : "no_observable_post_action_outcome";
    throw new Error(
      `Post-click stability check failed. expectedEffect=${expectedEffect} reason=${reason} ` +
      `target="${target ?? "unknown"}" previousUrl="${previousUrl}" currentUrl="${lastOutcome?.url ?? this.page.url()}"`,
    );
  }

  async getDebugState(): Promise<{ activeContainer?: string; lastDialogMessage?: string; discardReason?: string }> {
    return {
      activeContainer: this.activeContainer?.descriptor,
      lastDialogMessage: this.lastDialogMessage,
      discardReason: this.activeContainerDiscardReason
    };
  }

  private async refreshActiveContainer(): Promise<string | undefined> {
    const { best } = await findBestActiveContainerForField(this.page);
    if (!best) {
      this.activeContainer = undefined;
      return undefined;
    }
    this.activeContainer = { selector: best.selector, descriptor: best.descriptor };
    this.activeContainerDiscardReason = undefined;
    return best.descriptor;
  }

  private async refreshActiveContainerForField(fieldName: string): Promise<{ best?: ContainerCandidate; candidates: ContainerCandidate[] }> {
    const existing = this.activeContainer;
    const scan = await findBestActiveContainerForField(this.page, fieldName);
    const containsExisting = existing
      ? scan.candidates.find((c) => c.descriptor === existing.descriptor && c.visible && c.editableCount > 0 && c.matchingFieldFound)
      : undefined;

    if (containsExisting) {
      this.activeContainerDiscardReason = undefined;
      return scan;
    }

    if (existing) {
      this.activeContainerDiscardReason = "stale_or_not_matching_field";
    }

    if (scan.best) {
      this.activeContainer = { selector: scan.best.selector, descriptor: scan.best.descriptor };
    } else {
      this.activeContainer = undefined;
    }
    return scan;
  }
}

export const PROMOTED_SPEC_RUNTIME_PUBLIC_METHODS = [
  "clickPromotedTarget",
  "fillPromotedField",
  "pressPromotedTarget",
  "selectPromotedItem",
  "expectPromotedVisible",
  "waitForPromotedUiStable",
  "handlePromotedDialogOrAlert",
  "safeReplayContext",
  "checkIfAlreadyOnListPage",
  "getDebugState",
  "finishEvidence"
] as const;

export type PromotedSpecRuntimePublicMethod = typeof PROMOTED_SPEC_RUNTIME_PUBLIC_METHODS[number];

export type PromotedSpecRuntimeApi = Pick<PromotedSpecRuntime, PromotedSpecRuntimePublicMethod>;

export function createPromotedSpecRuntime(page: Page, config?: Partial<PromotedRuntimeConfig>): PromotedSpecRuntimeApi {
  return new PromotedSpecRuntime(page, config);
}
