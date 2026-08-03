import type { MobileStep } from "./mobile-step-types";
import { dismissBlockingModal, detectBlockingModal } from "./mobile-modal-dismisser";

/**
 * Consent-checkbox auto-handling for mobile execution.
 *
 * When a scenario presses an "accept terms / continue / confirm" button, the flow often
 * requires an un-ticked checkbox (e.g. "Acepto los términos y condiciones") to be checked
 * first, or the button stays disabled and the scenario cannot complete. The mobile step model
 * has no `check` action, so nothing ticks it today. This module detects an un-checked checkbox
 * on the current screen and taps it BEFORE the accept button is pressed.
 *
 * All parsing is pure (unit-testable over an Appium page-source XML); the only side-effecting
 * function taps via the WebdriverIO session and never throws (best-effort, must not break the
 * accept flow).
 */

/** Button/action wording that means "submit / accept / advance". */
const SUBMIT_LIKE_KEYWORDS = [
  "aceptar", "acepto", "continuar", "continúa", "continua", "confirmar", "confirmo",
  "siguiente", "finalizar", "terminar", "enviar", "guardar", "registrar", "registrarme",
  "autorizar", "autorizo", "accept", "continue", "confirm", "submit", "next", "agree"
];

/** Wording that identifies a consent/terms checkbox label (used to prioritize which box to tick). */
const CONSENT_KEYWORDS = [
  "termino", "condicion", "acepto", "acepta", "autorizo", "autoriza", "consentimiento",
  "consiento", "privacidad", "tratamiento de datos", "politica", "contrato",
  "terms", "conditions", "consent", "privacy", "agree"
];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** True when a click step is pressing an accept/continue/confirm-like button. */
export function isSubmitLikeClick(step: MobileStep): boolean {
  if (step.action !== "click") return false;
  const haystack = normalize([step.description ?? "", step.target?.value ?? ""].join(" "));
  return SUBMIT_LIKE_KEYWORDS.some((kw) => haystack.includes(normalize(kw)));
}

type ElementAttrs = Record<string, string>;

const ELEMENT_RE = /<([\w.]+)\b([^>]*?)\/?>/g;
const ATTR_RE = /([\w:-]+)="([^"]*)"/g;

