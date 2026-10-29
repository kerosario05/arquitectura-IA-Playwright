import { ServiceCatalogError, type ServiceDescriptor } from "./service-provider";

/**
 * Service bindings: "service X fills field Y" for a scenario.
 *
 * A binding belongs to an owner (a recording, a test-design story or a case).
 * `scenarioId === ""` is the owner's general form and applies to every scenario;
 * a row for a concrete scenario overrides it, and a scenario row with no service
 * means that scenario types the value by hand. Everything here is pure so the
 * same rules serve the API, the panel and (later) the runner.
 */

export const BINDING_OWNER_TYPES = ["recording", "test_design_story", "case"] as const;
export type BindingOwnerType = (typeof BINDING_OWNER_TYPES)[number];

/** A parameter value: a literal, or a reference to another field of the same scenario. */
export type BindingParamValue = string | { fromKey: string } | { value: string };

/**
 * One character of a code recorded as separate fields (an OTP as "digit 1".."digit 6",
 * each with its own valueKey). Every field of `group` shares one service value and
 * receives its character at `position` (1-based).
 */
export type BindingSegment = { group: string; position: number };

export type ServiceBinding = {
  id: string;
  projectSlug: string;
  ownerType: BindingOwnerType;
  ownerId: string;
  /** "" = general form of the owner. */
  scenarioId: string;
  targetValueKey: string;
  /** null = this scenario types the value by hand (only on scenario rows). */
  serviceKey: string | null;
  params: Record<string, BindingParamValue>;
  segment: BindingSegment | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type EffectiveBinding = {
  valueKey: string;
  origin: "scenario" | "general" | "manual";
  serviceKey: string | null;
  params: Record<string, BindingParamValue>;
  segment: BindingSegment | null;
  bindingId: string;
};

const MAX_SEGMENT_POSITION = 12;

/** Validates the optional segment of a binding; null when the field holds the whole value. */
export function normalizeBindingSegment(raw: unknown): BindingSegment | null {
  if (raw === undefined || raw === null) return null;
  const input = (typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const group = typeof input.group === "string" ? input.group.trim() : "";
  const position = Number(input.position);
  if (!group || group.length > 256 || !Number.isInteger(position) || position < 1 || position > MAX_SEGMENT_POSITION) {
    throw new ServiceCatalogError("invalid_binding", 400, "segment debe tener group y una position entre 1 y 12.");
  }
  return { group, position };
}

/** The minimum the panel knows about a scenario field. */
export type BindingField = {
  key: string;
  label?: string | null;
  semanticField?: string | null;
  controlType?: string | null;
  sensitive?: boolean;
  /** Typed one character per box (OTP-style). */
  segmented?: boolean;
  required?: boolean;
  value?: string | null;
};

export type ServiceSuggestion = {
  serviceKey: string;
  params: Record<string, BindingParamValue>;
  reason: string;
};

export type ScenarioServiceView = {
  scenarioId: string;
  fields: Array<{ valueKey: string; effective: EffectiveBinding | null; suggestion: ServiceSuggestion | null }>;
  /** Required fields with no value and no service: running now would stop at them. */
  missing: string[];
};

export function isBindingOwnerType(value: unknown): value is BindingOwnerType {
  return typeof value === "string" && (BINDING_OWNER_TYPES as readonly string[]).includes(value);
}

function invalid(message: string): ServiceCatalogError {
  return new ServiceCatalogError("invalid_binding", 400, message);
}

/** Validates a binding's params against the service's declared parameters. */
export function normalizeBindingParams(
  descriptor: ServiceDescriptor,
  raw: unknown,
): Record<string, BindingParamValue> {
  const input = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const params: Record<string, BindingParamValue> = {};
  for (const definition of descriptor.params) {
    const value = input[definition.key];
    let normalized: BindingParamValue | undefined;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const ref = value as Record<string, unknown>;
      const fromKey = typeof ref.fromKey === "string" ? ref.fromKey.trim() : "";
      const literal = typeof ref.value === "string" ? ref.value.trim() : "";
      if (fromKey && definition.kind !== "field_ref") throw invalid(`"${definition.label}" no puede tomarse de otro campo.`);
      if (fromKey) normalized = { fromKey };
      else if (literal) normalized = definition.kind === "field_ref" ? { value: literal } : literal;
    } else if (typeof value === "string" && value.trim()) {
      normalized = definition.kind === "field_ref" ? { value: value.trim() } : value.trim();
    }
    if (normalized === undefined) {
      if (definition.required) throw invalid(`Falta "${definition.label}" para usar ${descriptor.name}.`);
      continue;
    }
    if (definition.kind === "select" && typeof normalized === "string" && !(definition.options ?? []).includes(normalized)) {
      throw invalid(`"${definition.label}" debe ser uno de: ${(definition.options ?? []).join(", ")}.`);
    }
    params[definition.key] = normalized;
  }
  return params;
}

/** Turns a binding's params into plain values from the scenario's current values. */
export function resolveBindingParams(
  params: Record<string, BindingParamValue>,
  values: Record<string, string | null | undefined>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, param] of Object.entries(params)) {
    if (typeof param === "string") {
      resolved[key] = param;
    } else if ("value" in param) {
      resolved[key] = param.value;
    } else {
      const value = values[param.fromKey];
      if (typeof value !== "string" || !value.trim()) {
        throw new ServiceCatalogError("missing_param", 400, `El campo "${param.fromKey}" está vacío y el servicio lo necesita.`);
      }
      resolved[key] = value.trim();
    }
  }
  return resolved;
}

