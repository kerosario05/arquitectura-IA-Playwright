import { Router, type Request, type Response } from "express";
import type { RuntimeInputRequirement } from "../../testrail/testrail-runtime-transformer";
import { resolveScenarioSyntheticValue, type ScenarioSyntheticRequirement } from "../../data/scenario-synthetic-value-resolver";
import { resolveScenarioGeneratedValue } from "../../data/scenario-generated-value-resolver";
import { enrichScenarioInputSemantics, validateProjectGenerationReferences, type ProjectGenerationConfig } from "../../ai/scenario-semantic-enricher";
import { validateGenerationProfile } from "../../testrail/generation-profile";
import { SCENARIO_DATA_SEMANTICS_VERSION } from "../../ai/prompts/scenario-data-semantics";
import type { AiProvider } from "../../ai/ai-provider.types";
import { getProjectGenerationConfig } from "../../db/project-generation-config-service";
import { getByProjectIdAndCase, type InputRequirement as PersistedInputRequirement } from "../../db/project-case-input-requirement-service";
import { getConfirmedRuntimeValues, type PersistedConfirmedRuntimeValue } from "../../db/project-case-runtime-value-service";
import { resolveSmartPrefill, type SmartPrefillRequirement } from "../../data/smart-prefill";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ScenarioAutofillResponse = {
  generated: Array<{ key: string; displayLabel?: string; technicalLabel?: string; datasetIdentity?: string; status: "generated"; value: string | number | boolean; strategy?: string; source?: string; generated: true; verified: false; sensitive: boolean; editable: true; confidence?: number; generationProfile?: unknown; generationProfileSource?: string; generationProfileVersion?: string }>;
  resolved: Array<{ key: string; displayLabel?: string; technicalLabel?: string; datasetIdentity?: string; status: "resolved"; value: string | number | boolean; source: string; generated: boolean; verified: boolean; sensitive: boolean; editable: true; confidence?: number; generationProfile?: unknown; generationProfileSource?: string; generationProfileVersion?: string }>;
  unresolved: Array<{ key: string; status: "unresolved"; reason?: string; enrichmentStatus?: string }>;
  projectGenerationConfigLoaded?: boolean;
  generationConfigVersion?: string;
  confirmedRuntimeAvailable?: boolean;
  compatibleValuesFound?: number;
  incompatibleValuesRejected?: number;
};

type EnrichedRuntimeRequirement = RuntimeInputRequirement & {
  generationProfileSource?: string;
  generationProfileVersion?: string;
  scenarioDataPolicy?: RuntimeInputRequirement["scenarioDataPolicy"] | "configured_value_allowed";
};

