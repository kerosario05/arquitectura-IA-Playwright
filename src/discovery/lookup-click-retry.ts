/**
 * A lookup/validation button ("Depurar", "Buscar", "Validar", ...) asks a backend that can fail for a
 * moment and shows "intente nuevamente"; a person presses it again. Pressing a button that creates,
 * sends, pays or deletes again could repeat its effect, so those are never retried.
 */
const SIDE_EFFECT_ACTIONS = /\b(?:crear|guardar|finalizar|enviar|pagar|confirmar|eliminar|borrar|cancelar|anular|aprobar|rechazar|registrar|desembols\w*|generar|firmar|cargar|adjuntar|aceptar|continuar|siguiente|salir|solicitar|a[ñn]adir|agregar|nuevo|nueva)\b/i;

export const DEFAULT_CLICK_RETRIES = 3;

export function clickRetryBudget(env: NodeJS.ProcessEnv = process.env): number {
  if (env.DISCOVERY_CLICK_RETRY?.trim().toLowerCase() === "false") return 0;
  const configured = Number(env.DISCOVERY_CLICK_RETRIES);
  return Number.isInteger(configured) && configured >= 0 && configured <= 5 ? configured : DEFAULT_CLICK_RETRIES;
}

export function isRetryableLookupClick(action: { recordingActionType?: string; actionType?: string; target?: string }): boolean {
  const isClick = action.recordingActionType === "click" || action.actionType === "action_click";
  const target = (action.target ?? "").trim();
  return isClick && target.length > 0 && !SIDE_EFFECT_ACTIONS.test(target);
}
