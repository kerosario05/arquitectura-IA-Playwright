import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { capturePageDiagnostics, waitForPromotedSpecStepReady } from "../../browser/promoted-spec-helpers";
import { waitForStablePageState } from "../../discovery/page-stability-detector";

export type PromotedExpectedEffect =
  | "none"
  | "navigation"
  | "modal_or_form_or_navigation"
  | "ui_change";

export type PromotedRuntimeConfig = {
  enabled: boolean;
  actionTimeoutMs: number;
  stabilityTimeoutMs: number;
  retryEnabled: boolean;
  captureDiagnostics: boolean;
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
};

export type PromotedActionOptions = {
  stepIndex: number;
  target: string;
  actionIntent: string;
  expectedEffect?: PromotedExpectedEffect;
  sensitive?: boolean;
  action: () => Promise<void>;
  evidenceDir?: string;
};

export type PromotedFillOptions = {
  stepIndex: number;
  field: string;
  value: string;
  sensitive?: boolean;
  fill: () => Promise<void>;
  fillInActiveContainer?: () => Promise<void>;
  fillInPage?: () => Promise<void>;
  ensureEditable?: () => Promise<void>;
  evidenceDir?: string;
};

export type PromotedAssertOptions = {
  stepIndex: number;
  target: string;
  assertion: () => Promise<void>;
  evidenceDir?: string;
};

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
    captureDiagnostics: boolFromEnv("PROMOTED_RUNTIME_CAPTURE_DIAGNOSTICS", true)
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
};

function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

