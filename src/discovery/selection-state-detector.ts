import type { Page, Locator } from "@playwright/test";
import type { PageSnapshot } from "../types/page-snapshot.types";

export type SelectionDetectionResult = {
  selected: boolean;
  evidence: string[];
  confidence: number;
};

export type SelectionDiagnostics = {
  evaluated: boolean;
  target: string;
  action?: string;
  selectionLike: boolean;
  success: boolean;
  reason: string;
  evidence: string[];
  noTransitionAccepted: boolean;
  promotedToClickableAncestor?: boolean;
};

const SELECTION_KEYWORDS = [
  "seleccionar",
  "elegir",
  "marcar",
  "escoger",
  "destinatario",
  "opción",
  "opcion",
  "producto",
  "cuenta",
  "tarjeta",
  "radio",
  "checkbox",
  "list item",
  "card",
  "a quien pueda interesar",
  "carta de referencia",
  "tipo de carta",
  "destinatario"
];

const SELECTION_SCREEN_HEADINGS = [
  "seleccione",
  "selecciona",
  "a quién va dirigida",
  "a quien va dirigida",
  "destinatario",
  "opciones",
  "seleccione un",
  "selecciona un",
  "seleccione la",
  "selecciona la",
  "seleccione el",
  "selecciona el",
  "elija",
  "escoja"
];

const CONTINUE_BUTTON_PATTERNS = [
  "continuar",
  "siguiente",
  "confirmar",
  "enviar",
  "next",
  "proceed"
];

const SUBMIT_KEYWORDS = [
  "continuar",
  "siguiente",
  "confirmar",
  "enviar",
  "iniciar sesión",
  "iniciar sesion",
  "generar",
  "pagar",
  "transferir",
  "submit",
  "login",
  "next",
  "proceed",
  "send",
  "pay",
  "transfer",
  "solicitar",
  "aceptar términos",
  "aceptar terminos",
  "finalizar",
  "aprobar"
];

const SUCCESS_CLASS_PATTERNS = [
  "success",
  "kiosk-success",
  "border-kiosk-success",
  "bg-kiosk-success",
  "text-kiosk-success",
  "border-success",
  "bg-success",
  "text-success",
  "selected",
  "active",
  "checked"
];

