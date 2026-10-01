/**
 * Auth runtime knobs, read from the environment on every call so tests and the
 * CLI can change them without re-importing the module.
 */

export type AuthConfig = {
  /** When false the API keeps its previous behaviour and no route requires a session. */
  enabled: boolean;
  sessionTtlMs: number;
  /** Lifetime of the restricted session issued when a password change is pending. */
  passwordChangeTtlMs: number;
  maxFailedAttempts: number;
  lockoutMs: number;
};

const DEFAULTS = {
  sessionTtlHours: 12,
  passwordChangeTtlMinutes: 15,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

function readNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

export function resolveAuthConfig(): AuthConfig {
  return {
    enabled: readBoolean("AUTH_ENABLED", false),
    sessionTtlMs: readNumber("AUTH_SESSION_TTL_HOURS", DEFAULTS.sessionTtlHours, 0.25, 720) * 3_600_000,
    passwordChangeTtlMs:
      readNumber("AUTH_PASSWORD_CHANGE_TTL_MINUTES", DEFAULTS.passwordChangeTtlMinutes, 1, 1440) *
      60_000,
    maxFailedAttempts: readNumber("AUTH_MAX_FAILED_ATTEMPTS", DEFAULTS.maxFailedAttempts, 1, 100),
    lockoutMs: readNumber("AUTH_LOCKOUT_MINUTES", DEFAULTS.lockoutMinutes, 1, 1440) * 60_000,
  };
}
