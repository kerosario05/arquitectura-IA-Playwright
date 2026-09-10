import type { AiProvider } from "../ai/ai-provider.types";
import type { RecordedEvent, SessionTrace, TraceSegment } from "./session-trace.types";
import { capTitle, type RecordedScenario } from "./trace-to-scenario";

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
  "Tu tarea es reconstruir la historia de usuario que ese recorrido representa y proponer escenarios negativos.",
  "CATEGORÍAS a considerar, siempre que la transcripción las respalde:",
  "- Campo obligatorio vacío o con formato inválido, cuando el recorrido llenó ese campo.",
  "- Código de validación (OTP) incorrecto, expirado o reenviado, cuando el recorrido lo usó.",
  "- Cancelar o volver a mitad del flujo, cuando la pantalla ofrece esa salida.",
  "- Reintentos y bloqueos tras varios intentos fallidos, cuando hay un control de reintento.",
  "- Sesión expirada o interrumpida, cuando el flujo requiere sesión.",
  "- Un control observado deshabilitado que debe seguir bloqueado.",
  "Propón entre 4 y 8 escenarios negativos, solo los que la transcripción sostenga. Menos es correcto si no hay más.",
  "REGLAS ESTRICTAS:",
  "- No inventes pantallas, controles ni datos que no aparezcan en la transcripción.",
  "- No propongas pasos técnicos ni selectores: los pasos ejecutables ya existen y no se tocan.",
  "- Cada escenario negativo DEBE incluir 'basedOn' con el texto EXACTO del control o mensaje de la",
  "  transcripción en el que se apoya. Un escenario sin ese anclaje será descartado.",
  "- Nunca reproduzcas valores sensibles; refiérete a ellos por su nombre de campo.",
  "- Responde en español.",
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

function buildUserPrompt(walkthrough: string, happyPath: RecordedScenario): string {
  return [
    "TRANSCRIPCIÓN DEL RECORRIDO:",
    walkthrough,
    "",
    "PASOS EJECUTABLES YA DERIVADOS (solo como contexto, no los modifiques):",
    happyPath.testRailSteps.map((s, i) => `${i + 1}. ${s.content} -> ${s.expected}`).join("\n"),
    "",
    "Devuelve EXCLUSIVAMENTE un JSON con esta forma:",
    "{",
    '  "title": "titulo corto del escenario principal",',
    '  "description": "Como <rol> quiero <objetivo> para <beneficio>",',
    '  "preconditions": ["..."],',
    '  "negatives": [{ "title": "...", "description": "...", "basedOn": "texto exacto del control o mensaje", "steps": [{ "content": "...", "expected": "..." }] }]',
    "}",
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
    return { narrative, story: null, extraNegatives: [] };
  }

  try {
    const response = await ai.completeJson({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(narrative, happyPath) },
      ],
      temperature: 0.2,
      requireJson: true,
      purpose: "scenario_generation",
    });
    const parsed = response.parsedJson ?? {};
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    const negatives = Array.isArray(parsed.negatives) ? parsed.negatives : [];

    onLog?.(`[recording:ai] historia reconstruida (${response.providerName}/${response.model})`);

    return {
      narrative,
      story:
        title || description
          ? { title, description, preconditions: asStringArray(parsed.preconditions) }
          : null,
      extraNegatives: parseNegatives(negatives, narrative, onLog),
    };
  } catch (err) {
    onLog?.(
      `[recording:ai] la IA no pudo enriquecer el recorrido (${err instanceof Error ? err.message : String(err)}); se conserva el escenario determinista`,
    );
    return { narrative, story: null, extraNegatives: [] };
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
    description: result.story.description || scenario.description,
    preconditions: result.story.preconditions.length > 0 ? result.story.preconditions : scenario.preconditions,
  };
}
