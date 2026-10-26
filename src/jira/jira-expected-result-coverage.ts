import { parseStepIntent } from "../discovery/step-intent-parser";
import { classifyAssertionPolarity } from "../scenarios/canonical-scenario";

type ScenarioInput = {
  title?: string;
  expectedResult?: string;
  steps: string[];
  inputRequirements?: Array<{ key: string; label: string; stepIndex?: number; required?: boolean }>;
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

function assertionTargets(steps: string[]): Array<{ index: number; target: string }> {
  return steps.flatMap((step, index) => {
    if (!/^\s*(?:validar|verificar|comprobar|assert)\b/i.test(step)) return [];
    if (classifyAssertionPolarity(step).polarity === "negative") return [];
    const target = step.match(/["“]([^"”]+)["”]/)?.[1]?.trim();
    return target ? [{ index: index + 1, target }] : [];
  });
}

function actionTargets(steps: string[], types: string[]): Array<{ index: number; target: string; type: string }> {
  return steps.flatMap((step, offset) => parseStepIntent(step).flatMap(intent => {
    if (!types.includes(intent.type) || !intent.actionTarget) return [];
    return [{ index: offset + 1, target: intent.actionTarget, type: intent.type }];
  }));
}

/**
 * Prove that a generated narrative expected-result adds no oracle beyond the
 * scenario's authored, executable actions and assertions. The recognizers are
 * deliberately closed templates: an extra clause or an unobserved condition
 * remains a required runtime assertion.
 */
export function jiraExpectedResultCoveredByAuthoredSteps(input: ScenarioInput): boolean {
  const result = normalize(input.expectedResult ?? "");
  if (!result) return false;
  const steps = input.steps;
  const assertions = assertionTargets(steps);
  const clicks = actionTargets(steps, ["action_click", "action_submit"]);
  const fills = actionTargets(steps, ["action_fill", "action_select"]);
  const hasTarget = (list: Array<{ target: string }>, value: string) => list.some(item => normalize(item.target) === normalize(value));

  let match = result.match(/^(.+?) dirige directamente a (.+?)[.]?$/);
  if (match) {
    const [, source, destination] = match;
    return hasTarget(clicks, source) && hasTarget(assertions, destination);
  }

  match = result.match(/^el menu de (.+?) permite acceder a (.+?) y muestra (.+?)[.]?$/);
  if (match) {
    const [, role, destination, visibleTarget] = match;
    return normalize(input.title ?? "").includes(normalize(role))
      && clicks.some(item => normalize(item.target).includes(normalize(destination)))
      && hasTarget(assertions, visibleTarget);
  }

  if (/^la solicitud con el registro completo se guarda como borrador[.]?$/.test(result)) {
    const businessInputs = (input.inputRequirements ?? []).filter(item => item.required !== false
      && !/usuario|user|contrase[nñ]a|password|clave|token|otp/i.test(item.label));
    const authoredBusinessInputs = actionTargets(steps, ["action_fill", "action_select"])
      .filter(item => !/usuario|user|contrase[nñ]a|password|clave|token|otp/i.test(item.target));
    if (businessInputs.length !== authoredBusinessInputs.length) return false;
    const eachRequiredInputWasAuthored = businessInputs.length > 0 && businessInputs.every(field => {
      const step = field.stepIndex && steps[field.stepIndex - 1];
      return Boolean(step && parseStepIntent(step).some(intent => ["action_fill", "action_select"].includes(intent.type)
        && normalize(intent.actionTarget ?? "") === normalize(field.label)));
    });
    return eachRequiredInputWasAuthored
      && clicks.some(item => /guardar|save/.test(normalize(item.target)) && /borrador|draft/.test(normalize(item.target)))
      && assertions.some(item => /^(?:borrador|draft)$/.test(normalize(item.target)))
      && assertions.some(item => !/^(?:borrador|draft|usuario|contrase[nñ]a)$/.test(normalize(item.target)));
  }

  if (/^la direccion en cascada queda completa[.]?$/.test(result)) {
    const dependentSelections = fills.filter(item => item.type === "action_select"
      && /departamento|provincia|municipio|sector|region|address|state|city|district/i.test(item.target));
    return dependentSelections.length >= 3
      && assertions.some(item => /direcciones|direccion|address/i.test(item.target));
  }

  if (/^se muestran todas las secciones y la navegacion entre pestanas funciona[.]?$/.test(result)) {
    const tabClicks = clicks.filter(item => /flujo|registro|pestana|tab/i.test(item.target));
    const lastTabClick = Math.max(0, ...tabClicks.map(item => item.index));
    return assertions.length >= 5 && tabClicks.length >= 2
      && assertions.some(item => item.index > lastTabClick);
  }

  if (/^despues de presionar salir se muestra usuario en el login[.]?$/.test(result)) {
    const exit = clicks.find(item => /^(?:salir|cerrar sesion|log out|logout)$/.test(normalize(item.target)));
    return Boolean(exit && assertions.some(item => item.index > exit.index && /^(?:usuario|username|user)$/.test(normalize(item.target))));
  }

  if (/^se muestra el avance por etapas y la bitacora[.]?$/.test(result)) {
    return ["estado del flujo", "bitacora", "solicitud creada"].every(target => hasTarget(assertions, target));
  }

  match = result.match(/^la campana abre el listado filtrado por (.+?)[.]?$/);
  if (match) {
    const status = match[1];
    return clicks.some(item => /notificacion|notification/i.test(item.target))
      && assertions.some(item => /solicitudes|requests|listado|lista/i.test(item.target))
      && assertions.some(item => normalize(item.target) === normalize(status));
  }

  // A visible-outcome summary may include the action context that leads to the
  // asserted screen (for example, “Se muestra Registro de Datos para una nueva
  // solicitud”). Treat that prose as covered only when every meaningful term
  // is present in an authored visible assertion or an authored UI action. Any
  // additional outcome/condition still requires its own executable oracle.
  const visibleOutcome = result.match(/^(?:se\s+)?(?:muestra|muestran|presenta|presentan|aparece|aparecen)\s+(.+?)[.]?$/i);
  if (visibleOutcome) {
    const expectedTerms = conceptTokens(visibleOutcome[1]);
    const authoredTerms = new Set([...assertions, ...clicks, ...fills]
      .flatMap(item => conceptTokens(item.target)));
    return expectedTerms.length > 0 && expectedTerms.every(term => authoredTerms.has(term));
  }

  return false;
}

const targetOf = (step: string) => /^\s*(?:validar|verificar|comprobar|assert)\b/i.test(step)
  && classifyAssertionPolarity(step).polarity !== "negative"
  ? step.match(/["“]([^"”]+)["”]/)?.[1]?.trim() : undefined;
const conceptTokens = (value: string) => normalize(value).split(" ").filter(token => token.length > 2
  && !new Set(["que", "se", "las", "los", "una", "uno", "con", "para", "por", "del", "desde", "campo", "campos", "habilitan", "habilitado", "habilitados", "enabled", "and", "the", "is", "are", "field"]).has(token));

/** Derive concrete control-state oracles only from field labels already asserted in the authored steps. */
export function jiraEnabledFieldTargets(expectedResult: string | undefined, steps: string[]): string[] {
  const result = normalize(expectedResult ?? "");
  if (!/^se habilitan .+$/.test(result)) return [];
  const wanted = new Set(conceptTokens(result));
  const candidates = [...new Set(steps.map(targetOf).filter((value): value is string => Boolean(value)))].filter(target => {
    const parts = conceptTokens(target);
    return parts.length > 0 && parts.every(part => wanted.has(part));
  });
  if (candidates.length < 2) return [];
  const covered = new Set(candidates.flatMap(conceptTokens));
  return [...wanted].every(token => covered.has(token)) ? candidates : [];
}

/** Turn a proven clear/reset summary into field-empty checks for inputs the scenario actually entered. */
export function jiraResetFieldTargets(input: ScenarioInput): string[] {
  const result = normalize(input.expectedResult ?? "");
  if (!/^el formulario se restablece y la consulta desaparece$/.test(result)) return [];
  const clearStepIndex = input.steps.findIndex(step => /^(?:presionar|pulsar|hacer clic|clic|click)\b/i.test(step.trim())
    && /limpiar|borrar|restablecer|clear|reset/i.test(step));
  if (clearStepIndex < 0) return [];
  const hasLaterNegativeAssertion = input.steps.slice(clearStepIndex + 1).some(step =>
    /^\s*(?:validar|verificar|comprobar)\b/i.test(step) && /\bno\s+se\s+(?:muestre|muestra|presente|presenta|encuentre|encuentra)\b/i.test(step));
  if (!hasLaterNegativeAssertion) return [];
  return (input.inputRequirements ?? []).filter(field => field.required !== false && field.stepIndex !== undefined
    && field.stepIndex < clearStepIndex + 1 && !/usuario|user|contrase[nñ]a|password|clave|token|otp/i.test(field.label))
    .filter(field => {
      const step = input.steps[field.stepIndex! - 1];
      return Boolean(step && parseStepIntent(step).some(intent => ["action_fill", "action_select"].includes(intent.type)
        && normalize(intent.actionTarget ?? "") === normalize(field.label)));
    }).map(field => field.label);
}
