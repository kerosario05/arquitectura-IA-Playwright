import type { InputRequirement } from "../db/project-case-input-requirement-service";
import type { RawTestRailCase } from "../types/testrail.types";
import type { InputRequirementProposal } from "./testrail-requirement-proposal-engine";
import { approveTestRailRequirementProposals } from "./testrail-requirement-approval-service";
import { convertTestRailRequirements } from "./testrail-requirement-converter";
import { proposeTestRailInputRequirements } from "./testrail-requirement-proposal-engine";

export type RequirementMigrationInput = {
  caseId: number;
  rawCase: RawTestRailCase;
  approvedProposals: InputRequirementProposal[];
};

export type RequirementMigrationOutput = {
  caseId: number;
  requirements: InputRequirement[];
  proposalsGenerated: number;
  status: "completed" | "empty" | "blocked";
};

function sameRequirement(left: InputRequirement, right: InputRequirement): boolean {
  return left.label === right.label
    && left.controlType === right.controlType
    && left.required === right.required
    && left.sensitive === right.sensitive
    && JSON.stringify(left.allowedValues) === JSON.stringify(right.allowedValues);
}

function mergeRequirements(
  declared: InputRequirement[],
  approved: InputRequirement[],
): InputRequirement[] | undefined {
  const byKey = new Map<string, InputRequirement>();
  for (const requirement of [...declared, ...approved]) {
    const existing = byKey.get(requirement.key);
    if (existing && !sameRequirement(existing, requirement)) return undefined;
    byKey.set(requirement.key, existing ?? requirement);
  }
  return Array.from(byKey.values());
}

export function migrateTestRailRequirements(
  input: RequirementMigrationInput,
): RequirementMigrationOutput {
  const converted = convertTestRailRequirements({
    caseId: input.caseId,
    rawCase: input.rawCase,
  });
  const proposals = proposeTestRailInputRequirements({
    rawCase: input.rawCase,
    converterOutput: converted,
  });

  if (converted.conflicts.length > 0) {
    return { caseId: input.caseId, requirements: [], proposalsGenerated: proposals.proposals.length, status: "blocked" };
  }

  const approval = approveTestRailRequirementProposals({
    caseId: input.caseId,
    approvedProposals: input.approvedProposals,
  });
  if (approval.status === "rejected" && input.approvedProposals.length > 0) {
    return { caseId: input.caseId, requirements: [], proposalsGenerated: proposals.proposals.length, status: "blocked" };
  }

  const requirements = mergeRequirements(converted.requirements, approval.approvedRequirements);
  if (!requirements) {
    return { caseId: input.caseId, requirements: [], proposalsGenerated: proposals.proposals.length, status: "blocked" };
  }
  return {
    caseId: input.caseId,
    requirements,
    proposalsGenerated: proposals.proposals.length,
    status: requirements.length > 0 ? "completed" : "empty",
  };
}
