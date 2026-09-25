import type { AiProvider, AiUsageMetrics } from "../ai/ai-provider.types";
import type { RecordedEvent, SessionTrace, TraceSegment } from "./session-trace.types";
import { capTitle, type RecordedScenario } from "./trace-to-scenario";
import { isSensitiveRecordedEvent } from "./semantic-recording";
import {
  RECORDING_AI_SCENARIO_SCHEMA,
  RECORDING_AI_SCENARIO_SCHEMA_NAME,
  recordingAiSchemaInstruction,
  validateRecordingAiScenarioResponse,
  type RecordingAiScenarioProposal,
  type RecordingAiScenarioRejected,
} from "./ai-scenario-contract";

/**
 * Adds the judgement a recording cannot supply on its own.
 *
 * The boundary here is deliberate and narrow: the AI is asked what the walkthrough MEANT —
 * the user story behind it, a title a QA would recognise, extra negative cases the observed
 * gates justify — and never what the steps ARE. Steps, targets and locators stay exactly as
 * recorded, because those came from a real element on a real screen and a model rewriting
 * them can only make them less true.
 *
 * Everything degrades cleanly: with no provider, or a provider that fails, the deterministic
 * scenario built from the trace stands on its own.
 */

export type AiNegative = {
  title: string;
  description: string;
  steps: Array<{ content: string; expected: string }>;
  /** The control or message from the transcript the case rests on. */
  basedOn: string;
};

export type TraceNarrativeResult = {
  narrative: string;
  story: { title: string; description: string; preconditions: string[] } | null;
  extraNegatives: AiNegative[];
  aiProposals: RecordingAiScenarioProposal[];
  aiRejected: RecordingAiScenarioRejected[];
  schemaValid: boolean;
  fallbackUsed: boolean;
  contextBeforeChars?: number;
  contextAfterChars?: number;
  usage?: AiUsageMetrics;
};

/**
 * A plain-text rendering of the walkthrough, written without a model.
 *
 * This is what survives after the frames are deleted, so it has to stand alone: screen by
 * screen, what the user did and where the app went. It is also what the AI reads — a
 * transcript is a far more reliable prompt input than an event array.
 */
