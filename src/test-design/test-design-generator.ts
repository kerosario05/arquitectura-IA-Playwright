import type { AiProvider } from "../ai/ai-provider.types";
import type { TestDesignPromptOptions } from "./test-design-prompt";
import { generateJiraScenarios } from "../jira/jira-scenario-generator";
import type { JiraScenarioGenerationOptions } from "../jira/jira-scenario-generator";
import type { ValidatedScenario } from "../scenarios/scenario-types";
import type { TestDesignJiraIssue, TestDesignScenario } from "./test-design.types";
import { normalizeScenario, TestDesignValidationError } from "./test-design.validation";

/**
 * Uses the shared Jira generation/knowledge/coverage pipeline, then projects its
 * complete validated result into editable manual cases without rewriting actions.
 */

export class TestDesignGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDesignGenerationError";
  }
}

const TYPE_ALIASES: Record<string, string> = {
  funcional: "functional",
  positivo: "functional",
  happy_path: "functional",
  negativo: "negative",
  borde: "edge",
  limite: "edge",
  "límite": "edge",
  regresion: "regression",
  "regresión": "regression",
};

const PRIORITY_ALIASES: Record<string, string> = {
  baja: "low",
  media: "medium",
  alta: "high",
  critica: "critical",
  "crítica": "critical",
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Accepts the field spellings models drift into (`step`/`expectedResult` per step, Spanish enums). */
function coerceRaw(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const steps = Array.isArray(s.steps)
    ? s.steps.map((step) => {
        if (typeof step === "string") return { action: step, expected: "" };
        const v = (step ?? {}) as Record<string, unknown>;
        return {
          action: str(v.action) || str(v.step) || str(v.accion) || str(v.description),
          expected: str(v.expected) || str(v.expectedResult) || str(v.resultadoEsperado),
        };
      })
    : [];
  const type = str(s.type).toLowerCase();
  const priority = str(s.priority).toLowerCase();
  const preconditions = Array.isArray(s.preconditions)
    ? s.preconditions.filter((p) => typeof p === "string").join("\n")
    : str(s.preconditions);
  return {
    title: str(s.title).slice(0, 250),
    preconditions,
    steps,
    expectedResult: str(s.expectedResult) || str(s.expected),
    type: TYPE_ALIASES[type] ?? type,
    priority: PRIORITY_ALIASES[priority] ?? priority,
  };
}

export function parseGeneratedScenarios(json: unknown): TestDesignScenario[] {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).scenarios)
      ? ((json as Record<string, unknown>).scenarios as unknown[])
      : null;
  if (!list) return [];

  const scenarios: TestDesignScenario[] = [];
  list.forEach((item, index) => {
    const coerced = coerceRaw(item);
    if (!coerced) return;
    try {
      const scenario = normalizeScenario(coerced, index, { origin: "ai" });
      if (scenario.title && scenario.steps.length > 0) scenarios.push(scenario);
    } catch (err) {
      if (!(err instanceof TestDesignValidationError)) throw err;
      // One bad scenario does not sink the rest.
    }
  });
  return scenarios;
}

export type GenerateOptions = TestDesignPromptOptions & {
  provider: AiProvider;
  /** Project profile that scopes Jira's learned knowledge. Empty means no linked profile. */
  appSlug: string;
};

function scenarioType(scenario: ValidatedScenario): TestDesignScenario["type"] {
  const text = [scenario.title, ...scenario.steps].join(" ");
  if (scenario.inputRequirements?.some((input) => input.dataCondition === "invalid" || input.dataCondition === "expired")
    || /\b(rechaz|inv[aá]lid|incorrect|expirad|vencid|denegad|no permite)\b/i.test(text)) return "negative";
  if (/\b(borde|l[ií]mite|frontera|boundary|edge)\b/i.test(text)) return "edge";
  if (/\b(regresi[oó]n|regression)\b/i.test(text)) return "regression";
  return "functional";
}

