import type { Locator, Page } from "@playwright/test";
import type { RecordedLocator, RecordedTechnicalTarget } from "../session-trace.types";

export type DynamicControlSnapshot = {
  tag: string;
  role?: string;
  identity: string;
  semanticRole?: "selection" | "amount_or_text" | "editable" | "display";
  visible: boolean;
  enabled: boolean;
  disabled: boolean;
  value?: string;
  ariaControls?: string;
  ariaSelected?: string;
  stableAttributes: Record<string, string>;
};

export type DynamicSurfaceSnapshot = {
  surfaceRef: string;
  role?: string;
  portalized: boolean;
  visible: boolean;
  options: Array<{ text: string; identity: string; selected: boolean; disabled: boolean }>;
};

export type DynamicComponentSnapshot = {
  state: "DISPLAY" | "ACTIVATED" | "EDITOR_MATERIALIZED" | "SELECTOR_OPEN" | "OPTION_SELECTED" | "DEPENDENT_CONTROL_ENABLED" | "VALUE_EDITING" | "COMMITTED";
  rootIdentity: string;
  triggerIdentity: string;
  activeElementIdentity: string;
  focusTransfer?: { from?: string; to?: string };
  controls: DynamicControlSnapshot[];
  editableControl?: DynamicControlSnapshot;
  selectionControl?: DynamicControlSnapshot;
  surface?: DynamicSurfaceSnapshot;
  structuralContext: {
    gridRef?: string;
    rowRef?: string;
    cellRef?: string;
    headerRef?: string;
    containerRef?: string;
  };
};

export type DynamicComponentObservation = {
  before: DynamicComponentSnapshot;
  after: DynamicComponentSnapshot;
  mutationCount: number;
  mutationsCaptured: string[];
  documentEscalationUsed: boolean;
  portalDetected: boolean;
  ariaControlsFollowed: boolean;
  focusTransferCaptured: boolean;
  lifecycleStates: DynamicComponentSnapshot["state"][];
  transitions: string[];
  technicalTargets: RecordedTechnicalTarget[];
};

type ObserverOptions = { timeoutMs?: number };

const ROOT_MARKER = "data-recording-dynamic-root";
const TRIGGER_MARKER = "data-recording-dynamic-trigger";

async function markRoot(page: Page, trigger: Locator, marker: string): Promise<Locator> {
  const root = trigger.locator("xpath=ancestor::*[self::td or self::th or @role='gridcell' or @data-cell or @data-column][1]");
  if (await root.count().catch(() => 0) > 0) {
    await root.evaluate((element, value) => element.setAttribute("data-recording-dynamic-root", value), marker);
    return page.locator(`[${ROOT_MARKER}="${marker}"]`);
  }
  await trigger.evaluate((element, value) => element.setAttribute("data-recording-dynamic-root", value), marker);
  return page.locator(`[${ROOT_MARKER}="${marker}"]`);
}