export async function resolveScenarioSyntheticBatch(input: {
  seed: string;
  requirements: RuntimeInputRequirement[];
  projectId?: string;
  caseId?: number;
  scenarioContext?: Record<string, unknown>;
  projectGenerationConfig?: ProjectGenerationConfig;
  provider?: AiProvider;
  loadProjectGenerationConfig?: typeof getProjectGenerationConfig;
  loadPersistedRequirements?: (projectId: string, caseId: number) => Promise<PersistedInputRequirement[]>;
  loadConfirmedRuntimeValues?: (projectId: string, caseId: number) => Promise<PersistedConfirmedRuntimeValue[]>;
  contractVersion?: string;
}): Promise<ScenarioAutofillResponse> {
  const generated: ScenarioAutofillResponse["generated"] = [];
  const resolved: ScenarioAutofillResponse["resolved"] = [];
  const unresolved: ScenarioAutofillResponse["unresolved"] = [];
  const projectConfig = input.projectId
    ? await (input.loadProjectGenerationConfig ?? getProjectGenerationConfig)(input.projectId)
    : undefined;
  const config = input.projectId ? projectConfig : input.projectGenerationConfig;
  const persistedRequirements = input.projectId !== undefined && input.caseId !== undefined
    ? await (input.loadPersistedRequirements ?? getByProjectIdAndCase)(input.projectId, input.caseId)
    : [];
  const confirmedRuntimeValues = input.projectId !== undefined && input.caseId !== undefined
    ? await (input.loadConfirmedRuntimeValues ? input.loadConfirmedRuntimeValues(input.projectId, input.caseId) : [])
    : [];
  const requirementByKey = new Map(input.requirements.map((requirement) => [normalizeRuntimeKey(requirement.key), requirement]));
  let incompatibleValuesRejected = 0;
  const confirmedReplayValues: Record<string, { value: string | number | boolean; source: "confirmed_replay"; verified: boolean }> = {};
  for (const snapshot of confirmedRuntimeValues) {
    const requirement = requirementByKey.get(normalizeRuntimeKey(snapshot.key));
    if (!requirement || !isReplayCompatible(requirement, snapshot, input.contractVersion)) {
      incompatibleValuesRejected += 1;
      continue;
    }
    confirmedReplayValues[requirement.key] = { value: snapshot.value, source: "confirmed_replay", verified: snapshot.verified };
  }
  const persistedByKey = new Map(persistedRequirements.map((requirement) => [requirement.key, requirement]));
  const prepared: Array<{ original: RuntimeInputRequirement; runtime: EnrichedRuntimeRequirement; enrichmentStatus?: string }> = [];
  for (const requirement of input.requirements) {
    const effectiveConfig = config ?? {};
    let runtimeRequirement: EnrichedRuntimeRequirement = requirement;
    let enrichmentStatus: string | undefined;
    const persistedBinding = persistedByKey.get(requirement.key);
    if (persistedBinding?.namedProfileRef) {
      const configuredProfile = (effectiveConfig as any).namedProfiles?.[persistedBinding.namedProfileRef];
      const bindingIsValid = configuredProfile !== undefined
        && validateGenerationProfile({ fieldCapability: requirement.fieldCapability, generationProfile: configuredProfile }).valid
        && validateProjectGenerationReferences(configuredProfile, effectiveConfig).valid;
      if (!bindingIsValid) {
        unresolved.push({ key: requirement.key, status: "unresolved", reason: "named_profile_reference_not_configured" });
        continue;
      }
      runtimeRequirement = {
        ...requirement,
        generationProfile: configuredProfile,
        ...(configuredProfile.sourceMode === "configured_values" ? { scenarioDataPolicy: "configured_value_allowed" as const } : {}),
      };
    }
    const existingProfileIsValid = !persistedBinding?.namedProfileRef && requirement.generationProfile !== undefined
      && validateGenerationProfile({ fieldCapability: requirement.fieldCapability, generationProfile: requirement.generationProfile }).valid
      && validateProjectGenerationReferences(requirement.generationProfile, effectiveConfig).valid;
    const hasContext = Object.keys(input.scenarioContext ?? {}).length > 0;
    const canEnrich = requirement.inputRole === "scenario"
      && requirement.valuePolicy === "scenario_controlled"
      && requirement.scenarioDataPolicy !== "trusted_required"
      && requirement.scenarioDataPolicy !== "explicit_value"
      && requirement.sensitive !== true
      && requirement.fieldCapability.kind !== "password"
      && input.provider !== undefined;
    if (persistedBinding?.namedProfileRef) {
      enrichmentStatus = "skipped_persisted_binding";
    } else if (existingProfileIsValid) {
      enrichmentStatus = "skipped_existing_profile";
      if (requirement.generationProfile?.sourceMode === "configured_values") {
        runtimeRequirement = { ...requirement, scenarioDataPolicy: "configured_value_allowed" };
      }
    } else if (hasContext && canEnrich) {
      const enrichment = await enrichScenarioInputSemantics({
        requirement,
        scenarioContext: input.scenarioContext ?? {},
        projectGenerationConfig: effectiveConfig,
        provider: input.provider,
      });
      enrichmentStatus = enrichment.status;
      if (enrichment.status === "accepted" && enrichment.generationProfile) {
        runtimeRequirement = {
          ...requirement,
          generationProfile: enrichment.generationProfile,
          ...(enrichment.generationProfile.sourceMode === "configured_values" ? { scenarioDataPolicy: "configured_value_allowed" as const } : {}),
          generationProfileSource: "ai_semantic_enrichment",
          generationProfileVersion: SCENARIO_DATA_SEMANTICS_VERSION,
        };
      } else {
        unresolved.push({ key: requirement.key, status: "unresolved", reason: enrichment.reason, enrichmentStatus });
        continue;
      }
    }
    prepared.push({ original: requirement, runtime: runtimeRequirement, ...(enrichmentStatus ? { enrichmentStatus } : {}) });
  }

  const preparedByKey = new Map(prepared.map((item) => [item.original.key, item]));
  const smartPrefill = await resolveSmartPrefill({
    requirements: prepared.map(({ original, runtime }) => ({
      key: original.key,
      ...(original.displayLabel ? { label: original.displayLabel, canonicalLabel: original.label } : original.label ? { label: original.label } : {}),
      ...(original.semanticType ? { semanticType: original.semanticType } : {}),
      ...(original.sensitive !== undefined ? { sensitive: original.sensitive } : {}),
      ...(original.required !== undefined ? { required: original.required } : {}),
      fieldCapability: original.fieldCapability,
      ...(runtime.datasetIdentity ? { datasetIdentity: runtime.datasetIdentity } : {}),
      ...(original.inputUsage ? { inputUsage: original.inputUsage } : {}),
      ...(original.inputRole ? { inputRole: original.inputRole } : {}),
      ...(original.valuePolicy ? { valuePolicy: original.valuePolicy } : {}),
      ...(original.scenarioDataPolicy ? { scenarioDataPolicy: original.scenarioDataPolicy } : {}),
    } satisfies SmartPrefillRequirement)),
    seed: input.seed,
    confirmedReplayValues,
    locale: (config as any)?.locale,
    aiFallback: input.provider
      ? async ({ datasetIdentity, locale, fields }) => {
        const completion = await input.provider!.completeJson({
          messages: [
            { role: "system", content: "Return only the strict JSON object {\"fields\":[{\"key\":string,\"semanticType\":string,\"displayLabel\":string,\"generatedValue\":string|number|boolean,\"confidence\":number}]} for the supplied non-sensitive fields. Never invent keys." },
            { role: "user", content: JSON.stringify({ datasetIdentity, locale, fields }) },
          ],
          requireJson: true,
          requireJsonSchema: true,
          purpose: "scenario_generation",
        });
        return completion.parsedJson;
      }
      : undefined,
    deterministicResolver: ({ requirement }) => {
      const preparedRequirement = preparedByKey.get(requirement.key)?.runtime;
      if (!preparedRequirement) return { blocked: true };
      const result = preparedRequirement.generationProfile?.valueKind
        ? resolveScenarioGeneratedValue({ requirement: preparedRequirement as any, generationProfile: preparedRequirement.generationProfile, projectGenerationConfig: (config ?? {}) as any, seed: input.seed })
        : resolveScenarioSyntheticValue({
          requirement: {
            ...preparedRequirement,
            semanticType: preparedRequirement.generationProfile?.semanticType,
            locale: (config as any)?.locale,
            countryCode: (config as any)?.countryCode,
            allowManualSynthetic: true,
          } as ScenarioSyntheticRequirement,
          seed: input.seed,
        });
      if ((result.status === "generated" || result.status === "resolved") && result.value !== undefined) {
        return {
          value: result.value,
          source: "source" in result && result.source === "configured_values" ? "configured_values" : "deterministic_synthetic",
        };
      }
      if (result.status === "blocked") return { blocked: true };
      return undefined;
    },
  });

  const smartFieldsByKey = new Map(smartPrefill.fields.map((field) => [field.key, field]));
  for (const preparedRequirement of prepared) {
    const field = smartFieldsByKey.get(preparedRequirement.original.key);
    if (!field) continue;
    if (field.value === undefined) {
      unresolved.push({ key: field.key, status: "unresolved", ...(preparedRequirement?.enrichmentStatus ? { enrichmentStatus: preparedRequirement.enrichmentStatus } : {}) });
      continue;
    }
    const resolvedField = {
      key: field.key,
      displayLabel: field.displayLabel,
      technicalLabel: preparedRequirement.runtime.technicalLabel ?? field.key,
      ...(field.datasetIdentity ? { datasetIdentity: field.datasetIdentity } : {}),
      status: "resolved" as const,
      value: field.value,
      generated: field.generated,
      verified: field.verified,
      sensitive: field.sensitive,
      editable: field.editable,
      source: field.source,
      ...(preparedRequirement.runtime.generationProfile ? { generationProfile: preparedRequirement.runtime.generationProfile } : {}),
      ...(preparedRequirement.runtime.generationProfileSource ? { generationProfileSource: preparedRequirement.runtime.generationProfileSource, generationProfileVersion: preparedRequirement.runtime.generationProfileVersion } : {}),
    };
    resolved.push(resolvedField);
    if (field.generated) {
      generated.push({ ...resolvedField, status: "generated", generated: true, verified: false });
    }
  }
  console.log(`[runtime-input-contract] caseId=${input.caseId ?? "unknown"} count=${input.requirements.length} humanLabelCount=${input.requirements.filter((item) => Boolean(item.displayLabel ?? item.label)).length} entityMetadataCount=${input.requirements.filter((item) => Boolean(item.entityDisplayName ?? item.datasetIdentity)).length} prefilledCount=${generated.length} missingCount=${unresolved.length} sensitiveCount=${input.requirements.filter((item) => item.sensitive === true || item.fieldCapability.kind === "password").length}`);
  const replayed = resolved.filter((item) => item.source === "confirmed_replay").length;
  console.log(`[smart-prefill-integration] called=true resolved=${resolved.length} replayed=${replayed} compatible=${Object.keys(confirmedReplayValues).length} incompatible=${incompatibleValuesRejected} config=${resolved.filter((item) => item.source === "configured_values" || item.source === "project_config").length} deterministic=${resolved.filter((item) => item.source === "deterministic_synthetic").length} ai=${smartPrefill.aiCalls} missing=${unresolved.length}`);
  for (const field of smartPrefill.fields) console.log(`[runtime-input-contract] key=${field.key} displaySource=${field.labelSource} valueSource=${field.source} generated=${field.generated} sensitive=${field.sensitive}`);
  return {
    generated,
    resolved,
    unresolved,
    confirmedRuntimeAvailable: confirmedRuntimeValues.length > 0,
    compatibleValuesFound: Object.keys(confirmedReplayValues).length,
    incompatibleValuesRejected,
    ...(input.projectId ? { projectGenerationConfigLoaded: projectConfig !== undefined, ...(projectConfig?.version ? { generationConfigVersion: projectConfig.version } : {}) } : {}),
  };
}

