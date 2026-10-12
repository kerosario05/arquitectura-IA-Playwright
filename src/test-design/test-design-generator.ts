import type { AiMessage, AiProvider } from "../ai/ai-provider.types";
import type { JiraIssueSource } from "../scenarios/scenario-types";
import { buildTestDesignMessages, type TestDesignPromptOptions } from "./test-design-prompt";
import type { TestDesignScenario } from "./test-design.types";
import { normalizeScenario, TestDesignValidationError } from "./test-design.validation";

/**
 * Turns one Jira story into manual test scenarios with the configured AI provider.
 *
 * The model's output is coerced into the stored shape and anything unusable is
 * dropped (no title, no steps). A response with nothing usable gets one retry
 * that tells the model what was wrong; a second failure is reported, never
 * papered over with placeholder scenarios.
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
};

export async function generateTestDesignScenarios(
  issue: JiraIssueSource,
  options: GenerateOptions,
): Promise<TestDesignScenario[]> {
  const messages: AiMessage[] = buildTestDesignMessages(issue, options);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await options.provider.completeJson({
      messages,
      temperature: 0.2,
      requireJson: true,
      requireJsonSchema: false,
      purpose: "test_design",
    });
    const scenarios = parseGeneratedScenarios(response.parsedJson);
    if (scenarios.length > 0) return scenarios;

    console.warn(
      `[test-design:ai] ${issue.key} intento ${attempt}: respuesta sin escenarios utilizables ` +
        `(${response.rawText.slice(0, 160).replace(/\s+/g, " ")})`,
    );
    messages.push(
      { role: "assistant", content: response.rawText.slice(0, 4000) },
      {
        role: "user",
        content:
          'La respuesta anterior no tiene escenarios válidos. Responde solo con el objeto JSON {"scenarios": [...]} ' +
          "con la forma indicada; cada escenario necesita title y al menos un paso con action y expected.",
      },
    );
  }

  throw new TestDesignGenerationError(
    `La IA no devolvió escenarios válidos para ${issue.key} después de 2 intentos`,
  );
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
