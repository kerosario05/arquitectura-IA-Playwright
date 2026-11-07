import {
  OracleOtpServiceError,
  generateLocalToken,
  getLatestLocalToken,
  resolveOracleOtpRuntimeConfig,
  resolveOracleOtpRuntimeEnvironment,
  type GenerateLocalTokenInput,
  type GenerateLocalTokenOutput,
  type GetLatestLocalTokenInput,
  type GetLatestLocalTokenOutput,
} from "../../server/services/oracle-otp-service";
import {
  ServiceCatalogError,
  type ServiceAvailability,
  type ServiceProvider,
  type ServiceResolveContext,
  type ServiceResolveResult,
} from "../service-provider";

/**
 * OTP from the Oracle "token local" (PA.PKG_GENERA_TOKEN / PA.PA_GENERACION_TOKEN_LOCAL).
 *
 * Wraps oracle-otp-service in-process, so every guard it applies (enabled flag,
 * local/qa only, identity and channel checks, rate limit) still holds. The
 * project's settings come from the catalog instead of app.config.json, which is
 * why the app-config loader is replaced by one built from those settings.
 */

export const OTP_ORACLE_LOCAL_TOKEN_KEY = "otp.oracle-local-token";

const ALLOWED_ENVIRONMENTS = ["local", "qa"] as const;

type OtpModes = "generate" | "latest";

type ServiceDeps = { appConfigLoader: (appSlug: string) => Promise<Record<string, unknown> | null> };

export type OracleOtpProviderDeps = {
  env?: NodeJS.ProcessEnv;
  generate?: (input: GenerateLocalTokenInput, deps: ServiceDeps) => Promise<GenerateLocalTokenOutput>;
  latest?: (input: GetLatestLocalTokenInput, deps: ServiceDeps) => Promise<GetLatestLocalTokenOutput>;
  sleep?: (ms: number) => Promise<void>;
  /** `latest` mode: how many reads before giving up while the app inserts the token. */
  latestAttempts?: number;
  latestIntervalMs?: number;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function channelList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return Array.from(new Set(raw.map((entry) => text(entry).toUpperCase()).filter(Boolean)));
}

function mapOracleError(err: unknown): ServiceCatalogError {
  if (!(err instanceof OracleOtpServiceError)) {
    return new ServiceCatalogError("service_failed", 502, "El servicio OTP falló de forma inesperada.");
  }
  const messages: Record<string, string> = {
    otp_endpoint_not_allowed: "El servicio OTP no está habilitado para este proyecto o ambiente.",
    oracle_unavailable: "No se pudo conectar a la base Oracle del OTP.",
    oracle_procedure_failed: "Oracle rechazó la generación del token.",
    otp_not_found: "Oracle no tiene un token reciente para esa identidad y canal.",
    otp_invalid_format: "Oracle devolvió un token con formato inválido.",
    rate_limited: "Demasiadas solicitudes de OTP seguidas; espera unos segundos.",
    invalid_request: err.message,
  };
  return new ServiceCatalogError(`otp_${err.reasonCode.replace(/^otp_/, "")}`, err.httpStatus, messages[err.reasonCode] ?? err.message);
}

