import fs from "node:fs/promises";
import path from "node:path";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { config } from "../config/env";
import { loadAppConfig } from "../automations/app-auto-resolver";
import { loadAutomationIndex } from "../automations/automation-index";
import { buildDataContext } from "../data/data-context";
import { loadPromotedDataManifestSync } from "../data/promoted-data";
import type { PlanTarget } from "../types/execution-plan.types";
import { scanCurrentPage } from "../explorer/page-scanner";
import { detectAuthGate } from "../discovery/auth-gate-detector";
import { fillJiraSegmentedCode } from "./jira-segmented-code";
import { buildJiraDomOptionSnapshot, chooseJiraDomTarget, locatorForJiraDomCandidate } from "./jira-dom-target-ai";
import { isJiraDomAssertionSupported } from "./jira-dom-assertion-ai";
import { jiraCredentialRejectionMatches, jiraAlertErrorEquivalenceMatches, readVisibleJiraAlertTexts, stripJiraNotificationChannelWord } from "./jira-assertion-matching";
import { settleJiraAction } from "./jira-action-settlement";
export { settleJiraAction } from "./jira-action-settlement";
import { ensureJiraDownloadObserver } from "./jira-download-assertion";
import { chooseJiraMatchingOption, jiraOptionTextMatches, jiraOptionSearchRoot, jiraOptionBelongsToRoot } from "./jira-option-choice";
import { isJiraRangeMetadataAssertion, jiraNumericValueMatches, jiraRangeMetadataAssertionMatches, setJiraRangeControlValue } from "./jira-range-control";
import { captureJiraEvidenceScreenshot, readJiraScreenIdentity, waitForJiraScreenSettled } from "./jira-evidence-capture";
import { observeJiraFieldValidation } from "./jira-field-validation";

export { assertJiraDownloadContent as assertJiraSpecDownloadContent, assertJiraTableBoundDownload as assertJiraSpecTableBoundDownload } from "./jira-download-assertion";

function jiraStepAttachmentName(stepIndex: number): string {
  return `jira-step-${String(stepIndex).padStart(3, "0")}`;
}

type JiraReuseEvidenceCaptureState = {
  lastObservedScreenId?: string;
  lastCapturedScreenId?: string;
  pendingCaptureStepIndex?: number;
};

const jiraReuseEvidenceCaptureStates = new WeakMap<Page, JiraReuseEvidenceCaptureState>();

/** Emits progress only for QA Lab's Jira spec-reuse job; ordinary Playwright runs stay unchanged. */
export async function reportJiraSpecStepStart(_testInfo: TestInfo, stepIndex: number): Promise<void> {
  if (!process.env.JIRA_REUSE_EVIDENCE_CONTEXT || !Number.isInteger(stepIndex) || stepIndex < 1) return;
  console.log(`[promoted-step] stepIndex=${stepIndex} phase=start`);
}

/** Records a safe step timestamp, observed screen identity and selected transition screenshot. */
export async function reportJiraSpecStepComplete(
  page: Page,
  testInfo: TestInfo,
  stepIndex: number,
  captureScreen: boolean,
  isFinalStep = false,
): Promise<void> {
  if (!process.env.JIRA_REUSE_EVIDENCE_CONTEXT || !Number.isInteger(stepIndex) || stepIndex < 1) return;

  const state = jiraReuseEvidenceCaptureStates.get(page) ?? {};
  jiraReuseEvidenceCaptureStates.set(page, state);
  if (captureScreen) state.pendingCaptureStepIndex = stepIndex;

  const timestamp = new Date().toISOString();
  // Never read identity or capture while a loading indicator is visible; the pending index stays
  // queued so the next settled report attaches the stable screen under the original step.
  const settled = await waitForJiraScreenSettled(page);
  const screenIdentity = settled ? await readJiraScreenIdentity(page) : undefined;
  const observedScreenChanged = Boolean(screenIdentity && screenIdentity.id !== state.lastObservedScreenId);
  // Settled final step always recaptures: same screen id may hold mutated form data.
  const shouldCapture = settled && (isFinalStep || Boolean(screenIdentity && screenIdentity.id !== state.lastCapturedScreenId
      && (observedScreenChanged || state.pendingCaptureStepIndex !== undefined || !state.lastCapturedScreenId))
    || (captureScreen && !screenIdentity));
  const captureStepIndex = isFinalStep ? stepIndex : state.pendingCaptureStepIndex ?? stepIndex;
  if (screenIdentity) state.lastObservedScreenId = screenIdentity.id;

  const metadata: { stepIndex: number; status: "passed"; timestamp: string; screenIdentity?: { id: string; title: string }; screenshot?: boolean } = {
    stepIndex,
    status: "passed",
    timestamp,
    ...(screenIdentity ? { screenIdentity } : {}),
  };
  const attachMetadata = async (index: number, value: typeof metadata) => {
    try {
      await testInfo.attach(`${jiraStepAttachmentName(index)}-meta`, {
        body: JSON.stringify(value),
        contentType: "application/json",
      });
    } catch {
      // Reporting must not convert a successful Jira action into a failed scenario.
    }
  };
  await attachMetadata(stepIndex, metadata);

  if (shouldCapture) {
    try {
      const screenshot = await captureJiraEvidenceScreenshot(page, { fullPage: true });
      await testInfo.attach(jiraStepAttachmentName(captureStepIndex), { body: screenshot, contentType: "image/png" });
      const screenshotMetadata = {
        stepIndex: captureStepIndex,
        status: "passed" as const,
        timestamp,
        ...(screenIdentity ? { screenIdentity } : {}),
        screenshot: true,
      };
      if (captureStepIndex !== stepIndex) await attachMetadata(captureStepIndex, screenshotMetadata);
      if (screenIdentity) state.lastCapturedScreenId = screenIdentity.id;
      state.pendingCaptureStepIndex = undefined;
    } catch {
      console.log(`[jira-reuse-evidence] stepIndex=${captureStepIndex} screenshot=unavailable`);
    }
  }

  if (isFinalStep) state.pendingCaptureStepIndex = undefined;
  console.log(`[promoted-step] stepIndex=${stepIndex} phase=passed`);
}

function uniqueLocator(page: Page, target: PlanTarget): Locator {
  let locator: Locator;
  const value = target.value ?? target.name;
  switch (target.strategy) {
    case "role":
      if (!target.role || !value) throw new Error("JIRA_SPEC_TARGET_INVALID");
      locator = page.getByRole(target.role as Parameters<Page["getByRole"]>[0], { name: value, exact: target.exact ?? true });
      break;
    case "text":
      if (!value) throw new Error("JIRA_SPEC_TARGET_INVALID");
      locator = page.getByText(value, { exact: target.exact ?? true });
      break;
    case "label":
      if (!value) throw new Error("JIRA_SPEC_TARGET_INVALID");
      locator = page.getByLabel(value, { exact: target.exact ?? true });
      break;
    case "placeholder":
      if (!value) throw new Error("JIRA_SPEC_TARGET_INVALID");
      locator = page.getByPlaceholder(value, { exact: target.exact ?? true });
      break;
    case "testId":
      if (!value) throw new Error("JIRA_SPEC_TARGET_INVALID");
      locator = page.getByTestId(value);
      break;
    case "css":
      if (!value) throw new Error("JIRA_SPEC_TARGET_INVALID");
      locator = page.locator(value);
      break;
    case "xpath":
      if (!value) throw new Error("JIRA_SPEC_TARGET_INVALID");
      locator = page.locator(`xpath=${value}`);
      break;
    default:
      throw new Error("JIRA_SPEC_TARGET_STRATEGY_UNSUPPORTED");
  }
  return locator;
}

