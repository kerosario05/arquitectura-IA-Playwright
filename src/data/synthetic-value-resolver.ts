import type { FieldCapability } from "../testrail/field-capability";
import type { RuntimeInputValuePolicy } from "../testrail/runtime-value-policy";

type SyntheticRequirement = {
  key: string;
  label?: string;
  sensitive?: boolean;
  valuePolicy?: RuntimeInputValuePolicy;
  fieldCapability?: FieldCapability;
};

export type SemanticSyntheticRequirement = SyntheticRequirement & {
  semanticType?: string;
  locale?: string;
  countryCode?: string;
  datasetIdentity?: string;
  relatedValues?: Record<string, string | number | boolean>;
};

export type SyntheticValueResult = {
  status: "generated" | "unresolved";
  value?: string | number | boolean;
  strategy?: string;
  reason?: string;
};

export type SyntheticSemanticType =
  | "email" | "phone" | "integer" | "decimal" | "money" | "date" | "datetime"
  | "name" | "first_name" | "last_name" | "company_name" | "address" | "city"
  | "postal_code" | "identifier" | "uuid" | "description" | "code" | "username"
  | "job_title" | "generic_text" | "unknown";

function normalizeSemanticText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Infers only a generation hint; it never changes the declared input key. */
export function inferSyntheticSemanticType(input: { key: string; label?: string; fieldCapability?: FieldCapability }): SyntheticSemanticType {
  const text = normalizeSemanticText([input.key, input.label ?? ""].join(" "));
  if (input.fieldCapability?.kind === "email" || /email|correo|mail/.test(text)) return "email";
  if (input.fieldCapability?.kind === "tel" || /phone|telefono|celular|mobile|tel/.test(text)) return "phone";
  if (/uuid|guid/.test(text)) return "uuid";
  if (/postal|zip|codigo postal|codigo_postal/.test(text)) return "postal_code";
  if (/company|business|empresa|razon social|legal name|trade name|company name/.test(text)) return "company_name";
  if (/address|direccion|domicilio/.test(text)) return "address";
  if (/city|ciudad|provincia/.test(text)) return "city";
  if (/last name|apellido|surname/.test(text)) return "last_name";
  if (/first name|nombre|name|nombre esperado/.test(text)) return "name";
  if (/job title|cargo|puesto|ocupacion|occupation|position/.test(text)) return "job_title";
  if (/username|usuario|user name/.test(text)) return "username";
  if (/document|identif|cedula|rnc|identifier|documento/.test(text)) return "identifier";
  if (/money|monto|amount|income|ingreso|salary|salario|importe/.test(text)) return "money";
  if (/percent|porcentaje/.test(text)) return "decimal";
  if (/quantity|cantidad|count|numero|number|integer/.test(text) || input.fieldCapability?.kind === "number") return "integer";
  if (/datetime|timestamp|fecha y hora/.test(text) || input.fieldCapability?.kind === "datetime") return "datetime";
  if (/date|fecha/.test(text) || input.fieldCapability?.kind === "date") return "date";
  if (/description|descripcion|detalle|comentario/.test(text)) return "description";
  if (/code|codigo|reference|referencia/.test(text)) return "code";
  if (input.fieldCapability?.kind === "text") return "generic_text";
  return "unknown";
}

function semanticWords(seed: number): { first: string; last: string } {
  const firstNames = ["Ana", "Luis", "Carla", "Miguel", "Sofia", "Diego"];
  const lastNames = ["García", "Martínez", "Rodríguez", "Hernández", "Santos", "Ramírez"];
  return { first: firstNames[seed % firstNames.length], last: lastNames[Math.floor(seed / firstNames.length) % lastNames.length] };
}

function applyTextConstraints(value: string, constraints: FieldCapability["constraints"]): SyntheticValueResult {
  if (!validLength(value, constraints)) return unresolved("semantic_length_constraints_not_satisfied");
  if (constraints?.pattern !== undefined) {
    try { if (!new RegExp(constraints.pattern).test(value)) return unresolved("semantic_pattern_not_satisfied"); }
    catch { return unresolved("invalid_pattern_constraint"); }
  }
  return { status: "generated", value, strategy: "deterministic_synthetic" };
}

