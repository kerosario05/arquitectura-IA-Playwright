/**
 * Placeholders that say an outcome is NOT known: an AI-proposed variant nobody recorded, or a
 * scenario whose final screen was never observed. They are documentation for a reviewer, never
 * something to assert or to click.
 *
 * Run d947dcc9 (recording e52ee42c): the AI suggestion's final result "Resultado por confirmar;
 * requiere revisión humana" was parsed into an assertion target "; requiere revisión humana", and
 * the scenario failed although every action -- the new "Solicitud Digital" included -- passed.
 */
const PENDING_OUTCOME = /^\s*(?:resultado(?:\s+esperado)?\s+por\s+confirmar|hip[oó]tesis\s+pendiente(?:\s+de\s+revisi[oó]n)?)\b/i;

export function isPendingOutcomePlaceholder(text: string | undefined | null): boolean {
  return typeof text === "string" && PENDING_OUTCOME.test(text);
}
