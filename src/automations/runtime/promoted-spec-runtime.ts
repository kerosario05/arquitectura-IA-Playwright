import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { capturePageDiagnostics, waitForPromotedSpecStepReady } from "../../browser/promoted-spec-helpers";
import { waitForStablePageState } from "../../discovery/page-stability-detector";
import { findSemanticTargetMatch, type SemanticMatchOptions } from "./semantic-target-matcher";

export type SafeReplayStep = {
  stepIndex: number;
  actionIntent: string;
  target: string;
  action: () => Promise<void>;
  sensitive?: boolean;
};

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
  actionIntent?: string;
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
    actionIntent?: string;
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
  const timeoutMs = options?.timeoutMs ?? 5000;
  const actionKind = options?.actionKind;
  const actionIntent = options?.actionIntent;
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

/**
 * Validate screen context before executing context-dependent actions
 * Prevents executing deep functional actions from wrong screen (Home/Login/Menu)
 */
async function validateScreenContextForAction(
  page: Page,
  options: { 
    target: string; 
    actionIntent: string; 
    stepIndex: number;
    expectedOwnerPage?: string;
    lastSelectionStep?: { selectedTarget: string; stepIndex: number };
  }
): Promise<void> {
  const CONTEXT_DEPENDENT_ACTIONS = new Set([
    "select_product", "select_category", "click_primary_action",
    "submit_form", "confirm_action", "fill_form_field",
    "select_first_visible_item", "select_first_visible_product",
    "select_first_visible_card", "select_first_visible_row",
    "select_visible_item_by_ordinal", "open_module"
  ]);
  
  if (!CONTEXT_DEPENDENT_ACTIONS.has(options.actionIntent)) {
    return;
  }
  
  // Capture current page state
  const pageDiag = await capturePageDiagnostics(page);
  const currentUrl = pageDiag.currentUrl;
  const visibleButtons = pageDiag.visibleButtons;
  const visibleHeadings = pageDiag.visibleHeadings;
  
  // Check for clear signals of being on wrong screen
  const isOnHomeScreen = currentUrl === "/" || currentUrl === "" || 
    visibleHeadings.some(h => /home|inicio|welcome|bienvenid/i.test(h));
  const isOnLoginScreen = visibleButtons.some(b => /iniciar|login|sign in|ingresar/i.test(b)) &&
    !visibleButtons.some(b => /continuar|next|submit|confirmar/i.test(b));
  const isOnMenuScreen = visibleHeadings.some(h => /menu|operaciones|module/i.test(h)) &&
    visibleButtons.length > 0 && 
    !visibleButtons.some(b => /producto|item|card|select/i.test(b));
  
  // Check for AuthGate/Identification screen
  const isOnAuthGate = /client-identification|identification|auth|login/i.test(currentUrl) ||
    visibleHeadings.some(h => /identificaci|identification|auth|login/i.test(h));
  
  const isOnWrongScreen = isOnHomeScreen || isOnLoginScreen || isOnMenuScreen || isOnAuthGate;
  
  if (isOnWrongScreen) {
    // Check if target exists on current page
    const targetExists = visibleButtons.some(b => 
      b.toLowerCase().includes(options.target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    ) || visibleHeadings.some(h =>
      h.toLowerCase().includes(options.target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    );
    
    if (!targetExists) {
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
        b.toLowerCase().includes(options.target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
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
async function detectHomeResetOrInactivity(page: Page): Promise<{
  detected: boolean;
  reason?: "inactivity_message" | "home_url_with_iniciar" | "session_reset";
  visibleTexts?: string[];
  visibleButtons?: string[];
  currentUrl?: string;
}> {
  const pageDiag = await capturePageDiagnostics(page);
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
  
  const hasInactivityMessage = visibleTexts.some(t => 
    inactivityPatterns.some(p => p.test(t))
  ) || visibleHeadings.some(h => 
    inactivityPatterns.some(p => p.test(h))
  );
  
  // Check for home URL with only "Iniciar" button (fresh session state)
  const isOnHomeWithIniciar = (currentUrl === "/" || currentUrl === "") && 
    visibleButtons.some(b => /iniciar|login|ingresar/i.test(b)) &&
    visibleButtons.length <= 3; // Home should have few buttons
  
  if (hasInactivityMessage) {
    return { detected: true, reason: "inactivity_message", visibleTexts, visibleButtons, currentUrl };
  }
  
  if (isOnHomeWithIniciar) {
    return { detected: true, reason: "home_url_with_iniciar", visibleTexts, visibleButtons, currentUrl };
  }
  
  return { detected: false };
}

/**
 * Check if an action intent is safe to replay
 */
function isSafeActionToReplay(actionIntent: string): boolean {
  const SAFE_ACTIONS = new Set([
    "start_session", "open_home", "open_module", "open_product_information",
    "select_category", "select_product", "select_visible_item_by_ordinal",
    "select_first_visible_item", "select_first_visible_product", "select_first_visible_card",
    "navigate", "return_to_list"
  ]);
  
  const UNSAFE_ACTIONS = new Set([
    "submit_form", "confirm_action", "payment", "transfer", "send",
    "accept_terms", "delete", "fill_form_field", "click_primary_action"
  ]);
  
  if (UNSAFE_ACTIONS.has(actionIntent)) return false;
  if (SAFE_ACTIONS.has(actionIntent)) return true;
  
  // Default: be conservative, don't replay unknown actions
  return false;
}

export type PromotedClickOptions = PromotedActionOptions & {
  previousSteps?: SafeReplayStep[];
  lastSelectionStep?: { stepIndex: number; selectedTarget: string };
  lastSelectionReplay?: () => Promise<void>;
  expectedOwnerPage?: string;
};

export class PromotedSpecRuntime {
  private readonly config: PromotedRuntimeConfig;
  private lastDialogMessage?: string;
  private activeContainer?: { selector: string; descriptor: string };
  private activeContainerDiscardReason?: string;
  private lastSelectionStep?: { selectedTarget: string; stepIndex: number; timestamp: number };

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
    
    // Filter to steps before the target that are safe to replay
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
        await step.action();
        replayedSteps.push(step.stepIndex);
        
        // Wait for stability after each replayed step
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

  async clickPromotedTarget(options: PromotedClickOptions): Promise<void> {
    const previousUrl = this.page.url();
    const expectedEffect = options.expectedEffect ?? "ui_change";
    let retryAttempted = false;
    
    // STEP 1: Detect home reset/inactivity BEFORE any target resolution
    const homeReset = await detectHomeResetOrInactivity(this.page);
    if (homeReset.detected) {
      console.log(`[runtime:session_reset] detected: reason="${homeReset.reason}" currentUrl="${homeReset.currentUrl}" stepIndex=${options.stepIndex}`);
      
      if (options.previousSteps && options.previousSteps.length > 0) {
        // Attempt safe replay to restore context
        console.log(`[runtime:session_reset] replaying steps count=${options.previousSteps.length}`);
        const replayResult = await this.safeReplayContext(options.previousSteps, options.stepIndex);
        
        if (replayResult.success) {
          console.log(`[runtime:session_reset] replay succeeded: replayedSteps=[${replayResult.replayedSteps.join(", ")}]`);
        } else {
          console.log(`[runtime:session_reset] replay failed: ${replayResult.reason}`);
          throw new Error(
            `session_reset_unrecoverable_replay_failed: Home reset detected but safe replay failed. ` +
            `reason="${replayResult.reason}" currentUrl="${homeReset.currentUrl}" ` +
            `previousStepsCount=${options.previousSteps.length} stepIndex=${options.stepIndex} ` +
            `target="${options.target}" actionIntent="${options.actionIntent}" ` +
            `suggestedFix="Regenerate spec or increase session timeout"`
          );
        }
      } else {
        // No previousSteps available for replay
        throw new Error(
          `session_reset_unrecoverable_missing_step_metadata: Home reset detected but cannot recover context. ` +
          `reason="${homeReset.reason}" currentUrl="${homeReset.currentUrl}" ` +
          `previousStepsCount=${options.previousSteps?.length || 0} stepIndex=${options.stepIndex} ` +
          `target="${options.target}" actionIntent="${options.actionIntent}" ` +
          `suggestedFix="Regenerate spec with previousSteps metadata or increase session timeout"`
        );
      }
    }
    
    // STEP 2: Special handling for return_to_list: check if already on list page
    if (options.actionIntent === "return_to_list") {
      const pageDiag = await capturePageDiagnostics(this.page);
      const alreadyOnList = await this.checkIfAlreadyOnListPage(pageDiag);
      
      if (alreadyOnList) {
        console.log(`[runtime:return_to_list] Already on list page, marking as satisfied: currentUrl="${pageDiag.currentUrl}"`);
        return;
      }
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

    // Step 1: Try native runtime click with resolved locator
    nativeClickAttempted = true;
    const containerSelector = this.activeContainer?.selector;
    
    try {
      const resolved = await resolvePromotedClickableLocator(this.page, options.target, {
        containerLocator: containerSelector,
        timeoutMs: this.config.actionTimeoutMs,
        actionKind: options.actionIntent as "submit" | "link" | "button" | "action",
        actionIntent: options.actionIntent
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
      
      // Check for home reset/inactivity BEFORE throwing generic click error
      // This prevents semantic_target_not_found when the real issue is session timeout
      const homeResetFromDiagnostics = await detectHomeResetOrInactivity(this.page);
      if (homeResetFromDiagnostics.detected) {
        console.log(`[runtime:session_reset] detected from diagnostics before throw: reason="${homeResetFromDiagnostics.reason}" currentUrl="${homeResetFromDiagnostics.currentUrl}"`);
        
        if (options.previousSteps && options.previousSteps.length > 0) {
          console.log(`[runtime:session_reset] attempting replay from diagnostics: steps=${options.previousSteps.length}`);
          const replayResult = await this.safeReplayContext(options.previousSteps, options.stepIndex);
          
          if (replayResult.success) {
            console.log(`[runtime:session_reset] replay succeeded, retrying target="${options.target}"`);
            // Retry the original action after successful replay
            try {
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
          `previousStepsCount=${options.previousSteps?.length || 0} ` +
          `suggestedFix="Regenerate spec with previousSteps metadata or increase session timeout"`
        );
      }
      
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
    
    // Validate screen context before executing context-dependent actions
    await validateScreenContextForAction(this.page, {
      target: options.field,
      actionIntent: options.actionIntent ?? "fill_form_field",
      stepIndex: options.stepIndex
    });
    
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
    // Track selection step for post-selection detail verification
    this.lastSelectionStep = {
      selectedTarget: options.target,
      stepIndex: options.stepIndex,
      timestamp: Date.now()
    };
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