/** Generates recognized semantic types before any AI fallback is considered. */
export function generateSemanticSyntheticValue(input: {
  requirement: SemanticSyntheticRequirement;
  seed: string | number;
}): SyntheticValueResult {
  const requirement = input.requirement;
  if (requirement.sensitive === true || requirement.fieldCapability?.kind === "password") return unresolved("sensitive_requirement");
  const seed = hashInput(`${String(input.seed)}|${requirement.datasetIdentity ?? ""}|${requirement.key}`);
  const semantic = (requirement.semanticType?.trim().toLowerCase() as SyntheticSemanticType | undefined)
    ?? inferSyntheticSemanticType(requirement);
  const constraints = requirement.fieldCapability?.constraints;
  const words = semanticWords(seed);
  const relatedName = Object.entries(requirement.relatedValues ?? {}).find(([key, value]) => /name|nombre/i.test(key) && typeof value === "string")?.[1] as string | undefined;
  switch (semantic) {
    case "email": {
      const local = (relatedName ?? `${words.first}.${words.last}`).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".");
      return applyTextConstraints(`${local}.${seed % 997}@example.test`, constraints);
    }
    case "phone": {
      const prefixes = /do|dominican|809|829|849/i.test(`${requirement.locale ?? ""} ${requirement.countryCode ?? ""}`) ? ["809", "829", "849"] : ["555"];
      const prefix = prefixes[seed % prefixes.length];
      const suffix = String(seed % 10000000).padStart(7, "0");
      return applyTextConstraints(`${prefix}-${suffix.slice(0, 3)}-${suffix.slice(3)}`, constraints);
    }
    case "name":
      return applyTextConstraints(`${words.first} ${words.last}`, constraints);
    case "first_name":
      return applyTextConstraints(words.first, constraints);
    case "last_name":
      return applyTextConstraints(words.last, constraints);
    case "company_name":
      return applyTextConstraints(["Servicios del Caribe SRL", "Comercial Horizonte SRL", "Soluciones Antillas SA"][seed % 3], constraints);
    case "address":
      return applyTextConstraints(`${100 + (seed % 800)} Avenida Caribe`, constraints);
    case "city":
      return applyTextConstraints(["Santo Domingo", "Santiago", "La Romana"][seed % 3], constraints);
    case "postal_code":
      return applyTextConstraints(String(10000 + (seed % 89999)), constraints);
    case "identifier":
      return applyTextConstraints(String(1000000000 + (seed % 899999999)), constraints);
    case "uuid":
      return applyTextConstraints(`${seed.toString(16).padStart(8, "0")}-0000-4000-8000-${(seed * 2654435761 >>> 0).toString(16).padStart(12, "0")}`, constraints);
    case "job_title":
      return applyTextConstraints(["Analista", "Coordinador", "Especialista"][seed % 3], constraints);
    case "username":
      return applyTextConstraints(`${words.first}.${words.last}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(), constraints);
    case "description":
      return applyTextConstraints(`Registro QA ${seed % 10000}`, constraints);
    case "code":
      return applyTextConstraints(`QA-${(seed % 100000).toString().padStart(5, "0")}`, constraints);
    case "money": {
      const number = resolveNumber(seed, { ...constraints, min: constraints?.min ?? 1000, max: constraints?.max ?? 100000 });
      return number.status === "generated" ? { ...number, strategy: "deterministic_synthetic:money" } : number;
    }
    case "integer":
      return resolveNumber(seed, constraints);
    case "decimal":
      return resolveNumber(seed, { ...constraints, min: constraints?.min ?? 1, max: constraints?.max ?? 100 });
    case "date":
      return { status: "generated", value: new Date(Date.UTC(1980 + (seed % 35), seed % 12, 1 + (seed % 27))).toISOString().slice(0, 10), strategy: "deterministic_synthetic:date" };
    case "datetime":
      return { status: "generated", value: new Date(Date.UTC(2020 + (seed % 6), seed % 12, 1 + (seed % 27), seed % 24, seed % 60)).toISOString().slice(0, 16), strategy: "deterministic_synthetic:datetime" };
    case "generic_text":
    case "unknown":
    default:
      return unresolved("semantic_type_unknown");
  }
}

export function generateSyntheticValueFromCapability(input: {
  key: string;
  fieldCapability: FieldCapability;
  seed: string | number;
}): SyntheticValueResult {
  const seed = hashInput(`${String(input.seed)}|${input.key}|${JSON.stringify(input.fieldCapability)}`);
  const capability = input.fieldCapability;
  const constraints = capability.constraints;
  switch (capability.kind) {
    case "text":
      return resolveText(seed, constraints);
    case "email":
      return resolveEmail(seed, constraints);
    case "tel":
      return resolveTel(seed, constraints);
    case "number":
      return resolveNumber(seed, constraints);
    case "select":
    case "radio": {
      const options = capability.allowedValues ?? [];
      if (options.length === 0) return unresolved("missing_allowed_values");
      return { status: "generated", value: options[seed % options.length], strategy: `synthetic:${capability.kind}` };
    }
    case "checkbox":
      return { status: "generated", value: seed % 2 === 0, strategy: "synthetic:checkbox" };
    case "date": {
      if (constraints) return unresolved("date_constraints_not_supported");
      const date = new Date(Date.UTC(2000, 0, 1 + (seed % 10000))).toISOString().slice(0, 10);
      return { status: "generated", value: date, strategy: "synthetic:date" };
    }
    case "datetime": {
      if (constraints) return unresolved("datetime_constraints_not_supported");
      const datetime = new Date(Date.UTC(2000, 0, 1 + (seed % 10000), seed % 24, seed % 60)).toISOString().slice(0, 16);
      return { status: "generated", value: datetime, strategy: "synthetic:datetime" };
    }
    case "file":
    case "unknown":
      return unresolved("capability_not_supported");
    default:
      return unresolved("capability_not_supported");
  }
}

function hashInput(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unresolved(reason: string): SyntheticValueResult {
  return { status: "unresolved", reason };
}

function validLength(value: string, constraints: FieldCapability["constraints"]): boolean {
  if (constraints?.minLength !== undefined && value.length < constraints.minLength) return false;
  if (constraints?.maxLength !== undefined && value.length > constraints.maxLength) return false;
  return true;
}

function resolveText(seed: number, constraints: FieldCapability["constraints"]): SyntheticValueResult {
  if (constraints?.pattern !== undefined) return unresolved("pattern_not_safely_satisfied");
  const minLength = constraints?.minLength ?? 8;
  const maxLength = constraints?.maxLength ?? Math.max(minLength, 24);
  if (!Number.isInteger(minLength) || !Number.isInteger(maxLength) || minLength < 0 || minLength > maxLength) {
    return unresolved("invalid_length_constraints");
  }
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const length = minLength === maxLength ? minLength : minLength + (seed % (maxLength - minLength + 1));
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet[(seed + index * 31) % alphabet.length];
  }
  return { status: "generated", value, strategy: "synthetic:text" };
}

function resolveNumber(seed: number, constraints: FieldCapability["constraints"]): SyntheticValueResult {
  const min = constraints?.min ?? 0;
  const max = constraints?.max ?? (min + 999);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return unresolved("invalid_number_constraints");
  const value = min === max ? min : min + ((seed / 0xffffffff) * (max - min));
  return { status: "generated", value, strategy: "synthetic:number" };
}

function resolveEmail(seed: number, constraints: FieldCapability["constraints"]): SyntheticValueResult {
  const value = `synthetic${seed.toString(36)}@example.test`;
  if (!validLength(value, constraints)) return unresolved("email_length_constraints_not_satisfied");
  if (constraints?.pattern !== undefined) {
    try {
      if (!new RegExp(constraints.pattern).test(value)) return unresolved("email_pattern_not_satisfied");
    } catch {
      return unresolved("invalid_pattern_constraint");
    }
  }
  return { status: "generated", value, strategy: "synthetic:email" };
}

function resolveTel(seed: number, constraints: FieldCapability["constraints"]): SyntheticValueResult {
  const minLength = constraints?.minLength ?? 10;
  const maxLength = constraints?.maxLength ?? minLength;
  if (!Number.isInteger(minLength) || !Number.isInteger(maxLength) || minLength < 0 || minLength > maxLength) {
    return unresolved("invalid_tel_length_constraints");
  }
  const length = minLength === maxLength ? minLength : minLength + (seed % (maxLength - minLength + 1));
  let value = "";
  for (let index = 0; index < length; index += 1) value += ((seed + index * 7) % 10).toString();
  if (constraints?.pattern !== undefined) {
    try {
      if (!new RegExp(constraints.pattern).test(value)) return unresolved("tel_pattern_not_satisfied");
    } catch {
      return unresolved("invalid_pattern_constraint");
    }
  }
  return { status: "generated", value, strategy: "synthetic:tel" };
}

export function resolveSyntheticValue(input: {
  requirement: SyntheticRequirement;
  seed: string | number;
}): SyntheticValueResult {
  const requirement = input.requirement;
  if (requirement.valuePolicy !== "safe_synthetic") return unresolved("value_policy_not_synthetic");
  if (requirement.sensitive === true) return unresolved("sensitive_requirement");

  const capability = requirement.fieldCapability;
  if (!capability) return unresolved("missing_field_capability");
  if (capability.kind === "password") return unresolved("password_not_generated");

  return generateSyntheticValueFromCapability({ key: requirement.key, fieldCapability: capability, seed: input.seed });
}