export async function captureDynamicComponentSnapshot(root: Locator, trigger?: Locator): Promise<DynamicComponentSnapshot> {
  return root.evaluate((element, triggerMarker) => {
    const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() || undefined;
    const visible = (node: Element) => {
      const html = node as HTMLElement;
      if (html.hidden || node.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && Boolean(html.offsetWidth || html.offsetHeight || node.getClientRects().length);
    };
    const stableAttributes = (node: Element) => Object.fromEntries(
      ["data-testid", "data-test-id", "name", "type", "aria-label", "aria-labelledby", "role", "data-field", "data-column"]
        .map((name) => [name, node.getAttribute(name)])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const identity = (node: Element | null) => {
      if (!node) return "";
      const attrs = stableAttributes(node);
      return `${node.tagName.toLowerCase()}|${Object.entries(attrs).map(([key, value]) => `${key}=${value}`).join("|")}`;
    };
    const editable = (node: Element) => {
      const tag = node.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || node.getAttribute("contenteditable") === "true" || ["textbox", "spinbutton"].includes(node.getAttribute("role") || "");
    };
    const selection = (node: Element) => {
      const tag = node.tagName.toLowerCase();
      return tag === "select" || node.getAttribute("role") === "combobox" || node.hasAttribute("aria-haspopup");
    };
    const grid = element.closest("table, [role='grid'], [data-grid]");
    const row = element.closest("tr, [role='row'], [data-row-id], [data-rowindex]");
    const cell = element.closest("td, th, [role='gridcell'], [role='cell'], [data-cell], [data-column]");
    const header = cell?.getAttribute("data-column") || cell?.getAttribute("data-field") || cell?.getAttribute("aria-colindex")
      || (grid && cell ? Array.from(grid.querySelectorAll("thead th, thead td, [role='columnheader'], [data-header], [data-column-header]")).at(Array.from(row?.querySelectorAll("td, th, [role='gridcell'], [role='cell'], [data-cell], [data-column]") || []).indexOf(cell))?.textContent : undefined);
    const structuralContext = {
      gridRef: grid?.getAttribute("data-testid") || grid?.getAttribute("data-grid") || grid?.getAttribute("role") || undefined,
      rowRef: row?.getAttribute("data-row-id") || row?.getAttribute("data-id") || row?.getAttribute("aria-rowindex") || undefined,
      cellRef: cell?.getAttribute("data-cell") || cell?.getAttribute("data-field") || cell?.getAttribute("data-column") || cell?.getAttribute("aria-colindex") || undefined,
      headerRef: header ? `header:${clean(header)}` : undefined,
      containerRef: element.closest("form, fieldset, [role='group'], [role='region'], [role='dialog']")?.getAttribute("data-testid")
        || element.closest("form, fieldset, [role='group'], [role='region'], [role='dialog']")?.getAttribute("aria-label") || undefined,
    };
    const toControl = (node: Element): DynamicControlSnapshot => {
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute("role") || undefined;
      const isEditable = editable(node);
      const isSelection = selection(node);
      const value = "value" in node && typeof (node as HTMLInputElement).value === "string" ? (node as HTMLInputElement).value : clean(node.textContent);
      return {
        tag,
        role,
        identity: identity(node),
        semanticRole: isSelection ? "selection" : isEditable ? "amount_or_text" : "display",
        visible: visible(node),
        enabled: !("disabled" in node) || !(node as HTMLInputElement).disabled,
        disabled: "disabled" in node && (node as HTMLInputElement).disabled === true,
        value,
        ariaControls: node.getAttribute("aria-controls") || undefined,
        ariaSelected: node.getAttribute("aria-selected") || undefined,
        stableAttributes: stableAttributes(node),
      };
    };
    const controls = Array.from(element.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='spinbutton'], [role='combobox'], button, [role='button']"))
      .filter(visible).map(toControl);
    const triggerElement = triggerMarker ? element.querySelector(`[${CSS.escape("data-recording-dynamic-trigger")}="${CSS.escape(triggerMarker)}"]`) : null;
    const selectionControl = controls.find((control) => control.semanticRole === "selection");
    const editableControl = controls.find((control) => control.semanticRole === "amount_or_text");
    const triggerControl = triggerElement ? toControl(triggerElement) : selectionControl;
    const controlledId = triggerControl?.ariaControls;
    const controlled = controlledId ? document.getElementById(controlledId) : null;
    const surfaceElement = controlled && visible(controlled)
      ? controlled
      : Array.from(document.querySelectorAll("[role='listbox'], [data-options], [role='menu'], [data-option-surface]")).find(visible) || null;
    const surface = surfaceElement ? {
      surfaceRef: surfaceElement.id || identity(surfaceElement),
      role: surfaceElement.getAttribute("role") || undefined,
      portalized: !element.contains(surfaceElement),
      visible: visible(surfaceElement),
      options: Array.from(surfaceElement.querySelectorAll("option, [role='option'], [data-option], [data-value], li"))
        .filter(visible)
        .map((option) => ({ text: clean(option.textContent || option.getAttribute("aria-label") || option.getAttribute("data-value")) || "", identity: identity(option), selected: option.getAttribute("aria-selected") === "true" || (option as HTMLOptionElement).selected === true, disabled: (option as HTMLOptionElement).disabled === true })),
    } : undefined;
    const selected = surface?.options.find((option) => option.selected);
    const hasValue = Boolean(editableControl?.value);
    const state = selected ? "OPTION_SELECTED" : surface?.visible ? "SELECTOR_OPEN" : hasValue && editableControl?.enabled ? "VALUE_EDITING" : editableControl ? "EDITOR_MATERIALIZED" : "DISPLAY";
    const active = document.activeElement && element.contains(document.activeElement) ? identity(document.activeElement) : identity(document.activeElement);
    return {
      state,
      rootIdentity: identity(element),
      triggerIdentity: triggerControl?.identity || "",
      activeElementIdentity: active,
      controls,
      editableControl,
      selectionControl,
      surface,
      structuralContext,
    };
  }, await trigger?.getAttribute(TRIGGER_MARKER, { timeout: 50 }).catch(() => undefined));
}

export function technicalTargetsForSnapshot(snapshot: DynamicComponentSnapshot, validatedByInteraction = false): RecordedTechnicalTarget[] {
  const targets: RecordedTechnicalTarget[] = [];
  for (const control of [snapshot.editableControl, snapshot.selectionControl].filter((value): value is DynamicControlSnapshot => Boolean(value))) {
    const locators: RecordedLocator[] = [];
    const attrs = control.stableAttributes;
    if (attrs["data-testid"] || attrs["data-test-id"]) locators.push({ strategy: "data-testid", value: attrs["data-testid"] || attrs["data-test-id"], confidence: 0.98 });
    if (attrs["aria-label"]) locators.push({ strategy: "aria-label", value: attrs["aria-label"], confidence: 0.9 });
    if (attrs.name) locators.push({ strategy: "css", value: `[name="${attrs.name.replace(/"/g, "\\\"")}"]`, confidence: 0.65 });
    const context = snapshot.structuralContext;
    if (context.cellRef || context.headerRef) {
      locators.push({
        strategy: "structural",
        value: [context.gridRef && `grid=${context.gridRef}`, context.rowRef && `row=${context.rowRef}`, context.cellRef && `cell=${context.cellRef}`, context.headerRef && `header=${context.headerRef}`, `role=${control.semanticRole}`].filter(Boolean).join("|"),
        confidence: 0.72,
      });
    }
    targets.push({
      targetType: control.semanticRole === "selection" ? "selection" : "editable",
      semanticRole: control.semanticRole === "selection" ? "selection" : control.semanticRole === "amount_or_text" ? "amount_or_text" : "editable",
      locatorCandidates: locators,
      structuralContext: context,
      stableAttributes: attrs,
      interactionEvidence: [control.identity, snapshot.state],
      lifecycleRef: `${snapshot.rootIdentity}:${control.identity}`,
      confidence: locators.length > 0 ? 0.9 : 0.45,
      validatedByInteraction,
    });
  }
  return targets;
}

export async function observeDynamicComponentActivation(
  page: Page,
  trigger: Locator,
  options: ObserverOptions = {},
): Promise<DynamicComponentObservation> {
  const marker = `dynamic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const root = await markRoot(page, trigger, marker);
  await trigger.evaluate((element, value) => element.setAttribute("data-recording-dynamic-trigger", value), marker);
  await page.evaluate(({ marker, rootMarker }) => {
    const root = document.querySelector(`[${rootMarker}="${marker}"]`);
    if (!root) return;
    const key = `__recordingDynamicObserver_${marker}`;
    const state = { mutations: [] as string[], escalated: false, portal: false, ariaControls: false, focus: [] as string[], localObserver: undefined as MutationObserver | undefined, documentObserver: undefined as MutationObserver | undefined, focusHandler: undefined as ((event: FocusEvent) => void) | undefined };
    const inspect = () => {
      const trigger = root.querySelector(`[data-recording-dynamic-trigger="${marker}"]`);
      const controls = trigger ? [trigger, ...Array.from(root.querySelectorAll("[aria-controls], [aria-owns], [aria-haspopup]"))] : [];
      const ids = controls.flatMap((node) => [node.getAttribute("aria-controls"), node.getAttribute("aria-owns")].filter(Boolean) as string[]);
      if (ids.length > 0) {
        state.ariaControls = true;
        state.portal = ids.some((id) => { const controlled = document.getElementById(id); return Boolean(controlled && !root.contains(controlled)); });
      }
      const active = document.activeElement;
      if (active && !root.contains(active)) state.escalated = true;
    };
    const escalate = () => {
      if (state.escalated || !document.body) return;
      state.escalated = true;
      state.documentObserver = new MutationObserver((records) => records.slice(0, 16).forEach((record) => state.mutations.push(`document:${record.type}:${record.addedNodes.length}:${record.removedNodes.length}`)));
      state.documentObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-controls", "aria-expanded", "aria-selected", "data-state", "disabled"] });
    };
    state.localObserver = new MutationObserver((records) => {
      records.slice(0, 16).forEach((record) => state.mutations.push(`local:${record.type}:${record.attributeName || ""}:${record.addedNodes.length}:${record.removedNodes.length}`));
      inspect();
      if (state.ariaControls || state.portal) escalate();
    });
    state.localObserver.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-controls", "aria-expanded", "aria-selected", "data-state", "disabled", "value"] });
    state.focusHandler = (event) => {
      const target = event.target as Element | null;
      if (target && !root.contains(target)) {
        state.focus.push(target.tagName.toLowerCase());
        escalate();
      }
    };
    document.addEventListener("focusin", state.focusHandler, true);
    inspect();
    (window as unknown as Record<string, unknown>)[key] = state;
  }, { marker, rootMarker: ROOT_MARKER });
  const before = await captureDynamicComponentSnapshot(root, trigger);
  await trigger.click();
  const timeout = options.timeoutMs ?? 900;
  const deadline = Date.now() + timeout;
  let stable = 0;
  let previousSignature = "";
  while (Date.now() < deadline) {
    const current = await captureDynamicComponentSnapshot(root, trigger);
    const signature = JSON.stringify({ state: current.state, controls: current.controls.map((control) => [control.identity, control.enabled, control.disabled]), surface: current.surface?.surfaceRef });
    stable = signature === previousSignature ? stable + 1 : 0;
    previousSignature = signature;
    if (stable >= 2) break;
    await page.waitForTimeout(20);
  }
  const after = await captureDynamicComponentSnapshot(root, trigger);
  const runtime = await page.evaluate((key) => {
    const state = (window as unknown as Record<string, any>)[key];
    state?.localObserver?.disconnect();
    state?.documentObserver?.disconnect();
    if (state?.focusHandler) document.removeEventListener("focusin", state.focusHandler, true);
    delete (window as unknown as Record<string, unknown>)[key];
    return state ?? { mutations: [], escalated: false, portal: false, ariaControls: false, focus: [] };
  }, `__recordingDynamicObserver_${marker}`);
  await trigger.evaluate((element, value) => element.removeAttribute("data-recording-dynamic-trigger"), marker, { timeout: 50 }).catch(() => undefined);
  await root.evaluate((element, value) => element.removeAttribute("data-recording-dynamic-root"), marker).catch(() => undefined);
  const states = [before.state, after.state];
  if (after.editableControl && before.editableControl?.disabled && !after.editableControl.disabled) states.push("DEPENDENT_CONTROL_ENABLED");
  const technicalTargets = technicalTargetsForSnapshot(after, false);
  return {
    before,
    after,
    mutationCount: runtime.mutations.length,
    mutationsCaptured: runtime.mutations,
    documentEscalationUsed: runtime.escalated,
    portalDetected: runtime.portal,
    ariaControlsFollowed: runtime.ariaControls,
    focusTransferCaptured: runtime.focus.length > 0,
    lifecycleStates: [...new Set(states)],
    transitions: states.slice(1).map((state, index) => `${states[index]}->${state}`),
    technicalTargets,
  };
}