export async function resolveJiraSpecTarget(
  page: Page,
  target: PlanTarget,
  deterministicTimeoutMs = 2500,
  semanticIntent?: string,
): Promise<Locator> {
  let locator = uniqueLocator(page, target);
  if (target.strategy === "text" && (await locator.count()) === 0 && target.value) {
    // Discovery compares observed UI text without depending on title casing.
    // Preserve exact text authority first, then allow a unique case-insensitive
    // text match for generated assertion targets such as screen headings.
    locator = page.getByText(target.value, { exact: false });
  }
  // A Jira spec often resolves the next assertion immediately after a
  // navigation or authentication click. Wait for that observed target to be
  // hydrated before treating an initial zero-match as a permanent ambiguity.
  try {
    await expect(locator).toHaveCount(1, { timeout: deterministicTimeoutMs });
    if (await locator.isVisible() && await locator.isEnabled()) return locator;
  } catch { /* The AI fallback below may only choose an observed durable DOM control. */ }
  // Discovery can produce a text-based CSS locator whose tag no longer matches
  // the rendered control (for example, a labeled channel rendered as a button
  // instead of a div). Recover from the same observed label using the live DOM,
  // but only if it identifies exactly one visible, enabled action owner.
  const observedLabel = textLabelFromTarget(target);
  if (observedLabel) {
    const observed = await uniqueVisibleActionOwner(page, observedLabel);
    if (observed) return observed;
  }
  // A generated spec may have a stable technical locator from Discovery, such
  // as a CSS id. If that locator goes stale, Jira's DOM fallback must receive
  // the human action intent, not the selector string, so it can compare the
  // observed controls with the actual step meaning.
  const intent = semanticIntent?.trim() || target.value || target.name;
  if (intent) {
    const snapshot = await scanCurrentPage(page);
    const selected = await chooseJiraDomTarget(page, intent, snapshot);
    if (selected) {
      const fallback = locatorForJiraDomCandidate(page, selected);
      if (fallback && await fallback.count() === 1 && await fallback.isVisible() && await fallback.isEnabled()) return fallback;
    }
  }
  throw new Error("JIRA_SPEC_TARGET_NOT_UNIQUE");
}

/**
 * Selects an observed one-time-code delivery channel when actionable. Some
 * applications render the already-selected channel as plain text once the OTP
 * gate is open; in that state the following OTP form is evidence the request
 * step has already been satisfied, so repeating a click is unnecessary.
 */
export async function clickJiraSpecTarget(
  page: Page,
  target: PlanTarget,
  deterministicTimeoutMs = 2500,
  semanticIntent?: string,
): Promise<void> {
  jiraSpecClickLoadingLabels.delete(page);
  await page.evaluate(startJiraLoadingCapture).catch(() => undefined);
  let succeeded = false;
  try {
    await dispatchJiraSpecClick(page, target, deterministicTimeoutMs, semanticIntent);
    succeeded = true;
  } finally {
    // A full navigation destroys the capture with the old document; treat that as "nothing observed".
    const labels = await page.evaluate(stopJiraLoadingCapture).catch(() => [] as string[]);
    if (succeeded && labels.length) jiraSpecClickLoadingLabels.set(page, labels);
  }
}

/**
 * Loading UI is transient: a React transition can appear and vanish inside the click's own settle window,
 * before the next step's assertion polls. Labels are recorded at mutation time (same contract as the
 * Discovery executor) and offered, once, to the first assertion that follows the click.
 */
const jiraSpecClickLoadingLabels = new WeakMap<Page, string[]>();
const JIRA_LOADING_LABEL = /\b(?:estado\s+(?:de\s+)?carga|cargando|loading|procesando|processing|actualizando|updating)\b/i;

function startJiraLoadingCapture(): void {
  const key = "__qaLabJiraSpecLoadingCapture";
  const w = window as typeof window & { [key: string]: { labels: string[]; observer: MutationObserver } | undefined };
  w[key]?.observer.disconnect();
  const state = { labels: [] as string[], observer: undefined as unknown as MutationObserver };
  state.observer = new MutationObserver(() => {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[role="status"],[aria-live],[aria-label]'))) {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const label = `${element.getAttribute("aria-label") ?? ""} ${element.innerText.trim()}`.trim();
      if (/\b(?:estado\s+(?:de\s+)?carga|cargando|loading|procesando|processing|actualizando|updating)\b/i.test(label)
        && !state.labels.includes(label)) state.labels.push(label);
    }
  });
  state.observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  w[key] = state;
}

function stopJiraLoadingCapture(): string[] {
  const key = "__qaLabJiraSpecLoadingCapture";
  const w = window as typeof window & { [key: string]: { labels: string[]; observer: MutationObserver } | undefined };
  const state = w[key];
  state?.observer.disconnect();
  delete w[key];
  return state?.labels ?? [];
}

async function dispatchJiraSpecClick(
  page: Page,
  target: PlanTarget,
  deterministicTimeoutMs: number,
  semanticIntent?: string,
): Promise<void> {
  ensureJiraDownloadObserver(page);
  const clickAndSettle = (locator: Locator) => settleJiraAction(page, () => locator.click());
  try {
    const codeChannel = textLabelFromTarget(target)?.trim().toLowerCase() === "sms"
      && /solicitar|seleccionar|enviar|c[oó]digo|otp/i.test(semanticIntent ?? "");
    if (codeChannel) {
      // Authentication transitions can render the delivery channel just after
      // the login click resolves. Wait for the observed label before taking a
      // one-time DOM snapshot to decide whether it is unique/actionable.
      const channelWaitMs = deterministicTimeoutMs === 2500
        ? Math.max(deterministicTimeoutMs, Math.min(config.execution.defaultTimeoutMs, 10_000))
        : deterministicTimeoutMs;
      await expect(page.getByText("SMS", { exact: true }).first())
        .toBeVisible({ timeout: channelWaitMs }).catch(() => undefined);
      const exactLabels = await page.getByText("SMS", { exact: true }).all();
      const visibleLabels: Locator[] = [];
      for (const candidate of exactLabels) {
        if (await candidate.isVisible() && await candidate.isEnabled()) visibleLabels.push(candidate);
      }
      if (visibleLabels.length === 1) {
        await clickAndSettle(visibleLabels[0]);
        return;
      }
      // Some apps render duplicate matching nodes around an OTP channel (for
      // example, a text wrapper and its nested label). When several exact text
      // locators are visible, prefer the unique leaf label inside the visible
      // multi-field code-entry group; unrelated duplicate text elsewhere stays
      // ambiguous.
      const otpChannelLabel = await uniqueVisibleTextLeafInCodeGroup(page, "SMS");
      if (otpChannelLabel) {
        await clickAndSettle(otpChannelLabel);
        return;
      }
      // Discovery may resolve the SMS label to a visible text container rather
      // than the interactive owner. Prefer the unique actionable owner so the
      // selection event is delivered to the same control a user would activate.
      const actionOwner = await uniqueVisibleActionOwner(page, "SMS");
      if (actionOwner) {
        await clickAndSettle(actionOwner);
        return;
      }
    }
    const locator = await resolveJiraSpecTarget(page, target, deterministicTimeoutMs, semanticIntent);
    await clickAndSettle(locator);
  } catch (error) {
    const codeChannel = textLabelFromTarget(target)?.trim().toLowerCase() === "sms"
      && /solicitar|seleccionar|enviar|c[oó]digo|otp/i.test(semanticIntent ?? "");
    const failure = error instanceof Error ? error.message : String(error);
    if (!codeChannel || !failure.includes("JIRA_SPEC_TARGET_NOT_UNIQUE")) throw error;
    const gate = detectAuthGate(await scanCurrentPage(page));
    if (gate.stage !== "otp") throw error;
    const bodyText = await page.locator("body").innerText().catch(() => "");
    // Being on an OTP screen alone does not prove the SMS channel was selected.
    // Accept an unresolved click only when the UI visibly confirms a resend
    // countdown/action, which indicates the delivery request already happened.
    if (!/\b(?:reenviar|resend)\b.{0,80}\b(?:c[oó]digo|code)\b|\b(?:c[oó]digo|code)\b.{0,80}\b(?:reenviar|resend)\b/i.test(bodyText)) {
      throw error;
    }
  }
}

