import { loadAppConfig } from "../automations/app-auto-resolver";
import { resolveServerPort } from "../server/config";

/**
 * Just-in-time OTP resolution for mobile steps with `otp.required === true`.
 *
 * Resolves identity + channel from scenario runtime data and the app's otpProfile,
 * then calls the existing internal OTP endpoints (generate -> latest) to obtain a
 * FRESH one-time code. No OTP is ever persisted, logged in full, or written to config.
 *
 * Multiproject: no appSlug, channel, identity, or endpoint is hardcoded in core.
 */

export class MobileOtpResolverError extends Error {
  constructor(
    public readonly reasonCode: string,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(`${reasonCode}: ${message}`);
    this.name = "MobileOtpResolverError";
  }
}

export type ResolvedOtp = {
  otp: string;
  requestId: string;
  channel: string;
};

export type OtpResolveOptions = {
  appSlug: string;
  identity: string;
  channelHint?: string;
};

type OtpProfile = {
  strategy?: string;
  defaultChannel?: string;
  allowedChannels?: string[];
};

function otpBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env.OTP_INTERNAL_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = (env.HOST ?? "").trim() || "127.0.0.1";
  return `http://${host}:${resolveServerPort(env)}`;
}

function automationKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ORACLE_OTP_REQUEST_KEY ?? "").trim();
}

function maskOtp(otp: string): string {
  if (!otp) return "-";
  return otp.length <= 2 ? "*".repeat(otp.length) : `${otp.slice(0, 2)}****${otp.slice(-2)}`;
}

function maskIdentity(identity: string): string {
  if (!identity) return "-";
  if (identity.length <= 4) return "*".repeat(identity.length);
  return `${"*".repeat(identity.length - 4)}${identity.slice(-4)}`;
}

async function loadOtpProfile(appSlug: string): Promise<OtpProfile | null> {
  const cfg = await loadAppConfig(appSlug);
  if (!cfg || typeof cfg !== "object") return null;
  const direct = cfg.otpProfile;
  const container = cfg.appProfile && typeof cfg.appProfile === "object" && !Array.isArray(cfg.appProfile)
    ? (cfg.appProfile as Record<string, unknown>).otpProfile
    : undefined;
  const raw = (direct ?? container) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  return {
    strategy: typeof raw.strategy === "string" ? raw.strategy : undefined,
    defaultChannel: typeof raw.defaultChannel === "string" ? raw.defaultChannel : undefined,
    allowedChannels: Array.isArray(raw.allowedChannels)
      ? raw.allowedChannels.filter((c): c is string => typeof c === "string")
      : undefined,
  };
}

function resolveChannel(hint: string | undefined, profile: OtpProfile): string {
  const norm = (s: string) => s.trim().toUpperCase();
  const allowed = (profile.allowedChannels ?? []).map(norm).filter(Boolean);
  if (hint && allowed.includes(norm(hint))) return norm(hint);
  if (allowed.includes(norm(profile.defaultChannel ?? ""))) return norm(profile.defaultChannel ?? "");
  if (allowed.length === 0) {
    // Fall back to a default-channel hint only when there is an unambiguous single channel.
    throw new MobileOtpResolverError("otp_channel_not_allowed", "OTP channel could not be resolved from app otpProfile.");
  }
  throw new MobileOtpResolverError("otp_channel_not_allowed", "OTP channel is not allowed by app otpProfile.");
}

async function postOtp(path: string, body: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<{ status: number; data: any }> {
  const key = automationKey(env);
  if (!key) {
    throw new MobileOtpResolverError("otp_invalid_auth", "ORACLE_OTP_REQUEST_KEY is not configured.");
  }
  const controller = new AbortController();
  const timeoutMs = Number(env.OTP_HTTP_TIMEOUT_MS ?? "8000");
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${otpBaseUrl(env)}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-automation-key": key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new MobileOtpResolverError("otp_timeout", "OTP endpoint request timed out.");
    }
    throw new MobileOtpResolverError("otp_resolve_failed", `OTP endpoint unreachable: ${err?.message ?? "network error"}`);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function mapOtpHttpError(status: number, data: any): MobileOtpResolverError {
  const reason = typeof data?.reasonCode === "string" ? data.reasonCode : "";
  const specific = reason ? `otp_${reason.replace(/^otp_/, "")}` : undefined;
  const code =
    specific && /^otp_[a-z0-9_]+$/.test(specific)
      ? specific
      : status === 401 ? "otp_invalid_auth"
      : status === 403 ? "otp_endpoint_not_allowed"
      : status === 404 ? "otp_not_found"
      : status === 429 ? "otp_rate_limited"
      : "otp_resolve_failed";
  return new MobileOtpResolverError(code, `OTP endpoint returned HTTP ${status}.`, status);
}

/**
 * Generates a fresh OTP and immediately fetches it via latest. Returns the OTP value
 * (6 digits) plus requestId/channel. Never persists the OTP.
 */
export async function resolveMobileOtp(
  opts: OtpResolveOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedOtp> {
  const profile = await loadOtpProfile(opts.appSlug);
  if (!profile || (profile.strategy ?? "").toLowerCase() !== "oracle_local_token") {
    throw new MobileOtpResolverError("otp_endpoint_not_allowed", "App otpProfile is not enabled for local-token OTP.");
  }
  const channel = resolveChannel(opts.channelHint, profile);

  const generatedAfter = new Date().toISOString();
  const started = Date.now();
  console.log(`[mobile:otp] phase=resolve identitySource=${opts.channelHint ? "hint" : "config"} channel=${channel}`);
  console.log(`[mobile:otp] phase=resolve identity=${maskIdentity(opts.identity)} channel=${channel}`);

  // generate
  const genStart = Date.now();
  const gen = await postOtp("/api/internal/otp/local-token/generate", {
    identity: opts.identity,
    channel,
    appSlug: opts.appSlug,
  }, env);
  if (gen.status !== 200 || gen.data?.ok !== true) {
    throw mapOtpHttpError(gen.status, gen.data);
  }
  const requestId = typeof gen.data?.requestId === "string" ? gen.data.requestId : "";
  const genMs = Date.now() - genStart;
  console.log(`[mobile:otp] phase=generate durationMs=${genMs} requestId=${requestId}`);

  // latest (immediately, no sleep)
  const latStart = Date.now();
  const lat = await postOtp("/api/internal/otp/local-token/latest", {
    identity: opts.identity,
    channel,
    appSlug: opts.appSlug,
    generatedAfter,
    ...(requestId ? { requestId } : {}),
  }, env);
  let otpValue = "";
  if (lat.status === 200 && lat.data?.ok === true && typeof lat.data?.otp === "string") {
    otpValue = lat.data.otp.trim();
  }
  const latMs = Date.now() - latStart;
  if (!otpValue) {
    if (lat.status === 404 || lat.data?.reasonCode === "otp_not_found") {
      throw new MobileOtpResolverError("otp_not_found", "Fresh OTP not found immediately after generate.");
    }
    // Also reject HTTP 200 when the OTP payload is empty — a valid generate→latest cycle
    // must never return an empty string.
    throw new MobileOtpResolverError("otp_value_empty", `OTP resolve returned empty value (HTTP ${lat.status}).`);
  }
  const ageMs = Math.max(0, Date.now() - new Date(generatedAfter).getTime());
  console.log(`[mobile:otp] phase=latest durationMs=${latMs} found=true ageMs=${ageMs}`);

  const totalMs = Date.now() - started;
  console.log(`[mobile:otp] phase=fill success=true totalMs=${totalMs} otp=${maskOtp(otpValue)}`);
  return { otp: otpValue, requestId, channel };
}
