import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { extractRuntimeUiSnapshot, type RuntimeUiSnapshot } from "../../knowledge/runtime-knowledge-extractor";
import type {
  FieldOwnerDiagnostic,
  RecordedControl,
  RecordedDynamicLifecycle,
  RecordedEvent,
  RecordedLocator,
  RecordedScreen,
  RecordedStateSnapshot,
  RecordedTechnicalTarget,
} from "../session-trace.types";
import { preserveCapturedTechnicalTargetLocators } from "../technical-target-transport";
import { ACTIONABILITY_CONTRACT_SOURCE } from "../actionability-contract";
import { STRUCTURAL_OWNER_IDENTITY_SOURCE, type PlaywrightRecorderEvidence, type SemanticRuntimeEvidence } from "../structural-owner-identity";
import { SELECT_SEMANTIC_FIELD_OWNER_LABEL_SOURCE } from "../field-owner-label-selection";
import { SHOULD_FLUSH_EDITING_SESSION_FILL_SOURCE } from "../field-edit-flush-decision";
import { CaptureEngineV2ShadowBridge, type ShadowActionRecord, type ShadowBrowserMessage, type ShadowFunctionalActionRecord } from "../capture-engine-v2.shadow-bridge";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";
import { adaptCaptureActionToRawInteraction } from "../capture-engine-v2.raw-interaction-adapter";
import { isGenericUnresolvedLabel } from "../trace-normalizer";
import { executeRecordingControlAction, type RecordingControlAction, type RecordingControlResult } from "../recording-control";
export { preserveCapturedTechnicalTargetLocators } from "../technical-target-transport";

/**
 * Structural identity of a page state.
 *
 * Built from the SHAPE of the controls (their roles and identities), never from their text
 * content: a list that renders different rows is the same screen, while a form that gains a
 * field is not. Sorting makes it order-independent, so a re-render that reshuffles the DOM
 * does not read as navigation.
 */