async function uniqueVisibleTextLeafInCodeGroup(page: Page, label: string): Promise<Locator | undefined> {
  const normalizedLabel = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const matches = await page.locator("body *").evaluateAll((elements, expectedLabel) => {
    const labels: Array<{ element: HTMLElement; index: number }> = [];
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (!(element instanceof HTMLElement)) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = (element.innerText || element.textContent || "").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      if (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
        && style.pointerEvents !== "none" && text === expectedLabel) {
        labels.push({ element, index });
      }
    }
    const leaves: Array<{ element: HTMLElement; index: number }> = [];
    for (const labelMatch of labels) {
      let nestedExactLabel = false;
      for (const child of Array.from(labelMatch.element.querySelectorAll("*"))) {
        if (!(child instanceof HTMLElement)) continue;
        const rect = child.getBoundingClientRect();
        const style = getComputedStyle(child);
        const text = (child.innerText || child.textContent || "").normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
        if (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
          && style.pointerEvents !== "none" && text === expectedLabel) {
          nestedExactLabel = true;
          break;
        }
      }
      if (!nestedExactLabel) leaves.push(labelMatch);
    }
    const inCodeGroup: Array<{ element: HTMLElement; index: number }> = [];
    for (const leaf of leaves) {
      const element = leaf.element;
      let parent: HTMLElement | null = element;
      let foundCodeGroup = false;
      while (parent && parent !== document.body) {
        const fields = parent.querySelectorAll("input, textarea, [role='textbox']");
        let visibleFieldCount = 0;
        for (const field of Array.from(fields)) {
          if (!(field instanceof HTMLElement)) continue;
          const rect = field.getBoundingClientRect();
          const style = getComputedStyle(field);
          if (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
            && style.pointerEvents !== "none") visibleFieldCount += 1;
        }
        const fieldCount = visibleFieldCount;
        if (fieldCount >= 4) { foundCodeGroup = true; break; }
        parent = parent.parentElement;
      }
      if (foundCodeGroup) inCodeGroup.push(leaf);
    }
    const selected = inCodeGroup.length === 1 ? inCodeGroup : leaves.length === 1 ? leaves : [];
    const result: Array<{ selector: string; index: number }> = [];
    for (const selectedMatch of selected) {
      const element = selectedMatch.element;
      const parts: string[] = [];
      let current: HTMLElement | null = element;
      while (current && current !== document.documentElement) {
        let part = current.tagName.toLowerCase();
        if (current.id) { parts.unshift(`${part}[id=${JSON.stringify(current.id)}]`); break; }
        const parent: HTMLElement | null = current.parentElement as HTMLElement | null;
        if (parent) {
          let position = 0;
          const siblings: Element[] = Array.from(parent.children);
          for (const sibling of siblings) {
            if (sibling.tagName === current.tagName) {
              position += 1;
              if (sibling === current) break;
            }
          }
          part += `:nth-of-type(${position})`;
        }
        parts.unshift(part);
        current = parent;
      }
      result.push({ selector: parts.join(" > "), index: selectedMatch.index });
    }
    return result;
  }, normalizedLabel);
  if (matches.length !== 1) return undefined;
  const locator = page.locator(matches[0].selector);
  if (await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) return undefined;
  return locator;
}

