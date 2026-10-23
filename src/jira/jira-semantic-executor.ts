import type { Locator, Page } from "@playwright/test";
import { settleJiraAction } from "./jira-action-settlement";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { scanCurrentPage } from "../explorer/page-scanner";
import { detectAuthGate } from "../discovery/auth-gate-detector";
import { detectCredentialRole } from "../data/data-key-resolver";
import { parseStepIntent } from "../discovery/step-intent-parser";
import { resolveActionTarget, resolveFillTarget, resolveGridEditor, type TargetResolutionResult } from "../discovery/target-resolver";
import { chooseJiraDomTarget, locatorForJiraDomCandidate } from "./jira-dom-target-ai";
import type { ExecutionPlan, ExecutionPlanStep, PlanTarget } from "../types/execution-plan.types";
import type { SpecGenerationSourceScenario, SpecGenerationObservableOracle } from "../automations/spec-generation-hybrid";
import type { DataContextEntry } from "../data/data-context";
import { assertJiraSpecAbsentText, observeJiraNamedRowMatch, uniqueVisibleActionOwner, type JiraRowMatchStatus } from "./jira-spec-runtime";
import { assertJiraDownloadContent, ensureJiraDownloadObserver, observeJiraVisibleTableRows, parseJiraDownloadExpectation, type JiraDownloadExpectation } from "./jira-download-assertion";
import { resolveJiraDomAssertion } from "./jira-dom-assertion-ai";
import { normalizeJiraAssertionSyntax } from "./jira-assertion-syntax";
import { jiraCredentialRejectionMatches, jiraAlertErrorEquivalenceMatches, observeJiraCredentialRejection, readVisibleJiraAlertTexts, stripJiraNotificationChannelWord } from "./jira-assertion-matching";
import { classifyAssertionPolarity } from "../scenarios/canonical-scenario";
import type { JiraInputRequirement } from "./jira-input-requirements";
import {prepareJiraScenarioReview, jiraRepeatedAssertionBlocks, type JiraConditionRequirement, type JiraReviewConfiguration} from "./jira-scenario-review";
import { fillJiraSegmentedCode, isJiraSegmentedCodeTarget, resolveJiraSegmentedCodeGroup } from "./jira-segmented-code";
import { chooseJiraMatchingOption, jiraOptionTextMatches, jiraOptionSearchRoot, jiraOptionBelongsToRoot } from "./jira-option-choice";
import { isJiraResultCountAssertion, isJiraResultCountText } from "./jira-result-count";
import { isJiraRangeMetadataAssertion, jiraNumericValueMatches, jiraRangeMetadataAssertionMatches, setJiraRangeControlValue } from "./jira-range-control";
import { observeJiraFieldValidation, type JiraFieldValidationEvidence } from "./jira-field-validation";
import { detectTransientScreen } from "../discovery/transient-screen-detector";
import { DEFAULT_POLL_MS, DEFAULT_TIMEOUT_MS } from "../discovery/page-stability-detector";

/** Quiet polls (not loading, no gate, no landing) tolerated before concluding no auth stage follows the submit. */
const AUTH_STAGE_QUIET_POLLS = 8;

/** Explicit access/verification/one-time code wording; transfer/security-token labels deliberately do not match. */
const ACCESS_CODE_LABEL = /\b(?:c[oó]digo|code)\s+(?:de\s+)?(?:acceso|verificaci[oó]n|un\s+solo\s+uso|sms|otp)\b|\b(?:access|verification|one[- ]time)\s+(?:code|password|passcode)\b|\botp\b/i;

/** Jira-only supplement to detectAuthGate: a visible native input labelled as an access/verification code means the OTP stage. */
function jiraAccessCodeGateVisible(snapshot: any): boolean {
  const els: any[] = (snapshot?.elements ?? []).filter((e: any) => e?.visible !== false);
  const nativeInput = els.some(e => e.tagName === "input" && !["password", "hidden", "checkbox", "radio", "submit", "button"].includes(String(e.inputType ?? "").toLowerCase()));
  return nativeInput && els.some(e => [e.text, e.label, e.placeholder, e.ariaLabel, e.name].some(v => typeof v === "string" && ACCESS_CODE_LABEL.test(v)));
}

/**
 * Observe the auth stage after a credentials submit. Resolves as soon as a gate stage or the authenticated
 * landing is seen; while the app shows a transient/loading state it keeps waiting, bounded by the shared
 * page-stability timeout.
 */
export async function observeAuthStageSettled(deps: { scan: () => Promise<any>; wait: (ms: number) => Promise<unknown>; now: () => number;
  timeoutMs?: number; pollMs?: number }): Promise<string | undefined> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS } = deps;
  const deadline = deps.now() + timeoutMs;
  let quiet = 0;
  while (deps.now() < deadline) {
    const snapshot = await deps.scan();
    const gate = detectAuthGate(snapshot);
    if (gate.stage === "authenticated_landing") return undefined;
    if (gate.detected && gate.stage !== "unknown" && gate.stage !== "credentials") return gate.stage;
    if (jiraAccessCodeGateVisible(snapshot)) return "otp";
    quiet = detectTransientScreen(snapshot).transient ? 0 : quiet + 1;
    if (quiet >= AUTH_STAGE_QUIET_POLLS) return undefined;
    await deps.wait(pollMs);
  }
  return undefined;
}

export type JiraScenarioInput = { scenarioId: string; title: string; sourceIssueKey: string; steps: string[]; expectedResult: string; expectedResultMode?: "assertion" | "documentation"; testType?: string; testApproach?: string; preconditions?: string[]; authIntent?: "gate_observation" | "full_authentication"; appSlug?: string; inputRequirements?: JiraInputRequirement[];
  unresolvedUiRequirements?: Array<{stepIndex:number;requirement:string}>; conditionRequirements?: JiraConditionRequirement[]; reviewConfiguration?: JiraReviewConfiguration };
export type JiraDiscoveredExecutionContract = { plan: ExecutionPlan; sourceScenario: SpecGenerationSourceScenario; runtimeEntries: DataContextEntry[] };
export class JiraRequiredDataError extends Error {
  constructor(public readonly missingInputs:Array<{key:string;label:string;stepIndex:number}>) {
    super(`JIRA_REQUIRED_DATA_MISSING:${missingInputs[0]?.label ?? ''}`);
    this.name='JiraRequiredDataError';
  }
}
/** Observed labels of a classic login form. `extra` holds additional credential fields identified by role (e.g. company_identifier); `blocked` reports a visible required control that cannot be identified. */
export type JiraClassicLoginObservation =
  | { username: string; password: string; submit: string; extra?: Array<{ label: string; role: string }>; blocked?: undefined }
  | { blocked: string };
const SENSITIVE_BINDING_WORDS = /\b(?:password|contrasena|clave|pin|usuario|username|otp|token|secret|secreto|cedula|identificacion|identification|rnc|empresa|company|acceso|access)\b/;
function isSensitiveRowBindingField(label: string, valueKey?: string): boolean {
  return [label, valueKey].some(item => item !== undefined
    && (detectCredentialRole(item) !== undefined || SENSITIVE_BINDING_WORDS.test(item.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " "))));
}

export type JiraImplicitLogin ={ username: string; password: string; /** Extra credential values keyed by role (see detectCredentialRole). */ fields?: Record<string, string> };
export type JiraBrowserPort = {
  baseUrl?: string;
  navigate(): Promise<void>;
  navigateTo?(url: string): Promise<void>;
  /** `observedStage`: auth stage already seen on the page; the flow must continue from it, not restart. */
  authenticate?(observedStage?: string): Promise<{ success: boolean }>;
  /** Labels of a classic username/password gate on the current page, if one is shown. */
  observeClassicLogin?(): Promise<JiraClassicLoginObservation | undefined>;
  /** Stage of a non-classic auth gate (e.g. SMS/OTP verification) still pending on the current page, if any. */
  observeAuthStage?(): Promise<string | undefined>;
  /** True when a control with this accessible/visible label is currently shown. */
  isTargetVisible?(target: string): Promise<boolean>;
  /** True only when the label is one option of a mutually exclusive selector group on the observed login form:
   * several peer options whose selection state (aria-selected/pressed/checked, or an active/selected class) is observable. */
  isLoginSelectorOption?(target: string): Promise<boolean>;
  assertPrecondition?(target: string): Promise<{ observedText: string }>;
  act(step: ExecutionPlanStep, target: string, value?: string, semanticContext?: string): Promise<PlanTarget>;
  assertAbsent?(target: string): Promise<{ absent: true }>;
  /** A real download event must carry the expected file/content; page text never satisfies it. */
  assertDownload?(expected: JiraDownloadExpectation): Promise<{ kind: "download_content"; filename: string; bytes: number }>;
  /** Data rows of the single visible table (undefined when not safely scoped); binds filter-dependent exports to live content. */
  observeVisibleTable?(): Promise<string[][] | undefined>;
  assertValidation?(fieldLabel: string): Promise<JiraFieldValidationEvidence>;
  /** Exactly one data row of the named container must contain every previously entered value; throws JIRA_ROW_* otherwise. */
  assertRowMatch?(container: string, values: string[]): Promise<{ kind: "table_row_match"; container: string; matchedRows: 1; boundValueCount: number }>;
  assert(target: string, authGate: boolean, screenDescriptor?: boolean, columnHeader?: boolean): Promise<{ stage?: string; observedText?: string }>;
};

type JiraNativeOption = { value: string; label: string };

/** Resolve an explicitly numbered row through its own accessible control label.
 * This is a Jira fallback for tables whose visible column heading differs from
 * the field label used in the scenario. It stays within a real table row and
 * fails closed when the row/control is missing or ambiguous.
 */
