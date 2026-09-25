"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPromotedArtifactIdentity = buildPromotedArtifactIdentity;
exports.promoteExistingVerifiedSpec = promoteExistingVerifiedSpec;
exports.persistSuccessfulExistingSpecRevalidation = persistSuccessfulExistingSpecRevalidation;
exports.isEligibleForDeterministicRevalidation = isEligibleForDeterministicRevalidation;
exports.loadExistingSpecRevalidationContext = loadExistingSpecRevalidationContext;
exports.revalidatePersistedExistingSpec = revalidatePersistedExistingSpec;
const node_crypto_1 = require("node:crypto");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const existing_spec_revalidation_1 = require("./existing-spec-revalidation");
const automation_index_1 = require("./automation-index");
function buildPromotedArtifactIdentity(specPath, specText) {
    return {
        promotionPersisted: true,
        promotedSpecPath: node_path_1.default.resolve(specPath),
        promotedSpecHash: (0, node_crypto_1.createHash)("sha256").update(specText, "utf8").digest("hex"),
    };
}
async function writeAutomationFileAtomically(filePath, content) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await promises_1.default.writeFile(tempPath, content, "utf8");
        await promises_1.default.rename(tempPath, filePath);
    }
    catch (error) {
        await promises_1.default.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function writeRegistryBundleAtomically(files) {
    const temps = files.map((file) => ({ ...file, tempPath: `${file.path}.${process.pid}.${Date.now()}.tmp` }));
    try {
        await Promise.all(temps.map((file) => promises_1.default.writeFile(file.tempPath, file.content, "utf8")));
        for (const file of temps)
            await promises_1.default.rename(file.tempPath, file.path);
    }
    catch (error) {
        await Promise.all(temps.map((file) => promises_1.default.rm(file.tempPath, { force: true }).catch(() => undefined)));
        throw error;
    }
}
/** Promote the exact physical spec whose successful revalidation is already persisted. */
async function promoteExistingVerifiedSpec(input) {
    const caseDir = node_path_1.default.resolve(input.caseDir);
    const specPath = node_path_1.default.resolve(input.specPath);
    const expectedSpecPath = node_path_1.default.join(caseDir, "case.spec.ts");
    if (specPath !== expectedSpecPath)
        return { promotionSucceeded: false, reason: "spec_path_mismatch" };
    const automationPath = node_path_1.default.join(caseDir, "automation.json");
    const planPath = node_path_1.default.join(caseDir, "plan.json");
    const appDir = node_path_1.default.resolve(caseDir, "..", "..", "..", "..");
    const appIndexPath = node_path_1.default.join(appDir, "index.json");
    const globalIndexPath = node_path_1.default.resolve(appDir, "..", "..", "index.json");
    let automation;
    let plan;
    let specText;
    let appIndex;
    let globalIndex;
    try {
        [automation, plan, specText, appIndex, globalIndex] = await Promise.all([
            promises_1.default.readFile(automationPath, "utf8").then(JSON.parse),
            promises_1.default.readFile(planPath, "utf8").then(JSON.parse),
            promises_1.default.readFile(specPath, "utf8"),
            promises_1.default.readFile(appIndexPath, "utf8").then(JSON.parse),
            promises_1.default.readFile(globalIndexPath, "utf8").then(JSON.parse),
        ]);
    }
    catch {
        return { promotionSucceeded: false, reason: "required_artifact_missing" };
    }
    const promotedIdentity = buildPromotedArtifactIdentity(specPath, specText);
    const physicalHash = promotedIdentity.promotedSpecHash;
    const persistedSpecGeneration = automation.metadata?.specGeneration;
    const persistedPreviousHash = persistedSpecGeneration?.previousSpec?.hash;
    const revalidation = persistedSpecGeneration?.deterministicRevalidation;
    const identityValid = automation.appSlug === input.appSlug
        && automation.caseId === input.caseId
        && caseDir.toLowerCase().includes(`${node_path_1.default.sep}${input.sectionSlug.toLowerCase()}${node_path_1.default.sep}`)
        && node_path_1.default.basename(caseDir).toLowerCase().startsWith(`c${input.caseId}-`);
    const contextValid = Boolean(plan.sourceScenario
        && plan.executionContract
        && (plan.executionContract.scenarioId === automation.externalId
            || String(plan.executionContract.scenarioId) === String(automation.caseId)));
    if (!identityValid)
        return { promotionSucceeded: false, reason: "case_identity_mismatch" };
    if (!contextValid)
        return { promotionSucceeded: false, reason: "promotion_context_missing_or_mismatched" };
    if (automation.status !== "spec_failed")
        return { promotionSucceeded: false, reason: "unexpected_status" };
    if (automation.specVerificationStatus !== "passed")
        return { promotionSucceeded: false, reason: "verification_not_passed" };
    if (!revalidation || revalidation.passed !== true || !revalidation.validatedSpecHash) {
        return { promotionSucceeded: false, reason: "revalidation_not_green" };
    }
    if (physicalHash !== persistedPreviousHash || physicalHash !== revalidation.validatedSpecHash) {
        return { promotionSucceeded: false, reason: "physical_hash_mismatch" };
    }
    const promotedEntry = {
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
    const updatedAppIndex = (0, automation_index_1.upsertAutomationIndexEntry)(appIndex, promotedEntry);
    const updatedGlobalIndex = (0, automation_index_1.upsertAutomationIndexEntry)(globalIndex, promotedEntry);
    await writeRegistryBundleAtomically([
        { path: automationPath, content: JSON.stringify(promotedEntry, null, 2) },
        { path: appIndexPath, content: JSON.stringify({ ...updatedAppIndex, updatedAt: new Date().toISOString() }, null, 2) },
        { path: globalIndexPath, content: JSON.stringify({ ...updatedGlobalIndex, updatedAt: new Date().toISOString() }, null, 2) },
    ]);
    return { promotionSucceeded: true };
}
/** Persist only a GREEN result for the exact physical previousSpec that was validated. */
async function persistSuccessfulExistingSpecRevalidation(input) {
    if (!input.identityValidated)
        return { persisted: false, reason: "identity_not_validated" };
    if (input.result.status !== "passed" || !input.result.allRequiredGatesPassed) {
        return { persisted: false, reason: "revalidation_not_passed" };
    }
    if (!input.result.validatedSpecHash)
        return { persisted: false, reason: "validated_spec_hash_missing" };
    const caseDir = node_path_1.default.resolve(input.caseDir);
    const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
    const automationPath = node_path_1.default.join(caseDir, "automation.json");
    const planPath = node_path_1.default.join(caseDir, "plan.json");
    let automation;
    let plan;
    let physicalSpecText;
    let physicalSpecStat;
    try {
        [automation, plan, physicalSpecText, physicalSpecStat] = await Promise.all([
            promises_1.default.readFile(automationPath, "utf8").then(JSON.parse),
            promises_1.default.readFile(planPath, "utf8").then(JSON.parse),
            promises_1.default.readFile(specPath, "utf8"),
            promises_1.default.stat(specPath),
        ]);
    }
    catch {
        return { persisted: false, reason: "required_artifact_missing" };
    }
    const pathHasSection = !input.sectionSlug
        || caseDir.toLowerCase().includes(`${node_path_1.default.sep}${input.sectionSlug.toLowerCase()}${node_path_1.default.sep}`);
    const pathHasCase = input.caseId === undefined
        || node_path_1.default.basename(caseDir).toLowerCase().startsWith(`c${input.caseId}-`);
    const identityMatches = automation.appSlug === input.appSlug
        && (input.caseId === undefined || automation.caseId === input.caseId)
        && pathHasSection
        && pathHasCase;
    const contractMatchesCase = Boolean(plan.sourceScenario
        && plan.executionContract
        && plan.executionContract.scenarioId
        && (plan.executionContract.scenarioId === automation.externalId
            || String(plan.executionContract.scenarioId) === String(automation.caseId)));
    const specHash = (0, node_crypto_1.createHash)("sha256").update(physicalSpecText, "utf8").digest("hex");
    if (!identityMatches || !contractMatchesCase)
        return { persisted: false, reason: "case_identity_mismatch" };
    if (physicalSpecText !== input.specText)
        return { persisted: false, reason: "spec_text_changed" };
    if (specHash !== input.result.validatedSpecHash)
        return { persisted: false, reason: "validated_hash_mismatch" };
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
/** Eligibility for deterministic revalidation is intentionally independent of promoted-reuse status. */
function isEligibleForDeterministicRevalidation(input) {
    const semanticContextAvailable = Boolean(input.semanticContext?.requiredAssertions
        && input.semanticContext.observableOracles
        && input.semanticContext.scenarioSteps);
    return input.previousSpecExisted !== false
        && input.identityValidated
        && Boolean(input.specText?.trim())
        && Boolean(input.specPath?.trim())
        && Boolean(input.sourceScenario)
        && Boolean(input.executionContract)
        && semanticContextAvailable;
}
async function loadExistingSpecRevalidationContext(input) {
    const caseDir = node_path_1.default.resolve(input.caseDir);
    const [automation, plan, specText] = await Promise.all([
        promises_1.default.readFile(node_path_1.default.join(caseDir, "automation.json"), "utf8").then(JSON.parse),
        promises_1.default.readFile(node_path_1.default.join(caseDir, "plan.json"), "utf8").then(JSON.parse),
        promises_1.default.readFile(node_path_1.default.join(caseDir, "case.spec.ts"), "utf8"),
    ]);
    const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
    const specHash = (0, node_crypto_1.createHash)("sha256").update(specText).digest("hex");
    const identityValidated = automation.appSlug === input.appSlug
        && (!input.caseId || automation.caseId === input.caseId)
        && (!input.sectionSlug || caseDir.toLowerCase().includes(`${node_path_1.default.sep}${input.sectionSlug.toLowerCase()}${node_path_1.default.sep}`))
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
async function revalidatePersistedExistingSpec(input) {
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
    const result = await (0, existing_spec_revalidation_1.revalidateExistingSpecDeterministically)({
        ...context,
        semanticContext: input.semanticContext,
        runTypeScriptValidation: input.runTypeScriptValidation,
        runPlaywrightDiscovery: input.runPlaywrightDiscovery,
    });
    return { ...result, context };
}
