/**
 * Generic functional-object resolution for scenario generation.
 *
 * Turns raw HU requirements into a validated `{ object, source, confidence, backed }`
 * resolution. Guards against structural/filler terms ("dado que"), internal parser
 * tokens ("entry", "found") and operational verbs being used as business objects.
 * Multilingual/project-agnostic — no hardcoded HUs, apps, domains or labels.
 */

export type SemanticObjectKind = "business" | "structural" | "internal" | "empty" | "too_short" | "dangling";

export type SemanticObjectClassification = {
  valid: boolean;
  kind: SemanticObjectKind;
  reason?: string;
};

/** BDD framing + desire/role clause words. Never business objects. */
export const BDD_FRAMING_TERMS = new Set([
  "dado", "dada", "dados", "dadas", "cuando", "entonces", "y", "quiero", "quiere",
  "queremos", "necesito", "necesita", "necesitamos", "como", "para", "poder", "debo",
  "debe", "deben", "deberia", "deberian", "tengo", "tiene", "tener", "ser", "es",
  "son", "que", "se", "si", "pueda", "puede", "pueden", "deseo", "desea", "requiero",
  "requiere", "debe de",
]);

/**
 * Structural/filler and internal-parser terms. Split into two groups so the classifier
 * can distinguish "internal token leaked as object" from "generic operational filler".
 */
export const INTERNAL_OBJECT_TERMS = new Set([
  "entry", "found", "unknown", "none", "undefined", "null", "object", "target",
  "value", "values", "flow", "field", "fields", "message", "messages", "token",
  "tokens", "step", "steps", "data", "item", "items", "key", "keys", "label",
  "labels", "id", "status", "state", "input", "output", "result", "source", "type",
  "name", "generic", "generic_field", "required_fields", "data_entry", "data_entry_fields",
  "element", "elements", "default", "valid", "invalid", "true", "false", "option",
  "options", "node", "nodes", "text", "root", "count", "list", "array", "map",
  "record", "prop", "props", "signal", "event", "flag", "error", "errors", "success",
  "severity", "condition", "match", "matched", "unmatched", "partial", "pending",
  "ready", "done", "skip", "skipped", "origin", "destination", "selection", "selected",
  "selector", "locator", "primary", "secondary", "tertiary", "single", "multiple",
  "required", "optional", "custom", "standard", "advanced", "basic",
]);

/** Operational / filler business terms that are never a concrete object. */
export const OPERATIONAL_OBJECT_TERMS = new Set([
  "proceso", "procesar", "procesamiento", "opcion", "opciones", "pantalla", "modulo",
  "seccion", "resultado", "listado", "detalle", "validacion", "informacion", "funcion",
  "accion", "estado", "operacion", "sistema", "aplicacion", "flujo", "navegacion",
  "navegar", "acceder", "ingresar", "mostrar", "visualizar", "seleccionar", "completar",
  "confirmar", "cancelar", "volver", "generar", "descargar", "exportar", "imprimir",
  "enviar", "buscar", "continuar", "siguiente", "anterior", "correctamente", "requerido",
  "obligatorio", "habilitado", "deshabilitado", "visible", "correcto", "completado",
  "actualizado", "creado", "eliminado", "modificado", "guardado", "registrado",
  "esperar", "verificar", "revisar", "aceptar", "cerrar", "salir", "iniciar", "empezar",
  "ejecutar", "ejecutado", "abrir", "crear", "registrar", "editar", "actualizar",
  "eliminar", "desactivar", "activar", "solicitar", "visualizacion", "confirmacion",
  "cancelacion", "generacion", "entrega", "descarga", "exportacion", "busqueda",
]);

