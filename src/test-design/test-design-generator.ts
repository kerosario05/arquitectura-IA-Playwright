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

type JiraGenerationCoverage = NonNullable<Awaited<ReturnType<typeof generateJiraScenarios>>["coverage"]>;

export type TestDesignGenerationResult = {
  scenarios: TestDesignScenario[];
  coverage: JiraGenerationCoverage;
};

function scenarioType(scenario: ValidatedScenario): TestDesignScenario["type"] {
  const text = [scenario.title, ...scenario.steps].join(" ");
  if (scenario.inputRequirements?.some((input) => input.dataCondition === "invalid" || input.dataCondition === "expired")
    || /\b(rechaz|inv[aá]lid|incorrect|expirad|vencid|denegad|no permite)\b/i.test(text)) return "negative";
  if (/\b(borde|l[ií]mite|frontera|boundary|edge)\b/i.test(text)) return "edge";
  if (/\b(regresi[oó]n|regression)\b/i.test(text)) return "regression";
  return "functional";
}

/** Same required-data summary the launcher shows (values and technical details never included). */
export function requiredTestDataSummary(requirements: readonly { label: string; stepIndex?: number; required?: boolean; dataCondition?: string }[]): string {
  const fields = requirements.filter((field) => field.required);
  if (!fields.length) return "";
  return "Datos de prueba requeridos:\n" + fields.map((field) => {
    const condition = field.dataCondition === "invalid" ? "no válido" : field.dataCondition === "expired" ? "vencido" : "válido";
    return `• ${field.label} · ${condition} · paso ${field.stepIndex}`;
  }).join("\n");
}

/** Projects the Jira engine's executable journey into Test Design's editable case shape. */
export function mapJiraScenariosToTestDesign(scenarios: ValidatedScenario[]): TestDesignScenario[] {
  return scenarios.map((scenario, index) => {
    const requirements = scenario.inputRequirements ?? [];
    const reviewErrors = (scenario.validation?.errors ?? []).filter(error => !error.startsWith('JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:'));
    const mapped = normalizeScenario({
      title: scenario.title,
      // Keep the same preconditions as the Jira launch contract (declared
      // preconditions plus the required-data summary Test Launch shows). A
      // generic environment note here would make the published case diverge
      // from the scenario that Test Launch executes.
      preconditions: [...scenario.preconditions, requiredTestDataSummary(requirements)]
        .filter((part) => part.trim()).join("\n\n"),
      // Runtime data stays in the separate data contract, just as in the launcher.
      // Preserve source-backed wording and invalid/expired qualifiers verbatim.
      steps: scenario.steps.map((step, stepIndex) => ({
        action: step,
        // The Jira contract carries one final oracle, not per-step outcomes.
        // Attach it only to the final step when that step is an assertion.
        expected: stepIndex === scenario.steps.length - 1 && /^validar\b/i.test(step.trim())
          ? scenario.expectedResult
          : "",
      })),
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
      // A story-wide coverage gap does not make each otherwise valid case bad.
      // Keep selection local to this case's execution contract.
      selectedForTestRail: reviewErrors.length === 0,
      selectedForJira: reviewErrors.length === 0,
    }, index, { origin: "ai" });
    mapped.jiraSourceScenario = scenario;
    mapped.jiraSourceScenarioId = typeof scenario.scenarioId === "string" && scenario.scenarioId.trim()
      ? scenario.scenarioId.trim()
      : undefined;
    // Acceptance coverage is story-level, not a defect in every individual
    // case. Keep case cards focused on actionable contract issues; the story
    // summary below reports the remaining coverage once.
    const warnings: string[] = [];
    warnings.push(...reviewErrors.map(error => `Revisar este caso antes de publicarlo: ${error}`));
    if (warnings.length) mapped.generationWarnings = warnings;
    return mapped;
  });
}

export async function generateTestDesignScenarios(
  issue: TestDesignJiraIssue,
  options: GenerateOptions,
): Promise<TestDesignScenario[]> {
  return (await generateTestDesignScenariosWithCoverage(issue, options)).scenarios;
}

export async function generateTestDesignScenariosWithCoverage(
  issue: TestDesignJiraIssue,
  options: GenerateOptions,
): Promise<TestDesignGenerationResult> {
  if (!options.appSlug.trim()) {
    throw new TestDesignGenerationError("Vincula un proyecto de automatización para cargar su conocimiento antes de generar escenarios");
  }
  // Use the same base Jira prompt as Test Launch. Retained cases are reconciled
  // after generation so an old title cannot change coverage planning or cache identity.
  const generationOptions: JiraScenarioGenerationOptions = {
    loadProjectKnowledge: true,
    useCache: true,
    additionalInstructions: options.instructions,
  };
  const generated = await generateJiraScenarios([issue], options.appSlug, options.provider, generationOptions);
  if (generated.rejected.length > 0) {
    const rejectionCounts = generated.rejected.reduce<Record<string, number>>((counts, item) => {
      const reason = item.reason.split(":")[0];
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {});
    const summary = Object.entries(rejectionCounts).map(([reason, count]) => `${reason}:${count}`).join(",");
    console.info(`[test-design:generation] ${issue.key} Jira engine excluded ${generated.rejected.length} non-launchable scenario(s) reasons=${summary}`);
  }
  return { scenarios: mapJiraScenariosToTestDesign(generated.scenarios), coverage: generated.coverage ?? [] };
}

/** Human-readable reason to retain generated cases for review without certifying the HU complete. */
export function testDesignReviewWarning(scenarios: TestDesignScenario[], coverage?: JiraGenerationCoverage): string | null {
  const legacyWarnings = scenarios.flatMap(scenario => scenario.generationWarnings ?? []);
  const caseWarnings = [...new Set(legacyWarnings
    .filter(warning => !/La generación quedó incompleta:|Cobertura de la HU pendiente:|Faltan criterios de aceptación:|JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE/i.test(warning.trim())))];
  const coverageErrors = scenarios.flatMap(scenario => {
    const source = scenario.jiraSourceScenario as ValidatedScenario | undefined;
    const errors = (source?.validation?.errors ?? []).filter(error => error.startsWith("JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:"));
    const warnings = (source?.validation?.warnings ?? []).filter(warning => warning.startsWith("Cobertura de la HU pendiente:"));
    return [...errors, ...warnings];
  });
  const warnings = [...new Set([...caseWarnings, ...coverageErrors])];
  const coverageIds = (coverage ?? []).filter(item => item.status === "incomplete")
    .flatMap(item => item.missingClauses.map(clause => clause.id));
  // Older saved drafts stored the story-level coverage banner on each case.
  // Preserve real AC ids from that text, but discard non-criterion tokens such
  // as ACTIONS; fresh coverage comes from the Jira engine result above.
  const legacyCoverageIds = legacyWarnings.flatMap(warning => warning.match(/\bAC\d+(?:\.\d+)*\b/gi) ?? []);
  const messages: string[] = [];
  // Match real acceptance-criterion identifiers only. A broad AC-prefix match
  // also captures words such as ACTIONS and renders them as missing criteria.
  const criteria = [...new Set([...coverageIds, ...legacyCoverageIds, ...warnings.flatMap(warning => warning.match(/\bAC\d+(?:\.\d+)*\b/gi) ?? [])])];
  if (!warnings.length && !criteria.length) return null;
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