/** Projects the Jira engine's executable journey into Test Design's editable case shape. */
export function mapJiraScenariosToTestDesign(scenarios: ValidatedScenario[]): TestDesignScenario[] {
  const errors = [...new Set(scenarios.flatMap(scenario => scenario.validation?.errors ?? []))];
  const reviewableErrors = errors.filter(error =>
    error.startsWith("JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:"));
  const unsupportedErrors = errors.filter(error => !reviewableErrors.includes(error));
  if (unsupportedErrors.length) {
    throw new TestDesignGenerationError(`El motor Jira no pudo validar todos los escenarios generados: ${unsupportedErrors.join("; ")}`);
  }
  return scenarios.map((scenario, index) => {
    const requirements = scenario.inputRequirements ?? [];
    const mapped = normalizeScenario({
      title: scenario.title,
      preconditions: scenario.preconditions.join("\n"),
      // Runtime data stays in the separate data contract, just as in the launcher.
      // Preserve source-backed wording and invalid/expired qualifiers verbatim.
      steps: scenario.steps.map(step => ({ action: step, expected: "" })),
      data: requirements.map((input) => ({
        key: input.key,
        label: input.label,
        value: "",
        sensitive: input.sensitive,
        description: input.dataCondition === "invalid" ? "Valor inválido para este caso"
          : input.dataCondition === "expired" ? "Valor vencido para este caso" : "",
        ...(input.dataCondition ? { condition: input.dataCondition } : {}),
      })),
      inputRequirements: requirements,
      acceptanceCriteriaRefs: scenario.acceptanceCriteriaRefs ?? [],
      expectedResult: scenario.expectedResult,
      priority: "medium",
      type: scenarioType(scenario),
      selectedForTestRail: true,
      selectedForJira: true,
    }, index, { origin: "ai" });
    const scenarioErrors = scenario.validation?.errors ?? [];
    const warnings: string[] = [];
    const missingCriteria = [...new Set(scenarioErrors
      .filter(error => error.startsWith("JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:"))
      .flatMap(error => error.split(":").slice(1).join(":").split(","))
      .filter(Boolean))];
    if (missingCriteria.length) warnings.push(`Faltan criterios de aceptación: ${missingCriteria.join(", ")}.`);
    if (warnings.length) mapped.generationWarnings = warnings;
    return mapped;
  });
}

export async function generateTestDesignScenarios(
  issue: TestDesignJiraIssue,
  options: GenerateOptions,
): Promise<TestDesignScenario[]> {
  if (!options.appSlug.trim()) {
    throw new TestDesignGenerationError("Vincula un proyecto de automatización para cargar su conocimiento antes de generar escenarios");
  }
  // Generate the complete HU before merging retained edits/published cases.
  // Excluding their titles makes the coverage checker see only a fragment.
  const generationOptions: JiraScenarioGenerationOptions = {
    loadProjectKnowledge: true,
    useCache: true,
    additionalInstructions: options.instructions,
  };
  const generated = await generateJiraScenarios([issue], options.appSlug, options.provider, generationOptions);
  if (generated.rejected.length > 0) {
    console.info(`[test-design:generation] ${issue.key} Jira engine excluded ${generated.rejected.length} non-launchable scenario(s)`);
  }
  return mapJiraScenariosToTestDesign(generated.scenarios);
}

/** Human-readable reason to retain generated cases for review without certifying the HU complete. */
export function testDesignReviewWarning(scenarios: TestDesignScenario[]): string | null {
  const warnings = [...new Set(scenarios.flatMap(scenario => scenario.generationWarnings ?? []))];
  if (!warnings.length) return null;
  const messages: string[] = [];
  const criteria = [...new Set(warnings.flatMap(warning => warning.match(/AC[\w.-]+/g) ?? []))];
  if (criteria.length) messages.push(`La generación quedó incompleta: faltan criterios ${criteria.join(", ")}.`);
  return `${messages.join(" ")} Se conservaron los escenarios como borradores; no se certificaron como completos.`;
}

/**
 * Combines a regeneration with what the story already holds. Kept: scenarios a
 * person wrote or edited, and any already published to TestRail (its case must
 * not be orphaned). Replaced: untouched AI output.
 */
export function mergeRegenerated(
  existing: TestDesignScenario[],
  generated: TestDesignScenario[],
): TestDesignScenario[] {
  const kept = existing.filter((s) => s.origin === "manual" || s.edited || s.testRailCaseId !== null);
  const keptTitles = new Set(kept.map((s) => s.title.trim().toLowerCase()));
  const fresh = generated.filter((s) => !keptTitles.has(s.title.trim().toLowerCase()));
  return [...kept, ...fresh];
}

export function keptScenarioTitles(existing: TestDesignScenario[]): string[] {
  return existing
    .filter((s) => s.origin === "manual" || s.edited || s.testRailCaseId !== null)
    .map((s) => s.title);
}