async function resolveJiraRowScopedControl(page: Page, target: string, rowScope: number, kind: "fill" | "selection") {
  const tables = page.locator("table, [role='grid']");
  const matches: Locator[] = [];
  for (let tableIndex = 0; tableIndex < await tables.count().catch(() => 0); tableIndex += 1) {
    const rows = tables.nth(tableIndex).locator(JIRA_ROW_SELECTOR);
    const row = rows.nth(rowScope - 1);
    if (await row.count().catch(() => 0) !== 1 || !await row.isVisible().catch(() => false)) continue;
    const control = await resolveJiraControlInRow(row, target, kind);
    if (control) matches.push(control);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** Unique visible/enabled control whose accessible name matches `target` inside one already-identified row. */
async function resolveJiraControlInRow(row: Locator, target: string, kind: "fill" | "selection"): Promise<Locator | undefined> {
  const roles = kind === "selection" ? ["combobox"] : ["textbox", "spinbutton"];
  const matches: Locator[] = [];
  for (const role of roles) {
    const control = row.getByRole(role as "combobox" | "textbox" | "spinbutton", { name: new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
    if (await control.count().catch(() => 0) === 1
      && await control.isVisible().catch(() => false)
      && await control.isEnabled().catch(() => false)
      && (kind !== "fill" || await control.isEditable().catch(() => false))) matches.push(control);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

const JIRA_TARGET_STOP_TOKENS = new Set(["fila", "row", "agregada", "anadida", "nueva", "added", "newly", "para", "with", "from", "that", "este", "esta"]);
const jiraLabelTokens = (text: string) => normalizeJiraRowWording(text).split(/[^a-z0-9]+/).filter(token => token.length >= 4 && !JIRA_TARGET_STOP_TOKENS.has(token));

/**
 * Fill-only semantic fallback inside one already-identified row: when the authored target is not a
 * substring of any accessible name, accept the single editable textbox/spinbutton whose observed
 * label/aria-label/placeholder shares a meaningful target token. Zero or several qualifiers fail closed.
 */
async function resolveJiraControlInRowBySharedLabelToken(row: Locator, target: string): Promise<Locator | undefined> {
  const wanted = new Set(jiraLabelTokens(target));
  if (!wanted.size) return undefined;
  // DOM observation only: no positional locators. Each control reports its label and placeholder text.
  const observed: Array<{ label: string; placeholder: string }> = [];
  for (const role of ["textbox", "spinbutton"] as const) {
    observed.push(...await row.getByRole(role).evaluateAll(elements => elements.map(element => ({
      label: [
        element.getAttribute("aria-label"),
        ...Array.from((element as HTMLInputElement).labels ?? []).map(label => label.textContent),
        ...(element.getAttribute("aria-labelledby") ?? "").split(/\s+/).map(id => document.getElementById(id)?.textContent),
      ].filter(Boolean)[0]?.trim() ?? "",
      placeholder: element.getAttribute("placeholder")?.trim() ?? "",
    }))).catch(() => []));
  }
  const qualifiers = observed.filter(item => jiraLabelTokens(`${item.label} ${item.placeholder}`).some(token => wanted.has(token)));
  if (qualifiers.length !== 1) return undefined;
  const { label, placeholder } = qualifiers[0];
  // Rebuild by the observed unique accessible name/placeholder; fail closed unless it resolves to exactly one control.
  const control = label ? row.getByLabel(label, { exact: true }) : placeholder ? row.getByPlaceholder(placeholder, { exact: true }) : undefined;
  if (!control || await control.count().catch(() => 0) !== 1) return undefined;
  return await control.isVisible().catch(() => false) && await control.isEnabled().catch(() => false)
    && await control.isEditable().catch(() => false) ? control : undefined;
}

const JIRA_ROW_SELECTOR = "tbody tr, [role='row']";
const JIRA_ADDED_ROW_ATTRIBUTE = "data-qa-jira-added-row";
const JIRA_ADDED_ROW_STRATEGY = "jira_observed_added_row_control";
const JIRA_ADD_ROW_ACTION = /\b(?:agregar|anadir|add|nueva|nuevo|new|otra|otro|another)\b/;
const JIRA_ADDED_ROW_WORDING = /\b(?:fila|row)\s+(?:agregada|anadida|nueva|added|new)\b|\b(?:agregada|anadida|nueva|added|new|newly added)\s+(?:fila|row)\b/;

const normalizeJiraRowWording = (...descriptions: Array<string | undefined>) =>
  descriptions.filter(Boolean).join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");

/** Step wording that refers to the row created by a previous add-row click (not a numbered/ordinal row). */
/** True only for an authored auth-code ACTION: request/send/resend a code/OTP, or fill an access/verification/one-time code field. */
export function jiraAuthorsVerification(text: string): boolean {
  const requestsCode = /^\s*(?:(?:presionar|pulsar|hacer\s+clic|clic|click)\b[^\n]*?\b)?(?:solicitar|enviar|reenviar)\b[^\n]*\b(?:c[oó]digo|otp)\b/i;
  const fillsCode = /^\s*(?:ingresar|introducir|digitar|escribir|completar)\b[^\n]*\b(?:c[oó]digo\s+de\s+(?:acceso|verificaci[oó]n|un\s+solo\s+uso|[uú]nica\s+vez)|c[oó]digo\s+otp|otp|one[-\s]time\s+code)\b/i;
  const confirmsCode = /^\s*(?:confirmar|validar)\s+(?:el\s+)?(?:c[oó]digo\s+de\s+(?:acceso|verificaci[oó]n|un\s+solo\s+uso|[uú]nica\s+vez)|c[oó]digo\s+otp|otp|one[-\s]time\s+code)\b/i;
  return requestsCode.test(text) || fillsCode.test(text) || confirmsCode.test(text);
}

export function jiraRefersToAddedRow(...descriptions: Array<string | undefined>): boolean {
  return JIRA_ADDED_ROW_WORDING.test(normalizeJiraRowWording(...descriptions));
}

/** True when a click target reads as an add-row action; only then are row identities observed around the click. */
export function jiraIsAddRowAction(target: string): boolean {
  return JIRA_ADD_ROW_ACTION.test(normalizeJiraRowWording(target));
}

// Serializable snapshot only (keys + uniqueness); no functions on window.
type JiraRowSnapshot = { seen: string[]; unique: boolean; added?: string };
const JIRA_ROW_ATTRIBUTES = ["id", "name", "data-row-id", "data-row-key", "data-key"];

/**
 * Remember the structural identity of every data row in any table/grid. A row key is the sorted
 * id/name/data-row-* values of the row and its descendants, so it survives a re-render that
 * replaces every row node. Missing or duplicate keys are recorded as unproven identity.
 * Row keys are computed inline in each browser callback: a shared nested arrow would be wrapped
 * with `__name` by the TSX transform, which does not exist in the page.
 */
export async function snapshotJiraRows(page: Page): Promise<void> {
  await page.evaluate(([selector, attribute, attributes]) => {
    document.querySelectorAll(`[${attribute}]`).forEach(element => element.removeAttribute(attribute));
    const keys = Array.from(document.querySelectorAll(selector)).filter(row => row.querySelector("td, [role='gridcell']")).map(row =>
      Array.from(new Set([row, ...Array.from(row.querySelectorAll("*"))].flatMap(element =>
        attributes.map(name => element.getAttribute(name) ? `${name}=${element.getAttribute(name)}` : "").filter(Boolean)))).sort().join("|"));
    (window as typeof window & { __qaJiraRows?: JiraRowSnapshot }).__qaJiraRows =
      { seen: keys, unique: keys.every(Boolean) && new Set(keys).size === keys.length };
  }, [JIRA_ROW_SELECTOR, JIRA_ADDED_ROW_ATTRIBUTE, JIRA_ROW_ATTRIBUTES] as [string, string, string[]]);
}

/**
 * After an add-row click, mark the one data row whose structural identity was not in the snapshot.
 * Waits (default Playwright timeout) for a new identity, then reads once; no sleeps.
 * True only when snapshot and current identities are unique and exactly one row is new;
 * anything else proves no identity, so callers must fail closed.
 */
export async function markJiraAddedRow(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(([selector, attributes]) => {
      const observer = (window as typeof window & { __qaJiraRows?: JiraRowSnapshot }).__qaJiraRows;
      if (!observer) return false;
      return Array.from(document.querySelectorAll(selector)).filter(row => row.querySelector("td, [role='gridcell']")).some(row =>
        !observer.seen.includes(Array.from(new Set([row, ...Array.from(row.querySelectorAll("*"))].flatMap(element =>
          attributes.map(name => element.getAttribute(name) ? `${name}=${element.getAttribute(name)}` : "").filter(Boolean)))).sort().join("|")));
    }, [JIRA_ROW_SELECTOR, JIRA_ROW_ATTRIBUTES] as [string, string[]]);
  } catch {
    return false;
  }
  return page.evaluate(([selector, attribute, attributes]) => {
    document.querySelectorAll(`[${attribute}]`).forEach(element => element.removeAttribute(attribute));
    const observer = (window as typeof window & { __qaJiraRows?: JiraRowSnapshot }).__qaJiraRows;
    if (!observer) return false;
    const rows = Array.from(document.querySelectorAll(selector)).filter(row => row.querySelector("td, [role='gridcell']"));
    const keys = rows.map(row => Array.from(new Set([row, ...Array.from(row.querySelectorAll("*"))].flatMap(element =>
      attributes.map(name => element.getAttribute(name) ? `${name}=${element.getAttribute(name)}` : "").filter(Boolean)))).sort().join("|"));
    const unique = keys.every(Boolean) && new Set(keys).size === keys.length;
    const added = rows.filter((_, index) => !observer.seen.includes(keys[index]));
    if (!observer.unique || !unique || added.length !== 1) return false;
    added[0].setAttribute(attribute, "");
    observer.added = keys[rows.indexOf(added[0])];
    return true;
  }, [JIRA_ROW_SELECTOR, JIRA_ADDED_ROW_ATTRIBUTE, JIRA_ROW_ATTRIBUTES] as [string, string, string[]]);
}

/**
 * Re-identify the added row after any re-render: the identity observed at the add click lives in
 * page memory, and the DOM marker is re-applied to the one current row whose observed id/name/data-row-*
 * tokens still include all of it. Zero or several matches (identity lost or duplicated) return undefined.
 */
export async function relocateJiraAddedRow(page: Page): Promise<Locator | undefined> {
  const found = await page.evaluate(([selector, attribute, attributes]) => {
    document.querySelectorAll(`[${attribute}]`).forEach(element => element.removeAttribute(attribute));
    const observer = (window as typeof window & { __qaJiraRows?: JiraRowSnapshot }).__qaJiraRows;
    if (!observer?.added) return false;
    const wanted = observer.added.split("|");
    const matches = Array.from(document.querySelectorAll(selector)).filter(row => row.querySelector("td, [role='gridcell']")).filter(row => {
      const tokens = new Set([row, ...Array.from(row.querySelectorAll("*"))].flatMap(element =>
        attributes.map(name => element.getAttribute(name) ? `${name}=${element.getAttribute(name)}` : "").filter(Boolean)));
      return wanted.every(token => tokens.has(token));
    });
    if (matches.length !== 1) return false;
    matches[0].setAttribute(attribute, "");
    return true;
  }, [JIRA_ROW_SELECTOR, JIRA_ADDED_ROW_ATTRIBUTE, JIRA_ROW_ATTRIBUTES] as [string, string, string[]]).catch(() => false);
  return found ? page.locator(`[${JIRA_ADDED_ROW_ATTRIBUTE}]`) : undefined;
}

async function resolveJiraAddedRowControl(addedRow: Locator | undefined, target: string, kind: "fill" | "selection"): Promise<TargetResolutionResult> {
  const row = addedRow && await addedRow.count().catch(() => 0) === 1 && await addedRow.isVisible().catch(() => false) ? addedRow : undefined;
  // Prose may say "enter" for a choice; act() reclassifies a resolved combobox to select.
  const control = row ? await resolveJiraControlInRow(row, target, kind)
    ?? (kind === "fill" ? await resolveJiraControlInRow(row, target, "selection") ?? await resolveJiraControlInRowBySharedLabelToken(row, target) : undefined) : undefined;
  return control
    ? { status: "resolved", target, locator: control, locatorStrategy: JIRA_ADDED_ROW_STRATEGY, confidence: 1,
      matchReason: "unique_control_in_observed_added_row", candidateText: target, candidates: [] }
    : { status: "ambiguous", target, confidence: 0, matchReason: row ? "added_row_control_not_unique" : "added_row_identity_unproven", candidateText: target, candidates: [] };
}

/** True only when the control sits in the explicitly requested (1-based) data row of its table/grid. */
export async function jiraControlInExplicitRow(control: Locator, rowScope: number): Promise<boolean> {
  return control.evaluate((element, scope) => {
    const row = element.closest("tr, [role='row']");
    const container = row?.parentElement?.closest("table, [role='grid']");
    if (!row || !container) return false;
    const rows = Array.from(container.querySelectorAll("tbody tr, [role='row']"))
      .filter(candidate => candidate.querySelector("td, th, [role='gridcell']"));
    return rows[scope - 1] === row;
  }, rowScope).catch(() => false);
}

function jiraExplicitEntityQualifier(semanticContext: string | undefined): { entity: string; ordinal: number } | undefined {
  const context = semanticContext?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  if (!context) return undefined;
  const entities = "fila|row|referencia|reference|elemento|item|beneficiario|beneficiary|cuenta|account";
  const numeric = context.match(new RegExp(`\\b(${entities})\\s*(\\d+)\\b`));
  if (numeric) return { entity: numeric[1], ordinal: Number(numeric[2]) };
  const ordinal = context.match(new RegExp(`\\b(primera|primer|segunda|segundo|tercera|tercer|cuarta|cuarto|quinta|quinto|first|second|third|fourth|fifth)\\s+(${entities})\\b`));
  if (!ordinal) return undefined;
  const ordinalNumber: Record<string, number> = { primera: 1, primer: 1, segunda: 2, segundo: 2, tercera: 3, tercer: 3,
    cuarta: 4, cuarto: 4, quinta: 5, quinto: 5, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  return { entity: ordinal[2], ordinal: ordinalNumber[ordinal[1]] };
}

async function resolveJiraContextualFillField(page: Page, target: string, semanticContext?: string) {
  const qualifier = jiraExplicitEntityQualifier(semanticContext);
  if (!qualifier) return undefined;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const accessibleName = new RegExp(`(?=.*${escape(target)})(?=.*${escape(qualifier.entity)})(?=.*\\b${qualifier.ordinal}\\b)`, "i");
  const candidates: Locator[] = [];
  for (const role of ["textbox", "spinbutton"] as const) {
    const controls = page.getByRole(role, { name: accessibleName });
    for (let index = 0; index < await controls.count().catch(() => 0); index += 1) {
      const control = controls.nth(index);
      if (await control.isVisible().catch(() => false) && await control.isEnabled().catch(() => false)
        && await control.isEditable().catch(() => false)) candidates.push(control);
    }
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

async function resolveJiraContextualSelectionField(page: Page, target: string, semanticContext?: string) {
  const qualifier = jiraExplicitEntityQualifier(semanticContext);
  if (!qualifier) return undefined;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const accessibleName = new RegExp(`(?=.*${escape(target)})(?=.*${escape(qualifier.entity)})(?=.*\\b${qualifier.ordinal}\\b)`, "i");
  const controls = page.getByRole("combobox", { name: accessibleName });
  const candidates: Locator[] = [];
  for (let index = 0; index < await controls.count().catch(() => 0); index += 1) {
    const control = controls.nth(index);
    if (await control.isVisible().catch(() => false) && await control.isEnabled().catch(() => false)) candidates.push(control);
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

async function resolveJiraFillTargetWhenReady(page: Page, target: string, semanticContext?: string) {
  const rowScope = jiraExplicitRowScope(semanticContext, target);
  const gridContext = rowScope === undefined ? {} : { rowScope };
  const contextualField = rowScope === undefined ? await resolveJiraContextualFillField(page, target, semanticContext) : undefined;
  if (contextualField) return { status: "resolved" as const, target, locator: contextualField, locatorStrategy: "jira_contextual_accessible_field",
    confidence: 1, matchReason: "explicit_entity_qualifier_matches_unique_accessible_field", candidateText: target, candidates: [] };
  // Spatial label matching has no row authority. For explicit repeated-row
  // targets, defer to the table resolver so it cannot silently fill row one.
  const observedField = rowScope === undefined ? await resolveJiraObservedFillField(page, target) : undefined;
  if (observedField) return { status: "resolved" as const, target, locator: observedField, locatorStrategy: "jira_observed_fill_field",
    confidence: 1, matchReason: "jira_observed_fill_field", candidateText: target, candidates: [] };
  const result = await resolveFillTarget(page, await scanCurrentPage(page), target, undefined, gridContext);
  if (rowScope !== undefined && result.status !== "resolved") {
    const rowControl = await resolveJiraRowScopedControl(page, target, rowScope, "fill");
    if (rowControl) return { status: "resolved" as const, target, locator: rowControl, locatorStrategy: "jira_explicit_row_accessible_control",
      confidence: 1, matchReason: "explicit_row_accessible_fill_control", candidateText: target, candidates: [] };
  }
  if (result.status === "resolved" || !["not_editable", "fill_target_not_editable"].includes(result.status)) return result;

  // Jira pages can temporarily disable form controls while an async challenge (for
  // example, sending an SMS code) is being prepared. Wait for the editability signal
  // only when a real textbox uniquely carries the target name. A button or other
  // action candidate is never a textbox, so it is not waited on: return immediately
  // so the caller can try the observed-editable fallback.
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const field = page.getByRole("textbox", { name: new RegExp(escaped, "i") });
  if (await field.count() !== 1) return result;
  const editable = await expect(field).toBeEditable().then(() => true, () => false);
  return editable ? await resolveFillTarget(page, await scanCurrentPage(page), target, undefined, gridContext) : result;
}

export function jiraExplicitRowScope(...descriptions: Array<string | undefined>): number | undefined {
  const text = descriptions.filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const numericRow = text.match(/\b(?:fila|row)\s*(\d+)\b/);
  const numericValue = numericRow ? Number(numericRow[1]) : undefined;
  if (Number.isInteger(numericValue) && numericValue! > 0) return numericValue;

  const ordinalValues: Record<string, number> = {
    primera: 1, primer: 1, primero: 1, first: 1,
    segunda: 2, segundo: 2, second: 2,
    tercera: 3, tercer: 3, tercero: 3, third: 3,
    cuarta: 4, cuarto: 4, fourth: 4,
    quinta: 5, quinto: 5, fifth: 5,
    sexta: 6, sexto: 6, sixth: 6,
    septima: 7, septimo: 7, seventh: 7,
    octava: 8, octavo: 8, eighth: 8,
    novena: 9, noveno: 9, ninth: 9,
    decima: 10, decimo: 10, tenth: 10,
  };
  const ordinal = Object.keys(ordinalValues).find(value =>
    new RegExp(`\\b${value}\\s+(?:fila|row)\\b|\\b(?:fila|row)\\s+${value}\\b`).test(text));
  return ordinal ? ordinalValues[ordinal] : undefined;
}

function normalizeJiraOptionText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ")
    .split(" ").filter(token => !["de", "del", "la", "el", "los", "las"].includes(token)).join(" ");
}

function singularizeSpanishAssertionWord(word: string): string {
  if (word.length > 5 && word.endsWith("ces")) return `${word.slice(0, -3)}z`;
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function assertionInfinitiveSpanishWord(word: string): string {
  return word.endsWith("cion") && word.length > 5 ? `${word.slice(0, -4)}r` : word;
}

function isVisibleDateTimeEvidence(text: string): boolean {
  const hasDate = /\b(?:\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+de?\s*\d{4})\b/i.test(text);
  const hasTime = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?\b/i.test(text);
  return hasDate && hasTime;
}

function isJiraReferenceValue(text: string): boolean {
  const value = text.trim();
  return /\d{4,}/.test(value) || /\b[A-Z]{2,}[A-Z0-9-]{5,}\b/.test(value);
}

function hasJiraReferenceEvidence(text: string): boolean {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const label = lines[index].match(/\breferencia\b\s*(?:de\s+(?:la\s+)?(?:operaci[oó]n|transacci[oó]n)\s*)?(?:#|:|-)?\s*(.*)$/i);
    if (!label) continue;
    if (isJiraReferenceValue(label[1])) return true;
    for (const valueLine of lines.slice(index + 1, index + 3)) {
      if (isJiraReferenceValue(valueLine)) return true;
      if (/\b(?:fecha|hora|monto|cuenta|comprobante|transacci[oó]n exitosa)\b/i.test(valueLine)) break;
    }
  }
  return false;
}

function jiraAssertionTextMatches(observed: string, expected: string): boolean {
  const actual = normalizeJiraOptionText(observed);
  const normalizedExpected = normalizeJiraOptionText(stripJiraNotificationChannelWord(expected));
  const singularExpected = normalizedExpected.split(" ").map(singularizeSpanishAssertionWord).join(" ");
  const infinitiveExpected = normalizedExpected.split(" ").map(assertionInfinitiveSpanishWord).join(" ");
  const exactTextMatch = [normalizedExpected, singularExpected, infinitiveExpected].some(variant =>
    actual === variant || actual.startsWith(`${variant} `));
  const expectedTokens = normalizedExpected.split(" ").filter(Boolean);
  const actualTokens = actual.split(" ").filter(Boolean);
  const containsCompactPhrase = expectedTokens.length > 0 && expectedTokens.length <= 5
    && actualTokens.length <= 80
    && actualTokens.some((_token, start) => expectedTokens.every((expectedToken, offset) => {
      const observedToken = actualTokens[start + offset];
      return observedToken !== undefined
        && (observedToken === expectedToken
          || singularizeSpanishAssertionWord(observedToken) === singularizeSpanishAssertionWord(expectedToken));
    }));
  return exactTextMatch || containsCompactPhrase || jiraCredentialRejectionMatches(observed, expected);
}

function jiraScreenDescriptorMatches(observed: string, expected: string): boolean {
  if (!/^\s*(?:pantalla\s+de|screen\s+of)\s+/i.test(expected)) return false;
  const subject = expected.replace(/^\s*(?:pantalla\s+de|screen\s+of)\s+/i, "");
  const expectedTokens = normalizeJiraOptionText(subject).split(" ").filter(token => token.length > 2
    && !["visible", "mostrado", "mostrada", "identificable"].includes(token));
  if (expectedTokens.length < 2) return false;
  // A screen assertion must match a compact visible title/label, not an ancestor
  // container whose unrelated prose happens to contain the requested words.
  const actualTokens = normalizeJiraOptionText(observed).split(" ").filter(Boolean);
  if (actualTokens.length < 2 || actualTokens.length > expectedTokens.length + 2) return false;
  const meaningfulActual = actualTokens.filter(token => !["la", "el", "los", "las", "de", "del", "para", "por"].includes(token));
  const meaningfulExpected = expectedTokens.filter(token => !["la", "el", "los", "las", "de", "del", "para", "por"].includes(token));
  if (meaningfulActual.length !== meaningfulExpected.length) return false;
  return meaningfulExpected.every((token, index) => {
    const actual = meaningfulActual[index];
    return actual === token || actual === singularizeSpanishAssertionWord(token)
      || singularizeSpanishAssertionWord(actual) === singularizeSpanishAssertionWord(token)
      || actual === assertionInfinitiveSpanishWord(token);
  });
}

function jiraScreenHeadingPrefixMatches(observed: string, expected: string): boolean {
  const expectedTokens = normalizeJiraOptionText(expected).split(" ").filter(token => token.length > 2
    && !["visible", "mostrado", "mostrada", "identificable"].includes(token));
  const actualTokens = normalizeJiraOptionText(observed).split(" ").filter(Boolean);
  if (!expectedTokens.length || !actualTokens.length || actualTokens.length > expectedTokens.length) return false;
  return actualTokens.every((token, index) => token === expectedTokens[index]
    || singularizeSpanishAssertionWord(token) === singularizeSpanishAssertionWord(expectedTokens[index])
    || token === assertionInfinitiveSpanishWord(expectedTokens[index]));
}

const jiraSelectionLabelByLocator = new WeakMap<Locator, string>();

async function resolveJiraObservedFillField(page: Page, target: string): Promise<Locator | undefined> {
  const normalizedTarget = normalizeJiraOptionText(target);
  const observed = await page.locator("body *").evaluateAll((elements, expected) => {
    const labels = elements.filter(element => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const normalized = element.innerText.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ").split(" ")
        .filter(token => !["de", "del", "la", "el", "los", "las"].includes(token)).join(" ");
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
        && rect.height <= 100 && normalized === expected;
    });
    const fields = elements.filter(element => {
      if (!(element instanceof HTMLElement) || !element.matches("input,textarea,[contenteditable='true']")) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
        && !(element as HTMLInputElement).disabled && !(element as HTMLInputElement).readOnly && !element.matches('[aria-disabled="true"]');
    });
    const scopedPairs = labels.flatMap(label => {
      let scope = label.parentElement;
      for (let depth = 0; scope && depth < 8; depth += 1, scope = scope.parentElement) {
        const scopedFields = fields.filter(field => scope!.contains(field));
        if (scopedFields.length === 1) return [{ label, field: scopedFields[0], score: depth }];
      }
      return [];
    });
    const spatialPairs = labels.flatMap(label => {
      const labelRect = label.getBoundingClientRect();
      const ranked = fields.map(field => {
        const rect = field.getBoundingClientRect();
        const verticalGap = rect.top - labelRect.bottom;
        const overlap = Math.max(0, Math.min(rect.right, labelRect.right) - Math.max(rect.left, labelRect.left));
        const horizontalDistance = overlap > 0 ? 0 : Math.min(Math.abs(rect.left - labelRect.right), Math.abs(labelRect.left - rect.right));
        return { field, score: verticalGap + horizontalDistance * 2, verticalGap, horizontalDistance };
      }).filter(item => item.verticalGap >= -40 && item.verticalGap <= 180 && item.horizontalDistance <= 600)
        .sort((a, b) => a.score - b.score);
      if (!ranked.length || (ranked[1] && ranked[1].score - ranked[0].score < 24)) return [];
      return [{ label, field: ranked[0].field, score: ranked[0].score }];
    });
    const pairs = scopedPairs.length ? scopedPairs : spatialPairs;
    const unique = pairs.filter(pair => pairs.filter(other => other.field === pair.field)
      .sort((a, b) => a.score - b.score)[0]?.label === pair.label);
    if (unique.length !== 1) return undefined;
    const field = unique[0].field as HTMLElement;
    return { index: Array.from(elements).indexOf(field), tag: field.tagName.toLowerCase(), labelText: (unique[0].label as HTMLElement).innerText.trim() };
  }, normalizedTarget);
  if (!observed) return undefined;
  const locator = page.locator("body *").nth(observed.index);
  if (await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) return undefined;
  const verified = await locator.evaluate((element, expected) => element.tagName.toLowerCase() === expected.tag
    && element.matches("input,textarea,[contenteditable='true']"), { tag: observed.tag });
  if (!verified) return undefined;
  jiraSelectionLabelByLocator.set(locator, observed.labelText);
  return locator;
}

/**
 * Semantic fallback for fill intents whose wording differs from the observed label
 * (e.g. "Código SMS" vs "Código de acceso"). Considers only visible, enabled,
 * editable input/textarea/contenteditable controls (never buttons) and accepts one
 * only when it is the single control whose label evidence shares a meaningful token
 * with the target. Zero or several plausible controls fail closed.
 */
async function resolveJiraSemanticEditableField(page: Page, target: string): Promise<Locator | undefined> {
  const targetTokens = normalizeJiraOptionText(target).split(" ").filter(token => token.length > 2);
  if (!targetTokens.length) return undefined;
  const observed = await page.locator("body *").evaluateAll((elements, expected) => {
    // No named inner functions: esbuild keepNames would emit an unserializable __name() call.
    const nonText = ["button", "submit", "reset", "checkbox", "radio", "file", "image", "hidden", "range", "color"];
    const plausible = elements.flatMap(element => {
      if (!(element instanceof HTMLElement) || !element.matches("input,textarea,[contenteditable='true']")) return [];
      if (element instanceof HTMLInputElement && nonText.includes(element.type)) return [];
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0
        || (element as HTMLInputElement).disabled || (element as HTMLInputElement).readOnly || element.matches('[aria-disabled="true"]')) return [];
      const labelledBy = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/)
        .map(id => document.getElementById(id)?.innerText ?? "").join(" ");
      const labels = Array.from((element as HTMLInputElement).labels ?? []).map(label => label.innerText).join(" ");
      const evidence = [element.getAttribute("aria-label"), labelledBy, labels, element.getAttribute("placeholder")].filter(Boolean).join(" ");
      const tokens = new Set(evidence.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es")
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(token => token.length > 2));
      if (!expected.some(token => tokens.has(token))) return [];
      // Durable observed identity only; no DOM position.
      return [{ id: element.id || undefined, testId: element.getAttribute("data-testid") || undefined,
        name: element.getAttribute("name") || undefined, ariaLabel: element.getAttribute("aria-label") || undefined,
        labelText: labels.replace(/\s+/g, " ").trim() || undefined }];
    });
    return plausible.length === 1 ? plausible[0] : undefined;
  }, targetTokens);
  if (!observed) return undefined;
  const candidates: Locator[] = [];
  if (observed.id) candidates.push(page.locator(`[id=${JSON.stringify(observed.id)}]`));
  if (observed.testId) candidates.push(page.getByTestId(observed.testId));
  if (observed.name) candidates.push(page.locator(`[name=${JSON.stringify(observed.name)}]`));
  if (observed.labelText) candidates.push(page.getByLabel(observed.labelText, { exact: true }));
  if (observed.ariaLabel) candidates.push(page.getByLabel(observed.ariaLabel, { exact: true }));
  for (const locator of candidates) {
    if (await locator.count() === 1 && await locator.isVisible() && await locator.isEnabled() && await locator.isEditable()) return locator;
  }
  return undefined;
}

function xpathStringLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map(part => `'${part}'`).join(`, "'", `)})`;
}

/** Resolve a semantic selection field from its observed label and nearest unique control. */
export async function resolveJiraSelectionField(page: Page, target: string): Promise<Locator | undefined> {
  const normalizedTarget = normalizeJiraOptionText(target);
  const observed = await page.locator("body *").evaluateAll((elements, expected) => {
    const labels = elements.filter(element => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = element.innerText.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ").split(" ")
        .filter(token => !["de", "del", "la", "el", "los", "las"].includes(token)).join(" ");
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 && text === expected;
    });
    // The observed field label and selector can be sibling containers in custom apps.
    const controls = elements.filter(element => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role")?.toLowerCase();
      const name = `${element.getAttribute("aria-label") ?? ""} ${element.innerText.trim()}`.toLocaleLowerCase();
      const actionable = ["select", "button", "a"].includes(tag) || ["combobox", "listbox", "button"].includes(role ?? "")
        || element.hasAttribute("aria-haspopup") || element.hasAttribute("onclick") || element.tabIndex >= 0
        || (style.cursor === "pointer" && style.pointerEvents !== "none");
      const selection = tag === "select" || role === "combobox" || role === "listbox" || element.hasAttribute("aria-haspopup")
        || /select|seleccion|seleccione|choose|pick/.test(name);
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
        && actionable && selection && !element.matches(':disabled,[aria-disabled="true"]')
        && !(tag === "button" && (element as HTMLButtonElement).type === "submit")
        && !Array.from(element.children).some(child => child instanceof HTMLElement && child.innerText.trim() === element.innerText.trim());
    });
    const spatialMatches = labels.flatMap(label => {
      const labelRect = label.getBoundingClientRect();
      const ranked = controls.map(control => {
        const rect = control.getBoundingClientRect();
        const verticalGap = rect.top - labelRect.bottom;
        const overlap = Math.max(0, Math.min(rect.right, labelRect.right) - Math.max(rect.left, labelRect.left));
        const horizontalDistance = overlap > 0 ? 0 : Math.min(Math.abs(rect.left - labelRect.right), Math.abs(labelRect.left - rect.right));
        return { control, score: verticalGap + horizontalDistance * 2, verticalGap, horizontalDistance };
      }).filter(item => item.verticalGap >= -8 && item.verticalGap <= 180 && item.horizontalDistance <= 80)
        .sort((a, b) => a.score - b.score);
      if (!ranked.length || (ranked[1] && ranked[1].score - ranked[0].score < 24)) return [];
      return [{ label, control: ranked[0].control, score: ranked[0].score }];
    });
    const uniquePairs = spatialMatches.filter(pair => spatialMatches.filter(other => other.control === pair.control)
      .sort((a, b) => a.score - b.score)[0]?.label === pair.label);
    if (uniquePairs.length !== 1) return undefined;
    const control = uniquePairs[0].control;
    return { id: control.id || undefined, testId: control.getAttribute("data-testid") || undefined,
      role: control.getAttribute("role") || (control.tagName.toLowerCase() === "button" ? "button" : control.tagName.toLowerCase() === "select" ? "combobox" : undefined),
      ariaLabel: control.getAttribute("aria-label") || control.getAttribute("title") || undefined,
      tag: control.tagName.toLowerCase(), text: (control as HTMLElement).innerText.trim(), labelText: (uniquePairs[0].label as HTMLElement).innerText.trim(), index: Array.from(elements).indexOf(control) };
  }, normalizedTarget);
  if (!observed) {
    const snapshot = await scanCurrentPage(page);
    const relevant = snapshot.elements.filter(element => element.visible
      && /cuenta\s*(?:de\s*)?origen|cuenta\s*(?:de\s*)?destino|seleccione\s+una\s+cuenta|select\s+an?\s+account/i.test(`${element.ariaLabel ?? ""} ${element.label ?? ""} ${element.text ?? ""}`))
      .map(element => `${element.type}/${element.tagName ?? "none"}:${(element.text ?? element.label ?? element.ariaLabel ?? "").replace(/\d/g, "•")}:owner=${Boolean(element.actionOwner)}:actionability=${element.actionability ?? "none"}:cursor=${element.cursor ?? "none"}:candidates=${element.candidateLocators.map(candidate => candidate.strategy).join("+") || "none"}:nearby=${(element.nearbyText ?? "").replace(/\d/g, "•")}`);
    console.log(`[jira-selection-field] observedLabelMatches=0 nearbySemanticControls=${relevant.join(",") || "none"}`);
    return undefined;
  }
  let locator: Locator;
  if (observed.id) locator = page.locator(`[id=${JSON.stringify(observed.id)}]`);
  else if (observed.testId) locator = page.getByTestId(observed.testId);
  else if (observed.role && (observed.ariaLabel || observed.text)) {
    locator = page.getByRole(observed.role as Parameters<Page["getByRole"]>[0], { name: observed.ariaLabel ?? observed.text, exact: true });
  } else if (observed.index !== undefined) locator = page.locator("body *").nth(observed.index);
  else if (observed.text) locator = page.locator(`${observed.tag}:visible:text-is(${JSON.stringify(observed.text)})`);
  else return undefined;
  const count = await locator.count();
  if (count !== 1 && observed.index !== undefined) locator = page.locator("body *").nth(observed.index);
  if (await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) return undefined;
  const verified = await locator.evaluate((element, expected) => element.tagName.toLowerCase() === expected.tag && (element as HTMLElement).innerText.trim() === expected.text,
    { tag: observed.tag, text: observed.text });
  if (verified && observed.labelText) jiraSelectionLabelByLocator.set(locator, observed.labelText);
  return verified ? locator : undefined;
}

/** Displayed selection state only: the aria-label names the field and must never confirm a choice. */
async function readJiraSelectionDisplay(field: Locator): Promise<string> {
  const text = (await field.innerText().catch(() => "")).trim();
  return text || await field.inputValue().catch(() => "");
}

/** A selection is confirmed only when the displayed state is a non-prompt text that matches the requested value. */
export function jiraSelectionDisplayConfirms(display: string, value: string): boolean {
  const normalized = normalizeJiraOptionText(display);
  const rawPrompt = /^\s*(?:--|-)/.test(display) || JIRA_PLACEHOLDER_OPTION_LABEL.test(normalized);
  return Boolean(normalized) && !rawPrompt && jiraOptionTextMatches(normalized, value);
}

/** Open an observed custom select, choose a matching option, and verify the field value. */
export async function selectJiraObservedOption(page: Page, field: Locator, value: string): Promise<void> {
  const query = normalizeJiraOptionText(value);
  if (!query) throw new Error("JIRA_SELECTION_VALUE_INVALID");
  const fieldKind = await field.evaluate(element => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role") ?? "none",
    hasPopup: element.getAttribute("aria-haspopup") ?? "none", expanded: element.getAttribute("aria-expanded") ?? "none",
    hasId: Boolean(element.id), hasTestId: Boolean(element.getAttribute("data-testid")),
    buttonType: element.tagName.toLowerCase() === "button" ? (element as HTMLButtonElement).type : "none",
    selectionPrompt: /select|seleccion|seleccione|choose|pick/.test(`${element.getAttribute("aria-label") ?? ""} ${(element as HTMLElement).innerText.trim()}`.toLocaleLowerCase()) }));
  console.log(`[jira-selection] opening observed field tag=${fieldKind.tag} role=${fieldKind.role} hasPopup=${fieldKind.hasPopup} expanded=${fieldKind.expanded} buttonType=${fieldKind.buttonType} selectionPrompt=${fieldKind.selectionPrompt} idPresent=${fieldKind.hasId} testIdPresent=${fieldKind.hasTestId}`);
  const explicitPopup = Boolean(`${await field.getAttribute("aria-controls") ?? ""} ${await field.getAttribute("aria-owns") ?? ""}`.trim());
  const visibleBeforeOpen = await page.evaluateHandle(() => new Set(Array.from(document.querySelectorAll("body *")).filter(element => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  })));
  try {
  try { await field.click(); } catch { throw new Error("JIRA_SELECTION_FIELD_OPEN_FAILED"); }
  const optionRoot = await jiraOptionSearchRoot(page, field);
  const popupCounts = { listboxes: await page.getByRole("listbox").count(), options: await page.getByRole("option").count(), menus: await page.getByRole("menu").count() };
  console.log(`[jira-selection] opened controls=listboxes:${popupCounts.listboxes},options:${popupCounts.options},menus:${popupCounts.menus}`);
  const deadline = Date.now() + 30000;
  let aiOptionAttempted = false;
  while (Date.now() < deadline) {
    const candidates = await optionRoot.locator("*").evaluateAll((elements, { expected, visibleBeforeOpen, explicitPopup }) => {
      const found: Array<{ id?: string; testId?: string; role?: string; label?: string; tag: string; text: string; key: string }> = [];
      const expectedTokenVariants = expected.split(" ").filter(Boolean).map(token => {
        const variants = [token];
        if (token.length > 5 && token.endsWith("ces")) variants.push(`${token.slice(0, -3)}z`);
        if (token.length > 4 && token.endsWith("es")) variants.push(token.slice(0, -2));
        if (token.length > 3 && token.endsWith("s")) variants.push(token.slice(0, -1));
        return variants;
      });
      for (const element of elements) {
        if (!(element instanceof HTMLElement)) continue;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const text = element.innerText.trim();
        const normalizedText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ").split(" ")
          .filter(token => !["de", "del", "la", "el", "los", "las"].includes(token)).join(" ");
        const candidateTokenVariants = normalizedText.split(" ").filter(Boolean).map(token => {
          const variants = [token];
          if (token.length > 5 && token.endsWith("ces")) variants.push(`${token.slice(0, -3)}z`);
          if (token.length > 4 && token.endsWith("es")) variants.push(token.slice(0, -2));
          if (token.length > 3 && token.endsWith("s")) variants.push(token.slice(0, -1));
          return variants;
        });
        if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0
          || !expectedTokenVariants.length || !expectedTokenVariants.every(expectedVariants =>
            candidateTokenVariants.some(candidateVariants => expectedVariants.some(token => candidateVariants.includes(token))))) continue;
        if (Array.from(element.children).some(child => {
          if (!(child instanceof HTMLElement)) return false;
          const childTokenVariants = child.innerText.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ").split(" ")
            .filter(token => !["de", "del", "la", "el", "los", "las"].includes(token)).map(token => {
              const variants = [token];
              if (token.length > 5 && token.endsWith("ces")) variants.push(`${token.slice(0, -3)}z`);
              if (token.length > 4 && token.endsWith("es")) variants.push(token.slice(0, -2));
              if (token.length > 3 && token.endsWith("s")) variants.push(token.slice(0, -1));
              return variants;
            });
          return expectedTokenVariants.every(expectedVariants => childTokenVariants.some(candidateVariants =>
            expectedVariants.some(token => candidateVariants.includes(token))));
        })) continue;
        let owner: HTMLElement | null = element;
        for (let depth = 0; owner && depth < 7; depth += 1, owner = owner.parentElement) {
          const tag = owner.tagName.toLowerCase();
          const role = owner.getAttribute("role")?.toLowerCase();
          const ownerStyle = window.getComputedStyle(owner);
          const actionable = ["button", "a", "option"].includes(tag) || ["option", "menuitem", "button"].includes(role ?? "")
            || owner.hasAttribute("onclick") || owner.tabIndex >= 0 || (ownerStyle.cursor === "pointer" && ownerStyle.pointerEvents !== "none");
          if (!actionable) continue;
          if (owner.closest('nav,aside,[role="navigation"],[role="complementary"]')) break;
          if (owner.closest('[aria-disabled="true"],[hidden]') || owner.matches(':disabled')) break;
          // Without a declared popup relation, only options revealed by opening
          // this field are eligible. A neighboring field's selected caption is
          // already visible and must never become an option for this field.
          if (!explicitPopup && visibleBeforeOpen.has(owner)) break;
          const ownerText = owner.innerText.trim();
          const id = owner.id || undefined;
          const testId = owner.getAttribute("data-testid") || undefined;
          const label = owner.getAttribute("aria-label") || ownerText;
          const key = id ? `id:${id}` : testId ? `testid:${testId}` : `${role ?? tag}:${label.toLocaleLowerCase()}`;
          found.push({ id, testId, role, label, tag, text: ownerText, key });
          break;
        }
      }
      return found.filter((candidate, index, all) => all.findIndex(other => other.key === candidate.key) === index);
      }, { expected: query, visibleBeforeOpen, explicitPopup });
    const candidate = chooseJiraMatchingOption(candidates, item => item.key, query);
    if (candidate) {
      console.log(`[jira-selection] policy=any_matching matchingOptions=${candidates.length}`);
      const option = candidate.id ? page.locator(`[id=${JSON.stringify(candidate.id)}]`)
        : candidate.testId ? page.getByTestId(candidate.testId)
        : candidate.role && candidate.label ? page.getByRole(candidate.role as Parameters<Page["getByRole"]>[0], { name: candidate.label, exact: true })
        : page.locator(`${candidate.tag}:visible:text-is(${JSON.stringify(candidate.text)})`);
      if (await option.count() !== 1 || !await option.isVisible() || !await option.isEnabled()) throw new Error("JIRA_SELECTION_OPTION_NOT_UNIQUE");
      try { await option.click(); } catch { throw new Error("JIRA_SELECTION_OPTION_CLICK_FAILED"); }
      if (!jiraSelectionDisplayConfirms(await readJiraSelectionDisplay(field), value)) throw new Error("JIRA_SELECTION_STATE_UNCONFIRMED");
      return;
    }
    if (candidates.length === 0 && !aiOptionAttempted) {
      aiOptionAttempted = true;
      const snapshot = await scanCurrentPage(page);
      const optionSnapshot = { ...snapshot, elements: snapshot.elements.filter(element => element.visible && !element.disabled
        && element.actionOwner === true && element.actionability !== "NON_ACTIONABLE"
        && (element.role === "option" || element.role === "menuitem" || element.tagName === "option")) };
      const selected = await chooseJiraDomTarget(page, value, optionSnapshot);
      const option = selected && locatorForJiraDomCandidate(page, selected);
      if (selected && option && await option.count() === 1 && await option.isVisible() && await option.isEnabled()
        && await jiraOptionBelongsToRoot(optionRoot, option)
        && (explicitPopup || !await option.evaluate((element, before) => before.has(element), visibleBeforeOpen))) {
        const before = normalizeJiraOptionText(await readJiraSelectionDisplay(field));
        try { await option.click(); } catch { throw new Error("JIRA_SELECTION_OPTION_CLICK_FAILED"); }
        const afterDisplay = await readJiraSelectionDisplay(field);
        if (normalizeJiraOptionText(afterDisplay) === before || !jiraSelectionDisplayConfirms(afterDisplay, selected.label)) {
          throw new Error("JIRA_SELECTION_STATE_UNCONFIRMED");
        }
        return;
      }
    }
    await page.waitForTimeout(300);
  }
  throw new Error("JIRA_SELECTION_OPTION_NOT_FOUND");
  } finally { await visibleBeforeOpen.dispose(); }
}

/** Bounded, label-free summary of a failed target resolution. Whitelist only: never copy candidate text/labels/values/URLs/selectors. */
export type JiraTargetFailureDiagnostic = {
  status: string; matchReason: string; candidateCount: number;
  candidates: Array<{ role?: string; tag?: string; hasIdentity: boolean }>;
};
const jiraSafeToken = (value: unknown, max = 32) => typeof value === "string" && value.length <= max && /^[a-z0-9_-]+$/i.test(value) ? value : undefined;
export class JiraTargetFailureError extends Error {
  constructor(code: string, readonly diagnostic: JiraTargetFailureDiagnostic) { super(code); }
}
export function jiraTargetFailure(result: TargetResolutionResult): JiraTargetFailureError {
  // One authoritative list: the views overlap, so never concatenate them.
  const pool = ([result.clickableCandidates, result.candidates, result.closestCandidates].find(list => list?.length) ?? []) as
    Array<{ role?: string; tagName?: string; elementId?: string; ariaLabel?: string; dataTestid?: string }>;
  const explicit = (result as { ambiguityDiagnostics?: { candidateCount?: unknown } }).ambiguityDiagnostics?.candidateCount;
  // Dynamic suffixes ("multiple_similar_candidates (N with score...)") reduce to the leading safe identifier.
  const reasonPrefix = typeof result.matchReason === "string" ? result.matchReason.match(/^[a-z0-9_-]+/i)?.[0] : undefined;
  return new JiraTargetFailureError(`JIRA_TARGET_${result.status.toUpperCase()}`, {
    status: result.status,
    matchReason: jiraSafeToken(reasonPrefix, 64) ?? "unspecified",
    candidateCount: typeof explicit === "number" && Number.isInteger(explicit) && explicit >= 0 ? explicit : pool.length,
    candidates: pool.slice(0, 5).map(c => ({ role: jiraSafeToken(c.role), tag: jiraSafeToken(c.tagName),
      hasIdentity: Boolean(c.elementId || c.ariaLabel || c.dataTestid) })),
  });
}

/** Result-field spread for the runner: only JiraTargetFailureError contributes; any other error yields {}. */
export function jiraTargetDiagnosticField(error: unknown): { targetDiagnostic?: JiraTargetFailureDiagnostic } {
  return error instanceof JiraTargetFailureError ? { targetDiagnostic: error.diagnostic } : {};
}

export async function resolveJiraActionTarget(page: Page, snapshot: Awaited<ReturnType<typeof scanCurrentPage>>, target: string): Promise<TargetResolutionResult> {
  // Jira stories describe user-facing actions semantically. When the page exposes
  // one exact accessible action, prefer that identity over the shared fuzzy resolver
  // (which can otherwise choose an unrelated clickable ancestor with similar text).
  // Ambiguity is fail-closed; it must not fall through to a fuzzy match.
  // Exact labelled state controls are valid user actions too. Include them in
  // the same fail-closed uniqueness check so a checkbox such as "Consultar
  // cuentas" wins over a fuzzy navigation match like "Cuentas".
  const actionRoles = ["button", "link", "menuitem", "tab", "checkbox", "radio", "switch"] as const;
  const exactActions: Array<{ locator: Locator; role: typeof actionRoles[number] }> = [];
  for (const role of actionRoles) {
    const matches = page.getByRole(role, { name: target, exact: true });
    for (let index = 0; index < await matches.count(); index += 1) {
      const locator = matches.nth(index);
      if (await locator.isVisible() && await locator.isEnabled()) exactActions.push({ locator, role });
    }
  }
  if (exactActions.length === 1) {
    const { locator, role } = exactActions[0];
    return { status: "resolved" as const, target, locator, locatorStrategy: "role", confidence: 1,
      matchReason: "jira_exact_accessible_action", candidateText: target, candidates: [],
      clickableCandidates: [{ text: target, normalizedText: normalizeJiraOptionText(target), type: role, role }] };
  }
  if (exactActions.length > 1) {
    return { status: "ambiguous" as const, target, confidence: 0, matchReason: "jira_exact_accessible_action_ambiguous",
      candidateText: target, candidates: [], clickableCandidates: exactActions.map(({ role }) => ({
        text: target, normalizedText: normalizeJiraOptionText(target), type: role, role,
      })) };
  }

  // A step can name the purpose of choosing a verification channel while the
  // observed control is labeled only with that channel (for example, "request
  // the code by SMS" -> the unique actionable "SMS" option). Resolve only when
  // the channel label is actually present and scanner evidence marks it actionable.
  const requestedChannel = target.match(/(?:solicitar|request|enviar|send|recibir|receive).*?(?:c[oó]digo|code|token).*?(?:por|via|v[ií]a)\s+(.+?)\s*$/i)?.[1]?.trim();
  if (requestedChannel) {
    const expectedChannel = normalizeJiraOptionText(requestedChannel);
    const observedChannels = snapshot.elements.filter(element => element.visible && !element.disabled
      && element.actionOwner === true && element.actionability !== "NON_ACTIONABLE"
      && [element.ariaLabel, element.label, element.text, element.title].some(label =>
        Boolean(label?.trim()) && normalizeJiraOptionText(label!) === expectedChannel));
    if (observedChannels.length === 1) {
      const element = observedChannels[0];
      for (const candidate of element.candidateLocators) {
        const locator = candidate.strategy === "role" && candidate.role && candidate.name
          ? page.getByRole(candidate.role as Parameters<Page["getByRole"]>[0], { name: candidate.name, exact: true })
          : candidate.strategy === "text" && candidate.value ? page.getByText(candidate.value, { exact: true })
          : candidate.strategy === "label" && candidate.value ? page.getByLabel(candidate.value, { exact: true })
          : candidate.strategy === "testId" && candidate.value ? page.getByTestId(candidate.value)
          : candidate.strategy === "css" && candidate.value ? page.locator(candidate.value) : undefined;
        if (!locator || await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) continue;
        return { status: "resolved", target, locator, locatorStrategy: `jira_observed_channel_${candidate.strategy}`,
          confidence: 1, matchReason: "jira_semantic_channel_matches_unique_observed_action",
          candidateText: element.ariaLabel || element.label || element.text || element.title || requestedChannel,
          candidates: [], clickableCandidates: [{ text: requestedChannel, normalizedText: expectedChannel,
            type: element.type, role: element.role }] };
      }
    }
    // Some application component libraries expose the channel text inside a
    // clickable custom owner that the page scanner cannot confidently classify
    // as an action. Resolve the exact observed channel label through the same
    // unique-visible-action path used for authored labels; do not fuzzy-match or
    // infer a control from the channel name alone.
    // A single scanner-classified owner can still lack a usable locator (for
    // example, custom components whose event owner wraps a plain text node).
    // Retry through the unique visible-action resolver in that case; duplicate
    // channel labels remain ambiguous and fail closed.
    if (observedChannels.length <= 1) {
      const observedAction = await resolveJiraActionTarget(page, snapshot, requestedChannel);
      if (observedAction.status === "resolved" && observedAction.locator) {
        return { ...observedAction, target,
          locatorStrategy: `jira_observed_channel_${observedAction.locatorStrategy}`,
          matchReason: "jira_semantic_channel_matches_unique_visible_action",
          candidateText: observedAction.candidateText || requestedChannel };
      }
    }
    // Match the spec runtime's UI-grounded custom-owner resolution for controls
    // whose visible label is nested inside a framework wrapper. The helper
    // requires one deepest visible actionable owner and rejects equal-depth
    // duplicates; it does not infer a selector from the Jira wording.
    const channelActionOwner = await uniqueVisibleActionOwner(page, requestedChannel);
    if (channelActionOwner) {
      return { status: "resolved", target, locator: channelActionOwner,
        locatorStrategy: "jira_unique_visible_channel_action_owner", confidence: 1,
        matchReason: "jira_semantic_channel_matches_unique_visible_action_owner",
        candidateText: requestedChannel, candidates: [],
        clickableCandidates: [{ text: requestedChannel, normalizedText: normalizeJiraOptionText(requestedChannel), type: "observed_action_owner" }] };
    }
  }

  const exactSnapshotActions = snapshot.elements.filter(element => element.visible && !element.disabled
    && element.actionOwner === true && element.actionability !== "NON_ACTIONABLE"
    && [element.ariaLabel, element.label, element.text, element.title].some(label =>
      Boolean(label?.trim()) && normalizeJiraOptionText(label!) === normalizeJiraOptionText(target)));
  if (exactSnapshotActions.length === 1) {
    const element = exactSnapshotActions[0];
    const candidates: Locator[] = [];
    if (element.domId) candidates.push(page.locator(`[id=${JSON.stringify(element.domId)}]`));
    if (element.dataTestid) candidates.push(page.getByTestId(element.dataTestid));
    for (const candidate of element.candidateLocators) {
      if (candidate.strategy === "role" && candidate.role && candidate.name) candidates.push(page.getByRole(candidate.role as Parameters<Page["getByRole"]>[0], { name: candidate.name, exact: true }));
      else if (candidate.strategy === "text" && candidate.value) candidates.push(page.getByText(candidate.value, { exact: true }));
      else if (candidate.strategy === "label" && candidate.value) candidates.push(page.getByLabel(candidate.value, { exact: true }));
      else if (candidate.strategy === "testId" && candidate.value) candidates.push(page.getByTestId(candidate.value));
      else if (candidate.strategy === "css" && candidate.value) candidates.push(page.locator(candidate.value));
    }
    for (const locator of candidates) {
      if (await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) continue;
      const text = await locator.evaluate(el => (el.getAttribute("aria-label") || el.textContent || "").trim());
      if (normalizeJiraOptionText(text) !== normalizeJiraOptionText(target)) continue;
      return { status: "resolved", target, locator, locatorStrategy: "exact_action_owner", confidence: 1,
        matchReason: "jira_exact_snapshot_action_owner", candidateText: text, candidateId: element.domId,
        candidates: [], clickableCandidates: [{ text, normalizedText: normalizeJiraOptionText(text), type: element.type, role: element.role }] };
    }
  }

  const exactText = page.getByText(target, { exact: true });
  const actionableTextMatches: Array<{ text: Locator; owner: { id?: string; testId?: string; role?: string; tag?: string; label?: string } }> = [];
  for (let index = 0; index < await exactText.count(); index += 1) {
    const candidate = exactText.nth(index);
    if (!await candidate.isVisible()) continue;
    const owner = await candidate.evaluate(element => {
      let current: HTMLElement | null = element as HTMLElement;
      for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
        const tag = current.tagName.toLowerCase();
        const role = current.getAttribute("role")?.toLowerCase();
        const style = window.getComputedStyle(current);
        if (["button", "a", "input"].includes(tag) || ["button", "link", "menuitem", "tab"].includes(role ?? "")
          || current.hasAttribute("onclick") || current.tabIndex >= 0 || (style.cursor === "pointer" && style.pointerEvents !== "none")) {
          return { id: current.id || undefined, testId: current.getAttribute("data-testid") || undefined, role: role || undefined, tag,
            label: current.getAttribute("aria-label") || current.innerText.trim() };
        }
      }
      return undefined;
    });
    if (owner) actionableTextMatches.push({ text: candidate, owner });
  }
  if (actionableTextMatches.length === 1) {
    const { text, owner } = actionableTextMatches[0];
    const ownerLocator = owner.id ? page.locator(`[id=${JSON.stringify(owner.id)}]`)
      : owner.testId ? page.getByTestId(owner.testId)
      : owner.role && owner.label === target ? page.getByRole(owner.role as Parameters<Page["getByRole"]>[0], { name: owner.label, exact: true })
      : owner.tag ? page.locator(`${owner.tag}:visible:text-is(${JSON.stringify(target)})`)
      : text;
    if (await ownerLocator.count() !== 1 || !await ownerLocator.isVisible() || !await ownerLocator.isEnabled()) {
      return { status: "not_found", target, confidence: 0, matchReason: "jira_exact_action_owner_not_durable", candidateText: target, candidates: [] };
    }
    const locator = ownerLocator;
    return { status: "resolved", target, locator, locatorStrategy: owner.id || (!owner.testId && !owner.role && owner.tag) ? "css" : owner.testId ? "testId" : "exact_action_text", confidence: 1,
      matchReason: "jira_exact_visible_action_text", candidateText: target, candidates: [],
      clickableCandidates: [{ text: target, normalizedText: normalizeJiraOptionText(target), type: "text" }] };
  }
  if (actionableTextMatches.length > 1) return { status: "ambiguous", target, confidence: 0,
    matchReason: "jira_exact_visible_action_text_ambiguous", candidateText: target, candidates: [],
    clickableCandidates: actionableTextMatches.map(() => ({ text: target, normalizedText: normalizeJiraOptionText(target), type: "text" })) };

  const forwardIntent = /^\s*(?:continuar|continue|siguiente|next|avanzar|proceed)\b/i.test(target);
  const forwardLabel = (label: string) => jiraForwardActionLabel(target,label);
  const keepForward = (result: TargetResolutionResult): TargetResolutionResult => forwardIntent && result.status === 'resolved' && !forwardLabel(result.candidateText ?? '')
    ? {...result,status:'not_found',locator:undefined,matchReason:'jira_forward_action_cannot_bind_unrelated_control'} : result;
  const exact = keepForward(await resolveActionTarget(page, snapshot, target, { actionType: "action_click" }));
  if (exact.status === "resolved") {
    const targetTokens = new Set(normalizeJiraOptionText(target).split(" ").filter(token => token.length > 2));
    const candidateTokens = normalizeJiraOptionText(exact.candidateText).split(" ").filter(token => token.length > 2);
    if (candidateTokens.some(token => targetTokens.has(token))) return exact;
    // Fail closed when fuzzy resolution would redirect a Jira action to a different
    // navigation entry. The caller may wait for the exact menu item to become visible.
    const primaryContinue = target.match(/^\s*(continuar|continue)\b/i)?.[1];
    if (!primaryContinue) return { ...exact, status: "not_found", locator: undefined, matchReason: "jira_fuzzy_target_has_no_label_overlap" };
    const continueTarget = keepForward(await resolveActionTarget(page, snapshot, primaryContinue, { actionType: "action_click" }));
    return continueTarget.status === "resolved" ? continueTarget : { ...exact, status: "not_found", locator: undefined,
      matchReason: "jira_fuzzy_target_has_no_label_overlap" };
  }

  // Human-authored Jira steps often describe why a person continues, while the UI
  // labels the unique CTA simply "Continuar". Retry that generic action label only
  // after the full semantic target failed; normal resolver uniqueness still applies.
  const primaryContinue = target.match(/^\s*(continuar|continue)\b/i)?.[1];
  if (!primaryContinue) return exact;
  return keepForward(await resolveActionTarget(page, snapshot, primaryContinue, { actionType: "action_click" }));
}

/** Login continuation can name an observed sign-in CTA, never a session-exit control. */
function jiraForwardActionLabel(target:string,label:string):boolean {
  if(/^(?:continuar|continue|siguiente|next|avanzar|proceed|revisar|review)\b/i.test(label.trim())) return true;
  return /\b(?:inicio|iniciar)\s+(?:de\s+)?sesi[oó]n\b|\b(?:sign[ -]?in|log[ -]?in|login)\b/i.test(target)
    && /^(?:iniciar\s+sesi[oó]n|sign[ -]?in|log[ -]?in|login)[.!]?$/i.test(label.trim());
}

async function resolveJiraActionTargetWithAi(page: Page, snapshot: Awaited<ReturnType<typeof scanCurrentPage>>, target: string, semanticContext?: string): Promise<TargetResolutionResult> {
  const deterministic = await resolveJiraActionTarget(page, snapshot, target);
  if (deterministic.status === "resolved") return deterministic;
  const forwardIntent = /^\s*(?:continuar|continue|siguiente|next|avanzar|proceed)\b/i.test(target);
  const candidatesSnapshot = forwardIntent ? {...snapshot,elements:snapshot.elements.filter(element=>
    jiraForwardActionLabel(target,element.ariaLabel || element.accessibleName || element.label || element.text || ''))} : snapshot;
  const selected = await chooseJiraDomTarget(page, semanticContext ? `${semanticContext}. Target: ${target}` : target, candidatesSnapshot);
  if (!selected) {
    // A generic “continue” action may be labeled as the next review stage.
    // Accept only one visible, enabled button whose observed accessible name
    // clearly signals forward progress; multiple candidates remain unresolved.
    if (/^(?:continuar|siguiente|avanzar|next|continue|proceed)$/i.test(target.trim())) {
      const forwardActions = page.getByRole("button", { name: /^(?:revisar|review|continuar|siguiente|avanzar|next|continue|proceed)(?:\b|\s)/i });
      const actionable: Locator[] = [];
      for (let index = 0; index < await forwardActions.count().catch(() => 0); index += 1) {
        const locator = forwardActions.nth(index);
        if (await locator.isVisible().catch(() => false) && await locator.isEnabled().catch(() => false)) actionable.push(locator);
      }
      if (actionable.length === 1) return { status: "resolved", target, locator: actionable[0], locatorStrategy: "jira_unique_observed_forward_action",
        confidence: 1, matchReason: "single_observed_forward_progress_button", candidateText: await actionable[0].innerText().catch(() => target), candidates: [] };
    }
    return deterministic;
  }
  const locator = locatorForJiraDomCandidate(page, selected);
  if (!locator || await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) return deterministic;
  return { status: "resolved", target, locator, locatorStrategy: `jira_ai_observed_${selected.locator.strategy}`,
    confidence: 0.85, matchReason: "jira_ai_selected_unique_observed_dom_candidate", candidateText: selected.label,
    candidateId: selected.id, candidates: [], clickableCandidates: [{ text: selected.label,
      normalizedText: normalizeJiraOptionText(selected.label), type: selected.tagName ?? "control", role: selected.role }] };
}

function jiraActionSnapshotSignature(snapshot: Awaited<ReturnType<typeof scanCurrentPage>>): string {
  const visibleSemantics = snapshot.elements.filter(element => element.visible)
    .map(({ type, text, label, placeholder, role, disabled, accessibleName, ariaLabel }) =>
      [type, text, label, placeholder, role, disabled, accessibleName, ariaLabel]
        .map(value => typeof value === "string" ? value.replace(/\d/g, "").replace(/\s+/g, " ").trim().slice(0, 160) : value));
  // Keep only a digest: screen text can include personal/account data and must
  // never be retained in logs. The broader semantic fingerprint notices a
  // screen transition even when its custom action is not classified as a button.
  return createHash("sha256").update(JSON.stringify(visibleSemantics)).digest("hex");
}

async function waitForJiraDomMutation(page: Page, timeoutMs: number): Promise<boolean> {
  try {
    return await page.waitForFunction((timeout) => new Promise<boolean>(resolve => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve(true);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      window.setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeout);
    }), timeoutMs, { timeout: timeoutMs + 250 }).then(handle => handle.jsonValue());
  } catch {
    // Navigation can replace the observed document while the next screen loads.
    return true;
  }
}

const JIRA_TEXT_INPUT_FOR_SELECT_REASON = "unique_observed_text_input_for_select_instruction";
const JIRA_CHOICE_CONTROL_REASON = "unique_observed_labelled_checkbox_or_radio";

export async function resolveJiraStepTarget(page: Page, step: ExecutionPlanStep, target: string,
  snapshot: Awaited<ReturnType<typeof scanCurrentPage>>, semanticContext?: string, addedRow?: Locator): Promise<TargetResolutionResult> {
  // "Added/new row" has no numeric authority: it is valid only against the row
  // identity observed around an add-row click, never nth/last/coordinates.
  if ((step.action === "fill" || step.action === "select")
    && jiraExplicitRowScope(semanticContext, step.description, target) === undefined
    && jiraRefersToAddedRow(semanticContext, step.description)) {
    return resolveJiraAddedRowControl(addedRow, target, step.action === "select" ? "selection" : "fill");
  }
  if (step.action === "fill" || step.action === "press") {
    const fill = step.action === "fill" ? await resolveJiraFillTargetWhenReady(page, target, semanticContext) : await resolveFillTarget(page, snapshot, target);
    if (step.action === "fill" && fill.status !== "resolved"
      && jiraExplicitRowScope(semanticContext, step.description, target) === undefined) {
      const semanticField = await resolveJiraSemanticEditableField(page, target);
      if (semanticField) return { status: "resolved", target, locator: semanticField, locatorStrategy: "jira_semantic_editable_field",
        confidence: 0.9, matchReason: "unique_observed_editable_field_shares_target_label_token", candidateText: target, candidates: [] };
    }
    if (step.action === "fill" && fill.status !== "resolved") {
      // For vague business wording, let the configured DOM chooser select only
      // an observed editable control. It cannot synthesize locators or target
      // buttons, selects, or arbitrary page text for a fill action.
      const selected = await chooseJiraDomTarget(page, target, snapshot, "editable");
      if (selected?.tagName && ["input", "textarea"].includes(selected.tagName)
        || selected?.role === "textbox" || selected?.role === "searchbox") {
        const locator = locatorForJiraDomCandidate(page, selected!);
        if (locator && await locator.count() === 1 && await locator.isVisible() && await locator.isEnabled()
          && await locator.isEditable()) {
          return { status: "resolved", target, locator, locatorStrategy: `jira_ai_observed_fill_${selected!.locator.strategy}`,
            confidence: 0.85, matchReason: "jira_ai_selected_unique_observed_editable_dom_candidate", candidateText: selected!.label, candidateId: selected!.id, candidates: [] };
        }
      }
    }
    const status: TargetResolutionResult["status"] = fill.status === "resolved" ? "resolved"
      : fill.status === "ambiguous" ? "ambiguous" : "not_found";
    return { status, target, locator: fill.locator, locatorStrategy: fill.locatorStrategy, confidence: fill.confidence,
      matchReason: fill.matchReason, candidateText: fill.candidateText ?? target, candidates: [] };
  }
  if (step.action === "select") {
    const rowScope = jiraExplicitRowScope(semanticContext, step.description, target);
    if (rowScope !== undefined) {
      const gridSelection = await resolveGridEditor(page, target, { rowScope }, { controlKind: "selection" });
      if (gridSelection.locator && await gridSelection.locator.count() === 1
        && await gridSelection.locator.isVisible() && await gridSelection.locator.isEnabled()) {
        return { status: "resolved", target, locator: gridSelection.locator, locatorStrategy: gridSelection.strategy ?? "jira_repeated_row_selection",
          confidence: 1, matchReason: "explicit_repeated_row_selection_control", candidateText: target, candidates: [] };
      }
      const rowControl = await resolveJiraRowScopedControl(page, target, rowScope, "selection");
      if (rowControl) return { status: "resolved", target, locator: rowControl, locatorStrategy: "jira_explicit_row_accessible_control",
        confidence: 1, matchReason: "explicit_row_accessible_selection_control", candidateText: target, candidates: [] };
    }
    // Fallbacks below have no row authority: with an explicit row they may only
    // return a control proven to live in that row, otherwise fail closed.
    const inRequestedRow = async (control: Locator) => rowScope === undefined || await jiraControlInExplicitRow(control, rowScope);
    const contextualSelection = rowScope === undefined ? await resolveJiraContextualSelectionField(page, target, semanticContext) : undefined;
    if (contextualSelection) return { status: "resolved", target, locator: contextualSelection, locatorStrategy: "jira_contextual_accessible_selection",
      confidence: 1, matchReason: "explicit_entity_qualifier_matches_unique_accessible_selection", candidateText: target, candidates: [] };
    const native = page.getByRole("combobox", { name: target, exact: true });
    if (await native.count() === 1 && await native.isVisible() && await inRequestedRow(native)) {
      return { status: "resolved", target, locator: native, locatorStrategy: "role", confidence: 1,
        matchReason: "unique_native_select", candidateText: target, candidates: [] };
    }
    const range = page.getByRole("slider", { name: new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
    if (await range.count() === 1 && await range.isVisible() && await range.isEnabled() && await inRequestedRow(range)) {
      return { status: "resolved", target, locator: range, locatorStrategy: "role", confidence: 1,
        matchReason: "unique_observed_range_control", candidateText: target, candidates: [] };
    }
    // A labelled checkbox/radio is selectable by accessible name: exactly one
    // visible, enabled match across both roles, otherwise fail closed.
    const choiceControls = page.locator("input[type=checkbox],input[type=radio],[role=checkbox],[role=radio]");
    const choice = choiceControls.and(page.getByRole("checkbox", { name: target, exact: true }))
      .or(choiceControls.and(page.getByRole("radio", { name: target, exact: true })));
    if (await choice.count() === 1 && await choice.isVisible() && await choice.isEnabled() && await inRequestedRow(choice)) {
      return { status: "resolved", target, locator: choice, locatorStrategy: "role", confidence: 1,
        matchReason: JIRA_CHOICE_CONTROL_REASON, candidateText: target, candidates: [] };
    }
    const observed = await resolveJiraSelectionField(page, target);
    if (observed && await inRequestedRow(observed)) return { status: "resolved", target, locator: observed, locatorStrategy: "jira_observed_selection_field", confidence: 1,
      matchReason: "jira_observed_selection_field", candidateText: target, candidates: [] };
    // Generated prose can say "select" for a control the live DOM proves is a
    // plain text input. Accept only a unique exact-name, visible, enabled,
    // editable textbox; `act` then reclassifies the step as fill.
    const textInput = page.getByRole("textbox", { name: target, exact: true });
    if (await textInput.count() === 1 && await textInput.isVisible() && await textInput.isEnabled() && await textInput.isEditable() && await inRequestedRow(textInput)) {
      return { status: "resolved", target, locator: textInput, locatorStrategy: "role", confidence: 1,
        matchReason: JIRA_TEXT_INPUT_FOR_SELECT_REASON, candidateText: target, candidates: [] };
    }
    // When authored wording omits part of a repeated row label, use AI only to
    // choose an observed select/combobox from this live DOM snapshot. The AI
    // cannot invent a selector or turn a non-selection control into an input.
    const selectionIntent = semanticContext ? `${semanticContext}. Target: ${target}` : target;
    const selected = await chooseJiraDomTarget(page, selectionIntent, snapshot, "selection");
    if (selected && (selected.tagName === "select" || selected.role === "combobox")) {
      const locator = locatorForJiraDomCandidate(page, selected);
      if (locator && await locator.count() === 1 && await locator.isVisible() && await locator.isEnabled() && await inRequestedRow(locator)) {
        return { status: "resolved", target, locator, locatorStrategy: `jira_ai_observed_${selected.locator.strategy}`, confidence: 0.85,
          matchReason: "jira_ai_selected_unique_observed_selection_dom_candidate", candidateText: selected.label, candidateId: selected.id, candidates: [] };
      }
    }
    return { status: "not_found", target, confidence: 0, matchReason: "jira_observed_selection_field_not_found", candidateText: target, candidates: [] };
  }
  return resolveJiraActionTargetWithAi(page, snapshot, target, semanticContext);
}

/**
 * SPA navigation often renders the next form only after an asynchronous request.
 * Keep the next action's semantic target unchanged and wait for observed DOM
 * mutations before failing; this supports click -> fill/select as well as click -> click.
 */
export async function resolveJiraStepTargetAfterClick(page: Page, step: ExecutionPlanStep, target: string,
  initialSnapshot: Awaited<ReturnType<typeof scanCurrentPage>>, semanticContext?: string, addedRow?: Locator): Promise<TargetResolutionResult> {
  let snapshot = initialSnapshot;
  let result = await resolveJiraStepTarget(page, step, target, snapshot, semanticContext, addedRow);
  if (result.status !== "not_found" || !["click", "fill", "select", "press"].includes(step.action)) return result;

  const deadline = Date.now() + 90000;
  // Re-scan before installing the observer so a fast render that completed
  // between the caller's snapshot and this wait cannot be missed.
  snapshot = await scanCurrentPage(page);
  result = await resolveJiraStepTarget(page, step, target, snapshot, semanticContext, addedRow);
  let signature = jiraActionSnapshotSignature(snapshot);
  while (Date.now() < deadline && result.status === "not_found") {
    // A bounded observer wait plus periodic scans handles both DOM mutations and
    // render timing races without making another AI call when nothing changed.
    await waitForJiraDomMutation(page, Math.min(500, Math.max(1, deadline - Date.now())));
    snapshot = await scanCurrentPage(page);
    const nextSignature = jiraActionSnapshotSignature(snapshot);
    if (nextSignature === signature) continue;
    signature = nextSignature;
    result = await resolveJiraStepTarget(page, step, target, snapshot, semanticContext, addedRow);
  }
  if (result.status === "not_found") {
    snapshot = await scanCurrentPage(page);
    result = await resolveJiraStepTarget(page, step, target, snapshot, semanticContext, addedRow);
  }
  return result;
}

const JIRA_PLACEHOLDER_OPTION_LABEL = /^(?:(?:selecciona|seleccione|seleccionar|select|choose|elige|elija)\b|--|\-)/;

/** Choose any observed native option that satisfies every requested criterion. */
export function resolveJiraNativeOption(options: JiraNativeOption[], desired: string, allowFirstAvailableFallback = false): JiraNativeOption | undefined {
  // A prompt option ("Select a frequency") is never a requested choice, even when
  // its words overlap the request; the runtime-bound value must hit a real option.
  const isPrompt = (option: JiraNativeOption) => !normalizeJiraOptionText(option.value) && JIRA_PLACEHOLDER_OPTION_LABEL.test(normalizeJiraOptionText(option.label));
  const matches = allowFirstAvailableFallback ? [] : options.filter(option => !isPrompt(option) && jiraOptionTextMatches(`${option.label} ${option.value}`, desired));
  const wanted = normalizeJiraOptionText(desired);
  const exact = matches.filter(option => normalizeJiraOptionText(option.label) === wanted || normalizeJiraOptionText(option.value) === wanted);
  const match = chooseJiraMatchingOption(exact.length === 1 ? exact : matches, option => `${option.value}\0${option.label}`, desired);
  if (match || !allowFirstAvailableFallback) return match;
  return options.find(option => {
    const label = normalizeJiraOptionText(option.label);
    const value = normalizeJiraOptionText(option.value);
    return Boolean(value || label)
      && !JIRA_PLACEHOLDER_OPTION_LABEL.test(label)
      && !/^(?:placeholder|none|null|undefined)$/.test(value);
  });
}

function isGenericJiraTestDataPlaceholder(value: string): boolean {
  const normalized = normalizeJiraOptionText(value);
  return /^(?:dato de prueba|dato ficticio de prueba|valor de prueba|test data|sample test data|test value)$/.test(normalized);
}

async function resolveJiraContextualCombobox(page: Page, context: string | undefined): Promise<Locator | undefined> {
  if (!context) return undefined;
  const ignored = new Set(["en", "de", "del", "la", "el", "los", "las", "un", "una", "para", "por", "ingresar", "introducir", "escribir", "seleccionar", "selecciona", "elegir", "elige", "indicar", "digitar", "campo", "valor"]);
  const terms = [...new Set(normalizeJiraOptionText(context).split(" ").filter(token => token.length > 2 && !ignored.has(token)))];
  if (terms.length < 2) return undefined;
  const candidates: Array<{ locator: Locator; score: number }> = [];
  const comboboxes = page.getByRole("combobox");
  for (let index = 0; index < await comboboxes.count(); index += 1) {
    const locator = comboboxes.nth(index);
    if (!await locator.isVisible() || !await locator.isEnabled()) continue;
    const identity = normalizeJiraOptionText(await locator.evaluate(element => {
      const labels = "labels" in element ? Array.from((element as HTMLInputElement).labels ?? []).map(label => label.innerText).join(" ") : "";
      return [labels, element.getAttribute("aria-label"), element.getAttribute("title"), element.id].filter(Boolean).join(" ");
    }));
    const score = terms.filter(term => identity.split(" ").includes(term)).length;
    if (score >= 2) candidates.push({ locator, score });
  }
  if (!candidates.length) return undefined;
  candidates.sort((left, right) => right.score - left.score);
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return undefined;
  return candidates[0].locator;
}

export function isAuthGateRequirement(text: string): boolean {
  return /(?:pantalla|formulario|puerta|gate|solicita).*(?:autenticaci[oó]n|iniciar sesi[oó]n|identificaci[oó]n)|(?:authentication|login) (?:screen|gate|form)/i.test(text);
}

const JIRA_GENERATOR_SETUP_PRECONDITIONS = new Set([
  "base_url configurado",
  "app available",
  "app_login_mode=password",
  "authgate/authflow enabled",
  "test client meets datarequirements",
]);

function normalizePreconditionLine(value: string): string {
  return value.trim().replace(/^\d+[.)]\s*/, "").replace(/[.。]+$/, "").trim().toLocaleLowerCase("en-US");
}

/** Removes only the known Jira generator environment boilerplate, never user-authored conditions. */
export function normalizeJiraFrameworkPreconditions(input: JiraScenarioInput, runtimeAppSlug: string): { preconditions: string[]; removed: boolean } {
  const original = (input.preconditions ?? []).flatMap(value => value.split(/\r?\n/)).map(value => value.trim()).filter(Boolean);
  const normalized = original.map(normalizePreconditionLine);
  const appSlugLine = normalized.filter(value => value.startsWith("app slug:"));
  const setupLines = normalized.filter(value => !value.startsWith("app slug:"));
  const isExactBoilerplate = appSlugLine.length === 1
    && appSlugLine[0] === `app slug: ${runtimeAppSlug.trim().toLocaleLowerCase("en-US")}`
    && setupLines.length === JIRA_GENERATOR_SETUP_PRECONDITIONS.size
    && setupLines.every(value => JIRA_GENERATOR_SETUP_PRECONDITIONS.has(value))
    && JIRA_GENERATOR_SETUP_PRECONDITIONS.size === new Set(setupLines).size;
  return isExactBoilerplate ? { preconditions: [], removed: original.length > 0 } : { preconditions: original, removed: false };
}

function explicitAssertionTarget(step: string): string | undefined {
  if (!/^\s*(?:validar|verificar|comprobar|assert)\b/i.test(step)) return undefined;
  return step.match(/["“]([^"”]+)["”]/)?.[1]?.trim();
}

/**
 * Corrects only a generated ordinal-selection placeholder that contradicts a direct
 * navigation result already backed by an explicit destination assertion.
 */
export function normalizeJiraScenarioForExecution(input: JiraScenarioInput, runtimeAppSlug: string): {
  scenario: JiraScenarioInput;
  removedFrameworkPreconditions: boolean;
  removedRedundantOrdinalSelectionCount: number;
} {
  const framework = normalizeJiraFrameworkPreconditions(input, runtimeAppSlug);
  const expected = input.expectedResult?.trim() ?? "";
  const directNavigation = /\b(?:directamente|directly)\b/i.test(expected)
    && /\b(?:dirige|redirige|dirigir|redirigir|navigate|redirect|goes)\b/i.test(expected);
  const assertedDestinations = input.steps.map(explicitAssertionTarget).filter((value): value is string => Boolean(value));
  const destinationBackedByExpectedResult = directNavigation
    && assertedDestinations.some(target => expected.toLocaleLowerCase().includes(target.toLocaleLowerCase()));
  const isUnsupportedOrdinalSelection = (step: string) => /\b(?:seleccionar|select)\b.*\b(?:primer|primero|first)\b.*\b(?:elemento|item)\b/i.test(step);
  const shouldRemoveOrdinalPlaceholder = (step: string) => destinationBackedByExpectedResult && isUnsupportedOrdinalSelection(step);
  const steps = input.steps.filter(step => !shouldRemoveOrdinalPlaceholder(step));
  return {
    scenario: { ...input, preconditions: framework.preconditions, steps },
    removedFrameworkPreconditions: framework.removed,
    removedRedundantOrdinalSelectionCount: input.steps.length - steps.length,
  };
}

/** Durable locator authority comes from the actual resolved DOM node, never a synthetic recorded object. */
export async function certifyJiraDurableTarget(page: Page, locator: Locator): Promise<PlanTarget> {
  const identity = await locator.evaluate(el => ({ id: el.id, testId: el.getAttribute("data-testid"), label: el.getAttribute("aria-label") }));
  const candidates: PlanTarget[] = [];
  if (identity.testId) candidates.push({ strategy: "testId", value: identity.testId });
  if (identity.id) candidates.push({ strategy: "css", value: `[id=${JSON.stringify(identity.id)}]` });
  if (identity.label) candidates.push({ strategy: "css", value: `[aria-label=${JSON.stringify(identity.label)}]` });
  for (const candidate of candidates) {
    const durable = candidate.strategy === "testId" ? page.getByTestId(candidate.value!) : page.locator(candidate.value!);
    if (await durable.count() === 1 && await durable.evaluate((el, other) => el === other, await locator.elementHandle())) return candidate;
  }
  // The resolved node's accessibility identity includes native roles and names
  // even when its text belongs to a nested span rather than the actionable node.
  const accessible=(await locator.ariaSnapshot()).split('\n')[0].match(/^- ([a-z][a-z0-9-]*) ("(?:\\.|[^"\\])*")(?:\s+\[[^\]]*\])*:?$/i);
  if(accessible) {
    const role=accessible[1] as Parameters<Page['getByRole']>[0];
    const name=JSON.parse(accessible[2]) as string;
    const candidate=page.getByRole(role,{name,exact:true});
    if(name && await candidate.count()===1 && await candidate.evaluate((el,other)=>el===other,await locator.elementHandle())) return {strategy:'role',role,name,exact:true};
  }
  const selectionLabel = jiraSelectionLabelByLocator.get(locator);
  if (selectionLabel) {
    const observed = await locator.evaluate(element => ({ tag: element.tagName.toLowerCase(), text: (element as HTMLElement).innerText.trim(),
      role: element.getAttribute("role"), tabIndex: element.getAttribute("tabindex"), type: element.getAttribute("type"),
      name: element.getAttribute("name"), placeholder: element.getAttribute("placeholder"), ariaLabel: element.getAttribute("aria-label") }));
    const labelLiteral = xpathStringLiteral(selectionLabel);
    const actionIdentity = observed.role ? ` and @role=${xpathStringLiteral(observed.role)}`
      : observed.tabIndex !== null ? ` and @tabindex=${xpathStringLiteral(observed.tabIndex)}` : "";
    const inputIdentity = [observed.type && `@type=${xpathStringLiteral(observed.type)}`, observed.name && `@name=${xpathStringLiteral(observed.name)}`,
      observed.placeholder && `@placeholder=${xpathStringLiteral(observed.placeholder)}`, observed.ariaLabel && `@aria-label=${xpathStringLiteral(observed.ariaLabel)}`]
      .filter(Boolean).join(" and ");
    const inputTarget = ["input", "textarea"].includes(observed.tag) || (await locator.getAttribute("contenteditable")) === "true";
    const identity = inputTarget ? inputIdentity : `normalize-space(.)=${xpathStringLiteral(observed.text)}${actionIdentity}`;
    const identitySelector = identity ? `[${identity}]` : "";
    const xpath = `(//*[normalize-space(.)=${labelLiteral} and not(*[normalize-space(.)=${labelLiteral}])]/following::${observed.tag}${identitySelector}[1])[1]`;
    const candidate = page.locator(`xpath=${xpath}`);
    if (await candidate.count() === 1 && await candidate.evaluate((element, other) => element === other, await locator.elementHandle())) {
      return { strategy: "xpath", value: xpath };
    }
  }
  const exactNode = await locator.evaluate(element => ({ tag: element.tagName.toLowerCase(), text: (element as HTMLElement).innerText.trim() })).catch(() => undefined);
  if (exactNode?.tag && exactNode.text) {
    const exactObservedNode = page.locator(`${exactNode.tag}:visible:text-is(${JSON.stringify(exactNode.text)})`);
    if (await exactObservedNode.count() === 1
      && await exactObservedNode.evaluate((element, other) => element === other, await locator.elementHandle())) {
      return { strategy: "css", value: `${exactNode.tag}:visible:text-is(${JSON.stringify(exactNode.text)})` };
    }
  }
  // Scanner candidates are independently rechecked against the resolved element.
  const snapshot = await scanCurrentPage(page);
  for (const element of snapshot.elements.filter(e => e.visible)) for (const c of element.candidateLocators) {
    const l = c.strategy === "role" ? page.getByRole(c.role as Parameters<Page["getByRole"]>[0], { name: c.name, exact: true })
      : c.strategy === "label" ? page.getByLabel(c.value ?? c.name ?? "", { exact: true })
      : c.strategy === "text" ? page.getByText(c.value ?? c.name ?? "", { exact: true }) : undefined;
    if (l && await l.count() === 1 && await l.evaluate((el, other) => el === other, await locator.elementHandle())) {
      return { strategy: c.strategy, value: c.value, role: c.role, name: c.name, exact: true };
    }
  }
  const exactText = (await locator.innerText().catch(() => "")).trim();
  if (exactText) {
    const exactTextLocator = page.getByText(exactText, { exact: true });
    if (await exactTextLocator.count() === 1 && await exactTextLocator.isVisible()
      && await exactTextLocator.evaluate((element, other) => element === other, await locator.elementHandle())) {
      return { strategy: "text", value: exactText, exact: true };
    }
    const tag = await locator.evaluate(element => element.tagName.toLowerCase());
    const position = await locator.evaluate((element, expected) => {
      const matches = Array.from(document.querySelectorAll(expected.tag)).filter(node => (node as HTMLElement).innerText.trim() === expected.text);
      return { count: matches.length, index: matches.indexOf(element) };
    }, { tag, text: exactText });
    if (position.count > 1 && position.index >= 0) {
      const xpathLiteral = exactText.includes("'") && exactText.includes('"')
        ? `concat(${exactText.split("'").map((part, index) => `${index ? `, "'", ` : ""}'${part}'`).join("")})`
        : exactText.includes("'") ? `"${exactText}"` : `'${exactText}'`;
      const xpath = `(//${tag}[normalize-space(.)=${xpathLiteral}])[${position.index + 1}]`;
      const positional = page.locator(`xpath=${xpath}`);
      if (await positional.count() === 1 && await positional.evaluate((element, other) => element === other, await locator.elementHandle())) {
        return { strategy: "xpath", value: xpath };
      }
    }
  }
  throw new Error("JIRA_DURABLE_TARGET_UNRESOLVED");
}

export function createJiraPlaywrightPort(page: Page, baseUrl: string, authFlow?: (observedStage?: string) => Promise<{ success: boolean }>): JiraBrowserPort {
  ensureJiraDownloadObserver(page);
  let previousActionWasClick = false;
  let lastFilledTarget: string | undefined;
  let lastClickLoadingObservations: string[] = [];
  let addedRowProven = false;
  const selectedValues = new Map<string, string>();
  return {
    baseUrl,
    async navigate() { await settleJiraAction(page, () => page.goto(baseUrl, { waitUntil: "domcontentloaded" }), baseUrl); },
    async navigateTo(url) {
      const requested = new URL(url);
      const base = new URL(baseUrl);
      if (requested.origin !== base.origin || !["http:", "https:"].includes(requested.protocol) || requested.username || requested.password) {
        throw new Error("JIRA_ROUTE_OUTSIDE_APP_ORIGIN");
      }
      await settleJiraAction(page, () => page.goto(requested.toString(), { waitUntil: "domcontentloaded" }), baseUrl);
    },
    async authenticate(observedStage) {
      if (!authFlow) throw new Error("JIRA_AUTH_FLOW_UNAVAILABLE");
      return authFlow(observedStage);
    },
    async observeClassicLogin() {
      // The scan may miss <label> text on a heading-less form, so "unknown" is accepted only when
      // the DOM below still yields a label-identified username; other gate types never are.
      const gateType = detectAuthGate(await scanCurrentPage(page)).gateType;
      if (gateType !== "classic_login" && gateType !== "unknown") return undefined;
      const password = page.locator('input[type="password"]:visible');
      const form = page.locator("form", { has: password });
      if (await password.count() !== 1 || await form.count() !== 1) return undefined;
      const inputs = form.locator('input:visible:not([type="password"],[type="hidden"],[type="checkbox"],[type="radio"],[type="submit"],[type="button"])');
      const submit = form.locator('button[type="submit"]:visible, input[type="submit"]:visible');
      const count = await inputs.count();
      if (!count || await submit.count() !== 1) return undefined;
      const describe = (field: Locator) => field.evaluate(el => { const i = el as HTMLInputElement;
        return { label: (i.labels?.[0]?.textContent || i.getAttribute("aria-label") || i.placeholder || "").trim(),
          required: i.required || i.getAttribute("aria-required") === "true" }; });
      const [fields, passwordLabel, submitLabel] = await Promise.all([
        Promise.all(Array.from({ length: count }, (_, index) => describe(inputs.nth(index)))),
        describe(password).then(item => item.label),
        submit.evaluate(el => ((el as HTMLElement).innerText || (el as HTMLInputElement).value || "").trim())]);
      if (!passwordLabel || !submitLabel) return undefined;
      // Semantic classification by observed label only, never by position. A lone
      // control keeps the historical username reading; otherwise a control with no
      // recognised role is left alone unless the form requires it.
      const classified = fields.map(field => ({ ...field, role: detectCredentialRole(field.label) }));
      if (gateType === "unknown" && !classified.some(field => field.role === "username")) return undefined;
      const lone = classified.length === 1 && !classified[0].role;
      const usernames = classified.filter(field => lone || field.role === "username");
      const extra = classified.filter(field => field.role === "company_identifier");
      const unknownRequired = classified.some(field => field.required && !lone && field.role !== "username" && field.role !== "company_identifier");
      if (usernames.length !== 1 || !usernames[0].label || unknownRequired
        || extra.length > 1) return { blocked: "JIRA_LOGIN_FIELD_UNIDENTIFIED" };
      return { username: usernames[0].label, password: passwordLabel, submit: submitLabel,
        ...(extra.length ? { extra: extra.map(field => ({ label: field.label, role: field.role! })) } : {}) };
    },
    async observeAuthStage() {
      return observeAuthStageSettled({ scan: () => scanCurrentPage(page), wait: ms => page.waitForTimeout(ms), now: Date.now });
    },
    async isTargetVisible(target) {
      const visible = (locator: Locator) => locator.evaluateAll(els => els.some(el => (el as HTMLElement).offsetParent !== null));
      return await visible(page.getByRole("button", { name: target, exact: true })) || await visible(page.getByText(target, { exact: true }));
    },
    async isLoginSelectorOption(target) {
      const password = page.locator('input[type="password"]:visible');
      if (await password.count() !== 1) return false;
      // Evaluated in the DOM: the option must sit in the login form beside >=1 peer exposing the same kind of selection state.
      return password.evaluate((pw, label) => {
        // No named helper bindings here: tsx/esbuild would inject __name, which is undefined in the browser.
        // Panel: the credential form, widened at most 3 ancestors while it still holds only this one password field,
        // so a selector group sitting beside the form (same login card) is seen without scanning the document.
        let scope: Element | null = pw.closest("form") ?? pw.parentElement;
        for (let depth = 0; scope && depth <= 3; depth++, scope = scope.parentElement) {
          if (scope === document.body || scope === document.documentElement) return false;
          if (Array.from(scope.querySelectorAll('input[type="password"]')).filter(el => (el as HTMLElement).offsetParent !== null).length !== 1) return false;
          const options = Array.from(scope.querySelectorAll("button, [role=tab], [role=radio], [role=option], [role=button], label, a, li")).filter(el => (el as HTMLElement).offsetParent !== null);
          const matches = options.filter(el => ((el as HTMLElement).innerText || el.getAttribute("aria-label") || "").trim() === label);
          if (matches.length > 1) return false;
          if (matches.length === 0) continue;
          // Group: visible same-parent, same-tag peers (target may be selected or not). Exactly one member must be selected.
          const group = options.filter(el => el.parentElement === matches[0].parentElement && el.tagName === matches[0].tagName);
          return group.length >= 2 && group.filter(el => {
            for (const attr of ["aria-selected", "aria-pressed", "aria-checked"]) if (el.hasAttribute(attr)) return el.getAttribute(attr) === "true";
            if (el instanceof HTMLInputElement && el.type === "radio") return el.checked;
            return /(^|[\s_-])(active|selected|is-active|is-selected)($|[\s_-])/i.test(el.className?.toString() ?? "");
          }).length === 1;
        }
        return false;
      }, target);
    },
    async assertPrecondition(target) {
      const result = await resolveActionTarget(page, await scanCurrentPage(page), target);
      if (result.status !== "resolved" || !result.locator || !await result.locator.isVisible()) throw new Error("JIRA_PRECONDITION_NOT_SATISFIED");
      return { observedText: result.candidateText || target };
    },
    async act(step, target, value, semanticContext) {
      return settleJiraAction(page, async (): Promise<PlanTarget> => {
      // Jira prose can describe a choice as "enter X" even when the live page
      // exposes a native/custom combobox. Let the observed DOM correct that
      // action classification before target resolution, while leaving ordinary
      // text inputs on the existing fill path.
      if (step.action === "fill" && value !== undefined) {
        const observedRange = page.getByRole("slider", { name: new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
        if (await observedRange.count() === 1 && await observedRange.isVisible() && await observedRange.isEnabled()) {
          step.action = "select";
        } else {
          const observedCombobox = page.getByRole("combobox", { name: target, exact: true });
          if (await observedCombobox.count() === 1 && await observedCombobox.isVisible() && await observedCombobox.isEnabled()) {
            step.action = "select";
          }
        }
      }
      if (step.action === "fill" && isJiraSegmentedCodeTarget(target)) {
        const segments = await resolveJiraSegmentedCodeGroup(page);
        if (segments) {
          if (segments.length !== value!.length) throw new Error("JIRA_SEGMENTED_CODE_LENGTH_MISMATCH");
          await fillJiraSegmentedCode(page, value!, segments.length);
          lastFilledTarget = normalizeJiraOptionText(target);
          return { strategy: "semantic", value: "segmented_code", metadata: {
            originalTarget: target,
            resolvedTargetName: "segmented code input group",
            resolvedCandidateId: String(segments.length),
            repairType: "jira_segmented_code",
            validationStatus: "runtime_resolution_required",
          } };
        }
      }
      const snapshot = await scanCurrentPage(page);
      const resolutionContext = semanticContext ?? step.description;
      const addedRow = addedRowProven ? await relocateJiraAddedRow(page) : undefined;
      let result = previousActionWasClick
        ? await resolveJiraStepTargetAfterClick(page, step, target, snapshot, resolutionContext, addedRow)
        : await resolveJiraStepTarget(page, step, target, snapshot, resolutionContext, addedRow);
      if (step.action === "fill" && result.locatorStrategy !== JIRA_ADDED_ROW_STRATEGY) {
        const contextualCombobox = await resolveJiraContextualCombobox(page, semanticContext);
        if (contextualCombobox) result = { status: "resolved", target, locator: contextualCombobox,
          locatorStrategy: "jira_contextual_combobox", confidence: 1,
          matchReason: "unique_combobox_matches_semantic_step_context", candidateText: target, candidates: [] };
      }
      const normalizedTarget = normalizeJiraOptionText(target);
      const isAuthorizationSubmit = /\b(?:autorizar|authorize|confirmar|confirm|completar|complete|submit)\b/.test(normalizedTarget);
      const lastFillWasCode = Boolean(lastFilledTarget && /\b(?:token|otp|codigo|code)\b/.test(lastFilledTarget));
      if (step.action === "click" && result.status === "not_found" && isAuthorizationSubmit && lastFillWasCode) {
        // Some applications label the final authorization CTA simply
        // “Continuar”. Use it only as the unique observed action immediately
        // following a security-code fill; never infer it from page/project names.
        result = await resolveJiraActionTargetWithAi(page, snapshot, "Continuar", semanticContext ?? step.description);
      }
      if (step.action === "fill" && value !== undefined && result.status === "resolved" && result.locator) {
        const resolvedKind = await result.locator.evaluate(element => ({
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role")?.toLowerCase(),
        }));
        if (resolvedKind.tag === "select" || resolvedKind.role === "combobox") step.action = "select";
      }
      if (step.action === "select" && value !== undefined && result.status === "resolved"
        && result.matchReason === JIRA_TEXT_INPUT_FOR_SELECT_REASON) step.action = "fill";
      previousActionWasClick = false;
      if (result.status !== "resolved" || !result.locator) throw jiraTargetFailure(result);
      const locator = result.locator;
      let durable: PlanTarget;
      try {
        durable = await certifyJiraDurableTarget(page, locator);
      } catch {
        throw new Error("JIRA_DURABLE_TARGET_UNRESOLVED");
      }
      if (step.action === "fill") { await locator.fill(value!); if (await locator.inputValue() !== value) throw new Error("JIRA_FILL_NOT_CONFIRMED"); lastFilledTarget = normalizeJiraOptionText(target); }
      else if (step.action === "press") await locator.press(value!);
      else if (step.action === "select") {
        lastFilledTarget = undefined;
        const isRange = await locator.evaluate(el => el instanceof HTMLInputElement && el.type === "range");
        if (result.matchReason === JIRA_CHOICE_CONTROL_REASON) {
          await locator.check();
          if (!await locator.isChecked()) throw new Error("JIRA_SELECTION_NOT_CONFIRMED");
        } else if (isRange) {
          await setJiraRangeControlValue(locator, value!);
        } else if (await locator.evaluate(el => el.tagName.toLowerCase()) === "select") {
          step.selectionControlKind = "native_select";
          const readOptions = () => locator.locator("option").evaluateAll(elements => elements
            .filter(element => !(element as HTMLOptionElement).disabled && !element.closest("optgroup[disabled]"))
            .map(element => ({ value: (element as HTMLOptionElement).value, label: (element as HTMLOptionElement).label || element.textContent || "" })));
          let options = await readOptions();
          // Dependent selects may populate after the previous row/field commit.
          // Re-read the observed options (bounded) before declaring no match.
          for (const deadline = Date.now() + 5000; Date.now() < deadline
            && !resolveJiraNativeOption(options, value!, isGenericJiraTestDataPlaceholder(value!));) {
            await page.waitForTimeout(250);
            options = await readOptions();
          }
          // Generated generic data can describe a field as text even when the
          // live DOM proves it is a select. In that case use a real enabled
          // option from the observed control; explicit requested values remain
          // strict and never fall back to an unrelated choice.
          const match = resolveJiraNativeOption(options, value!, isGenericJiraTestDataPlaceholder(value!));
          if (!match) {
            console.log(`[jira-selection:native] result=unmatched optionCount=${options.length} genericTestData=${isGenericJiraTestDataPlaceholder(value!)}`);
            throw new Error("JIRA_SELECTION_NOT_CONFIRMED");
          }
          await locator.selectOption(match.value);
          const selected = await locator.locator("option:checked").evaluate(element => ({ value: (element as HTMLOptionElement).value, label: (element as HTMLOptionElement).label || element.textContent || "" }));
          const genericTestData = isGenericJiraTestDataPlaceholder(value!);
          const selectionConfirmed = selected.value === match.value && (genericTestData
            || normalizeJiraOptionText(`${selected.label} ${selected.value}`).includes(normalizeJiraOptionText(value!)));
          if (!selectionConfirmed) {
            console.log(`[jira-selection:native] result=unconfirmed optionCount=${options.length} genericTestData=${genericTestData} selectedMatches=${selected.value === match.value}`);
            throw new Error("JIRA_SELECTION_NOT_CONFIRMED");
          }
        } else {
          await selectJiraObservedOption(page, locator, value!);
        }
        selectedValues.set(normalizeJiraOptionText(target), value!);
      } else {
        lastFilledTarget = undefined;
        lastClickLoadingObservations = [];
        // Capture short-lived loading UI at mutation time. A post-click DOM
        // read can miss React transitions that disappear before Playwright
        // returns from the click action.
        await page.evaluate(() => {
          const key = "__qaLabJiraLoadingCapture";
          const root = document.body;
          if (!root) return;
          const capture = (window as typeof window & { __qaLabJiraLoadingCapture?: { labels: string[]; observer?: MutationObserver } })[key];
          capture?.observer?.disconnect();
          const state = { labels: [] as string[], observer: undefined as MutationObserver | undefined };
          state.observer = new MutationObserver(() => {
            for (const element of Array.from(root.querySelectorAll<HTMLElement>('[role="status"],[aria-live],[aria-label]'))) {
              const style = window.getComputedStyle(element);
              // MutationObserver runs before the next paint; geometry can be
              // zero at that point even for an element that is about to render.
              if (style.display === "none" || style.visibility === "hidden") continue;
              const label = `${element.getAttribute("aria-label") ?? ""} ${element.innerText.trim()}`.trim();
              if (/\b(?:estado\s+(?:de\s+)?carga|cargando|loading|procesando|processing|actualizando|updating)\b/i.test(label)
                && !state.labels.includes(label)) state.labels.push(label);
            }
          });
          state.observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
          (window as typeof window & { __qaLabJiraLoadingCapture?: typeof state })[key] = state;
        });
        // Row identities are observed only around an add-row click that already
        // resolved to a unique control; anything else leaves the row unproven.
        const observeAddedRow = step.action === "click" && jiraIsAddRowAction(target);
        if (observeAddedRow) { addedRowProven = false; await snapshotJiraRows(page); }
        try {
          // Jira UI steps may follow an async login or list load while a modal
          // loading layer briefly intercepts clicks. Let Playwright wait for
          // the observed locator to become actionable instead of failing on
          // its shorter default timeout.
          await locator.click({ timeout: 90000 });
        } catch {
          throw new Error("JIRA_ACTION_DISPATCH_FAILED");
        }
        previousActionWasClick = true;
        if (observeAddedRow) addedRowProven = await markJiraAddedRow(page);
        lastClickLoadingObservations = await page.evaluate(() => {
          const key = "__qaLabJiraLoadingCapture";
          const state = (window as typeof window & { __qaLabJiraLoadingCapture?: { labels: string[]; observer?: MutationObserver } })[key];
          state?.observer?.disconnect();
          if (state) delete (window as typeof window & { __qaLabJiraLoadingCapture?: unknown })[key];
          return state?.labels ?? [];
        });
        const currentlyVisibleLoading = await page.locator('[role="status"],[aria-live],[aria-label]').evaluateAll(elements => elements
          .filter(element => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          })
          .map(element => `${element.getAttribute("aria-label") ?? ""} ${(element as HTMLElement).innerText.trim()}`.trim())
          .filter(label => /\b(?:estado\s+(?:de\s+)?carga|cargando|loading|procesando|processing|actualizando|updating)\b/i.test(label)));
        lastClickLoadingObservations = [...new Set([...lastClickLoadingObservations, ...currentlyVisibleLoading])];
      }
      return durable;
      });
    },
    async assertAbsent(target) { await assertJiraSpecAbsentText(page,target); return {absent:true}; },
    observeVisibleTable: () => observeJiraVisibleTableRows(page),
    async assertDownload(expected) { const observation = await assertJiraDownloadContent(page, expected); previousActionWasClick = false; return observation; },
    async assertRowMatch(container, values) {
      let status: JiraRowMatchStatus = "container_missing";
      await expect.poll(async () => { status = await observeJiraNamedRowMatch(page, container, values); return status; }, { timeout: 15000 })
        .toBe("ok").catch(() => {
          throw new Error(status === "container_missing" ? "JIRA_ROW_CONTAINER_UNOBSERVABLE"
            : status === "container_ambiguous" ? "JIRA_ROW_CONTAINER_AMBIGUOUS"
            : status === "row_ambiguous" ? "JIRA_ROW_AMBIGUOUS" : "JIRA_ROW_NOT_OBSERVED");
        });
      previousActionWasClick = false;
      return { kind: "table_row_match", container, matchedRows: 1, boundValueCount: values.length };
    },
    async assertValidation(fieldLabel) {
      let evidence: JiraFieldValidationEvidence | undefined;
      await expect.poll(async () => {
        evidence = await observeJiraFieldValidation(page, fieldLabel);
        return Boolean(evidence);
      }, { timeout: 15000 }).toBe(true)
        .catch(() => { throw new Error("JIRA_FIELD_VALIDATION_NOT_OBSERVED"); });
      previousActionWasClick = false;
      return evidence!;
    },
    async assert(target, authGate, screenDescriptor = false, columnHeader = false) {
      if (authGate) {
        let stage: string | undefined;
        await expect.poll(async () => { const gate = detectAuthGate(await scanCurrentPage(page));
          if (gate.detected && gate.stage !== "authenticated_landing" && gate.stage !== "unknown") { stage = gate.stage; return true; } return false;
        }, { timeout: 15000 }).toBe(true).catch(() => { throw new Error("JIRA_AUTH_GATE_NOT_OBSERVED"); });
        return { stage };
      }
      const normalizedTarget = normalizeJiraOptionText(target);
      // A menu item is valid evidence when the scenario explicitly asserts
      // access to that navigation entry. Keep this separate from page-content
      // assertions so arbitrary text elsewhere in the sidebar cannot satisfy it.
      const navigationItems = page.locator('nav a,nav button,nav [role="link"],nav [role="button"],nav [role="menuitem"],aside a,aside button,aside [role="link"],aside [role="button"],aside [role="menuitem"],[role="navigation"] a,[role="navigation"] button,[role="navigation"] [role="link"],[role="navigation"] [role="button"],[role="navigation"] [role="menuitem"]');
      const matchingNavigationItems: Locator[] = [];
      for (let index = 0; index < await navigationItems.count(); index += 1) {
        const candidate = navigationItems.nth(index);
        if (!await candidate.isVisible()) continue;
        const label = (await candidate.getAttribute("aria-label") ?? await candidate.innerText()).trim();
        if (normalizeJiraOptionText(label) === normalizedTarget) matchingNavigationItems.push(candidate);
      }
      // After a click the sidebar entry that was just pressed is present before and after navigation, so it
      // proves nothing: fall through to the content assertion poll, which excludes navigation.
      if (matchingNavigationItems.length === 1 && !previousActionWasClick) {
        return { observedText: (await matchingNavigationItems[0].innerText()).trim() };
      }
      if (previousActionWasClick && /\b(?:estado\s+(?:de\s+)?carga|cargando|loading|procesando|processing|actualizando|updating)\b/.test(normalizedTarget)) {
        const observed = lastClickLoadingObservations.find(label => jiraAssertionTextMatches(label, target))
          ?? await page.locator('[role="status"],[aria-live],[aria-label]').evaluateAll(elements => elements
            .filter(element => {
              if (!(element instanceof HTMLElement)) return false;
              const style = window.getComputedStyle(element);
              return style.display !== "none" && style.visibility !== "hidden";
            })
            .map(element => `${element.getAttribute("aria-label") ?? ""} ${(element as HTMLElement).innerText.trim()}`.trim())
            .find(label => /\b(?:estado\s+(?:de\s+)?carga|cargando|loading|procesando|processing|actualizando|updating)\b/i.test(label)
              && jiraAssertionTextMatches(label, target)));
        previousActionWasClick = false;
        lastClickLoadingObservations = [];
        if (observed) {
          return { observedText: observed };
        }
        // A loading indicator is inherently transient. If neither the click
        // mutation observer nor the current DOM saw it, fail this oracle now
        // instead of waiting on the generic post-click navigation deadline.
        throw new Error("JIRA_ASSERTION_NOT_SATISFIED");
      }
      if (/\breferencia\b/.test(normalizedTarget)) {
        let observedReference: string | undefined;
        await expect.poll(async () => {
          const main = page.getByRole("main");
          const scope = await main.count() === 1 ? main : page.locator("body");
          const visibleTexts = await scope.evaluateAll(roots => roots.flatMap(root => [root, ...root.querySelectorAll("*")])
            .filter(element => {
              if (!(element instanceof HTMLElement)) return false;
              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
                && !element.closest('nav,aside,[role="navigation"],[role="complementary"],[role="menu"],[role="menubar"]');
            })
            .map(element => (element as HTMLElement).innerText.trim())
            .filter(Boolean));
          observedReference = visibleTexts.filter(hasJiraReferenceEvidence)
            .sort((left, right) => left.length - right.length)[0];
          return Boolean(observedReference);
        }, { timeout: previousActionWasClick ? 90000 : 15000 }).toBe(true)
          .catch(() => { throw new Error("JIRA_ASSERTION_NOT_SATISFIED"); });
        previousActionWasClick = false;
        return { observedText: observedReference };
      }
      // Authored "columna X" oracle: the header text itself is the evidence, not a date/time cell value.
      if (columnHeader) {
        let observedHeader: string | undefined;
        await expect.poll(async () => {
          const headers = await page.locator('th,[role="columnheader"]').evaluateAll(elements => elements
            .filter(element => {
              if (!(element instanceof HTMLElement)) return false;
              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
            })
            .map(element => (element as HTMLElement).innerText.trim()));
          observedHeader = headers.find(header => normalizeJiraOptionText(header) === normalizedTarget);
          return Boolean(observedHeader);
        }, { timeout: previousActionWasClick ? 90000 : 15000 }).toBe(true)
          .catch(() => { throw new Error("JIRA_ASSERTION_NOT_SATISFIED"); });
        previousActionWasClick = false;
        return { observedText: observedHeader };
      }
      if (/\bfecha y hora\b/.test(normalizedTarget)) {
        let observedDateTime: string | undefined;
        await expect.poll(async () => {
          const main = page.getByRole("main");
          const scope = await main.count() === 1 ? main : page.locator("body");
          const visibleTexts = await scope.locator("*").evaluateAll(elements => elements
            .filter(element => {
              if (!(element instanceof HTMLElement)) return false;
              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
                && !element.closest('nav,aside,[role="navigation"],[role="complementary"],[role="menu"],[role="menubar"]');
            })
            .map(element => (element as HTMLElement).innerText.trim())
            .filter(Boolean));
          observedDateTime = visibleTexts.filter(isVisibleDateTimeEvidence)
            .sort((left, right) => left.length - right.length)[0];
          return Boolean(observedDateTime);
        }, { timeout: previousActionWasClick ? 90000 : 15000 }).toBe(true)
          .catch(() => { throw new Error("JIRA_ASSERTION_NOT_SATISFIED"); });
        previousActionWasClick = false;
        return { observedText: observedDateTime };
      }
      const requiresBothSelectedAccounts = /cuentas (?:seleccionadas|involucradas)/.test(normalizedTarget);
      const selectedFieldKey = /cuenta que debit|cuenta a debitar|cuenta origen/.test(normalizedTarget) ? normalizeJiraOptionText("cuenta de origen")
        : /cuenta que recib|cuenta receptora|cuenta destino/.test(normalizedTarget) ? normalizeJiraOptionText("cuenta de destino") : undefined;
      const selectedValuesToAssert = requiresBothSelectedAccounts
        ? [selectedValues.get(normalizeJiraOptionText("cuenta de origen")), selectedValues.get(normalizeJiraOptionText("cuenta de destino"))]
        : selectedFieldKey ? [selectedValues.get(selectedFieldKey)] : [];
      if (selectedValuesToAssert.length && selectedValuesToAssert.every((value): value is string => Boolean(value))) {
        let visibleSelections: string[] = [];
        const selectionsConfirmed = async () => {
          visibleSelections = [];
          for (const value of selectedValuesToAssert) {
            const selectedText = page.getByText(value, { exact: false });
            let found = false;
            for (let index = 0; index < await selectedText.count(); index += 1) {
              const candidate = selectedText.nth(index);
              if (await candidate.isVisible() && normalizeJiraOptionText(await candidate.innerText()).includes(normalizeJiraOptionText(value))) {
                visibleSelections.push((await candidate.innerText()).trim());
                found = true;
                break;
              }
            }
            // The assertion resolver normalizes Spanish articles and accents,
            // but Playwright's text locator performs its substring match before
            // that normalization. Fall back to visible DOM text so equivalent
            // labels such as “Cuenta Ahorro” and “Cuenta de Ahorro” are treated
            // consistently while still requiring the selected value to appear.
            if (!found) {
              const observedTexts = await page.locator("body").locator("*").evaluateAll(elements => elements
                .filter(element => {
                  if (!(element instanceof HTMLElement)) return false;
                  const style = window.getComputedStyle(element);
                  const rect = element.getBoundingClientRect();
                  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
                    && !element.closest('nav,aside,[role="navigation"],[role="complementary"],[role="menu"],[role="menubar"]');
                })
                .map(element => ({text:(element as HTMLElement).innerText.trim(),inMain:Boolean(element.closest('main,[role="main"]'))}))
                .filter(observation => Boolean(observation.text)));
              const equivalent = observedTexts
                .filter(observation => jiraOptionTextMatches(observation.text, value))
                .sort((left, right) => Number(right.inMain) - Number(left.inMain)
                  || normalizeJiraOptionText(left.text).length - normalizeJiraOptionText(right.text).length)[0]?.text;
              if (equivalent) {
                visibleSelections.push(equivalent);
                found = true;
              }
            }
            if (!found) { visibleSelections = []; return false; }
          }
          if (visibleSelections.length !== selectedValuesToAssert.length) return false;
          if (previousActionWasClick && requiresBothSelectedAccounts && /cuentas seleccionadas/.test(normalizedTarget)) {
            const headings = page.getByRole("heading");
            let confirmationVisible = false;
            for (let index = 0; index < await headings.count(); index += 1) {
              if (/\b(?:confirmacion|confirmation)\b/.test(normalizeJiraOptionText(await headings.nth(index).innerText()))) {
                confirmationVisible = true;
                break;
              }
            }
            // Some SPAs render the screen title as a styled div/span instead of
            // an accessible heading. Accept the exact visible title outside
            // global navigation, while still requiring both selected accounts.
            if (!confirmationVisible) {
              const confirmationLabels = page.getByText("Confirmación", { exact: true });
              for (let index = 0; index < await confirmationLabels.count(); index += 1) {
                const candidate = confirmationLabels.nth(index);
                if (!await candidate.isVisible()) continue;
                const isContentLabel = await candidate.evaluate(element =>
                  !element.closest('nav,aside,[role="navigation"],[role="complementary"],[role="menu"],[role="menubar"]'),
                ).catch(() => false);
                if (isContentLabel && normalizeJiraOptionText(await candidate.innerText()) === "confirmacion") {
                  confirmationVisible = true;
                  break;
                }
              }
            }
            if (!confirmationVisible) return false;
          }
          return true;
        };
        await expect.poll(selectionsConfirmed, { timeout: previousActionWasClick ? 90000 : 15000 })
          .toBe(true).catch(() => { throw new Error("JIRA_ASSERTION_NOT_SATISFIED"); });
        previousActionWasClick = false;
        return { observedText: visibleSelections.join(" · ") };
      }
      let observedText: string | undefined;
      const isStandaloneObservation = async (candidate: Locator): Promise<boolean> => {
        if (!await candidate.isVisible()) return false;
        return !await candidate.evaluate(element => {
          const node = element as HTMLElement;
          if (/^H[1-6]$/.test(node.tagName)) {
            return Boolean(node.closest('nav,aside,[role="navigation"],[role="complementary"],button,a,[role="button"],[role="link"],[role="menuitem"],[role="tab"]'));
          }
          let current: HTMLElement | null = element as HTMLElement;
          let isCandidate = true;
          for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
            if (current.matches('nav,aside,[role="navigation"],[role="complementary"],button,a,[role="button"],[role="link"],[role="menuitem"],[role="tab"]')) return true;
            // A clickable layout wrapper should not make its non-interactive
            // heading/label unusable as an assertion oracle. Cursor styling is
            // meaningful only on the observed node itself; semantic interactive
            // ancestors are still rejected above.
            if (isCandidate) {
              const style = window.getComputedStyle(current);
              const parentCursor = current.parentElement ? window.getComputedStyle(current.parentElement).cursor : "auto";
              if (current.tabIndex >= 0 || (style.cursor === "pointer" && parentCursor !== "pointer" && style.pointerEvents !== "none")) return true;
            }
            isCandidate = false;
          }
          return false;
        });
      };
      const matchesObservedLabel = (observed: string) => {
        const actual = normalizeJiraOptionText(observed);
        // In Jira-authored steps, "pantalla de X" describes the kind of
        // observation; the page heading normally exposes only X.
        const expected = target.replace(/^\s*pantalla\s+de\s+/i, "")
          .replace(/\b(?:identificable|identifiable)\s*$/i, "");
        return jiraAssertionTextMatches(observed, expected) || jiraScreenDescriptorMatches(observed, target)
          || (normalizeJiraOptionText(expected).includes("confirmacion") && actual === "confirmacion");
      };
      const observeAssertion = async () => {
        const observableTarget = target.replace(/^\s*pantalla\s+de\s+/i, "")
          .replace(/\b(?:identificable|identifiable)\s*$/i, "").trim();
        const normalizedObservableTarget = normalizeJiraOptionText(observableTarget);
        // Compare normalized text in code instead of using a raw-text regex so
        // accents and grammatical fillers can differ between the HU and UI.
        const headings = page.getByRole("heading");
        const matchingHeadings: Locator[] = [];
        for (let index = 0; index < await headings.count(); index += 1) {
          const heading = headings.nth(index);
          const headingText = await heading.innerText();
          if ((matchesObservedLabel(headingText) || (screenDescriptor && jiraScreenHeadingPrefixMatches(headingText, target)))
            && await isStandaloneObservation(heading)) matchingHeadings.push(heading);
        }
        if (matchingHeadings.length === 1) {
          observedText = (await matchingHeadings[0].innerText()).trim();
          return true;
        }
        // Prefer the main landmark, but some applications render case content
        // outside a mis-scoped <main>. Search the visible body as a fallback while
        // continuing to exclude global navigation from assertion evidence.
        const visibleObservations = await page.locator("body").locator("*").evaluateAll(elements => elements
          .filter(element => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          })
          .map(element => ({
            text: (element as HTMLElement).innerText.trim(),
            inGlobalNavigation: Boolean(element.closest('nav,aside,[role="navigation"],[role="complementary"],[role="menu"],[role="menubar"]')),
            inGlobalHeader: Boolean(element.closest('header,[role="banner"]')),
            containsGlobalHeader: Boolean(element.querySelector('header,[role="banner"]')),
            inMain: Boolean(element.closest('main,[role="main"]')),
          }))
          .filter(observation => Boolean(observation.text)));
        const usable = visibleObservations.filter(observation => !observation.inGlobalNavigation && !observation.inGlobalHeader && !observation.containsGlobalHeader
          && (jiraAssertionTextMatches(observation.text, normalizedObservableTarget)
            || jiraScreenDescriptorMatches(observation.text, target)))
          .sort((left, right) => Number(right.inMain) - Number(left.inMain));
        const numericExpected = target.trim().replace(/\b(?:RD|US|[A-Z]{3})\b/gi, "").replace(/[$€£¥]/gu, "").trim();
        const numericAssertion = /^[+-]?\d[\d.,]*$/.test(numericExpected);
        const rangeMetadataAssertion = isJiraRangeMetadataAssertion(target);
        const matchingControlState = numericAssertion || rangeMetadataAssertion ? await page.locator("input[type=number],input[type=range],[role=spinbutton],[role=slider]").evaluateAll(elements =>
          elements.filter(element => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const identity = `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("name") ?? ""} ${element.id} ${element.getAttribute("placeholder") ?? ""}`;
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
              && !element.closest('nav,aside,[role="navigation"],[role="complementary"]')
              && !/(?:password|contrase|clave|otp|token|codigo|código|pin|secret|security)/i.test(identity);
          }).map(element => {
            const value = element instanceof HTMLInputElement ? element.value : element.getAttribute("aria-valuenow") ?? element.getAttribute("aria-valuetext") ?? "";
            const min = element instanceof HTMLInputElement ? element.min : element.getAttribute("aria-valuemin") ?? "";
            const max = element instanceof HTMLInputElement ? element.max : element.getAttribute("aria-valuemax") ?? "";
            const step = element instanceof HTMLInputElement ? element.step : "";
            const label = `${element.getAttribute("aria-label") ?? ""} ${element.id}`.trim();
            return { value, min, max, step, label };
          })) : [];
        const matchingNumericState = matchingControlState.find(state => jiraNumericValueMatches(state.value, target)
          || jiraRangeMetadataAssertionMatches(state, target));
        if (matchingNumericState) {
          const observedValue = jiraRangeMetadataAssertionMatches(matchingNumericState, target)
            ? `min=${matchingNumericState.min} max=${matchingNumericState.max} step=${matchingNumericState.step}`
            : matchingNumericState.value;
          observedText = `${matchingNumericState.label || "Numeric control"}: ${observedValue}`;
          return true;
        }
        // A result-count indicator is a compact "N resultados" label; its wording never
        // repeats the authored "indicador de cantidad", so match the count shape directly.
        if (isJiraResultCountAssertion(target)) {
          const countLabel = visibleObservations.find(observation => !observation.inGlobalNavigation && !observation.inGlobalHeader
            && !observation.containsGlobalHeader && isJiraResultCountText(observation.text));
          if (countLabel) { observedText = countLabel.text; return true; }
        }
        // Assertions answer whether an observable exists; repeated labels like
        // “Monto” in a section title and its field label are not ambiguous
        // actions. Keep uniqueness requirements in action target resolution.
        if (!usable.length) {
          const equivalentAlert = (await readVisibleJiraAlertTexts(page).catch(() => [])).find(text => jiraAlertErrorEquivalenceMatches(text, target));
          if (!equivalentAlert) return false;
          observedText = equivalentAlert;
          return true;
        }
        observedText = usable[0].text;
        return true;
      };
      const aiBudget = { remaining: 1 };
      if (!await observeAssertion()) {
        // Deterministic visible-text matching stays authoritative when it works.
        // For a semantic wording mismatch, Jira may accept only a high-confidence
        // AI judgment backed by sanitized, currently visible DOM evidence.
        const semantic = await resolveJiraDomAssertion(page, target, { skipAiWhenNoTable: true, aiBudget }).catch(() => ({ supported: false, evidenceTexts: [] }));
        if (semantic.supported) {
          previousActionWasClick = false;
          return { observedText: semantic.evidenceTexts.join(" · ") };
        }
      }
      // The page may still be loading (spinner) when the first semantic check runs. Polls re-run the
      // deterministic and structural-table checks; the AI fallback is bounded to one call per assertion
      // (shared aiBudget), and an absent table for a pure table-presence assertion never reaches it.
      let semanticEvidence: string | undefined;
      await expect.poll(async () => {
        if (await observeAssertion()) return true;
        const semantic = await resolveJiraDomAssertion(page, target, { skipAiWhenNoTable: true, aiBudget }).catch(() => ({ supported: false, evidenceTexts: [] }));
        if (!semantic.supported) return false;
        semanticEvidence = semantic.evidenceTexts.join(" · ");
        return true;
      }, { timeout: previousActionWasClick ? 90000 : 15000 }).toBe(true).catch(async () => {
        // Preserve the failed oracle; report a directly observed login rejection
        // instead of attributing every blocked destination to text matching.
        if (await observeJiraCredentialRejection(page).catch(() => false)) throw new Error("JIRA_AUTHENTICATION_REJECTED");
        throw new Error("JIRA_ASSERTION_NOT_SATISFIED");
      });
      previousActionWasClick = false;
      return { observedText: semanticEvidence ?? observedText };
    },
  };
}

/** Jira orchestration: every setup action must be declared and verified in the live browser. */
export async function discoverJiraScenario(input: JiraScenarioInput, browser: JiraBrowserPort, values: Record<string, string> = {},
  progress: (index: number, phase: string) => void | Promise<void> = () => {}, cancelled: () => boolean = () => false,
  onInitialReady: () => void | Promise<void> = () => {}, implicitLogin?: JiraImplicitLogin): Promise<JiraDiscoveredExecutionContract> {
  const sourceSteps = input.steps;
  input = {...input, steps: sourceSteps.map(normalizeJiraAssertionSyntax)};
  const reviewed = prepareJiraScenarioReview(input);
  if (reviewed.errors.length) throw new Error(reviewed.errors[0]);
  const missingInputs=[];
  for (const field of input.inputRequirements ?? []) {
    const value=values[field.key];
    if (field.required && (value===undefined || (field.dataCondition!=='invalid' && !value.trim()))) {
      missingInputs.push({key:field.key,label:field.label,stepIndex:field.stepIndex});
    }
  }
  if(missingInputs.length) throw new JiraRequiredDataError(missingInputs);
  if (jiraRepeatedAssertionBlocks(input.steps).length) throw new Error("JIRA_REPEATED_ASSERTION_BLOCK");
  input = reviewed.scenario;
  const steps: ExecutionPlanStep[] = [{ index: 1, action: "navigate", description: "Project entry", target: "APP_BASE_URL" }];
  const oracles: SpecGenerationObservableOracle[] = [];
  const entries: DataContextEntry[] = [];
  // Latest text value typed per authored field label (never auth.* credentials); binds row assertions to real input.
  const enteredFills = new Map<string, { value: string; valueKey?: string }>();
  let lastFill: { label: string; value: string; valueKey?: string } | undefined;
  let navigated = false;
  let nextIndex = 2;
  const normalizedPreconditions = normalizeJiraFrameworkPreconditions(input, input.appSlug ?? "");
  const preconditions = normalizedPreconditions.preconditions;
  if (preconditions.length) {
    if (!preconditions.every(value => /^\s*(?:precondici[oó]n:\s*)?(?:est[aá]\s+visible|se\s+muestra|visible)\s+["“][^"”]+["”]\s*\.?$/i.test(value))) {
      throw new Error("JIRA_PRECONDITION_NOT_OBSERVABLE");
    }
  }
  let classicLoginPerformed = false;
  // Offsets of authored clicks already performed on the login form before credentials.
  const preSelected = new Set<number>();
  // Labels of login controls already satisfied by the implicit classic login; a later authored click on one
  // that no longer exists is that same login (already done), not a second one.
  const satisfiedLoginControls = new Set<string>();
  const normalizeLabel = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  let residualAuthAfterIndex: number | undefined;
  if (input.authIntent === "full_authentication" && !browser.authenticate && !(implicitLogin && browser.observeClassicLogin)) throw new Error("JIRA_AUTH_FLOW_UNAVAILABLE");
  const texts = input.steps.flatMap((step, offset) => {
    const [action, expected] = step.split(/\nEsperado:\s*/i);
    const [sourceAction, sourceExpected] = (sourceSteps[offset] ?? step).split(/\nEsperado:\s*/i);
    const actionText = normalizeJiraAssertionSyntax(action);
    const expectedText = expected?.trim() ? normalizeJiraAssertionSyntax(`Validar ${expected}`) : undefined;
    const isScreenDescriptor = (value: string) => /(?:^|["“])pantalla\s+de\s+[^"”]+["”]/i.test(value);
    return [{ text: actionText, sourceIndex: offset + 1, authGate: isAuthGateRequirement(sourceAction),
      screenDescriptor: isScreenDescriptor(sourceAction) }, ...(expectedText ? [{ text: expectedText, sourceIndex: offset + 1,
        authGate: isAuthGateRequirement(`Validar ${sourceExpected ?? expected}`), screenDescriptor: isScreenDescriptor(sourceExpected ?? expected!) }] : [])];
  });
  const expectedResultAlreadyCoveredByGate = /autenticaci[oó]n|authentication/i.test(input.expectedResult ?? "")
    && texts.some(step => step.authGate || isAuthGateRequirement(step.text));
  const expectedResultAlreadyCoveredByExplicitAssertion = texts.some(({ text }) => {
    const target = explicitAssertionTarget(text);
    return Boolean(target && input.expectedResult?.toLocaleLowerCase().includes(target.toLocaleLowerCase()));
  });
  // An explicit row-match assertion (matching-row wording + named container) already verifies the same
  // filtered-row outcome that a prose expectedResult restates. Require the expected result to use the same
  // row wording, be non-negative, and not name a different quoted container.
  const rowWording = /\b(?:fila|row)\s+(?:coincidente|que\s+coincide|matching)\b/i;
  const expectedResultAlreadyCoveredByRowOracle = Boolean(input.expectedResult && rowWording.test(input.expectedResult)
    && classifyAssertionPolarity(input.expectedResult).polarity !== "negative"
    && texts.some(({ text, authGate }) => {
      if (authGate || !explicitAssertionTarget(text) || !rowWording.test(text)
        || classifyAssertionPolarity(text.replace(/["“'][^"”']+["”']/g, '"target"')).polarity === "negative") return false;
      const container = parseStepIntent(text).find(intent => intent.canonicalAssertion?.subject)?.canonicalAssertion?.subject;
      const expectedQuoted = [...input.expectedResult!.matchAll(/["“]([^"”]+)["”]/g)].map(match => match[1].toLocaleLowerCase());
      return Boolean(container) && expectedQuoted.every(value => value === container!.toLocaleLowerCase());
    }));
  // A prose rejection summary can describe the same two explicit oracles with
  // articles/contractions instead of quoted labels. Require BOTH polarities and
  // exact remaining subject words; never infer coverage from an error check alone.
  const rejectionSummary=input.expectedResult?.trim().match(/^Se informa (.+?) y no se (?:presenta|muestra) (.+?)[.]?$/i);
  const subjectWords=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(?:el|la|los|las|un|una|de|del|como)\b/g,'').replace(/[.]/g,'').replace(/\s+/g,' ').trim();
  const rejectionSummaryCovered=Boolean(rejectionSummary && [false,true].every(negative=>texts.some(({text})=>{
    const match=text.trim().match(/^(?:Validar|Verificar) que (no )?se muestre ["“]([^"”]+)["”][.]?$/i);
    return match && Boolean(match[1])===negative && subjectWords(match[2])===subjectWords(rejectionSummary[negative?2:1]);
  })));
  if (input.expectedResultMode !== "documentation" && input.expectedResult?.trim() && !expectedResultAlreadyCoveredByGate && !expectedResultAlreadyCoveredByExplicitAssertion && !expectedResultAlreadyCoveredByRowOracle && !rejectionSummaryCovered
    && !texts.some(s => s.text.replace(/^Validar\s+/i, "") === input.expectedResult)) {
    texts.push({ text: `Validar ${input.expectedResult}`, sourceIndex: input.steps.length + 1, authGate: false, screenDescriptor: false });
  }
  // Explicit login scenarios (positive or negative) own their credential entry.
  const declaresCredentialEntry = texts.some(({ text, authGate }) => authGate || isAuthGateRequirement(text)
    || parseStepIntent(text).some(intent => intent.type === "action_fill" && /contrase[nñ]a|password|usuario|username/i.test(intent.actionTarget ?? "")));
  for (const [offset, { text, sourceIndex }] of texts.entries()) {
    if (cancelled()) throw new Error("JIRA_CANCELLED");
    if (reviewed.skippedAssertionSteps.includes(sourceIndex)) {
      if (sourceIndex > input.steps.length || !/^\s*(?:Validar|Verificar) que se (?:muestre|muestren)\s+["“][^"”]+["”][.]?$/i.test(text)) throw new Error("JIRA_CONDITION_STEP_UNSUPPORTED");
      await progress(sourceIndex, "not_applicable");
      continue;
    }
    await progress(sourceIndex, "resolving");
    if (/\b(?:cuando aplique|si aplica|when applicable|if applicable|con la condici[oó]n de que|provided that)\b/i.test(text)) throw new Error("JIRA_TEST_CONDITION_UNDECLARED");
    const intents = parseStepIntent(text);
    const authGate = texts[offset].authGate || isAuthGateRequirement(text);
    const keyPress = text.match(/^(?:presionar|pulsar|press)\s+["'](Enter|Tab|Escape|ArrowUp|ArrowDown)["']\s+(?:en|in)\s+["']([^"']+)["']/i);
    const channelRequest = text.match(/^(?:Solicitar|Request)\s+(?:el\s+|un\s+)?(?:c[oó]digo|code|token)(?:\s+de\s+seguridad)?\s+(?:por|v[ií]a|by|via)\s+(SMS|correo electr[oó]nico|email)[.]?$/i);
    const intent = channelRequest ? {...intents[0],type:"action_click" as const,actionTarget:text.replace(/[.]$/, "")} : keyPress ? { ...intents[0], type: "action_press" as const, actionTarget: keyPress[2], value: keyPress[1] } : intents[0];
    if (!navigated) {
      await browser.navigate(); navigated = true;
      await onInitialReady();
      for (const precondition of preconditions) {
        const target = precondition.match(/["“]([^"”]+)["”]/)?.[1];
        if (!target || !browser.assertPrecondition) throw new Error("JIRA_PRECONDITION_NOT_OBSERVABLE");
        const observation = await browser.assertPrecondition(target);
        const index = nextIndex++;
        steps.push({ index, action: "assertVisible", description: precondition, target: { strategy: "text", value: target } });
        oracles.push({ id: `jira-precondition-${index}`, requirement: precondition, type: "literal_visible_text", backed: true,
          source: "discovery", stepIndex: index, target: observation.observedText, evidence: [`live-precondition-${index}`] });
      }
      // Profile credentials + an observed classic login form (loginMode=password) are
      // satisfied as recorded steps; the identification/OTP AuthFlow only covers gates
      // the classic form cannot. Public pages (no gate observed) skip login entirely.
      const wantsLogin = input.authIntent === "full_authentication" || (!input.authIntent && !declaresCredentialEntry);
      const observed = wantsLogin && implicitLogin ? await browser.observeClassicLogin?.() : undefined;
      const login = observed && observed.blocked === undefined ? observed : undefined;
      if (login && implicitLogin) {
        // Additional identified credential fields need their own configured value; never skip or guess one.
        const extras = (login.extra ?? []).map(field => ({ ...field, value: implicitLogin.fields?.[field.role] }));
        const missingExtra = extras.find(field => !field.value);
        if (missingExtra) throw new Error(`JIRA_LOGIN_DATA_MISSING:${missingExtra.role}`);
        // Leading authored clicks on controls already visible on the login form (e.g. a profile selector) belong BEFORE
        // credentials; later business steps are not visible yet, so the scan stops at the first one that is not.
        const loginLabels = new Set([login.username, login.password, login.submit, ...(login.extra ?? []).map(field => field.label)].map(normalizeLabel));
        for (const [pre, preText] of texts.entries()) {
          if (/^(?:abrir|open) (?:la )?aplicaci[oó]n configurada(?: del proyecto)?[.!]?$/i.test(preText.text.trim())) continue;
          const preIntents = parseStepIntent(preText.text);
          const preTarget = preIntents.length === 1 && preIntents[0].type === "action_click" && !preText.authGate && !isAuthGateRequirement(preText.text) ? preIntents[0].actionTarget : undefined;
          if (!preTarget || loginLabels.has(normalizeLabel(preTarget)) || !browser.isLoginSelectorOption || !await browser.isLoginSelectorOption(preTarget)) break;
          const preStep: ExecutionPlanStep = { index: nextIndex++, action: "click", description: preText.text };
          preStep.target = await browser.act(preStep, preTarget, undefined, preText.text);
          steps.push(preStep);
          preSelected.add(pre);
        }
        for (const [target, valueKey, value] of [...extras.map(field => [field.label, `auth.${field.role}`, field.value] as const),
          [login.username, "auth.username", implicitLogin.username], [login.password, "auth.password", implicitLogin.password], [login.submit]] as const) {
          const loginStep: ExecutionPlanStep = { index: nextIndex++, action: valueKey ? "fill" : "click", description: valueKey ? `fill [${valueKey}]` : `click ${target}`, ...(valueKey ? { valueKey } : {}) };
          loginStep.target = await browser.act(loginStep, target, value, loginStep.description);
          steps.push(loginStep);
          if (valueKey) entries.push({ key: valueKey, value: value!, sensitive: true, source: "explicit_runtime_input" });
        }
        classicLoginPerformed = true;
        for (const label of [login.submit, login.username, login.password]) satisfiedLoginControls.add(normalizeLabel(label));
        // Credentials only advance to the next gate (e.g. SMS verification): authentication is not complete until
        // that stage is satisfied. When the scenario authors it (request/enter code) its own steps continue the
        // route; otherwise the configured AuthFlow finishes it from the observed stage.
        // Only an explicit ACTION (request/enter/confirm a code) counts; assertions that merely mention SMS/code/token do not.
        const authorsVerification = texts.some(({ text }) => jiraAuthorsVerification(text));
        // Same for an implicit login (no authIntent, no authored credential entry): business steps need the finished session.
        const observedStage = !authorsVerification && browser.authenticate ? await browser.observeAuthStage?.() : undefined;
        if (observedStage) {
          const authResult = await browser.authenticate!(observedStage);
          if (!authResult.success) throw new Error("JIRA_AUTHENTICATION_FAILED");
          residualAuthAfterIndex = nextIndex - 1;
        }
      } else if (input.authIntent === "full_authentication") {
        // The classic form is visible but not identifiable: only the real AuthFlow may continue; otherwise stop with the reason.
        if (observed?.blocked && !browser.authenticate) throw new Error(observed.blocked);
        const authResult = await browser.authenticate!();
        if (!authResult.success) throw new Error("JIRA_AUTHENTICATION_FAILED");
      }
    }
    if (preSelected.has(offset)) { await progress(sourceIndex, "passed"); continue; }
    if (classicLoginPerformed && !authGate && intent?.type === "action_click" && intent.actionTarget
      && satisfiedLoginControls.has(normalizeLabel(intent.actionTarget)) && browser.isTargetVisible && !await browser.isTargetVisible(intent.actionTarget)) {
      await progress(sourceIndex, "passed");
      continue;
    }
    const index = nextIndex++;
    // Only the fill authored immediately before this step may bind a search-driven row assertion.
    const precedingFill = lastFill;
    lastFill = undefined;
    if (authGate || intent?.type === "assertion") {
      // Never downgrade unsupported outcome semantics to a successful visibility check.
      const assertionStructure = text.replace(/["“'][^"”']+["”']/g, '"target"');
      // Negated row wording ("no aparezca la fila ...") must never reach assertRowMatch, whatever the polarity classifier says.
      const negative = classifyAssertionPolarity(assertionStructure).polarity === "negative"
        || /\b(?:fila|row)\b/i.test(assertionStructure) && /\b(?:no|not|never|nunca|ning[uú]n[a]?)\b/i.test(assertionStructure);
      const simpleAbsence = /^(?:Validar|Verificar) que no (?:se muestre|se muestren|aparezca|aparezcan)\s+["“][^"”]+["”][.]?$/i.test(text.trim());
      // Only an explicit "matching row" wording about a quoted container; counts and numbered/contained rows stay blocked.
      // validation_present is accepted only with the exact positive matching-row wording ("fila coincidente" / "fila con ... aparezca").
      const rowOracle = intent?.canonicalAssertion?.oracleType;
      const rowIntent = intent?.canonicalAssertion?.intent;
      const rowPhrase = !authGate && !negative
        && (rowOracle === "structural_row_count" || (!rowOracle && (!rowIntent || rowIntent === "validation_present")))
        && intent.rowScope === undefined
        && (/\b(?:fila|row)\s+(?:coincidente|que\s+coincide|matching)\b/i.test(assertionStructure)
          || (rowIntent === "validation_present" && /\b(?:fila|row)\s+con\b[^]*\baparezc\w*/i.test(assertionStructure)));
      // Container: final quoted name after "en"; else the explicit "en la lista <Name>" closing form (capitalized, <=4 words); else the canonical subject
      // only when it is not one of the quoted field labels. Never inferred from other prose.
      const quotedAll = [...text.matchAll(/["“]([^"”]+)["”]/g)].map(match => match[1]);
      const finalQuoted = rowPhrase ? text.trim().match(/^[^]*\b(?:en|in)\s+["“]([^"”]+)["”]\s*\.?$/i)?.[1] : undefined;
      const rowSubject = intent?.canonicalAssertion?.subject;
      const rowContainer = finalQuoted
        ?? (rowPhrase ? text.trim().match(/\b(?:en\s+la\s+(?:lista|tabla)|in\s+the\s+(?:list|table))\s+(\p{Lu}[\p{L}\d]*(?:\s+[\p{L}\d]+){0,3})\s*\.?$/u)?.[1] : undefined)
        ?? (rowSubject && !(rowPhrase && [...quotedAll, ...[...enteredFills].map(([label]) => label)].some(label => normalizeLabel(label) === normalizeLabel(rowSubject))) ? rowSubject : undefined);
      const rowMatch = rowPhrase && Boolean(rowContainer);
      const downloadExpectation = !authGate && !negative ? parseJiraDownloadExpectation(text) : undefined;
      if (downloadExpectation) {
        if (!browser.assertDownload) throw new Error("JIRA_ASSERTION_CAPABILITY_UNSUPPORTED");
        if (downloadExpectation.tableBound) {
          if (!browser.observeVisibleTable) throw new Error("JIRA_ASSERTION_CAPABILITY_UNSUPPORTED");
          downloadExpectation.tableRows = await browser.observeVisibleTable();
          if (!downloadExpectation.tableRows) throw new Error("JIRA_DOWNLOAD_TABLE_UNOBSERVABLE");
        }
        const observation = await browser.assertDownload(downloadExpectation);
        steps.push({ index, action: "assertVisible", description: text, target: { strategy: "text", value: observation.filename } });
        oracles.push({ id: `jira-oracle-${index}`, requirement: text, type: "runtime_state", backed: true,
          source: "discovery", stepIndex: index, target: observation.filename, evidence: [`live-step-${index}`], details: observation });
        await progress(sourceIndex, "passed");
        continue;
      }
      if ((negative && !simpleAbsence) || intent?.canonicalAssertion?.intent === "transition_blocked"
        || ((intent?.canonicalAssertion?.oracleType || rowPhrase) && !rowMatch)) throw new Error("JIRA_ASSERTION_CAPABILITY_UNSUPPORTED");
      if (rowMatch) {
        if (!browser.assertRowMatch) throw new Error("JIRA_ASSERTION_CAPABILITY_UNSUPPORTED");
        const container = rowContainer!;
        // structural_row_count: entered non-sensitive fills whose label shares a meaningful word with the assertion.
        // Fallback (also the only source without oracleType): the immediately preceding search/filter fill (sensitive fills never reach either source).
        const assertionWords = new Set(normalizeLabel(assertionStructure).split(/[^a-z0-9]+/).filter(word => word.length >= 5 && word !== "target"));
        const overlapBound: Array<[string, { value: string; valueKey?: string }]> = rowOracle === "structural_row_count" || rowIntent === "validation_present"
          ? [...enteredFills].filter(([label]) => normalizeLabel(label).split(/[^a-z0-9]+/).some(word => word.length >= 5 && assertionWords.has(word)))
          : [];
        // Quoted field labels (other than the container) must each resolve to an entered fill; any missing one fails closed.
        const quotedLabels = [...text.matchAll(/["“]([^"”]+)["”]/g)].map(match => match[1]).filter(label => normalizeLabel(label) !== normalizeLabel(container));
        const labelBound = quotedLabels.map(label => [...enteredFills].find(([entered]) => normalizeLabel(entered) === normalizeLabel(label)));
        if (labelBound.some(entry => !entry)) throw new Error("JIRA_ROW_DATA_BINDING_MISSING");
        const bound: Array<[string, { value: string; valueKey?: string }]> = labelBound.length ? labelBound as Array<[string, { value: string; valueKey?: string }]>
          : overlapBound.length ? overlapBound
          : precedingFill && /search|filter|buscar|filtrar/.test(normalizeLabel(precedingFill.label)) ? [[precedingFill.label, precedingFill]] : [];
        if (!bound.length) throw new Error("JIRA_ROW_DATA_BINDING_MISSING");
        const observation = await browser.assertRowMatch(container, bound.map(([, fill]) => fill.value));
        // Spec carries value KEYS only (resolved at runtime like the fill steps); a binding without keys stays unsupported.
        const boundValueKeys = bound.map(([, fill]) => fill.valueKey).filter((key): key is string => Boolean(key));
        steps.push({ index, action: "assertVisible", description: text, target: { strategy: "text", value: container } });
        oracles.push({ id: `jira-oracle-${index}`, requirement: text, type: "runtime_state", backed: true,
          source: "discovery", stepIndex: index, target: container, evidence: [`live-step-${index}`],
          details: { ...observation, ...(boundValueKeys.length === bound.length ? { boundValueKeys } : {}) } });
        await progress(sourceIndex, "passed");
        continue;
      }
      const quotedTarget = text.match(/["“]([^"”]+)["”]/)?.[1];
      const columnHeader = !authGate && /\b(?:columna|column)\b/i.test(text);
      const target = authGate ? "authentication gate" : (columnHeader ? quotedTarget : undefined) ?? intent.canonicalAssertion?.subject ?? intent.actionTarget ?? quotedTarget;
      if (!target) throw new Error("JIRA_ASSERTION_TARGET_UNOBSERVABLE");
      const fieldValidation = !authGate && intent.canonicalAssertion?.intent === "validation_present"
        && /\b(?:campo|field)\b/i.test(text)
        && /\b(?:error|inv[aá]lid\w*|incomplet\w*|requerid\w*|validaci[oó]n)\b/i.test(text);
      if (fieldValidation) {
        if (!browser.assertValidation) throw new Error("JIRA_ASSERTION_CAPABILITY_UNSUPPORTED");
        const observation = await browser.assertValidation(target);
        steps.push({ index, action: "assertVisible", description: text, target: { strategy: "text", value: target } });
        oracles.push({ id: `jira-oracle-${index}`, requirement: text, type: "field_validation", backed: true,
          source: "discovery", stepIndex: index, target, evidence: [`live-step-${index}`], details: observation });
        continue;
      }
      if (negative) {
        if (!browser.assertAbsent || !oracles.some(oracle => oracle.polarity !== "negative" && oracle.backed)) throw new Error("JIRA_ABSENCE_REQUIRES_OBSERVED_CONTEXT");
        const observation = await browser.assertAbsent(quotedTarget!);
        steps.push({index,action:"assertVisible",description:text,target:{strategy:"text",value:quotedTarget!}});
        oracles.push({id:`jira-oracle-${index}`,requirement:text,type:"literal_visible_text",polarity:"negative",backed:true,source:"discovery",stepIndex:index,target:quotedTarget!,evidence:[`live-step-${index}`],details:observation});
        continue;
      }
      const automaticCondition=input.conditionRequirements?.find(requirement=>requirement.stepIndices.includes(sourceIndex)
        && typeof input.reviewConfiguration?.conditions?.[requirement.key]!=='boolean');
      let observation: Awaited<ReturnType<JiraBrowserPort['assert']>>;
      try { observation = await browser.assert(target, authGate, texts[offset].screenDescriptor, columnHeader); }
      catch (error) {
        if (automaticCondition && error instanceof Error && error.message==='JIRA_ASSERTION_NOT_SATISFIED') {
          throw new Error(`JIRA_CONDITION_APPLICABILITY_UNRESOLVED:${automaticCondition.subject}`);
        }
        throw error;
      }
      if (automaticCondition) await progress(sourceIndex,'condition_applies_observed');
      steps.push({ index, action: "assertVisible", description: text, target: { strategy: "text", value: target } });
      oracles.push({ id: `jira-oracle-${index}`, requirement: text, type: authGate ? "auth_gate" : "literal_visible_text", backed: true,
        source: "discovery", stepIndex: index, target: observation.observedText || target, evidence: [`live-step-${index}`], details: observation });
    } else if (intents.length !== 1 || !intent) throw new Error("JIRA_COMPOSITE_STEP_REQUIRES_EXPLICIT_ACTIONS");
    else if (/^(?:abrir|open) (?:la )?aplicaci[oó]n configurada(?: del proyecto)?[.!]?$/i.test(text.trim())) {
      // Project entry (+ implicit login) already opened the app live; replaying goto in the spec would drop that session.
      if (classicLoginPerformed) { nextIndex--; await progress(sourceIndex, "passed"); continue; }
      steps.push({ index, action: "navigate", description: text, target: "APP_BASE_URL" });
    } else if (intent.type === "setup_route") {
      const route = text.match(/https?:\/\/[^\s,]+/i)?.[0]
        ?? text.match(/(?:p[aá]gina|ruta|path|url)\s+(\/[^\s,]+)/i)?.[1]
        ?? intent.actionTarget;
      if (!route || route === "APP_BASE_URL") throw new Error("JIRA_ROUTE_NOT_DECLARED");
      if (!/^https?:\/\//i.test(route) && !route.startsWith("/")) throw new Error("JIRA_ROUTE_NOT_DECLARED");
      const baseUrl = browser.baseUrl;
      if (!baseUrl || !browser.navigateTo) throw new Error("JIRA_ROUTE_NAVIGATION_UNAVAILABLE");
      const resolved = new URL(route, baseUrl);
      // The Playwright adapter repeats this origin check immediately before navigation.
      if (resolved.origin !== new URL(baseUrl).origin || resolved.username || resolved.password) throw new Error("JIRA_ROUTE_OUTSIDE_APP_ORIGIN");
      await browser.navigateTo(resolved.toString());
      steps.push({ index, action: "navigate", description: text, target: { strategy: "url", value: resolved.toString() } });
    } else if (intent.type === "navigation_path") {
      for (const routeTarget of intent.path ?? []) {
        if (cancelled()) throw new Error("JIRA_CANCELLED");
        const routeStep: ExecutionPlanStep = { index: nextIndex++, action: "click", description: `Route: ${routeTarget}` };
        routeStep.target = await browser.act(routeStep, routeTarget);
        steps.push(routeStep);
      }
    } else if (/^(?:navegar|navigate|ir a|go to|abrir ruta|open route)\b/i.test(text.trim()) || intent.type === "precondition_context"
      || intent.type === "optional_action" || intent.type === "select_first_visible_item") {
      throw new Error(`JIRA_SETUP_OR_ACTION_POLICY_UNSUPPORTED:${intent.type}`);
    } else {
      const actions: Partial<Record<string, ExecutionPlanStep["action"]>> = { action_click: "click", action_submit: "click", action_fill: "fill", action_press: "press", action_select: "select" };
      const action = actions[intent.type];
      if (!action || !intent.actionTarget) throw new Error(`JIRA_UNSUPPORTED_INTENT:${intent.type}`);
      const intentionalClear = action === "fill" && intent.actionVerb === "clear";
      const field = input.inputRequirements?.find(requirement => requirement.stepIndex === sourceIndex && requirement.operation === action && requirement.label === intent.actionTarget);
      const valueKey = intentionalClear ? undefined : field?.key ?? intent.valueKey ?? (action === "fill" || action === "select" ? `jira_step_${offset + 1}` : undefined);
      const value = intentionalClear ? "" : valueKey ? values[valueKey] ?? intent.value : intent.value;
      if ((action === "fill" || action === "select" || action === "press") && value === undefined) throw new JiraRequiredDataError([{key:valueKey ?? '',label:intent.actionTarget,stepIndex:sourceIndex}]);
      // Never retain credential literals in plans, events or generated source.
      const description = intentionalClear ? `clear ${intent.actionTarget}` : action === "fill" || action === "select" ? `${action} [${valueKey}]` : text;
      const step: ExecutionPlanStep = { index, action, description, ...(valueKey ? { valueKey } : {}), ...(action === "press" || intentionalClear ? { value } : {}) };
      step.target = await browser.act(step, intent.actionTarget, value, text);
      if (step.target && typeof step.target === "object" && step.target.metadata?.repairType === "jira_segmented_code") {
        step.resolutionState = "runtime_resolution_required";
      }
      if (input.unresolvedUiRequirements?.some(item=>item.stepIndex===sourceIndex)) await progress(sourceIndex,"ui_target_observed");
      if (valueKey) entries.push({ key: valueKey, value: value!, sensitive: true, source: "explicit_runtime_input" });
      // Credential/auth/secret fields never become row-match evidence (no value, no key reaches the oracle).
      if (step.action === "fill" && value && !isSensitiveRowBindingField(intent.actionTarget, valueKey)) {
        enteredFills.set(intent.actionTarget, { value, valueKey });
        lastFill = { label: intent.actionTarget, value, valueKey };
      }
      steps.push(step);
    }
    await progress(sourceIndex, "passed");
  }
  if (reviewed.skippedAssertionSteps.length && !oracles.some(oracle=>oracle.backed && oracle.polarity!=="negative")) throw new Error("JIRA_CONDITION_REQUIRES_MEANINGFUL_OUTCOME");
  const needsAuthFlow = residualAuthAfterIndex !== undefined || (input.authIntent === "full_authentication" && !classicLoginPerformed);
  const plan: ExecutionPlan = { version: "1.0", source: "discovery_generated", status: "validated", createdAt: new Date().toISOString(),
    scenario: { source: "jira", externalId: input.scenarioId, title: input.title }, steps,
    requiredData: entries.map(e => ({ key: e.key, required: true, resolved: true, sensitive: e.sensitive })) };
  return { plan, runtimeEntries: entries, sourceScenario: { title: input.title, steps: steps.map(s => ({ index: s.index, action: s.action,
    description: s.action === "navigate" ? (s.target === "APP_BASE_URL" ? "APP_BASE_URL" : typeof s.target === "object" ? s.target.value : s.description) : s.action.startsWith("assert") ? s.description : undefined,
    valueKey: s.valueKey, technicalTargetRefs: s.target && typeof s.target !== "string" ? [s.target.strategy === "role" ? `role:${s.target.role}|${s.target.name}` : `${s.target.strategy}:${s.target.value}`] : undefined })),
    // A classic login already recorded as plan steps must not be re-inserted as an AuthFlow call.
    observableOracles: oracles, auth: { required: needsAuthFlow, gateDetected: needsAuthFlow,
      ...(needsAuthFlow ? { insertionAfterStepIndex: residualAuthAfterIndex ?? 1, flowAlias: "defaultClient" } : {}) }, expectedResult: input.expectedResult } };
}