export function renderWalkthrough(
  trace: SessionTrace,
  segments: readonly TraceSegment[],
): string {
  const lines: string[] = [];
  lines.push(`Recorrido grabado en ${trace.platform === "android" ? "aplicación Android" : "aplicación web"}: ${trace.appSlug}`);
  if (trace.label) lines.push(`Etiqueta del recorrido: ${trace.label}`);
  lines.push("");

  for (const segment of segments) {
    lines.push(`Pantalla ${segment.index + 1}: ${segment.title}`);
    for (const event of segment.events) {
      const label = event.target?.label?.trim();
      switch (event.kind) {
        case "tap":
          lines.push(
            `  - El usuario presionó "${label ?? "un control"}"${event.target?.enabled === false ? " (el control estaba deshabilitado)" : ""}`,
          );
          break;
        case "fill":
          lines.push(
            event.redactedKey
              ? `  - El usuario ingresó un valor sensible en "${label ?? "un campo"}" (${event.redactedKey})`
              : `  - El usuario ingresó "${event.value ?? ""}" en "${label ?? "un campo"}"`,
          );
          break;
        case "screen_change":
          lines.push(`  - La aplicación navegó a otra pantalla`);
          break;
        case "swipe":
          lines.push(`  - El usuario desplazó la pantalla`);
          break;
        case "note":
          if (event.note) lines.push(`  - (${event.note})`);
          break;
        default:
          break;
      }
    }
    const screen = trace.screens.find((s) => s.screenKey === segment.screenKey);
    const gated = screen?.controls.filter((c) => c.enabled === false).map((c) => c.label) ?? [];
    if (gated.length > 0) {
      lines.push(`  Controles deshabilitados observados: ${gated.join(", ")}`);
    }
    const texts = screen?.texts.slice(0, 6) ?? [];
    if (texts.length > 0) lines.push(`  Textos visibles: ${texts.join(" | ")}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

const SYSTEM_PROMPT = [
  "Eres un analista QA. Recibes la transcripción de un recorrido REAL que una persona hizo sobre una aplicación.",
  "El escenario Primary ya fue construido determinísticamente desde la evidencia. Tu única tarea es proponer variantes adicionales del mismo objetivo, o devolver cero propuestas.",
  "CATEGORÍAS a considerar, siempre que la transcripción las respalde:",
  "- Campo obligatorio vacío o con formato inválido, cuando el recorrido llenó ese campo.",
  "- Código de validación (OTP) incorrecto, expirado o reenviado, cuando el recorrido lo usó.",
  "- Cancelar o volver a mitad del flujo, cuando la pantalla ofrece esa salida.",
  "- Reintentos y bloqueos tras varios intentos fallidos, cuando hay un control de reintento.",
  "- Sesión expirada o interrumpida, cuando el flujo requiere sesión.",
  "- Un control observado deshabilitado que debe seguir bloqueado.",
  "Propón escenarios adicionales solo si el modelo semántico y el objetivo los sostienen. Menos es correcto, incluso cero.",
  "REGLAS ESTRICTAS:",
  "- No inventes pantallas, controles ni datos que no aparezcan en la transcripción.",
  "- No propongas pasos técnicos ni selectores: los pasos ejecutables ya existen y no se tocan.",
  "- Cada propuesta debe anclarse a sourceEvidenceRefs presentes en el contexto.",
  "- sharedSetupRef debe ser el scenarioId del Primary y steps debe ser el camino completo materializado; scenarioSpecificSteps contiene solo la variante.",
  "- Nunca uses frases vagas como 'completar los demás campos', 'llenar datos requeridos' o 'continuar normalmente'.",
  "- No generes negativos solo porque existe un campo. Requieren constraint/evidence explícita; si no existe, recházalos.",
  "- No inventes resultados como 'el sistema rechaza' o 'solicita corregir'. Usa oracleAuthority=AI_HYPOTHESIS, hypothesis=true y needsReview=true, o rechaza.",
  "- Una variante debe conservar el proceso del objetivo y poder llegar desde el inicio usando el setup común.",
  "- Nunca reproduzcas valores sensibles; refiérete a ellos por su nombre de campo.",
  "- Responde en español.",
  "- La respuesta debe cumplir exactamente el esquema canónico incluido en la petición.",
].join("\n");

/** Case- and accent-insensitive form, so an anchor matches the transcript as a person reads it. */
function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keeps only the negatives anchored on something the recording actually saw.
 *
 * The prompt asks for an anchor; this is what makes the ask binding. A model told to invent
 * nothing still occasionally proposes the case that SHOULD exist — a "reenviar código" button
 * on a screen that has none — and a fabricated case is worse than a missing one, because it
 * reaches TestRail looking exactly like the observed ones.
 */
function isAnchored(basedOn: string, transcript: string): boolean {
  const anchor = normalizeForMatch(basedOn);
  if (anchor.length < 3) return false;
  return normalizeForMatch(transcript).includes(anchor);
}

/**
 * Context sent to the suggester. It is intentionally a semantic projection, not a trace dump:
 * raw DOM, locator candidates, screenshots and repeated observations remain available in the
 * stored technical model for review/MCP, but do not spend generation tokens.
 */
export function buildCompactSemanticAiContext(
  trace: SessionTrace,
  segments: readonly TraceSegment[],
  happyPath: RecordedScenario,
): { context: string; beforeChars: number; afterChars: number } {
  const events = trace.events.filter((event) => ["tap", "fill", "screen_change", "navigate"].includes(event.kind));
  const latestByControl = new Map<string, RecordedEvent>();
  for (const event of events) {
    if (event.kind !== "fill") continue;
    const key = [event.screenKey, event.target?.rowIdentity ?? "", event.target?.associatedField ?? event.target?.label ?? ""].join("|");
    latestByControl.set(key, event);
  }
  const actions = [...latestByControl.values()];
  for (const event of events) if (event.kind !== "fill") actions.push(event);
  const compact = {
    recordingGoal: trace.recordingGoal?.declaredGoal ?? trace.recordingGoal?.normalizedGoal ?? null,
    primaryScenario: {
      scenarioId: happyPath.scenarioId,
      title: happyPath.title,
      functionalSteps: happyPath.testRailSteps.filter((step) => step.classification === "FUNCTIONAL_ACTION").map((step) => ({ content: step.content, expected: step.expected })),
      observedSetup: happyPath.preconditions,
      observedNavigation: happyPath.testRailSteps.filter((step) => /abrir|navegar|gestión|crear|pantalla|muestra/i.test(step.content)).map((step) => step.content),
      observedActions: happyPath.testRailSteps.filter((step) => step.classification === "FUNCTIONAL_ACTION").map((step) => step.content),
      observedOutcome: happyPath.testRailSteps.at(-1)?.expected,
    },
    semanticComponents: happyPath.requiredData.map((field) => ({
      valueKey: field.key,
      semanticField: field.semanticField ?? field.label,
      valueRole: field.valueRole,
      needsReview: field.needsReview ?? false,
    })),
    observedChoices: actions.filter((event) => event.target?.afterValue !== undefined || (event.target?.observedOptions?.length ?? 0) > 0).map((event) => ({
      ref: `event-${event.seq + 1}`,
      field: event.target?.associatedField ?? event.target?.headerContext ?? event.target?.label,
      selected: event.target?.afterValue,
      options: event.target?.observedOptions?.slice(0, 12),
    })),
    constraints: trace.events
      .map((event, index) => ({ ref: `event-${index + 1}`, attributes: event.target?.attributes }))
      .filter((item) => item.attributes && Object.keys(item.attributes).some((key) => /required|pattern|min|max|length|step/i.test(key)))
      .slice(0, 40),
    screens: [...new Map(trace.screens.map((screen) => [screen.screenKey, {
      screenKey: screen.screenKey,
      title: screen.title === screen.screenKey ? undefined : screen.title,
      grid: screen.gridMetadata?.detected ? {
        rows: screen.gridMetadata.rows,
        cells: screen.gridMetadata.cells,
        headers: screen.gridMetadata.headers,
        headerRelationships: screen.gridMetadata.headerRelationships,
      } : undefined,
    }])).values()],
    primaryFunctionalActions: actions.slice(0, 100).map((event) => ({
      ref: `event-${event.seq + 1}`,
      action: event.kind,
      field: event.target?.associatedField ?? event.target?.headerContext ?? event.target?.label,
      role: event.target?.role,
      value: event.kind === "fill" && !isSensitiveRecordedEvent(event) ? event.value : undefined,
      selectedOption: event.target?.afterValue,
      observedOptions: event.target?.observedOptions?.slice(0, 12),
      row: event.target?.rowIdentity,
      column: event.target?.columnIdentity,
    })),
    deterministicCandidates: happyPath.testRailSteps.filter((step) => step.classification === "FUNCTIONAL_ACTION").map((step) => step.content),
    unresolvedSemantics: trace.screens.flatMap((screen) => screen.controls
      .filter((control) => !control.headerContext && !control.associatedField && control.label)
      .map((control) => ({ screenKey: screen.screenKey, label: control.label, role: control.role })))
      .slice(0, 40),
    stateTransitions: segments.flatMap((segment) => segment.exitsTo ? [{ from: segment.screenKey, to: segment.exitsTo }] : []),
  };
  const after = JSON.stringify(compact);
  return {
    context: after,
    beforeChars: JSON.stringify({ events: trace.events, screens: trace.screens }).length,
    afterChars: after.length,
  };
}

function buildUserPrompt(context: string, happyPath: RecordedScenario): string {
  return [
    "MODELO SEMÁNTICO COMPACTO DEL RECORRIDO REAL:",
    context,
    "",
    "PASOS FUNCIONALES DETERMINISTAS YA DERIVADOS (solo como contexto, no los modifiques):",
    happyPath.testRailSteps.map((s, i) => `${i + 1}. ${s.content} -> ${s.expected}`).join("\n"),
    "",
    "Devuelve EXCLUSIVAMENTE el objeto JSON que cumple este contrato canónico:",
    recordingAiSchemaInstruction(),
    "Cada sourceEvidenceRefs debe apuntar a refs event-N del modelo. No copies locators ni DOM.",
  ].join("\n");
}

/**
 * Turns the model's `negatives` array into scenarios, dropping every one that is not anchored.
 *
 * Exported for the test that matters most here: a hallucinated case must not survive parsing.
 */
export function parseNegatives(
  raw: unknown,
  transcript: string,
  onLog?: (line: string) => void,
): AiNegative[] {
  const items = Array.isArray(raw) ? raw : [];
  const kept: AiNegative[] = [];
  let discarded = 0;

  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const n = item as Record<string, unknown>;
    const steps = Array.isArray(n.steps)
      ? n.steps
          .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
          .map((s) => ({
            content: typeof s.content === "string" ? s.content : "",
            expected: typeof s.expected === "string" ? s.expected : "",
          }))
          .filter((s) => s.content.length > 0)
      : [];
    if (steps.length === 0) continue;

    const basedOn = typeof n.basedOn === "string" ? n.basedOn.trim() : "";
    if (!isAnchored(basedOn, transcript)) {
      discarded += 1;
      continue;
    }

    kept.push({
      title: typeof n.title === "string" ? n.title : "Escenario negativo",
      description: typeof n.description === "string" ? n.description : "",
      steps,
      basedOn,
    });
  }

  if (discarded > 0) {
    onLog?.(`[recording:ai] ${discarded} escenario(s) descartados: no se anclan a nada de la transcripción`);
  }
  return kept;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

function isTechnicalStoryDescription(value: string): boolean {
  return /(?:pantalla\s*\d+|screen(?:key)?|fingerprint|hash|[a-f0-9]{10,})/i.test(value);
}

/**
 * Asks the model for the story and the extra negatives.
 *
 * Returns the deterministic narrative plus whatever the model contributed. A malformed or
 * missing response is not an error path for the caller — it just means `story` is null and
 * the scenario keeps the title and description the trace already produced.
 */
export async function enrichFromTrace(
  trace: SessionTrace,
  segments: readonly TraceSegment[],
  happyPath: RecordedScenario,
  ai: AiProvider | undefined,
  onLog?: (line: string) => void,
): Promise<TraceNarrativeResult> {
  const narrative = renderWalkthrough(trace, segments);
  if (!ai) {
    onLog?.("[recording:ai] sin proveedor de IA; se conserva el escenario determinista");
    return { narrative, story: null, extraNegatives: [], aiProposals: [], aiRejected: [], schemaValid: false, fallbackUsed: true };
  }

  try {
    const compact = buildCompactSemanticAiContext(trace, segments, happyPath);
    onLog?.(`[recording:ai-context] beforeChars=${compact.beforeChars} afterChars=${compact.afterChars} beforeTokens≈${Math.ceil(compact.beforeChars / 4)} afterTokens≈${Math.ceil(compact.afterChars / 4)}`);
    onLog?.(`[recording:generator-audit] provider=${ai.providerType} model=${ai.model} purpose=scenario_generation promptFile=src/recording/trace-ai-enricher.ts#buildUserPrompt schemaFile=src/recording/ai-scenario-contract.ts parserFile=src/recording/ai-scenario-contract.ts skillUsed=false canonicalScenarioGeneratorUsed=false recordingGenerator=src/recording/trace-ai-enricher.ts duplicatedLogic=goal-scoped-quality-gate`);
    const response = await ai.completeJson({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(compact.context, happyPath) },
      ],
      temperature: 0.2,
      requireJson: true,
      requireJsonSchema: true,
      jsonSchema: {
        name: RECORDING_AI_SCENARIO_SCHEMA_NAME,
        schema: RECORDING_AI_SCENARIO_SCHEMA as unknown as Record<string, unknown>,
      },
      purpose: "scenario_generation",
    });
    const validation = validateRecordingAiScenarioResponse(response.parsedJson);
    if (!validation.valid || !validation.value) {
      throw new Error(`ai_provider_schema_invalid: ${validation.reason ?? "invalid canonical response"}`);
    }
    onLog?.(`[recording:ai] canonical response accepted provider=${response.providerName} model=${response.model} scenarios=${validation.value.scenarios.length} rejected=${validation.value.rejected.length} schemaValid=true`);
    return {
      narrative,
      story: null,
      extraNegatives: [],
      aiProposals: validation.value.scenarios,
      aiRejected: validation.value.rejected,
      schemaValid: true,
      fallbackUsed: false,
      usage: response.usage,
      contextBeforeChars: compact.beforeChars,
      contextAfterChars: compact.afterChars,
    };
  } catch (err) {
    onLog?.(
      `[recording:ai] contrato rechazado o IA no disponible (${err instanceof Error ? err.message : String(err)}); se conserva el escenario determinista fallbackUsed=true`,
    );
    return { narrative, story: null, extraNegatives: [], aiProposals: [], aiRejected: [], schemaValid: false, fallbackUsed: true };
  }
}

/** Applies the model's story to the deterministic scenario without touching its steps. */
export function applyStory(scenario: RecordedScenario, result: TraceNarrativeResult): RecordedScenario {
  if (!result.story) return scenario;
  return {
    ...scenario,
    // Capped here too: the model's title replaces the deterministic one, and nothing else
    // downstream would notice it exceeding what TestRail accepts.
    title: capTitle(result.story.title || scenario.title),
    description: result.story.description && !isTechnicalStoryDescription(result.story.description)
      ? result.story.description
      : scenario.description,
    preconditions: result.story.preconditions.length > 0 ? result.story.preconditions : scenario.preconditions,
  };
}