function textLabelFromTarget(target: PlanTarget): string | undefined {
  if (target.strategy !== "css") return undefined;
  const value = target.value ?? "";
  const match = value.match(/:(?:text-is|has-text)\((['"])(.*?)\1\)/i);
  return match?.[2]?.trim() || undefined;
}

export async function uniqueVisibleActionOwner(page: Page, label: string): Promise<Locator | undefined> {
  const normalizedLabel = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const owners = await page.locator("body *").evaluateAll((elements, expectedLabel) => {
    const found = new Set<HTMLElement>();
    for (const candidate of elements) {
      if (!(candidate instanceof HTMLElement)) continue;
      const candidateText = (candidate.innerText || candidate.textContent || "").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      if (candidateText !== expectedLabel) continue;
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") continue;
      let owner: HTMLElement | null = candidate;
      while (owner && owner !== document.body) {
        const ownerStyle = getComputedStyle(owner);
        const role = owner.getAttribute("role")?.toLowerCase();
        const actionable = ["button", "a", "input", "select", "textarea"].includes(owner.tagName.toLowerCase())
          || ["button", "link", "option", "tab", "menuitem"].includes(role ?? "")
          || owner.hasAttribute("onclick") || owner.tabIndex >= 0
          || (ownerStyle.cursor === "pointer" && ownerStyle.pointerEvents !== "none");
        if (actionable) { found.add(owner); break; }
        owner = owner.parentElement;
      }
    }
    const result: Array<{ selector: string; disabled: boolean; hidden: boolean; depth: number }> = [];
    for (const owner of found) {
      const parts: string[] = [];
      let current: HTMLElement | null = owner;
      let depth = 0;
      while (current && current !== document.documentElement) {
        depth += 1;
        let part = current.tagName.toLowerCase();
        if (current.id) {
          parts.unshift(`${part}[id=${JSON.stringify(current.id)}]`);
          break;
        }
        const parent: HTMLElement | null = current.parentElement as HTMLElement | null;
        if (parent) {
          let position = 0;
          let sameTagIndex = 0;
          for (const sibling of Array.from(parent.children) as HTMLElement[]) {
            if (sibling.tagName === current.tagName) {
              position += 1;
              if (sibling === current) sameTagIndex = position;
            }
          }
          part += `:nth-of-type(${sameTagIndex})`;
        }
        parts.unshift(part);
        current = parent;
      }
      result.push({ selector: parts.join(" > "), disabled: (owner as HTMLButtonElement).disabled === true
        || owner.getAttribute("aria-disabled") === "true", hidden: owner.hidden, depth });
    }
    return result;
  }, normalizedLabel);
  // Frameworks often make both a label and its clickable wrapper actionable
  // through inherited cursor/listener state. Prefer the deepest matching owner
  // (the control nearest the observed label); equal-depth duplicates remain
  // ambiguous and fail closed.
  const usable = owners.filter(owner => !owner.disabled && !owner.hidden && owner.selector);
  const deepest = Math.max(...usable.map(owner => owner.depth), -1);
  const candidates = usable.filter(owner => owner.depth === deepest);
  if (candidates.length !== 1) return undefined;
  const locator = page.locator(candidates[0].selector);
  if (await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) return undefined;
  return locator;
}

export async function fillJiraSpecSegmentedCode(page: Page, value: string, target: PlanTarget): Promise<void> {
  if (target.strategy !== "semantic" || target.metadata?.repairType !== "jira_segmented_code") {
    throw new Error("JIRA_SPEC_SEGMENTED_CODE_EVIDENCE_INVALID");
  }
  const expectedCount = Number(target.metadata.resolvedCandidateId);
  if (!Number.isInteger(expectedCount) || expectedCount < 4 || expectedCount > 8) {
    throw new Error("JIRA_SPEC_SEGMENTED_CODE_EVIDENCE_INVALID");
  }
  await fillJiraSegmentedCode(page, value, expectedCount);
}

export async function navigateJiraSpecRoute(page: Page, route: string, configuredBaseUrl: string): Promise<void> {
  let requested: URL;
  let base: URL;
  try { requested = new URL(route, configuredBaseUrl); base = new URL(configuredBaseUrl); }
  catch { throw new Error("JIRA_SPEC_ROUTE_INVALID"); }
  if (requested.origin !== base.origin || !["http:", "https:"].includes(requested.protocol) || requested.username || requested.password) {
    throw new Error("JIRA_SPEC_ROUTE_OUTSIDE_APP_ORIGIN");
  }
  await page.goto(requested.toString(), { waitUntil: "domcontentloaded" });
}

export async function performJiraSpecSelection(locator: Locator, value: string): Promise<void> {
  const isCheckbox = await locator.evaluate(element => (element instanceof HTMLInputElement && element.type === "checkbox")
    || element.getAttribute("role")?.toLowerCase() === "checkbox");
  if (isCheckbox) {
    const normalized = value.trim().toLowerCase();
    if (normalized !== "true" && normalized !== "false") throw new Error("JIRA_CHECKBOX_VALUE_INVALID");
    const desired = normalized === "true";
    if (await locator.isChecked() !== desired) await locator.click();
    if (await locator.isChecked() !== desired) throw new Error("JIRA_SPEC_SELECTION_NOT_CONFIRMED");
    return;
  }
  const tagName = await locator.evaluate(element => element.tagName.toLowerCase());
  const isRange = await locator.evaluate(element => element instanceof HTMLInputElement && element.type === "range");
  if (isRange) {
    await setJiraRangeControlValue(locator, value);
    return;
  }
  if (tagName === "select") {
    const options = await locator.locator("option").evaluateAll(elements => elements.map(element => ({
      label: (element as HTMLOptionElement).label || element.textContent?.trim() || "",
      value: (element as HTMLOptionElement).value,
      disabled: (element as HTMLOptionElement).disabled || Boolean(element.closest("optgroup[disabled]")),
    })).filter(option => option.label));
    let label = value.trim();
    const matching = options.filter(option => !option.disabled && jiraOptionTextMatches(`${option.label} ${option.value}`, value));
    const chosen = chooseJiraMatchingOption(matching, option => `${option.value}\0${option.label}`, value);
    if (chosen) {
      await locator.selectOption({ value: chosen.value });
      if (!await locator.locator("option:checked").evaluateAll((options, selected) => options.some(option =>
        (option as HTMLOptionElement).value === selected.value && (option as HTMLOptionElement).label === selected.label), chosen)) {
        throw new Error("JIRA_SPEC_SELECTION_NOT_CONFIRMED");
      }
      return;
    }
    // A runtime value that equals an option's value/label up to case, accents and separators
    // (e.g. "bi-weekly" vs value "biweekly") identifies it; accept only a single such option.
    const key = normalizeKey(value);
    const canonical = key ? options.filter(option => !option.disabled && option.value !== ""
      && (normalizeKey(option.value) === key || normalizeKey(option.label) === key)) : [];
    if (canonical.length === 1) {
      await locator.selectOption({ value: canonical[0].value });
      if (!await locator.locator("option:checked").evaluateAll((checked, selected) => checked.some(option =>
        (option as HTMLOptionElement).value === selected.value && (option as HTMLOptionElement).label === selected.label), canonical[0])) {
        throw new Error("JIRA_SPEC_SELECTION_NOT_CONFIRMED");
      }
      return;
    }
    const exact = options.filter(option => option.label === label && !option.disabled);
    if (exact.length !== 1) {
      const selected = await chooseJiraDomTarget(locator.page(), value, buildJiraDomOptionSnapshot(await scanCurrentPage(locator.page()), options));
      const candidateLabel = selected?.locator.name;
      if (!candidateLabel || !options.some(option => option.label === candidateLabel && !option.disabled)) {
        // Last resort: a truncated runtime value that is a normalized prefix of exactly one
        // enabled, non-placeholder option identifies it; zero or several matches fail closed.
        const prefixed = key ? options.filter(option => !option.disabled && option.value !== ""
          && (normalizeKey(option.label).startsWith(key) || normalizeKey(option.value).startsWith(key))) : [];
        if (prefixed.length !== 1) throw new Error("JIRA_SPEC_SELECTION_NOT_UNIQUE");
        await locator.selectOption({ value: prefixed[0].value });
        if (!await locator.locator("option:checked").evaluateAll((checked, chosenOption) => checked.some(option =>
          (option as HTMLOptionElement).value === chosenOption.value && (option as HTMLOptionElement).label === chosenOption.label), prefixed[0])) {
          throw new Error("JIRA_SPEC_SELECTION_NOT_CONFIRMED");
        }
        return;
      }
      label = candidateLabel;
    }
    await locator.selectOption({ label });
    const selected = (await locator.locator("option:checked").textContent())?.trim();
    if (selected !== label) throw new Error("JIRA_SPEC_SELECTION_NOT_CONFIRMED");
    return;
  }
  const page = locator.page();
  await locator.click();
  const optionRoot = await jiraOptionSearchRoot(page, locator);
  let option = optionRoot.getByRole("option", { name: value, exact: true });
  if (await option.count() !== 1 || !await option.isVisible() || !await option.isEnabled()) {
    await selectJiraSpecObservedOption(page, locator, value);
    return;
  }
  await option.click();
}

/**
 * Some custom selects expose actionable rows without ARIA option roles. Resolve
 * those rows from their visible text and interaction evidence, then verify the
 * selected field value. This is Jira-spec runtime support; it does not alter the
 * Recording executor or its generated specs.
 */
async function selectJiraSpecObservedOption(page: Page, field: Locator, value: string): Promise<void> {
  const optionRoot = await jiraOptionSearchRoot(page, field);
  const query = normalizeVisibleText(value);
  if (!query) throw new Error("JIRA_SPEC_SELECTION_VALUE_MISSING");
  const ignored = new Set(["de", "del", "la", "el", "los", "las", "una", "un", "numero", "balance", "disponible"]);
  const expectedVariants = query.split(/\s+/).filter(token => token && !ignored.has(token)).map(token => {
    const variants = new Set([token]);
    if (token.length > 5 && token.endsWith("ces")) variants.add(`${token.slice(0, -3)}z`);
    else if (token.length > 4 && token.endsWith("es")) variants.add(token.slice(0, -2));
    else if (token.length > 3 && token.endsWith("s")) variants.add(token.slice(0, -1));
    else if (token.length > 3 && /[aeiou]$/.test(token)) variants.add(`${token}s`);
    return [...variants];
  });
  if (!expectedVariants.length) throw new Error("JIRA_SPEC_SELECTION_VALUE_MISSING");
  const deadline = Date.now() + 30_000;
  let aiAttempted = false;
  while (Date.now() < deadline) {
    const candidates = await optionRoot.locator("*").evaluateAll((elements, expected) => {
      const found: Array<{ id?: string; testId?: string; role?: string; label: string; tag: string; text: string; key: string }> = [];
      const ignored = new Set(["de", "del", "la", "el", "los", "las", "una", "un", "numero", "balance", "disponible"]);
      for (const element of elements) {
        if (!(element instanceof HTMLElement)) continue;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const text = element.innerText.trim();
        const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
        const observedTokens = normalized.split(" ").filter(token => token && !ignored.has(token));
        if (!expected.every((variants: string[]) => observedTokens.some(token => variants.includes(token)))
          || style.display === "none" || style.visibility === "hidden"
          || style.pointerEvents === "none" || rect.width <= 0 || rect.height <= 0) continue;
        if (Array.from(element.children).some(child => {
          if (!(child instanceof HTMLElement)) return false;
          const childNormalized = child.innerText.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
          const childTokens = childNormalized.split(" ").filter(token => token && !ignored.has(token));
          return expected.every((variants: string[]) => childTokens.some(token => variants.includes(token)));
        })) continue;
        let owner: HTMLElement | null = element;
        for (let depth = 0; owner && depth < 7; depth += 1, owner = owner.parentElement) {
          const tag = owner.tagName.toLowerCase();
          const role = owner.getAttribute("role")?.toLowerCase();
          const ownerStyle = window.getComputedStyle(owner);
          const actionable = ["button", "a", "option"].includes(tag)
            || ["option", "menuitem", "button"].includes(role ?? "")
            || owner.hasAttribute("onclick") || owner.tabIndex >= 0
            || (ownerStyle.cursor === "pointer" && ownerStyle.pointerEvents !== "none");
          if (!actionable) continue;
          if (owner.closest('nav,aside,[role="navigation"],[role="complementary"]')) break;
          if (owner.closest('[aria-disabled="true"],[hidden]') || owner.matches(':disabled')) break;
          const ownerText = owner.innerText.trim();
          const id = owner.id || undefined;
          const testId = owner.getAttribute("data-testid") || owner.getAttribute("data-test") || undefined;
          const label = owner.getAttribute("aria-label") || ownerText;
          const key = id ? `id:${id}` : testId ? `testid:${testId}` : `${role ?? tag}:${label.toLocaleLowerCase()}`;
          found.push({ id, testId, role, label, tag, text: ownerText, key });
          break;
        }
      }
      return found.filter((candidate, index, all) => all.findIndex(other => other.key === candidate.key) === index);
    }, expectedVariants);

    const candidate = chooseJiraMatchingOption(candidates, item => item.key, query);
    if (candidate) {
      const observed = candidate.id ? page.locator(`[id=${JSON.stringify(candidate.id)}]`)
        : candidate.testId ? page.getByTestId(candidate.testId)
        : candidate.role && candidate.label
          ? page.getByRole(candidate.role as Parameters<Page["getByRole"]>[0], { name: candidate.label, exact: true })
          : page.locator(`${candidate.tag}:visible:text-is(${JSON.stringify(candidate.text)})`);
      if (await observed.count() !== 1 || !await observed.isVisible() || !await observed.isEnabled()) throw new Error("JIRA_SPEC_OPTION_NOT_UNIQUE");
      await observed.click();
      await verifyJiraSpecSelectedState(page, field, candidate.label);
      return;
    }

    if (!aiAttempted) {
      aiAttempted = true;
      const snapshot = await scanCurrentPage(page);
      const intentTokens = query.split(" ").filter(token => token.length > 2
        && !["de", "del", "la", "el", "los", "las", "numero", "seleccione"].includes(token));
      const options = snapshot.elements.filter(element => {
        if (!element.visible || element.disabled || element.actionOwner !== true || element.actionability === "NON_ACTIONABLE") return false;
        const isOptionLike = ["option", "menuitem", "button"].includes(element.role ?? "")
          || ["button", "option"].includes(element.tagName ?? "")
          || element.actionability === "FRAMEWORK_ACTIONABLE" || element.actionability === "SEMANTIC_ACTIONABLE";
        if (!isOptionLike) return false;
        const label = normalizeVisibleText(element.ariaLabel || element.accessibleName || element.label || element.text || element.title || "");
        return Boolean(label) && intentTokens.some(token => label.includes(token));
      });
      const selected = await chooseJiraDomTarget(page, value, { ...snapshot, elements: options });
      const observed = selected && locatorForJiraDomCandidate(page, selected);
      if (selected && observed && await observed.count() === 1 && await observed.isVisible() && await observed.isEnabled()
        && await jiraOptionBelongsToRoot(optionRoot, observed)) {
        await observed.click();
        await verifyJiraSpecSelectedState(page, field, selected.label);
        return;
      }
    }
    await page.waitForTimeout(300);
  }
  throw new Error("JIRA_SPEC_OPTION_NOT_UNIQUE");
}

async function verifyJiraSpecSelectedState(page: Page, field: Locator, observedOptionLabel: string): Promise<void> {
  const expectedTokens = normalizeVisibleText(observedOptionLabel).split(" ").filter(token => token.length > 2
    && !/^\d+$/.test(token)
    && !["de", "del", "la", "el", "los", "las", "numero", "balance", "disponible"].includes(token));
  if (!expectedTokens.length) throw new Error("JIRA_SPEC_SELECTION_NOT_CONFIRMED");
  const contentRoot = await page.locator("main,[role='main']").count() ? "main,[role='main']" : "body";
  await expect.poll(async () => {
    const pageText = normalizeVisibleText(await page.locator(contentRoot).innerText().catch(() => ""));
    const fieldText = normalizeVisibleText(`${await field.innerText({ timeout: 250 }).catch(() => "")} ${await field.getAttribute("aria-label", { timeout: 250 }).catch(() => "") ?? ""}`);
    // Apps often replace the select trigger after choosing an item. Confirm the
    // observed option is represented in the live page or in the surviving field;
    // do not bind verification to a stale pre-selection locator.
    const confirmedTokens = expectedTokens.filter(token => pageText.includes(token) || fieldText.includes(token));
    return confirmedTokens.length === expectedTokens.length;
  }, { timeout: 5_000, intervals: [100, 250, 500] }).toBe(true);
}

export async function assertJiraSpecAuthGate(page: Page, timeoutMs = 15000): Promise<void> {
  await expect.poll(async () => {
    const gate = detectAuthGate(await scanCurrentPage(page));
    return gate.detected && gate.stage !== "authenticated_landing" && gate.stage !== "unknown";
  }, { timeout: timeoutMs }).toBe(true);
}

/**
 * After a recorded classic-login submit, wait (condition-driven) for a recognized post-submit state before
 * AuthFlow runs. AuthFlow maps classic login UI to not_started and re-navigates "/", which is unsafe here.
 * A login form that stays visible means rejected credentials: fail closed, never authenticated.
 */
export async function awaitJiraSpecPostLoginTransition(
  page: Page,
  timeoutMs: number = config.execution.defaultTimeoutMs,
  observe: (page: Page) => Promise<{ stage: string }> = observeJiraSpecPostLoginStage,
): Promise<"access_code_gate" | "standard"> {
  const deadline = Date.now() + timeoutMs;
  let stage = "unknown";
  for (;;) {
    stage = (await observe(page)).stage;
    if (stage === JIRA_ACCESS_CODE_STAGE) return "access_code_gate";
    if (stage !== "credentials" && stage !== "unknown") return "standard";
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))));
  }
  throw new Error(`JIRA_SPEC_AUTH_TRANSITION_FAILED: no post-login state within ${timeoutMs}ms (last stage: ${stage}${stage === "credentials" ? "; login form still visible, credentials likely rejected" : ""})`);
}

