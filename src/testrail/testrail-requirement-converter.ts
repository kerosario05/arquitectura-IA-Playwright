import type { InputRequirement } from "../db/project-case-input-requirement-service";
import type { RawTestRailCase } from "../types/testrail.types";
import {
  extractTestRailInputRequirements,
} from "./testrail-input-requirements-adapter";
import type { InputRequirementConflict } from "./testrail-input-requirements-parser";

export type RequirementConverterInput = {
  caseId: number;
  projectId?: number;
  projectSlug?: string;
  rawCase: RawTestRailCase;
};

export type RequirementConverterOutput = {
  caseId: number;
  requirements: InputRequirement[];
  unresolvedPlaceholders: string[];
  conflicts: InputRequirementConflict[];
  status: "proposed" | "empty" | "conflict";
  requiresApproval: true;
};

const NAMESPACE_PLACEHOLDER = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;

export function convertTestRailRequirements(
  input: RequirementConverterInput,
): RequirementConverterOutput {
  const parsed = extractTestRailInputRequirements(input.rawCase);
  const unresolvedPlaceholders = parsed.unresolvedPlaceholders.filter((key) => NAMESPACE_PLACEHOLDER.test(key));
  const status = parsed.conflicts.length > 0
    ? "conflict"
    : parsed.requirements.length > 0
      ? "proposed"
      : "empty";

  return {
    caseId: input.caseId,
    requirements: parsed.requirements,
    unresolvedPlaceholders,
    conflicts: parsed.conflicts,
    status,
    requiresApproval: true,
  };
}