const CHECK_ICON_PATTERNS = [
  "lucide-circle-check",
  "circle-check",
  "check",
  "check-icon",
  "icon-check",
  "fa-check",
  "mdi-check"
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSelectionLikeTarget(target: string, context?: { action?: string; actionType?: string; snapshot?: PageSnapshot }): boolean {
  const normalizedTarget = normalizeText(target);
  const normalizedAction = context?.action ? normalizeText(context.action) : "";
  const normalizedActionType = context?.actionType ? normalizeText(context.actionType) : "";

  if (normalizedActionType === "action_select") {
    return true;
  }

  for (const keyword of SELECTION_KEYWORDS) {
    if (normalizedTarget.includes(normalizeText(keyword))) {
      return true;
    }
  }

  const selectionVerbs = ["seleccionar", "elegir", "marcar", "escoger", "select", "choose", "pick"];
  for (const verb of selectionVerbs) {
    if (normalizedAction.includes(normalizeText(verb))) {
      return true;
    }
  }

  if (context?.snapshot) {
    const texts: string[] = [];
    for (const el of (context.snapshot as any).elements || []) {
      if (el.text) texts.push(el.text);
      if (el.nearbyText) texts.push(el.nearbyText);
      if (el.role === "heading" || el.tagName === "h1" || el.tagName === "h2" || el.tagName === "h3") {
        if (el.text) texts.push(el.text);
      }
    }

    const normalizedTexts = texts.map(normalizeText);
    for (const heading of SELECTION_SCREEN_HEADINGS) {
      if (normalizedTexts.some(t => t.includes(normalizeText(heading)))) {
        return true;
      }
    }
  }

  return false;
}

export function isSubmitLikeTarget(target: string, action?: string): boolean {
  const normalizedTarget = normalizeText(target);
  const normalizedAction = action ? normalizeText(action) : "";

  for (const keyword of SUBMIT_KEYWORDS) {
    if (normalizedTarget.includes(normalizeText(keyword)) || normalizedAction.includes(normalizeText(keyword))) {
      return true;
    }
  }

  return false;
}

export async function promoteToClickableAncestor(locator: Locator): Promise<{ locator: Locator; promoted: boolean; fromTag: string; toTag: string }> {
  try {
    const tagName = await locator.evaluate((el) => el.tagName.toLowerCase());

    const nonClickableTags = new Set(["span", "div", "p", "label", "text", "small", "em", "strong", "b", "i", "u", "h1", "h2", "h3", "h4", "h5", "h6"]);

    if (!nonClickableTags.has(tagName)) {
      return { locator, promoted: false, fromTag: tagName, toTag: tagName };
    }

    const clickableAncestor = locator.locator("..").first();
    const ancestorTagName = await clickableAncestor.evaluate((el) => el.tagName.toLowerCase());

    const clickableTags = new Set(["button", "a", "input", "label"]);
    const clickableRoles = new Set(["button", "radio", "checkbox", "option", "tab", "menuitem"]);

    const ancestorRole = await clickableAncestor.getAttribute("role");
    const hasOnClick = await clickableAncestor.evaluate((el) => !!el.onclick || el.getAttribute("onclick"));
    const isFocusable = await clickableAncestor.evaluate((el) => el.tabIndex >= 0 || el.hasAttribute("tabindex"));

    if (clickableTags.has(ancestorTagName) || clickableRoles.has(ancestorRole || "") || hasOnClick || isFocusable) {
      return { locator: clickableAncestor, promoted: true, fromTag: tagName, toTag: ancestorTagName };
    }

    const grandparent = clickableAncestor.locator("..").first();
    const grandparentTagName = await grandparent.evaluate((el) => el.tagName.toLowerCase());
    const grandparentRole = await grandparent.getAttribute("role");
    const grandparentHasOnClick = await grandparent.evaluate((el) => !!el.onclick || el.getAttribute("onclick"));

    if (clickableTags.has(grandparentTagName) || clickableRoles.has(grandparentRole || "") || grandparentHasOnClick) {
      return { locator: grandparent, promoted: true, fromTag: tagName, toTag: grandparentTagName };
    }

    return { locator, promoted: false, fromTag: tagName, toTag: tagName };
  } catch {
    return { locator, promoted: false, fromTag: "unknown", toTag: "unknown" };
  }
}

async function detectSelectionByLocator(page: Page, target: string, locator?: Locator): Promise<SelectionDetectionResult> {
  const evidence: string[] = [];
  let confidence = 0;

  if (locator) {
    try {
      const elementClasses = await locator.evaluate((el) => {
        const classes: string[] = [];
        let current: Element | null = el;
        let depth = 0;
        while (current && depth < 5) {
          const className = current.className || "";
          if (typeof className === "string" && className) {
            classes.push(...className.split(" ").filter(Boolean));
          }
          current = current.parentElement;
          depth++;
        }
        return classes;
      });

      // Filter out state-prefixed classes (Tailwind utilities like hover:, focus:, etc.)
      // and styling utilities (from-, to-, via-, bg-, text-, border-) that are not selection states
      const statePrefixed = /^(hover|focus|active|visited|disabled|group-hover|peer-hover|peer-focus):/;
      const stylingPrefixed = /^(from|to|via|bg|text|border|ring|outline|shadow|decoration|placeholder|caret|accent|divide|scrollbar)(-|$|:)/;
      const relevantClasses = elementClasses.filter(c => !statePrefixed.test(c) && !stylingPrefixed.test(c));

      for (const pattern of SUCCESS_CLASS_PATTERNS) {
        const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        const matched = relevantClasses.filter(c => regex.test(c));
        if (matched.length > 0) {
          evidence.push(`ancestor-class=${matched.slice(0, 3).join(",")}`);
          confidence += 0.4;
          break;
        }
      }

      const hasCheckIcon = await locator.evaluate((el) => {
        let current: Element | null = el;
        let depth = 0;
        while (current && depth < 5) {
          const svgElements = current.querySelectorAll("svg, i, [data-icon]");
          for (const svg of svgElements) {
            const className = svg.className || "";
            const dataIcon = svg.getAttribute("data-icon") || "";
            if (typeof className === "string" && /check|circle-check|lucide/i.test(className)) {
              return true;
            }
            if (/check|circle-check/i.test(dataIcon)) {
              return true;
            }
          }
          const className = current.className || "";
          if (typeof className === "string" && /check|circle-check|lucide/i.test(className)) {
            return true;
          }
          current = current.parentElement;
          depth++;
        }
        return false;
      });

      if (hasCheckIcon) {
        evidence.push("check-icon-nearby");
        confidence += 0.4;
      }

      const ariaChecked = await locator.getAttribute("aria-checked");
      if (ariaChecked === "true") {
        evidence.push("aria-checked=true");
        confidence += 0.5;
      }

      const ariaSelected = await locator.getAttribute("aria-selected");
      if (ariaSelected === "true") {
        evidence.push("aria-selected=true");
        confidence += 0.4;
      }

      const dataSelected = await locator.getAttribute("data-selected");
      if (dataSelected === "true") {
        evidence.push("data-selected=true");
        confidence += 0.4;
      }

    } catch {
      // Evaluation failed, fall through to page-wide search
    }
  }

  if (confidence < 0.4) {
    try {
      const targetRegex = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

      const radioChecked = await page.evaluate((pattern) => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
        for (const radio of radios) {
          const label = radio.labels?.[0]?.textContent || radio.getAttribute("aria-label") || "";
          if (new RegExp(pattern, "i").test(label)) {
            return { checked: radio.checked, ariaChecked: radio.getAttribute("aria-checked") };
          }
        }
        return null;
      }, target);

      if (radioChecked) {
        if (radioChecked.checked) {
          evidence.push("radio.checked=true");
          confidence += 0.5;
        }
        if (radioChecked.ariaChecked === "true") {
          evidence.push("aria-checked=true");
          confidence += 0.3;
        }
      }

      const checkboxChecked = await page.evaluate((pattern) => {
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
        for (const cb of checkboxes) {
          const label = cb.labels?.[0]?.textContent || cb.getAttribute("aria-label") || "";
          if (new RegExp(pattern, "i").test(label)) {
            return { checked: cb.checked, ariaChecked: cb.getAttribute("aria-checked") };
          }
        }
        return null;
      }, target);

      if (checkboxChecked) {
        if (checkboxChecked.checked) {
          evidence.push("checkbox.checked=true");
          confidence += 0.5;
        }
        if (checkboxChecked.ariaChecked === "true") {
          evidence.push("aria-checked=true");
          confidence += 0.3;
        }
      }

      const ariaSelected = await page.evaluate((pattern) => {
        const elements = Array.from(document.querySelectorAll("[aria-selected]"));
        for (const el of elements) {
          const text = el.textContent || "";
          if (new RegExp(pattern, "i").test(text)) {
            return el.getAttribute("aria-selected");
          }
        }
        return null;
      }, target);

      if (ariaSelected === "true") {
        evidence.push("aria-selected=true");
        confidence += 0.4;
      }

      const dataSelected = await page.evaluate((pattern) => {
        const elements = Array.from(document.querySelectorAll("[data-selected]"));
        for (const el of elements) {
          const text = el.textContent || "";
          if (new RegExp(pattern, "i").test(text)) {
            return el.getAttribute("data-selected");
          }
        }
        return null;
      }, target);

      if (dataSelected === "true") {
        evidence.push("data-selected=true");
        confidence += 0.4;
      }

      const successClasses = await page.evaluate((patterns) => {
        const statePrefixed = /^(hover|focus|active|visited|disabled|group-hover|peer-hover|peer-focus):/;
        const stylingPrefixed = /^(from|to|via|bg|text|border|ring|outline|shadow|decoration|placeholder|caret|accent|divide|scrollbar)(-|$|:)/;
        const elements = Array.from(document.querySelectorAll("*"));
        const matched: string[] = [];
        for (const el of elements) {
          const text = el.textContent || "";
          const className = el.className || "";
          if (typeof className === "string") {
            const relevantClasses = className.split(" ").filter(c => !statePrefixed.test(c) && !stylingPrefixed.test(c));
            for (const pattern of patterns) {
              const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
              const classMatches = relevantClasses.filter(c => regex.test(c));
              if (classMatches.length > 0) {
                matched.push(classMatches.join(","));
              }
            }
          }
        }
        return matched.length > 0 ? matched.slice(0, 5) : null;
      }, SUCCESS_CLASS_PATTERNS);

      if (successClasses && successClasses.length > 0) {
        evidence.push(`success-classes=${successClasses.join(",")}`);
        confidence += 0.4;
      }

      const checkIcons = await page.evaluate((patterns) => {
        const elements = Array.from(document.querySelectorAll("svg, i, span, [data-icon]"));
        for (const el of elements) {
          const className = el.className || "";
          const dataIcon = el.getAttribute("data-icon") || "";
          for (const pattern of patterns) {
            const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
            if (typeof className === "string" && regex.test(className)) {
              return { className, tag: el.tagName };
            }
            if (regex.test(dataIcon)) {
              return { dataIcon, tag: el.tagName };
            }
          }
        }
        return null;
      }, CHECK_ICON_PATTERNS);

      if (checkIcons) {
        evidence.push(`check-icon=${checkIcons.className || checkIcons.dataIcon}`);
        confidence += 0.4;
      }

      const targetInSummary = await page.evaluate((pattern) => {
        const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
        for (const input of inputs) {
          const value = (input as HTMLInputElement).value || input.getAttribute("aria-valuenow") || "";
          if (new RegExp(pattern, "i").test(value)) {
            return true;
          }
        }
        const summaryElements = Array.from(document.querySelectorAll("[data-selected-value], .selected-value, .summary-value"));
        for (const el of summaryElements) {
          if (new RegExp(pattern, "i").test(el.textContent || "")) {
            return true;
          }
        }
        return false;
      }, target);

      if (targetInSummary) {
        evidence.push("target-in-selected-summary");
        confidence += 0.3;
      }

    } catch {
      // Evaluation failed, fall through
    }
  }

  return { selected: confidence >= 0.3, evidence, confidence: Math.min(1.0, confidence) };
}