/** Scenario rows win over general ones; a scenario row without a service turns it off. */
export function resolveEffectiveBindings(bindings: ServiceBinding[], scenarioId: string): Map<string, EffectiveBinding> {
  const effective = new Map<string, EffectiveBinding>();
  const general = bindings.filter((binding) => binding.scenarioId === "");
  const own = scenarioId ? bindings.filter((binding) => binding.scenarioId === scenarioId) : [];
  for (const binding of general) {
    if (!binding.serviceKey) continue;
    effective.set(binding.targetValueKey, {
      valueKey: binding.targetValueKey,
      origin: "general",
      serviceKey: binding.serviceKey,
      params: binding.params,
      segment: binding.segment ?? null,
      bindingId: binding.id,
    });
  }
  for (const binding of own) {
    effective.set(binding.targetValueKey, {
      valueKey: binding.targetValueKey,
      origin: binding.serviceKey ? "scenario" : "manual",
      serviceKey: binding.serviceKey,
      params: binding.params,
      segment: binding.segment ?? null,
      bindingId: binding.id,
    });
  }
  return effective;
}

function words(field: BindingField): string {
  return [field.key, field.label, field.semanticField]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .replace(/[_\-.]+/g, " ")
    .toLowerCase();
}

const CODE_FIELD = /\b(otp|one ?time|token|pin)\b|c[oó]digo\s*(de\s*)?(verificaci[oó]n|seguridad|otp|sms|acceso|confirmaci[oó]n)|verification code|clave din[aá]mica/;
const IDENTITY_FIELD = /c[eé]dula|identificaci[oó]n|n[uú]mero de documento|\bdocumento\b|\bidentity\b|\bdni\b/;

/** True when the field looks like a one-time code the user cannot know in advance. */
export function looksLikeOneTimeCode(field: BindingField): boolean {
  if (field.segmented) return true;
  return CODE_FIELD.test(words(field));
}

export function suggestService(
  field: BindingField,
  siblings: BindingField[],
  enabledServices: ServiceDescriptor[],
): ServiceSuggestion | null {
  if (!looksLikeOneTimeCode(field)) return null;
  const service = enabledServices.find((descriptor) => ["otp", "token", "codigo"].includes(descriptor.category));
  if (!service) return null;
  const params: Record<string, BindingParamValue> = {};
  const identityParam = service.params.find((param) => param.kind === "field_ref");
  const identityField = siblings.find((sibling) => sibling.key !== field.key && IDENTITY_FIELD.test(words(sibling)));
  if (identityParam && identityField) params[identityParam.key] = { fromKey: identityField.key };
  return {
    serviceKey: service.key,
    params,
    reason: field.segmented ? "El campo se escribe dígito por dígito, como un OTP." : "El campo parece un código OTP o token.",
  };
}

export function buildScenarioServiceView(input: {
  scenarioId: string;
  fields: BindingField[];
  bindings: ServiceBinding[];
  enabledServices: ServiceDescriptor[];
}): ScenarioServiceView {
  const effective = resolveEffectiveBindings(input.bindings, input.scenarioId);
  const fields = input.fields.map((field) => {
    const bound = effective.get(field.key) ?? null;
    return {
      valueKey: field.key,
      effective: bound,
      suggestion: bound ? null : suggestService(field, input.fields, input.enabledServices),
    };
  });
  const missing = input.fields
    .filter((field) => field.required !== false)
    .filter((field) => !(typeof field.value === "string" && field.value.trim()))
    .filter((field) => !effective.get(field.key)?.serviceKey)
    .map((field) => field.key);
  return { scenarioId: input.scenarioId, fields, missing };
}
