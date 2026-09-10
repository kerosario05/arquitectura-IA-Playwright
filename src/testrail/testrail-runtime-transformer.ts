import type { InputRequirement } from "../db/project-case-input-requirement-service";
import type { RawTestRailCase, TestScenario } from "../types/testrail.types";
import { normalizeTestRailCase } from "./testrail-normalizer";
import {
  convertTestRailRequirements,
  type RequirementConverterOutput,
} from "./testrail-requirement-converter";
import {
  proposeTestRailInputRequirements,
  type InputRequirementProposal,
  type RequirementProposalEngineOutput,
} from "./testrail-requirement-proposal-engine";
import type { InputRequirementConflict } from "./testrail-input-requirements-parser";
import { resolveFieldCapability, type FieldCapability } from "./field-capability";
import { resolveRuntimeInputValuePolicy, type RuntimeInputValuePolicy } from "./runtime-value-policy";
import { resolveScenarioDataPolicy, type ScenarioDataPolicy } from "./scenario-data-policy";
import type { GenerationProfile } from "./generation-profile";

export type RuntimeInputLineage = {
  valueRole?: "runtime_input" | "expected_oracle" | "runtime_derived_oracle";
  oracleSource?: string;
  dependsOn?: string[];
};

export type RuntimeInputRequirement = InputRequirement & RuntimeInputLineage & {
  source: "contract" | "runtime_inferred";
  fieldCapability: FieldCapability;
  inputRole?: "scenario" | "supporting";
  valuePolicy: RuntimeInputValuePolicy;
  scenarioDataPolicy: ScenarioDataPolicy;
  generationProfile?: GenerationProfile;
  provenance?: "contract_declaration" | "placeholder_reference" | "runtime_inference";
};

export type TestRailRuntimeTransformation = {
  normalizedScenario: TestScenario;
  inputRequirements: RuntimeInputRequirement[];
  unresolvedPlaceholders: string[];
  conflicts: InputRequirementConflict[];
};

export type TestRailRuntimeTransformerDependencies = {
  normalize?: (rawCase: RawTestRailCase) => TestScenario;
  convert?: (input: { caseId: number; rawCase: RawTestRailCase }) => RequirementConverterOutput;
  propose?: (input: {
    rawCase: RawTestRailCase;
    converterOutput: RequirementConverterOutput;
  }) => RequirementProposalEngineOutput;
};

type RuntimeInputRole = "scenario" | "supporting";
type InputRequirementWithRole = InputRequirement & {
  inputRole?: RuntimeInputRole;
  source?: RuntimeInputRequirement["source"];
  provenance?: RuntimeInputRequirement["provenance"];
};

type IndexedDatasetMetadata = {
  datasetIdentity: string;
  datasetOrdinal: number;
  entityDisplayName: string;
};

const ENTITY_LOCALIZATION: Record<string, string> = {
  account: "Cuenta",
  company: "Empresa",
  customer: "Cliente",
  employee: "Empleado",
  item: "Elemento",
  user: "Usuario",
};

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function indexedDatasetMetadata(key: string): IndexedDatasetMetadata | undefined {
  const segment = key.split(".").find((part) => /(?:[_-]\d+|\[\d+\])$/.test(part));
  const match = segment?.match(/^(.*?)(?:[_-](\d+)|\[(\d+)\])$/);
  if (!match?.[1]) return undefined;
  const identity = match[1];
  return {
    datasetIdentity: identity,
    datasetOrdinal: Number(match[2] ?? match[3]),
    entityDisplayName: ENTITY_LOCALIZATION[identity.toLowerCase()] ?? humanize(identity),
  };
}

function semanticFieldLabel(label: string | undefined, metadata: IndexedDatasetMetadata | undefined): string | undefined {
  if (!label?.trim()) return undefined;
  const value = label.trim();
  if (!metadata) return value;
  const entity = metadata.entityDisplayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const identity = humanize(metadata.datasetIdentity).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ordinal = String(metadata.datasetOrdinal);
  const suffix = new RegExp(`(?:\\s|[-_:])*?(?:${entity}|${identity})?\\s*${ordinal}\\s*$`, "i");
  const stripped = value.replace(suffix, "").trim();
  return stripped || value;
}

function inputRequirementLineage(requirement: InputRequirement): RuntimeInputLineage {
  if (/(?:^|\.)expected_[a-z0-9_]+$/i.test(requirement.key)) {
    return { valueRole: "expected_oracle", oracleSource: "testrail_declaration" };
  }
  return {};
}

function structurallyReferencedRequirementKeys(normalizedScenario: TestScenario): Set<string> {
  const keys = new Set<string>();
  for (const step of normalizedScenario.steps) {
    for (const key of step.requirementRefs ?? []) keys.add(key);
    for (const key of step.inputIntent?.requirementRefs ?? []) keys.add(key);
  }
  return keys;
}

