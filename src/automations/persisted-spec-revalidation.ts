import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { revalidateExistingSpecDeterministically, type ExistingSpecRevalidationResult } from "./existing-spec-revalidation";
import { upsertAutomationIndexEntry, type PromotedAutomationIndex } from "./automation-index";

export type SuccessfulExistingSpecRevalidationPersistenceInput = {
  caseDir: string;
  appSlug: string;
  sectionSlug?: string;
  caseId?: number;
  identityValidated: boolean;
  specText: string;
  result: ExistingSpecRevalidationResult;
};

export type SuccessfulExistingSpecRevalidationPersistenceResult = {
  persisted: boolean;
  reason?: string;
};

export type ExistingVerifiedSpecPromotionInput = {
  caseDir: string;
  appSlug: string;
  sectionSlug: string;
  caseId: number;
  specPath: string;
};

export type ExistingVerifiedSpecPromotionResult = {
  promotionSucceeded: boolean;
  reason?: string;
};

export type PromotedArtifactIdentity = {
  promotionPersisted: true;
  promotedSpecPath: string;
  promotedSpecHash: string;
};

export function buildPromotedArtifactIdentity(specPath: string, specText: string): PromotedArtifactIdentity {
  return {
    promotionPersisted: true,
    promotedSpecPath: path.resolve(specPath),
    promotedSpecHash: createHash("sha256").update(specText, "utf8").digest("hex"),
  };
}

async function writeAutomationFileAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeRegistryBundleAtomically(files: Array<{ path: string; content: string }>): Promise<void> {
  const temps = files.map((file) => ({ ...file, tempPath: `${file.path}.${process.pid}.${Date.now()}.tmp` }));
  try {
    await Promise.all(temps.map((file) => fs.writeFile(file.tempPath, file.content, "utf8")));
    for (const file of temps) await fs.rename(file.tempPath, file.path);
  } catch (error) {
    await Promise.all(temps.map((file) => fs.rm(file.tempPath, { force: true }).catch(() => undefined)));
    throw error;
  }
}

/** Promote the exact physical spec whose successful revalidation is already persisted. */
export async function promoteExistingVerifiedSpec(
  input: ExistingVerifiedSpecPromotionInput
): Promise<ExistingVerifiedSpecPromotionResult> {
  const caseDir = path.resolve(input.caseDir);
  const specPath = path.resolve(input.specPath);
  const expectedSpecPath = path.join(caseDir, "case.spec.ts");
  if (specPath !== expectedSpecPath) return { promotionSucceeded: false, reason: "spec_path_mismatch" };

  const automationPath = path.join(caseDir, "automation.json");
  const planPath = path.join(caseDir, "plan.json");
  const appDir = path.resolve(caseDir, "..", "..", "..", "..");
  const appIndexPath = path.join(appDir, "index.json");
  const globalIndexPath = path.resolve(appDir, "..", "..", "index.json");
  let automation: any;
  let plan: any;
  let specText: string;
  let appIndex: PromotedAutomationIndex;
  let globalIndex: PromotedAutomationIndex;
  try {
    [automation, plan, specText, appIndex, globalIndex] = await Promise.all([
      fs.readFile(automationPath, "utf8").then(JSON.parse),
      fs.readFile(planPath, "utf8").then(JSON.parse),
      fs.readFile(specPath, "utf8"),
      fs.readFile(appIndexPath, "utf8").then(JSON.parse),
      fs.readFile(globalIndexPath, "utf8").then(JSON.parse),
    ]);
  } catch {
    return { promotionSucceeded: false, reason: "required_artifact_missing" };
  }

  const promotedIdentity = buildPromotedArtifactIdentity(specPath, specText);
  const physicalHash = promotedIdentity.promotedSpecHash;
  const persistedSpecGeneration = automation.metadata?.specGeneration;
  const persistedPreviousHash = persistedSpecGeneration?.previousSpec?.hash;
  const revalidation = persistedSpecGeneration?.deterministicRevalidation;
  const identityValid = automation.appSlug === input.appSlug
    && automation.caseId === input.caseId
    && caseDir.toLowerCase().includes(`${path.sep}${input.sectionSlug.toLowerCase()}${path.sep}`)
    && path.basename(caseDir).toLowerCase().startsWith(`c${input.caseId}-`);
  const contextValid = Boolean(
    plan.sourceScenario
    && plan.executionContract
    && (plan.executionContract.scenarioId === automation.externalId
      || String(plan.executionContract.scenarioId) === String(automation.caseId))
  );
  if (!identityValid) return { promotionSucceeded: false, reason: "case_identity_mismatch" };
  if (!contextValid) return { promotionSucceeded: false, reason: "promotion_context_missing_or_mismatched" };
  if (automation.status !== "spec_failed") return { promotionSucceeded: false, reason: "unexpected_status" };
  if (automation.specVerificationStatus !== "passed") return { promotionSucceeded: false, reason: "verification_not_passed" };
  if (!revalidation || revalidation.passed !== true || !revalidation.validatedSpecHash) {
    return { promotionSucceeded: false, reason: "revalidation_not_green" };
  }
  if (physicalHash !== persistedPreviousHash || physicalHash !== revalidation.validatedSpecHash) {
    return { promotionSucceeded: false, reason: "physical_hash_mismatch" };
  }

  const promotedEntry: any = {
    ...automation,
    ...promotedIdentity,
    status: "active",
    specVerificationStatus: "passed",
    metadata: {
      ...(automation.metadata ?? {}),
      specGeneration: {
        ...(persistedSpecGeneration ?? {}),
        promotionAllowed: true,
        specWritten: false,
        previousSpec: {
          ...(persistedSpecGeneration.previousSpec ?? {}),
          existed: true,
          hash: physicalHash,
        },
      },
    },
  };
  const updatedAppIndex = upsertAutomationIndexEntry(appIndex, promotedEntry);
  const updatedGlobalIndex = upsertAutomationIndexEntry(globalIndex, promotedEntry);
  await writeRegistryBundleAtomically([
    { path: automationPath, content: JSON.stringify(promotedEntry, null, 2) },
    { path: appIndexPath, content: JSON.stringify({ ...updatedAppIndex, updatedAt: new Date().toISOString() }, null, 2) },
    { path: globalIndexPath, content: JSON.stringify({ ...updatedGlobalIndex, updatedAt: new Date().toISOString() }, null, 2) },
  ]);
  return { promotionSucceeded: true };
}