/** Prepositions, conjunctions, articles, pronouns — dangling objects end here. */
export const TRAILING_FILLER_TERMS = new Set([
  "a", "al", "ante", "bajo", "con", "contra", "de", "del", "desde", "en", "entre",
  "hacia", "hasta", "para", "por", "segun", "sin", "sobre", "tras", "y", "o", "u",
  "e", "ni", "pero", "mas", "que", "como", "cuando", "donde", "porque", "la", "el",
  "los", "las", "un", "una", "unos", "unas", "lo", "le", "les", "su", "sus", "mi",
  "mis", "tu", "tus", "nuestra", "nuestro", "deber", "deberia", "pueda", "puede",
  "pueden", "tal", "cual", "cuales",
]);

/** Recognized title-intent verbs for the semantic title contract. */
export const TITLE_ACTION_VERBS = new Set([
  "ejecutar", "completar", "cancelar", "validar", "seleccionar", "confirmar", "buscar",
  "generar", "revisar", "volver", "descargar", "enviar", "ingresar", "registrar",
  "crear", "consultar", "visualizar", "navegar", "verificar", "esperar", "editar",
  "actualizar", "eliminar", "desactivar", "solicitar", "abrir", "contraer",
]);

/** Lightweight Spanish verb heuristic used to keep verbs out of noun phrases. */
function isLikelySpanishVerb(token: string): boolean {
  const t = token.toLowerCase();
  if (/[aeiouáéíóú](?:ar|er|ir|arse|erse|irse)$/i.test(t)) return true;
  const INFINITIVE_STEM = /^(gener|confirm|solicit|valid|complet|ingres|seleccion|visualiz|mostr|cancel|volv|busc|descarg|export|envi|continu|naveg|acced|esper|verific|registr|cre|elimin|actualiz|modific|guard|impr|ejecut|proces|inform|inici|acept|cerrar|salir)/i;
  return INFINITIVE_STEM.test(t) && /[aeiouáéíóú][rn]?$/.test(t);
}

export function normalizeObjText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a candidate object as a valid business/UI object or as
 * structural/internal/dangling filler. Generic across projects.
 */
export function classifySemanticObject(term: string | null | undefined): SemanticObjectClassification {
  const raw = (term ?? "").trim();
  if (!raw) return { valid: false, kind: "empty", reason: "empty_object" };
  const normalized = normalizeObjText(raw);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { valid: false, kind: "empty", reason: "empty_object" };

  const meaningful = tokens.filter(
    (t) => t.length >= 3
      && !INTERNAL_OBJECT_TERMS.has(t)
      && !OPERATIONAL_OBJECT_TERMS.has(t)
      && !BDD_FRAMING_TERMS.has(t)
      && !TRAILING_FILLER_TERMS.has(t)
      && !isLikelySpanishVerb(t),
  );

  if (meaningful.length === 0) {
    const hasInternal = tokens.some((t) => INTERNAL_OBJECT_TERMS.has(t));
    return {
      valid: false,
      kind: hasInternal ? "internal" : "structural",
      reason: hasInternal ? "internal_token_object" : "all_tokens_structural",
    };
  }

  if (tokens.length === 1 && tokens[0].length < 3) {
    return { valid: false, kind: "too_short", reason: "object_too_short" };
  }

  const last = tokens[tokens.length - 1];
  if (TRAILING_FILLER_TERMS.has(last) || BDD_FRAMING_TERMS.has(last)) {
    return { valid: false, kind: "dangling", reason: "ends_in_filler" };
  }

  return { valid: true, kind: "business" };
}

/** Remove leading BDD framing / desire / role clauses from a requirement. */
export function stripBddFraming(text: string): string {
  let t = text.trim();
  t = t.replace(/^\s*(?:dado\s+que|cuando|entonces|y|como)\b/i, "").trim();
  t = t.replace(/^(?:quiero|necesito|deseo|requiero|debo)\s+/i, "").trim();
  t = t.replace(/^(?:para\s+)?(?:poder\s+)?/i, "").trim();
  return t;
}

/**
 * Extract the most concrete noun phrase from a raw requirement (post BDD-strip).
 * Skips fillers and verbs; returns null when no business noun phrase exists.
 */
