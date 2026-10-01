import type { RecordedEvent, RecordedScreen, SessionTrace } from "./session-trace.types";
import { isGenericUnresolvedLabel } from "./trace-normalizer";

/**
 * The title of a recorded scenario, built from what the recording walked rather than from the
 * free text typed before recording ("roque 10", "Prueba"):
 *
 *   Desde <pantalla inicial>: <opción> > <opción> > <opción>
 *   Desde <pantalla inicial>: N recorridos: <opción>, <opción>     (several sessions in one take)
 *   Recorrido hasta <pantalla final>          (no meaningful choice, but a new screen reached)
 *
 * It is the format the first recording derivation used ("Desde ¡Hola!: Consulta de balance",
 * "Recorrido hasta Identificación del cliente"). The screen at the end of a kiosk flow is a poor
 * name on its own -- every product lands on the same "Más detalles del producto", and a session
 * often ends back at "¡Hola!" -- so the choices the person made are what tell two recordings
 * apart. Returns null when the recording carries neither; the caller falls back to the goal.
 */

// Long paths keep the first choice (where the flow went) and the last three (what it ended doing).
const MAX_PATH_ITEMS = 4;
const TAIL_ITEMS = 3;
const MAX_LABEL_LENGTH = 48;

// Moving back or erasing is navigation noise wherever it happens.
const BACK_NAVIGATION = /^(?:←|⬅|<)|^(?:volver|atr[aá]s|regresar|borrar|anterior)\b/i;
// Closing the session ends one walkthrough; a recording can hold several.
const SESSION_TEARDOWN = /^(?:finalizar|cerrar)\s+sesi[oó]n$|^(?:salir|terminar)$/i;
// Keypad digits, typed identifiers: values, not choices.
const VALUE_LIKE = /^[\d\s.,:/()+-]+$/;
// A tap that focuses a field ("Ingrese el número") is about to type, not choosing anything.
const FIELD_PROMPT = /^(?:ingres[ae]|escrib[ae]|digit[ae]|introduzc[ae]|introduce)\b/i;
const FIELD_ROLE = /^(?:textbox|searchbox|spinbutton|input|textarea|edittext)$/i;
// Actions every flow of an app ends with; the choice before them is what names a session.
const GENERIC_ACTION = /^(?:solicitar|generar turno|cancelar|continuar|aceptar|enviar|confirmar|siguiente|finalizar|listo|ok|guardar)$/i;

export function buildObservedScenarioTitle(
  trace: Pick<SessionTrace, "screens">,
  events: readonly RecordedEvent[],
): string | null {
  const screenByKey = new Map(trace.screens.map((screen) => [screen.screenKey, screen]));
  const firstScreenKey = events.find((event) => event.screenKey && screenByKey.has(event.screenKey))?.screenKey;
  const start = readableScreenTitle(firstScreenKey ? screenByKey.get(firstScreenKey) : trace.screens[0]);

  const sessions = choiceSessions(events.filter((event) => event.kind === "tap"), start);
  if (sessions.length === 1) {
    return `Desde ${start ?? "el inicio"}: ${formatPath(sessions[0])}`;
  }
  if (sessions.length > 1) {
    return `Desde ${start ?? "el inicio"}: ${sessions.length} recorridos: ${sessions.map(distinctiveChoice).join(", ")}`;
  }

  const lastScreenKey = [...events].reverse().find((event) => event.screenKey && screenByKey.has(event.screenKey))?.screenKey;
  const end = readableScreenTitle(lastScreenKey ? screenByKey.get(lastScreenKey) : trace.screens[trace.screens.length - 1]);
  if (end && end !== start) {
    return `Recorrido hasta ${end}`;
  }
  return null;
}

/** The meaningful choices of each walkthrough, split where the session was closed. */
function choiceSessions(taps: readonly RecordedEvent[], startTitle: string | null): string[][] {
  const sessions: string[][] = [[]];
  for (const tap of taps) {
    const label = choiceLabel(tap, startTitle);
    if (!label) continue;
    const current = sessions[sessions.length - 1];
    if (SESSION_TEARDOWN.test(label)) {
      if (current.length > 0) sessions.push([]);
      continue;
    }
    if (current.length === 0 || normalize(current[current.length - 1]) !== normalize(label)) current.push(label);
  }
  return sessions.filter((session) => session.length > 0);
}

function choiceLabel(tap: RecordedEvent, startTitle: string | null): string | null {
  const clean = tap.target?.label?.trim().replace(/\s+/g, " ").replace(/^["'«“]+|["'»”]+$/g, "");
  if (!clean || clean.length < 3) return null;
  if (isGenericUnresolvedLabel(clean) || VALUE_LIKE.test(clean)) return null;
  if (BACK_NAVIGATION.test(clean) || FIELD_PROMPT.test(clean) || FIELD_ROLE.test(tap.target?.role ?? "")) return null;
  if (startTitle && normalize(clean) === normalize(startTitle)) return null;
  return shorten(clean);
}

function formatPath(choices: readonly string[]): string {
  if (choices.length <= MAX_PATH_ITEMS) return choices.join(" > ");
  return [choices[0], "…", ...choices.slice(-TAIL_ITEMS)].join(" > ");
}

function distinctiveChoice(session: readonly string[]): string {
  return [...session].reverse().find((choice) => !GENERIC_ACTION.test(choice)) ?? session[session.length - 1];
}

function readableScreenTitle(screen: RecordedScreen | undefined): string | null {
  const title = screen?.title?.trim().replace(/\s+/g, " ").replace(/[.:;,\s]+$/, "");
  if (!title || title === screen?.screenKey || title.length < 3) return null;
  if (/hash|fingerprint|^[a-f0-9]{8,}$/i.test(title) || /^(?:screen|pantalla)[-_ ]?[a-f0-9]{6,}$/i.test(title)) return null;
  return shorten(title);
}

function shorten(value: string): string {
  if (value.length <= MAX_LABEL_LENGTH) return value;
  const cut = value.slice(0, MAX_LABEL_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_LABEL_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
