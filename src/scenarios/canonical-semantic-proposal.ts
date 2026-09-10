import type { RequirementStatus } from "./scenario-types";
import type { StructuredReason } from "./canonical-scenario";

export type SemanticProposalStatus = "resolved" | "partial" | "unresolved";
export type SemanticProposalConfidence = "high" | "medium" | "low";

export type SemanticRequirementProposal = {
  proposalId: string;
  kind: string;
  description: string;
  branchProposalId?: string;
  origin: {
    stepOrders?: number[];
    sourceFragmentRefs?: string[];
  };
  coverability?: RequirementStatus;
};

export type SemanticBranchProposal = {
  branchProposalId: string;
  conditions?: string[];
  destinationIntent?: string;
  requirementProposalRefs: string[];
};

export type StepRequirementLink = {
  stepOrder: number;
  requirementProposalRefs: string[];
};

export type CanonicalSemanticNormalizationProposal = {
  status: SemanticProposalStatus;
  confidence: SemanticProposalConfidence;
  requirements: SemanticRequirementProposal[];
  branches: SemanticBranchProposal[];
  stepRequirementLinks: StepRequirementLink[];
  unresolved: StructuredReason[];
};

export type CanonicalSemanticApplyResult = {
  accepted: SemanticRequirementProposal[];
  rejected: SemanticRequirementProposal[];
  unresolved: StructuredReason[];
};

export type CanonicalSemanticProposalValidation = {
  valid: boolean;
  errors: CanonicalSemanticValidationError[];
};

export type CanonicalSemanticValidationError = StructuredReason & {
  expected?: string;
  receivedType?: string;
  receivedKeys?: string[];
};

export type CanonicalSemanticProposalShapeSummary = {
  topLevelKeys: string[];
  statusType: string;
  statusValue: string | undefined;
  confidenceType: string;
  confidenceValue: string | undefined;
  requirementsType: string;
  requirementsCount: number;
  requirementItemKeys: string[];
  branchesType: string;
  branchesCount: number;
  branchItemKeys: string[];
  stepRequirementLinksType: string;
  stepRequirementLinksCount: number;
  stepLinkItemKeys: string[];
  unresolvedType: string;
  unresolvedCount: number;
  unresolvedItemKeys: string[];
};

