import { resolveBindingParams, type BindingParamValue, type BindingSegment } from "./service-bindings";
import { getServiceProvider } from "./service-registry";

/**
 * Step-time resolution of scenario values that a catalog service fills (OTP first).
 *
 * The server puts the effective bindings of a run in PROMOTED_SERVICE_BINDINGS_JSON;
 * every process of that run (discovery replay, promoted spec) inherits it. When a step
 * is about to type a bound valueKey, the engine asks this module instead of using the
 * placeholder the dataset carried. Values are never logged, persisted or put in env.
 */

export const SERVICE_BINDINGS_ENV = "PROMOTED_SERVICE_BINDINGS_JSON";

/**
 * What the dataset carries for a bound field so admission, readiness and the spec's
 * required-env checks see a value. Digits, so length/format checks pass; never typed.
 */
export const SERVICE_PLACEHOLDER_CHAR = "0";

export type RuntimeServiceBinding = {
  valueKey: string;
  serviceKey: string;
  projectSlug: string;
  settings: Record<string, unknown>;
  params: Record<string, BindingParamValue>;
  /** This field is one character of a code shared by every field of the group. */
  segment?: BindingSegment;
};

export type ResolveServiceValueOptions = {
  /** Later boxes of one segmented code reuse the value the first box fetched. */
  segmentPosition?: number;
  env?: NodeJS.ProcessEnv;
  /**
   * The engine's own value for another field of the run (e.g. the cédula). Discovery replay
   * keeps scenario values in its data resolver, not in PROMOTED_* env, so it passes it here;
   * env is the fallback (the promoted spec's only source).
   */
  readValue?: (valueKey: string) => string | undefined;
};

/** Only tokens generated after this run started count as fresh (latest mode). */
const RUN_STARTED_AT = new Date().toISOString();

const cache = new Map<string, Promise<string>>();

export function materializeServiceBindingsEnv(bindings: RuntimeServiceBinding[] | undefined): NodeJS.ProcessEnv {
  if (!bindings?.length) return {};
  return { [SERVICE_BINDINGS_ENV]: JSON.stringify(bindings) };
}

export function readRuntimeServiceBindings(env: NodeJS.ProcessEnv = process.env): RuntimeServiceBinding[] {
  const raw = env[SERVICE_BINDINGS_ENV];
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is RuntimeServiceBinding =>
        Boolean(entry) && typeof entry.valueKey === "string" && typeof entry.serviceKey === "string")
      : [];
  } catch {
    return [];
  }
}

function findBinding(valueKey: string | undefined, env: NodeJS.ProcessEnv): RuntimeServiceBinding | undefined {
  const key = valueKey?.trim().toLowerCase();
  if (!key) return undefined;
  return readRuntimeServiceBindings(env).find((binding) => binding.valueKey.trim().toLowerCase() === key);
}

export function isServiceBoundValueKey(valueKey: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(findBinding(valueKey, env));
}

/** Same PROMOTED_<KEY> convention as the spec compiler and materializePromotedRuntimeEnv. */
function envNameForValueKey(valueKey: string): string {
  return `PROMOTED_${valueKey.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
}

/** The current value of another field of the run (e.g. the cédula an OTP is generated for). */
function runValue(env: NodeJS.ProcessEnv, readValue?: (valueKey: string) => string | undefined): Record<string, string | undefined> {
  return new Proxy({}, {
    get: (_target, property) => {
      if (typeof property !== "string") return undefined;
      const fromEngine = readValue?.(property);
      if (fromEngine?.trim()) return fromEngine;
      const direct = env[envNameForValueKey(property)];
      if (direct?.trim()) return direct;
      try {
        const overrides = JSON.parse(env.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON ?? "{}") as Record<string, unknown>;
        const found = Object.entries(overrides).find(([key]) => key.trim().toLowerCase() === property.trim().toLowerCase());
        return typeof found?.[1] === "string" ? found[1] : undefined;
      } catch {
        return undefined;
      }
    },
  });
}

/**
 * The value a bound field must receive at this step, or undefined when the field is not
 * bound to any service (the caller keeps its dataset value). Throws when the service fails:
 * typing the placeholder would only fail later with a misleading error.
 */
export async function resolveServiceBoundValue(
  valueKey: string | undefined,
  options: ResolveServiceValueOptions = {},
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  const binding = findBinding(valueKey, env);
  if (!binding) return undefined;
  // A segment field (digit N of a code recorded as separate fields) shares its group's value
  // and takes only its own character; the group's first field fetches a fresh value.
  if (binding.segment) {
    const full = await resolveCached(binding, `segment:${binding.segment.group.trim().toLowerCase()}`, binding.segment.position > 1, env, options.readValue);
    const character = Array.from(full)[binding.segment.position - 1];
    if (character === undefined) {
      throw new Error(`service_value_unresolved: valueKey=${binding.valueKey} service=${binding.serviceKey} reason=segment_out_of_range: the value has ${Array.from(full).length} characters`);
    }
    return character;
  }
  return resolveCached(binding, binding.valueKey.trim().toLowerCase(), (options.segmentPosition ?? 0) > 1, env, options.readValue);
}

function resolveCached(
  binding: RuntimeServiceBinding,
  cacheKey: string,
  reuse: boolean,
  env: NodeJS.ProcessEnv,
  readValue?: (valueKey: string) => string | undefined,
): Promise<string> {
  const cached = reuse ? cache.get(cacheKey) : undefined;
  if (cached) return cached;

  const pending = (async () => {
    const started = Date.now();
    try {
      const params = resolveBindingParams(binding.params, runValue(env, readValue));
      const result = await getServiceProvider(binding.serviceKey).resolve(
        { projectSlug: binding.projectSlug, settings: binding.settings, generatedAfter: RUN_STARTED_AT },
        params,
      );
      const facts = Object.entries(result.meta).map(([key, value]) => `${key}=${value}`).join(" ");
      console.log(`[service-catalog] valueKey=${binding.valueKey} service=${binding.serviceKey} resolved=true length=${result.value.length} ${facts} totalMs=${Date.now() - started}`);
      return result.value;
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "service_failed";
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[service-catalog] valueKey=${binding.valueKey} service=${binding.serviceKey} resolved=false reason=${code}`);
      throw new Error(`service_value_unresolved: valueKey=${binding.valueKey} service=${binding.serviceKey} reason=${code}: ${message}`);
    }
  })();
  cache.set(cacheKey, pending);
  pending.catch(() => cache.delete(cacheKey));
  return pending;
}

export function resetServiceValueCacheForTests(): void {
  cache.clear();
}
