export type EvidenceTestApproach = "Positivo" | "Negativo" | "Alterno" | "Límite" | "No clasificado";

const normalize = (value: string): string => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("es")
  .replace(/\s+/g, " ")
  .trim();

/** Keep known test categories readable in the Spanish certification report. */
export function normalizeEvidenceTestType(value?: string): string {
  const source = value?.trim();
  if (!source) return "Funcional";
  const key = normalize(source).replace(/[_-]+/g, " ");
  const known: Record<string, string> = {
    functional: "Funcional",
    funcional: "Funcional",
    "non functional": "No funcional",
    "no funcional": "No funcional",
    regression: "Regresión",
    regresion: "Regresión",
    smoke: "Humo",
    humo: "Humo",
    security: "Seguridad",
    seguridad: "Seguridad",
    performance: "Rendimiento",
    rendimiento: "Rendimiento",
    integration: "Integración",
    integracion: "Integración",
  };
  return known[key] ?? source;
}

/**
 * Classify only when scenario text gives a clear signal. The scenario's expected
 * outcome is included so a normal successful flow is not mislabeled from a
 * negative assertion such as "no se muestra el error" in one of its steps.
 */
export function inferEvidenceTestApproach(input: {
  explicit?: EvidenceTestApproach | string;
  title?: string;
  expectedResult?: string;
  steps?: string[];
}): EvidenceTestApproach {
  const explicit = input.explicit?.trim();
  const explicitKey = explicit ? normalize(explicit) : "";
  const allowed = new Map<string, EvidenceTestApproach>([
    ["positivo", "Positivo"],
    ["negativo", "Negativo"],
    ["alterno", "Alterno"],
    ["limite", "Límite"],
    ["no clasificado", "No clasificado"],
  ]);
  if (allowed.has(explicitKey)) return allowed.get(explicitKey)!;

  const title = normalize(input.title ?? "");
  const outcome = normalize(input.expectedResult ?? "");
  const steps = (input.steps ?? []).map(normalize).join(" ");
  const source = `${title} ${outcome} ${steps}`;

  if (/\b(minim[oa]s?|maxim[oa]s?|limite|frontera|borde|longitud maxima|longitud minima|valor extremo)\b/.test(source)) {
    return "Límite";
  }
  if (/\b(alternativ[oa]s?|flujo alterno|ruta alterna|canal alternativo|segunda opcion|metodo alternativo)\b/.test(source)) {
    return "Alterno";
  }
  const negativePattern = /\b(invalid[oa]s?|incorrect[oa]s?|rechaz(?:a|ar|ad[oa]s?)|deneg(?:a|ar|ad[oa]s?)|error(?:es)?|fallid[oa]s?|no autorizad[oa]|inexistente|expirad[oa]s?|bloquead[oa]s?|acceso no permitido|limite excedido|datos vacios|sin permisos|credenciales incorrectas)\b/;
  if (negativePattern.test(title) || negativePattern.test(outcome)) return "Negativo";
  const positiveEvidence = `${title} ${outcome} ${steps}`.replace(/\bno se (?:muestra?|presente|registra|visualiza|realiza|permite)\b/g, "");
  if (/\b(exitos[oa]s?|correct[oa]s?|valid[oa]s?|completad[oa]s?|se registra|se muestra|se muestre|se presenta|se presente|se realiza|se visualiza|se visualice|aprobado|transferencia realizada|operacion realizada)\b/.test(positiveEvidence)) {
    return "Positivo";
  }
  return "No clasificado";
}