const proposalKeys = new Set(["proposalId", "kind", "description", "branchProposalId", "origin", "coverability"]);
const branchKeys = new Set(["branchProposalId", "conditions", "destinationIntent", "requirementProposalRefs"]);
const linkKeys = new Set(["stepOrder", "requirementProposalRefs"]);
const originKeys = new Set(["stepOrders", "sourceFragmentRefs"]);
const reasonKeys = new Set(["code", "message", "path"]);
const topLevelKeys = new Set(["status", "confidence", "requirements", "branches", "stepRequirementLinks", "unresolved"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function keysOf(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

function addError(
  errors: CanonicalSemanticValidationError[],
  code: string,
  message: string,
  path?: string,
  details: Omit<CanonicalSemanticValidationError, "code" | "message" | "path"> = {},
): void {
  errors.push({ code, message, ...(path ? { path } : {}), ...details });
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validString);
}

function validateOrigin(value: unknown, path: string, errors: CanonicalSemanticValidationError[]): void {
  if (!isRecord(value) || !hasOnlyKeys(value, originKeys)) {
    addError(errors, "invalid_origin", "origin contains unknown or invalid fields", path);
    return;
  }
  if (value.stepOrders !== undefined && (!Array.isArray(value.stepOrders) || !value.stepOrders.every((order) => Number.isInteger(order) && order > 0))) {
    addError(errors, "invalid_origin_step_orders", "origin.stepOrders must contain positive integers", `${path}.stepOrders`);
  }
  if (value.sourceFragmentRefs !== undefined && !validStringArray(value.sourceFragmentRefs)) {
    addError(errors, "invalid_origin_refs", "origin.sourceFragmentRefs must contain non-empty strings", `${path}.sourceFragmentRefs`);
  }
}

export function validateCanonicalSemanticNormalizationProposal(
  value: unknown,
  context: { stepOrders: ReadonlyArray<number> },
): CanonicalSemanticProposalValidation {
  const errors: CanonicalSemanticValidationError[] = [];
  if (!isRecord(value) || !hasOnlyKeys(value, topLevelKeys)) {
    const unknownKey = isRecord(value) ? Object.keys(value).find((key) => !topLevelKeys.has(key)) : undefined;
    addError(errors, "unknown_or_invalid_top_level_field", "proposal contains unknown or invalid top-level fields", unknownKey, {
      expected: [...topLevelKeys].sort().join(", "),
      receivedType: valueType(value),
      receivedKeys: keysOf(value),
    });
    return { valid: false, errors };
  }
  if (!["resolved", "partial", "unresolved"].includes(String(value.status))) {
    addError(errors, value.status === undefined ? "missing_required" : "invalid_status", "status must be resolved, partial, or unresolved", "status", { expected: "resolved|partial|unresolved", receivedType: valueType(value.status), receivedKeys: keysOf(value.status) });
  }
  if (!["high", "medium", "low"].includes(String(value.confidence))) {
    addError(errors, value.confidence === undefined ? "missing_required" : "invalid_confidence", "confidence must be high, medium, or low", "confidence", { expected: "high|medium|low", receivedType: valueType(value.confidence), receivedKeys: keysOf(value.confidence) });
  }
  if (!Array.isArray(value.requirements) || !Array.isArray(value.branches) || !Array.isArray(value.stepRequirementLinks) || !Array.isArray(value.unresolved)) {
    addError(errors, "invalid_collections", "proposal collections must be arrays", undefined, { expected: "array collections", receivedType: "object", receivedKeys: keysOf(value) });
    return { valid: false, errors };
  }

  const requirementIds = new Set<string>();
  for (const [index, requirement] of value.requirements.entries()) {
    const path = `requirements[${index}]`;
    if (isRecord(requirement) && hasOnlyKeys(requirement, proposalKeys)) {
      const missing = ["proposalId", "kind", "description", "origin"].find((key) => requirement[key] === undefined);
      if (missing) {
        addError(errors, "missing_required", `requirement proposal is missing ${missing}`, `${path}.${missing}`, { expected: "required requirement proposal field", receivedType: "undefined", receivedKeys: keysOf(requirement) });
        continue;
      }
    }
    if (!isRecord(requirement) || !hasOnlyKeys(requirement, proposalKeys) || !validString(requirement.proposalId) || !validString(requirement.kind) || !validString(requirement.description)) {
      addError(errors, "invalid_requirement_proposal", "requirement proposal has invalid or unknown fields", path, { expected: "proposalId, kind, description, and origin", receivedType: valueType(requirement), receivedKeys: keysOf(requirement) });
      continue;
    }
    if (requirementIds.has(requirement.proposalId)) addError(errors, "duplicate_proposal_id", "proposalId must be unique", `${path}.proposalId`);
    requirementIds.add(requirement.proposalId);
    if (requirement.branchProposalId !== undefined && !validString(requirement.branchProposalId)) addError(errors, "invalid_branch_proposal_ref", "branchProposalId must be a non-empty string", `${path}.branchProposalId`, { expected: "non-empty string", receivedType: valueType(requirement.branchProposalId), receivedKeys: keysOf(requirement.branchProposalId) });
    validateOrigin(requirement.origin, `${path}.origin`, errors);
  }

  const branchIds = new Set<string>();
  for (const [index, branch] of value.branches.entries()) {
    const path = `branches[${index}]`;
    if (!isRecord(branch) || !hasOnlyKeys(branch, branchKeys) || !validString(branch.branchProposalId) || !validStringArray(branch.requirementProposalRefs)) {
      addError(errors, "invalid_branch_proposal", "branch proposal has invalid or unknown fields", path, { expected: "branchProposalId and requirementProposalRefs", receivedType: valueType(branch), receivedKeys: keysOf(branch) });
      continue;
    }
    if (branchIds.has(branch.branchProposalId)) addError(errors, "duplicate_branch_proposal_id", "branchProposalId must be unique", `${path}.branchProposalId`);
    branchIds.add(branch.branchProposalId);
    if (branch.conditions !== undefined && !validStringArray(branch.conditions)) addError(errors, "invalid_branch_conditions", "conditions must contain non-empty strings", `${path}.conditions`, { expected: "array of non-empty strings", receivedType: valueType(branch.conditions), receivedKeys: keysOf(branch.conditions) });
    if (branch.destinationIntent !== undefined && !validString(branch.destinationIntent)) addError(errors, "invalid_destination_intent", "destinationIntent must be a non-empty string", `${path}.destinationIntent`, { expected: "non-empty string", receivedType: valueType(branch.destinationIntent), receivedKeys: keysOf(branch.destinationIntent) });
    for (const ref of branch.requirementProposalRefs) if (!requirementIds.has(ref)) addError(errors, "dangling_requirement_proposal_ref", "branch references an unknown requirement proposal", path, { expected: "existing proposalId", receivedType: "string" });
  }
  for (const [index, requirement] of value.requirements.entries()) {
    if (isRecord(requirement) && typeof requirement.branchProposalId === "string" && !branchIds.has(requirement.branchProposalId)) {
      addError(errors, "dangling_branch_proposal_ref", "requirement references an unknown branch proposal", `requirements[${index}].branchProposalId`, { expected: "existing branchProposalId", receivedType: "string" });
    }
  }

  const validOrders = new Set(context.stepOrders);
  for (const [index, link] of value.stepRequirementLinks.entries()) {
    const path = `stepRequirementLinks[${index}]`;
    const linkRecord = isRecord(link) ? link : undefined;
    if (!linkRecord || !hasOnlyKeys(linkRecord, linkKeys) || !Number.isInteger(linkRecord.stepOrder) || (linkRecord.stepOrder as number) <= 0 || !validStringArray(linkRecord.requirementProposalRefs)) {
      addError(errors, "invalid_step_requirement_link", "step link has invalid fields or order", path, { expected: "positive stepOrder and requirementProposalRefs", receivedType: valueType(link), receivedKeys: keysOf(link) });
      continue;
    }
    const stepOrder = linkRecord.stepOrder as number;
    if (!validOrders.has(stepOrder)) addError(errors, "unknown_step_order", "stepOrder does not exist in the canonical scenario", `${path}.stepOrder`, { expected: "existing canonical step order", receivedType: "number" });
    for (const ref of linkRecord.requirementProposalRefs as unknown[]) if (typeof ref === "string" && !requirementIds.has(ref)) addError(errors, "dangling_requirement_proposal_ref", "step link references an unknown requirement proposal", path, { expected: "existing proposalId", receivedType: "string" });
  }

  for (const [index, reason] of value.unresolved.entries()) {
    if (!isRecord(reason) || !hasOnlyKeys(reason, reasonKeys) || !validString(reason.code) || !validString(reason.message) || (reason.path !== undefined && !validString(reason.path))) {
      addError(errors, "invalid_unresolved_reason", "unresolved reason has invalid or unknown fields", `unresolved[${index}]`, { expected: "code and message", receivedType: valueType(reason), receivedKeys: keysOf(reason) });
    }
  }
  return { valid: errors.length === 0, errors };
}

function itemKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => keysOf(item)))].sort();
}

