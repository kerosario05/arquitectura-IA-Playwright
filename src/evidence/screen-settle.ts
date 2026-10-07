import type { Page } from "@playwright/test";

const EVIDENCE_PLACEHOLDER_PATTERN = String.raw`^(?:(?:indicar|seleccione|seleccionar|select|choose|elige|elegir|escriba|ingrese|enter|type)\b.*|0+(?:[\s()./-]+0+)+)$`;

/** Text placeholders and unedited input masks are not completed table-cell values. */
export function isMeaningfulEvidenceCellText(value: unknown): boolean {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 && !new RegExp(EVIDENCE_PLACEHOLDER_PATTERN, "i").test(text);
}

export type VisualSettleOptions = {
  /** Upper bound for the wait. The caller must not capture an unsettled frame. */
  timeoutMs: number;
  /** Required stretch with no DOM mutation and no visible loading indicator. */
  quietMs: number;
};

export type VisualSettleResult = {
  settled: boolean;
  waitedMs: number;
  /** A recognized loading indicator was still visible when the budget ran out. */
  loaderVisible: boolean;
};

/**
 * Identity of a useful evidence checkpoint. It avoids recording raw form data, while detecting
 * completed form groups and completed data rows in addition to route/heading changes.
 */
export async function readScreenSignature(page: Page): Promise<string> {
  if (page.isClosed()) return "";
  const source = `(() => {
    const visible = function (element) {
      if (!element || !element.getBoundingClientRect) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
    };
    const normalized = function (value) { return String(value == null ? '' : value).replace(/\\s+/g, ' ').trim().slice(0, 80); };
    const placeholderValue = new RegExp(${JSON.stringify(EVIDENCE_PLACEHOLDER_PATTERN)}, 'i');
    const meaningful = function (value) {
      const text = normalized(value);
      return text.length > 0 && !placeholderValue.test(text);
    };
    const marks = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"], legend, [role="dialog"], [role="alertdialog"], dialog'))
      .filter(visible)
      .map(function (element) { return (element.getAttribute('role') || element.tagName.toLowerCase()) + ':' + normalized(element.innerText); });
    const controlsIn = function (root) {
      return Array.from(root.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]'))
        .filter(visible)
        .filter(function (element) { return !element.matches(':disabled,[aria-disabled="true"]'); });
    };
    const isFilled = function (element) {
      const tag = element.tagName.toLowerCase();
      const type = (element.getAttribute('type') || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return Boolean(element.checked);
      if (tag === 'select') {
        const optionText = element.options && element.selectedIndex >= 0 ? element.options[element.selectedIndex].textContent : element.value;
        return meaningful(element.value) && meaningful(optionText);
      }
      if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') return meaningful(element.innerText);
      return meaningful(element.value);
    };
    const visibleForms = Array.from(document.querySelectorAll('form')).filter(visible);
    const formRoots = visibleForms.length
      ? visibleForms
      : [document.querySelector('main,[role="main"]') || document.body].filter(Boolean);
    const completeFormGroups = formRoots.filter(function (root) {
      const controls = controlsIn(root);
      if (controls.length === 0) return false;
      const filled = controls.filter(isFilled).length;
      return filled === controls.length;
    }).length;
    const completeRows = Array.from(document.querySelectorAll('table tr,[role="rowgroup"] [role="row"]'))
      .filter(visible)
      .filter(function (row) {
        if (row.matches('thead tr,[role="columnheader"]')) return false;
        const controls = controlsIn(row);
        if (controls.length > 0) {
          const filled = controls.filter(isFilled).length;
          // A row checkpoint must represent a finished row. A percentage threshold can capture
          // too early when the last business field (often a date) is still an untouched placeholder.
          return filled === controls.length;
        }
        const cells = Array.from(row.querySelectorAll('td,[role="cell"],[role="gridcell"]')).filter(visible);
        const dataCells = cells.filter(function (cell) {
          if (cell.querySelector('input[type="checkbox"],[role="checkbox"],[aria-label*="seleccionar fila" i]')) return false;
          const text = normalized(cell.innerText);
          const actionOnly = /^(?:\.{3,}|…+|•{2,}|⋮|more options|más opciones)$/i.test(text);
          return !(actionOnly && cell.querySelector('button,[role="button"]'));
        });
        return dataCells.length > 1 && dataCells.every(function (cell) { return meaningful(cell.innerText); });
      }).length;
    return location.pathname + '|' + marks.join('¦') + '|completeForms=' + completeFormGroups + '|completeRows=' + completeRows;
  })()`;
  return page.evaluate(source).then((value) => String(value)).catch(() => "");
}

