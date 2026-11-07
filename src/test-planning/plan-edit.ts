import {
  danglingCoverageTitles,
  isScenarioUnchanged,
  parseTestPlan,
  renameScenarioReferences,
  serializeTestPlan,
  validateEditedScenarios,
  type ParsedTestPlan,
  type PlanExamples,
  type PlanScenario,
  type PlanStep,
} from "./test-plan-markdown";

/**
 * Applies the scenarios edited in the panel to the original plan text.
 * The panel sends the whole scenario list; ids that exist in the original are
 * edits/moves, unknown ids are new scenarios, and missing ids were deleted.
 */

export class PlanEditError extends Error {
  readonly code = "invalid_plan_edit";
}

export interface PlanEditStats {
  total: number;
  /** Original scenarios whose content changed. */
  edited: number;
  added: number;
  removed: number;
  /** True when only the order changed for some scenarios. */
  reordered: boolean;
}

export interface PlanEditResult {
  base: ParsedTestPlan;
  content: string;
  changed: boolean;
  stats: PlanEditStats;
  problems: Array<{ id: string; title: string; errors: string[] }>;
  /** Coverage-table titles that point to deleted scenarios. */
  danglingCoverage: string[];
}

const MAX_SCENARIOS = 500;
const MAX_TEXT = 4000;

function str(value: unknown, field: string, max = MAX_TEXT): string {
  if (typeof value !== "string") throw new PlanEditError(`${field} debe ser texto.`);
  if (value.length > max) throw new PlanEditError(`${field} es demasiado largo.`);
  // A newline would break the line-based Gherkin layout.
  return value.replace(/\r?\n/g, " ");
}

function strList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PlanEditError(`${field} debe ser una lista.`);
  return value.map((v, i) => str(v, `${field}[${i}]`));
}

/** Validates the untrusted body into PlanScenario objects. */
export function sanitizeScenarios(input: unknown): PlanScenario[] {
  if (!Array.isArray(input)) throw new PlanEditError("scenarios debe ser una lista.");
  if (input.length > MAX_SCENARIOS) throw new PlanEditError("Demasiados escenarios.");
  const ids = new Set<string>();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new PlanEditError(`Escenario ${index + 1} no válido.`);
    const s = raw as Record<string, unknown>;
    const id = str(s.id, "id", 80);
    if (!id || ids.has(id)) throw new PlanEditError(`Id de escenario repetido o vacío: ${id}`);
    ids.add(id);
    const steps: PlanStep[] = (Array.isArray(s.steps) ? s.steps : []).map((step: unknown, i: number) => {
      const st = (step ?? {}) as Record<string, unknown>;
      return { keyword: str(st.keyword, `steps[${i}].keyword`, 40).trim(), text: str(st.text, `steps[${i}].text`) };
    });
    const examples: PlanExamples[] = (Array.isArray(s.examples) ? s.examples : []).map((ex: unknown, i: number) => {
      const e = (ex ?? {}) as Record<string, unknown>;
      const rows = Array.isArray(e.rows) ? e.rows : [];
      return {
        keyword: str(e.keyword ?? "", `examples[${i}].keyword`, 40).trim(),
        name: str(e.name ?? "", `examples[${i}].name`, 200),
        header: strList(e.header, `examples[${i}].header`),
        rows: rows.map((row: unknown, r: number) => strList(row, `examples[${i}].rows[${r}]`)),
      };
    });
    return {
      id,
      comments: strList(s.comments, "comments"),
      tags: strList(s.tags, "tags").flatMap((t) => t.split(/\s+/)).filter(Boolean),
      keyword: str(s.keyword ?? "", "keyword", 60).trim(),
      title: str(s.title, "title", 500).trim(),
      steps,
      examples,
      locked: null,
    };
  });
}

export function applyPlanEdit(originalText: string, rawScenarios: unknown): PlanEditResult {
  const base = parseTestPlan(originalText);
  if (base.readOnlyReason) throw new PlanEditError(`Este plan es de solo lectura: ${base.readOnlyReason}`);
  const scenarios = sanitizeScenarios(rawScenarios);
  const originals = new Map(base.scenarios.map((s) => [s.id, s]));

  // Locked scenarios cannot be edited through the step editor; keep them verbatim.
  for (const scenario of scenarios) {
    const before = originals.get(scenario.id);
    if (before?.locked) {
      scenario.locked = before.locked;
      if (!isScenarioUnchanged(base, scenario)) {
        throw new PlanEditError(`El escenario "${before.title}" tiene líneas no soportadas y no se puede editar.`);
      }
    }
  }

  let head = base.head;
  for (const scenario of scenarios) {
    const before = originals.get(scenario.id);
    if (before && before.title.trim() !== scenario.title.trim()) {
      head = renameScenarioReferences(head, before.title.trim(), scenario.title.trim());
    }
  }

  const content = serializeTestPlan({ ...base, head }, scenarios);
  const keptIds = scenarios.filter((s) => originals.has(s.id)).map((s) => s.id);
  const originalOrder = base.scenarios.map((s) => s.id).filter((id) => keptIds.includes(id));
  const stats: PlanEditStats = {
    total: scenarios.length,
    edited: scenarios.filter((s) => originals.has(s.id) && !isScenarioUnchanged(base, s)).length,
    added: scenarios.filter((s) => !originals.has(s.id)).length,
    removed: base.scenarios.filter((s) => !scenarios.some((n) => n.id === s.id)).length,
    reordered: keptIds.join() !== originalOrder.join(),
  };
  return {
    base,
    content,
    changed: content !== originalText,
    stats,
    problems: validateEditedScenarios(base, scenarios),
    danglingCoverage: danglingCoverageTitles({ ...base, head }, scenarios),
  };
}