export function extractRequirementNounPhrase(text: string): string | null {
  const t = stripBddFraming(text)
    .replace(/["""«»]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let end = tokens.length;
  while (end > 0) {
    const l = normalizeObjText(tokens[end - 1]);
    if (
      INTERNAL_OBJECT_TERMS.has(l) || OPERATIONAL_OBJECT_TERMS.has(l)
      || BDD_FRAMING_TERMS.has(l) || TRAILING_FILLER_TERMS.has(l)
      || isLikelySpanishVerb(l) || l.length < 3
    ) {
      end--;
    } else {
      break;
    }
  }
  if (end === 0) return null;

  let start = end;
  let count = 0;
  while (start > 0 && count < 3) {
    const l = normalizeObjText(tokens[start - 1]);
    if (
      INTERNAL_OBJECT_TERMS.has(l) || OPERATIONAL_OBJECT_TERMS.has(l)
      || BDD_FRAMING_TERMS.has(l) || isLikelySpanishVerb(l) || l.length < 3
    ) {
      break;
    }
    start--;
    if (!TRAILING_FILLER_TERMS.has(l)) count++;
  }

  // Strip leading fillers/articles from the resulting phrase
  let phraseStart = start;
  while (phraseStart < end) {
    const l = normalizeObjText(tokens[phraseStart]);
    if (TRAILING_FILLER_TERMS.has(l) || BDD_FRAMING_TERMS.has(l) || l.length < 3) phraseStart++;
    else break;
  }

  const phrase = tokens.slice(phraseStart, end).join(" ");
  return classifySemanticObject(phrase).valid ? phrase : null;
}

/** Map a generic selectable-entity key to its business label (Spanish grammar, not per-app). */
export function mapBusinessEntityLabel(entity: string): string {
  const map: Record<string, string> = {
    product: "producto", account: "cuenta", cash_account: "cuenta de efectivo",
    card: "tarjeta", credit_card: "tarjeta de credito", loan: "prestamo",
    deposit: "deposito", certificate: "certificado", document: "documento",
    period: "periodo", recipient: "destinatario", rnc: "rnc", email: "correo",
    amount: "monto", date: "fecha", currency: "moneda", reason: "motivo",
    months_range: "rango de meses", reference_number: "numero de referencia",
  };
  return map[entity.toLowerCase()] ?? entity;
}

/** Infer the canonical functional action of a raw requirement text. */
export function inferFunctionalAction(text: string): string {
  const t = text.toLowerCase();
  if (/navegar|ir\s+a|acceder\s+a/.test(t)) return "navigate";
  if (/seleccionar|elegir|escoger/.test(t)) return "select";
  if (/ingresar|completar|llenar|digitar/.test(t)) return "fill";
  if (/buscar|consultar|filtrar/.test(t)) return "search";
  if (/enviar|procesar|ejecutar/.test(t)) return "submit";
  if (/confirmar|aceptar/.test(t)) return "confirm";
  if (/cancelar|rechazar/.test(t)) return "cancel";
  if (/volver|regresar|retornar/.test(t)) return "return";
  if (/descargar/.test(t)) return "download";
  if (/exportar/.test(t)) return "export";
  if (/generar/.test(t)) return "generate";
  if (/validar|verificar|mostrar|visualizar/.test(t)) return "validate";
  return "unknown";
}

export type FunctionalObjectSource =
  | "field" | "button" | "warning" | "selectable" | "screen"
  | "requirement" | "requirement_noun_phrase" | "validated_context" | null;

export type FunctionalObjectResolution = {
  object: string | null;
  source: FunctionalObjectSource;
  confidence: "high" | "medium" | "low";
  backed: boolean;
};

export type ObjectResolutionContext = {
  huModel?: any;
  entityTerm?: string;
  featureName?: string;
};

/**
 * Resolve the functional object of a requirement against the HU model.
 * Authorized sources, in priority: explicit requirement object → huModel
 * field/button/selectable/warning/screen (backed) → validated context object
 * → concrete noun phrase of the original requirement. Never invents objects.
 */
export function resolveFunctionalObject(
  requirement: { id?: string; sourceText: string; originalText?: string; action?: string; category?: string },
  context: ObjectResolutionContext = {},
): FunctionalObjectResolution {
  const sourceText = requirement.originalText || requirement.sourceText || "";
  const norm = normalizeObjText(sourceText);
  const hu = context.huModel ?? {};

  // 1. Explicit quoted label in the requirement text (strongest evidence)
  const quoted = sourceText.match(/"([^"]+)"/);
  if (quoted && quoted[1]?.trim() && classifySemanticObject(quoted[1]).valid) {
    return { object: quoted[1].trim(), source: "requirement", confidence: "high", backed: true };
  }

  // Backed candidates from the HU model in authorized priority
  const candidates: Array<{ value: string; source: Exclude<FunctionalObjectSource, null> }> = [];
  for (const f of (hu.requiredFields ?? [])) {
    if (typeof f === "string" && f.trim() && classifySemanticObject(f).valid) candidates.push({ value: f.trim(), source: "field" });
  }
  for (const b of (hu.visibleButtons ?? [])) {
    if (typeof b === "string" && b.trim() && classifySemanticObject(b).valid) candidates.push({ value: b.trim(), source: "button" });
  }
  for (const e of (hu.selectableEntities ?? [])) {
    const label = mapBusinessEntityLabel(String(e));
    if (label && classifySemanticObject(label).valid) candidates.push({ value: label, source: "selectable" });
  }
  for (const w of (hu.visibleWarnings ?? [])) {
    if (typeof w === "string" && w.trim() && classifySemanticObject(w).valid) candidates.push({ value: w.trim(), source: "warning" });
  }
  for (const s of (hu.requiredScreens ?? [])) {
    if (typeof s === "string" && s.trim() && classifySemanticObject(s).valid) candidates.push({ value: s.trim(), source: "screen" });
  }

  // 2. Requirement text actually references a backed candidate (whole-word overlap)
  const normTokens = new Set(norm.split(/\s+/).filter((t) => t.length > 2));
  for (const c of candidates) {
    const cNorm = normalizeObjText(c.value);
    if (!cNorm) continue;
    const cTokens = cNorm.split(/\s+/).filter((t) => t.length > 2);
    const hit = cTokens.length > 0 && cTokens.every((t) => normTokens.has(t));
    if (hit || norm.includes(cNorm)) {
      return { object: c.value, source: c.source, confidence: "high", backed: true };
    }
  }

  // 3. Validated context object (feature name / entity)
  if (context.featureName && classifySemanticObject(context.featureName).valid) {
    return { object: context.featureName, source: "validated_context", confidence: "medium", backed: true };
  }
  if (context.entityTerm && classifySemanticObject(context.entityTerm).valid) {
    return { object: context.entityTerm, source: "validated_context", confidence: "medium", backed: true };
  }

  // 4. Concrete noun phrase from the original requirement (only if business-meaningful)
  const phrase = extractRequirementNounPhrase(sourceText);
  if (phrase) {
    return { object: phrase, source: "requirement_noun_phrase", confidence: "low", backed: true };
  }

  return { object: null, source: null, confidence: "low", backed: false };
}

/** Resolve the best backed business object for deterministic title repair. */
export function resolveBackedObjectForTitle(context?: ObjectResolutionContext): string | null {
  if (!context) return null;
  const hu = context.huModel ?? {};
  const candidates: string[] = [];
  if (context.featureName && classifySemanticObject(context.featureName).valid) candidates.push(context.featureName);
  for (const f of (hu.requiredFields ?? [])) {
    if (typeof f === "string" && classifySemanticObject(f).valid) candidates.push(f);
  }
  for (const e of (hu.selectableEntities ?? [])) {
    const label = mapBusinessEntityLabel(String(e));
    if (classifySemanticObject(label).valid) candidates.push(label);
  }
  for (const b of (hu.visibleButtons ?? [])) {
    if (typeof b === "string" && classifySemanticObject(b).valid) candidates.push(b);
  }
  for (const w of (hu.visibleWarnings ?? [])) {
    if (typeof w === "string" && classifySemanticObject(w).valid) candidates.push(w);
  }
  if (context.entityTerm && classifySemanticObject(context.entityTerm).valid) candidates.push(context.entityTerm);
  const concrete = candidates.find((c) => !/^(la\s+)?(operacion|elemento|producto)\b/.test(normalizeObjText(c)));
  return concrete ?? candidates[0] ?? null;
}

function sourceOfTitleObject(object: string, context?: ObjectResolutionContext): string {
  if (!context) return "unknown";
  const oNorm = normalizeObjText(object);
  const hu = context.huModel ?? {};
  if (context.featureName && normalizeObjText(context.featureName) === oNorm) return "featureName";
  if (context.entityTerm && normalizeObjText(context.entityTerm) === oNorm) return "entityTerm";
  if ((hu.requiredFields ?? []).some((f: string) => normalizeObjText(f) === oNorm)) return "huModel.field";
  if ((hu.visibleButtons ?? []).some((b: string) => normalizeObjText(b) === oNorm)) return "huModel.button";
  if ((hu.visibleWarnings ?? []).some((w: string) => normalizeObjText(w) === oNorm)) return "huModel.warning";
  if ((hu.selectableEntities ?? []).some((e: string) => normalizeObjText(mapBusinessEntityLabel(String(e))) === oNorm)) return "huModel.selectable";
  return "requirement_noun_phrase";
}

function extractObjectFromPhrase(phrase: string): string {
  const p = phrase.trim();
  const markers = [...p.matchAll(/\b(?:de|del|para|al|la|el)\b/gi)];
  if (markers.length > 0) {
    const last = markers[markers.length - 1];
    const after = p.slice(last.index! + last[0].length).trim();
    if (after) return after;
  }
  return p;
}

/** Extract the object segment (and its title template) embedded in a scenario title. */
export function extractTitleObjectSegment(title: string): { object: string | null; template: string | null } {
  const t = title.trim();
  const specific: Array<{ re: RegExp; template: string }> = [
    { re: /^ejecutar flujo completo de\s+(.+)$/i, template: "flow_complete" },
    { re: /^completar datos requeridos\s+(?:para generar|de)\s*(.*)$/i, template: "required_fields" },
    { re: /^cancelar generacion de\s+(.+)$/i, template: "cancel_generation" },
    { re: /^confirmar generacion de\s+(.+)$/i, template: "confirm_generation" },
    { re: /^volver desde generacion de\s+(.+)$/i, template: "return" },
    { re: /^seleccionar opcion de\s+(.+)$/i, template: "select_option" },
    { re: /^revisar vista previa de\s+(.+)$/i, template: "preview" },
    { re: /^validar envio de\s+(.+)$/i, template: "delivery" },
    { re: /^seleccionar (.+?) para generar\s+(.+)$/i, template: "select_for_generate" },
  ];
  for (const p of specific) {
    const m = t.match(p.re);
    if (m) {
      const raw = (m[1] ?? "").trim();
      return { object: raw || null, template: p.template };
    }
  }
  const actionMatch = t.match(
    /^(ejecutar|completar|cancelar|validar|seleccionar|confirmar|buscar|generar|revisar|volver|descargar|enviar|ingresar|registrar|crear|consultar|visualizar|navegar|verificar|esperar|solicitar)\s+(.+)$/i,
  );
  if (actionMatch) {
    const rest = actionMatch[2].trim();
    return { object: extractObjectFromPhrase(rest) || null, template: actionMatch[1].toLowerCase() };
  }
  return { object: null, template: null };
}

const TITLE_TEMPLATES: Record<string, (obj: string) => string> = {
  flow_complete: (o) => `Ejecutar flujo completo de ${o}`,
  required_fields: (o) => `Completar datos requeridos de ${o}`,
  cancel_generation: (o) => `Cancelar generacion de ${o}`,
  confirm_generation: (o) => `Confirmar generacion de ${o}`,
  select_option: (o) => `Seleccionar opcion de ${o}`,
  select_for_generate: (o) => `Seleccionar opcion para generar ${o}`,
  preview: (o) => `Revisar vista previa de ${o}`,
  delivery: (o) => `Validar envio de ${o}`,
  return: (o) => `Volver de ${o}`,
  validate: (o) => `Validar ${o}`,
  select: (o) => `Seleccionar ${o}`,
  confirm: (o) => `Confirmar ${o}`,
  search: (o) => `Buscar ${o}`,
  generate: (o) => `Generar ${o}`,
  download: (o) => `Descargar ${o}`,
  submit: (o) => `Enviar ${o}`,
  ejecutar: (o) => `Ejecutar ${o}`,
  completar: (o) => `Completar ${o}`,
  cancelar: (o) => `Cancelar ${o}`,
  ingresar: (o) => `Ingresar ${o}`,
  registrar: (o) => `Registrar ${o}`,
  crear: (o) => `Crear ${o}`,
  consultar: (o) => `Consultar ${o}`,
  visualizar: (o) => `Visualizar ${o}`,
  verificar: (o) => `Verificar ${o}`,
  navegar: (o) => `Navegar a ${o}`,
  esperar: (o) => `Esperar ${o}`,
  solicitar: (o) => `Solicitar ${o}`,
  revisar: (o) => `Revisar ${o}`,
};

function titleCaseFirst(s: string): string {
  const t = s.trim().replace(/\s{2,}/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export type SemanticTitleValidation = {
  valid: boolean;
  reason?: string;
  object?: string | null;
  objectSource?: string | null;
  template?: string | null;
};

/** Semantic title contract: action present + valid backed functional object + no dangling filler. */
export function validateSemanticScenarioTitle(
  title: string,
  context?: ObjectResolutionContext,
): SemanticTitleValidation {
  const t = title.trim();
  if (!t) return { valid: false, reason: "empty_title", object: null, objectSource: null, template: null };
  const firstWord = normalizeObjText(t.split(/\s+/)[0] ?? "");
  if (!TITLE_ACTION_VERBS.has(firstWord)) {
    return { valid: false, reason: "missing_action", object: null, objectSource: null, template: null };
  }
  const seg = extractTitleObjectSegment(t);
  if (!seg.object) {
    return { valid: false, reason: "missing_functional_object", object: null, objectSource: null, template: seg.template };
  }
  const cls = classifySemanticObject(seg.object);
  if (!cls.valid) {
    return {
      valid: false,
      reason: "invalid_or_missing_functional_object",
      object: seg.object,
      objectSource: sourceOfTitleObject(seg.object, context),
      template: seg.template,
    };
  }
  return { valid: true, object: seg.object, objectSource: sourceOfTitleObject(seg.object, context), template: seg.template };
}

/** Deterministic local title repair using a backed functional object. Never calls the AI. */
export function repairSemanticScenarioTitle(
  title: string,
  context?: ObjectResolutionContext,
): { title: string; repaired: boolean; valid: boolean; reason?: string; object?: string | null; objectSource?: string | null } {
  const initial = validateSemanticScenarioTitle(title, context);
  if (initial.valid) return { title, repaired: false, valid: true, object: initial.object, objectSource: initial.objectSource };
  const obj = resolveBackedObjectForTitle(context);
  const template = initial.template ?? "validate";
  const builder = TITLE_TEMPLATES[template] ?? TITLE_TEMPLATES.validate;
  if (obj && builder) {
    const rebuilt = builder(obj);
    const after = validateSemanticScenarioTitle(rebuilt, context);
    if (after.valid) {
      return { title: titleCaseFirst(rebuilt), repaired: true, valid: true, object: obj, objectSource: "backed_object" };
    }
  }
  return { title, repaired: false, valid: false, reason: initial.reason, object: initial.object, objectSource: initial.objectSource };
}