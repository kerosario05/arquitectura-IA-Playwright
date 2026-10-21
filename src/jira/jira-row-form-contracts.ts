import type { JiraIssueSource } from "../scenarios/scenario-types";
import { jiraAcceptanceClauses, literalAlternativeBranches } from "./jira-source-clauses";

/**
 * Generic generation contracts for list/form criteria. Everything is derived from the acceptance
 * criteria text, the scenario steps and optional DOM evidence the caller observed (`candidate.observedUi`).
 * Missing evidence blocks the scenario with an explained requirement; nothing is invented.
 */
export interface JiraObservedUi {
  /** Rows (cells per row) seen in the list before any filter was applied. */
  rows?: string[][];
  /** Dialog/form container name and labels that exist only inside it (not in the page behind it). */
  dialog?: { name?: string; exclusiveLabels?: string[] };
  /** Values already present before the scenario starts (seed data). */
  existingValues?: string[];
}

export const JIRA_ROW_FORM_REQUIREMENTS: Record<string, string> = {
  JIRA_ROW_CELLS_UNBOUND: "Assert every required entered value in ONE row step (row wording naming all values), so the cells are tied to the same row.",
  JIRA_FILTER_EFFECT_UNPROVEN: "After the filter fill, assert that a non-matching row seen before the filter is absent (Validar que no se muestre \"<non-matching value>\").",
  JIRA_FILTER_EFFECT_EVIDENCE_REQUIRED: "No non-matching row was observed before the filter (observedUi.rows or an earlier visibility assertion); observe one so the filter effect can be proven.",
  JIRA_DIALOG_ANCHOR_EVIDENCE_REQUIRED: "No dialog/exclusive-field evidence was observed (observedUi.dialog); observe the dialog container or a label that exists only inside it.",
  JIRA_DIALOG_ANCHOR_MISSING: "Open/stays-open assertions must quote the observed dialog container or a label exclusive to it, not text that also exists behind the dialog.",
  JIRA_DUPLICATE_SETUP_REDUNDANT: "The duplicate value is already observed in the app: treat it as a precondition and do not create it first in the journey.",
  JIRA_DUPLICATE_ISOLATION_VIOLATED: "When the duplicate target is one field, every other field must use a new value that is not already observed, or the rejection may come from the wrong field.",
};

const fold = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const words = (text: string): string[] => fold(text).split(/[^a-z0-9]+/).filter(word => word.length >= 3);
const ASSERT = /^\s*(?:Validar|Verificar|Comprobar)\b/i;
const SAVE = /^\s*(?:presionar|clic|click|hacer clic|press)\b.*\b(?:guardar|crear|registrar|agregar|a[nñ]adir|enviar|save|create|register|add|submit)\b/i;
const ROW_WORD = /\b(?:fila|row)\b/i;
const FILTER_LABEL = /\b(?:buscar|busqueda|buscador|filtr\w*|search|filter)\b/;
const LIST_WORD = /\b(?:lista|listado|tabla|list|table)\b/;
const LIST_PRESENCE = /\b(?:aparec\w*|figur\w*|muestr\w*|visible\w*|contien\w*|incluy\w*|appear\w*|listed|shown|contains?|includes?)\b/;
const STAYS_OPEN = /\b(?:permanece|sigue|queda|remains?|stays?)\s+(?:abiert[oa]|open)\b/;
const OPENS_FORM = /\b(?:abre|abrir|muestra|mostrar|opens?|shows?)\b[^.]{0,40}\b(?:formulario|dialogo|modal|form|dialog)\b/;

