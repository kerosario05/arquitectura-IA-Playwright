import { listProjectServiceConfigs, type ProjectServiceConfig } from "../db/project-service-config-repository";
import { listServiceBindings, type BindingOwner } from "../db/service-binding-repository";
import { resolveEffectiveBindings, type ServiceBinding } from "./service-bindings";
import { findServiceProvider } from "./service-registry";
import { SERVICE_PLACEHOLDER_CHAR, type RuntimeServiceBinding } from "./runtime-service-values";

/**
 * Turns the saved bindings of an owner into what one execution needs: the bindings every
 * process of the run receives, the placeholder each bound field carries through admission,
 * and the reasons to refuse the run before anything starts.
 *
 * One run shares one environment, so a valueKey must mean the same thing in every selected
 * scenario; scenarios that disagree have to run separately.
 */

export type ExecutionScenarioFields = { scenarioId: string; valueKeys: string[] };

export type ExecutionServiceBlock = { code: string; message: string; scenarioId?: string; valueKey?: string };

export type ExecutionServicePlan = {
  bindings: RuntimeServiceBinding[];
  /** valueKey -> placeholder, only for fields the request left empty. */
  placeholders: Record<string, string>;
  blocked: ExecutionServiceBlock[];
};

export type ExecutionBindingDeps = {
  listBindings: (owner: BindingOwner) => Promise<ServiceBinding[]>;
  listConfigs: (projectSlug: string) => Promise<ProjectServiceConfig[]>;
  env?: NodeJS.ProcessEnv;
};

const defaultDeps: ExecutionBindingDeps = {
  listBindings: (owner) => listServiceBindings(owner),
  listConfigs: (projectSlug) => listProjectServiceConfigs(projectSlug),
};

/** Adds one owner's bindings to a run that already has others (a batch of recordings). */
export function mergeRunServiceBindings(
  existing: RuntimeServiceBinding[],
  incoming: RuntimeServiceBinding[],
): { bindings: RuntimeServiceBinding[]; conflicts: ExecutionServiceBlock[] } {
  const bindings = [...existing];
  const conflicts: ExecutionServiceBlock[] = [];
  const signature = (binding: RuntimeServiceBinding) =>
    `${binding.serviceKey}|${binding.projectSlug}|${JSON.stringify(binding.params)}`;
  for (const binding of incoming) {
    const same = bindings.find((candidate) => candidate.valueKey.toLowerCase() === binding.valueKey.toLowerCase());
    if (!same) {
      bindings.push(binding);
    } else if (signature(same) !== signature(binding)) {
      conflicts.push({
        code: "service_binding_conflict",
        valueKey: binding.valueKey,
        message: `Las grabaciones del lote llenan "${binding.valueKey}" de forma distinta. Ejecútalas por separado.`,
      });
    }
  }
  return { bindings, conflicts };
}

/** 409 body shared by every execute route when a bound service cannot be used. */
export function serviceBindingBlockedBody(blocked: ExecutionServiceBlock[]) {
  return {
    ok: false,
    error: "SERVICE_BINDING_NOT_READY",
    errorCode: "SERVICE_BINDING_NOT_READY",
    message: blocked.map((block) => block.message).join(" "),
    blocked,
  };
}