/**
 * Wait until visible loading signals disappear and the page has had a quiet stretch. Supports
 * accessible busy/progress signals, common loader/skeleton semantics and infinite animations.
 * This function is bounded; callers must keep the last settled image when it times out.
 */
export async function waitForVisualSettle(page: Page, options: VisualSettleOptions): Promise<VisualSettleResult> {
  const startedAt = Date.now();
  if (page.isClosed()) return { settled: false, waitedMs: 0, loaderVisible: false };
  // Keep lightweight page doubles used by callers and unit-level adapters compatible; real
  // Playwright pages always expose waitForFunction and receive the full visual readiness probe.
  if (typeof (page as any).waitForFunction !== "function") {
    return { settled: true, waitedMs: 0, loaderVisible: false };
  }
  const probe = `(() => {
    const win = window;
    if (!win.__evidenceSettle) {
      const created = { lastMutation: performance.now() };
      new MutationObserver(() => { created.lastMutation = performance.now(); }).observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, characterData: true,
      });
      win.__evidenceSettle = created;
    }
    const state = win.__evidenceSettle;
    const isVisible = function (element) {
      if (!element || !element.getBoundingClientRect) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return false;
      const style = getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
    };
    const semanticLoader = Array.from(document.querySelectorAll('[aria-busy="true"], [role="progressbar"], progress, [data-loading="true"], [aria-label*="loading" i], [aria-label*="cargando" i], [title*="loading" i], [title*="cargando" i]')).some(isVisible);
    const loaderCandidates = '[class*="spin" i], [class*="load" i], [class*="skeleton" i], [class*="progress" i], [id*="spin" i], [id*="load" i], [data-testid*="spin" i], [data-testid*="load" i]';
    const namedLoader = Array.from(document.querySelectorAll(loaderCandidates)).some(function (element) {
      if (!isVisible(element)) return false;
      const names = [element.id, typeof element.className === 'string' ? element.className : '', element.getAttribute('data-testid') || '', element.getAttribute('role') || ''].join(' ');
      return /(^|[-_\\s])(spinner|spin|loader|loading|skeleton|progress)([-_\\s]|$)/i.test(names);
    });
    const animated = typeof document.getAnimations === 'function' && document.getAnimations().some(function (animation) {
      if (animation.playState !== 'running') return false;
      const effect = animation.effect;
      return Boolean(effect) && effect.getComputedTiming().iterations === Infinity && isVisible(effect.target || null);
    });
    const busy = semanticLoader || namedLoader || animated;
    if (busy) {
      state.lastMutation = performance.now();
      return false;
    }
    return performance.now() - state.lastMutation >= ${Math.max(0, Math.floor(options.quietMs))};
  })()`;
  try {
    await page.waitForFunction(probe, undefined, { timeout: options.timeoutMs, polling: 100 });
    return { settled: true, waitedMs: Date.now() - startedAt, loaderVisible: false };
  } catch {
    const loaderVisible = page.isClosed()
      ? false
      : await page.evaluate(() => {
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width >= 4 && rect.height >= 4 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
        };
        const semanticLoader = Array.from(document.querySelectorAll('[aria-busy="true"], [role="progressbar"], progress, [data-loading="true"], [aria-label*="loading" i], [aria-label*="cargando" i], [title*="loading" i], [title*="cargando" i]')).some(isVisible);
        const loaderCandidates = '[class*="spin" i], [class*="load" i], [class*="skeleton" i], [class*="progress" i], [id*="spin" i], [id*="load" i], [data-testid*="spin" i], [data-testid*="load" i]';
        const namedLoader = Array.from(document.querySelectorAll(loaderCandidates)).some((element) => {
          if (!isVisible(element)) return false;
          const names = [element.id, typeof element.className === "string" ? element.className : "", element.getAttribute("data-testid") || "", element.getAttribute("role") || ""].join(" ");
          return /(^|[-_\\s])(spinner|spin|loader|loading|skeleton|progress)([-_\\s]|$)/i.test(names);
        });
        const animated = typeof document.getAnimations === "function" && document.getAnimations().some((animation) => {
          if (animation.playState !== "running") return false;
          const effect = animation.effect as KeyframeEffect | null;
          if (!effect || effect.getComputedTiming().iterations !== Infinity) return false;
          const target = effect.target;
          return target instanceof Element && isVisible(target);
        });
        return semanticLoader || namedLoader || animated;
      }).catch(() => false);
    return { settled: false, waitedMs: Date.now() - startedAt, loaderVisible };
  }
}