function normalizeRuntimeKey(key: string): string {
  return key.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isReplayCompatible(
  requirement: RuntimeInputRequirement,
  snapshot: PersistedConfirmedRuntimeValue,
  contractVersion?: string,
): boolean {
  if (requirement.sensitive === true || requirement.fieldCapability.kind === "password") return false;
  if (snapshot.semanticType && requirement.semanticType && snapshot.semanticType !== requirement.semanticType) return false;
  if (snapshot.fieldKind && requirement.fieldCapability.kind && snapshot.fieldKind !== requirement.fieldCapability.kind) return false;
  if (snapshot.datasetIdentity && requirement.datasetIdentity && snapshot.datasetIdentity !== requirement.datasetIdentity) return false;
  if (snapshot.contractVersion && contractVersion && snapshot.contractVersion !== contractVersion) return false;
  return true;
}

const router = Router();

router.post("/api/runtime-inputs/scenario-autofill", (req: Request, res: Response, next) => {
  const body = req.body as { projectId?: unknown; caseId?: unknown; seed?: unknown; requirements?: unknown; scenarioContext?: unknown; projectGenerationConfig?: unknown; contractVersion?: unknown } | undefined;
  if (typeof body?.seed !== "string" || !Array.isArray(body.requirements)) {
    return res.status(400).json({ error: "seed_and_requirements_required" });
  }
  return resolveScenarioSyntheticBatch({
    seed: body.seed,
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    caseId: typeof body.caseId === "number" && Number.isInteger(body.caseId) ? body.caseId : undefined,
    requirements: body.requirements as RuntimeInputRequirement[],
    scenarioContext: isRecord(body.scenarioContext) ? body.scenarioContext : undefined,
    projectGenerationConfig: isRecord(body.projectGenerationConfig) ? body.projectGenerationConfig as ProjectGenerationConfig : undefined,
    contractVersion: typeof body.contractVersion === "string" ? body.contractVersion : undefined,
    // SQL replay is opt-in until migration 004 is applied in the target DB.
    // The contract remains available with deterministic/configured resolution
    // when the additive table is not present in a local environment.
    ...(process.env.RUNTIME_CONFIRMED_REPLAY_ENABLED?.toLowerCase() === "true"
      ? { loadConfirmedRuntimeValues: getConfirmedRuntimeValues }
      : {}),
  }).then((result) => res.json(result)).catch(next);
});

export { router as runtimeInputsRouter };