/** Persist only a GREEN result for the exact physical previousSpec that was validated. */
export async function persistSuccessfulExistingSpecRevalidation(
  input: SuccessfulExistingSpecRevalidationPersistenceInput
): Promise<SuccessfulExistingSpecRevalidationPersistenceResult> {
  if (!input.identityValidated) return { persisted: false, reason: "identity_not_validated" };
  if (input.result.status !== "passed" || !input.result.allRequiredGatesPassed) {
    return { persisted: false, reason: "revalidation_not_passed" };
  }
  if (!input.result.validatedSpecHash) return { persisted: false, reason: "validated_spec_hash_missing" };

  const caseDir = path.resolve(input.caseDir);
  const specPath = path.join(caseDir, "case.spec.ts");
  const automationPath = path.join(caseDir, "automation.json");
  const planPath = path.join(caseDir, "plan.json");
  let automation: any;
  let plan: any;
  let physicalSpecText: string;
  let physicalSpecStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    [automation, plan, physicalSpecText, physicalSpecStat] = await Promise.all([
      fs.readFile(automationPath, "utf8").then(JSON.parse),
      fs.readFile(planPath, "utf8").then(JSON.parse),
      fs.readFile(specPath, "utf8"),
      fs.stat(specPath),
    ]);
  } catch {
    return { persisted: false, reason: "required_artifact_missing" };
  }

  const pathHasSection = !input.sectionSlug
    || caseDir.toLowerCase().includes(`${path.sep}${input.sectionSlug.toLowerCase()}${path.sep}`);
  const pathHasCase = input.caseId === undefined
    || path.basename(caseDir).toLowerCase().startsWith(`c${input.caseId}-`);
  const identityMatches = automation.appSlug === input.appSlug
    && (input.caseId === undefined || automation.caseId === input.caseId)
    && pathHasSection
    && pathHasCase;
  const contractMatchesCase = Boolean(
    plan.sourceScenario
    && plan.executionContract
    && plan.executionContract.scenarioId
    && (plan.executionContract.scenarioId === automation.externalId
      || String(plan.executionContract.scenarioId) === String(automation.caseId))
  );
  const specHash = createHash("sha256").update(physicalSpecText, "utf8").digest("hex");
  if (!identityMatches || !contractMatchesCase) return { persisted: false, reason: "case_identity_mismatch" };
  if (physicalSpecText !== input.specText) return { persisted: false, reason: "spec_text_changed" };
  if (specHash !== input.result.validatedSpecHash) return { persisted: false, reason: "validated_hash_mismatch" };

  const persistedAt = new Date().toISOString();
  const updatedAutomation = {
    ...automation,
    // Revalidation does not grant promotion or active execution authority.
    status: automation.status,
    specVerificationStatus: "passed",
    metadata: {
      ...(automation.metadata ?? {}),
      specGeneration: {
        ...(automation.metadata?.specGeneration ?? {}),
        previousSpec: {
          ...(automation.metadata?.specGeneration?.previousSpec ?? {}),
          existed: true,
          hash: specHash,
          lastModifiedAt: physicalSpecStat.mtime.toISOString(),
        },
        deterministicRevalidation: {
          passed: true,
          validatedSpecHash: specHash,
          persistedAt,
        },
      },
    },
  };
  await writeAutomationFileAtomically(automationPath, JSON.stringify(updatedAutomation, null, 2));
  return { persisted: true };
}

