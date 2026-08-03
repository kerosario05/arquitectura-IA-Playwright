/**
 * Blocking-modal recovery for mobile execution.
 *
 * A step may open something (a dialog, popup, bottom sheet, dropdown overlay) that does NOT
 * contain the next step's target. When the next step's element can't be found, this module
 * detects the open modal and dismisses it (tapping a close/cancel affordance, or pressing the
 * Android back button as a fallback) so the runner can look for the target on the screen
 * underneath. Detection is pure (over Appium page-source XML); dismissal is best-effort and
 * never throws.
 */

type ElementAttrs = Record<string, string>;

const ELEMENT_RE = /<([\w.]+)\b([^>]*?)\/?>/g;
const ATTR_RE = /([\w:-]+)="([^"]*)"/g;

/** Class/resource-id hints that indicate an actual modal container is on screen. */
const MODAL_CLASS_HINTS = [
  "dialog", "alertdialog", "modal", "popup", "popupwindow", "bottomsheet", "sheet", "overlay"
];

/** Short affordance wording that closes/dismisses a modal. */
const CLOSE_KEYWORDS = [
  "cerrar", "close", "cancelar", "cancel", "dismiss", "descartar",
  "atras", "atrás", "back", "volver", "×", "✕", "✖"
];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseAttrs(rawAttrs: string): ElementAttrs {
  const attrs: ElementAttrs = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(rawAttrs)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function escapeForUiSelector(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function closeSelectorFor(attrs: ElementAttrs): string | null {
  const desc = attrs["content-desc"];
  const text = attrs["text"];
  const rid = attrs["resource-id"];
  // Match a SHORT label so we don't treat a paragraph like "cancelar mi suscripción..." as a
  // close button. A close affordance is typically a tiny "X"/"Cerrar"/"Cancelar".
  const label = (desc || text || "").trim();
  const labelIsClose =
    label.length > 0 && label.length <= 14 && CLOSE_KEYWORDS.some((kw) => normalize(label) === normalize(kw) || normalize(label).includes(normalize(kw)));
  // resource-id matching uses only id-shaped close words (not directional ones like "back", which
  // would false-match "navigationBarBackground"), and never a background/container id.
  const nrid = normalize(rid || "");
  const ridIsClose = Boolean(
    rid &&
    !nrid.includes("background") &&
    ["close", "cerrar", "cancel", "dismiss", "descartar", "btnclose", "iconclose"].some((kw) => nrid.includes(kw))
  );
  if (!labelIsClose && !ridIsClose) return null;
  if (rid && ridIsClose) return `android=new UiSelector().resourceId("${escapeForUiSelector(rid)}")`;
  if (desc) return `android=new UiSelector().description("${escapeForUiSelector(desc)}")`;
  if (text) return `android=new UiSelector().text("${escapeForUiSelector(text)}")`;
  if (rid) return `android=new UiSelector().resourceId("${escapeForUiSelector(rid)}")`;
  return null;
}

export type ModalDetection = {
  /** A modal container (by class/resource-id) is present on screen. */
  hasModalContainer: boolean;
  /** Selector of a close/cancel affordance, if one was found. */
  closeSelector: string | null;
  /** Label of the close affordance (for logging). */
  closeLabel: string | null;
  /** Coordinate of a close (X) control found by geometry when it has no usable label/desc. */
  closeTap: { x: number; y: number } | null;
  /** True when the open modal is a terms & conditions dialog (content shows the terms text). */
  isTermsModal: boolean;
};

type Bounds = { x1: number; y1: number; x2: number; y2: number };

function parseBounds(raw: string): Bounds | null {
  const m = raw.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

/** Terms/consent wording that identifies the terms modal by its content-desc or body text. */
const TERMS_MODAL_HINTS = ["terminos y condiciones", "términos y condiciones", "terminos y condiciones de uso"];

/**
 * Finds a close (X) control that carries no usable text/desc — a small clickable element sitting
 * in the modal's top-right corner. Returns its center coordinate. This is how the terms modal in
 * com.appconversacionalbsc exposes its X (empty content-desc), which keyword matching can't find.
 */
function findGeometricCloseTap(pageSourceXml: string): { x: number; y: number } | null {
  const rootDims = pageSourceXml.match(/<hierarchy[^>]*width="(\d+)"[^>]*height="(\d+)"/);
  const screenW = rootDims ? +rootDims[1] : 1440;
  const screenH = rootDims ? +rootDims[2] : 3120;

  let best: { x: number; y: number; area: number } | null = null;
  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const attrs = parseAttrs(m[2]);
    if (attrs.clickable !== "true") continue;
    // The close X carries no real words — either empty, an "X"/"×", or an icon-font glyph (a
    // Private-Use-Area char). Reject only elements whose label has actual words (2+ letters).
    const label = `${attrs["content-desc"] || ""} ${attrs.text || ""}`;
    const meaningful = label.replace(/[^\p{L}\p{N}]/gu, "");
    if (meaningful.length > 1) continue;
    const b = parseBounds(attrs.bounds || "");
    if (!b) continue;
    const w = b.x2 - b.x1;
    const h = b.y2 - b.y1;
    if (w <= 0 || h <= 0 || w > 220 || h > 220) continue; // small control
    // Upper-right quadrant of the screen.
    if (b.x1 < screenW * 0.55 || b.y1 > screenH * 0.45) continue;
    const area = w * h;
    if (!best || area < best.area) best = { x: Math.round((b.x1 + b.x2) / 2), y: Math.round((b.y1 + b.y2) / 2), area };
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Scans an Appium page-source XML for a blocking modal and a way to close it. Pure — no I/O.
 */
export function detectBlockingModal(pageSourceXml: string): ModalDetection {
  let hasModalContainer = false;
  let closeSelector: string | null = null;
  let closeLabel: string | null = null;
  let isTermsModal = false;
  if (!pageSourceXml) return { hasModalContainer, closeSelector, closeLabel, closeTap: null, isTermsModal };

  // The terms modal is only "open/blocking" when its PANEL is on screen: an element whose
  // content-desc is exactly "Términos y Condiciones" plus the body text. A substring match over the
  // whole tree would false-fire on the acceptance row ("Acepto los términos…") of the form behind it.
  const hasTermsBody = normalize(pageSourceXml).includes("terminos y condiciones de uso");
  let hasTermsPanel = false;

  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const tag = normalize(m[1]);
    const attrs = parseAttrs(m[2]);
    const rid = normalize(attrs["resource-id"] || "");
    if (MODAL_CLASS_HINTS.some((h) => tag.includes(h) || rid.includes(h))) {
      hasModalContainer = true;
    }
    if (TERMS_MODAL_HINTS.includes(normalize((attrs["content-desc"] || "").trim()))) {
      hasTermsPanel = true;
    }
    if (!closeSelector) {
      const sel = closeSelectorFor(attrs);
      if (sel) {
        closeSelector = sel;
        closeLabel = (attrs["content-desc"] || attrs["text"] || attrs["resource-id"] || "cerrar").trim();
      }
    }
  }

  // The terms modal is a full-screen overlay with no dialog class and an unlabeled X — treat it as
  // a container and resolve its close control by geometry.
  isTermsModal = hasTermsPanel && hasTermsBody;
  const closeTap = isTermsModal ? findGeometricCloseTap(pageSourceXml) : null;
  if (isTermsModal) hasModalContainer = true;

  return { hasModalContainer, closeSelector, closeLabel, closeTap, isTermsModal };
}

/** Reads the enable flag (default ON; only "false" disables). */
export function isModalRecoveryEnabled(): boolean {
  return (process.env.MOBILE_MODAL_RECOVERY_ENABLED ?? "true").toLowerCase() !== "false";
}

/**
 * Best-effort: if a blocking modal is on screen, close it (tap a close/cancel affordance, or
 * press Android back when only a modal container is detected). Returns true if it dismissed
 * something. Never throws. Only presses back() when a modal container is actually detected, so
 * it won't accidentally navigate away from a plain screen.
 */
export async function dismissBlockingModal(
  browser: WebdriverIO.Browser,
  log: (line: string) => void = () => {}
): Promise<boolean> {
  if (!isModalRecoveryEnabled()) return false;

  let xml: string;
  try {
    xml = await browser.getPageSource();
  } catch {
    return false;
  }

  const det = detectBlockingModal(xml);

  // Terms modal first: its real close is the unlabeled X (top-right), tapped by coordinate — a
  // keyword-matched closeSelector here is usually a false positive (e.g. a background id).
  if (det.isTermsModal && det.closeTap) {
    try {
      await (browser as WebdriverIO.Browser & { execute: (s: string, a: unknown) => Promise<unknown> })
        .execute("mobile: clickGesture", { x: det.closeTap.x, y: det.closeTap.y });
      log(`[mobile:modal] closed terms modal via X at (${det.closeTap.x},${det.closeTap.y})`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[mobile:modal] failed to tap terms-modal X: ${message}`);
    }
  }

  // Prefer an explicit close/cancel affordance.
  if (det.closeSelector) {
    try {
      const el = await browser.$(det.closeSelector);
      if (await el.isExisting()) {
        await el.click();
        log(`[mobile:modal] closed modal via "${det.closeLabel}" to look for the next step outside it`);
        return true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[mobile:modal] failed to tap close affordance "${det.closeLabel}": ${message}`);
    }
  }

  // Non-terms modal with a geometric X.
  if (det.closeTap) {
    try {
      await (browser as WebdriverIO.Browser & { execute: (s: string, a: unknown) => Promise<unknown> })
        .execute("mobile: clickGesture", { x: det.closeTap.x, y: det.closeTap.y });
      log(`[mobile:modal] closed ${det.isTermsModal ? "terms " : ""}modal via X at (${det.closeTap.x},${det.closeTap.y})`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[mobile:modal] failed to tap close X by coordinate: ${message}`);
    }
  }

  // Fallback: only press back when a modal container is genuinely present.
  if (det.hasModalContainer) {
    try {
      await browser.back();
      log(`[mobile:modal] pressed back to dismiss modal and look for the next step underneath`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[mobile:modal] failed to press back: ${message}`);
    }
  }

  return false;
}