export function summarizeCanonicalSemanticProposalShape(value: unknown): CanonicalSemanticProposalShapeSummary {
  const record = isRecord(value) ? value : {};
  return {
    topLevelKeys: Object.keys(record).sort(),
    statusType: valueType(record.status),
    statusValue: typeof record.status === "string" ? record.status : undefined,
    confidenceType: valueType(record.confidence),
    confidenceValue: typeof record.confidence === "string" ? record.confidence : undefined,
    requirementsType: valueType(record.requirements),
    requirementsCount: Array.isArray(record.requirements) ? record.requirements.length : 0,
    requirementItemKeys: itemKeys(record.requirements),
    branchesType: valueType(record.branches),
    branchesCount: Array.isArray(record.branches) ? record.branches.length : 0,
    branchItemKeys: itemKeys(record.branches),
    stepRequirementLinksType: valueType(record.stepRequirementLinks),
    stepRequirementLinksCount: Array.isArray(record.stepRequirementLinks) ? record.stepRequirementLinks.length : 0,
    stepLinkItemKeys: itemKeys(record.stepRequirementLinks),
    unresolvedType: valueType(record.unresolved),
    unresolvedCount: Array.isArray(record.unresolved) ? record.unresolved.length : 0,
    unresolvedItemKeys: itemKeys(record.unresolved),
  };
}
