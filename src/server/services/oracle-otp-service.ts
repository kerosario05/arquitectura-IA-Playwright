import crypto from "node:crypto";
import { loadAppConfig } from "../../automations/app-auto-resolver";

export const ORACLE_GENERATE_LOCAL_TOKEN_PLSQL = `BEGIN
    PA.PKG_GENERA_TOKEN.GENERA_LOCAL_TOKEN_CED(
        pCodCliente => NULL,
        pCedula     => :identity,
        pCanal      => :channel,
        pTokenGen   => :tokenGenerated,
        pCodError   => :errorCode,
        pDesError   => :errorDescription
    );
END;`;

export const ORACLE_LATEST_LOCAL_TOKEN_SQL = `SELECT OTP
FROM (
    SELECT LPAD(TO_CHAR(TOKEN), 6, '0') AS OTP
    FROM PA.PA_GENERACION_TOKEN_LOCAL
    WHERE TO_CHAR(ID_CLIENTE) = :identity
      AND CANAL = :channel
      AND FECHA_ADICION >= :generatedAfter
    ORDER BY FECHA_ADICION DESC
)
WHERE ROWNUM = 1`;

type OracleOtpRuntimeEnv = "local" | "qa" | "production" | "other";

export type OracleOtpProfile = {
  strategy?: string;
  enabledEnvironments?: string[];
  defaultChannel?: string;
  allowedChannels?: string[];
};

export type OracleOtpRuntimeConfig = {
  enabled: boolean;
  connectString?: string;
  user?: string;
  password?: string;
  requestKey?: string;
  defaultChannel?: string;
  allowedChannels: string[];
  identityMinLength: number;
  identityMaxLength: number;
  channelMaxLength: number;
  appSlugMaxLength: number;
  requestIdMaxLength: number;
  maxFutureMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  allowedEnvironments: OracleOtpRuntimeEnv[];
};

export type GenerateLocalTokenInput = {
  identity: string;
  channel: string;
  appSlug: string;
};

export type GetLatestLocalTokenInput = {
  identity: string;
  channel: string;
  appSlug: string;
  generatedAfter: string;
  requestId?: string;
};

export type GenerateLocalTokenOutput = {
  ok: true;
  generated: true;
  requestId: string;
  generatedAt: string;
  channel: string;
  /**
   * Token returned straight from the procedure's pTokenGen OUT bind, when it is usable.
   * Callers that get it can skip the `latest` round-trip entirely. Optional on purpose:
   * an absent or unparseable pTokenGen leaves this undefined and the caller falls back.
   */
  otp?: string;
};

export type GetLatestLocalTokenOutput = {
  ok: true;
  otp: string;
  channel: string;
  source: "oracle_token_table";
};

export type OtpRequestScope = {
  appSlug: string;
  identity: string;
  channel: string;
};

type OtpRateLimitState = {
  timestamps: number[];
};

const otpRateLimitStore = new Map<string, OtpRateLimitState>();

const SUCCESS_ORACLE_CODES = new Set(["", "0", "00", "000", "OK", "SUCCESS", "SUCCEEDED", "S"]);
const ALLOWED_RUNTIME_TAGS = new Set<OracleOtpRuntimeEnv>(["local", "qa"]);

