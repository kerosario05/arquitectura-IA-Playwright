import type { InputRequirement } from "../db/project-case-input-requirement-service";

export type InputRequirementConflict = {
  key: string;
  existing: InputRequirement;
  incoming: InputRequirement;
};

export type ParsedTestRailInputRequirements = {
  requirements: InputRequirement[];
  unresolvedPlaceholders: string[];
  conflicts: InputRequirementConflict[];
};

const DECLARATION_PATTERN = /^\s*(?:[-*]\s*)?(.+?)\s*\(\s*([^(),]+?)\s*,\s*([^()]+?)\s*\)\s*(?:\[[^\]]+\]\s*)*$/;
const PLACEHOLDER_PATTERN = /\[([^\]]+)\]/g;
const INPUT_ACTION_PATTERN = /^\s*(?:\d+\s*[.)]\s*)?(ingresar|introducir|escribir|completar|llenar|enter|type|fill|seleccionar|elegir|select|choose)\s+.+?\s+(?:en|in|into)\s+(?:(?:el|la|the)\s+)?(?:(?:campo|field|casilla|input)\s+)?(.+?)\s*[.!?]*\s*$/i;

function isSensitiveControlType(controlType: string): boolean {
  return /^(?:secret|password|credential)$/i.test(controlType.trim());
}

function sameMetadata(left: InputRequirement, right: InputRequirement): boolean {
  return left.label === right.label
    && left.controlType === right.controlType
    && left.required === right.required
    && left.sensitive === right.sensitive
    && JSON.stringify(left.allowedValues) === JSON.stringify(right.allowedValues);
}

function normalizeInputLabel(value: string): string {
  return value.replace(/["'“”‘’]/g, "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").trim();
}

function inputKeyForLabel(label: string): string {
  const field = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `input.${field}`;
}

/** Infer a runtime input only from an explicit fill/select action naming its field. */
export function inferTestRailActionInputRequirements(
  text: string,
  existing: InputRequirement[] = [],
): InputRequirement[] {
  const inferred: InputRequirement[] = [];
  const labels = new Set(existing.map((item) => normalizeInputLabel(item.label ?? "").toLowerCase()));
  const keys = new Set(existing.map((item) => item.key.toLowerCase()));
  for (const line of String(text ?? "").split(/\r?\n/)) {
    PLACEHOLDER_PATTERN.lastIndex = 0;
    if (PLACEHOLDER_PATTERN.test(line)) continue;
    const match = line.match(INPUT_ACTION_PATTERN);
    const label = match ? normalizeInputLabel(match[2] ?? "") : "";
    if (!label) continue;
    const key = inputKeyForLabel(label);
    if (labels.has(label.toLowerCase()) || keys.has(key)) continue;
    const sensitive = /(?:contrase(?:ñ|n)a|password|secret|clave)/i.test(label);
    inferred.push({
      key,
      label,
      controlType: sensitive ? "password" : /^(seleccionar|elegir|select|choose)$/i.test(match![1]) ? "select" : "text",
      required: true,
      sensitive,
      allowedValues: [],
      source: "runtime_inferred",
      editable: true,
      inputUsage: ["action"],
    });
    labels.add(label.toLowerCase());
    keys.add(key);
  }
  return inferred;
}

export function parseTestRailInputRequirements(text: string): ParsedTestRailInputRequirements {
  const requirements: InputRequirement[] = [];
  const conflicts: InputRequirementConflict[] = [];
  const byKey = new Map<string, InputRequirement>();

  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = line.match(DECLARATION_PATTERN);
    if (!match) continue;

    const label = match[1].trim();
    const key = match[2].trim();
    const controlType = match[3].trim();
    if (!label || !key || !controlType) continue;

    const requirement: InputRequirement = {
      key,
      label,
      controlType,
      required: true,
      sensitive: isSensitiveControlType(controlType),
      allowedValues: [],
    };
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, requirement);
      requirements.push(requirement);
    } else if (!sameMetadata(existing, requirement)) {
      conflicts.push({ key, existing, incoming: requirement });
    }
  }

  const declaredKeys = new Set(requirements.map((requirement) => requirement.key));
  const unresolvedPlaceholders: string[] = [];
  const seenPlaceholders = new Set<string>();
  for (const match of String(text ?? "").matchAll(PLACEHOLDER_PATTERN)) {
    const key = match[1].trim();
    if (key && !declaredKeys.has(key) && !seenPlaceholders.has(key)) {
      seenPlaceholders.add(key);
      unresolvedPlaceholders.push(key);
    }
  }

  return { requirements, unresolvedPlaceholders, conflicts };
}
