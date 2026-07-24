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
  const ridIsClose = Boolean(rid && CLOSE_KEYWORDS.some((kw) => normalize(rid).includes(normalize(kw))));
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
};

/**
 * Scans an Appium page-source XML for a blocking modal and a way to close it. Pure — no I/O.
 */
export function detectBlockingModal(pageSourceXml: string): ModalDetection {
  let hasModalContainer = false;
  let closeSelector: string | null = null;
  let closeLabel: string | null = null;
  if (!pageSourceXml) return { hasModalContainer, closeSelector, closeLabel };

  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const tag = normalize(m[1]);
    const attrs = parseAttrs(m[2]);
    const rid = normalize(attrs["resource-id"] || "");
    if (MODAL_CLASS_HINTS.some((h) => tag.includes(h) || rid.includes(h))) {
      hasModalContainer = true;
    }
    if (!closeSelector) {
      const sel = closeSelectorFor(attrs);
      if (sel) {
        closeSelector = sel;
        closeLabel = (attrs["content-desc"] || attrs["text"] || attrs["resource-id"] || "cerrar").trim();
      }
    }
  }
  return { hasModalContainer, closeSelector, closeLabel };
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