function parseBooleanTrue(rawValue: string | undefined): boolean {
  return rawValue?.trim().toLowerCase() === "true";
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseAllowedRuntimeEnvironments(rawValue: string | undefined): OracleOtpRuntimeEnv[] {
  if (!rawValue?.trim()) return ["local", "qa"];
  const values = rawValue
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const resolved = new Set<OracleOtpRuntimeEnv>();
  for (const value of values) {
    if (value === "local" || value === "qa" || value === "production" || value === "other") {
      resolved.add(value);
    }
  }
  return resolved.size > 0 ? Array.from(resolved) : ["local", "qa"];
}

function parseChannelList(rawValue: string | undefined): string[] {
  if (!rawValue?.trim()) return [];
  return Array.from(new Set(
    rawValue
      .split(",")
      .map((entry) => normalizeChannel(entry))
      .filter(Boolean),
  ));
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeChannel(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeAppSlug(value: string): string {
  return value.trim().toLowerCase();
}

function isSafeAppSlug(value: string): boolean {
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(value);
}

function parseOptionalStringValue(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  return normalized ? normalized : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function extractOtpProfile(rawConfig: Record<string, unknown> | null): OracleOtpProfile | null {
  if (!rawConfig) return null;
  const directProfile = rawConfig.otpProfile;
  const appProfileContainer = rawConfig.appProfile;
  const nestedProfile = appProfileContainer && typeof appProfileContainer === "object" && !Array.isArray(appProfileContainer)
    ? (appProfileContainer as Record<string, unknown>).otpProfile
    : undefined;
  const profileRaw = directProfile ?? nestedProfile;
  if (!profileRaw || typeof profileRaw !== "object" || Array.isArray(profileRaw)) {
    return null;
  }
  const profile = profileRaw as Record<string, unknown>;
  return {
    strategy: parseOptionalStringValue(profile.strategy),
    defaultChannel: parseOptionalStringValue(profile.defaultChannel),
    enabledEnvironments: parseStringArray(profile.enabledEnvironments),
    allowedChannels: parseStringArray(profile.allowedChannels).map(normalizeChannel),
  };
}

export function resolveOracleOtpRuntimeConfig(env: NodeJS.ProcessEnv = process.env): OracleOtpRuntimeConfig {
  const minLength = parsePositiveInt(env.ORACLE_OTP_IDENTITY_MIN_LENGTH, 1);
  const maxLengthCandidate = parsePositiveInt(env.ORACLE_OTP_IDENTITY_MAX_LENGTH, 64);
  const maxLength = Math.max(minLength, maxLengthCandidate);
  return {
    enabled: parseBooleanTrue(env.ORACLE_OTP_ENABLED),
    connectString: parseOptionalStringValue(env.ORACLE_OTP_CONNECT_STRING),
    user: parseOptionalStringValue(env.ORACLE_OTP_USER),
    password: parseOptionalStringValue(env.ORACLE_OTP_PASSWORD),
    requestKey: parseOptionalStringValue(env.ORACLE_OTP_REQUEST_KEY),
    defaultChannel: parseOptionalStringValue(env.ORACLE_OTP_DEFAULT_CHANNEL)?.toUpperCase(),
    allowedChannels: parseChannelList(env.ORACLE_OTP_ALLOWED_CHANNELS),
    identityMinLength: minLength,
    identityMaxLength: maxLength,
    channelMaxLength: parsePositiveInt(env.ORACLE_OTP_CHANNEL_MAX_LENGTH, 64),
    appSlugMaxLength: parsePositiveInt(env.ORACLE_OTP_APP_SLUG_MAX_LENGTH, 64),
    requestIdMaxLength: parsePositiveInt(env.ORACLE_OTP_REQUEST_ID_MAX_LENGTH, 128),
    maxFutureMs: parsePositiveInt(env.ORACLE_OTP_GENERATED_AFTER_MAX_FUTURE_MS, 120_000),
    rateLimitWindowMs: parsePositiveInt(env.ORACLE_OTP_RATE_LIMIT_WINDOW_MS, 30_000),
    rateLimitMaxRequests: parsePositiveInt(env.ORACLE_OTP_RATE_LIMIT_MAX_REQUESTS, 8),
    allowedEnvironments: parseAllowedRuntimeEnvironments(env.ORACLE_OTP_ALLOWED_ENVIRONMENTS),
  };
}

export function resolveOracleOtpRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): OracleOtpRuntimeEnv {
  const nodeEnv = normalizeString(env.NODE_ENV).toLowerCase();
  const profile = normalizeString(env.APP_TEST_DATA_PROFILE).toLowerCase();
  if (nodeEnv === "production" || profile === "production_like") return "production";
  if (profile === "qa") return "qa";
  if (nodeEnv === "development" || nodeEnv === "test") return "local";
  return "other";
}

export function maskIdentity(identity: string): string {
  if (identity.length <= 4) return "*".repeat(identity.length);
  return `${"*".repeat(identity.length - 4)}${identity.slice(-4)}`;
}

function sanitizeOracleCode(rawCode: unknown): string | undefined {
  if (typeof rawCode === "number" && Number.isFinite(rawCode)) {
    return `ORA-${Math.trunc(rawCode)}`;
  }
  if (typeof rawCode !== "string") return undefined;
  const normalized = rawCode.trim().toUpperCase();
  if (!normalized) return undefined;
  const tokenMatch = normalized.match(/(ORA-\d+|NJS-\d+|DPI-\d+)/);
  if (tokenMatch?.[1]) return tokenMatch[1];
  if (/^[A-Z0-9_-]{1,48}$/.test(normalized)) return normalized;
  return undefined;
}

function redactSecret(rawValue: string, secret: string | undefined): string {
  if (!secret) return rawValue;
  return rawValue.split(secret).join("[redacted]");
}

export function sanitizeOracleMessage(input: {
  rawMessage: unknown;
  runtime: OracleOtpRuntimeConfig;
  maskedIdentity?: string;
}): string {
  const baseMessage = typeof input.rawMessage === "string"
    ? input.rawMessage
    : input.rawMessage instanceof Error
      ? input.rawMessage.message
      : String(input.rawMessage ?? "");
  let sanitized = baseMessage.replace(/\s+/g, " ").trim();
  sanitized = redactSecret(sanitized, input.runtime.connectString);
  sanitized = redactSecret(sanitized, input.runtime.user);
  sanitized = redactSecret(sanitized, input.runtime.password);
  if (input.maskedIdentity) {
    sanitized = sanitized.replace(/\d{6,}/g, (match) => (match.endsWith(input.maskedIdentity.slice(-4)) ? input.maskedIdentity : "[redacted]"));
  }
  if (!sanitized) return "Oracle operation failed.";
  return sanitized.slice(0, 240);
}

function isOracleUnavailableCode(code: string | undefined): boolean {
  if (!code) return false;
  return /^(ORA-12(141|154|514|041)|ORA-01017|NJS-|DPI-)/.test(code);
}

function readErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const record = err as Record<string, unknown>;
  return sanitizeOracleCode(record.code ?? record.errorNum);
}

export function evaluateOracleProcedureOutcome(errorCode: string | undefined, errorDescription: string | undefined): {
  ok: boolean;
  oracleCode?: string;
  message?: string;
} {
  const normalizedCode = (errorCode ?? "").trim().toUpperCase();
  const normalizedDescription = (errorDescription ?? "").trim();
  if (SUCCESS_ORACLE_CODES.has(normalizedCode)) {
    if (!normalizedDescription) return { ok: true };
    if (/^(OK|SUCCESS|EXITO)/i.test(normalizedDescription)) return { ok: true };
    if (normalizedCode === "") return { ok: false, oracleCode: "ORACLE_PROCEDURE_UNSPECIFIED", message: normalizedDescription };
    return { ok: true };
  }
  const numeric = Number(normalizedCode);
  if (Number.isFinite(numeric)) {
    if (numeric === 0) return { ok: true };
    return { ok: false, oracleCode: normalizedCode || `ORA-${numeric}`, message: normalizedDescription || "Oracle procedure returned a non-zero code." };
  }
  if (!normalizedCode && normalizedDescription) {
    return { ok: false, oracleCode: "ORACLE_PROCEDURE_UNSPECIFIED", message: normalizedDescription };
  }
  return {
    ok: false,
    oracleCode: normalizedCode || "ORACLE_PROCEDURE_ERROR",
    message: normalizedDescription || "Oracle procedure reported an error.",
  };
}

export type OracleExecuteResult = {
  outBinds?: Record<string, unknown> | unknown[];
  rows?: unknown[];
};

export type OracleConnectionLike = {
  execute(
    statement: string,
    binds: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<OracleExecuteResult>;
  close(): Promise<void>;
};

export type OraclePoolLike = {
  getConnection(): Promise<OracleConnectionLike>;
};

export type OracleDriverLike = {
  BIND_IN: number | string;
  BIND_OUT: number | string;
  STRING: number | string;
  OUT_FORMAT_OBJECT?: number;
  createPool(config: Record<string, unknown>): Promise<OraclePoolLike>;
};

export type OracleOtpAdapter = {
  executeGenerateLocalToken(input: {
    identity: string;
    channel: string;
    runtime: OracleOtpRuntimeConfig;
  }): Promise<{ tokenGenerated?: string; errorCode?: string; errorDescription?: string }>;
  executeLatestLocalTokenQuery(input: {
    identity: string;
    channel: string;
    generatedAfter: Date;
    runtime: OracleOtpRuntimeConfig;
  }): Promise<{ otp?: string }>;
};

export function buildGenerateProcedureBinds(input: {
  identity: string;
  channel: string;
  driver: Pick<OracleDriverLike, "BIND_IN" | "BIND_OUT" | "STRING">;
}): Record<string, unknown> {
  return {
    identity: {
      dir: input.driver.BIND_IN,
      type: input.driver.STRING,
      val: input.identity,
      maxSize: Math.max(16, input.identity.length),
    },
    channel: {
      dir: input.driver.BIND_IN,
      type: input.driver.STRING,
      val: input.channel,
      maxSize: Math.max(16, input.channel.length),
    },
    tokenGenerated: {
      dir: input.driver.BIND_OUT,
      type: input.driver.STRING,
      maxSize: 256,
    },
    errorCode: {
      dir: input.driver.BIND_OUT,
      type: input.driver.STRING,
      maxSize: 128,
    },
    errorDescription: {
      dir: input.driver.BIND_OUT,
      type: input.driver.STRING,
      maxSize: 1024,
    },
  };
}

export function buildLatestTokenQueryBinds(input: {
  identity: string;
  channel: string;
  generatedAfter: Date;
}): Record<string, unknown> {
  return {
    identity: input.identity,
    channel: input.channel,
    generatedAfter: input.generatedAfter,
  };
}

type OracleAdapterFactoryOptions = {
  env?: NodeJS.ProcessEnv;
  driverResolver?: () => Promise<OracleDriverLike>;
};

export function createOracleOtpAdapter(options: OracleAdapterFactoryOptions = {}): OracleOtpAdapter {
  const env = options.env ?? process.env;

  let thickInitDone = false;
  const driverResolver = options.driverResolver ?? (async () => {
    const loaded = require("oracledb") as OracleDriverLike; // eslint-disable-line @typescript-eslint/no-var-requires
    if (!thickInitDone) {
      const clientLibDir = (env.ORACLE_CLIENT_LIB_DIR ?? "").trim();
      if (clientLibDir && typeof (loaded as Record<string, unknown>).initOracleClient === "function") {
        try {
          (loaded as unknown as { initOracleClient(opts: { libDir: string }): void }).initOracleClient({ libDir: clientLibDir });
          console.info(`[oracle-otp] Thick mode enabled via ${clientLibDir}`);
        } catch {
          // Already initialized or not available — continue in thin mode
        }
      }
      thickInitDone = true;
    }
    return loaded;
  });

  let poolPromise: Promise<OraclePoolLike> | null = null;
  const resolvePool = async (runtime: OracleOtpRuntimeConfig): Promise<OraclePoolLike> => {
    if (poolPromise) return poolPromise;
    if (!runtime.connectString || !runtime.user || !runtime.password) {
      throw new OracleOtpServiceError("oracle_unavailable", 503, {
        message: "Oracle OTP configuration is incomplete.",
      });
    }
    poolPromise = (async () => {
      const driver = await driverResolver();
      return driver.createPool({
        user: runtime.user,
        password: runtime.password,
        connectString: runtime.connectString,
      });
    })();
    // Reset on failure so the next request can retry with a fresh pool
    poolPromise.catch(() => { poolPromise = null; });
    return poolPromise;
  };

  const runWithConnection = async <T>(runtime: OracleOtpRuntimeConfig, run: (conn: OracleConnectionLike, driver: OracleDriverLike) => Promise<T>): Promise<T> => {
    const driver = await driverResolver();
    const pool = await resolvePool(runtime);
    const connection = await pool.getConnection();
    try {
      return await run(connection, driver);
    } finally {
      await connection.close();
    }
  };

  return {
    async executeGenerateLocalToken(input) {
      return runWithConnection(input.runtime, async (connection, driver) => {
        const binds = buildGenerateProcedureBinds({
          identity: input.identity,
          channel: input.channel,
          driver,
        });
        const result = await connection.execute(
          ORACLE_GENERATE_LOCAL_TOKEN_PLSQL,
          binds,
        );
        const outBinds = Array.isArray(result.outBinds)
          ? {}
          : (result.outBinds ?? {});
        const asRecord = outBinds as Record<string, unknown>;
        return {
          tokenGenerated: parseOptionalStringValue(asRecord.tokenGenerated),
          errorCode: parseOptionalStringValue(asRecord.errorCode),
          errorDescription: parseOptionalStringValue(asRecord.errorDescription),
        };
      });
    },
    async executeLatestLocalTokenQuery(input) {
      return runWithConnection(input.runtime, async (connection, driver) => {
        const result = await connection.execute(
          ORACLE_LATEST_LOCAL_TOKEN_SQL,
          buildLatestTokenQueryBinds({
            identity: input.identity,
            channel: input.channel,
            generatedAfter: input.generatedAfter,
          }),
          driver.OUT_FORMAT_OBJECT
            ? { outFormat: driver.OUT_FORMAT_OBJECT }
            : undefined,
        );
        const firstRow = Array.isArray(result.rows) ? result.rows[0] : undefined;
        if (!firstRow) return {};
        if (typeof firstRow === "object" && firstRow !== null && !Array.isArray(firstRow)) {
          const rowRecord = firstRow as Record<string, unknown>;
          return { otp: parseOptionalStringValue(rowRecord.OTP ?? rowRecord.otp) };
        }
        if (Array.isArray(firstRow)) {
          return { otp: parseOptionalStringValue(firstRow[0]) };
        }
        return {};
      });
    },
  };
}

let sharedOracleOtpAdapter: OracleOtpAdapter | null = null;

export function getSharedOracleOtpAdapter(env: NodeJS.ProcessEnv = process.env): OracleOtpAdapter {
  if (!sharedOracleOtpAdapter) {
    sharedOracleOtpAdapter = createOracleOtpAdapter({ env });
  }
  return sharedOracleOtpAdapter;
}

export class OracleOtpServiceError extends Error {
  constructor(
    public readonly reasonCode:
      | "invalid_request"
      | "otp_endpoint_not_allowed"
      | "oracle_procedure_failed"
      | "oracle_unavailable"
      | "otp_not_found"
      | "otp_invalid_format"
      | "invalid_internal_auth"
      | "rate_limited",
    public readonly httpStatus: number,
    public readonly details?: {
      oracleCode?: string;
      message?: string;
      retryAfterSeconds?: number;
    },
  ) {
    super(details?.message ?? reasonCode);
    this.name = "OracleOtpServiceError";
  }
}

type ServiceDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  requestIdFactory?: () => string;
  adapter?: OracleOtpAdapter;
  appConfigLoader?: (appSlug: string) => Promise<Record<string, unknown> | null>;
};

function validateScopeAndRateLimit(input: {
  scope: OtpRequestScope;
  runtime: OracleOtpRuntimeConfig;
}): void {
  const identity = normalizeString(input.scope.identity);
  const appSlug = normalizeString(input.scope.appSlug);
  const channel = normalizeChannel(input.scope.channel);
  const key = `${normalizeAppSlug(appSlug)}|${identity}|${channel}`;
  const now = Date.now();
  const state = otpRateLimitStore.get(key) ?? { timestamps: [] };
  state.timestamps = state.timestamps.filter((timestamp) => now - timestamp <= input.runtime.rateLimitWindowMs);
  if (state.timestamps.length >= input.runtime.rateLimitMaxRequests) {
    const oldestInWindow = state.timestamps[0];
    const retryAfterMs = Math.max(0, input.runtime.rateLimitWindowMs - (now - oldestInWindow));
    throw new OracleOtpServiceError("rate_limited", 429, {
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      message: "OTP internal endpoint rate limit exceeded.",
    });
  }
  state.timestamps.push(now);
  otpRateLimitStore.set(key, state);
}

function ensureOtpRuntimeEnabled(runtime: OracleOtpRuntimeConfig): void {
  if (!runtime.enabled) {
    throw new OracleOtpServiceError("otp_endpoint_not_allowed", 403, {
      message: "OTP endpoint is disabled.",
    });
  }
}

function ensureAppSlug(rawAppSlug: unknown, runtime: OracleOtpRuntimeConfig): string {
  const appSlug = normalizeAppSlug(normalizeString(rawAppSlug));
  if (!appSlug || appSlug.length > runtime.appSlugMaxLength || !isSafeAppSlug(appSlug)) {
    throw new OracleOtpServiceError("invalid_request", 400, {
      message: "Invalid appSlug.",
    });
  }
  return appSlug;
}

function resolveAllowedChannels(input: {
  runtime: OracleOtpRuntimeConfig;
  profile: OracleOtpProfile;
}): string[] {
  if (input.profile.allowedChannels && input.profile.allowedChannels.length > 0) {
    return Array.from(new Set(input.profile.allowedChannels.map(normalizeChannel)));
  }
  if (input.runtime.allowedChannels.length > 0) {
    return input.runtime.allowedChannels;
  }
  if (input.profile.defaultChannel) return [normalizeChannel(input.profile.defaultChannel)];
  if (input.runtime.defaultChannel) return [normalizeChannel(input.runtime.defaultChannel)];
  return [];
}

function ensureEnvironmentAndProfileAllowed(input: {
  runtime: OracleOtpRuntimeConfig;
  profile: OracleOtpProfile | null;
  runtimeEnvironment: OracleOtpRuntimeEnv;
}): OracleOtpProfile {
  const profile = input.profile;
  if (!profile || normalizeString(profile.strategy).toLowerCase() !== "oracle_local_token") {
    throw new OracleOtpServiceError("otp_endpoint_not_allowed", 403, {
      message: "OTP profile not enabled for appSlug.",
    });
  }
  if (!ALLOWED_RUNTIME_TAGS.has(input.runtimeEnvironment) || input.runtimeEnvironment === "production") {
    throw new OracleOtpServiceError("otp_endpoint_not_allowed", 403, {
      message: "OTP endpoint is only allowed in local/qa environments.",
    });
  }
  if (!input.runtime.allowedEnvironments.includes(input.runtimeEnvironment)) {
    throw new OracleOtpServiceError("otp_endpoint_not_allowed", 403, {
      message: "Runtime environment is not authorized for OTP endpoint.",
    });
  }
  const profileEnvironments = (profile.enabledEnvironments ?? [])
    .map((entry) => normalizeString(entry).toLowerCase())
    .filter((entry): entry is OracleOtpRuntimeEnv => (
      entry === "local" || entry === "qa" || entry === "production" || entry === "other"
    ));
  if (profileEnvironments.length > 0 && !profileEnvironments.includes(input.runtimeEnvironment)) {
    throw new OracleOtpServiceError("otp_endpoint_not_allowed", 403, {
      message: "App OTP profile does not allow current environment.",
    });
  }
  return profile;
}

function ensureIdentity(rawIdentity: unknown, runtime: OracleOtpRuntimeConfig): string {
  const identity = normalizeString(rawIdentity);
  if (!identity) {
    throw new OracleOtpServiceError("invalid_request", 400, { message: "identity is required." });
  }
  if (!/^\d+$/.test(identity)) {
    throw new OracleOtpServiceError("invalid_request", 400, { message: "identity must contain only digits." });
  }
  if (identity.length < runtime.identityMinLength || identity.length > runtime.identityMaxLength) {
    throw new OracleOtpServiceError("invalid_request", 400, {
      message: "identity length is out of configured range.",
    });
  }
  return identity;
}

function ensureChannel(rawChannel: unknown, input: {
  runtime: OracleOtpRuntimeConfig;
  profile: OracleOtpProfile;
}): string {
  const channel = normalizeChannel(normalizeString(rawChannel));
  if (!channel) {
    throw new OracleOtpServiceError("invalid_request", 400, { message: "channel is required." });
  }
  if (channel.length > input.runtime.channelMaxLength) {
    throw new OracleOtpServiceError("invalid_request", 400, { message: "channel is too long." });
  }
  const allowedChannels = resolveAllowedChannels(input);
  if (!allowedChannels.includes(channel)) {
    throw new OracleOtpServiceError("otp_endpoint_not_allowed", 403, {
      message: "channel is not authorized for OTP endpoint.",
    });
  }
  return channel;
}

function ensureGeneratedAfter(rawGeneratedAfter: unknown, runtime: OracleOtpRuntimeConfig, now: Date): Date {
  const generatedAfter = normalizeString(rawGeneratedAfter);
  if (!generatedAfter) {
    throw new OracleOtpServiceError("invalid_request", 400, {
      message: "generatedAfter is required.",
    });
  }
  const parsedMs = Date.parse(generatedAfter);
  if (!Number.isFinite(parsedMs)) {
    throw new OracleOtpServiceError("invalid_request", 400, {
      message: "generatedAfter must be a valid ISO date.",
    });
  }
  const parsedDate = new Date(parsedMs);
  if (parsedDate.getTime() - now.getTime() > runtime.maxFutureMs) {
    throw new OracleOtpServiceError("invalid_request", 400, {
      message: "generatedAfter cannot be in the future.",
    });
  }
  return parsedDate;
}

function ensureRequestId(rawRequestId: unknown, runtime: OracleOtpRuntimeConfig): string | undefined {
  const requestId = parseOptionalStringValue(rawRequestId);
  if (!requestId) return undefined;
  if (requestId.length > runtime.requestIdMaxLength) {
    throw new OracleOtpServiceError("invalid_request", 400, { message: "requestId is too long." });
  }
  return requestId;
}

function normalizeOtp(rawOtp: string | undefined): string {
  if (!rawOtp) {
    throw new OracleOtpServiceError("otp_not_found", 404, { message: "No OTP found after generatedAfter boundary." });
  }
  const trimmed = rawOtp.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new OracleOtpServiceError("otp_invalid_format", 502, {
      message: "Oracle token format is invalid.",
    });
  }
  const normalized = trimmed.length < 6 ? trimmed.padStart(6, "0") : trimmed;
  if (!/^\d{6}$/.test(normalized)) {
    throw new OracleOtpServiceError("otp_invalid_format", 502, {
      message: "Oracle token must be exactly six digits.",
    });
  }
  return normalized;
}

function classifyOracleRuntimeError(input: {
  error: unknown;
  runtime: OracleOtpRuntimeConfig;
  fallback: "oracle_procedure_failed" | "oracle_unavailable";
  maskedIdentity?: string;
}): OracleOtpServiceError {
  if (input.error instanceof OracleOtpServiceError) {
    return input.error;
  }
  const oracleCode = readErrorCode(input.error);
  const safeMessage = sanitizeOracleMessage({
    rawMessage: input.error,
    runtime: input.runtime,
    maskedIdentity: input.maskedIdentity,
  });
  if (isOracleUnavailableCode(oracleCode) || input.fallback === "oracle_unavailable") {
    return new OracleOtpServiceError("oracle_unavailable", 503, {
      oracleCode,
      message: safeMessage,
    });
  }
  return new OracleOtpServiceError("oracle_procedure_failed", 502, {
    oracleCode,
    message: safeMessage,
  });
}

async function resolveProfileAndContext(input: {
  appSlug: string;
  runtime: OracleOtpRuntimeConfig;
  runtimeEnvironment: OracleOtpRuntimeEnv;
  appConfigLoader: (appSlug: string) => Promise<Record<string, unknown> | null>;
}): Promise<OracleOtpProfile> {
  const appConfig = await input.appConfigLoader(input.appSlug);
  const otpProfile = extractOtpProfile(appConfig);
  return ensureEnvironmentAndProfileAllowed({
    runtime: input.runtime,
    profile: otpProfile,
    runtimeEnvironment: input.runtimeEnvironment,
  });
}

export async function generateLocalToken(
  rawInput: GenerateLocalTokenInput,
  deps: ServiceDeps = {},
): Promise<GenerateLocalTokenOutput> {
  const env = deps.env ?? process.env;
  const runtime = resolveOracleOtpRuntimeConfig(env);
  ensureOtpRuntimeEnabled(runtime);
  const runtimeEnvironment = resolveOracleOtpRuntimeEnvironment(env);
  const appSlug = ensureAppSlug(rawInput.appSlug, runtime);
  const appConfigLoader = deps.appConfigLoader ?? loadAppConfig;
  const otpProfile = await resolveProfileAndContext({
    appSlug,
    runtime,
    runtimeEnvironment,
    appConfigLoader,
  });
  const identity = ensureIdentity(rawInput.identity, runtime);
  const channel = ensureChannel(rawInput.channel, { runtime, profile: otpProfile });
  validateScopeAndRateLimit({
    scope: { appSlug, identity, channel },
    runtime,
  });
  const now = deps.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const requestIdFactory = deps.requestIdFactory ?? crypto.randomUUID;
  const requestId = requestIdFactory();
  const adapter = deps.adapter ?? getSharedOracleOtpAdapter(env);
  try {
    const procedureResult = await adapter.executeGenerateLocalToken({
      identity,
      channel,
      runtime,
    });
    const outcome = evaluateOracleProcedureOutcome(
      procedureResult.errorCode,
      procedureResult.errorDescription,
    );
    if (!outcome.ok) {
      throw new OracleOtpServiceError("oracle_procedure_failed", 502, {
        oracleCode: sanitizeOracleCode(outcome.oracleCode),
        message: sanitizeOracleMessage({
          rawMessage: outcome.message,
          runtime,
          maskedIdentity: maskIdentity(identity),
        }),
      });
    }
    // The procedure hands the token back in pTokenGen, so the caller does not need the
    // `latest` query — whose `FECHA_ADICION >= generatedAfter` filter silently matches
    // nothing whenever the database clock lags the API host's. Best-effort by design:
    // a missing or malformed pTokenGen leaves `otp` absent instead of failing a generate
    // that Oracle already reported as successful, and the caller falls back to `latest`.
    let directOtp: string | undefined;
    if (procedureResult.tokenGenerated) {
      try {
        directOtp = normalizeOtp(procedureResult.tokenGenerated);
      } catch {
        directOtp = undefined;
      }
    }
    return {
      ok: true,
      generated: true,
      requestId,
      generatedAt,
      channel,
      ...(directOtp ? { otp: directOtp } : {}),
    };
  } catch (err) {
    throw classifyOracleRuntimeError({
      error: err,
      runtime,
      fallback: "oracle_procedure_failed",
      maskedIdentity: maskIdentity(identity),
    });
  }
}

export async function getLatestLocalToken(
  rawInput: GetLatestLocalTokenInput,
  deps: ServiceDeps = {},
): Promise<GetLatestLocalTokenOutput> {
  const env = deps.env ?? process.env;
  const runtime = resolveOracleOtpRuntimeConfig(env);
  ensureOtpRuntimeEnabled(runtime);
  const runtimeEnvironment = resolveOracleOtpRuntimeEnvironment(env);
  const appSlug = ensureAppSlug(rawInput.appSlug, runtime);
  const appConfigLoader = deps.appConfigLoader ?? loadAppConfig;
  const otpProfile = await resolveProfileAndContext({
    appSlug,
    runtime,
    runtimeEnvironment,
    appConfigLoader,
  });
  const identity = ensureIdentity(rawInput.identity, runtime);
  const channel = ensureChannel(rawInput.channel, { runtime, profile: otpProfile });
  validateScopeAndRateLimit({
    scope: { appSlug, identity, channel },
    runtime,
  });
  const now = deps.now ?? (() => new Date());
  const generatedAfter = ensureGeneratedAfter(rawInput.generatedAfter, runtime, now());
  // requestId is accepted for traceability only; Oracle correlation in this flow uses
  // identity + channel + generatedAfter because the source table does not expose requestId.
  ensureRequestId(rawInput.requestId, runtime);
  const adapter = deps.adapter ?? getSharedOracleOtpAdapter(env);
  try {
    // Temporal correlation lowers (but cannot fully eliminate) collision risk when
    // concurrent requests target the same identity/channel around the same timestamp.
    const queryResult = await adapter.executeLatestLocalTokenQuery({
      identity,
      channel,
      generatedAfter,
      runtime,
    });
    const normalizedOtp = normalizeOtp(queryResult.otp);
    return {
      ok: true,
      otp: normalizedOtp,
      channel,
      source: "oracle_token_table",
    };
  } catch (err) {
    throw classifyOracleRuntimeError({
      error: err,
      runtime,
      fallback: "oracle_unavailable",
      maskedIdentity: maskIdentity(identity),
    });
  }
}

export function resetOtpRateLimiterForTests(): void {
  otpRateLimitStore.clear();
}

export function resetSharedOracleOtpAdapterForTests(): void {
  sharedOracleOtpAdapter = null;
}