function parseAttrs(rawAttrs: string): ElementAttrs {
  const attrs: ElementAttrs = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(rawAttrs)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

export type ConsentCheckboxCandidate = {
  /** WebdriverIO selector that targets this specific un-checked element. */
  selector: string;
  /** Human-readable label (content-desc/text/resource-id) for logging. */
  label: string;
  /** True when the element's label matches consent/terms wording (higher priority). */
  isConsent: boolean;
};

function isCheckboxElement(tag: string, attrs: ElementAttrs): boolean {
  if (attrs.checkable === "true") return true;
  const t = tag.toLowerCase();
  // Some frameworks expose `checked` without `checkable` on toggle-like widgets.
  const looksToggle = t.includes("checkbox") || t.includes("switch") || t.includes("togglebutton") || t.includes("radiobutton");
  return looksToggle && (attrs.checked === "true" || attrs.checked === "false");
}

function escapeForUiSelector(value: string): string {
  // UiAutomator string literals: escape backslashes and double quotes.
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Builds the most specific selector available that still pins to the UN-checked node. */
function buildSelector(attrs: ElementAttrs): string {
  const rid = attrs["resource-id"];
  const desc = attrs["content-desc"];
  const text = attrs["text"];
  if (rid) return `android=new UiSelector().resourceId("${escapeForUiSelector(rid)}").checked(false)`;
  if (desc) return `android=new UiSelector().description("${escapeForUiSelector(desc)}").checked(false)`;
  if (text) return `android=new UiSelector().text("${escapeForUiSelector(text)}").checked(false)`;
  return `android=new UiSelector().checkable(true).checked(false)`;
}

function labelOf(attrs: ElementAttrs): string {
  return (attrs["content-desc"] || attrs["text"] || attrs["resource-id"] || "checkbox").trim();
}

/**
 * Scans an Appium page-source XML and returns every UN-checked checkbox-like element, with
 * consent-labeled ones first. Returns `[]` when nothing needs ticking. Pure — no I/O.
 */
export function findUncheckedConsentCheckboxes(pageSourceXml: string): ConsentCheckboxCandidate[] {
  if (!pageSourceXml) return [];
  const found: ConsentCheckboxCandidate[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const tag = m[1];
    const attrs = parseAttrs(m[2]);
    if (!isCheckboxElement(tag, attrs)) continue;
    if (attrs.checked !== "false") continue; // already ticked (or unknown) → leave it
    const selector = buildSelector(attrs);
    if (seen.has(selector)) continue;
    seen.add(selector);
    const label = labelOf(attrs);
    const isConsent = CONSENT_KEYWORDS.some((kw) => normalize(label).includes(normalize(kw)));
    found.push({ selector, label, isConsent });
  }
  // Consent-labeled checkboxes first, then the rest (required-but-generic checkboxes).
  return found.sort((a, b) => Number(b.isConsent) - Number(a.isConsent));
}

/** Reads the enable flag (default ON; only "false" disables). */
export function isConsentCheckboxAutoTickEnabled(): boolean {
  return (process.env.MOBILE_AUTO_CONSENT_CHECKBOX_ENABLED ?? "true").toLowerCase() !== "false";
}

type Bounds = { x1: number; y1: number; x2: number; y2: number };
function parseBounds(raw: string): Bounds | null {
  const m = raw.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

const SUBMIT_GATE_KEYWORDS = ["continuar", "aceptar", "confirmar", "siguiente", "finalizar", "registrar", "enviar"];

/**
 * True when a submit/continue control is on screen but disabled — the signal that a required
 * acceptance (checkbox) still needs to be marked before the flow can advance.
 */
export function isSubmitGated(pageSourceXml: string): boolean {
  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const attrs = parseAttrs(m[2]);
    const label = normalize(attrs["content-desc"] || attrs.text || "");
    if (!label) continue;
    if (SUBMIT_GATE_KEYWORDS.some((kw) => label === normalize(kw))) {
      const disabled = attrs.enabled === "false" || attrs.clickable === "false";
      if (disabled) return true;
    }
  }
  return false;
}

export type ConsentAcceptanceRow = { bounds: Bounds; label: string };

/**
 * Finds a consent ACCEPTANCE ROW: a wide clickable element (not a standard checkbox) whose
 * content-desc is the acceptance sentence ("Acepto los términos…"). In com.appconversacionalbsc
 * the checkbox and the "Términos y Condiciones" link share one native row — tapping its centre hits
 * the link and opens the modal, so this must be tapped on its LEFT edge (the checkbox square).
 */
export function findConsentAcceptanceRow(pageSourceXml: string): ConsentAcceptanceRow | null {
  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const attrs = parseAttrs(m[2]);
    if (attrs.clickable !== "true") continue;
    const desc = (attrs["content-desc"] || "").trim();
    if (!desc) continue;
    const nd = normalize(desc);
    // Must read like an acceptance ("acepto …") of terms/consent, and be a real row (wide).
    const isAcceptance = nd.startsWith("acepto") || (nd.includes("acepto") && (nd.includes("termino") || nd.includes("condicion")));
    if (!isAcceptance) continue;
    const b = parseBounds(attrs.bounds || "");
    if (!b || b.x2 - b.x1 < 300) continue;
    return { bounds: b, label: desc.slice(0, 60) };
  }
  return null;
}

/**
 * Best-effort: before an accept/continue button is pressed, detect and tick any un-checked
 * consent/required checkbox on the current screen. Never throws — a detection or tap failure
 * must not break the accept flow. Returns the labels of the checkboxes it ticked.
 */
export async function ensureConsentCheckboxChecked(
  browser: WebdriverIO.Browser,
  log: (line: string) => void = () => {}
): Promise<{ ticked: string[] }> {
  const ticked: string[] = [];
  if (!isConsentCheckboxAutoTickEnabled()) return { ticked };

  let xml: string;
  try {
    xml = await browser.getPageSource();
  } catch {
    return { ticked };
  }

  // 1) If a terms modal is covering the screen, close it first so the acceptance row is reachable.
  if (detectBlockingModal(xml).isTermsModal) {
    const closed = await dismissBlockingModal(browser, log);
    if (closed) {
      // Wait for the close transition to settle before re-reading, otherwise the screen underneath
      // (the acceptance row + Continuar) is caught mid-animation and detection misses it.
      try { await browser.pause(900); } catch { /* pause may be unavailable in tests */ }
      try { xml = await browser.getPageSource(); } catch { /* keep previous */ }
    }
  }

  // 2) Tick any standard (checkable) un-checked checkboxes.
  const candidates = findUncheckedConsentCheckboxes(xml);
  for (const candidate of candidates.slice(0, 5)) {
    try {
      const el = await browser.$(candidate.selector);
      if (!(await el.isExisting())) continue;
      await el.click();
      ticked.push(candidate.label);
      log(`[mobile:consent] ticked un-checked checkbox "${candidate.label}"${candidate.isConsent ? " (consent)" : ""} before pressing accept`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[mobile:consent] could not tick checkbox "${candidate.label}": ${message}`);
    }
  }

  // 3) Custom acceptance row (checkbox + terms link share one native element): only act when the
  // submit control is still gated, and tap the LEFT edge (the checkbox square) so we mark it
  // instead of hitting the link that opens the terms modal.
  if (isSubmitGated(xml)) {
    const row = findConsentAcceptanceRow(xml);
    if (row) {
      const x = row.bounds.x1 + 55;
      const y = Math.round((row.bounds.y1 + row.bounds.y2) / 2);
      try {
        await (browser as WebdriverIO.Browser & { execute: (s: string, a: unknown) => Promise<unknown> })
          .execute("mobile: clickGesture", { x, y });
        ticked.push(row.label);
        log(`[mobile:consent] marked acceptance checkbox (left edge ${x},${y}) for "${row.label}" — enables the gated button`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`[mobile:consent] could not mark acceptance row "${row.label}": ${message}`);
      }
    }
  }

  return { ticked };
}