export function createOracleOtpProvider(deps: OracleOtpProviderDeps = {}): ServiceProvider {
  const generate = deps.generate ?? ((input, serviceDeps) => generateLocalToken(input, { ...serviceDeps, env: deps.env }));
  const latest = deps.latest ?? ((input, serviceDeps) => getLatestLocalToken(input, { ...serviceDeps, env: deps.env }));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const latestAttempts = Math.max(1, deps.latestAttempts ?? 5);
  const latestIntervalMs = deps.latestIntervalMs ?? 1000;

  function availability(env: NodeJS.ProcessEnv = deps.env ?? process.env): ServiceAvailability {
    const runtime = resolveOracleOtpRuntimeConfig(env);
    const environment = resolveOracleOtpRuntimeEnvironment(env);
    const reasons: string[] = [];
    if (!runtime.enabled) reasons.push("ORACLE_OTP_ENABLED no está en true en el servidor.");
    if (!runtime.connectString || !runtime.user || !runtime.password) {
      reasons.push("Falta la conexión a Oracle (ORACLE_OTP_CONNECT_STRING, ORACLE_OTP_USER, ORACLE_OTP_PASSWORD).");
    }
    if (!(ALLOWED_ENVIRONMENTS as readonly string[]).includes(environment) || !runtime.allowedEnvironments.includes(environment)) {
      reasons.push(`El ambiente del servidor es "${environment}"; el OTP solo corre en local o qa (APP_TEST_DATA_PROFILE=qa o NODE_ENV=development).`);
    }
    return { available: reasons.length === 0, reasons, environment };
  }

  function normalizeSettings(input: unknown): Record<string, unknown> {
    const raw = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
    const defaultChannel = text(raw.defaultChannel).toUpperCase();
    const allowedChannels = channelList(raw.allowedChannels);
    if (defaultChannel && allowedChannels.length > 0 && !allowedChannels.includes(defaultChannel)) {
      throw new ServiceCatalogError("invalid_settings", 400, "El canal por defecto debe estar entre los canales permitidos.");
    }
    const environments = channelList(raw.enabledEnvironments).map((entry) => entry.toLowerCase());
    const invalid = environments.filter((entry) => !(ALLOWED_ENVIRONMENTS as readonly string[]).includes(entry));
    if (invalid.length > 0) {
      throw new ServiceCatalogError("invalid_settings", 400, `Ambientes no permitidos para OTP: ${invalid.join(", ")}. Usa local o qa.`);
    }
    return {
      defaultChannel: defaultChannel || null,
      allowedChannels,
      enabledEnvironments: environments.length > 0 ? environments : [...ALLOWED_ENVIRONMENTS],
    };
  }

  async function resolve(context: ServiceResolveContext, params: Record<string, unknown>): Promise<ServiceResolveResult> {
    const settings = normalizeSettings(context.settings);
    // The identity goes to Oracle exactly as the scenario typed it: PKG_GENERA_TOKEN stores it
    // verbatim in ID_CLIENTE and the app validates with its own format (402-2999373-4), so a
    // reformatted cédula yields a token the app never finds (jobs 7bbab74a, 5f7fea59).
    const identity = text(params.identity);
    if (!identity) throw new ServiceCatalogError("missing_param", 400, "Falta la identidad (cédula) para pedir el OTP.");
    const channel = text(params.channel).toUpperCase() || text(settings.defaultChannel);
    const mode: OtpModes = params.mode === "latest" ? "latest" : "generate";
    const serviceDeps: ServiceDeps = {
      appConfigLoader: async () => ({ otpProfile: { strategy: "oracle_local_token", ...settings } }),
    };
    const base = { identity, channel, appSlug: context.projectSlug };
    const started = Date.now();

    try {
      let generatedAfter = context.generatedAfter;
      let requestId: string | undefined;
      if (mode === "generate") {
        const generated = await generate(base, serviceDeps);
        if (generated.otp) {
          return { value: generated.otp, meta: { channel: generated.channel, source: "generate", durationMs: Date.now() - started } };
        }
        // The procedure did not hand the token back: read it from the token table.
        generatedAfter = generatedAfter ?? generated.generatedAt;
        requestId = generated.requestId;
      }
      if (!generatedAfter) {
        throw new ServiceCatalogError("missing_param", 400, "Para leer el último OTP hace falta la hora desde la que cuenta (generatedAfter).");
      }
      for (let attempt = 1; ; attempt += 1) {
        try {
          const found = await latest({ ...base, generatedAfter, requestId }, serviceDeps);
          return { value: found.otp, meta: { channel: found.channel, source: "latest", attempts: attempt, durationMs: Date.now() - started } };
        } catch (err) {
          const retriable = err instanceof OracleOtpServiceError && err.reasonCode === "otp_not_found";
          if (!retriable || attempt >= latestAttempts) throw err;
          await sleep(latestIntervalMs);
        }
      }
    } catch (err) {
      if (err instanceof ServiceCatalogError) throw err;
      throw mapOracleError(err);
    }
  }

  return {
    descriptor: {
      key: OTP_ORACLE_LOCAL_TOKEN_KEY,
      name: "OTP · Token local",
      category: "otp",
      description: "Genera o lee el código OTP de 6 dígitos de un cliente en la base Oracle de QA y lo escribe en el campo del escenario.",
      source: "Oracle · PA.PKG_GENERA_TOKEN / PA.PA_GENERACION_TOKEN_LOCAL",
      output: { kind: "code", length: 6, segmented: true },
      settings: [
        { key: "defaultChannel", label: "Canal por defecto", kind: "text", required: false, description: "Valor de CANAL en Oracle, por ejemplo APP." },
        { key: "allowedChannels", label: "Canales permitidos", kind: "list", required: false },
        { key: "enabledEnvironments", label: "Ambientes", kind: "environments", required: false, description: "Solo local o qa." },
      ],
      params: [
        { key: "identity", label: "Identidad (cédula)", kind: "field_ref", required: true, description: "Campo del escenario con la cédula del cliente." },
        { key: "channel", label: "Canal", kind: "text", required: false, description: "Vacío = canal por defecto del proyecto." },
        { key: "mode", label: "Modo", kind: "select", required: false, options: ["generate", "latest"], description: "generate: el servicio genera el token. latest: lee el token que la app acaba de generar." },
      ],
    },
    availability,
    normalizeSettings,
    resolve,
  };
}
