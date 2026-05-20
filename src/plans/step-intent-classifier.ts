export type StepIntent = "fill" | "click" | "assert" | "navigate" | "login" | "wait" | "unknown";

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function classifyStepIntent(text: string): StepIntent {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "unknown";
  }

  if (hasAny(normalized, ["login", "iniciar sesion", "autenticar", "sign in"])) {
    return "login";
  }
  if (hasAny(normalized, ["navegar", "abrir", "ir a", "acceder a url", "go to", "navigate"])) {
    return "navigate";
  }
  if (hasAny(normalized, ["esperar", "wait"])) {
    return "wait";
  }
  if (
    hasAny(normalized, [
      "ingresar",
      "digitar",
      "escribir",
      "completar",
      "llenar",
      "capture",
      "input",
      "enter",
      "type"
    ])
  ) {
    return "fill";
  }
  if (
    hasAny(normalized, [
      "click",
      "clicar",
      "presionar",
      "pulsar",
      "seleccionar boton",
      "acceder",
      "continuar",
      "consultar",
      "buscar"
    ])
  ) {
    return "click";
  }
  if (hasAny(normalized, ["validar", "verificar", "debe mostrar", "se muestra", "visualizar", "confirmar", "resultado", "aparece"])) {
    return "assert";
  }

  return "unknown";
}
