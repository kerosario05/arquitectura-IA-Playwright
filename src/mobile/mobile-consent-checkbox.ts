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
 *
 * Uses content-desc first to avoid the inner TextView (clickable=false) overwriting the
 * parent ViewGroup (clickable=true). Once a desc-based match is found, text-based matches
 * are ignored entirely.
 */
export function isSubmitGated(pageSourceXml: string): boolean {
  let descBasedDisabled = false;
  let descFound = false;
  let textBasedDisabled = false;
  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const attrs = parseAttrs(m[2]);
    const desc = (attrs["content-desc"] || "").trim();
    const text = (attrs.text || "").trim();
    const label = normalize(desc || text || "");
    if (!label) continue;
    if (SUBMIT_GATE_KEYWORDS.some((kw) => label === normalize(kw))) {
      const disabled = attrs.enabled === "false" || attrs.clickable === "false";
      if (desc.length > 0) {
        descBasedDisabled = disabled;
        descFound = true;
      } else if (!descFound) {
        textBasedDisabled = disabled;
      }
    }
  }
  return descBasedDisabled || textBasedDisabled;
}

// ---------------------------------------------------------------------------
// Diagnostic: observe submit-gate state after a consent tap
// ---------------------------------------------------------------------------

type GateSample = {
  elapsedMs: number;
  submitFound: boolean;
  submitEnabled: boolean;
  gated: boolean;
  consentCandidateFound: boolean;
};

/**
 * Parse a page-source XML and return structural gate info without relying on the `checked`
 * attribute (which is unreliable for custom consent components like ViewGroup toggles).
 *
 * IMPORTANT: Only consider `content-desc`-based matches for submit buttons (not `text`-based)
 * because the inner TextView of a button has `clickable="false"` while the parent ViewGroup
 * has `clickable="true"` — matching on `text` would overwrite the correct value.
 * Also track the leading-comma pattern in consent content-desc (", Acepto…") as a checked indicator.
 */
function observeGateState(pageSourceXml: string): Omit<GateSample, "elapsedMs"> {
  let submitFound = false;
  let submitEnabled = false;
  let gated = false;
  let consentCandidateFound = false;

  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const attrs = parseAttrs(m[2]);
    const desc = (attrs["content-desc"] || "").trim();
    const text = (attrs.text || "").trim();
    const label = normalize(desc || text || "");
    if (!label) continue;

    // Submit-button detection: prefer content-desc matches (ViewGroup with clickable=true)
    // over text matches (inner TextView with clickable=false) to avoid overwriting.
    if (SUBMIT_GATE_KEYWORDS.some((kw) => label === normalize(kw))) {
      const isDescMatch = desc.length > 0;
      const enabled = attrs.enabled !== "false" && attrs.clickable !== "false";
      if (isDescMatch) {
        // content-desc match is authoritative — always update.
        submitFound = true;
        submitEnabled = enabled;
        gated = !submitEnabled;
      } else if (!submitFound) {
        // text-only match — only use if no desc-based match has been seen yet.
        submitFound = true;
        submitEnabled = enabled;
        gated = !submitEnabled;
      }
    }

    // Consent-candidate detection: wide clickable element with acceptance wording.
    // Also detect the leading-comma pattern (", Acepto…") which indicates a checked state.
    if (attrs.clickable === "true") {
      const nd = normalize(desc);
      if (nd.startsWith("acepto") || nd.startsWith(", acepto") ||
          (nd.includes("acepto") && (nd.includes("termino") || nd.includes("condicion")))) {
        consentCandidateFound = true;
      }
    }
  }

  return { submitFound, submitEnabled, gated, consentCandidateFound };
}

/**
 * After a consent tap (Branch B clickGesture), observe the submit-gate state at ~0ms, ~300ms,
 * and ~1000ms to detect whether the tap actually enabled the button, whether the app re-rendered
 * it away, or whether the gate never changed.
 *
 * Does NOT perform any additional taps — purely observational.
 */
async function observePostTapGate(
  browser: WebdriverIO.Browser,
  tapTimestampMs: number,
  log: (line: string) => void
): Promise<{ gateSatisfiedAfterTap: boolean }> {
  const samples: GateSample[] = [];
  const checkpoints = [0, 300, 1000]; // ms since tap

  for (const targetMs of checkpoints) {
    const elapsed = Date.now() - tapTimestampMs;
    const waitMs = Math.max(0, targetMs - elapsed);
    if (waitMs > 0) {
      try { await browser.pause(waitMs); } catch { /* pause unavailable in tests */ }
    }

    let xml = "";
    try { xml = await browser.getPageSource(); } catch { continue; }

    const state = observeGateState(xml);
    const elapsedMs = Date.now() - tapTimestampMs;
    samples.push({ elapsedMs, ...state });

    log(
      `[mobile:consent-state] elapsedMs=${elapsedMs}` +
      ` submitFound=${state.submitFound}` +
      ` submitEnabled=${state.submitEnabled}` +
      ` gated=${state.gated}` +
      ` consentCandidateFound=${state.consentCandidateFound}`,
    );
  }

  // Determine if the gate was ever satisfied after the tap.
  const gateSatisfiedAfterTap = samples.some((s) => s.submitFound && s.submitEnabled && !s.gated);
  log(`[mobile:consent] tapExecuted=true gateSatisfiedAfterTap=${gateSatisfiedAfterTap}`);
  return { gateSatisfiedAfterTap };
}

