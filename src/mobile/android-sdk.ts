import * as path from "node:path";
import * as fs from "node:fs";
import { config } from "../config/env";

export type AndroidSdkPaths = {
  sdkHome: string;
  adbPath: string;
  emulatorPath: string;
};

type ResolveAndroidSdkOptions = {
  env?: NodeJS.ProcessEnv;
  configuredSdkHome?: string;
  existsSync?: (targetPath: string) => boolean;
  platform?: NodeJS.Platform;
};

function trimAndUnquote(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function containsUnexpandedExpression(input: string): boolean {
  return /\$env:[A-Za-z_][A-Za-z0-9_]*/i.test(input) ||
    /%[A-Za-z_][A-Za-z0-9_]*%/.test(input) ||
    /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(input);
}

function resolveSdkHomeCandidate(rawCandidate: string | undefined, env: NodeJS.ProcessEnv): {
  resolvedPath?: string;
  rejectedReason?: string;
} {
  const candidate = trimAndUnquote(rawCandidate);
  if (!candidate) return {};

  if (containsUnexpandedExpression(candidate)) {
    return {
      rejectedReason: `contains unexpanded environment expression: ${candidate}`,
    };
  }

  return { resolvedPath: path.resolve(candidate) };
}

export function resolveAndroidSdk(options: ResolveAndroidSdkOptions = {}): AndroidSdkPaths {
  const env = options.env ?? process.env;
  const existsSync = options.existsSync ?? fs.existsSync;
  const configuredSdkHome = options.configuredSdkHome ?? config.integrations.android?.sdkHome;

  const candidateInputs: Array<{ source: string; value: string | undefined }> = [
    { source: "ANDROID_HOME", value: env.ANDROID_HOME },
    { source: "ANDROID_SDK_ROOT", value: env.ANDROID_SDK_ROOT },
    { source: "config.integrations.android.sdkHome", value: configuredSdkHome },
    { source: "LOCALAPPDATA\\Android\\Sdk", value: trimAndUnquote(env.LOCALAPPDATA) ? path.join(trimAndUnquote(env.LOCALAPPDATA)!, "Android", "Sdk") : undefined },
  ];

  const rejectedCandidates: string[] = [];
  let sdkHome: string | undefined;

  for (const candidate of candidateInputs) {
    const resolved = resolveSdkHomeCandidate(candidate.value, env);
    if (resolved.rejectedReason) {
      rejectedCandidates.push(`${candidate.source}: ${resolved.rejectedReason}`);
      continue;
    }
    if (!resolved.resolvedPath) {
      continue;
    }
    if (!existsSync(resolved.resolvedPath)) {
      rejectedCandidates.push(`${candidate.source}: path does not exist (${resolved.resolvedPath})`);
      continue;
    }
    sdkHome = resolved.resolvedPath;
    break;
  }

  if (!sdkHome) {
    const details = rejectedCandidates.length > 0
      ? ` Rejected candidates: ${rejectedCandidates.join(" | ")}`
      : "";
    throw new Error(
      "Unable to resolve Android SDK home. Set ANDROID_HOME or ANDROID_SDK_ROOT to an existing absolute path (or ensure LOCALAPPDATA\\Android\\Sdk exists on Windows)." + details
    );
  }

  const platform = (options.platform ?? process.platform) === "win32" ? "win32" : "posix";
  const adbPath = platform === "win32"
    ? path.join(sdkHome, "platform-tools", "adb.exe")
    : path.join(sdkHome, "platform-tools", "adb");
  const emulatorPath = platform === "win32"
    ? path.join(sdkHome, "emulator", "emulator.exe")
    : path.join(sdkHome, "emulator", "emulator");

  if (!existsSync(adbPath)) {
    throw new Error(`Android SDK resolved (${sdkHome}) but adb binary is missing at: ${adbPath}`);
  }
  if (!existsSync(emulatorPath)) {
    throw new Error(`Android SDK resolved (${sdkHome}) but emulator binary is missing at: ${emulatorPath}`);
  }

  return { sdkHome, adbPath, emulatorPath };
}