/**
 * Jira-only access-code gate (e.g. "Verificación de acceso" + "Código de acceso" + "Continuar") that
 * the shared detectAuthGate does not recognize. Evidence is the visible DOM only; it is consulted
 * solely when the shared detector reports "unknown", so standard gates keep using AuthFlow.
 */
const JIRA_ACCESS_CODE_STAGE = "access_code_gate";
const JIRA_ACCESS_CODE_FIELD = /c[oó]digo de (?:acceso|verificaci[oó]n)|(?:access|verification) code/i;
const JIRA_ACCESS_CODE_CONTINUE = /^\s*(?:continuar|continue|verificar|verify|validar|confirmar)\s*$/i;

export interface JiraAccessCodeGateEvidence { fields: number; continueControls: number; enabledContinueControls: number }

/** Structural, app-agnostic evidence of an authenticated application shell (visible DOM only). */
export interface JiraAuthenticatedShellEvidence {
  authFields: number;      // visible password/username/OTP-like inputs
  authAlerts: number;      // visible alert/error regions with authentication-failure wording
  mainRegions: number;     // visible main landmarks
  navControls: number;     // visible links/buttons inside visible nav/aside landmarks
  mainTextLength: number;  // visible text length inside main
  mainOperables: number;   // visible headings/links/buttons/inputs inside main
}

export const JIRA_NO_SHELL_EVIDENCE: JiraAuthenticatedShellEvidence = { authFields: 0, authAlerts: 0, mainRegions: 0, navControls: 0, mainTextLength: 0, mainOperables: 0 };

const JIRA_SHELL_MIN_MAIN_TEXT = 20;

/** Fail closed: every signal must hold; any visible login field/auth alert or missing shell part rejects. */
export function isJiraAuthenticatedShell(e: JiraAuthenticatedShellEvidence): boolean {
  return e.authFields === 0 && e.authAlerts === 0 && e.mainRegions >= 1 && e.navControls >= 1
    && e.mainTextLength >= JIRA_SHELL_MIN_MAIN_TEXT && e.mainOperables >= 1;
}