export type ConsentAcceptanceRow = { bounds: Bounds; label: string; checkboxBounds: Bounds | null };

/**
 * Scan the page-source XML for a compact descendant inside `parentBounds` that looks like a
 * custom checkbox/toggle control.  Selection is purely geometric and layout-agnostic:
 *
 * 1. Must be fully contained within the parent row.
 * 2. Both dimensions must be small relative to the row (< 30 % width, < 40 % height).
 * 3. Must sit near one of the horizontal edges of the row (within 10 % of row width).
 * 4. Among qualifying candidates, prefer the one with the smallest area (most compact).
 *
 * Returns the element's bounds or `null` when nothing convincing is found.  Pure — no I/O.
 */
function findConsentCheckboxBounds(pageSourceXml: string, parentBounds: Bounds): Bounds | null {
  const parentWidth = parentBounds.x2 - parentBounds.x1;
  const parentHeight = parentBounds.y2 - parentBounds.y1;
  const maxDimX = parentWidth * 0.3;
  const maxDimY = parentHeight * 0.4;
  const edgeMargin = parentWidth * 0.1;

  let best: Bounds | null = null;
  let bestArea = Infinity;
  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const attrs = parseAttrs(m[2]);
    const b = parseBounds(attrs.bounds || "");
    if (!b) continue;
    if (b.x1 < parentBounds.x1 || b.y1 < parentBounds.y1 || b.x2 > parentBounds.x2 || b.y2 > parentBounds.y2) continue;
    const w = b.x2 - b.x1;
    const h = b.y2 - b.y1;
    if (w <= 0 || h <= 0) continue;
    if (w > maxDimX || h > maxDimY) continue;
    const distFromLeft = b.x1 - parentBounds.x1;
    const distFromRight = parentBounds.x2 - b.x2;
    if (distFromLeft > edgeMargin && distFromRight > edgeMargin) continue;
    const area = w * h;
    if (area < bestArea) { bestArea = area; best = b; }
  }
  return best;
}

/**
 * Finds a consent ACCEPTANCE ROW: a wide clickable element (not a standard checkbox) whose
 * content-desc is the acceptance sentence ("Acepto los términos…"). In com.appconversacionalbsc
 * the checkbox and the "Términos y Condiciones" link share one native row — tapping its centre hits
 * the link and opens the modal, so this must be tapped on the checkbox square, not the row center.
 */
export function findConsentAcceptanceRow(pageSourceXml: string): ConsentAcceptanceRow {
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
    const checkboxBounds = findConsentCheckboxBounds(pageSourceXml, b);
    return { bounds: b, label: desc.slice(0, 60), checkboxBounds };
  }
  return { bounds: { x1: 0, y1: 0, x2: 0, y2: 0 }, label: "", checkboxBounds: null };
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
  // submit control is still gated, and tap the LEFT edge of the row at the ROW's CENTER Y.
  //
  // IMPORTANT: Clicking ON the checkbox visual (inner ViewGroup) opens the T&C modal instead of
  // toggling the checkbox. The actual toggle happens when clicking the LEFT edge of the row at a
  // Y coordinate BELOW the checkbox visual — specifically at the row's vertical center.
  // Empirical evidence: for row [84,1466][1356,1907] with checkbox visual [84,1466][168,1550],
  //   - (126, 1508) = checkbox center → opens T&C modal (WRONG)
  //   - (126, 1686) = left edge at row center Y → toggles checkbox, enables Continuar (CORRECT)
  if (isSubmitGated(xml)) {
    const row = findConsentAcceptanceRow(xml);
    if (row && row.label) {
      // X: center of checkbox visual X range (or 7.5% of row width as fallback)
      // Y: ROW center Y (below the checkbox visual, in the row body)
      const x = row.checkboxBounds
        ? Math.round((row.checkboxBounds.x1 + row.checkboxBounds.x2) / 2)
        : Math.round(row.bounds.x1 + (row.bounds.x2 - row.bounds.x1) * 0.075);
      const y = Math.round((row.bounds.y1 + row.bounds.y2) / 2);
      try {
        const tapTimestampMs = Date.now();
        await (browser as WebdriverIO.Browser & { execute: (s: string, a: unknown) => Promise<unknown> })
          .execute("mobile: clickGesture", { x, y });
        ticked.push(row.label);
        const targetDesc = row.checkboxBounds ? "leftEdgeAtRowCenterY" : "rowFallback";
        log(`[mobile:consent] marked acceptance checkbox (${targetDesc} ${x},${y}) for "${row.label}" — enables the gated button`);

        // Diagnostic: observe whether the tap actually satisfied the submit gate.
        await observePostTapGate(browser, tapTimestampMs, log);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`[mobile:consent] could not mark acceptance row "${row.label}": ${message}`);
      }
    }
  }

  return { ticked };
}
