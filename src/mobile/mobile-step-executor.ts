import type { MobileStep, MobileStepResult, MobileStepTarget, MobileDataField } from "./mobile-step-types";
import { ensureConsentCheckboxChecked, findUncheckedConsentCheckboxes, isSubmitGated, isSubmitLikeClick } from "./mobile-consent-checkbox";
import { dismissBlockingModal } from "./mobile-modal-dismisser";
import { buildTextVariants, normalizeComparableText, repairUtf8Mojibake } from "./mobile-text-normalization";
import { resolveMobileOtp, MobileOtpResolverError } from "./mobile-otp-resolver";

/**
 * Optional runtime context for executing a step. Only used to resolve just-in-time OTPs:
 * `appSlug` targets the app otpProfile, `requiredData` maps an OTP identityField to its
 * stepIndex, and `dataOverrides` (keyed by stepIndex) supplies the effective identity value.
 */
export type MobileStepRuntimeContext = {
  appSlug?: string;
  requiredData?: MobileDataField[];
  dataOverrides?: Record<number, string>;
};

function maskSensitive(v: string): string {
  if (!v) return "-";
  return v.length <= 4 ? "*".repeat(v.length) : `${"*".repeat(v.length - 4)}${v.slice(-4)}`;
}

async function resolveOtpForStep(step: MobileStep, ctx?: MobileStepRuntimeContext): Promise<string> {
  if (!ctx?.appSlug) {
    throw new MobileOtpResolverError("otp_identity_unresolved", "OTP step requires appSlug in runtime context.");
  }
  const identityField = step.otp?.identityField;
  let identity = "";
  let identitySource = "config";
  if (identityField) {
    identitySource = "field";
    const field = (ctx.requiredData ?? []).find((f) =>
      f.key === identityField || f.label === identityField || slugifyKey(f.label) === slugifyKey(identityField),
    );
    const stepIndex = field?.stepIndex;
    if (stepIndex !== undefined) {
      identity = ctx.dataOverrides?.[stepIndex] ?? "";
    }
  }
  if (!identity) {
    throw new MobileOtpResolverError("otp_identity_unresolved", "OTP identity could not be resolved from runtime data.");
  }
  console.log(`[mobile:otp] phase=resolve identitySource=${identitySource} identity=${maskSensitive(identity)} channel=${step.otp?.channel ?? "-"}`);
  const resolved = await resolveMobileOtp({
    appSlug: ctx.appSlug,
    identity,
    channelHint: step.otp?.channel,
  });
  const otp = resolved.otp?.trim();
  if (!otp) {
    throw new MobileOtpResolverError("otp_value_empty", "OTP resolver returned an empty or whitespace-only value.");
  }
  return otp;
}

