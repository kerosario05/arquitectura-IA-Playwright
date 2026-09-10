import type { MobileScreenSnapshot, MobileObservedControl } from "./mobile-knowledge-extractor";
import type { AiProvider } from "../ai/ai-provider-factory";
import {
  decideNextAction,
  findActionableControls,
  findInputControls,
  inputControlToTarget,
  isSubmitLabel,
  isBlockedSubmitLabel,
  type LearnerDecision,
  type LearnerStopReason,
  type DecideOptions,
  type LearnerFieldData,
} from "./mobile-route-learner";
import { normalizeLabel } from "./mobile-passthrough-screen";

/**
 * Interpretive layer over the rule-based route learner.
 *
 * The deterministic `decideNextAction` only advances when the next step is unambiguous. When
 * it gives up on a *recoverable* stop (a form it will not invent data for, or an ambiguous set
 * of advance controls), this layer hands the screen — together with the user story's intent —
 * to an LLM, which picks among the REAL controls the screen exposes (never invents a locator)
 * or synthesizes valid input data. The submit guard still wins: the AI is never allowed to
 * press a control that commits the flow. If AI is disabled or fails, everything degrades to the
 * original deterministic decision, so behaviour is a strict superset of the rule-based walk.
 */

export type HuContext = {
  issueKey?: string;
  summary?: string;
  intent?: string;
  acceptanceCriteria?: string;
};

export type InterpretiveContext = {
  ai?: AiProvider;
  huContext?: HuContext;
};

/** Recoverable stops where consulting the AI is worthwhile.
 *
 *  `needs_input` belongs here even though the runner has a fill path for it: a screen with a
 *  form is not automatically a screen the story wants to fill. A registration story that lands
 *  on the login screen must LEAVE it through the sign-up control — filling user/password there
 *  walks away from the objective and traps the walk on one screen. The AI decides which of the
 *  two it is; when it answers `fill`, the runner's original fill path runs unchanged. */
const AI_RESOLVABLE: ReadonlySet<LearnerStopReason> = new Set<LearnerStopReason>([
  "ambiguous_choice",
  "no_actionable",
  "needs_input",
]);

function controlLabelOf(c: MobileObservedControl): string {
  return (c.contentDesc ?? c.locatorIdentity ?? c.businessLabel ?? c.label ?? "").trim();
}

function huBlock(hu: HuContext | undefined): string {
  if (!hu) return "Objetivo: (no especificado) — explora hacia el flujo principal.";
  const lines = [
    hu.issueKey ? `HU: ${hu.issueKey}` : null,
    hu.summary ? `Resumen: ${hu.summary}` : null,
    hu.intent ? `Intención: ${hu.intent}` : null,
    hu.acceptanceCriteria ? `Criterios de aceptación: ${hu.acceptanceCriteria}` : null,
  ].filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : "Objetivo: (no especificado)";
}