export async function planExecutionServices(
  input: BindingOwner & { scenarios: ExecutionScenarioFields[]; values?: Record<string, string | undefined> },
  deps: ExecutionBindingDeps = defaultDeps,
): Promise<ExecutionServicePlan> {
  const plan: ExecutionServicePlan = { bindings: [], placeholders: {}, blocked: [] };
  const saved = await deps.listBindings(input);
  if (saved.length === 0) return plan;
  const configs = await deps.listConfigs(input.projectSlug);

  // valueKey -> what each selected scenario wants for it ("manual" when it types it by hand).
  const wanted = new Map<string, Map<string, { serviceKey: string | null; signature: string; binding: ServiceBinding | null }>>();
  for (const scenario of input.scenarios) {
    const effective = resolveEffectiveBindings(saved, scenario.scenarioId);
    for (const valueKey of new Set(scenario.valueKeys)) {
      const bound = effective.get(valueKey);
      const entry = bound?.serviceKey
        ? {
          serviceKey: bound.serviceKey,
          signature: `${bound.serviceKey}|${JSON.stringify(bound.params)}|${JSON.stringify(bound.segment)}`,
          binding: saved.find((b) => b.id === bound.bindingId) ?? null,
        }
        : { serviceKey: null, signature: "manual", binding: null };
      if (!wanted.has(valueKey)) wanted.set(valueKey, new Map());
      wanted.get(valueKey)!.set(scenario.scenarioId, entry);
    }
  }

  const availabilityByService = new Map<string, ReturnType<NonNullable<ReturnType<typeof findServiceProvider>>["availability"]>>();
  for (const [valueKey, byScenario] of wanted) {
    const entries = [...byScenario.values()];
    if (entries.every((entry) => entry.serviceKey === null)) continue;
    if (new Set(entries.map((entry) => entry.signature)).size > 1) {
      plan.blocked.push({
        code: "service_binding_conflict",
        valueKey,
        message: `Los escenarios seleccionados llenan "${valueKey}" de forma distinta (servicio o parámetros). Ejecútalos por separado.`,
      });
      continue;
    }
    const chosen = entries[0];
    const provider = findServiceProvider(chosen.serviceKey!);
    if (!provider || !chosen.binding) {
      plan.blocked.push({ code: "service_not_found", valueKey, message: `El servicio "${chosen.serviceKey}" ya no existe en el catálogo.` });
      continue;
    }
    const config = configs.find((c) => c.serviceKey === provider.descriptor.key && c.enabled);
    if (!config) {
      plan.blocked.push({
        code: "service_not_enabled",
        valueKey,
        message: `${provider.descriptor.name} no está activado para el proyecto ${input.projectSlug}.`,
      });
      continue;
    }
    if (!availabilityByService.has(provider.descriptor.key)) {
      availabilityByService.set(provider.descriptor.key, provider.availability(deps.env));
    }
    const availability = availabilityByService.get(provider.descriptor.key)!;
    if (!availability.available) {
      // One message per service is enough; every field of it stays out of the run.
      if (!plan.blocked.some((block) => block.code === "service_unavailable" && block.message.startsWith(provider.descriptor.name))) {
        plan.blocked.push({
          code: "service_unavailable",
          valueKey,
          message: `${provider.descriptor.name} no puede ejecutarse en este servidor: ${availability.reasons.join(" ")}`,
        });
      }
      continue;
    }
    const segment = chosen.binding.segment ?? null;
    plan.bindings.push({
      valueKey,
      serviceKey: provider.descriptor.key,
      projectSlug: input.projectSlug,
      settings: config.settings,
      params: chosen.binding.params,
      ...(segment ? { segment } : {}),
    });
    const current = input.values?.[valueKey];
    if (!(typeof current === "string" && current.trim())) {
      // A segment field holds one character of the code; a whole field holds all of it.
      plan.placeholders[valueKey] = SERVICE_PLACEHOLDER_CHAR.repeat(segment ? 1 : provider.descriptor.output.length ?? 6);
    }
  }
  return plan;
}

/** A scenario a rerun replays, as rerun-runner hands it back (recording replays carry their owner). */
export type RerunScenarioOwner = {
  recordingId?: unknown;
  recordedScenarioId?: unknown;
  runtimeInputRequirements?: unknown;
};

/**
 * A rerun replays scenarios whose bindings may never have reached the job it copies (job
 * 7dfc3157 reran a chain that started before services existed, so the recorded OTP was typed).
 * Bindings are therefore planned again from what is saved today, per recording, exactly as
 * the recording's own execute route does. Scenarios that are not recording replays add nothing.
 */
export async function planRerunServiceBindings(
  projectSlug: string,
  scenarios: readonly RerunScenarioOwner[],
  deps: ExecutionBindingDeps = defaultDeps,
): Promise<{ bindings: RuntimeServiceBinding[]; blocked: ExecutionServiceBlock[] }> {
  const byRecording = new Map<string, ExecutionScenarioFields[]>();
  for (const scenario of scenarios) {
    const recordingId = typeof scenario.recordingId === "string" ? scenario.recordingId.trim() : "";
    const scenarioId = typeof scenario.recordedScenarioId === "string" ? scenario.recordedScenarioId.trim() : "";
    if (!recordingId || !scenarioId) continue;
    const valueKeys = (Array.isArray(scenario.runtimeInputRequirements) ? scenario.runtimeInputRequirements : [])
      .map((requirement) => (requirement && typeof requirement === "object" ? (requirement as { valueKey?: unknown }).valueKey : undefined))
      .filter((key): key is string => typeof key === "string" && key.trim() !== "");
    byRecording.set(recordingId, [...(byRecording.get(recordingId) ?? []), { scenarioId, valueKeys }]);
  }
  let bindings: RuntimeServiceBinding[] = [];
  const blocked: ExecutionServiceBlock[] = [];
  for (const [recordingId, recordingScenarios] of byRecording) {
    const plan = await planExecutionServices(
      { projectSlug, ownerType: "recording", ownerId: recordingId, scenarios: recordingScenarios },
      deps,
    );
    blocked.push(...plan.blocked);
    const merged = mergeRunServiceBindings(bindings, plan.bindings);
    bindings = merged.bindings;
    blocked.push(...merged.conflicts);
  }
  return { bindings, blocked };
}