export function resolveRuntimeInputRole(
  requirement: InputRequirementWithRole,
  referencedKeys: ReadonlySet<string>,
): RuntimeInputRole | undefined {
  if (requirement.inputRole !== undefined) return requirement.inputRole;
  if (requirement.source === "contract" || requirement.provenance === "placeholder_reference") return "scenario";
  if (referencedKeys.has(requirement.key)) return "scenario";
  return undefined;
}

function sameMetadata(left: InputRequirement, right: InputRequirement): boolean {
  return left.label === right.label
    && left.controlType === right.controlType
    && left.required === right.required
    && left.sensitive === right.sensitive
    && JSON.stringify(left.allowedValues) === JSON.stringify(right.allowedValues);
}

function inputRequirementFromProposal(proposal: InputRequirementProposal): InputRequirementWithRole {
  return {
    key: proposal.key,
    ...(proposal.label !== undefined ? { label: proposal.label } : {}),
    ...(proposal.controlType !== undefined ? { controlType: proposal.controlType } : {}),
    ...(proposal.required !== undefined ? { required: proposal.required } : {}),
    ...(proposal.sensitive !== undefined ? { sensitive: proposal.sensitive } : {}),
    ...(proposal.allowedValues !== undefined ? { allowedValues: [...proposal.allowedValues] } : {}),
    ...(proposal.inputRole !== undefined ? { inputRole: proposal.inputRole } : {}),
    ...(proposal.inputUsage !== undefined ? { inputUsage: [...proposal.inputUsage] } : {}),
    ...(proposal.provenance !== undefined ? { provenance: proposal.provenance } : {}),
    ...(proposal.generationProfile !== undefined ? { generationProfile: proposal.generationProfile } : {}),
  };
}

export function transformTestRailCaseForRuntime(
  rawCase: RawTestRailCase,
  dependencies: TestRailRuntimeTransformerDependencies = {},
): TestRailRuntimeTransformation {
  const normalize = dependencies.normalize ?? normalizeTestRailCase;
  const convert = dependencies.convert ?? ((input) => convertTestRailRequirements(input));
  const propose = dependencies.propose ?? proposeTestRailInputRequirements;
  const normalizedScenario = normalize(rawCase);
  const converterOutput = convert({ caseId: rawCase.id, rawCase });
  const proposalOutput = propose({ rawCase, converterOutput });
  const conflicts = [...converterOutput.conflicts];
  const referencedKeys = structurallyReferencedRequirementKeys(normalizedScenario);
  const runtimeRequirements: RuntimeInputRequirement[] = converterOutput.requirements.map((requirement) => {
    const fieldCapability = resolveFieldCapability(requirement);
    const inputRole = resolveRuntimeInputRole({ ...requirement, source: "contract" }, referencedKeys);
    const dataset = indexedDatasetMetadata(requirement.key);
    const displayLabel = semanticFieldLabel(requirement.label, dataset)
      ?? requirement.label
      ?? requirement.key.split(".").at(-1);
    return {
      ...requirement,
      ...inputRequirementLineage(requirement),
      ...(displayLabel ? { displayLabel, semanticField: displayLabel } : {}),
      technicalLabel: requirement.key,
      ...(dataset ?? {}),
      ...(inputRole !== undefined ? { inputRole } : {}),
      source: "contract",
      provenance: "contract_declaration",
      fieldCapability,
      valuePolicy: resolveRuntimeInputValuePolicy({ ...requirement, inputRole, fieldCapability }),
      scenarioDataPolicy: resolveScenarioDataPolicy({ ...requirement, inputRole, source: "contract", fieldCapability }),
    };
  });
  const byKey = new Map(runtimeRequirements.map((requirement) => [requirement.key, requirement]));

  for (const proposal of proposalOutput.proposals) {
    const incoming = inputRequirementFromProposal(proposal);
    const existing = byKey.get(incoming.key);
    if (existing) {
      if (!sameMetadata(existing, incoming)) conflicts.push({ key: incoming.key, existing, incoming });
      continue;
    }
    const fieldCapability = resolveFieldCapability(incoming);
    const inputRole = resolveRuntimeInputRole(incoming, referencedKeys);
    const runtimeRequirement: RuntimeInputRequirement = {
      ...incoming,
      ...inputRequirementLineage(incoming),
      ...(inputRole !== undefined ? { inputRole } : {}),
      source: "runtime_inferred",
      fieldCapability,
      valuePolicy: resolveRuntimeInputValuePolicy({ ...incoming, inputRole, fieldCapability }),
      scenarioDataPolicy: resolveScenarioDataPolicy({ ...incoming, inputRole, source: "runtime_inferred", fieldCapability }),
    };
    byKey.set(runtimeRequirement.key, runtimeRequirement);
    runtimeRequirements.push(runtimeRequirement);
  }

  const resolvedKeys = new Set(runtimeRequirements.map((requirement) => requirement.key));
  const unresolvedPlaceholders = [...new Set([
    ...converterOutput.unresolvedPlaceholders,
    ...proposalOutput.unresolved,
  ])].filter((key) => !resolvedKeys.has(key));

  return {
    normalizedScenario,
    inputRequirements: runtimeRequirements,
    unresolvedPlaceholders,
    conflicts,
  };
}