export async function findBestActiveContainerForField(page: Page, fieldName?: string): Promise<{
  best?: ContainerCandidate;
  candidates: ContainerCandidate[];
}> {
  const normalizedField = normalizeText(fieldName ?? "");
  const candidates = await page.evaluate((field) => {
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.modal.show',
      '.modal.in',
      '[data-drawer]',
      '[data-popup]',
      'form',
      '.drawer',
      '.popup'
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
      return `${node.tagName.toLowerCase()}[data-promoted-idx="${idx}"]`;
    };

    const matchesField = (container: Element): boolean => {
      if (!field) return false;
      const text = (container.textContent || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, " ");
      if (text.includes(field)) return true;
      const fields = Array.from(container.querySelectorAll("input, textarea, select"));
      return fields.some((item) => {
        const node = item as HTMLInputElement;
        const attrs = [
          node.name || "",
          node.id || "",
          node.getAttribute("aria-label") || "",
          node.getAttribute("placeholder") || "",
          node.getAttribute("data-testid") || ""
        ].join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, " ");
        return attrs.includes(field);
      });
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
    }> = [];

    let idx = 0;
    for (const container of Array.from(unique)) {
      idx += 1;
      const editableCount = container.querySelectorAll("input:not([disabled]), textarea:not([disabled]), select:not([disabled])").length;
      const visible = isVisible(container);
      const matchingFieldFound = matchesField(container);
      const role = container.getAttribute("role") || container.tagName.toLowerCase();
      const id = (container as HTMLElement).id ? `#${(container as HTMLElement).id}` : "";
      const descriptor = `${role}${id}`;
      const selector = buildSelector(container, idx);
      const rank = (matchingFieldFound ? 100 : 0) + (visible ? 10 : 0) + editableCount;
      list.push({ selector, descriptor, visible, editableCount, matchingFieldFound, rank });
    }

    list.sort((a, b) => b.rank - a.rank);
    return list;
  }, normalizedField);

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
  }
): Promise<{
  locator: any;
  strategy: string;
  scope: "container" | "page";
  visible: boolean;
  enabled: boolean;
  editable: boolean;
} | undefined> {
  const normalizedField = normalizeText(field);
  const timeoutMs = options?.timeoutMs ?? 5000;
  const container = options?.containerLocator
    ? page.locator(options.containerLocator)
    : undefined;

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
  }
): Promise<{
  locator: any;
  strategy: string;
  scope: "container" | "page";
  visible: boolean;
  enabled: boolean;
  clickable: boolean;
} | undefined> {
  const normalizedTarget = normalizeText(target);
  const timeoutMs = options?.timeoutMs ?? 5000;
  const actionKind = options?.actionKind;
  const container = options?.containerLocator
    ? page.locator(options.containerLocator)
    : undefined;

  const strategies: Array<{
    name: string;
    scope: "container" | "page";
    build: () => any;
  }> = [
    // Container-scoped strategies (preferred when activeContainer is set)
    {
      name: "activeContainer:getByRoleButtonName",
      scope: "container",
      build: () => container?.getByRole("button", { name: new RegExp(normalizedTarget, "i"), exact: false })
    },
    {
      name: "activeContainer:getByRoleLinkName",
      scope: "container",
      build: () => container?.getByRole("link", { name: new RegExp(normalizedTarget, "i"), exact: false })
    },
    {
      name: "activeContainer:getByTextExact",
      scope: "container",
      build: () => container?.getByText(normalizedTarget, { exact: true })
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
      build: () => page.getByRole("button", { name: new RegExp(normalizedTarget, "i"), exact: false })
    },
    {
      name: "page:getByRoleLinkName",
      scope: "page",
      build: () => page.getByRole("link", { name: new RegExp(normalizedTarget, "i"), exact: false })
    },
    {
      name: "page:getByTextExact",
      scope: "page",
      build: () => page.getByText(normalizedTarget, { exact: true })
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

export class PromotedSpecRuntime {
  private readonly config: PromotedRuntimeConfig;
  private lastDialogMessage?: string;
  private activeContainer?: { selector: string; descriptor: string };
  private activeContainerDiscardReason?: string;

  constructor(private readonly page: Page, config?: Partial<PromotedRuntimeConfig>) {
    this.config = { ...loadPromotedRuntimeConfigFromEnv(), ...config };
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

  async clickPromotedTarget(options: PromotedActionOptions): Promise<void> {
    const previousUrl = this.page.url();
    const expectedEffect = options.expectedEffect ?? "ui_change";
    let retryAttempted = false;
    
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

    // Step 1: Try native runtime click with resolved locator
    nativeClickAttempted = true;
    const containerSelector = this.activeContainer?.selector;
    
    try {
      const resolved = await resolvePromotedClickableLocator(this.page, options.target, {
        containerLocator: containerSelector,
        timeoutMs: this.config.actionTimeoutMs,
        actionKind: options.actionIntent as "submit" | "link" | "button" | "action"
      });

      if (resolved && resolved.locator) {
        matchedLocatorStrategy = resolved.strategy;
        
        // Click the resolved locator
        await withTimeout(resolved.locator.click({ timeout: this.config.actionTimeoutMs }), this.config.actionTimeoutMs, "native click");
        nativeClickSucceeded = true;
        clickPath = "native_runtime";
        fallbackUsed = resolved.scope === "container" ? "active_container" : "page";
        
        // Handle expected effects
        await this.postActionStability(previousUrl, expectedEffect);
        
        // Refresh active container if modal/form/dialog expected
        if (expectedEffect === "modal_or_form_or_navigation" || expectedEffect === "ui_change") {
          await this.refreshActiveContainer();
        }
        
        effectDetected = true;
      }
    } catch (error) {
      nativeClickError = error instanceof Error ? error.message : String(error);
      // Continue to callback fallback
    }

    // Step 2: If native click didn't succeed, try callback POM fallback
    if (!nativeClickSucceeded) {
      callbackAttempted = true;
      try {
        await withTimeout(options.action(), this.config.actionTimeoutMs, "click callback");
        clickPath = "pom_callback";
        fallbackUsed = "callback";
        matchedLocatorStrategy = matchedLocatorStrategy === "unknown" ? "callback" : matchedLocatorStrategy;
        
        // Handle expected effects
        await this.postActionStability(previousUrl, expectedEffect);
        await this.refreshActiveContainer();
        callbackSucceeded = true;
        effectDetected = true;
      } catch (error) {
        callbackError = error instanceof Error ? error.message : String(error);
        
        // Retry if enabled and not sensitive
        if (this.config.retryEnabled && !options.sensitive && !retryAttempted) {
          retryAttempted = true;
          try {
            await withTimeout(options.action(), this.config.actionTimeoutMs, "click retry");
            clickPath = "pom_callback";
            await this.postActionStability(previousUrl, expectedEffect);
            await this.refreshActiveContainer();
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
      throw new Error(
        `Promoted click failed at step ${options.stepIndex} target="${options.target}". ` +
        `clickPath=${clickPath} nativeClickAttempted=${nativeClickAttempted} nativeClickSucceeded=${nativeClickSucceeded} ` +
        `callbackAttempted=${callbackAttempted} callbackSucceeded=${callbackSucceeded} ` +
        `retryAttempted=${String(retryAttempted)} diagnostics=${JSON.stringify(diagnostics)}`
      );
    }
  }

  async fillPromotedField(options: PromotedFillOptions): Promise<void> {
    const masked = maskIfSensitive(options.value, options.sensitive);
    const previousActiveContainer = this.activeContainer?.descriptor;
    const refresh = await this.refreshActiveContainerForField(options.field);
    const refreshedActiveContainer = this.activeContainer?.descriptor;
    const searchedContainers = refresh.candidates.length;
    
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
    if (refresh.best && refresh.best.matchingFieldFound) {
      nativeFillAttempted = true;
      const containerSelector = refresh.best.selector;
      
      try {
        const resolved = await resolvePromotedFieldLocator(this.page, options.field, {
          containerLocator: containerSelector,
          timeoutMs: this.config.actionTimeoutMs
        });

        if (resolved && resolved.locator) {
          matchedLocatorStrategy = resolved.strategy;
          
          // Fill with options.value (the hydrated value)
          await withTimeout(resolved.locator.fill(options.value), this.config.actionTimeoutMs, "native fill");
          nativeFillSucceeded = true;
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

    // Step 3: Wait for UI stability
    try {
      await this.waitForPromotedUiStable(options.stepIndex, options.field);
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
          target: options.field,
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
        `Promoted fill failed at step ${options.stepIndex} field="${options.field}" value="${masked}". ` +
        `fillPath=${fillPath} nativeFillAttempted=${nativeFillAttempted} nativeFillSucceeded=${nativeFillSucceeded} ` +
        `callbackAttempted=${callbackAttempted} callbackSucceeded=${callbackSucceeded} ` +
        `diagnostics=${JSON.stringify(diagnostics)}`
      );
    }
  }

  async selectPromotedItem(options: PromotedActionOptions): Promise<void> {
    await this.clickPromotedTarget({ ...options, actionIntent: "select" });
  }

  async expectPromotedVisible(options: PromotedAssertOptions): Promise<void> {
    try {
      await withTimeout(options.assertion(), this.config.actionTimeoutMs, "assert visible");
    } catch (error) {
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

  private async postActionStability(previousUrl: string, expectedEffect: PromotedExpectedEffect): Promise<void> {
    if (!this.config.enabled) return;
    if (expectedEffect === "none") return;
    const requireUrlChange = expectedEffect === "navigation";
    await waitForPromotedSpecStepReady(this.page, {
      previousUrl,
      timeoutMs: this.config.stabilityTimeoutMs,
      requireUrlChange
    }).catch(async () => {
      if (expectedEffect === "modal_or_form_or_navigation") {
        const container = await this.refreshActiveContainer();
        if (container) {
          return;
        }
      }
      throw new Error(`Post-click stability check failed. expectedEffect=${expectedEffect}`);
    });
    await this.waitForPromotedUiStable(-1, "post_action");
    if (expectedEffect === "modal_or_form_or_navigation") {
      await this.refreshActiveContainer();
    }
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

export function createPromotedSpecRuntime(page: Page, config?: Partial<PromotedRuntimeConfig>): PromotedSpecRuntime {
  return new PromotedSpecRuntime(page, config);
}