export function fingerprintSnapshot(snapshot: RuntimeUiSnapshot): string {
  const canonical = snapshot.observedControls
    .map((c) => [c.role ?? "", c.locatorIdentity ?? "", c.href ?? ""].join("|"))
    .concat(snapshot.inputLabels.map((l) => `input|${l}`))
    .concat(snapshot.selectLabels.map((l) => `select|${l}`))
    .sort()
    .join(";");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Observes a human driving the web app in a real, visible browser.
 *
 * The web side needs none of the Android machinery: the page itself can tell us what was
 * clicked. An init script installs capture-phase listeners in every frame and hands each
 * interaction back through an exposed binding, together with the identity of the element —
 * so the locator is computed where the element actually lives, not reconstructed later from
 * a coordinate.
 *
 * The browser is launched headed on purpose. This is not automation; a person is meant to
 * use it.
 */

export type WebRecorderOptions = {
  baseUrl: string;
  framesDir: string;
  /** Project-scoped TLS policy; false remains the safe default. */
  ignoreHTTPSErrors?: boolean;
  /** QA-only project policy; false keeps secure values out of the trace. */
  persistQaCredentials?: boolean;
  browserName?: "chromium" | "firefox" | "webkit";
  /** Labels or names whose typed content must never be stored verbatim. */
  sensitiveLabels?: string[];
  /**
   * Which capture path feeds `SessionTrace` for this session -- resolved once, never changed
   * mid-session. Defaults to `"v2"`: CaptureEngine V2 is the WEB recorder, not a selectable
   * feature. `"legacy"` remains only as an explicit, API-INTERNAL override for
   * tests/regression/rollback -- never a value a public caller/request should set. See the
   * `captureAuthority` field doc on `WebSessionRecorder` for the full contract.
   */
  captureAuthority?: "legacy" | "v2";
  onLog?: (line: string) => void;
  onEvent?: (event: RecordedEvent) => void;
  onScreen?: (screen: RecordedScreen) => void;
};

export function buildWebRecorderContextOptions(ignoreHTTPSErrors?: boolean): { ignoreHTTPSErrors: boolean } {
  return { ignoreHTTPSErrors: ignoreHTTPSErrors === true };
}

/** How many elements one identity matched in the page, and where the clicked one sat. */
export type LocatorRank = { count: number; index: number };

/** Identity keys the page measures uniqueness for, one per locator candidate. */
export type LocatorRanks = Partial<Record<"testId" | "ariaLabel" | "role" | "domId" | "text" | "name", LocatorRank>>;

type RawInteraction = {
  kind: "click" | "input" | "submit" | "observation" | "press";
  interactionId?: string;
  /** Only present for kind="press" -- a discrete, non-textual command key (e.g. "Enter"). */
  key?: string;
  label: string;
  role?: string;
  tagName?: string;
  inputType?: string;
  disabled?: boolean;
  value?: string;
  testId?: string;
  domId?: string;
  name?: string;
  ariaLabel?: string;
  text?: string;
  placeholder?: string;
  attributes?: Record<string, string>;
  containerContext?: string;
  headerContext?: string;
  rowContext?: string;
  rowIdentity?: string;
  columnIdentity?: string;
  associatedField?: string;
  /** Capture V2 may preserve a functional label while explicitly withholding role-locator authority. */
  technicalRoleName?: string;
  roleTechnicalIdentityEligible?: boolean;
  href?: string;
  /**
   * `window.location.href` captured SYNCHRONOUSLY in the browser at click time -- never confuse
   * with `href` above (an anchor tag's href ATTRIBUTE). See CaptureAction.pageUrlAtClick for why
   * `page.url()` read later, on the Node side, is not reliable once clicks arrive quickly.
   */
  pageUrlAtClick?: string;
  valueSource?: "user" | "application";
  beforeValue?: string;
  afterValue?: string;
  observedOptions?: string[];
  /** Measured in the page at click time — absent for an interaction captured before this. */
  ranks?: LocatorRanks;
  interactionType?: "click" | "select";
  compoundRole?: "selection" | "amount_or_text";
  gridRef?: string;
  rowRef?: string;
  cellRef?: string;
  headerRef?: string;
  containerIdentity?: string;
  beforeState?: RecordedStateSnapshot;
  afterState?: RecordedStateSnapshot;
  activeElementBefore?: RecordedStateSnapshot;
  activeElementAfter?: RecordedStateSnapshot;
  stateDelta?: Record<string, string | boolean | undefined>;
  dynamicLifecycle?: RecordedDynamicLifecycle;
  observationType?: "focus" | "dom_mutation" | "post_action" | "before_input" | "pointer" | "technical_noise";
  inputValue?: string;
  committedValue?: string;
  displayValue?: string;
  eventTargetRef?: string;
  currentTargetRef?: string;
  composedPathRefs?: string[];
  deepestEditableTargetRef?: string;
  rawTypedValue?: string;
  inputEventData?: string[];
  inputTypes?: string[];
  beforeInputValue?: string;
  afterInputValue?: string;
  technicalTargetCandidates?: RecordedTechnicalTarget[];
  /** LAST-RESORT, EXECUTION-ONLY authority; never a technicalTarget/certified owner. See its own doc. */
  semanticRuntimeEvidence?: SemanticRuntimeEvidence;
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
  actionability?: "NATIVE_ACTIONABLE" | "SEMANTIC_ACTIONABLE" | "FRAMEWORK_ACTIONABLE" | "NON_ACTIONABLE";
  actionOwner?: boolean;
  fieldOwnerDiagnostic?: FieldOwnerDiagnostic;
};

const SECRET_FIELD_TOKENS = [
  "clave", "contrasena", "contraseña", "password", "pin", "otp", "token", "cvv", "secret",
];

function normalizeLabel(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function isSensitiveField(interaction: RawInteraction, extra: readonly string[] = []): boolean {
  if (interaction.inputType === "password") return true;
  const haystack = normalizeLabel(
    [interaction.label, interaction.name, interaction.domId, interaction.ariaLabel, interaction.placeholder]
      .filter(Boolean)
      .join(" "),
  );
  return [...SECRET_FIELD_TOKENS, ...extra.map(normalizeLabel)].some(
    (needle) => needle.length > 0 && haystack.includes(needle),
  );
}

/** Confidence for an identity the page reported as matching more than one element. */
const AMBIGUOUS_CONFIDENCE = 0.5;

/**
 * Ranks locators for a recorded element.
 *
 * Same order the framework's own resolver prefers, so a recorded step and a discovered step
 * are indistinguishable downstream: an explicit test id first, then the accessible name,
 * then structural fallbacks. Visible text ranks above CSS because the app's markup churns
 * far more often than its copy.
 *
 * That order is then re-sorted by what the page measured: an identity shared with other
 * elements is demoted below every identity that singled the element out, because a locator
 * that matches three buttons sends the generated step to whichever the runner finds first.
 *
 * Unlike Android — where UiSelector expresses `.instance(n)` natively — a shared identity is
 * reported here, not rewritten: the web plan schema has no index, so inventing one would
 * produce a step the promoter cannot emit. The flag drops the confidence below the threshold
 * that marks a scenario as uncertain, which is what surfaces it to the reviewer.
 */
export function buildWebLocators(interaction: RawInteraction): RecordedLocator[] {
  const ranks = interaction.ranks ?? {};
  const candidates: Array<{ key: keyof LocatorRanks; locator: RecordedLocator }> = [];

  if (interaction.testId) {
    candidates.push({ key: "testId", locator: { strategy: "data-testid", value: interaction.testId, confidence: 0.98 } });
  }
  if (interaction.ariaLabel) {
    candidates.push({ key: "ariaLabel", locator: { strategy: "aria-label", value: interaction.ariaLabel, confidence: 0.9 } });
  }
  // A "role|label" locator only carries real re-findable identity when the label is a genuine
  // accessible name -- the internal "control" sentinel (and its siblings: "campo", "input",
  // "textbox", ...) must never be baked into a locator string and mistaken for one downstream.
  // Reuses the SAME shared detector canonical admission/semantic-field resolution already use
  // (isGenericUnresolvedLabel), so "generic" is never independently redefined here.
  const roleTechnicalName = interaction.roleTechnicalIdentityEligible === false
    ? undefined
    : interaction.technicalRoleName ?? interaction.label;
  if (interaction.role && roleTechnicalName && !isGenericUnresolvedLabel(roleTechnicalName)) {
    candidates.push({
      key: "role",
      locator: { strategy: "role", value: `${interaction.role}|${roleTechnicalName}`, confidence: 0.85 },
    });
  }
  if (interaction.domId) {
    candidates.push({ key: "domId", locator: { strategy: "css", value: `#${interaction.domId}`, confidence: 0.8 } });
    // A real DOM id is stable, re-findable technical identity on its own -- independent of
    // whatever CSS selector shape gets built from it. Emitted as the SAME "id" strategy mobile
    // route-learning already uses for a resource id (mobile-route-learner.ts), which
    // isTechnicalIdentityAdmissible already treats as admissible -- no widening of "any css
    // string" admission, and the css locator above (picked first by trace-to-scenario's
    // `locators[0]`) is untouched, so spec generation/promotion output is unaffected.
    candidates.push({ key: "domId", locator: { strategy: "id", value: interaction.domId, confidence: 0.8 } });
  }
  if (interaction.text && interaction.text.length <= 80) {
    candidates.push({ key: "text", locator: { strategy: "text", value: interaction.text, confidence: 0.7 } });
  }
  if (interaction.name) {
    candidates.push({ key: "name", locator: { strategy: "css", value: `[name="${interaction.name}"]`, confidence: 0.65 } });
  }

  // Dynamic compound editors often expose no durable label/id on the editable child. Keep a
  // structural candidate so a later runtime can re-resolve by grid/header/cell context rather
  // than falling back to a parent display value, position, or ephemeral popup id.
  const structural = interaction.technicalTargetCandidates?.flatMap((candidate) => candidate.locatorCandidates)
    .filter((locator) => locator.strategy === "structural") ?? [];
  if (structural.length > 0) {
    candidates.push(...structural.map((locator, index) => ({ key: `structural${index}` as keyof LocatorRanks, locator })));
  } else if (interaction.compoundRole === "amount_or_text" && (interaction.cellRef || interaction.headerContext || interaction.gridRef)) {
    candidates.push({
      key: "structural" as keyof LocatorRanks,
      locator: {
        strategy: "structural",
        value: [
          interaction.gridRef ? `grid=${interaction.gridRef}` : "",
          interaction.rowIdentity || interaction.rowRef ? `row=${interaction.rowIdentity || interaction.rowRef}` : "",
          interaction.cellRef ? `cell=${interaction.cellRef}` : "",
          interaction.headerRef || interaction.headerContext ? `header=${interaction.headerRef || interaction.headerContext}` : "",
          "role=amount_or_text",
        ].filter(Boolean).join("|"),
        confidence: 0.72,
      },
    });
  }

  const unique: RecordedLocator[] = [];
  const shared: RecordedLocator[] = [];
  for (const { key, locator } of candidates) {
    const rank = ranks[key];
    if (!rank || rank.count <= 1) {
      unique.push(locator);
      continue;
    }
    shared.push({ ...locator, confidence: AMBIGUOUS_CONFIDENCE, ambiguous: true, matchIndex: rank.index });
  }

  return [...unique, ...shared];
}

/**
 * Temporary diagnostic only: true when the ONLY locator resolved is the last-resort bare
 * structural fallback with no header/cell component — the exact shape physically reported as
 * "Campo pendiente de identificar" (`structural:grid=grid:div|role=amount_or_text`). Detecting
 * this never changes what gets recorded; it only decides whether the diagnostic line below fires.
 */
export function isBareStructuralFallbackOnly(locators: readonly RecordedLocator[]): boolean {
  return locators.length === 1 && locators[0].strategy === "structural"
    && !locators[0].value.includes("header=") && !locators[0].value.includes("cell=");
}

/**
 * Builds the `[field-owner-unresolved]` diagnostic line. Structural presence/absence only —
 * never the field's typed value, never a password/id-number/token, never full HTML/text.
 */
export function describeFieldOwnerUnresolved(params: {
  screenKey?: string;
  tagName?: string;
  role?: string;
  associatedField?: string;
  headerContext?: string;
  cellRef?: string;
  gridRef?: string;
  locators: readonly RecordedLocator[];
}): string {
  return `[field-owner-unresolved] screenKey=${params.screenKey ?? "unknown"} tagName=${params.tagName ?? "unknown"} `
    + `role=${params.role ?? "unknown"} associatedFieldPresent=${Boolean(params.associatedField)} `
    + `headerContextPresent=${Boolean(params.headerContext)} cellRefPresent=${Boolean(params.cellRef)} `
    + `gridRefPresent=${Boolean(params.gridRef)} nearestFieldGroupLabelResult=${params.headerContext ? "resolved" : "unresolved"} `
    + `finalLocatorStrategies=${params.locators.map((locator) => locator.strategy).join(",")} reason=bare_structural_fallback_only`;
}

/**
 * Transports the browser-side `nearestFieldGroupLabel` diagnostic trace (captured on the page,
 * carried to Node via the same interaction payload every other target field already travels
 * through) into a single compact JSON line for the Node process log. Diagnostic-only: never
 * consulted by any resolution/admission/execution logic, never a typed field value.
 */
export function describeFieldOwnerUnresolvedDetail(diagnostic: FieldOwnerDiagnostic | undefined): string {
  return `[field-owner-unresolved-detail] ${JSON.stringify(diagnostic ?? { result: "unresolved", trace: [] })}`;
}

/**
 * The page-side capture script.
 *
 * Listeners are registered in the capture phase so an app that calls `stopPropagation` in its
 * own handler cannot hide the interaction from the recorder. Password values follow the
 * project-scoped QA recording policy: the page exposes them only when the recorder explicitly
 * enables persistence, and the recorder never writes them to interaction logs or console output.
 */
const CAPTURE_SCRIPT_LEGACY = `
(() => {
  if (window.__qaRecorderInstalled) return;
  window.__qaRecorderInstalled = true;

  const accessibleName = (el) => {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria.trim();
    if (el.labels && el.labels.length) return (el.labels[0].textContent || '').trim();
    const placeholder = el.getAttribute && el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();
    const title = el.getAttribute && el.getAttribute('title');
    if (title) return title.trim();
    const text = (el.innerText || el.textContent || '').trim();
    return text.slice(0, 120);
  };

  const quote = (v) => String(v).replace(/["\\\\]/g, '\\\\$&');
  const clean = (value, max) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max || 120);
  const attributesFor = (el) => {
    const names = ['id','name','type','aria-label','aria-labelledby','placeholder','data-testid','data-test-id','data-field','data-column','role'];
    const result = {};
    names.forEach((name) => { const value = el.getAttribute && el.getAttribute(name); if (value) result[name] = value; });
    return result;
  };
  const structuralContext = (el) => {
    const row = el.closest && el.closest('tr, [role="row"]');
    const cell = el.closest && el.closest('td, th, [role="gridcell"], [role="cell"]');
    const table = el.closest && el.closest('table, [role="grid"], [data-grid], [data-testid*="grid"], [data-testid*="table"]');
    let headerContext = '';
    let columnIdentity = '';
    if (cell && table) {
      const explicit = cell.getAttribute('aria-colindex');
      const cells = row ? Array.from(row.querySelectorAll('td, th, [role="gridcell"], [role="cell"], [data-cell], [data-column]')) : [];
      const cellIndex = cells.indexOf(cell);
      const headers = Array.from(table.querySelectorAll('thead th, thead td, [role="columnheader"], [data-header], [data-column-header]'));
      const header = explicit ? headers.find((candidate) => candidate.getAttribute('aria-colindex') === explicit) : headers[cellIndex];
      headerContext = clean(header && header.textContent);
      columnIdentity = clean(cell.getAttribute('data-column') || cell.getAttribute('data-field') || explicit || '');
    }
    const fieldset = el.closest && el.closest('fieldset');
    const form = el.closest && el.closest('form, [role="group"], [role="region"]');
    const legend = fieldset && fieldset.querySelector('legend');
    const containerContext = clean((legend && legend.textContent) || (form && (form.getAttribute('aria-label') || form.getAttribute('data-label'))) || '');
    const rowIdentity = clean((row && (row.getAttribute('aria-rowindex') || row.getAttribute('data-row-id') || row.getAttribute('data-rowindex') || row.getAttribute('data-id'))) || '');
    const rowContext = clean((row && (row.getAttribute('aria-label') || row.getAttribute('data-label'))) || '');
    return { headerContext, columnIdentity, containerContext, rowIdentity, rowContext };
  };

  const optionValues = (el) => {
    const owner = el.closest && el.closest('select, [role="combobox"], [role="listbox"], [data-options]');
    if (!owner) return [];
    return Array.from(owner.querySelectorAll('option, [role="option"], [data-option]'))
      .map((option) => clean(option.textContent || option.getAttribute('aria-label') || option.getAttribute('data-option') || option.value || '', 80))
      .filter(Boolean).slice(0, 20);
  };

  // How many elements this identity matches, and which one was interacted with. Measured
  // here because only the live document can answer it; reconstructing it later from the
  // recorded attributes would be a guess about a page that has since moved on.
  const rank = (el, selector, filter) => {
    try {
      var list = Array.prototype.slice.call(document.querySelectorAll(selector));
      if (filter) list = list.filter(filter);
      var index = list.indexOf(el);
      if (index < 0) return undefined;
      return { count: list.length, index: index };
    } catch (e) {
      return undefined;
    }
  };

  const ranksFor = (el) => {
    const ranks = {};
    const testId = el.getAttribute ? (el.getAttribute('data-testid') || el.getAttribute('data-test-id')) : null;
    if (testId) {
      ranks.testId = rank(el, '[data-testid="' + quote(testId) + '"], [data-test-id="' + quote(testId) + '"]');
    }
    const aria = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (aria) ranks.ariaLabel = rank(el, '[aria-label="' + quote(aria) + '"]');
    const role = el.getAttribute ? el.getAttribute('role') : null;
    const label = accessibleName(el);
    if (role && label) {
      ranks.role = rank(el, '[role="' + quote(role) + '"]', (n) => accessibleName(n) === label);
    }
    if (el.id) ranks.domId = rank(el, '[id="' + quote(el.id) + '"]');
    const text = (el.innerText || el.textContent || '').trim().slice(0, 120);
    if (text && el.tagName) {
      ranks.text = rank(el, el.tagName.toLowerCase(), (n) => (n.innerText || n.textContent || '').trim().slice(0, 120) === text);
    }
    if (el.name) ranks.name = rank(el, '[name="' + quote(el.name) + '"]');
    return ranks;
  };

  const describe = (el, kind, value, valueSource) => ({
    kind,
    label: accessibleName(el),
    ranks: ranksFor(el),
    role: el.getAttribute ? (el.getAttribute('role') || undefined) : undefined,
    tagName: el.tagName ? el.tagName.toLowerCase() : undefined,
    inputType: el.type || undefined,
    disabled: el.disabled === true,
    value: (el.type === 'password' && !window.__qaRecorderPersistQaCredentials) ? undefined : value,
    valueSource,
    testId: el.getAttribute ? (el.getAttribute('data-testid') || el.getAttribute('data-test-id') || undefined) : undefined,
    domId: el.id || undefined,
    name: el.name || undefined,
    ariaLabel: el.getAttribute ? (el.getAttribute('aria-label') || undefined) : undefined,
    text: (el.innerText || el.textContent || '').trim().slice(0, 120) || undefined,
    placeholder: el.getAttribute ? (el.getAttribute('placeholder') || undefined) : undefined,
    attributes: attributesFor(el),
    ...structuralContext(el),
    associatedField: structuralContext(el).headerContext || undefined,
    afterValue: kind === 'input' && (el.tagName || '').toLowerCase() === 'select'
      ? (el.selectedOptions && el.selectedOptions[0] ? (el.selectedOptions[0].textContent || el.value) : el.value)
      : ((el.getAttribute && el.getAttribute('role') === 'option') ? (el.textContent || el.getAttribute('aria-label') || undefined) : undefined),
    observedOptions: optionValues(el),
    href: el.getAttribute ? (el.getAttribute('href') || undefined) : undefined,
  });

  const send = (payload) => {
    try { window.__qaRecord(payload); } catch (e) { /* binding not ready yet */ }
  };

  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest
      ? (e.target.closest('button, a, [role="button"], [role="option"], input, select, label, [onclick]') || e.target)
      : e.target;
    if (el) send(describe(el, 'click', undefined, 'user'));
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el) return;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      send(describe(el, 'input', el.value, e.isTrusted ? 'user' : 'application'));
    }
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el) return;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      send(describe(el, 'input', el.value, e.isTrusted ? 'user' : 'application'));
    }
  }, true);

  document.addEventListener('submit', (e) => {
    if (e.target) send(describe(e.target, 'submit', undefined, e.isTrusted ? 'user' : 'application'));
  }, true);
})();
`;

/**
 * V1 technical capture. The page emits raw interaction evidence plus bounded, narrow
 * before/after observations. Focus, mutation and post-action records are notes, never user
 * steps; the semantic layer decides which observations become reusable technical knowledge.
 */
export const CAPTURE_SCRIPT = String.raw`
(() => {
  if (window.__qaRecorderInstalledV1) return;
  window.__qaRecorderInstalledV1 = true;

  const classifyActionability = ${ACTIONABILITY_CONTRACT_SOURCE};
  const normalizeStructuralOwnerIdentity = ${STRUCTURAL_OWNER_IDENTITY_SOURCE};
  const selectSemanticFieldOwnerLabel = ${SELECT_SEMANTIC_FIELD_OWNER_LABEL_SOURCE};
  const shouldFlushEditingSessionFill = ${SHOULD_FLUSH_EDITING_SESSION_FILL_SOURCE};
  const clean = (value, max = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const text = (el) => clean(el && (el.innerText || el.textContent || ''));
  const attr = (el, name) => el && el.getAttribute ? (el.getAttribute(name) || undefined) : undefined;
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const labelFor = (el) => {
    if (!el) return '';
    if (el.labels && el.labels.length) {
      const label = clean(Array.from(el.labels).map((item) => item.textContent || '').join(' '));
      if (label) return label;
    }
    const labelledBy = attr(el, 'aria-labelledby');
    if (labelledBy) {
      const label = clean(labelledBy.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((item) => item.textContent || '').join(' '));
      if (label) return label;
    }
    const aria = attr(el, 'aria-label');
    if (aria) return clean(aria);
    const placeholder = attr(el, 'placeholder');
    if (placeholder) return clean(placeholder);
    const title = attr(el, 'title');
    if (title) return clean(title);
    return text(el);
  };
  const valueOf = (el) => {
    if (!el) return undefined;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (el.type === 'password' && !window.__qaRecorderPersistQaCredentials) return undefined;
      if (tag === 'select' && el.selectedOptions && el.selectedOptions[0]) return clean(el.selectedOptions[0].textContent || el.value);
      return typeof el.value === 'string' ? el.value : undefined;
    }
    if (el.isContentEditable) return text(el);
    return undefined;
  };
  // Same shape as valueOf, WITHOUT the password-persistence redaction. Used ONLY for the
  // internal "did this field actually change" comparison (never sent to Node, never logged) so
  // that a policy decision not to persist a secret's literal text can never be the reason its
  // edit -- and therefore its fill -- is lost. Whatever gets SENT still goes through valueOf.
  const rawFieldValue = (el) => {
    if (!el) return undefined;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (tag === 'select' && el.selectedOptions && el.selectedOptions[0]) return clean(el.selectedOptions[0].textContent || el.value);
      return typeof el.value === 'string' ? el.value : undefined;
    }
    if (el.isContentEditable) return text(el);
    return undefined;
  };
  const boundsOf = (el) => {
    if (!el || !el.getBoundingClientRect) return undefined;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const ariaOf = (el) => {
    const result = {};
    if (!el || !el.attributes) return result;
    Array.from(el.attributes).forEach((item) => { if (item.name.indexOf('aria-') === 0) result[item.name] = clean(item.value, 120); });
    return result;
  };
  const identityOf = (el, fallback) => attr(el, 'data-testid') || attr(el, 'data-test-id') || attr(el, 'data-qa') || attr(el, 'id') || attr(el, 'name') || fallback;
  const closest = (el, selector) => el && el.closest ? el.closest(selector) : null;
  const gridRootOf = (el) => {
    const explicit = closest(el, 'table, [role="grid"], [data-grid], [data-testid*="grid"], [data-testid*="table"]');
    if (explicit) return explicit;
    let node = el && el.parentElement;
    while (node) {
      if (window.getComputedStyle(node).display === 'grid' && node.querySelector('input, textarea, [role="row"], [data-row-id], [data-rowindex]')) return node;
      node = node.parentElement;
    }
    return null;
  };
  // Identifies elements that can be the field a label describes — used only to check "is
  // there EXACTLY ONE interactive descendant in this candidate container", never to guess
  // which one by position. A hidden native mirror input (type="hidden", or a value-binding
  // twin the component keeps display:none/zero-size next to the real, visible masked/formatted
  // control) is not something the user can interact with and never competes for the container's
  // label -- only a VISIBLE field counts toward "how many fields does this container own".
  const isFieldElement = (node) => {
    if (!node || node.nodeType !== 1) return false;
    const tag = (node.tagName || '').toLowerCase();
    const isFieldTag = tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable === true
      || node.getAttribute('role') === 'combobox' || node.getAttribute('role') === 'textbox';
    if (!isFieldTag) return false;
    if (tag === 'input' && node.type === 'hidden') return false;
    return visible(node);
  };
  // el.labels (used by labelFor) only covers a native for=/wrapping label association.
  // Componentized forms commonly render label and input as siblings (or the input nested one
  // wrapper deep) under a shared field-group container with no for= link at all. Climb
  // ancestors looking for a container that owns EXACTLY ONE interactive descendant (this
  // element) and EXACTLY ONE label-like candidate -- real structural ownership, not "nearest
  // text" -- and stop, unresolved, the moment a container turns out to own more than one field
  // (ambiguous: never guessed by DOM position).
  // Temporary, local diagnostics for THIS ticket only -- collected purely to observe WHY a real
  // field failed to resolve; they never change which owner is chosen or rejected (every return
  // point below fires under the exact same condition as before this ticket). Structure only,
  // never a typed value: candidate snapshots report presence/booleans and short label CAPTIONS
  // (the field's own describing text, e.g. "Numero de identificacion"), never what the user
  // entered into the field.
  const fieldCandidateSnapshot = (node) => ({
    tagName: (node.tagName || '').toLowerCase(),
    type: node.type || undefined,
    role: (node.getAttribute && node.getAttribute('role')) || undefined,
    visible: visible(node),
    disabled: Boolean(node.disabled),
    idPresent: Boolean(node.id),
    namePresent: Boolean(node.getAttribute && node.getAttribute('name')),
    ariaLabelPresent: Boolean(node.getAttribute && node.getAttribute('aria-label')),
    placeholderPresent: Boolean(node.getAttribute && node.getAttribute('placeholder')),
  });
  const labelCandidateSnapshot = (node) => ({
    tagName: (node.tagName || '').toLowerCase(),
    sourceType: (node.tagName || '').toLowerCase() === 'label' ? 'label' : 'class-label',
    textSummary: clean(node.textContent || '', 80),
  });
  const ancestorSnapshot = (node, depth, candidateFields, candidateLabels, rejectionReason, semanticCandidateLabelCount) => ({
    ancestorLevel: depth,
    tagName: (node.tagName || '').toLowerCase(),
    role: (node.getAttribute && node.getAttribute('role')) || undefined,
    idPresent: Boolean(node.id),
    classSummary: clean((typeof node.className === 'string' ? node.className : (node.getAttribute && node.getAttribute('class'))) || '', 80),
    candidateFieldCount: candidateFields.length,
    candidateFields,
    // Raw evidence: every label-like element found, INCLUDING semantically-empty decorative
    // ones (e.g. a floating-label span with no text yet) -- kept for diagnosis only.
    candidateLabelCount: candidateLabels.length,
    candidateLabels,
    // The count actually used for the ambiguity decision: only candidates whose own caption is
    // non-empty after trimming. An empty decorative label-like element must never inflate
    // cardinality into a false "multiple_candidate_labels".
    ...(semanticCandidateLabelCount !== undefined ? { semanticCandidateLabelCount } : {}),
    rejectionReason,
  });
  // Captured by the most recent nearestFieldGroupLabel() call and consumed immediately by
  // structural() right after calling it (single-threaded, synchronous -- no concurrency risk).
  // Transports the diagnostic to Node through the SAME interaction payload every other target
  // field already travels through, rather than a parallel channel.
  let lastFieldOwnerDiagnostic;
  const nearestFieldGroupLabel = (el) => {
    let container = el.parentElement;
    let depth = 0;
    const trace = [];
    lastFieldOwnerDiagnostic = undefined;
    const logUnresolved = (reason) => {
      lastFieldOwnerDiagnostic = { result: 'unresolved', trace };
      try { console.log('[field-owner-unresolved]', JSON.stringify({ reason, trace })); } catch (e) { /* diagnostics only */ }
    };
    while (container && depth < 5) {
      const isBoundary = Boolean(container.matches && container.matches('form, fieldset, [role="dialog"], [role="region"], [role="group"], body, html'));
      if (container.querySelectorAll) {
        const fields = Array.from(container.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="textbox"]')).filter(isFieldElement);
        const candidateFields = fields.map(fieldCandidateSnapshot);
        if (fields.length > 1) {
          trace.push(ancestorSnapshot(container, depth, candidateFields, [], 'multiple_visible_fields'));
          logUnresolved('multiple_visible_fields');
          return undefined;
        }
        if (fields.length === 1 && fields[0] === el) {
          const labelNodes = Array.from(container.querySelectorAll('label, [class*="label" i]'))
            .filter((node) => node !== el && !node.contains(el) && !el.contains(node));
          const candidateLabels = labelNodes.map(labelCandidateSnapshot);
          // Cardinality/ambiguity is decided on SEMANTIC candidates only -- a label-like element
          // with no real caption (an empty floating-label span, a decorative wrapper not yet
          // populated) never counts toward "how many labels does this container offer", so it
          // can never manufacture a false multiple_candidate_labels ambiguity against one real
          // label. Raw candidates (including empty ones) are still preserved above for
          // diagnosis; the DECISION itself is the shared, independently-tested
          // selectSemanticFieldOwnerLabel (see field-owner-label-selection.ts).
          const selection = selectSemanticFieldOwnerLabel(labelNodes.map((node) => ({ textContent: node.textContent })));
          if (selection.reason === 'resolved') {
            lastFieldOwnerDiagnostic = { result: 'resolved', chosenOwnerSource: 'nearestFieldGroupLabel', chosenAncestorLevel: depth };
            try { console.log('[field-owner-resolved]', JSON.stringify({ chosenOwnerSource: 'nearestFieldGroupLabel', chosenAncestorLevel: depth, chosenOwnerTextSummary: clean(selection.chosenText, 80) })); } catch (e) { /* diagnostics only */ }
            return selection.chosenText;
          }
          trace.push(ancestorSnapshot(container, depth, candidateFields, candidateLabels, selection.reason, selection.semanticCandidates.length));
        } else {
          trace.push(ancestorSnapshot(container, depth, candidateFields, [], fields.length === 0 ? 'no_interactive_fields' : 'candidate_field_not_target'));
        }
      } else {
        trace.push(ancestorSnapshot(container, depth, [], [], 'other:no_query_support'));
      }
      if (isBoundary) {
        logUnresolved('container_boundary_reached');
        return undefined;
      }
      container = container.parentElement;
      depth += 1;
    }
    logUnresolved('other:max_depth_reached');
    return undefined;
  };
  const structural = (el) => {
    const row = closest(el, 'tr, [role="row"], [data-row-id], [data-rowindex]');
    const cell = closest(el, 'td, th, [role="gridcell"], [role="cell"], [data-cell], [data-column]');
    const grid = gridRootOf(el);
    let header = attr(cell, 'data-column') || attr(cell, 'data-field') || attr(cell, 'aria-colindex') || '';
    if (!header && grid) {
      const explicit = attr(cell, 'aria-colindex');
      const siblingCells = row ? Array.from(row.querySelectorAll('td, th, [role="gridcell"], [role="cell"], [data-cell], [data-column]')) : [];
      const cellIndex = siblingCells.indexOf(cell);
      const headers = Array.from(grid.querySelectorAll('thead th, thead td, [role="columnheader"], [data-header], [data-column-header]'));
      const headerNode = explicit ? headers.find((item) => attr(item, 'aria-colindex') === explicit) : headers[cellIndex];
      header = labelFor(headerNode);
    }
    // A plain (non-grid) field's own label is already captured by labelFor(el) whenever a
    // for=/aria mechanism exists — this is the fallback for exactly the gap those don't cover:
    // a structurally-owned sibling/ancestor label with no direct HTML association at all.
    let fieldOwnerDiagnostic;
    if (!header) {
      header = nearestFieldGroupLabel(el) || '';
      fieldOwnerDiagnostic = lastFieldOwnerDiagnostic;
    }
    const rowNodes = grid ? Array.from(grid.querySelectorAll('tr, [role="row"], [data-row-id], [data-rowindex]')) : [];
    const rowIndex = row ? rowNodes.indexOf(row) : -1;
    const rowRef = row ? identityOf(row, 'row:' + (rowIndex >= 0 ? String(rowIndex + 1) : 'unknown')) : undefined;
    const gridRef = grid ? identityOf(grid, 'grid:' + (grid.getAttribute('role') || grid.tagName.toLowerCase())) : undefined;
    const rect = boundsOf(cell || el);
    const cellRef = cell ? identityOf(cell, 'cell:' + clean(header, 80) + ':' + (rowRef || 'unknown')) : undefined;
    const container = closest(el, 'fieldset, form, [role="dialog"], [role="region"], [role="group"]');
    return {
      gridRef,
      rowRef,
      cellRef,
      headerRef: header ? 'header:' + clean(header, 100) : undefined,
      headerContext: header || undefined,
      rowIdentity: rowRef,
      rowContext: row ? clean(attr(row, 'aria-label') || attr(row, 'data-label') || '') : undefined,
      columnIdentity: attr(cell, 'data-column') || attr(cell, 'data-field') || attr(cell, 'aria-colindex') || undefined,
      containerIdentity: container ? identityOf(container, 'container:' + (container.getAttribute('role') || container.tagName.toLowerCase())) : undefined,
      containerContext: container ? clean(attr(container, 'aria-label') || attr(container, 'data-label') || (container.querySelector('legend') && container.querySelector('legend').textContent) || '') : undefined,
      fieldOwnerDiagnostic,
    };
  };
  const optionsFor = (el) => {
    const expanded = closest(el, '[aria-expanded="true"]');
    const controlId = expanded && attr(expanded, 'aria-controls');
    const controlled = controlId ? document.getElementById(controlId) : null;
    const root = controlled
      || closest(el, '[role="listbox"], [role="combobox"], [data-options], [aria-controls]')
      || (expanded && expanded.parentElement)
      || document.querySelector('[role="listbox"], [data-options]');
    if (!root) return [];
    return Array.from(root.querySelectorAll('option, [role="option"], [data-option], [data-value], li[aria-selected], li'))
      .filter(visible)
      .map((item) => clean(item.textContent || attr(item, 'aria-label') || attr(item, 'data-option') || attr(item, 'data-value') || item.value, 100))
      .filter(Boolean)
      .filter((item, index, all) => all.indexOf(item) === index)
      .slice(0, 30);
  };
  const optionSurfaceFor = (el) => {
    const control = closest(el, '[aria-controls]');
    const controlled = control && attr(control, 'aria-controls') ? document.getElementById(attr(control, 'aria-controls')) : null;
    const surface = controlled || closest(el, '[role="listbox"], [data-options]') || document.querySelector('[role="listbox"], [data-options]');
    if (!surface || !visible(surface)) return undefined;
    return snapshotOf(surface);
  };
  const snapshotOf = (el) => {
    if (!el) return undefined;
    const tag = (el.tagName || '').toLowerCase();
    return {
      tag,
      role: attr(el, 'role') || tag,
      id: attr(el, 'id'),
      name: attr(el, 'name'),
      label: labelFor(el),
      placeholder: attr(el, 'placeholder'),
      value: valueOf(el),
      inputValue: valueOf(el),
      committedValue: valueOf(el),
      displayValue: attr(el, 'data-display-value') || attr(el, 'aria-valuetext') || undefined,
      text: text(el, 120),
      aria: ariaOf(el),
      selected: attr(el, 'aria-selected') === 'true' || el.selected === true,
      bounds: boundsOf(el),
    };
  };
  const targetRefOf = (el, context) => identityOf(el, [context.gridRef, context.rowRef, context.cellRef, labelFor(el)].filter(Boolean).join('|'));
  const elementOf = (node) => node && node.nodeType === 1 ? node : node && node.parentElement;
  const isEditable = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
      || ['textbox', 'combobox'].includes(attr(el, 'role'));
  };
  const stableAttributesFor = (el) => {
    const names = ['id', 'data-testid', 'data-test-id', 'name', 'type', 'aria-label', 'aria-labelledby', 'role', 'data-field', 'data-column'];
    return Object.fromEntries(names.map((name) => [name, attr(el, name)]).filter((entry) => entry[1]));
  };
  const structuralStableAttributesFor = (el) => {
    const names = ['id', 'data-testid', 'data-test-id', 'name', 'href', 'aria-label', 'aria-labelledby', 'role', 'data-field', 'data-column', 'alt', 'src'];
    return Object.fromEntries(names.map((name) => [name, attr(el, name)]).filter((entry) => entry[1]));
  };
  // The fixed, generic set of HTML5/ARIA landmark regions every page can have -- never an
  // app-specific selector. Two owners can be structurally identical (same tag, same stable
  // attributes, same descendants -- e.g. a sidebar link and a content-card link sharing the same
  // accessible name and href) while living in entirely different, individually stable PARTS of
  // the page; without this, the match-count check cannot tell them apart and BOTH get marked
  // ambiguous, even though each is a perfectly stable, uniquely-locatable owner within its own
  // landmark.
  const LANDMARK_SELECTOR = 'nav, main, aside, header, footer, [role="navigation"], [role="main"], [role="complementary"], [role="banner"], [role="contentinfo"], [role="search"], [role="form"]';
  const landmarkAncestorFor = (el) => {
    const landmark = el.closest ? el.closest(LANDMARK_SELECTOR) : null;
    if (!landmark) return undefined;
    return { tag: (landmark.tagName || '').toLowerCase(), role: attr(landmark, 'role') || undefined };
  };
  const structuralOwnerIdentityFor = (el) => {
    if (!el) return undefined;
    const stableDescendants = Array.from(el.querySelectorAll ? el.querySelectorAll('*') : [])
      .map((node) => ({
        relation: 'descendant',
        tag: (node.tagName || '').toLowerCase(),
        role: attr(node, 'role') || undefined,
        stableAttributes: structuralStableAttributesFor(node),
      }))
      .filter((node) => Object.keys(node.stableAttributes).length > 0)
      .slice(0, 32);
    const semanticShape = Array.from(el.children || []).map((node) => {
      const tag = (node.tagName || '').toLowerCase();
      const role = attr(node, 'role');
      return role ? tag + ':' + role : tag;
    }).filter(Boolean);
    const landmarkAncestor = landmarkAncestorFor(el);
    const base = normalizeStructuralOwnerIdentity({
      ownerTag: (el.tagName || '').toLowerCase(),
      ownerRole: attr(el, 'role') || undefined,
      stableDirectAttributes: structuralStableAttributesFor(el),
      stableDescendants,
      semanticShape,
      landmarkAncestor,
    });
    const comparable = JSON.stringify({ owner: base.owner, stableDirectAttributes: base.stableDirectAttributes, stableDescendants: base.stableDescendants, semanticShape: base.semanticShape, landmarkAncestor: base.landmarkAncestor || null });
    let count = 0;
    try {
      document.querySelectorAll('*').forEach((candidate) => {
        const style = window.getComputedStyle(candidate);
        if (style.cursor !== 'pointer' || style.pointerEvents === 'none') return;
        const candidateIdentity = structuralOwnerIdentityForBase(candidate);
        if (candidateIdentity === comparable) count += 1;
      });
    } catch (e) { /* transient DOM */ }
    return normalizeStructuralOwnerIdentity({
      ownerTag: base.owner.tag,
      ownerRole: base.owner.role,
      stableDirectAttributes: base.stableDirectAttributes,
      stableDescendants: base.stableDescendants,
      semanticShape: base.semanticShape,
      landmarkAncestor: base.landmarkAncestor,
      structuralIdentityMatchCount: count,
    });
  };
  const structuralOwnerIdentityForBase = (el) => {
    const stableDescendants = Array.from(el.querySelectorAll ? el.querySelectorAll('*') : [])
      .map((node) => ({ relation: 'descendant', tag: (node.tagName || '').toLowerCase(), role: attr(node, 'role') || undefined, stableAttributes: structuralStableAttributesFor(node) }))
      .filter((node) => Object.keys(node.stableAttributes).length > 0).slice(0, 32);
    const semanticShape = Array.from(el.children || []).map((node) => { const tag = (node.tagName || '').toLowerCase(); const role = attr(node, 'role'); return role ? tag + ':' + role : tag; }).filter(Boolean);
    const normalized = normalizeStructuralOwnerIdentity({ ownerTag: (el.tagName || '').toLowerCase(), ownerRole: attr(el, 'role') || undefined, stableDirectAttributes: structuralStableAttributesFor(el), stableDescendants, semanticShape, landmarkAncestor: landmarkAncestorFor(el) });
    return JSON.stringify({ owner: normalized.owner, stableDirectAttributes: normalized.stableDirectAttributes, stableDescendants: normalized.stableDescendants, semanticShape: normalized.semanticShape, landmarkAncestor: normalized.landmarkAncestor || null });
  };
  const targetCandidatesFor = (el, observedKind) => {
    if (!el) return [];
    const context = structural(el);
    const ownerIdentity = structuralOwnerIdentityFor(el);
    const tag = (el.tagName || '').toLowerCase();
    const role = attr(el, 'role') || '';
    const editable = isEditable(el);
    const selection = role === 'combobox' || role === 'option' || tag === 'select' || Boolean(attr(el, 'aria-haspopup'));
    const semanticRole = selection ? (role === 'combobox' || tag === 'select' ? 'selection' : 'selection') : editable ? 'amount_or_text' : 'display';
    const locatorCandidates = [];
    const testId = attr(el, 'data-testid') || attr(el, 'data-test-id');
    const ariaLabel = attr(el, 'aria-label');
    const name = attr(el, 'name');
    if (testId) locatorCandidates.push({ strategy: 'data-testid', value: testId, confidence: 0.98 });
    if (ariaLabel) locatorCandidates.push({ strategy: 'aria-label', value: ariaLabel, confidence: 0.9 });
    if (name) locatorCandidates.push({ strategy: 'css', value: '[name="' + name.replace(/"/g, '\\"') + '"]', confidence: 0.65 });
    if (editable && (context.gridRef || context.cellRef || context.headerRef)) {
      const structuralValue = [
        context.gridRef ? 'grid=' + context.gridRef : '',
        context.rowIdentity ? 'row=' + context.rowIdentity : '',
        context.cellRef ? 'cell=' + context.cellRef : '',
        context.headerRef || context.headerContext ? 'header=' + (context.headerRef || context.headerContext) : '',
        'role=' + semanticRole,
      ].filter(Boolean).join('|');
      locatorCandidates.push({ strategy: 'structural', value: structuralValue, confidence: 0.72 });
    }
    return [{
      targetType: editable ? 'editable' : selection ? 'selection' : 'display',
      semanticRole,
      locatorCandidates,
      structuralContext: {
        gridRef: context.gridRef,
        rowRef: context.rowRef,
        cellRef: context.cellRef,
        headerRef: context.headerRef,
        containerRef: context.containerIdentity,
        ...(ownerIdentity || {}),
      },
      stableAttributes: stableAttributesFor(el),
      interactionEvidence: [observedKind, targetRefOf(el, context)].filter(Boolean),
      lifecycleRef: targetRefOf(el, context) + ':' + semanticRole,
      confidence: locatorCandidates.length > 0 ? 0.9 : 0.45,
      validatedByInteraction: observedKind === 'input' || observedKind === 'click',
    }];
  };
  const deepestEditableFromEvent = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    return path.map(elementOf).find(isEditable);
  };
  const eventContext = (event, fallback) => {
    const path = (typeof event.composedPath === 'function' ? event.composedPath() : [event.target])
      .map(elementOf).filter(Boolean);
    const refs = path.map((node) => {
      try { return targetRefOf(node, structural(node)); } catch (e) { return undefined; }
    }).filter(Boolean);
    const eventElement = elementOf(event.target) || fallback;
    const currentElement = elementOf(event.currentTarget) || fallback;
    const deepest = deepestEditableFromEvent(event) || fallback;
    return {
      eventTargetRef: eventElement ? targetRefOf(eventElement, structural(eventElement)) : undefined,
      currentTargetRef: currentElement ? targetRefOf(currentElement, structural(currentElement)) : undefined,
      composedPathRefs: refs.slice(0, 16),
      deepestEditableTargetRef: deepest ? targetRefOf(deepest, structural(deepest)) : undefined,
    };
  };
  const redactedNodeIdentity = (el) => {
    if (!el || el.nodeType !== 1) return undefined;
    const tag = (el.tagName || '').toLowerCase();
    return [tag, attr(el, 'id') ? 'id=' + attr(el, 'id') : '', attr(el, 'data-testid') ? 'testid=' + attr(el, 'data-testid') : '', attr(el, 'role') ? 'role=' + attr(el, 'role') : '', attr(el, 'name') ? 'name=' + attr(el, 'name') : ''].filter(Boolean).join('|') || tag;
  };
  const localContainerIdentityOf = (el) => {
    if (!el) return undefined;
    const container = closest(el, 'fieldset, form, [role="dialog"], [role="region"], [role="group"]');
    return container ? (redactedNodeIdentity(container) || structural(container).containerIdentity) : undefined;
  };
  const mutationLog = [];
  const mutationObserver = new MutationObserver((records) => {
    records.slice(0, 16).forEach((record) => {
      const target = record.target && record.target.nodeType === 1 ? record.target : (record.target && record.target.parentElement);
      if (!target) return;
      mutationLog.push({
        type: record.type,
        target: targetRefOf(target, structural(target)),
        attributeName: record.attributeName || undefined,
        added: record.addedNodes ? record.addedNodes.length : 0,
        removed: record.removedNodes ? record.removedNodes.length : 0,
        redactedIdentity: redactedNodeIdentity(target),
        containerIdentity: localContainerIdentityOf(target),
      });
    });
    while (mutationLog.length > 64) mutationLog.shift();
  });
  try { mutationObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-controls', 'aria-selected', 'class', 'value'] }); } catch (e) { /* page may not have a documentElement yet */ }

  const describe = (el, kind, valueSource, interactionType) => {
    const context = structural(el);
    const beforeState = snapshotOf(el);
    const activeBefore = snapshotOf(document.activeElement);
    const targetRef = targetRefOf(el, context);
    const role = attr(el, 'role') || (el.tagName || '').toLowerCase();
    const optionValue = role === 'option' ? clean(el.textContent || attr(el, 'aria-label') || el.value) : undefined;
    const isSelection = role === 'option' || role === 'combobox' || (el.tagName || '').toLowerCase() === 'select' || Boolean(attr(el, 'aria-haspopup'));
    const compoundRole = isSelection ? 'selection' : ((el.tagName || '').toLowerCase() === 'input' || (el.tagName || '').toLowerCase() === 'textarea' || el.isContentEditable ? 'amount_or_text' : undefined);
    let computedStyle;
    try { computedStyle = window.getComputedStyle(el); } catch (e) { computedStyle = undefined; }
    const actionability = classifyActionability({
      tagName: (el.tagName || '').toLowerCase(),
      role: attr(el, 'role') || undefined,
      onclick: typeof el.onclick === 'function' || Boolean(attr(el, 'onclick')),
      tabIndex: typeof el.tabIndex === 'number' && el.tabIndex >= 0 ? el.tabIndex : undefined,
      cursor: computedStyle && computedStyle.cursor,
      pointerEvents: computedStyle && computedStyle.pointerEvents,
      trustedInteraction: valueSource === 'user',
      stableTechnicalIdentity: Boolean(attr(el, 'data-testid') || attr(el, 'data-test-id') || attr(el, 'data-qa') || attr(el, 'id') || attr(el, 'name') || attr(el, 'href') || attr(el, 'aria-label')),
    });
    return {
      kind,
      label: labelFor(el),
      role,
      tagName: (el.tagName || '').toLowerCase(),
      inputType: el.type || undefined,
      disabled: el.disabled === true,
      value: valueOf(el),
      inputValue: valueOf(el),
      displayValue: attr(el, 'data-display-value') || attr(el, 'aria-valuetext') || undefined,
      valueSource,
      interactionType: interactionType || (optionValue ? 'select' : 'click'),
      compoundRole,
      testId: attr(el, 'data-testid') || attr(el, 'data-test-id'),
      domId: attr(el, 'id'),
      name: attr(el, 'name'),
      ariaLabel: attr(el, 'aria-label'),
      text: text(el),
      placeholder: attr(el, 'placeholder'),
      attributes: Object.fromEntries(Array.from(el.attributes || []).filter((item) => ['id','name','type','aria-label','aria-labelledby','placeholder','data-testid','data-test-id','data-field','data-column','role','aria-expanded','aria-controls','aria-haspopup'].indexOf(item.name) >= 0).map((item) => [item.name, item.value])),
      ...context,
      associatedField: context.headerContext || labelFor(el),
      beforeValue: beforeState && beforeState.value,
      afterValue: optionValue || ((el.tagName || '').toLowerCase() === 'select' ? valueOf(el) : undefined),
      observedOptions: optionsFor(el),
      beforeState,
      activeElementBefore: activeBefore,
      stateDelta: { value: beforeState && beforeState.value, ariaExpanded: attr(el, 'aria-expanded'), ariaSelected: attr(el, 'aria-selected') },
      dynamicLifecycle: isSelection ? { activatedTechnicalTarget: targetRef, options: optionsFor(el), selectedOption: optionValue, committedState: valueOf(el) } : undefined,
      targetRef,
      technicalTargetCandidates: targetCandidatesFor(el, kind),
      actionability,
      actionOwner: actionability !== 'NON_ACTIONABLE',
    };
  };
  const send = (payload) => { try { window.__qaRecord(payload); } catch (e) { /* binding not ready */ } };
  const postActionDiagnostic = (stage, diagnostic) => {
    try {
      if (typeof window.__qaRecorderV2Diagnostic === 'function') window.__qaRecorderV2Diagnostic(stage, diagnostic || {});
    } catch (e) { /* diagnostics must never affect capture */ }
  };
  const schedulePostAction = (el, before, activeBefore, triggerRef) => {
    const started = performance.now();
    // Captured SYNCHRONOUSLY here (same tick as the triggering click/change), never inside the
    // deferred callback below: CaptureEngine V2's own click handler clears its own
    // pendingPointerInteractionId the moment IT runs, and this listener (registered earlier,
    // via the FIRST addInitScript) fires before V2's, so the id is read at the one moment it is
    // guaranteed to still hold the value V2's own pointerdown just set -- identity-based, no
    // timestamp/threshold involved.
    const getterExists = typeof window.__qaRecorderV2ActiveInteractionId === 'function';
    const v2InteractionId = getterExists ? window.__qaRecorderV2ActiveInteractionId() : undefined;
    postActionDiagnostic('post_action_getter_read', { getterExists, getterReturnedIdPresent: Boolean(v2InteractionId), getterReadBeforeClear: Boolean(v2InteractionId), getterClearStatus: v2InteractionId ? 'not_cleared_at_read' : 'unknown' });
    postActionDiagnostic('post_action_scheduled', { scheduleCalled: true, capturedInteractionIdPresent: Boolean(v2InteractionId), timerScheduled: true });
    setTimeout(() => {
      const after = snapshotOf(el);
      const activeAfter = snapshotOf(document.activeElement);
      const context = structural(el);
      const optionSurface = optionSurfaceFor(el);
      const options = optionsFor(el);
      postActionDiagnostic('post_action_fired', { callbackFired: true, capturedInteractionIdPresent: Boolean(v2InteractionId), mutationCount: mutationLog.length, payloadWillSend: true, skipReason: v2InteractionId ? 'none' : 'missing_interaction_id' });
      postActionDiagnostic('post_action_send', { kind: 'observation', observationType: 'post_action', interactionIdPresent: Boolean(v2InteractionId), sendCalled: true });
      send({ kind: 'observation', observationType: 'post_action', interactionId: v2InteractionId || undefined, label: labelFor(el), role: attr(el, 'role') || (el.tagName || '').toLowerCase(), tagName: (el.tagName || '').toLowerCase(), ...context, beforeState: before, afterState: after, activeElementBefore: activeBefore, activeElementAfter: activeAfter, dynamicLifecycle: { triggerTechnicalTarget: triggerRef, activatedTechnicalTarget: targetRefOf(document.activeElement, structural(document.activeElement)), optionSurface, options, selectedOption: after && after.selected ? after.label : undefined, committedState: after && after.value !== undefined ? after.value : undefined, focusTransfer: { from: activeBefore && activeBefore.id, to: activeAfter && activeAfter.id }, mutationSummary: mutationLog.slice(-12).map((item) => item.type + (item.attributeName ? ':' + item.attributeName : '')), relatedStateOwnerIdentity: redactedNodeIdentity(el), relatedStateContainerIdentity: localContainerIdentityOf(el), relatedStateMutations: mutationLog.slice(-16).map((item) => ({ nodeIdentity: item.redactedIdentity, kind: item.type, attributeName: item.attributeName })).filter((item) => item.nodeIdentity), observationWindowMs: Math.round(performance.now() - started) } });
    }, 180);
  };
  const interactive = (node) => {
    const element = elementOf(node);
    return element && element.closest ? element.closest('button, a, input, textarea, select, label, [role="button"], [role="option"], [role="combobox"], [role="textbox"], [contenteditable="true"], [onclick]') : null;
  };
  // A real user click can land on a decorative descendant (e.g. an image inside a card)
  // whose functional control is an ancestor that is not a native interactive element.
  // Walk up to the nearest ancestor that is either natively actionable or carries a
  // stable technical identity, so the functional target is captured instead of noise.
  const actionableAncestor = (node) => {
    let element = elementOf(node);
    let depth = 0;
    while (element && depth < 6) {
      if (element.matches && element.matches('button, a, input, textarea, select, label, [role="button"], [role="link"], [role="option"], [role="tab"], [contenteditable="true"], [onclick]')) {
        return element;
      }
      const hasStableIdentity = Boolean(
        attr(element, 'data-testid') || attr(element, 'data-test-id') || attr(element, 'data-qa')
        || attr(element, 'id') || attr(element, 'name') || attr(element, 'href') || attr(element, 'aria-label'),
      );
      if (hasStableIdentity && element !== elementOf(node)) return element;
      element = element.parentElement;
      depth += 1;
    }
    return null;
  };
  // Framework controls are often plain containers whose only actionable evidence
  // is the trusted physical gesture plus the browser's pointer affordance. Keep
  // this separate from stable identity: actionability may be proven while replay
  // readiness remains blocked when no reproducible locator exists.
  const frameworkActionableAncestor = (node, event) => {
    if (!event || event.isTrusted !== true) return null;
    let element = elementOf(node);
    let depth = 0;
    let actionable = null;
    let ancestorFrameworkActionable = false;
    while (element && depth < 8) {
      let style;
      try { style = window.getComputedStyle(element); } catch (e) { style = null; }
      const classified = classifyActionability({
        tagName: (element.tagName || '').toLowerCase(),
        role: attr(element, 'role') || undefined,
        onclick: typeof element.onclick === 'function' || Boolean(attr(element, 'onclick')),
        tabIndex: typeof element.tabIndex === 'number' && element.tabIndex >= 0 ? element.tabIndex : undefined,
        cursor: style && style.cursor,
        pointerEvents: style && style.pointerEvents,
        trustedInteraction: true,
        stableTechnicalIdentity: Boolean(attr(element, 'data-testid') || attr(element, 'data-test-id') || attr(element, 'data-qa') || attr(element, 'id') || attr(element, 'name') || attr(element, 'href') || attr(element, 'aria-label')),
        structuredClickableAncestor: ancestorFrameworkActionable,
      });
      if (classified === 'FRAMEWORK_ACTIONABLE') {
        // The walk is leaf-to-root; replacing the owner keeps the outer boundary when
        // the descendant merely inherits cursor:pointer from the framework card.
        actionable = element;
        ancestorFrameworkActionable = true;
      }
      element = element.parentElement;
      depth += 1;
    }
    return actionable;
  };
  const lastValues = new Map();
  // Keep the user's logical input separate from a mask/currency display value. This is a
  // best-effort event reconstruction; the committed DOM value remains evidence, never its
  // replacement. In particular, no separator-stripping heuristic is applied here.
  const rawValues = new Map();
  const beforeInputs = new Map();
  let lastSelectionContext;

  const logicalInputAfter = (previous, event) => {
    const type = event && event.inputType || '';
    const data = event && event.data != null ? String(event.data) : '';
    if (type === 'deleteContentBackward') return String(previous || '').slice(0, -1);
    if (type === 'deleteContentForward') return String(previous || '').slice(1);
    if (type === 'insertReplacementText') return data;
    if (type.indexOf('insert') === 0) return String(previous || '') + data;
    return undefined;
  };

  // A real edit whose input/change DOM events never reached this recorder (a componentized
  // field that updates its bound value without dispatching them) must still end in exactly one
  // raw fill -- never zero, never fabricated from mere prefilled presence. Opened on a trusted
  // focus of an editable element; closed either by a genuine input/change (no fallback needed)
  // or by flushEditingSession() at a real boundary (blur, a click/pointerdown elsewhere, a
  // submit, or page unload).
  let openEditingSession;
  const closeEditingSessionFor = (el) => {
    if (openEditingSession && openEditingSession.el === el) openEditingSession = undefined;
  };
  const flushEditingSession = () => {
    const session = openEditingSession;
    if (!session) return;
    openEditingSession = undefined;
    const el = session.el;
    if (!el || !document.contains(el)) return;
    // The change/no-change DECISION always uses the raw (unredacted) value -- a policy choice
    // not to persist a secret's literal text must never be the reason its edit is missed. What
    // actually gets SENT below still goes through valueOf(), so a non-persisted secret still
    // reports no value/inputValue/committedValue, exactly like its normal input/change path
    // would.
    if (!shouldFlushEditingSessionFill(session, rawFieldValue(el))) return;
    const sentValue = valueOf(el);
    const payload = { ...describe(el, 'input', 'user'), afterValue: sentValue, inputValue: sentValue, committedValue: sentValue };
    payload.beforeState = { value: session.initialSentValue };
    payload.beforeValue = session.initialSentValue;
    payload.rawTypedValue = rawValues.get(session.targetRef);
    send(payload);
    lastValues.set(session.targetRef, sentValue);
  };
  const openEditingSessionFor = (event) => {
    const el = deepestEditableFromEvent(event) || elementOf(event.target);
    if (!el || !isEditable(el)) return;
    if (openEditingSession && openEditingSession.el !== el) flushEditingSession();
    if (openEditingSession && openEditingSession.el === el) return;
    openEditingSession = {
      el,
      targetRef: targetRefOf(el, structural(el)),
      // Raw baseline for the change comparison (never sent); separate, policy-redacted baseline
      // for what a resulting fill's beforeValue would report.
      initialValue: rawFieldValue(el),
      initialSentValue: valueOf(el),
      trusted: event.isTrusted === true,
    };
  };

  document.addEventListener('focusin', (event) => {
    const el = deepestEditableFromEvent(event) || interactive(event.target) || elementOf(event.target);
    if (el) send({ ...describe(el, 'observation', 'application'), ...eventContext(event, el), kind: 'observation', observationType: 'focus' });
    openEditingSessionFor(event);
  }, true);
  document.addEventListener('focusout', (event) => {
    const el = deepestEditableFromEvent(event) || interactive(event.target) || elementOf(event.target);
    if (el) send({ ...describe(el, 'observation', 'application'), ...eventContext(event, el), kind: 'observation', observationType: 'focus' });
    const editableEl = deepestEditableFromEvent(event) || elementOf(event.target);
    if (openEditingSession && editableEl && openEditingSession.el === editableEl) flushEditingSession();
  }, true);
  document.addEventListener('beforeinput', (event) => {
    const el = deepestEditableFromEvent(event) || elementOf(event.target);
    if (el && (el.value !== undefined || el.isContentEditable)) {
      const before = snapshotOf(el);
      const key = targetRefOf(el, structural(el));
      beforeInputs.set(key, before);
      if (!rawValues.has(key) && before && before.value) rawValues.set(key, before.value);
      const rawBefore = rawValues.get(key);
      send({ ...describe(el, 'observation', 'user'), ...eventContext(event, el), kind: 'observation', observationType: 'before_input', beforeState: before, activeElementBefore: snapshotOf(document.activeElement), rawTypedValue: rawBefore, inputEventData: event.data == null ? [] : [String(event.data)], inputTypes: event.inputType ? [event.inputType] : [] });
    }
  }, true);
  document.addEventListener('pointerdown', (event) => {
    const el = deepestEditableFromEvent(event) || interactive(event.target) || actionableAncestor(event.target) || elementOf(event.target);
    // A pointer down on a DIFFERENT control than the currently-focused editable field is a real
    // boundary: native focus/blur ordering normally flushes this already via focusout above, but
    // flushing here too is a safety net in case blur is ever suppressed/reordered by the page.
    if (openEditingSession && (!el || openEditingSession.el !== el)) flushEditingSession();
    if (el) send({ ...describe(el, 'observation', event.isTrusted ? 'user' : 'application'), ...eventContext(event, el), kind: 'observation', observationType: 'pointer', userInitiated: event.isTrusted === true });
  }, true);
  document.addEventListener('click', (event) => {
    // RAW POINTER != ACTION OWNER: when the click's own composed path already contains an
    // editable element (input/textarea/select/contenteditable/role=textbox/combobox), that
    // editable owns the interaction outright -- an ancestor container (a form, a framework card,
    // the app root) must never be promoted over it, however text-rich or "framework actionable"
    // that container looks. Checked BEFORE any ancestor-climbing fallback, never after.
    const el = deepestEditableFromEvent(event)
      || interactive(event.target)
      || actionableAncestor(event.target)
      || frameworkActionableAncestor(event.target, event);
    // Flush BEFORE this click's own describe/send so a missed-edit fallback fill is ordered
    // ahead of the click that follows it in the raw trace, never after.
    if (openEditingSession && openEditingSession.el !== el) flushEditingSession();
    if (!el) {
      send({ kind: 'observation', observationType: 'technical_noise', label: text(event.target), role: (event.target && event.target.getAttribute && event.target.getAttribute('role')) || undefined, tagName: event.target && event.target.tagName ? event.target.tagName.toLowerCase() : undefined, text: text(event.target) });
      return;
    }
    const role = attr(el, 'role') || (el.tagName || '').toLowerCase();
    const selection = role === 'option' || role === 'combobox' || (el.tagName || '').toLowerCase() === 'select' || Boolean(attr(el, 'aria-haspopup'));
    const payload = { ...describe(el, 'click', 'user', selection ? 'select' : 'click'), ...eventContext(event, el), userInitiated: event.isTrusted === true };
    if (role === 'option' && lastSelectionContext) {
      ['gridRef','rowRef','cellRef','headerRef','headerContext','rowIdentity','columnIdentity','containerIdentity','associatedField'].forEach((key) => {
        if (!payload[key] && lastSelectionContext[key]) payload[key] = lastSelectionContext[key];
      });
      payload.dynamicLifecycle = { ...(payload.dynamicLifecycle || {}), triggerTechnicalTarget: lastSelectionContext.targetRef, activatedTechnicalTarget: payload.targetRef, selectedOption: payload.afterValue, committedState: payload.afterValue };
    } else if (selection && role !== 'option') {
      lastSelectionContext = payload;
    }
    send(payload);
    schedulePostAction(el, payload.beforeState, payload.activeElementBefore, payload.eventTargetRef ?? payload.targetRef);
  }, true);
  document.addEventListener('input', (event) => {
    const el = deepestEditableFromEvent(event) || elementOf(event.target);
    if (!el || (el.value === undefined && !el.isContentEditable)) return;
    const payload = { ...describe(el, 'input', event.isTrusted ? 'user' : 'application', (el.tagName || '').toLowerCase() === 'select' ? 'select' : undefined), ...eventContext(event, el) };
    const key = payload.targetRef;
    payload.beforeState = beforeInputs.get(key) || { value: lastValues.get(key) };
    payload.beforeValue = payload.beforeState && payload.beforeState.value;
    payload.afterState = snapshotOf(el);
    payload.afterValue = payload.afterState && payload.afterState.value;
    payload.inputValue = valueOf(el);
    payload.committedValue = undefined;
    payload.displayValue = attr(el, 'data-display-value') || attr(el, 'aria-valuetext') || undefined;
    const rawBefore = rawValues.get(key) ?? payload.beforeValue ?? '';
    const rawAfter = event.isTrusted ? logicalInputAfter(rawBefore, event) : undefined;
    if (rawAfter !== undefined) rawValues.set(key, rawAfter);
    payload.rawTypedValue = event.isTrusted ? (rawAfter ?? rawBefore) : undefined;
    payload.inputEventData = event.data == null ? [] : [String(event.data)];
    payload.inputTypes = event.inputType ? [event.inputType] : [];
    lastValues.set(key, payload.afterValue);
    send(payload);
    // A real input event already recorded this edit -- close the tracker so a later flush never
    // duplicates it with a fallback fill.
    closeEditingSessionFor(el);
  }, true);
  document.addEventListener('change', (event) => {
    const el = deepestEditableFromEvent(event) || elementOf(event.target);
    if (!el || !['input','textarea','select'].includes((el.tagName || '').toLowerCase())) return;
    const payload = { ...describe(el, 'input', event.isTrusted ? 'user' : 'application', 'select'), ...eventContext(event, el) };
    const key = payload.targetRef;
    payload.beforeState = beforeInputs.get(key) || payload.beforeState;
    payload.afterState = snapshotOf(el);
    payload.afterValue = payload.afterState && payload.afterState.value;
    payload.inputValue = valueOf(el);
    payload.committedValue = valueOf(el);
    payload.displayValue = attr(el, 'data-display-value') || attr(el, 'aria-valuetext') || undefined;
    payload.rawTypedValue = rawValues.get(key);
    send(payload);
    schedulePostAction(el, payload.beforeState, payload.activeElementBefore, payload.targetRef);
    closeEditingSessionFor(el);
  }, true);
  document.addEventListener('submit', (event) => {
    flushEditingSession();
    const el = event.target;
    if (el) send({ ...describe(el, 'observation', event.isTrusted ? 'user' : 'application'), kind: 'observation', observationType: 'technical_noise' });
  }, true);
  // Best-effort coverage for a surface transition/recorder stop with an open, unflushed edit --
  // a real edit must not disappear just because the page navigated away before any other
  // boundary above fired.
  window.addEventListener('beforeunload', () => { flushEditingSession(); }, true);
})();
`;

export class WebSessionRecorder {
  private browser: Browser | null = null;

  private context: BrowserContext | null = null;

  private page: Page | null = null;

  private readonly startedAt = Date.now();

  private readonly events: RecordedEvent[] = [];

  private readonly screens = new Map<string, RecordedScreen>();

  private seq = 0;

  private stopped = false;

  /** Controlled action surface for the active recording; the Page/browser handles remain private. */
  async executeControlAction(action: RecordingControlAction): Promise<RecordingControlResult> {
    if (this.stopped) throw new Error("RECORDING_STOPPED");
    if (!this.page || this.page.isClosed()) throw new Error("PAGE_CLOSED");
    return executeRecordingControlAction(this.page, action);
  }

  private lastScreenKey = "inicio";

  private lastFingerprint = "";

  /**
   * CaptureEngine V2 -- SHADOW by default. Whether it also feeds `onInteraction`/`SessionTrace`
   * is governed entirely by `captureAuthority`, resolved once below. `v2Shadow` stays `null`
   * (and every V2 message is silently dropped) whenever V2 setup itself failed, so a bug in V2
   * can never take the legacy recorder down with it -- unless `captureAuthority === "v2"`, in
   * which case that failure means NO capture authority is active for this session (see `start()`).
   */
  private v2Shadow: CaptureEngineV2ShadowBridge | null = null;

  /**
   * V2's own `interactionId` (already carried by every pointer/click message) -> that action's
   * own `eventTargetRef`, recorded as each V2 technical action is ingested. The ONLY purpose is
   * to let a diagnostic-only post_action observation (see `onV2DiagnosticObservation`) resolve
   * the SAME `triggerTechnicalTarget` value `canonical-recording-contract.ts`'s pre-existing
   * `relatedStateByTrigger` join already expects -- never a new correlation concept, never
   * exposed outside this class, never consulted for action/execution authority.
   */
  private v2InteractionIdToEventTargetRef = new Map<string, string>();

  /**
   * Resolved ONCE, at construction time, and never reassigned anywhere in this class: a
   * recording session has exactly one capture authority for its whole lifetime. CaptureEngine V2
   * is the WEB recorder now -- `"v2"` is the default. `"legacy"` remains only as an explicit,
   * API-INTERNAL override (tests/regression/rollback), never something a public caller selects.
   *
   * `"legacy"`: `__qaRecord` -> `onInteraction` -> `SessionTrace`. `__qaRecordV2` may still run
   * (shadow/diagnostic only) but never reaches `onInteraction`. Only reachable by explicitly
   * passing `captureAuthority: "legacy"` in `WebRecorderOptions` -- never a request-driven value.
   *
   * `"v2"` (default): `__qaRecordV2` technical actions -> `adaptCaptureActionToRawInteraction` ->
   * `onInteraction` -> `SessionTrace`. The legacy `__qaRecord` binding stays registered (for
   * compatibility/diagnostics) but its messages are never forwarded to `onInteraction`. There is
   * no mid-session fallback: if V2 fails to initialize, this session simply has no active
   * capture authority (see the `console.log("[capture-v2] AUTHORITY FAILURE...")` in `start()`),
   * rather than silently reactivating legacy.
   */
  private readonly captureAuthority: "legacy" | "v2";

  /**
   * Serializes V2-authority ingestion into `onInteraction` (itself async: it awaits screenshots
   * etc.) so technical actions are applied to `SessionTrace` in the EXACT order
   * `CaptureEngineV2ShadowBridge` appended them to `technicalActions`, regardless of how the
   * underlying binding calls resolve. `stop()` awaits this before finalizing.
   */
  private v2IngestionQueue: Promise<void> = Promise.resolve();

  /**
   * ShadowBridge's OWN seq -> the RecordedEvent it produced, for CLICK technical actions only.
   * Lets a later functional `select` projection (`onV2FunctionalAction`) find and flag the exact
   * already-pushed technical events it summarizes, however that async ingestion has interleaved
   * -- never a positional/timing assumption, purely a seq-keyed lookup.
   */
  private readonly v2SeqToClickEvent = new Map<number, RecordedEvent>();

  constructor(private readonly options: WebRecorderOptions) {
    this.captureAuthority = options.captureAuthority ?? "v2";
  }

  private log(line: string): void {
    this.options.onLog?.(line);
  }

  private now(): number {
    return Date.now() - this.startedAt;
  }

  private pushEvent(event: Omit<RecordedEvent, "seq">): RecordedEvent {
    const full: RecordedEvent = { ...event, seq: this.seq++ };
    this.events.push(full);
    this.options.onEvent?.(full);
    return full;
  }

  private async captureFrame(tag: string): Promise<string | undefined> {
    if (!this.page) return undefined;
    const file = path.join(this.options.framesDir, `${String(this.seq).padStart(4, "0")}-${tag}.png`);
    try {
      await this.page.screenshot({ path: file });
      return file;
    } catch {
      return undefined;
    }
  }

  /**
   * Records the page as a screen, emitting a transition when its structure changed.
   *
   * URL alone is not the identity: a single-page app rewrites its whole view without
   * navigating, and a paginated list changes URL without being a different screen. The
   * structural fingerprint is what actually distinguishes states.
   */
  private async absorbScreen(): Promise<{ changed: boolean; screenKey: string }> {
    if (!this.page) return { changed: false, screenKey: this.lastScreenKey };
    const snapshot = await extractRuntimeUiSnapshot(this.page);
    const fingerprint = fingerprintSnapshot(snapshot);
    const screenKey = snapshot.screenKey || fingerprint.slice(0, 16);
    const changed = fingerprint !== this.lastFingerprint;

    const controls: RecordedControl[] = snapshot.observedControls.map((c) => ({
        label: c.businessLabel ?? c.label,
        role: c.role,
        tag: c.tag,
        placeholder: c.placeholder,
        attributes: c.attributes,
        containerContext: c.containerContext,
        headerContext: c.headerContext,
        rowContext: c.rowContext,
        rowIdentity: c.rowIdentity,
        columnIdentity: c.columnIdentity,
        associatedField: c.associatedField,
        locators: c.locatorIdentity
          ? [{ strategy: "aria-label", value: c.locatorIdentity, confidence: 0.9 }]
          : [{ strategy: "text", value: c.label, confidence: 0.7 }],
      }));
    const previousScreen = this.screens.get(screenKey);
    const recordedScreen: RecordedScreen = {
        screenKey,
        title: snapshot.headings[0] ?? screenKey,
        fingerprint,
        url: snapshot.url,
        firstSeenAt: previousScreen?.firstSeenAt ?? this.now(),
        controls,
        texts: snapshot.assertionTargets.slice(0, 40),
        gridMetadata: snapshot.gridMetadata,
        headerRelationships: snapshot.gridMetadata?.headerRelationships,
      };
    this.screens.set(screenKey, recordedScreen);
    this.options.onScreen?.(recordedScreen);

    this.lastFingerprint = fingerprint;
    return { changed, screenKey };
  }

  /**
   * Controlled authority switch, V2 half. Called synchronously, in exact technicalActions order,
   * by `CaptureEngineV2ShadowBridge.onTechnicalAction` for every technical action it appends --
   * never for a `CaptureFunctionalAction`, which is not (and must never become) replay authority.
   *
   * Does nothing unless `captureAuthority === "v2"` (shadow-only sessions must never reach
   * `onInteraction` from here). When active, serializes ingestion through `v2IngestionQueue` so
   * `onInteraction`'s own async work (screenshots, etc.) can never reorder technical actions
   * relative to each other, regardless of how the underlying binding calls resolve.
   */
  private onV2TechnicalAction(record: ShadowActionRecord): void {
    if (this.captureAuthority !== "v2") return;
    if (record.action.interactionId && record.action.sourceRefs?.eventTargetRef) {
      this.v2InteractionIdToEventTargetRef.set(record.action.interactionId, record.action.sourceRefs.eventTargetRef);
    }
    this.v2IngestionQueue = this.v2IngestionQueue.then(() => {
      const raw = adaptCaptureActionToRawInteraction(record.action) as unknown as RawInteraction;
      // TEMPORARY DIAGNOSTIC (this ticket only): traces every V2 technical action's
      // CaptureAction -> RawInteraction -> RecordedEvent boundary explicitly, so a physical
      // recording that loses an action between these two layers is directly visible instead of
      // silently absent from the trace. No dataset value/secret is logged -- only ids, kind,
      // role and presence booleans. Uses raw `console.log` (not just `this.log`), matching the
      // existing convention for other `[capture-v2]` lines in this file: `this.log`'s own
      // wiring may route only to a UI/job-log channel, never guaranteed to reach the process's
      // own stdout, which is exactly the visibility gap this diagnostic exists to close.
      console.log(`[capture-v2-lineage] phase=raw_interaction_built seq=${record.seq} actionType=${record.action.actionType} rawKind=${raw.kind} ownerTag=${record.action.owner?.tag ?? "unknown"} ownerRole=${record.action.owner?.role ?? "unknown"}`);
      return this.onInteraction(raw)
        .then((event) => {
          console.log(`[capture-v2-lineage] phase=recorded_event_result seq=${record.seq} actionType=${record.action.actionType} recordedEventPresent=${Boolean(event)} recordedEventKind=${event?.kind ?? "none"}`);
          if (event && record.action.actionType === "click") this.v2SeqToClickEvent.set(record.seq, event);
        })
        .catch((err) => {
          const message = `[capture-v2-lineage] phase=ingestion_error seq=${record.seq} actionType=${record.action.actionType} error=${err instanceof Error ? err.message : String(err)}`;
          console.log(message);
          this.log(message);
        });
    });
  }

  private onV2PointerObservation(record: ShadowActionRecord): void {
    if (this.captureAuthority !== "v2") return;
    this.v2IngestionQueue = this.v2IngestionQueue.then(() => {
      const raw = adaptCaptureActionToRawInteraction(record.action) as unknown as RawInteraction;
      return this.onInteraction(raw).catch((err) => {
        this.log(`[capture-v2] pointer observation ingestion error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  /**
   * Diagnostic-only crossover for the legacy CAPTURE_SCRIPT's own MutationObserver-driven
   * post_action observation (always installed, see web-session-recorder.ts's own `send()`/
   * `schedulePostAction`), reached ONLY from the `__qaRecord` binding's own explicit, narrow
   * allowlist -- never a general gate-open. NEVER action authority: this never reaches
   * `onInteraction` as a click/fill/press/navigate, only ever as `kind: "observation",
   * observationType: "post_action"`, the exact shape `onV2PointerObservation` above already
   * produces for V2's own pointer notes and `canonical-recording-contract.ts`'s pre-existing
   * `relatedStateByTrigger` join already consumes untouched.
   *
   * Fail-closed by construction: `payload.interactionId` must match a V2 action this session has
   * ALREADY ingested (`v2InteractionIdToEventTargetRef`, populated in `onV2TechnicalAction`
   * directly from that action's own `sourceRefs.eventTargetRef` -- never a timestamp/order guess).
   * No match, no lineage: the observation is dropped, never attached to the wrong action or to
   * none at all. Only the already-redacted `relatedState*`/`mutationSummary` fields travel
   * through -- raw `beforeState`/`afterState`/typed values on the legacy payload are never
   * forwarded.
   */
  private onV2DiagnosticObservation(payload: RawInteraction): void {
    if (this.captureAuthority !== "v2") return;
    const correlationId = payload.interactionId;
    const triggerTechnicalTarget = correlationId ? this.v2InteractionIdToEventTargetRef.get(correlationId) : undefined;
    console.log(`[capture-v2-post-action] phase=handler_called interactionIdPresent=${Boolean(correlationId)} eventTargetRefLookupHit=${Boolean(triggerTechnicalTarget)} eventTargetRefPresent=${Boolean(payload.eventTargetRef)}`);
    if (!triggerTechnicalTarget) {
      console.log("[capture-v2-post-action] phase=handler_rejected rejectReason=unknown_interaction_id");
      this.log("[capture-v2] diagnostic post_action observation dropped -- no known V2 action for its interactionId");
      return;
    }
    this.v2IngestionQueue = this.v2IngestionQueue.then(() => {
      const eventsBefore = this.events.length;
      return this.onInteraction({
        kind: "observation",
        observationType: "post_action",
        interactionId: correlationId,
        label: payload.label,
        role: payload.role,
        tagName: payload.tagName,
        dynamicLifecycle: {
          triggerTechnicalTarget,
          relatedStateOwnerIdentity: payload.dynamicLifecycle?.relatedStateOwnerIdentity,
          relatedStateContainerIdentity: payload.dynamicLifecycle?.relatedStateContainerIdentity,
          relatedStateMutations: payload.dynamicLifecycle?.relatedStateMutations,
        },
      })
        .then(() => {
        console.log(`[capture-v2-post-action] phase=trace_append observationForwarded=true traceEventAppended=${this.events.length > eventsBefore}`);
        return undefined;
      })
        .catch((err) => {
          this.log(`[capture-v2] diagnostic observation ingestion error: ${err instanceof Error ? err.message : String(err)}`);
        });
    });
  }

  /**
   * Controlled authority switch, functional-projection half. Never itself replay authority: the
   * technical clicks a completed selection summarizes were already forwarded to `onInteraction`
   * by `onV2TechnicalAction` above, unchanged. This only (a) flags those already-recorded events
   * so scenario/step derivation does not ALSO render them as independent steps, and (b) appends
   * ONE additional, locator-less, display-only event carrying the option's real selected value
   * and the combobox's real field identity -- reusing the exact `compoundRole: "selection"` shape
   * the scenario renderer already understands (see semantic-recording.ts/trace-to-scenario.ts).
   * Chained through `v2IngestionQueue` so both referenced technical clicks have already been
   * ingested (and are present in `v2SeqToClickEvent`) by the time this runs, regardless of how
   * the underlying async bindings interleaved.
   */
  private onV2FunctionalAction(record: ShadowFunctionalActionRecord): void {
    if (this.captureAuthority !== "v2") return;
    if (record.action.functionalActionType !== "select") return;
    this.v2IngestionQueue = this.v2IngestionQueue.then(() => {
      const sourceEvents: RecordedEvent[] = [];
      for (const shadowSeq of record.action.sourceTechnicalActionSeqs) {
        const event = this.v2SeqToClickEvent.get(shadowSeq);
        if (!event) continue;
        sourceEvents.push(event);
      }
      const owner = record.action.owner;
      const evidence = record.action.selectionEvidence;
      // FIRST_LOSS fix (recordingId 8022c4cb-bf2c-4f11-9e58-2a4d5921a29e): `selectionEvidence`'s
      // own `selectedDisplay`/`selectedValue` extraction can come up empty for a combobox/option
      // pattern even when the option's own raw click event already carries a real, certified
      // label -- previously this fell straight through to `return` below with NO compensating
      // display event, but the owner+option clicks were ALREADY marked
      // `coveredByFunctionalSelection` (see below), so both silently vanished from the visible
      // projection with nothing replacing them. Fall back to the OPTION half's own already-
      // captured technical label (the SAME authority that certifies its identity elsewhere in
      // the canonical layer) -- never the owner/combobox's own label (that is the FIELD name,
      // not the selected value), never a positional/invented guess.
      // `target.label` always has SOME string (onInteraction's own commonTarget falls back to
      // the literal placeholder "control" when nothing was captured) -- a generic/unresolved
      // label is never real display authority, so it is rejected the SAME way every other
      // generic-label check in this codebase already does (isGenericUnresolvedLabel), not
      // treated as a genuine selected value.
      const optionSourceLabelRaw = sourceEvents
        .find((event) => event.target?.role?.toLowerCase() === "option")
        ?.target?.label?.trim();
      const optionSourceLabel = optionSourceLabelRaw && !isGenericUnresolvedLabel(optionSourceLabelRaw)
        ? optionSourceLabelRaw
        : undefined;
      const selectedValue = evidence.selectedDisplay?.trim() || evidence.selectedValue?.trim() || optionSourceLabel;
      if (!selectedValue) return; // still no real selected-value evidence anywhere -- never invent one
      // Only mark the source technical clicks as covered (hidden from their own independent
      // step) once we know a compensating selection event is actually about to be pushed below --
      // never hide them and then silently produce nothing.
      const sourceTechnicalEventSeqs: number[] = [];
      for (const event of sourceEvents) {
        if (event.target) event.target.coveredByFunctionalSelection = true;
        sourceTechnicalEventSeqs.push(event.seq);
      }
      // Own field/accessible name first; associatedField only as a certified fallback; never the
      // option's own selected value used as the field's name (field identity != selected value).
      const fieldLabel = owner?.accessibleName?.trim() || owner?.associatedField?.trim() || undefined;
      this.pushEvent({
        t: this.now(),
        kind: "tap",
        // FIRST_LOSS fix (recordingId 29699822-5b84-456a-ab87-4e82914e758f): normalizeEvents
        // (trace-normalizer.ts) already has a carve-out that keeps a locator-less
        // `compoundRole: "selection"` event alive (never demoted to a dropped `note`) -- but it
        // ALSO requires `observationType === "pointer"` (or afterState.selected/
        // dynamicLifecycle.committedState, neither applicable to a synthesized display
        // projection). This event genuinely summarizes a real pointer gesture cluster (the
        // owner+option clicks it was built from), so it belongs in that same bucket -- omitting
        // it meant every promoted-spec/derive/live-preview path that normalizes events first
        // (deriveScenarios, materializeObservedPrimaryScenario, live projection) silently
        // demoted this event to a dropped `note`, even though a script that read the raw,
        // un-normalized trace never hit that filter and saw it as present.
        observationType: "pointer",
        screenKey: this.lastScreenKey,
        fingerprint: this.lastFingerprint,
        url: this.page?.url(),
        target: {
          label: selectedValue,
          // "option" -- not the combobox's own role -- matching the existing compound-selection
          // convention (semantic-recording.ts/trace-to-scenario.ts already special-case
          // role="option" so this event's own `label` (the selected VALUE) is never mistaken for
          // the field's identity; `associatedField` below carries the actual field name.
          role: "option",
          interactionType: "select",
          afterValue: selectedValue,
          compoundRole: "selection",
          associatedField: fieldLabel,
          locators: [],
          sourceTechnicalEventSeqs,
        },
      });
    });
  }

  private async onInteraction(raw: RawInteraction): Promise<RecordedEvent | undefined> {
    if (this.stopped) return;
    const sensitive = isSensitiveField(raw, this.options.sensitiveLabels);
    const locators = raw.kind === "observation" ? [] : buildWebLocators(raw);
    // Temporary diagnostic only, never changes what is recorded: surfaces the exact shape a
    // field ends up with when field-owner resolution failed and the last-resort bare structural
    // fallback is all that reached buildWebLocators.
    if (isBareStructuralFallbackOnly(locators)) {
      console.log(describeFieldOwnerUnresolved({
        screenKey: this.lastScreenKey,
        tagName: raw.tagName,
        role: raw.role,
        associatedField: raw.associatedField,
        headerContext: raw.headerContext,
        cellRef: raw.cellRef,
        gridRef: raw.gridRef,
        locators,
      }));
      // The per-ancestor trace nearestFieldGroupLabel captured in the page is carried here on
      // `raw.fieldOwnerDiagnostic` — the same interaction payload every other target field
      // already travels through, not a parallel channel.
      console.log(describeFieldOwnerUnresolvedDetail(raw.fieldOwnerDiagnostic));
    }
    const technicalTargetCandidates = preserveCapturedTechnicalTargetLocators(raw.technicalTargetCandidates, locators);
    // FIRST_LOSS fix (recordingId=a65455ab-...): a per-interaction screenshot was awaited here on
    // every single click/fill during RECORDING. framePath is never read by anything downstream
    // (not the recording review panel, not evidencia.docx, not discovery/replay -- confirmed by
    // grep, execution's own evidence screenshots are a completely separate path). Playwright
    // serializes commands on one page/CDP connection, so a burst of clicks (e.g. a numeric keypad)
    // queued behind each other's screenshot call, producing exactly the reported "captures much
    // later, or not at all" lag/loss. Removed: recording no longer screenshots at all, only
    // execution (a separate, unrelated code path) still does for evidence purposes.
    const framePath: string | undefined = undefined;

    const commonTarget = {
      label: raw.label || raw.name || raw.text || "control",
      role: raw.role,
      tag: raw.tagName,
      inputType: raw.inputType,
      placeholder: raw.placeholder,
      attributes: raw.attributes,
      containerContext: raw.containerContext,
      headerContext: raw.headerContext,
      rowContext: raw.rowContext,
      rowIdentity: raw.rowIdentity,
      columnIdentity: raw.columnIdentity,
      associatedField: raw.associatedField,
      locators,
      enabled: raw.disabled === true ? false : undefined,
      beforeValue: raw.beforeValue,
      afterValue: raw.afterValue,
      observedOptions: raw.observedOptions,
      interactionType: raw.interactionType,
      compoundRole: raw.compoundRole,
      gridRef: raw.gridRef,
      rowRef: raw.rowRef,
      cellRef: raw.cellRef,
      headerRef: raw.headerRef,
      containerIdentity: raw.containerIdentity,
      beforeState: raw.beforeState,
      afterState: raw.afterState,
      activeElementBefore: raw.activeElementBefore,
      activeElementAfter: raw.activeElementAfter,
      stateDelta: raw.stateDelta,
      dynamicLifecycle: raw.dynamicLifecycle,
      editingSessionRef: undefined,
      inputValue: raw.inputValue,
      committedValue: raw.committedValue,
      displayValue: raw.displayValue,
      eventTargetRef: raw.eventTargetRef,
      currentTargetRef: raw.currentTargetRef,
      composedPathRefs: raw.composedPathRefs,
      deepestEditableTargetRef: raw.deepestEditableTargetRef,
      rawTypedValue: raw.rawTypedValue,
      inputEventData: raw.inputEventData,
      inputTypes: raw.inputTypes,
      beforeInputValue: raw.beforeInputValue,
      afterInputValue: raw.afterInputValue,
      technicalTargetCandidates,
      semanticRuntimeEvidence: raw.semanticRuntimeEvidence,
      playwrightRecorderEvidence: raw.playwrightRecorderEvidence,
      actionability: raw.actionability,
      actionOwner: raw.actionOwner,
      fieldOwnerDiagnostic: raw.fieldOwnerDiagnostic,
    };

    if (raw.kind === "observation") {
      this.pushEvent({
        t: this.now(),
        interactionId: raw.interactionId,
        kind: "note",
        screenKey: this.lastScreenKey,
        fingerprint: this.lastFingerprint,
        url: raw.pageUrlAtClick ?? this.page?.url(),
        target: commonTarget,
        note: `Observación técnica (${raw.observationType ?? "post_action"}) sobre "${commonTarget.label}"`,
        observationType: raw.observationType ?? "post_action",
      });
      return;
    }

    if (raw.kind === "input") {
      this.pushEvent({
        t: this.now(),
        kind: "fill",
        screenKey: this.lastScreenKey,
        fingerprint: this.lastFingerprint,
        url: raw.pageUrlAtClick ?? this.page?.url(),
        target: {
          ...commonTarget,
          label: raw.label || raw.name || "campo",
          role: "input",
          sensitive,
        },
        // Password values are allowed only for the QA recording contract. They are persisted
        // in the trace/dataset but never written to the recorder log or console.
        value: raw.value,
        redactedKey: sensitive ? normalizeLabel(raw.label || raw.name || "campo").replace(/\s+/g, "_") : undefined,
        valueSource: raw.valueSource ?? "user",
        framePath,
      });
      return;
    }

    if (raw.kind === "press") {
      // A discrete, non-textual command key (Enter/Escape/...) is its own technical action --
      // never converted into a click, even when the browser/framework goes on to fire a
      // synthetic click as a SIDE EFFECT of the same key (that correlation/suppression is
      // CaptureEngine V2's job, upstream of this method; onInteraction only records what it is
      // handed). `note` is reused for the key name -- generic, never a typed value, exactly like
      // the "observation" branch above reuses it for a technical description.
      this.pushEvent({
        t: this.now(),
        kind: "press",
        screenKey: this.lastScreenKey,
        fingerprint: this.lastFingerprint,
        url: raw.pageUrlAtClick ?? this.page?.url(),
        target: commonTarget,
        note: raw.key,
        framePath,
      });
      return;
    }

    const tapEvent = this.pushEvent({
      t: this.now(),
      interactionId: raw.interactionId,
      kind: "tap",
      screenKey: this.lastScreenKey,
      fingerprint: this.lastFingerprint,
      url: raw.pageUrlAtClick ?? this.page?.url(),
      target: commonTarget,
      framePath,
    });
    this.log(`[recording] clic -> "${raw.label || raw.text || "(sin etiqueta)"}"`);

    // Bounded post-action observation: dynamic editors get a short chance to materialize,
    // without imposing a long fixed sleep on every click.
    for (const delay of [60, 120, 180]) {
      await this.page?.waitForTimeout(delay).catch(() => undefined);
      const current = await this.absorbScreen();
      if (current.screenKey !== this.lastScreenKey) break;
    }
    const from = this.lastScreenKey;
    const { changed, screenKey } = await this.absorbScreen();
    if (changed && screenKey !== from) {
      this.lastScreenKey = screenKey;
      this.pushEvent({
        t: this.now(),
        kind: "screen_change",
        screenKey: from,
        toScreenKey: screenKey,
        fingerprint: this.lastFingerprint,
        url: raw.pageUrlAtClick ?? this.page?.url(),
        framePath: await this.captureFrame("screen"),
      });
      this.log(`[recording] pantalla -> ${this.screens.get(screenKey)?.title ?? screenKey}`);
    }
    return tapEvent;
  }

  async start(): Promise<boolean> {
    fs.mkdirSync(this.options.framesDir, { recursive: true });
    const engine =
      this.options.browserName === "firefox" ? firefox : this.options.browserName === "webkit" ? webkit : chromium;

    this.browser = await engine.launch({ headless: false });
    this.context = await this.browser.newContext(
      buildWebRecorderContextOptions(this.options.ignoreHTTPSErrors),
    );
    await this.context.exposeBinding("__qaRecord", async (_source, payload: RawInteraction) => {
      const isPostAction = payload.kind === "observation" && payload.observationType === "post_action";
      if (isPostAction) {
        console.log(`[capture-v2-post-action] phase=binding_received __qaRecordReceived=true captureAuthority=${this.captureAuthority} interactionIdPresent=${Boolean(payload.interactionId)}`);
      }
      // Single-authority invariant: when captureAuthority="v2", legacy messages must never reach
      // onInteraction/SessionTrace, even though this binding stays registered for
      // compatibility/diagnostics. This is the ONLY gate legacy ingestion needs -- everything
      // else about onInteraction/pushEvent is completely unchanged.
      if (this.captureAuthority !== "legacy") {
        // Narrow, explicit exception: a post_action mutation observation carrying an explicit
        // V2 interactionId is diagnostic/state evidence only, never action authority, and is
        // routed to its own dedicated, fail-closed handler -- never onInteraction directly, and
        // every other legacy payload shape (click/input/submit/press, or an observation with no
        // provable V2 lineage) keeps being discarded exactly as before.
        if (payload.kind === "observation" && payload.observationType === "post_action" && typeof payload.interactionId === "string" && payload.interactionId.length > 0) {
          console.log("[capture-v2-post-action] phase=binding_gate postActionShapeAccepted=true rejectReason=none");
          this.onV2DiagnosticObservation(payload);
          return;
        }
        if (isPostAction) console.log("[capture-v2-post-action] phase=binding_gate postActionShapeAccepted=false rejectReason=missing_interaction_id_or_shape");
        this.log(`[recording] legacy event ignored (captureAuthority=${this.captureAuthority})`);
        return;
      }
      await this.onInteraction(payload).catch((err) =>
        this.log(`[recording] error procesando interacción: ${err instanceof Error ? err.message : String(err)}`),
      );
    });
    const captureScriptContent = `window.__qaRecorderPersistQaCredentials = true;\n${CAPTURE_SCRIPT}`;
    await this.context.addInitScript({
      content: captureScriptContent,
    });

    // CaptureEngine V2 -- SHADOW ONLY, additive and isolated from the block above. A SEPARATE
    // binding (`__qaRecordV2`, never legacy's `__qaRecord`) and a completely separate init
    // script, so V2 can never be mistaken for -- or interfere with -- the productive capture
    // path. Any failure here is swallowed: the legacy recorder must start regardless of V2.
    let captureScriptV2Content: string | undefined;
    try {
      const captureInstanceId = randomUUID();
      const v2Shadow = new CaptureEngineV2ShadowBridge(
        (line) => this.log(line),
        (record) => this.onV2TechnicalAction(record),
        (record) => this.onV2FunctionalAction(record),
        (record) => this.onV2PointerObservation(record),
      );
      const v2FrameIds = new WeakMap<object, string>();
      const frameIdFor = (frame: object): string => {
        const existing = v2FrameIds.get(frame);
        if (existing) return existing;
        const frameId = randomUUID();
        v2FrameIds.set(frame, frameId);
        return frameId;
      };
      await this.context.exposeBinding("__qaRecordV2", async (source, message: ShadowBrowserMessage) => {
        v2Shadow.handleMessage({ ...message, frameId: frameIdFor(source.frame) });
      });
      captureScriptV2Content = buildCaptureScriptV2Content(captureInstanceId);
      await this.context.addInitScript({ content: captureScriptV2Content });
      this.v2Shadow = v2Shadow;
      // Diagnostic-only, direct console.log (not just this.log): whatever onLog wiring the
      // caller uses for `[recording]` lines may route only to a UI/job-log channel, not the
      // process's own stdout -- this line (and every other [capture-v2] line) must be visible
      // in raw backend stdout regardless of that wiring, exactly like the pre-existing
      // console.log(describeFieldOwnerUnresolved(...)) diagnostics elsewhere in this file.
      console.log(`[capture-v2] bridge_registered captureInstance=${captureInstanceId}`);
    } catch (err) {
      console.log(`[capture-v2] shadow setup failed, continuing without it: ${err instanceof Error ? err.message : String(err)}`);
      this.v2Shadow = null;
      if (this.captureAuthority === "v2") {
        // Failure policy: no automatic mid-session fallback to legacy -- that would mix
        // authorities. This session simply has no active capture authority from this point on;
        // the legacy binding stays registered but gated off by captureAuthority !== "legacy".
        console.log("[capture-v2] AUTHORITY FAILURE: captureAuthority=v2 but V2 setup failed -- no capture authority is active for this session");
      }
    }

    this.page = await this.context.newPage();
    // TEMPORARY DIAGNOSTIC (DOM-authority ticket only): forwards the browser-side
    // "[capture-v2-dom-authority]" presence-check line (capture-engine-v2.browser-instrumentation.ts)
    // to server stdout, exactly like the existing direct console.log("[capture-v2] ...") lines
    // elsewhere in this file -- pure log plumbing, never touches a candidate/locator/readiness
    // value. Any other browser console output is ignored.
    this.page.on("console", (msg) => {
      const text = msg.text();
      if (text.startsWith("[capture-v2-dom-authority]")) console.log(text);
    });
    this.page.on("framenavigated", (frame) => {
      if (frame !== this.page?.mainFrame() || this.stopped) return;
      this.pushEvent({
        t: this.now(),
        kind: "navigate",
        screenKey: this.lastScreenKey,
        url: frame.url(),
      });
      // context.addInitScript already reinstalls CAPTURE_SCRIPT on every new document, but a
      // fast redirect/full navigation can occasionally race ahead of that registration reaching
      // the new document before the app's own bootstrap script runs. Re-evaluating here is a
      // safety net, never a replacement: CAPTURE_SCRIPT's own window.__qaRecorderInstalledV1
      // guard (already present) makes this a no-op whenever addInitScript already did its job,
      // so a listener is never installed twice on the same document, and the exposed binding
      // itself (context-scoped) needs no re-registration.
      frame.evaluate(captureScriptContent).catch(() => undefined);
      // Same defensive safety net for the V2 shadow script, guarded by its own, separate
      // window.__qaRecorderV2InstalledV1 marker -- never touches the legacy guard above.
      if (captureScriptV2Content) frame.evaluate(captureScriptV2Content).catch(() => undefined);
    });

    await this.page.goto(this.options.baseUrl, { waitUntil: "domcontentloaded" });
    const { screenKey } = await this.absorbScreen();
    this.lastScreenKey = screenKey;
    this.pushEvent({
      t: 0,
      kind: "launch",
      screenKey,
      url: this.options.baseUrl,
      framePath: await this.captureFrame("launch"),
    });

    this.log("[recording] navegador abierto: realiza el recorrido y pulsa Detener cuando termines");
    return true;
  }

  async stop(): Promise<{ events: RecordedEvent[]; screens: RecordedScreen[] }> {
    // Drain any V2-authority ingestion still in flight BEFORE marking the recorder stopped --
    // onInteraction's own `if (this.stopped) return;` guard would otherwise silently swallow a
    // technical action that was queued but hadn't reached onInteraction yet. No fixed sleep:
    // this awaits the exact promise chain onV2TechnicalAction already serializes ingestion
    // through, so it resolves the instant everything already queued has actually been applied.
    await this.v2IngestionQueue.catch(() => undefined);
    this.stopped = true;
    // Shadow-only visibility: bounded counts, never field values, never connected to
    // SessionTrace -- printed even when zero V2 messages were ever received, so "V2 produced
    // nothing" is always distinguishable from "V2 was never observable at all".
    if (this.v2Shadow) {
      const summary = this.v2Shadow.getShadowSummary();
      const edits = summary.actionTypeCounts.edit ?? 0;
      const clicks = summary.actionTypeCounts.click ?? 0;
      console.log(
        `[capture-v2] summary messages=${summary.messages} actions=${summary.actions} diagnostics=${summary.diagnostics} documents=${summary.documents} edits=${edits} clicks=${clicks}`,
      );
    }
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    this.page = null;
    return { events: [...this.events], screens: [...this.screens.values()] };
  }

  snapshotProgress(): { events: number; screens: number; currentScreen: string } {
    return {
      events: this.events.length,
      screens: this.screens.size,
      currentScreen: this.screens.get(this.lastScreenKey)?.title ?? this.lastScreenKey,
    };
  }
}