type Fill = { index: number; value: string; label: string };
const fillOf = (step: string, index: number): Fill | undefined => {
  const match = step.match(/["“]([^"”]+)["”]\s+en\s+(?:el\s+)?(?:campo\s+)?["“]([^"”]+)["”]/i)
    ?? step.match(/^\s*(?:\d+[.)]\s*)?(?:Ingresar|Escribir|Digitar|Introducir|Buscar|Filtrar)\s+([^"“”]+?)\s+en\s+(?:el\s+)?(?:campo\s+)?["“]([^"”]+)["”]\s*\.?\s*$/i);
  return match ? { index, value: match[1].trim(), label: match[2].trim() } : undefined;
};
/**
 * The executable matching-row wording carries no literal values: Discovery binds every entered fill whose label
 * shares a >=5-letter word with the unquoted assertion text (same rule as the semantic executor).
 */
const rowStepBindsFill = (step: string, fill: Fill): boolean => {
  if (!/\b(?:fila|row)\s+(?:coincidente|que\s+coincide|matching)\b/i.test(step)) return false;
  const stepWords = new Set(fold(step.replace(/["“'][^"”']+["”]/g, " ")).split(/[^a-z0-9]+/).filter(word => word.length >= 5));
  return fold(fill.label).split(/[^a-z0-9]+/).some(word => word.length >= 5 && stepWords.has(word));
};
const quoted = (step: string): string[] => [...step.matchAll(/["“]([^"”]+)["”]/g)].map(match => match[1]);
const isFilterFill = (fill: Fill, step: string): boolean => FILTER_LABEL.test(fold(fill.label)) || /^\s*(?:Buscar|Filtrar)\b/i.test(step);
const stepsOf = (candidate: Record<string, unknown>): string[] => Array.isArray(candidate.steps) ? candidate.steps.filter((s): s is string => typeof s === "string") : [];

export function jiraObservedUi(candidate: Record<string, unknown>): JiraObservedUi {
  const raw = candidate.observedUi;
  return raw && typeof raw === "object" ? raw as JiraObservedUi : {};
}

/** Clauses of this issue the candidate claims (bare criterion, exact clause or branch ref). */
function claimedClauses(candidate: Record<string, unknown>, issue?: JiraIssueSource) {
  if (!issue) return [];
  const refs = (Array.isArray(candidate.acceptanceCriteriaRefs) ? candidate.acceptanceCriteriaRefs : []).filter((r): r is string => typeof r === "string").map(r => r.toUpperCase());
  return jiraAcceptanceClauses(issue).filter(clause => refs.some(ref => ref === clause.id.toUpperCase() || ref.startsWith(`${clause.id.toUpperCase()}.`) || ref === clause.id.split(".")[0].toUpperCase()));
}

export function jiraRowFormContractErrors(candidate: Record<string, unknown>, issue?: JiraIssueSource): string[] {
  const steps = stepsOf(candidate);
  const observed = jiraObservedUi(candidate);
  const clauses = claimedClauses(candidate, issue);
  const errors = new Set<string>();
  const fills = steps.flatMap((step, index) => { const fill = fillOf(step, index); return fill ? [fill] : []; });
  const dataFills = fills.filter(fill => !isFilterFill(fill, steps[fill.index]));
  const existing = new Set((observed.existingValues ?? []).map(fold));

  for (const clause of clauses) {
    const text = fold(clause.text);
    const filtering = FILTER_LABEL.test(text) && LIST_WORD.test(text);

    // (1) Values the clause says appear in the list must be asserted against one and the same row.
    if (!filtering && LIST_WORD.test(text) && LIST_PRESENCE.test(text)) {
      const clauseWords = new Set(words(clause.text));
      const required = dataFills.filter(fill => words(fill.label).some(word => clauseWords.has(word)));
      if (new Set(required.map(fill => fold(fill.value))).size >= 2) {
        const bound = steps.some(step => ASSERT.test(step) && ROW_WORD.test(step) && required.every(fill => fold(step).includes(fold(fill.value)) || rowStepBindsFill(step, fill)));
        if (!bound) errors.add("JIRA_ROW_CELLS_UNBOUND");
      }
    }

    // (2) A filter must be proven by a non-matching row seen before and absent after.
    if (filtering) {
      const filter = fills.find(fill => isFilterFill(fill, steps[fill.index]));
      if (filter) {
        const term = fold(filter.value);
        const nonMatching = (value: string) => !!fold(value) && !fold(value).includes(term) && !term.includes(fold(value));
        const observedCells = (observed.rows ?? []).filter(row => !row.some(cell => fold(cell).includes(term))).flat().filter(nonMatching);
        const seenBefore = steps.slice(0, filter.index).filter(step => ASSERT.test(step) && !/\bno\s+se\b/i.test(step)).flatMap(quoted).filter(nonMatching);
        const candidates = [...new Set([...observedCells, ...seenBefore])];
        if (!candidates.length) errors.add("JIRA_FILTER_EFFECT_EVIDENCE_REQUIRED");
        else {
          const absentAfter = steps.slice(filter.index + 1).filter(step => ASSERT.test(step) && /\bno\s+se\s+(?:muestr|present|list)\w*/i.test(step)).flatMap(quoted);
          if (!candidates.some(value => absentAfter.some(absent => fold(absent) === fold(value)))) errors.add("JIRA_FILTER_EFFECT_UNPROVEN");
        }
      }
    }

    // (3) Form open / stays-open claims are anchored to the dialog container or a label exclusive to it.
    if (STAYS_OPEN.test(text) || OPENS_FORM.test(text)) {
      const openSteps = steps.filter(step => ASSERT.test(step) && !/\bno\s+se\b/i.test(step));
      if (openSteps.length) {
        // Observed evidence wins; otherwise the form's own field labels (entered inside it, never a filter/search label nor text quoted before the form's first entry) are exclusive to it.
        // Text asserted after the control that opened the form (last non-assertion before the first entry) is inside the form, not behind it.
        const firstFill = dataFills[0]?.index ?? 0;
        let opener = firstFill - 1;
        while (opener >= 0 && ASSERT.test(steps[opener])) opener--;
        const behind = new Set(steps.slice(0, opener >= 0 ? opener + 1 : firstFill).flatMap(quoted).map(fold));
        const formLabels = dataFills.map(fill => fill.label).filter(label => !behind.has(fold(label)) && !fills.some(fill => isFilterFill(fill, steps[fill.index]) && fold(fill.label) === fold(label)));
        const observedAnchors = [observed.dialog?.name, ...(observed.dialog?.exclusiveLabels ?? [])].filter((v): v is string => !!v);
        const anchors = new Set((observedAnchors.length ? observedAnchors : formLabels).map(fold));
        if (!anchors.size) errors.add("JIRA_DIALOG_ANCHOR_EVIDENCE_REQUIRED");
        else if (!openSteps.some(step => quoted(step).some(label => anchors.has(fold(label))))) errors.add("JIRA_DIALOG_ANCHOR_MISSING");
      }
    }

    // (4) An observed duplicate is a precondition; a different field must not collide with seed data.
    if (/\b(?:duplicad\w*|duplicate|ya\s+existe|already\s+exists?|existente)\b/.test(text) && existing.size) {
      const firstSave = steps.findIndex(step => SAVE.test(step));
      if (firstSave >= 0 && dataFills.some(fill => fill.index > firstSave && existing.has(fold(fill.value)))) errors.add("JIRA_DUPLICATE_SETUP_REDUNDANT");
      for (const { field, literal } of literalAlternativeBranches(clause.text)) {
        const target = dataFills.find(fill => fold(fill.value) === literal && words(fill.label).includes(field));
        if (target && dataFills.some(fill => fold(fill.value) !== literal && existing.has(fold(fill.value)))) errors.add("JIRA_DUPLICATE_ISOLATION_VIOLATED");
      }
    }
  }
  return [...errors];
}