async function collectJiraAuthenticatedShellEvidence(page: Page): Promise<JiraAuthenticatedShellEvidence> {
  return page.evaluate(({ credentialWords, errorWords, codeWords }) => {
    const credentialRe = new RegExp(credentialWords, "i");
    const errorRe = new RegExp(errorWords, "i");
    const codeRe = new RegExp(codeWords, "i");
    // Object methods, not const-bound arrows: tsx/esbuild keepNames injects `__name(...)` around
    // the latter, and that helper does not exist in the page (evaluate threw ReferenceError).
    const dom = {
      visible(el: Element) {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
      },
      all(selector: string, root: ParentNode) {
        return [...root.querySelectorAll(selector)].filter(el => dom.visible(el));
      },
      labelOf(el: Element) {
        return [
          el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("autocomplete"),
          (el as HTMLInputElement).labels ? [...(el as HTMLInputElement).labels!].map(l => l.textContent).join(" ") : "",
        ].join(" ");
      },
    };
    const authFields = dom.all("input, textarea", document).filter(el => {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (["hidden", "checkbox", "radio", "submit", "button", "image", "file", "range", "color"].includes(type)) return false;
      return type === "password" || credentialRe.test(dom.labelOf(el)) || codeRe.test(dom.labelOf(el));
    }).length;
    const authAlerts = dom.all("[role=alert], [role=alertdialog]", document).filter(el => errorRe.test(el.textContent ?? "")).length;
    const mains = dom.all("main, [role=main]", document);
    const navControls = dom.all("nav, aside, [role=navigation], [role=complementary]", document)
      .reduce((sum, nav) => sum + dom.all("a[href], button, [role=link], [role=button], [role=menuitem]", nav).length, 0);
    const main = mains[0];
    return {
      authFields, authAlerts, mainRegions: mains.length, navControls,
      mainTextLength: main ? ((main as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim().length : 0,
      mainOperables: main ? dom.all("h1, h2, h3, h4, a[href], button, input, select, textarea, [role=button], [role=link], [role=tab]", main).length : 0,
    };
  }, {
    credentialWords: "contrase[ñn]a|password|usuario|username|user ?name|e-?mail|correo|login|identificaci[oó]n|documento|\\bpin\\b|token|username",
    errorWords: "inv[aá]lid|incorrect|error|expir|no autorizad|denegad|rechaz|fall[oó]|fail|unauthori[sz]ed|denied|intentos",
    codeWords: JIRA_ACCESS_CODE_FIELD.source + "|one-time-code|\\botp\\b",
  }).catch(() => JIRA_NO_SHELL_EVIDENCE);
}

export interface JiraAccessCodeGateDriver {
  evidence(): Promise<JiraAccessCodeGateEvidence>;
  /** Consulted only when the shared detector reports "unknown" after the code field disappeared. */
  shell(): Promise<JiraAuthenticatedShellEvidence>;
  fill(code: string): Promise<void>;
  readBack(): Promise<string>;
  clickContinue(): Promise<void>;
  stage(): Promise<string>;
}

async function visibleLocators(locator: Locator): Promise<Locator[]> {
  const visible: Locator[] = [];
  for (const candidate of await locator.all().catch(() => [] as Locator[])) {
    if (await candidate.isVisible().catch(() => false)) visible.push(candidate);
  }
  return visible;
}

export function jiraAccessCodeGatePageDriver(page: Page): JiraAccessCodeGateDriver {
  const fields = () => visibleLocators(page.getByRole("textbox", { name: JIRA_ACCESS_CODE_FIELD }));
  const continues = () => visibleLocators(page.getByRole("button", { name: JIRA_ACCESS_CODE_CONTINUE }));
  const only = async (list: Promise<Locator[]>, code: string) => {
    const found = await list;
    if (found.length !== 1) throw new Error(`JIRA_SPEC_ACCESS_CODE_${code}_NOT_UNIQUE: ${found.length} visible`);
    return found[0];
  };
  return {
    evidence: async () => {
      const buttons = await continues();
      let enabled = 0;
      for (const button of buttons) if (await button.isEnabled().catch(() => false)) enabled += 1;
      return { fields: (await fields()).length, continueControls: buttons.length, enabledContinueControls: enabled };
    },
    fill: async code => { await (await only(fields(), "FIELD")).fill(code); },
    readBack: async () => (await only(fields(), "FIELD")).inputValue(),
    clickContinue: async () => { await (await only(continues(), "CONTINUE")).click(); },
    shell: () => collectJiraAuthenticatedShellEvidence(page),
    stage: async () => detectAuthGate(await scanCurrentPage(page)).stage,
  };
}

async function observeJiraSpecPostLoginStage(page: Page): Promise<{ stage: string }> {
  const gate = detectAuthGate(await scanCurrentPage(page));
  if (gate.stage !== "unknown") return gate;
  // Presence of an access-code field is enough to route; uniqueness is enforced on completion (fail closed).
  return (await jiraAccessCodeGatePageDriver(page).evidence()).fields > 0 ? { stage: JIRA_ACCESS_CODE_STAGE } : gate;
}

const JIRA_ACCESS_CODE_PROFILE_KEYS = ["access_code", "codigo_acceso", "otp"];

/** Source order: declared client alias, explicit profile access-code values, then OTP_SECRET; the value is never logged or echoed. */
export function resolveJiraAccessCodeOtp(testData: Record<string, unknown>, alias: string): string | undefined {
  const clients = (testData as { clients?: Record<string, { otp?: unknown } | undefined> }).clients;
  const fromClient = clients?.[alias]?.otp;
  if (typeof fromClient === "string" && fromClient.trim()) return fromClient;
  const auth = testData.auth;
  const authMap = auth && typeof auth === "object" ? auth as Record<string, unknown> : {};
  const flat = new Set<string>();
  for (const key of JIRA_ACCESS_CODE_PROFILE_KEYS) {
    for (const value of [testData[key], testData[`auth.${key}`], authMap[key]]) {
      if (typeof value === "string" && value.trim()) flat.add(value);
    }
  }
  if (flat.size > 1) throw new Error("JIRA_SPEC_ACCESS_CODE_AMBIGUOUS: conflicting access-code values in profile test data");
  const otp = flat.size === 1 ? [...flat][0] : process.env.OTP_SECRET;
  return typeof otp === "string" && otp.trim() ? otp : undefined;
}

export async function completeJiraSpecAccessCodeGate(
  page: Page,
  testData: Record<string, unknown>,
  alias: string,
  timeoutMs: number = config.execution.defaultTimeoutMs,
  driver: JiraAccessCodeGateDriver = jiraAccessCodeGatePageDriver(page),
): Promise<void> {
  const otp = resolveJiraAccessCodeOtp(testData, alias);
  if (!otp) throw new Error(`JIRA_SPEC_ACCESS_CODE_OTP_MISSING: no otp configured for auth client '${alias}'`);
  const deadline = Date.now() + timeoutMs;
  const pause = () => new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))));

  let evidence = await driver.evidence();
  while (!(evidence.fields === 1 && evidence.continueControls === 1) && Date.now() < deadline) {
    await pause();
    evidence = await driver.evidence();
  }
  if (evidence.fields !== 1 || evidence.continueControls !== 1) {
    throw new Error(`JIRA_SPEC_ACCESS_CODE_GATE_NOT_ACTIONABLE: code fields=${evidence.fields}, continue controls=${evidence.continueControls} (exactly 1 each required)`);
  }

  await driver.fill(otp);
  if ((await driver.readBack()) !== otp) throw new Error("JIRA_SPEC_ACCESS_CODE_READBACK_MISMATCH");

  evidence = await driver.evidence();
  while (evidence.enabledContinueControls !== 1 && Date.now() < deadline) {
    await pause();
    evidence = await driver.evidence();
  }
  if (evidence.enabledContinueControls !== 1) throw new Error("JIRA_SPEC_ACCESS_CODE_CONTINUE_DISABLED");
  await driver.clickContinue();

  // Real transition = the code field is gone AND the shared detector positively recognizes a post-gate
  // state (landing or a later auth stage). "credentials" never counts; "unknown" counts only with positive
  // authenticated-shell evidence (nav + substantial main, no login fields or auth alerts), else blank/error/form fail closed.
  for (;;) {
    evidence = await driver.evidence();
    if (evidence.fields === 0) {
      const next = await driver.stage();
      if (next === "unknown" ? isJiraAuthenticatedShell(await driver.shell()) : next !== "credentials") return;
    }
    if (Date.now() >= deadline) break;
    await pause();
  }
  throw new Error(evidence.fields > 0
    ? "JIRA_SPEC_ACCESS_CODE_REJECTED: access-code field still visible after continue (code likely invalid)"
    : "JIRA_SPEC_ACCESS_CODE_NO_TRANSITION: code field gone but no recognized post-gate state (login form or unknown page)");
}

/**
 * Jira assertions describe an observed page state, not an action target. A
 * label can legitimately occur in both navigation and the page content, so
 * these checks must not require a unique locator as clicks and fills do.
 */
