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
