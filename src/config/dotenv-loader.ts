import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const POWERSHELL_ENV_PREFIX = "$env:";

function parsePowerShellStyleEnvLines(rawEnvContent: string): Record<string, string> {
  const normalizedLines: string[] = [];
  const lines = rawEnvContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (!trimmed.startsWith(POWERSHELL_ENV_PREFIX)) {
      continue;
    }
    const assignment = trimmed.slice(POWERSHELL_ENV_PREFIX.length);
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = assignment.slice(0, equalsIndex).trim();
    if (!VALID_ENV_KEY.test(key)) {
      continue;
    }
    const value = assignment.slice(equalsIndex + 1);
    normalizedLines.push(`${key}=${value}`);
  }
  if (normalizedLines.length === 0) {
    return {};
  }
  return dotenv.parse(normalizedLines.join("\n"));
}

function applyEnvEntries(
  targetEnv: NodeJS.ProcessEnv,
  entries: Record<string, string>,
  overrideExisting: boolean,
): void {
  for (const [key, value] of Object.entries(entries)) {
    if (!overrideExisting && typeof targetEnv[key] === "string") {
      continue;
    }
    targetEnv[key] = value;
  }
}

export function loadDotenvWithPowerShellSupport(options: {
  env?: NodeJS.ProcessEnv;
  envPath?: string;
  overrideExisting?: boolean;
} = {}): void {
  const targetEnv = options.env ?? process.env;
  const overrideExisting = options.overrideExisting === true;
  const envPath = options.envPath ? path.resolve(options.envPath) : path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const standardEntries = dotenv.parse(raw);
  const powerShellEntries = parsePowerShellStyleEnvLines(raw);
  applyEnvEntries(targetEnv, standardEntries, overrideExisting);
  applyEnvEntries(targetEnv, powerShellEntries, overrideExisting);
}