export async function assertJiraSpecVisibleText(page: Page, expected: string, timeoutMs = 15000, semanticIntent = expected): Promise<void> {
  const normalizedExpected = normalizeVisibleText(expected);
  if (!normalizedExpected) throw new Error("JIRA_SPEC_ASSERTION_TEXT_MISSING");
  const meaningfulTokens = normalizeVisibleText(stripJiraNotificationChannelWord(expected)).split(" ").filter(token => token.length > 2
    && !["identificable", "identificado", "identificada", "visible", "mostrado", "mostrada"].includes(token));
  // Only a loading label seen at mutation time during the immediately preceding click may stand in for a
  // label that already vanished; every token must match and any other expected text still needs live evidence.
  const clickLoadingLabels = jiraSpecClickLoadingLabels.get(page);
  jiraSpecClickLoadingLabels.delete(page);
  if (clickLoadingLabels && JIRA_LOADING_LABEL.test(expected) && meaningfulTokens.length
    && clickLoadingLabels.some(label => meaningfulTokens.every(token => normalizeVisibleText(label).includes(token)))) return;
  // Explicit = the step intent quotes the expected text verbatim ("Transferencias").
  const explicitExactText = [...semanticIntent.matchAll(/["'“«]([^"'”»]+)["'”»]/g)]
    .some(match => normalizeVisibleText(match[1]) === normalizedExpected);
  const expectsOperationReference = normalizedExpected.includes("referencia")
    && (normalizedExpected.includes("operacion") || normalizedExpected.includes("transaccion"));
  const expectsAccountPair = /\bcuentas? (?:involucradas?|seleccionadas?)\b/.test(normalizedExpected);
  try {
    await expect.poll(async () => {
      let contentEvidence: { text: string; navigationText: string[]; operationReferenceWithValue: boolean; numericValues: Array<{ value: string; min?: string; max?: string; step?: string }> };
      try {
        contentEvidence = await page.locator("body").evaluate((root, expectsReference) => {
          const excludedAncestor = "nav,aside,[role='navigation'],[role='menu'],[aria-hidden='true']";
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const visibleText: string[] = [];
          const navigationText: string[] = [];
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const text = node.textContent?.trim();
            const parent = node.parentElement;
            if (!text || !parent) continue;
            const inNavigation = Boolean(parent.closest(excludedAncestor));
            if (inNavigation && (parent.closest("[aria-hidden='true']") || !parent.closest("nav,aside,[role='navigation'],[role='menu']"))) continue;
            let visible = true;
            for (let element: HTMLElement | null = parent; element && root.contains(element); element = element.parentElement) {
              const style = getComputedStyle(element);
              if (element.hidden || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
                visible = false;
                break;
              }
            }
            if (!visible) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            if (range.getClientRects().length > 0) (inNavigation ? navigationText : visibleText).push(text);
          }
          let operationReferenceWithValue = false;
          if (expectsReference) {
            const labels = Array.from(root.querySelectorAll<HTMLElement>("label,dt,th,td,span,p,div"))
              .filter(element => {
                if (element.closest(excludedAncestor)) return false;
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return false;
                const label = (element.innerText || element.textContent || "").toLowerCase().normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
                return /^(?:no )?referencia$/.test(label);
              });
            for (const label of labels) {
              let branch: HTMLElement | null = label;
              for (let depth = 0; depth < 4 && branch?.parentElement; depth += 1) {
                const parent: HTMLElement = branch.parentElement;
                const valueText = Array.from(parent.children)
                  .filter(sibling => sibling !== branch
                    && !sibling.closest(excludedAncestor))
                  .map(sibling => (sibling as HTMLElement).innerText || sibling.textContent || "")
                  .join(" ")
                  .toLowerCase()
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9]+/g, " ")
                  .trim();
                if (/\b[a-z0-9]*\d[a-z0-9]{3,}\b/.test(valueText)) {
                  operationReferenceWithValue = true;
                  break;
                }
                branch = parent;
              }
              if (operationReferenceWithValue) break;
            }
          }
          const numericValues = Array.from(root.querySelectorAll<HTMLElement>("input[type=number],input[type=range],[role=spinbutton],[role=slider]"))
            .filter(element => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              const identity = `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("name") ?? ""} ${element.id} ${element.getAttribute("placeholder") ?? ""}`;
              return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
                && !element.closest(excludedAncestor)
                && !/(?:password|contrase|clave|otp|token|codigo|código|pin|secret|security)/i.test(identity);
            })
            .map(element => ({
              value: element instanceof HTMLInputElement ? element.value : element.getAttribute("aria-valuenow") ?? element.getAttribute("aria-valuetext") ?? "",
              min: element instanceof HTMLInputElement ? element.min : element.getAttribute("aria-valuemin") ?? "",
              max: element instanceof HTMLInputElement ? element.max : element.getAttribute("aria-valuemax") ?? "",
              step: element instanceof HTMLInputElement ? element.step : "",
            }))
            .filter(state => Boolean(state.value || state.min || state.max || state.step));
          return { text: visibleText.join(" "), navigationText, operationReferenceWithValue, numericValues };
        }, expectsOperationReference);
      } catch (error) {
        // A content assertion may run immediately after an action that navigates.
        // Playwright destroys the old document's execution context during that
        // transition; treat only that transient state as a non-match and let the
        // bounded poll inspect the destination document.
        if (isJiraSpecNavigationContextError(error)) return "";
        throw error;
      }
      const normalizedContent = normalizeVisibleText(contentEvidence.text);
      const tokens = meaningfulTokens.length ? meaningfulTokens : normalizedExpected.split(" ");
      const visibleTextMatches = tokens.every(token => normalizedContent.includes(token));
      // A receipt may present the accounts involved as two separate fields
      // (origin and destination) instead of the HU's summary phrase. Require
      // both visible account roles; never pass from one account label alone.
      const hasVisibleAccountPair = expectsAccountPair
        && /\bcuenta(?: de)? (?:origen|debito)\b/.test(normalizedContent)
        && /\bcuenta(?: de)? (?:destino|receptora|recepcion)\b/.test(normalizedContent);
      const hasMatchingNumericValue = contentEvidence.numericValues.some(state => jiraNumericValueMatches(state.value, expected)
        || (isJiraRangeMetadataAssertion(expected) && jiraRangeMetadataAssertionMatches(state, expected)));
      // An explicitly quoted label may be satisfied by navigation, but only by
      // exactly one whole-text match; duplicates fail closed.
      const navigationExactMatch = explicitExactText
        && contentEvidence.navigationText.filter(text => normalizeVisibleText(text) === normalizedExpected).length === 1;
      const alertEquivalent = !visibleTextMatches && (await readVisibleJiraAlertTexts(page).catch(() => [])).some(text => jiraAlertErrorEquivalenceMatches(text, expected));
      return visibleTextMatches || navigationExactMatch || alertEquivalent || jiraCredentialRejectionMatches(contentEvidence.text, expected)
        || contentEvidence.operationReferenceWithValue || hasVisibleAccountPair || hasMatchingNumericValue;
    }, { timeout: timeoutMs, intervals: [100, 250, 500] }).toBe(true);
  } catch (error) {
    // Invoke AI only after deterministic page-text matching exhausts its wait.
    // It can approve only cited, sanitized text visible in the current page.
    if (await isJiraDomAssertionSupported(page, semanticIntent).catch(() => false)) return;
    throw error;
  }
}

function isJiraSpecNavigationContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /execution context was destroyed|cannot find context with specified id/i.test(message);
}

function normalizeVisibleText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function parseStringMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return {}; }
}

function normalizeKey(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

const CONNECTOR_TOKENS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "para", "por", "of", "the", "a", "an", "and", "for"]);

/** Accent/separator-insensitive token key that ignores common ES/EN connector words. */
function semanticKey(value: string): string {
  const tokens = value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  const content = tokens.filter(token => !CONNECTOR_TOKENS.has(token));
  return (content.length ? content : tokens).join("");
}

/** A promoted validation oracle observes an invalid control and its associated visible error. */
export async function assertJiraSpecFieldValidation(page: Page, fieldLabel: string, timeoutMs = 15000): Promise<void> {
  if (!fieldLabel.trim()) throw new Error("JIRA_SPEC_FIELD_VALIDATION_LABEL_MISSING");
  await expect.poll(async () => Boolean(await observeJiraFieldValidation(page, fieldLabel)), { timeout: timeoutMs })
    .toBe(true).catch(() => { throw new Error("JIRA_SPEC_FIELD_VALIDATION_NOT_OBSERVED"); });
}

export async function resolveJiraSpecValue(key: string, appSlug: string, sectionSlug: string, automationId: string): Promise<string> {
  const requestedKey = normalizeKey(key);
  const requestedSemantic = semanticKey(key);
  const runtimeValues = {
    ...parseStringMap(process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON),
    ...parseStringMap(process.env.JIRA_SPEC_RUNTIME_VALUES_JSON),
  };
  const runtimeValue = Object.entries(runtimeValues).find(([candidate]) => normalizeKey(candidate) === requestedKey)?.[1];
  if (runtimeValue?.trim()) return runtimeValue;

  const caseRuntimeValue = await resolveJiraCaseRuntimeValue({ appSlug, automationId, requestedKey });
  if (caseRuntimeValue?.trim()) return caseRuntimeValue;

  const profile = await loadAppConfig(appSlug);
  if (profile) {
    const app = { ...config.app, ...profile, appProfile: appSlug, appSlug } as typeof config.app;
    const context = buildDataContext({ ...config, app });
    const configured = context.entries.find(entry => normalizeKey(entry.key) === requestedKey)?.value;
    if (configured?.trim()) return configured;

    // The profile may store the datum under a different canonical key and declare the requested
    // name as a semantic alias. Accept it only when every matching configured entry agrees.
    const aliasKeys = new Set<string>();
    const declared = profile.testDataAliases;
    if (declared && typeof declared === "object" && !Array.isArray(declared)) {
      for (const [canonicalKey, aliases] of Object.entries(declared as Record<string, unknown>)) {
        if (!Array.isArray(aliases)) continue;
        const members = [canonicalKey, ...aliases.filter((alias): alias is string => typeof alias === "string")];
        const group = members.flatMap(member => [normalizeKey(member), semanticKey(member)]);
        if (group.includes(requestedKey) || group.includes(requestedSemantic)) group.forEach(member => aliasKeys.add(member));
      }
    }
    const aliasValues = new Set(context.entries
      .filter(entry => (aliasKeys.has(normalizeKey(entry.key)) || aliasKeys.has(semanticKey(entry.key))) && entry.value.trim())
      .map(entry => entry.value));
    if (aliasValues.size > 1) throw new Error("JIRA_SPEC_REQUIRED_DATA_AMBIGUOUS");
    if (aliasValues.size === 1) return [...aliasValues][0];
  }

  const manifestPath = path.resolve("automations", "apps", appSlug, "sections", sectionSlug, "cases", automationId, "promoted-data.json");
  const manifest = loadPromotedDataManifestSync(manifestPath);
  const manifestValue = manifest?.entries.find(entry => normalizeKey(entry.key) === requestedKey)?.value;
  if (manifestValue?.trim()) return manifestValue;
  throw new Error("JIRA_SPEC_REQUIRED_DATA_MISSING");
}

