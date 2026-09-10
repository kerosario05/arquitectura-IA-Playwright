import type { MobileElement, MobileScreen, MobileStepHint } from "./mobile-route-profile.types";

/**
 * Passthrough screens: informational steps whose only interaction is a single
 * "Continuar"-style button (welcome notices, terms summaries, "ya casi terminamos").
 *
 * They carry no functional decision, so a flow must traverse them automatically instead
 * of expecting the AI to model them — otherwise a registration flow stalls on a screen
 * where the only correct action is "press the one button that is there".
 *
 * A screen only qualifies when there is genuinely nothing else to do: any input, toggle
 * or second actionable control means the user has a real choice, and a gated button means
 * something must be satisfied first. Both cases are left for normal step generation.
 */

/**
 * Labels that advance a purely informational screen, matched on normalized text.
 *
 * Deliberately excludes "acepto"/"aceptar": those name consent rows ("Acepto los Términos
 * y condiciones y la Política de datos personales"), which are ticked by
 * mobile-consent-checkbox, not pressed as the screen's advance control. Treating them as
 * advances makes a walk press the checkbox row and never reach the real button.
 */
const CONTINUE_LABELS = [
  "continuar",
  "continua",
  "siguiente",
  "entendido",
  "comenzar",
  "empezar",
  "iniciar",
  "empecemos",
  "vamos",
  "next",
  "continue",
];

/** Roles that represent a real user decision rather than a plain advance. */
const DECISION_ROLES = new Set(["input", "toggle"]);

/** Roles that can advance a screen when tapped. */
const ACTIONABLE_ROLES = new Set(["button", "link"]);

/** Strips accents/case/punctuation so "Continúa!" and "continua" compare equal. */
export function normalizeLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * True only when the label IS an advance control, not merely one that contains such a word.
 *
 * Exact matching (after normalization strips punctuation, so ", Continuar" still matches)
 * is what keeps a long sentence that happens to open with an advance verb from being
 * pressed as a button — the failure that made a walk tap a consent row instead of
 * "Continuar".
 */
export function isContinueLabel(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const normalized = normalizeLabel(raw);
  if (!normalized) return false;
  return CONTINUE_LABELS.some((kw) => normalized === normalizeLabel(kw));
}

function isActionable(el: MobileElement): boolean {
  return ACTIONABLE_ROLES.has(el.role) && Boolean(el.locator?.value);
}

/**
 * Returns the single advance control when the screen is a pure passthrough, else null.
 * Exported so callers can both test the condition and build the step from one lookup.
 */
export function findPassthroughControl(screen: MobileScreen): MobileElement | null {
  const elements = screen.elements ?? [];
  if (elements.length === 0) return null;

  // Any real decision (a field to fill, a switch to flip) disqualifies the screen.
  if (elements.some((el) => DECISION_ROLES.has(el.role))) return null;

  const actionable = elements.filter(isActionable);
  if (actionable.length !== 1) return null;

  const only = actionable[0];
  // A gated control needs a precondition satisfied first — not a passthrough.
  if (only.gated === true) return null;
  if (!isContinueLabel(only.label)) return null;

  return only;
}

export function isPassthroughScreen(screen: MobileScreen): boolean {
  return findPassthroughControl(screen) !== null;
}

/** Builds the click that traverses a passthrough screen, or null when it is not one. */
export function buildPassthroughStep(screen: MobileScreen): MobileStepHint | null {
  const control = findPassthroughControl(screen);
  if (!control?.locator) return null;
  return {
    action: "click",
    description: `Avanzar la pantalla informativa "${screen.title}" con "${control.label}"`,
    target: { strategy: control.locator.strategy, value: control.locator.value },
  };
}

/**
 * Expands a flow's entry steps so every passthrough screen it crosses is traversed.
 * Screens already covered by an explicit step are left untouched, so hand-authored
 * flows keep priority over the inferred advance.
 */
export function withPassthroughSteps(
  entrySteps: MobileStepHint[],
  screensInOrder: MobileScreen[],
): MobileStepHint[] {
  const covered = new Set(
    entrySteps.map((st) => st.target?.value).filter((v): v is string => Boolean(v)),
  );
  const result = [...entrySteps];
  for (const screen of screensInOrder) {
    const step = buildPassthroughStep(screen);
    if (!step?.target) continue;
    if (covered.has(step.target.value)) continue;
    result.push(step);
    covered.add(step.target.value);
  }
  return result;
}