function slugifyKey(label: string): string {
  return (label ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function selectorFromTarget(target: MobileStepTarget): string {
  switch (target.strategy) {
    case "accessibilityId":
      return `~${target.value}`;
    case "id":
      return `android=new UiSelector().resourceId("${target.value}")`;
    case "xpath":
      return target.value;
    case "androidUiAutomator":
      return `android=${target.value}`;
    case "className":
      return `android=new UiSelector().className("${target.value}")`;
    default:
      throw new Error(`Unsupported locator strategy: ${(target as MobileStepTarget).strategy}`);
  }
}

type WaitMode = "displayed" | "exist";
type WdioElement = Awaited<ReturnType<WebdriverIO.Browser["$"]>>;
type FillObservation = {
  fieldLocated: boolean;
  valueEntered: string;
  fieldAccepted: boolean;
  acceptanceSource: string;
};
type EnabledObservation = {
  targetResolved: boolean;
  enabledObserved: boolean;
  enabledSource: string;
};
type StepRuntimeState = {
  lastFillByTarget: Map<string, FillObservation>;
  lastEnabledByTarget: Map<string, EnabledObservation>;
};
const runtimeStateByBrowser = new WeakMap<WebdriverIO.Browser, StepRuntimeState>();

function getRuntimeState(browser: WebdriverIO.Browser): StepRuntimeState {
  const existing = runtimeStateByBrowser.get(browser);
  if (existing) return existing;
  const created: StepRuntimeState = {
    lastFillByTarget: new Map(),
    lastEnabledByTarget: new Map(),
  };
  runtimeStateByBrowser.set(browser, created);
  return created;
}

function targetKey(target: MobileStepTarget): string {
  return `${target.strategy}|${target.value.trim()}`;
}

async function waitOnce(el: WdioElement, mode: WaitMode, timeoutMs: number): Promise<boolean> {
  const wait = mode === "displayed"
    ? el.waitForDisplayed({ timeout: timeoutMs })
    : el.waitForExist({ timeout: timeoutMs });
  return wait.then(() => true).catch(() => false);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXPathLiteral(value: string): string {
  if (!value.includes("\"")) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  const parts = value.split("\"").map((part) => `"${part}"`);
  return `concat(${parts.join(', \'"\', ')})`;
}

function escapeUiSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function normalizeStepText(step: MobileStep): { step: MobileStep; repaired: boolean } {
  let repaired = false;
  const next: MobileStep = {
    ...step,
    description: typeof step.description === "string" ? repairUtf8Mojibake(step.description) : step.description,
    value: typeof step.value === "string" ? repairUtf8Mojibake(step.value) : step.value,
    target: step.target
      ? {
        ...step.target,
        value: repairUtf8Mojibake(step.target.value),
      }
      : step.target,
  };
  if (step.target?.value && next.target?.value && step.target.value !== next.target.value) {
    repaired = true;
  }
  if (step.description && next.description && step.description !== next.description) {
    repaired = true;
  }
  return { step: next, repaired };
}

function hasAttributeValue(pageSource: string, attribute: string, value: string): boolean {
  const pattern = new RegExp(`${escapeRegex(attribute)}="${escapeRegex(value)}"`, "i");
  return pattern.test(pageSource);
}

function firstClassForText(pageSource: string, text: string): string | undefined {
  const pattern = new RegExp(`<[^>]*class="([^"]+)"[^>]*text="${escapeRegex(text)}"[^>]*>|<[^>]*text="${escapeRegex(text)}"[^>]*class="([^"]+)"[^>]*>`, "i");
  const match = pageSource.match(pattern);
  return match?.[1] || match?.[2] || undefined;
}

function readTagAttribute(tag: string, attribute: string): string | undefined {
  const match = tag.match(new RegExp(`${escapeRegex(attribute)}="([^"]*)"`, "i"));
  const value = match?.[1]?.trim();
  return value ? value : undefined;
}

function extractUiAutomatorClassName(selectorValue: string): string | undefined {
  const match = selectorValue.match(/className\("([^"]+)"\)/);
  return match?.[1]?.trim() || undefined;
}

function selectorHasOrdinalInstance(selectorValue: string): boolean {
  return /\.instance\(\d+\)/.test(selectorValue);
}

function buildStableSelectorsForClassNodes(pageSource: string, className: string): string[] {
  const selectors: string[] = [];
  const classPattern = new RegExp(`<[^>]*class="${escapeRegex(className)}"[^>]*>`, "gi");
  const matchingNodes = Array.from(pageSource.matchAll(classPattern)).map((m) => m[0]);
  for (const tag of matchingNodes) {
    const resourceId = readTagAttribute(tag, "resource-id");
    if (resourceId && !resourceId.startsWith("android:")) {
      selectors.push(`android=new UiSelector().resourceId("${escapeUiSelectorValue(resourceId)}")`);
    }
    const contentDesc = readTagAttribute(tag, "content-desc");
    if (contentDesc) {
      selectors.push(`~${contentDesc}`);
    }
    const text = readTagAttribute(tag, "text");
    if (text) {
      selectors.push(`//*[@text=${escapeXPathLiteral(text)}]`);
    }
  }
  if (matchingNodes.length === 1) {
    selectors.push(`android=new UiSelector().className("${escapeUiSelectorValue(className)}")`);
  }
  return Array.from(new Set(selectors));
}

async function buildEvidenceFallbackSelectors(
  browser: WebdriverIO.Browser,
  target: MobileStepTarget
): Promise<string[]> {
  const value = target.value.trim();
  if (!value) return [];
  const pageSource = await browser.getPageSource().catch(() => "");
  if (!pageSource) return [];

  const variants = buildTextVariants(value);
  const selectors: string[] = [];
  if (target.strategy === "androidUiAutomator") {
    const className = extractUiAutomatorClassName(target.value);
    if (className && selectorHasOrdinalInstance(target.value)) {
      selectors.push(...buildStableSelectorsForClassNodes(pageSource, className));
    }
  }
  for (const candidate of variants) {
    if (hasAttributeValue(pageSource, "content-desc", candidate)) {
      selectors.push(`~${candidate}`);
    }
    if (hasAttributeValue(pageSource, "resource-id", candidate)) {
      selectors.push(`android=new UiSelector().resourceId("${escapeUiSelectorValue(candidate)}")`);
    }
    if (hasAttributeValue(pageSource, "text", candidate)) {
      selectors.push(`//*[@text=${escapeXPathLiteral(candidate)}]`);
      selectors.push(`//*[@content-desc=${escapeXPathLiteral(candidate)}]`);
    }
    const className = firstClassForText(pageSource, candidate);
    if (className) {
      selectors.push(`//*[@class=${escapeXPathLiteral(className)} and @text=${escapeXPathLiteral(candidate)}]`);
    }
  }
  return Array.from(new Set(selectors));
}

function hasMaskSeparators(value: string): boolean {
  return /[^a-zA-Z0-9]/.test(value);
}

/** Keeps letters/digits, drops only format/separator characters. */
function canonicalizeSignificant(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "");
}

async function readFilledValueObservation(el: WdioElement, submittedValue: string, options?: { maskAware?: boolean }): Promise<FillObservation> {
  const maskAware = options?.maskAware === true;
  const trimmedValue = submittedValue.trim();
  const canonicalSubmitted = maskAware ? canonicalizeSignificant(trimmedValue) : "";
  const probes: Array<{ source: string; read: () => Promise<string> }> = [
    { source: "attribute:text", read: async () => String((await el.getAttribute("text")) ?? "") },
    { source: "attribute:value", read: async () => String((await el.getAttribute("value")) ?? "") },
    { source: "attribute:content-desc", read: async () => String((await el.getAttribute("content-desc")) ?? "") },
    { source: "element:text", read: async () => String((await el.getText()) ?? "") },
    { source: "element:value", read: async () => String((await (el as unknown as { getValue?: () => Promise<string | undefined> }).getValue?.()) ?? "") },
  ];
  const observedBySource: Array<{ source: string; observed: string; matched: boolean }> = [];
  for (const probe of probes) {
    let observed = "";
    try {
      observed = (await probe.read()).trim();
    } catch {
      observed = "";
    }
    if (!observed) continue;
    const masked = /[*\u2022]/.test(observed);
    // Masked inputs compare canonical significant content for exact equality (no contains).
    const matched = maskAware
      ? masked || canonicalizeSignificant(observed) === canonicalSubmitted
      : masked || observed.includes(trimmedValue);
    observedBySource.push({ source: probe.source, observed, matched });
    if (matched) {
      return {
        fieldLocated: true,
        valueEntered: trimmedValue,
        fieldAccepted: true,
        acceptanceSource: probe.source,
      };
    }
  }
  // Try every probe before declaring failure: only when values were observed but none
  // match the submitted value do we report a mismatch (with a compact probe summary).
  if (observedBySource.length > 0) {
    const summary = observedBySource.map((entry) => `${entry.source}=${entry.observed.slice(0, 24)}`).join(",");
    return {
      fieldLocated: true,
      valueEntered: trimmedValue,
      fieldAccepted: false,
      acceptanceSource: `mismatch;observed=[${summary}];matched=none`,
    };
  }
  return {
    fieldLocated: true,
    valueEntered: trimmedValue,
    fieldAccepted: false,
    acceptanceSource: "empty_after_fill",
  };
}

async function observeEnabledState(
  browser: WebdriverIO.Browser,
  selector: string,
  target?: MobileStepTarget,
): Promise<EnabledObservation> {
  try {
    const el = await browser.$(selector);
    const exists = await el.isExisting();
    if (!exists) {
      return {
        targetResolved: false,
        enabledObserved: false,
        enabledSource: "target_missing",
      };
    }
    const enabled = await el.isEnabled();
    const observation: EnabledObservation = {
      targetResolved: true,
      enabledObserved: enabled,
      enabledSource: "element.isEnabled",
    };
    if (target) {
      getRuntimeState(browser).lastEnabledByTarget.set(targetKey(target), observation);
    }
    return observation;
  } catch {
    return {
      targetResolved: false,
      enabledObserved: false,
      enabledSource: "target_unreadable",
    };
  }
}

async function inferSubmitGateStatus(browser: WebdriverIO.Browser, selector: string, target?: MobileStepTarget): Promise<{
  fieldAccepted: boolean | "unknown";
  termsAccepted: boolean | "unknown";
  buttonEnabled: boolean;
  buttonObservationSource: string;
}> {
  const buttonObservation = await observeEnabledState(browser, selector, target);
  const buttonEnabled = buttonObservation.targetResolved ? buttonObservation.enabledObserved : false;
  let xml = "";
  try {
    xml = await browser.getPageSource();
  } catch {
    return {
      fieldAccepted: "unknown",
      termsAccepted: "unknown",
      buttonEnabled,
      buttonObservationSource: buttonObservation.enabledSource,
    };
  }
  const uncheckedConsent = findUncheckedConsentCheckboxes(xml);
  const termsAccepted = uncheckedConsent.length === 0;
  const hasFormGate = isSubmitGated(xml);
  const state = getRuntimeState(browser);
  const latestAcceptedField = Array.from(state.lastFillByTarget.values()).slice(-1)[0];
  const fieldAccepted = latestAcceptedField
    ? latestAcceptedField.fieldAccepted
    : (hasFormGate ? false : "unknown");
  return {
    fieldAccepted,
    termsAccepted,
    buttonEnabled,
    buttonObservationSource: buttonObservation.enabledSource,
  };
}

async function locateSelector(
  browser: WebdriverIO.Browser,
  selector: string,
  timeoutMs: number,
  mode: WaitMode
): Promise<WdioElement | null> {
  const el = await browser.$(selector);
  if (await waitOnce(el, mode, timeoutMs)) return el;

  for (let attempt = 0; attempt < 2; attempt++) {
    const dismissed = await dismissBlockingModal(browser, (line) => console.log(line));
    if (!dismissed) break;
    const retried = await browser.$(selector);
    if (await waitOnce(retried, mode, Math.min(timeoutMs, 5000))) return retried;
  }
  return null;
}

/**
 * Disambiguates an androidUiAutomator `text(...)` click that matches more than one element: a
 * selector dropdown opener (e.g. an EditText or a clickable row whose accessibility label is
 * "Cédula de identidad, <icon>") AND the visible dropdown option(s) that share the same text.
 * `browser.$()` returns the FIRST match, so tapping it usually hits the opener and does nothing,
 * letting the step falsely pass. When we can prove a UNIQUE, safe clickable ancestor whose
 * normalized label/text equals the exact searched text, we click that ancestor instead.
 * Otherwise we fall back to existing behavior (never pick arbitrarily by index).
 */
const TEXT_SELECTOR_RE = /\.text\s*\(/;
const MAX_ANCESTOR_DEPTH = 3;

function extractTextSelectorValue(value: string): string | null {
  const m = value.match(/\.text\(\s*"([^"]*)"\s*\)/);
  return m ? m[1] : null;
}

/**
 * Walks up from `el` (bounded, max MAX_ANCESTOR_DEPTH levels) and returns the nearest clickable
 * element together with its normalized combined label/text. Returns null when no clickable
 * ancestor is found in range or its state can't be read.
 */
async function findClickableAncestor(
  browser: WebdriverIO.Browser,
  el: WdioElement
): Promise<{ element: WdioElement; label: string } | null> {
  let current: WdioElement | null = el;
  for (let depth = 0; depth <= MAX_ANCESTOR_DEPTH && current; depth++) {
    let clickable = false;
    let label = "";
    let text = "";
    try {
      clickable = String((await current.getAttribute("clickable")) ?? "").toLowerCase() === "true";
      label = String((await current.getAttribute("content-desc")) ?? "");
      text = String((await current.getAttribute("text")) ?? "");
    } catch {
      return null;
    }
    if (clickable) {
      const combined = normalizeComparableText(`${label} ${text}`.trim());
      if (!combined) return null;
      return { element: current, label: combined };
    }
    if (depth < MAX_ANCESTOR_DEPTH) {
      try {
        current = await current.parentElement();
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function resolveClickableElement(
  browser: WebdriverIO.Browser,
  target: MobileStepTarget,
  clickSelector: string
): Promise<{
  element: WdioElement;
  disambiguated: boolean;
  duplicateTextMatches: number;
  originalClass: string;
  selectedClass: string;
} | null> {
  // Rule applies ONLY to androidUiAutomator selectors built from a text(...) locator.
  if (target.strategy !== "androidUiAutomator" || !TEXT_SELECTOR_RE.test(target.value)) return null;
  const searchedText = extractTextSelectorValue(target.value);
  if (searchedText == null) return null;
  const normalizedSearched = normalizeComparableText(searchedText);
  if (!normalizedSearched) return null;

  let matches: WdioElement[];
  try {
    matches = await browser.$$(clickSelector);
  } catch {
    return null;
  }
  if (!matches || matches.length < 2) return null;
  const duplicateTextMatches = matches.length;

  let originalClass = "unknown";
  try {
    originalClass = String((await matches[0].getAttribute("className")) ?? "") || "unknown";
  } catch {}

  // For each visible match, find its nearest clickable ancestor and keep those whose normalized
  // label/text is EXACTLY equal to the searched text. Deduplicate by the clickable ancestor.
  const seen = new Set<WdioElement>();
  const candidates: WdioElement[] = [];
  for (const m of matches) {
    let displayed = false;
    try {
      displayed = await m.isDisplayed();
    } catch {
      continue;
    }
    if (!displayed) continue;
    const ancestor = await findClickableAncestor(browser, m);
    if (!ancestor || ancestor.label !== normalizedSearched) continue;
    if (seen.has(ancestor.element)) continue;
    seen.add(ancestor.element);
    candidates.push(ancestor.element);
  }

  // Only disambiguate when there is EXACTLY ONE unique clickable ancestor matching the text.
  if (candidates.length !== 1) return null;

  let selectedClass = "unknown";
  try {
    selectedClass = String((await candidates[0].getAttribute("className")) ?? "") || "unknown";
  } catch {}
  return {
    element: candidates[0],
    disambiguated: true,
    duplicateTextMatches,
    originalClass,
    selectedClass,
  };
}

/**
 * Locates a step's target and, if it isn't found, tries to recover: something the previous step
 * opened (a modal/dialog/overlay) may be covering the screen and not contain this target. In
 * that case we close the modal and look for the target on the screen underneath. Returns the
 * resolved element, or null if it still can't be found after recovery.
 */
async function locateTarget(
  browser: WebdriverIO.Browser,
  target: MobileStepTarget,
  selector: string,
  timeoutMs: number,
  mode: WaitMode
): Promise<WdioElement | null> {
  const primary = await locateSelector(browser, selector, timeoutMs, mode);
  if (primary) return primary;

  // Evidence-based fallback hierarchy for accessibilityId misses:
  // resource-id -> visible text -> class+text.
  const fallbacks = await buildEvidenceFallbackSelectors(browser, target);
  for (const fallbackSelector of fallbacks) {
    const fallback = await locateSelector(browser, fallbackSelector, timeoutMs, mode);
    if (fallback) return fallback;
  }

  // ── Late evidence refresh ──────────────────────────────────────────────
  // During async screen transitions the first getPageSource() may only see a
  // transient state (e.g. ProgressBar).  A short polling window allows us to
  // re-read the source once the final screen has rendered and try the new
  // fallback selectors immediately.  When the first window ends with NO
  // evidence fallback candidates at all, we grant one single additional
  // bounded extension (never resetting the clock, never exceeding timeoutMs).
  const LATE_INTERNAL_BUDGET_MS = 500;
  const LATE_POLL_INTERVAL_MS = 1000;
  const BASE_LATE_BUDGET_MS = 5000;
  const MAX_LATE_BUDGET_MS = 10000;
  const maxLateBudget = Math.min(timeoutMs, MAX_LATE_BUDGET_MS);
  const start = Date.now();
  let deadline = start + Math.min(BASE_LATE_BUDGET_MS, maxLateBudget);
  let extended = false;
  let polls = 0;
  let candidates = 0;

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, LATE_POLL_INTERVAL_MS));
    polls += 1;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const freshFallbacks = await buildEvidenceFallbackSelectors(browser, target);
    candidates += freshFallbacks.length;
    if (freshFallbacks.length > 0) {
      for (const freshSelector of freshFallbacks) {
        const hit = await locateSelector(browser, freshSelector, Math.min(LATE_INTERNAL_BUDGET_MS, remaining), mode);
        if (hit) {
          console.log(`[mobile:target] lateEvidenceRefresh resolved=true polls=${polls} candidates=${candidates} extended=${extended}`);
          return hit;
        }
      }
    }
    // One single extension when the base window expires with no evidence candidates.
    if (Date.now() >= deadline && !extended && maxLateBudget > Math.min(BASE_LATE_BUDGET_MS, maxLateBudget) && candidates === 0) {
      deadline = start + maxLateBudget;
      extended = true;
    }
  }
  console.log(`[mobile:target] lateEvidenceRefresh resolved=false polls=${polls} candidates=${candidates} extended=${extended}`);
  return null;
}

/** Reads the enable-before-click flag (default ON; only "false" disables). */
function requireEnabledBeforeClick(): boolean {
  return (process.env.MOBILE_REQUIRE_ENABLED_BEFORE_CLICK ?? "true").toLowerCase() !== "false";
}

/**
 * Whether the element for `selector` is currently ENABLED. Only the `enabled` attribute is used —
 * NOT `clickable`, because many tappable RN rows have a `clickable="false"` inner TextView yet the
 * tap works via a clickable ancestor. Re-queries each call so a disabled→enabled transition (e.g.
 * a form validating, or a consent checkbox getting marked) is picked up. If state can't be read,
 * returns true so we never block a legitimate click.
 */
async function isEnabledNow(browser: WebdriverIO.Browser, selector: string): Promise<boolean> {
  const observation = await observeEnabledState(browser, selector);
  if (!observation.targetResolved) return true;
  return observation.enabledObserved;
}

/** Polls (briefly) until the element becomes enabled, or the timeout elapses. */
async function waitUntilEnabled(browser: WebdriverIO.Browser, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  if (await isEnabledNow(browser, selector)) return true;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    if (await isEnabledNow(browser, selector)) return true;
  }
  return false;
}

function classifyInfrastructureStepError(message: string): string | undefined {
  const normalized = message.toLowerCase();
  if (normalized.includes("mobile_text_encoding_invalid")) {
    return "mobile_text_encoding_invalid";
  }
  if (
    normalized.includes("socket hang up") ||
    normalized.includes("instrumentation process is not running") ||
    normalized.includes("uiautomator2 server not responding") ||
    normalized.includes("uiautomator2 server is not running") ||
    normalized.includes("invalid session id") ||
    normalized.includes("session deleted") ||
    normalized.includes("econnrefused") ||
    normalized.includes("econnreset") ||
    normalized.includes("connection refused") ||
    normalized.includes("connection reset") ||
    normalized.includes("device offline") ||
    normalized.includes("device disconnected") ||
    normalized.includes("no such driver") ||
    normalized.includes("failed to proxy command")
  ) {
    return "mobile_automation_channel_lost";
  }
  return undefined;
}

/**
 * Generic semantic detection of a consent/acceptance click step, based only on the step
 * description/target wording (e.g. aceptar, acepto, términos, condiciones, consentimiento).
 * Applies to any app; never hardcodes app slug, story or exact control text.
 */
const CONSENT_ACCEPT_KEYWORDS = ["aceptar", "acepto", "termino", "condicion", "consentimiento", "consent", "accept", "agree"];
function isConsentAcceptanceClick(step: MobileStep): boolean {
  if (step.action !== "click") return false;
  const haystack = `${step.description ?? ""} ${step.target?.value ?? ""}`.toLowerCase();
  return CONSENT_ACCEPT_KEYWORDS.some((kw) => haystack.includes(kw));
}

function assertNoConfirmedEncodingCorruption(step: MobileStep): void {
  const fragments = [step.description, step.value, step.target?.value].filter((v): v is string => typeof v === "string");
  const broken = fragments.find((fragment) => fragment.includes("\uFFFD"));
  if (broken) {
    throw new Error("mobile_text_encoding_invalid: replacement character detected in step payload");
  }
}

export async function executeMobileStep(
  browser: WebdriverIO.Browser,
  step: MobileStep,
  index: number,
  screenshotPath?: string,
  otpContext?: MobileStepRuntimeContext
): Promise<MobileStepResult> {
  const startedAt = Date.now();

  try {
    const normalized = normalizeStepText(step);
    const effectiveStep = normalized.step;
    let resultExtras: Partial<MobileStepResult> = {};
    if (normalized.repaired) {
      console.warn(`[mobile:utf8] repaired_step_text index=${index + 1}`);
    }
    assertNoConfirmedEncodingCorruption(effectiveStep);
    switch (effectiveStep.action) {
      case "launchApp": {
        // App launch is handled at Appium session creation (appium:app / appPackage+appActivity).
        // This step exists as a documentation/evidence marker only.
        break;
      }
      case "click": {
        if (!effectiveStep.target) throw new Error("click step requires a target");
        const clickSelector = selectorFromTarget(effectiveStep.target);
        const el = await locateTarget(browser, effectiveStep.target, clickSelector, effectiveStep.timeoutMs ?? 10000, "displayed");
        if (!el) throw new Error(`click target not found (even after closing any blocking modal): ${JSON.stringify(effectiveStep.target)}`);
        // Primary consent/acceptance strategy: composite acceptance controls (checkbox + terms link)
        // must not be tapped generically at their centre (that hits the terms link and opens the
        // modal). For consent-classified clicks, run the specialized helper FIRST; when it resolves
        // the acceptance (ticked>0) the action is done and the generic click is skipped.
        let consentResolved = false;
        if (isConsentAcceptanceClick(effectiveStep)) {
          const consentResult = await ensureConsentCheckboxChecked(browser, (line) => console.log(line));
          consentResolved = consentResult.ticked.length > 0;
          console.log(`[mobile:consent] primaryRecovery=true ticked=${consentResult.ticked.length} genericClickSkipped=${consentResolved}`);
        }
        // A visible button can still be DISABLED (e.g. "Continuar" until the form gate is satisfied).
        // Give it a brief window to become enabled, then decide on the `enabled` attribute ONLY —
        // never `clickable`, which is `false` on many tappable inner TextViews. If it stays genuinely
        // disabled, tapping it is a no-op, so fail with a precise reason instead of silently "passing"
        // an action that couldn't happen. (Negative scenarios must assert the disabled state via
        // assertDisabled, not click.)
        if (!consentResolved && requireEnabledBeforeClick()) {
          // Only when the submit-like control is actually disabled do we attempt the consent/checkbox
          // handling that may satisfy the gate — never when it is already enabled, so a consent pass
          // (getPageSource + possible modal/checkbox interactions) can't re-render the tree and flip an
          // enabled button into a transient disabled state between the assertEnabled step and the click.
          if (!(await waitUntilEnabled(browser, clickSelector, Math.min(effectiveStep.timeoutMs ?? 10000, 4000)))) {
            if (isSubmitLikeClick(effectiveStep)) {
              await ensureConsentCheckboxChecked(browser, (line) => console.log(line));
            }
            try {
              await browser.hideKeyboard();
            } catch {
              // keyboard may not be open
            }
            const enabledAfterKeyboard = await waitUntilEnabled(browser, clickSelector, 1200);
            if (!enabledAfterKeyboard) {
              const gate = await inferSubmitGateStatus(browser, clickSelector, effectiveStep.target);
              throw new Error(
                `data_precondition_failure: submit gate not satisfied fieldAccepted=${gate.fieldAccepted} termsAccepted=${gate.termsAccepted} buttonEnabled=${gate.buttonEnabled} target=${JSON.stringify(effectiveStep.target)} buttonObservationSource=${gate.buttonObservationSource}`,
              );
            }
          }
        }
        // Re-query in case the tree re-rendered while waiting for the enabled state. Skipped when the
        // consent strategy already resolved the acceptance (the helper handled the control directly).
        let clickedElement: WdioElement | null = null;
        let preClickAttrs: { resourceId?: string; contentDesc?: string; package?: string; className?: string } | undefined;
        if (!consentResolved) {
          const disambiguation = await resolveClickableElement(browser, effectiveStep.target, clickSelector);
          if (disambiguation) {
            console.log(
              `[mobile:click] duplicateTextMatches=${disambiguation.duplicateTextMatches} originalClass=${disambiguation.originalClass} selectedClass=${disambiguation.selectedClass} disambiguationReason=exact_clickable_ancestor_label disambiguated=true`,
            );
            // Capture attributes BEFORE click — element may become stale after navigation.
            try {
              preClickAttrs = {
                resourceId: String(await disambiguation.element.getAttribute("resource-id") ?? "").trim() || undefined,
                contentDesc: String(await disambiguation.element.getAttribute("content-desc") ?? "").trim() || undefined,
                package: String(await disambiguation.element.getAttribute("package") ?? "").trim() || undefined,
                className: String(await disambiguation.element.getAttribute("class") ?? "").trim() || undefined,
              };
            } catch { /* attribute read is best-effort */ }
            await disambiguation.element.click();
            clickedElement = disambiguation.element;
          } else {
            const el = await browser.$(clickSelector);
            try {
              preClickAttrs = {
                resourceId: String(await el.getAttribute("resource-id") ?? "").trim() || undefined,
                contentDesc: String(await el.getAttribute("content-desc") ?? "").trim() || undefined,
                package: String(await el.getAttribute("package") ?? "").trim() || undefined,
                className: String(await el.getAttribute("class") ?? "").trim() || undefined,
              };
            } catch { /* attribute read is best-effort */ }
            await el.click();
            clickedElement = el;
          }
        }
        // Build executedControl from pre-click captured attributes.
        const executedControl = preClickAttrs ? {
          locatorIdentity: preClickAttrs.contentDesc || preClickAttrs.resourceId || undefined,
          ...preClickAttrs,
        } : undefined;
        const clickEnabledObservation = await observeEnabledState(browser, clickSelector, effectiveStep.target);
        resultExtras = {
          targetResolved: clickEnabledObservation.targetResolved,
          enabledObserved: clickEnabledObservation.enabledObserved,
          enabledSource: clickEnabledObservation.enabledSource,
          ...(executedControl ? { executedControl } : {}),
        };
        break;
      }
      case "fill": {
        if (!effectiveStep.target) throw new Error("fill step requires a target");
        const el = await locateTarget(browser, effectiveStep.target, selectorFromTarget(effectiveStep.target), effectiveStep.timeoutMs ?? 10000, "displayed");
        if (!el) throw new Error(`fill target not found (even after closing any blocking modal): ${JSON.stringify(effectiveStep.target)}`);
        let submittedValue = effectiveStep.value ?? "";
        if (effectiveStep.otp?.required === true) {
          // Just-in-time OTP: resolve a fresh code and use it as the fill input, in memory only.
          submittedValue = await resolveOtpForStep(effectiveStep, otpContext);
        }
        // Detect masked inputs (e.g. a formatted identifier field) before sending keys:
        // the control's mask reformats separators as they are typed, so send only the
        // significant characters and let the app apply its own mask.
        const hintAttr = String((await el.getAttribute("hint")) ?? "").trim();
        let inputTypeAttr = "";
        try {
          inputTypeAttr = String((await el.getAttribute("input-type")) ?? "").trim();
        } catch {
          // input-type may not exist on all Android elements; not required for mask detection
        }
        const significantChars = canonicalizeSignificant(submittedValue);
        // The submitted value may already be canonicalized (no separators) when it comes from a
        // dataOverride, so we key mask detection on the element hint's visible separators instead
        // of the payload itself.
        const maskAware =
          submittedValue.trim().length > 0 &&
          hintAttr.length > 0 &&
          hasMaskSeparators(hintAttr) &&
          significantChars.length > 0 &&
          /^[a-zA-Z0-9]+$/.test(significantChars);
        if (maskAware) {
          console.log(`[mobile:fill] mask-aware input detected hint="${hintAttr}" inputType="${inputTypeAttr}" payload="${significantChars}"`);
        }
        const inputPayload = maskAware ? significantChars : submittedValue;
        await el.setValue(inputPayload);
        try {
          await browser.hideKeyboard();
        } catch {
          // not always available/open
        }
        // hideKeyboard may trigger a re-render; re-resolve the element using the step selector
        // instead of reusing the pre-keyboard reference, then validate the filled value against it.
        const fillSelector = selectorFromTarget(effectiveStep.target);
        const postFillEl = await browser.$(fillSelector);
        const fillObservation = await readFilledValueObservation(postFillEl, submittedValue, { maskAware });
        getRuntimeState(browser).lastFillByTarget.set(targetKey(effectiveStep.target), fillObservation);
        if (!fillObservation.fieldAccepted) {
          throw new Error(`data_precondition_failure: fill not accepted target=${JSON.stringify(effectiveStep.target)} acceptanceSource=${fillObservation.acceptanceSource}`);
        }
        resultExtras = {
          fieldLocated: fillObservation.fieldLocated,
          valueEntered: fillObservation.valueEntered,
          fieldAccepted: fillObservation.fieldAccepted,
          acceptanceSource: fillObservation.acceptanceSource,
        };
        break;
      }
      case "assertVisible": {
        if (!effectiveStep.target) throw new Error("assertVisible step requires a target");
        const el = await locateTarget(browser, effectiveStep.target, selectorFromTarget(effectiveStep.target), effectiveStep.timeoutMs ?? 10000, "displayed");
        if (!el) {
          throw new Error(`Expected element to be visible: ${JSON.stringify(effectiveStep.target)}`);
        }
        break;
      }
      case "assertEnabled": {
        // Validate that a control IS enabled (actionable). Used to confirm a gate was satisfied.
        if (!effectiveStep.target) throw new Error("assertEnabled step requires a target");
        const selector = selectorFromTarget(effectiveStep.target);
        const el = await locateTarget(browser, effectiveStep.target, selector, effectiveStep.timeoutMs ?? 10000, "displayed");
        if (!el) throw new Error(`Expected element to be present and enabled but not found: ${JSON.stringify(effectiveStep.target)}`);
        let enabledObservation = await observeEnabledState(browser, selector, effectiveStep.target);
        // Bounded wait for a disabled -> enabled transition (e.g. a form validating after input).
        // The gate may be satisfied shortly after the element becomes visible, so don't fail on a
        // transient disabled snapshot; only fail once the wait budget is exhausted.
        if (enabledObservation.targetResolved && !enabledObservation.enabledObserved) {
          const ENABLE_WAIT_MAX_MS = 4000;
          const enableWaitBudget = Math.min(effectiveStep.timeoutMs ?? 10000, ENABLE_WAIT_MAX_MS);
          await waitUntilEnabled(browser, selector, enableWaitBudget);
          enabledObservation = await observeEnabledState(browser, selector, effectiveStep.target);
        }
        if (!enabledObservation.targetResolved || !enabledObservation.enabledObserved) {
          throw new Error(`Expected element to be ENABLED but it is disabled: ${JSON.stringify(effectiveStep.target)} enabledSource=${enabledObservation.enabledSource}`);
        }
        resultExtras = {
          targetResolved: enabledObservation.targetResolved,
          enabledObserved: enabledObservation.enabledObserved,
          enabledSource: enabledObservation.enabledSource,
        };
        break;
      }
      case "assertDisabled": {
        // Validate that a control IS disabled — the expected outcome of negative scenarios (e.g. the
        // submit button stays disabled with invalid input). Uses `exist` since a disabled control is
        // still present; passes only when the element exists and reports enabled=false.
        if (!effectiveStep.target) throw new Error("assertDisabled step requires a target");
        const el = await locateTarget(browser, effectiveStep.target, selectorFromTarget(effectiveStep.target), effectiveStep.timeoutMs ?? 10000, "exist");
        if (!el) throw new Error(`Expected element to be present but disabled; not found: ${JSON.stringify(effectiveStep.target)}`);
        const enabled = await el.isEnabled().catch(() => true);
        if (enabled) throw new Error(`Expected element to be DISABLED but it is enabled: ${JSON.stringify(effectiveStep.target)}`);
        break;
      }
      case "waitFor": {
        if (!effectiveStep.target) throw new Error("waitFor step requires a target");
        const el = await locateTarget(browser, effectiveStep.target, selectorFromTarget(effectiveStep.target), effectiveStep.timeoutMs ?? 10000, "exist");
        if (!el) throw new Error(`waitFor target not found (even after closing any blocking modal): ${JSON.stringify(effectiveStep.target)}`);
        break;
      }
      case "screenshot": {
        // Screenshot capture is handled below for every step; nothing extra to do here.
        break;
      }
      default:
        throw new Error(`Unsupported mobile step action: ${(step as MobileStep).action}`);
    }

    if (screenshotPath) {
      await browser.saveScreenshot(screenshotPath);
    }

    return {
      index,
      action: effectiveStep.action,
      description: effectiveStep.description,
      status: "passed",
      ...resultExtras,
      screenshotPath,
      durationMs: Date.now() - startedAt
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const infraReason = classifyInfrastructureStepError(message);
    const finalMessage = infraReason ? `${infraReason}: ${message}` : message;
    if (screenshotPath) {
      try {
        await browser.saveScreenshot(screenshotPath);
      } catch {
        // Best effort — don't let screenshot failure mask the real error.
      }
    }
    return {
      index,
      action: step.action,
      description: step.description,
      status: "failed",
      errorMessage: finalMessage,
      screenshotPath,
      durationMs: Date.now() - startedAt
    };
  }
}