async function detectNextActionEnabled(page: Page): Promise<{ enabled: boolean; text: string | null; evidence: string[] }> {
  const evidence: string[] = [];

  try {
    const nextAction = await page.evaluate((patterns) => {
      const buttons = Array.from(document.querySelectorAll("button, [role='button'], a")) as HTMLElement[];
      for (const btn of buttons) {
        const text = (btn.textContent || "").toLowerCase();
        const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
        const matches = patterns.some((p: string) => text.includes(p) || ariaLabel.includes(p));

        if (matches) {
          const disabled = btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true";
          const hidden = btn.getAttribute("aria-hidden") === "true" || (btn as HTMLElement).offsetParent === null;
          return { enabled: !disabled, hidden, text: btn.textContent?.trim() || null };
        }
      }
      return null;
    }, CONTINUE_BUTTON_PATTERNS);

    if (nextAction) {
      if (nextAction.enabled && !nextAction.hidden) {
        evidence.push(`next-action-enabled="${nextAction.text}"`);
        return { enabled: true, text: nextAction.text, evidence };
      } else if (nextAction.enabled) {
        evidence.push(`next-action-enabled-but-hidden="${nextAction.text}"`);
        return { enabled: true, text: nextAction.text, evidence };
      } else {
        evidence.push(`next-action-disabled="${nextAction.text}"`);
      }
    }
  } catch {
    // Evaluation failed
  }

  return { enabled: false, text: null, evidence };
}