async function resolveJiraCaseRuntimeValue(input: {
  appSlug: string;
  automationId: string;
  requestedKey: string;
}): Promise<string | undefined> {
  const contextPath = process.env.DISCOVERY_RUNTIME_CONTEXT?.trim();
  if (!contextPath) return undefined;
  try {
    const indexPath = path.resolve("automations", "apps", input.appSlug, "index.json");
    const index = await loadAutomationIndex(indexPath);
    const candidates = index.automations.filter((entry) =>
      entry.id === input.automationId
      && entry.caseId !== undefined
      && (entry.appSlug ?? entry.appProfile)?.trim().toLowerCase() === input.appSlug.trim().toLowerCase(),
    );
    if (candidates.length !== 1) return undefined;
    const caseId = candidates[0].caseId;
    if (!Number.isSafeInteger(caseId) || (caseId ?? 0) <= 0) return undefined;
    const parsed = JSON.parse(await fs.readFile(contextPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const caseEntries = (parsed as Record<string, unknown>)[String(caseId)];
    if (!Array.isArray(caseEntries)) return undefined;
    const matches = caseEntries.filter((entry): entry is { key: string; value: string } =>
      Boolean(entry && typeof entry === "object"
        && typeof (entry as { key?: unknown }).key === "string"
        && typeof (entry as { value?: unknown }).value === "string"
        && normalizeKey((entry as { key: string }).key) === input.requestedKey),
    );
    return matches.length === 1 && matches[0].value.trim() ? matches[0].value : undefined;
  } catch {
    return undefined;
  }
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Deep-merges plain objects (so `clients` merges per alias/property); `override` wins on every explicit leaf, arrays and scalars replace. */
export function mergeJiraAuthTestData(defaults: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(override)) {
    const base = merged[key];
    merged[key] = isPlainRecord(base) && isPlainRecord(value) ? mergeJiraAuthTestData(base, value) : value;
  }
  return merged;
}

/** Profile testData are defaults; APP_TEST_DATA_JSON fields win. Conflicting access-code spellings still fail closed in resolveJiraAccessCodeOtp. */
export async function resolveJiraSpecAuthTestData(appSlug: string): Promise<Record<string, unknown>> {
  let fromEnv: Record<string, unknown> = {};
  const configured = process.env.APP_TEST_DATA_JSON;
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as unknown;
      if (isPlainRecord(parsed)) fromEnv = parsed;
    } catch { throw new Error("JIRA_SPEC_AUTH_DATA_INVALID"); }
  }
  const testData = (await loadAppConfig(appSlug))?.testData;
  return mergeJiraAuthTestData(isPlainRecord(testData) ? testData : {}, fromEnv);
}

export type JiraRowMatchStatus = "ok" | "container_missing" | "container_ambiguous" | "row_missing" | "row_ambiguous";

const JIRA_ROW_MATCH_SELECTOR = "tbody tr, [role='row']";

function normalizeJiraRowText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ")
    .split(" ").filter(token => !["de", "del", "la", "el", "los", "las"].includes(token)).join(" ");
}

/**
 * One observation of "exactly one data row of the NAMED container contains every entered value".
 * The container is found only by its accessible name (table/grid/region/list/group) or, when no
 * such role matches, by one exact visible heading whose nearest ancestor with data rows holds a
 * single table/grid. Row count alone, text outside the container, or several matching rows never pass.
 * Each value must equal (normalized) one visible data cell of the row; substring matches never pass.
 * Shared by Discovery and the generated spec so both apply the same authority.
 */
export async function observeJiraNamedRowMatch(page: Page, container: string, values: string[]): Promise<JiraRowMatchStatus> {
  const named: Locator[] = [];
  for (const role of ["table", "grid", "region", "list", "group"] as const) {
    const found = page.getByRole(role, { name: container, exact: true });
    for (let index = 0; index < await found.count().catch(() => 0); index += 1) {
      if (await found.nth(index).isVisible().catch(() => false)) named.push(found.nth(index));
    }
  }
  let scope: Locator | undefined;
  if (named.length > 1) return "container_ambiguous";
  if (named.length === 1) scope = named[0];
  else {
    const headings = page.getByRole("heading", { name: container, exact: true });
    if (await headings.count().catch(() => 0) === 0) return "container_missing";
    if (await headings.count().catch(() => 0) !== 1 || !await headings.isVisible().catch(() => false)) return "container_ambiguous";
    const holder = headings.locator("xpath=ancestor::*[.//td or .//*[@role='gridcell']][1]");
    if (await holder.count().catch(() => 0) !== 1) return "container_missing";
    if (await holder.locator("table, [role='grid'], [role='table']").count().catch(() => 0) !== 1) return "container_ambiguous";
    scope = holder;
  }
  const rows = scope.locator(JIRA_ROW_MATCH_SELECTOR).filter({ has: page.locator("td, [role='gridcell']") });
  const wanted = values.map(normalizeJiraRowText);
  let matching = 0;
  for (let index = 0; index < await rows.count().catch(() => 0); index += 1) {
    const row = rows.nth(index);
    if (!await row.isVisible().catch(() => false)) continue;
    // Strict: every value must equal one whole visible data cell (no substring, so "Ana" never matches "Anabel").
    const cells = (await row.locator("td, [role='gridcell']").allInnerTexts().catch(() => [] as string[])).map(normalizeJiraRowText);
    if (wanted.every(value => value !== "" && cells.includes(value))) matching += 1;
  }
  return matching === 1 ? "ok" : matching === 0 ? "row_missing" : "row_ambiguous";
}

/** Spec-side bound row oracle: named container + exactly one row containing every entered value. Never degrades to text. */
export async function assertJiraSpecRowMatch(page: Page, container: string, values: string[], timeoutMs = 15000): Promise<void> {
  if (!container.trim()) throw new Error("JIRA_ROW_CONTAINER_UNOBSERVABLE");
  if (!values.length || values.some(value => !value.trim())) throw new Error("JIRA_ROW_DATA_BINDING_MISSING");
  let status: JiraRowMatchStatus = "container_missing";
  await expect.poll(async () => { status = await observeJiraNamedRowMatch(page, container, values); return status; }, { timeout: timeoutMs })
    .toBe("ok").catch(() => {
      throw new Error(status === "container_missing" ? "JIRA_ROW_CONTAINER_UNOBSERVABLE"
        : status === "container_ambiguous" ? "JIRA_ROW_CONTAINER_AMBIGUOUS"
        : status === "row_ambiguous" ? "JIRA_ROW_AMBIGUOUS" : "JIRA_ROW_NOT_OBSERVED");
    });
}

/** Absence is measured against all exact matches, including duplicate visible text. */
export async function assertJiraSpecAbsentText(page: Page, target: string) {
  if (!target.trim()) throw new Error("JIRA_ABSENCE_TARGET_MISSING");
  await expect.poll(async () => {
    const matches = await page.getByText(target,{exact:true}).all();
    return (await Promise.all(matches.map(locator=>locator.isVisible()))).some(Boolean);
  },{timeout:15000}).toBe(false);
}