function parsedJsonOf(raw: string, parsed?: Record<string, unknown>): Record<string, unknown> | null {
  if (parsed && typeof parsed === "object") return parsed;
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Rule-based decision first; on a recoverable stop, ask the AI to choose among the screen's
 * real actionable controls. Returns a plain `LearnerDecision`, so the runner's existing
 * advance/stop handling is unchanged.
 */
export async function decideNextActionInterpreted(
  snapshot: MobileScreenSnapshot,
  opts: DecideOptions,
  ctx: InterpretiveContext,
  onLog?: (line: string) => void,
): Promise<LearnerDecision> {
  const base = decideNextAction(snapshot, opts);
  if (base.kind === "advance") return base;
  if (!ctx.ai || !AI_RESOLVABLE.has(base.reason)) return base;

  const stopBeforeSubmit = opts.stopBeforeSubmit !== false;
  const actionable = findActionableControls(snapshot, opts.appPackage);
  if (actionable.length === 0) return base;

  // A form screen offers a third answer: stay and fill it. Without the form the choice is
  // only tap/stop, so the option is only offered when the rules actually stopped on inputs.
  const hasForm = base.reason === "needs_input";
  const formFields = hasForm
    ? findInputControls(snapshot, opts.appPackage)
        .map((c, i) => `[${i}] ${controlLabelOf(c) || c.label || "(campo sin etiqueta)"}`)
        .join("\n")
    : "";

  const catalog = actionable
    .map((a, i) => `[${i}] ${a.label}${isBlockedSubmitLabel(a.label, opts.allowSubmitLabels) ? " [SUBMIT — no presionar]" : ""}`)
    .join("\n");

  const messages = [
    {
      role: "system" as const,
      content:
        "Eres un agente QA que navega una app Android para avanzar hacia el objetivo de una " +
        "historia de usuario (HU). En cada pantalla recibes el objetivo y la lista de controles " +
        "accionables (con índice). Elige UN control para avanzar hacia el objetivo. NUNCA elijas " +
        "un control marcado [SUBMIT] (confirma el flujo de forma irreversible). Si ningún control " +
        "acerca al objetivo, responde stop. Responde SOLO JSON." +
        (hasForm
          ? " Esta pantalla ADEMÁS tiene un formulario. Antes de completarlo, decide si ese " +
            "formulario pertenece al objetivo de la HU o si es de otro flujo: por ejemplo, una HU " +
            "de registro que aterriza en la pantalla de inicio de sesión NO debe completar usuario " +
            "y contraseña, debe SALIR de ahí tocando el control que lleva al registro. Responde " +
            '"fill" solo si completar ESE formulario es el siguiente paso del objetivo; responde ' +
            '"tap" si otro control acerca más al objetivo.'
          : ""),
    },
    {
      role: "user" as const,
      content:
        `${huBlock(ctx.huContext)}\n\n` +
        `Pantalla: ${snapshot.title ?? snapshot.screenKey}\n` +
        `Las reglas se detuvieron por: ${base.reason} (${base.detail ?? "-"})\n\n` +
        `Controles accionables:\n${catalog}\n\n` +
        (hasForm ? `Campos del formulario de esta pantalla:\n${formFields}\n\n` : "") +
        `Responde JSON: {"action":"tap"${hasForm ? '|"fill"' : ""}|"stop","controlIndex":<int si tap>,"reason":"<si stop o fill>"}`,
    },
  ];

  try {
    const res = await ctx.ai.completeJson({ messages, requireJson: true, temperature: 0, purpose: "route_learning_decision" });
    const json = parsedJsonOf(res.rawText, res.parsedJson);
    if (!json) return base;
    // The form is on the objective's path: hand back the untouched needs_input stop so the
    // runner fills it exactly as before.
    if (hasForm && json.action === "fill") {
      onLog?.(`[mobile:learn:ai] formulario en ruta al objetivo -> completar (${String(json.reason ?? "-")})`);
      return base;
    }
    if (json.action === "tap" && Number.isInteger(json.controlIndex)) {
      const chosen = actionable[json.controlIndex as number];
      if (!chosen) return base;
      if (stopBeforeSubmit && isBlockedSubmitLabel(chosen.label, opts.allowSubmitLabels)) {
        return { kind: "stop", reason: "submit_guard", detail: `IA eligió "${chosen.label}" pero confirma el flujo` };
      }
      onLog?.(`[mobile:learn:ai] resolvió ${base.reason} -> tap "${chosen.label}"`);
      return { kind: "advance", target: chosen.target, label: chosen.label };
    }
    if (json.action === "stop") {
      // On a form screen "stop" means no control advances the objective — the form itself is
      // then the only way forward, so fall back to the pre-existing fill path rather than
      // ending the walk on a screen the rules would have crossed.
      if (hasForm) {
        onLog?.(`[mobile:learn:ai] ningún control acerca al objetivo -> se completa el formulario (${String(json.reason ?? "-")})`);
        return base;
      }
      onLog?.(`[mobile:learn:ai] confirmó stop: ${String(json.reason ?? base.reason)}`);
      return { kind: "stop", reason: base.reason, detail: String(json.reason ?? base.detail ?? "") };
    }
  } catch (e) {
    onLog?.(`[mobile:learn:ai] fallo al decidir, se usa la regla: ${e instanceof Error ? e.message : String(e)}`);
  }
  return base;
}

/**
 * Asks the AI to synthesize values for the input fields on a screen the deterministic learner
 * would stop on (needs_input). Returns caller-style field data the runner feeds to
 * `resolveScreenData`, or null when AI is unavailable/unsure. Values are plausible, valid test
 * data (never real credentials); the submit guard downstream still prevents committing them.
 *
 * `callerData` is the data the user actually typed in the UI, and it is offered here because
 * `resolveScreenData` could not place it: it matches an entry to a field by LABEL, and some
 * fields have no label at all — a masked document field reports only whatever is typed in it.
 * The AI, which can read "this is the document field" from the story and the screen, is the
 * only thing that can bridge that gap. Without it the walk invents a document number that the
 * backend rejects, and the story is learned as a validation failure instead of a real route.
 */
export async function aiSynthesizeScreenData(
  snapshot: MobileScreenSnapshot,
  opts: DecideOptions,
  ctx: InterpretiveContext,
  onLog?: (line: string) => void,
  callerData?: LearnerFieldData[],
): Promise<LearnerFieldData[] | null> {
  if (!ctx.ai) return null;
  const inputs = findInputControls(snapshot, opts.appPackage);
  if (inputs.length === 0) return null;

  const fieldList = inputs
    .map((c, i) => `[${i}] ${controlLabelOf(c) || c.label || "(campo sin etiqueta)"}`)
    .join("\n");

  const realData = (callerData ?? []).filter((d) => (d.value ?? "").trim().length > 0);
  const realDataBlock = realData.length > 0
    ? `DATOS REALES QUE EL USUARIO YA INGRESO (prioridad absoluta sobre cualquier dato inventado):\n` +
      realData.map((d) => `- ${d.match} => "${d.value}"`).join("\n") +
      `\nEl texto antes de "=>" DESCRIBE el dato, no es la etiqueta del campo; decide tu a que campo corresponde.\n\n`
    : "";

  const messages = [
    {
      role: "system" as const,
      content:
        "Eres un agente QA que completa formularios de una app Android para avanzar en una " +
        "historia de usuario. Genera datos de PRUEBA válidos y con el formato EXACTO que el campo " +
        "espera. Reglas de formato: (1) respeta la máscara/placeholder que muestre el campo, " +
        "incluyendo separadores y cantidad de dígitos; (2) Cédula dominicana = 3 dígitos + '-' + 7 " +
        "dígitos + '-' + 1 dígito (ej. 402-1205951-0); (3) teléfono RD = 10 dígitos (ej. 8095551234); " +
        "(4) correos con formato válido. No uses datos reales de personas. Si un campo es una " +
        "selección (p.ej. tipo de documento), usa 'selectFirst' con la opción a elegir. " +
        "REGLA QUE MANDA SOBRE TODO LO ANTERIOR: si te dan datos reales del usuario, usa ESE valor " +
        "TEXTUALMENTE para el campo al que corresponda — un dato inventado hace fallar la validación " +
        "del backend y arruina el recorrido. Solo sintetiza un valor cuando ningún dato real aplique. " +
        "Responde SOLO JSON.",
    },
    {
      role: "user" as const,
      content:
        `${huBlock(ctx.huContext)}\n\n` +
        realDataBlock +
        `Pantalla: ${snapshot.title ?? snapshot.screenKey}\n\n` +
        `Campos a completar:\n${fieldList}\n\n` +
        `Responde JSON: {"fills":[{"fieldIndex":<int>,"value":"<dato válido>","selectFirst":"<opción a tocar antes, opcional>"}]}`,
    },
  ];

  try {
    const res = await ctx.ai.completeJson({ messages, requireJson: true, temperature: 0, purpose: "route_learning_fill" });
    const json = parsedJsonOf(res.rawText, res.parsedJson);
    const rawFills = json && Array.isArray((json as { fills?: unknown }).fills) ? (json as { fills: unknown[] }).fills : null;
    if (!rawFills) return null;

    const out: LearnerFieldData[] = [];
    for (const f of rawFills) {
      if (!f || typeof f !== "object") continue;
      const rec = f as Record<string, unknown>;
      const idx = rec.fieldIndex;
      if (!Number.isInteger(idx) || (idx as number) < 0 || (idx as number) >= inputs.length) continue;
      const label = controlLabelOf(inputs[idx as number]) || inputs[idx as number].label || "";
      const match = normalizeLabel(label);
      if (!match) continue;
      out.push({
        match,
        value: typeof rec.value === "string" ? rec.value : "",
        ...(typeof rec.selectFirst === "string" && rec.selectFirst.trim() ? { selectFirst: rec.selectFirst.trim() } : {}),
      });
    }
    if (out.length === 0) return null;
    onLog?.(`[mobile:learn:ai] sintetizó datos para ${out.length} campo(s)`);
    return out;
  } catch (e) {
    onLog?.(`[mobile:learn:ai] fallo al sintetizar datos: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