export async function detectSelectionSuccess(input: {
  page: Page;
  snapshot: PageSnapshot;
  target: string;
  locator?: Locator;
  beforeSnapshot?: PageSnapshot;
  afterSnapshot?: PageSnapshot;
  nextTarget?: string;
  action?: string;
  actionType?: string;
}): Promise<SelectionDiagnostics> {
  const { page, snapshot, target, action, actionType } = input;
  const selectionLike = isSelectionLikeTarget(target, { action, actionType, snapshot });

  if (!selectionLike) {
    return {
      evaluated: true,
      target,
      action,
      selectionLike: false,
      success: false,
      reason: "not_selection_like",
      evidence: [],
      noTransitionAccepted: false
    };
  }

  const locatorResult = await detectSelectionByLocator(page, target, input.locator);
  const nextActionResult = await detectNextActionEnabled(page);

  const allEvidence = [...locatorResult.evidence, ...nextActionResult.evidence];

  let success = false;
  let reason = "selection_no_evidence";

  if (locatorResult.selected) {
    success = true;
    reason = "selection_state_detected";
  } else if (nextActionResult.enabled) {
    success = true;
    reason = "selection_no_transition_next_action_enabled";
  } else if (locatorResult.confidence >= 0.3) {
    success = true;
    reason = "selection_partial_evidence";
  }

  return {
    evaluated: true,
    target,
    action,
    selectionLike: true,
    success,
    reason,
    evidence: allEvidence,
    noTransitionAccepted: success
  };
}