export type PersistedRevalidationContext = {
  specText: string;
  specPath: string;
  specHash: string;
  sourceScenario?: Record<string, unknown>;
  executionContract?: Record<string, unknown>;
  contextSources: { spec: string; sourceScenario: string; executionContract: string };
  identityValidated: boolean;
  missingContextFields: string[];
};

export type DeterministicRevalidationEligibilityInput = {
  previousSpecExisted?: boolean;
  specText?: string;
  specPath?: string;
  sourceScenario?: Record<string, unknown>;
  executionContract?: Record<string, unknown>;
  identityValidated: boolean;
  semanticContext?: Parameters<typeof revalidateExistingSpecDeterministically>[0]["semanticContext"];
};

/** Eligibility for deterministic revalidation is intentionally independent of promoted-reuse status. */
export function isEligibleForDeterministicRevalidation(input: DeterministicRevalidationEligibilityInput): boolean {
  const semanticContextAvailable = Boolean(
    input.semanticContext?.requiredAssertions
    && input.semanticContext.observableOracles
    && input.semanticContext.scenarioSteps
  );
  return input.previousSpecExisted !== false
    && input.identityValidated
    && Boolean(input.specText?.trim())
    && Boolean(input.specPath?.trim())
    && Boolean(input.sourceScenario)
    && Boolean(input.executionContract)
    && semanticContextAvailable;
}

export async function loadExistingSpecRevalidationContext(input: {
  caseDir: string;
  appSlug: string;
  sectionSlug?: string;
  caseId?: number;
}): Promise<PersistedRevalidationContext> {
  const caseDir = path.resolve(input.caseDir);
  const [automation, plan, specText] = await Promise.all([
    fs.readFile(path.join(caseDir, "automation.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(caseDir, "plan.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(caseDir, "case.spec.ts"), "utf8"),
  ]);
  const specPath = path.join(caseDir, "case.spec.ts");
  const specHash = createHash("sha256").update(specText).digest("hex");
  const identityValidated = automation.appSlug === input.appSlug
    && (!input.caseId || automation.caseId === input.caseId)
    && (!input.sectionSlug || caseDir.toLowerCase().includes(`${path.sep}${input.sectionSlug.toLowerCase()}${path.sep}`))
    && (!automation.metadata?.specGeneration?.previousSpec?.hash || automation.metadata.specGeneration.previousSpec.hash === specHash);
  const sourceScenario = plan.sourceScenario;
  const executionContract = plan.executionContract;
  const missingContextFields = [
    ...(sourceScenario ? [] : ["sourceScenario"]),
    ...(executionContract ? [] : ["executionContract"]),
  ];
  console.log(`[existing-spec-revalidation-context] resolved=${identityValidated && missingContextFields.length === 0} sourceScenario=${sourceScenario ? "plan" : "missing"} executionContract=${executionContract ? "plan" : "missing"} identityValidated=${identityValidated}`);
  return { specText, specPath, specHash, sourceScenario, executionContract, contextSources: { spec: "case.spec.ts", sourceScenario: sourceScenario ? "plan.json" : "missing", executionContract: executionContract ? "plan.json" : "missing" }, identityValidated, missingContextFields };
}

export async function revalidatePersistedExistingSpec(input: Parameters<typeof loadExistingSpecRevalidationContext>[0] & { semanticContext?: Parameters<typeof revalidateExistingSpecDeterministically>[0]["semanticContext"] }): Promise<ExistingSpecRevalidationResult & { context: PersistedRevalidationContext }> {
  const context = await loadExistingSpecRevalidationContext(input);
  if (!isEligibleForDeterministicRevalidation({
    previousSpecExisted: true,
    specText: context.specText,
    specPath: context.specPath,
    sourceScenario: context.sourceScenario,
    executionContract: context.executionContract,
    identityValidated: context.identityValidated,
    semanticContext: input.semanticContext,
  }) || context.missingContextFields.length > 0) {
    return { status: "insufficient_context", allRequiredGatesPassed: false, aiInvocationCount: 0, candidateGenerated: false, context };
  }
  const result = await revalidateExistingSpecDeterministically({
    ...context,
    semanticContext: input.semanticContext,
    runTypeScriptValidation: input.runTypeScriptValidation,
    runPlaywrightDiscovery: input.runPlaywrightDiscovery,
  });
  return { ...result, context };
}
