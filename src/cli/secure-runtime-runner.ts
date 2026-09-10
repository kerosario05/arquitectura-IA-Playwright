import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { canonicalizeTestRailCase } from "../testrail/testrail-canonical-adapter";
import { transformTestRailCaseForRuntime, type RuntimeInputRequirement } from "../testrail/testrail-runtime-transformer";
import { resolveScenarioSyntheticValue } from "../data/scenario-synthetic-value-resolver";
import type { DataContextEntry } from "../data/data-context";
import type { RawTestRailCase } from "../types/testrail.types";
import {
  deleteRuntimeContextIfExists,
  writeRuntimeContextIfPresent,
} from "../server/jobs/discovery-batch-runner";

type SecureRuntimeRunnerArgs = {
  appSlug: string;
  caseId: number;
  section?: string;
  testRailProjectId?: string;
  testRailSuiteId?: string;
  testRailSectionId?: string;
  headed: boolean;
  forceRediscovery: boolean;
  autoPromote: boolean;
};

type RuntimeCredentialInput = {
  companyIdentifier: string;
  username: string;
  password: string;
};

export type SecureRuntimeRunnerDependencies = {
  prompt?: (question: string, options?: { secret?: boolean }) => Promise<string>;
  spawnChild?: (invocation: DiscoveryChildInvocation) => Promise<ChildExecutionResult>;
  tempRoot?: string;
  jobId?: string;
  resolveRuntimeEntries?: (input: {
    appSlug: string;
    caseId: number;
    prompt?: (question: string, options?: { secret?: boolean }) => Promise<string>;
  }) => Promise<RuntimeResolutionResult>;
};

export type RuntimeResolutionResult = {
  entries: DataContextEntry[];
  requirements: RuntimeInputRequirement[];
  automaticallyResolved: number;
  userRuntimeRequired: string[];
  datasetRequired: string[];
  oracleRuntimeDerived: string[];
  oracleAuthorityMissing: string[];
  unresolved: string[];
  executionBlockingKeys?: string[];
  executionReadiness?: boolean;
  validationReadiness?: boolean;
  promotionReadiness?: boolean;
  actionInputsRequired?: string[];
  actionInputsResolved?: string[];
  actionInputsGenerated?: string[];
  datasetInputsResolved?: string[];
};

export type RuntimeRequirementClass =
  | "ACTION_INPUT"
  | "CONSTRAINT"
  | "SECURE_INPUT"
  | "DATASET_REQUIRED_INPUT"
  | "RUNTIME_DERIVED_ORACLE"
  | "EXACT_ORACLE";

export function classifyRuntimeRequirement(requirement: RuntimeInputRequirement): RuntimeRequirementClass {
  if (requirement.valueRole === "expected_oracle") return "EXACT_ORACLE";
  if (requirement.valueRole === "runtime_derived_oracle") return "RUNTIME_DERIVED_ORACLE";
  if (requirement.valuePolicy === "trusted_required" || requirement.key.startsWith("auth.")) return "SECURE_INPUT";
  if (requirement.valuePolicy === "dataset_required") return "DATASET_REQUIRED_INPUT";
  if (requirement.inputRole === "supporting") return "CONSTRAINT";
  return "ACTION_INPUT";
}

export type DiscoveryChildInvocation = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: boolean;
  stdio: "inherit";
};

export type ChildExecutionResult = {
  exitCode: number;
  signal: NodeJS.Signals | null;
};

const RUNTIME_ENV = {
  companyIdentifier: "QA_RUNTIME_COMPANY_IDENTIFIER",
  username: "QA_RUNTIME_USERNAME",
  password: "QA_RUNTIME_PASSWORD",
} as const;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertSafeProcessToken(value: string, name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid ${name}; expected a simple project/section token`);
  }
}

function parsePositiveCaseId(value: string): number {
  const parsed = Number(value.replace(/^C/i, ""));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --case-id value: ${value}`);
  }
  return parsed;
}

export function parseSecureRuntimeRunnerArgs(argv: string[]): SecureRuntimeRunnerArgs {
  const args: SecureRuntimeRunnerArgs = {
    appSlug: "",
    caseId: 0,
    headed: true,
    forceRediscovery: false,
    autoPromote: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    const readValue = (): string => {
      if (!next || next.startsWith("--")) throw new Error(`Missing value for ${token}`);
      i += 1;
      return next;
    };

    if (token === "--app") args.appSlug = readValue();
    else if (token === "--case-id") args.caseId = parsePositiveCaseId(readValue());
    else if (token === "--section") args.section = readValue();
    else if (token === "--testrail-project-id") args.testRailProjectId = readValue();
    else if (token === "--testrail-suite-id") args.testRailSuiteId = readValue();
    else if (token === "--testrail-section-id") args.testRailSectionId = readValue();
    else if (token === "--headed") args.headed = true;
    else if (token === "--headless") args.headed = false;
    else if (token === "--force-rediscovery") args.forceRediscovery = true;
    else if (token === "--no-auto-promote") args.autoPromote = false;
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (!nonEmpty(args.appSlug)) throw new Error("--app is required");
  if (args.caseId <= 0) throw new Error("--case-id is required");
  assertSafeProcessToken(args.appSlug, "--app");
  if (args.section) assertSafeProcessToken(args.section, "--section");
  return args;
}

function makeRuntimeEntry(key: string, value: string, sensitive: boolean): DataContextEntry {
  return {
    key,
    value,
    source: "manual_runtime",
    sensitive,
    generated: false,
    verified: true,
    provenance: "user_entered",
  };
}

export function buildRuntimeEntriesByCase(
  caseId: number,
  credentials: RuntimeCredentialInput,
): Record<string, DataContextEntry[]> {
  return {
    [String(caseId)]: [
      makeRuntimeEntry("auth.company_identifier", credentials.companyIdentifier, true),
      makeRuntimeEntry("auth.username", credentials.username, true),
      makeRuntimeEntry("auth.password", credentials.password, true),
    ],
  };
}

function normalizeRuntimeKey(key: string): string {
  return key.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseRuntimeInputMap(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      .map(([key, value]) => [key, String(value).trim()])
      .filter(([, value]) => value.length > 0));
  } catch {
    return {};
  }
}

function mapValue(values: Record<string, unknown>, key: string): string | undefined {
  const target = normalizeRuntimeKey(key);
  const found = Object.entries(values).find(([candidate, value]) =>
    normalizeRuntimeKey(candidate) === target && value !== undefined && value !== null && String(value).trim() !== "",
  );
  return found ? String(found[1]).trim() : undefined;
}

function indexedSourceKey(requirement: RuntimeInputRequirement, requirements: RuntimeInputRequirement[]): string | undefined {
  if (!requirement.datasetIdentity || requirement.datasetOrdinal === undefined) return undefined;
  return requirements.find((candidate) =>
    candidate.datasetIdentity === requirement.datasetIdentity
      && candidate.datasetOrdinal === requirement.datasetOrdinal
      && candidate.valueRole !== "expected_oracle"
      && candidate.key !== requirement.key,
  )?.key;
}

export function deriveRuntimeRequirementMetadata(
  requirements: RuntimeInputRequirement[],
  rawCase: RawTestRailCase,
): RuntimeInputRequirement[] {
  const canonical = canonicalizeTestRailCase(rawCase);
  const datasetRequiredKeys = new Set<string>();
  for (const step of canonical.steps) {
    if (!step.valueKey || step.rowScope === undefined) continue;
    const lookupCompletion = canonical.steps.some((candidate) =>
      candidate.order > step.order
        && candidate.expectedValueKey === step.valueKey
        && (candidate.rowScope === step.rowScope || candidate.rowScope === undefined),
    );
    if (lookupCompletion) datasetRequiredKeys.add(step.valueKey);
  }

  return requirements.map((requirement) => {
    const dependsOn = requirement.valueRole === "expected_oracle"
      ? (() => {
        const expectedStep = canonical.steps.find((step) => step.expectedValueKey === requirement.key);
        const sourceStep = expectedStep
          ? [...canonical.steps].reverse().find((step) =>
            step.order < expectedStep.order
              && step.valueKey
              && (step.rowScope === expectedStep.rowScope || expectedStep.rowScope === undefined)
              && (step.entityScope === expectedStep.entityScope || expectedStep.entityScope === undefined),
          )
          : undefined;
        return sourceStep?.valueKey ?? indexedSourceKey(requirement, requirements);
      })()
      : undefined;
    const datasetRequired = datasetRequiredKeys.has(requirement.key);
    return {
      ...requirement,
      ...(dependsOn ? { dependsOn: [dependsOn] } : {}),
      ...(datasetRequired ? { valuePolicy: "dataset_required" as const } : {}),
    };
  });
}

function runtimeEntryFromRequirement(
  requirement: RuntimeInputRequirement,
  value: string,
  source: DataContextEntry["source"],
  options: { generated?: boolean; verified?: boolean; provenance?: string } = {},
): DataContextEntry {
  return {
    key: requirement.key,
    value,
    source,
    sensitive: requirement.sensitive === true || requirement.fieldCapability.kind === "password",
    generated: options.generated ?? false,
    verified: options.verified ?? false,
    ...(options.provenance ? { provenance: options.provenance } : {}),
    ...(requirement.semanticType ? { semanticType: requirement.semanticType } : {}),
    fieldKind: requirement.fieldCapability.kind,
    ...(requirement.valueRole ? { valueRole: requirement.valueRole } : {}),
    ...(requirement.oracleSource ? { oracleSource: requirement.oracleSource } : {}),
    ...(requirement.dependsOn ? { dependsOn: [...requirement.dependsOn] } : {}),
    ...(requirement.datasetIdentity ? { datasetIdentity: requirement.datasetIdentity } : {}),
  };
}

function requirementPrompt(requirement: RuntimeInputRequirement): string {
  const label = requirement.displayLabel ?? requirement.label ?? requirement.key;
  return `Runtime input - ${label} (${requirement.key}): `;
}

async function resolveRuntimeRequirements(
  appSlug: string,
  caseId: number,
  prompt: (question: string, options?: { secret?: boolean }) => Promise<string> | undefined,
): Promise<RuntimeResolutionResult> {
  const client = new TestRailClient(requireTestRailConfig(config));
  const rawCase = await client.getCase(caseId);
  const transformed = transformTestRailCaseForRuntime(rawCase);
  const requirements = deriveRuntimeRequirementMetadata(transformed.inputRequirements, rawCase);
  const explicitValues: Record<string, string> = {
    ...parseRuntimeInputMap(process.env.QA_RUNTIME_INPUTS_JSON),
    ...parseRuntimeInputMap(process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON),
  };
  const contextValues = parseRuntimeInputMap(process.env.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON);
  const confirmedValues = parseRuntimeInputMap(process.env.QA_CONFIRMED_RUNTIME_INPUTS_JSON);
  const configuredValues: Record<string, unknown> = { ...config.app.testData };
  const qaProfile = (config.app.testDataProfile ?? "qa").toLowerCase();
  const entries: DataContextEntry[] = [];
  const unresolved: string[] = [];
  const userRuntimeRequired: string[] = [];
  const datasetRequired: string[] = requirements
    .filter((requirement) => requirement.valuePolicy === "dataset_required")
    .map((requirement) => requirement.key);
  const oracleRuntimeDerived: string[] = [];
  const oracleAuthorityMissing: string[] = [];
  const executionBlockingKeys: string[] = [];
  let automaticallyResolved = 0;

  for (const requirement of requirements) {
    const direct = mapValue(explicitValues, requirement.key)
      ?? (requirement.key === "auth.company_identifier" ? nonEmpty(process.env[RUNTIME_ENV.companyIdentifier]) : undefined)
      ?? (requirement.key === "auth.username" ? nonEmpty(process.env[RUNTIME_ENV.username]) : undefined)
      ?? (requirement.key === "auth.password" ? nonEmpty(process.env[RUNTIME_ENV.password]) : undefined);
    if (direct) {
      entries.push(runtimeEntryFromRequirement(requirement, direct, requirement.key.startsWith("auth.") ? "user_provided_qa_credentials" : "explicit_runtime_input", { verified: false, provenance: "user_entered" }));
      automaticallyResolved += 1;
      continue;
    }
    const contextValue = mapValue(contextValues, requirement.key);
    if (contextValue) {
      entries.push(runtimeEntryFromRequirement(requirement, contextValue, "runtime_context", { verified: false, provenance: "selection_runtime" }));
      automaticallyResolved += 1;
      continue;
    }
    const confirmed = mapValue(confirmedValues, requirement.key);
    if (confirmed) {
      entries.push(runtimeEntryFromRequirement(requirement, confirmed, "qa_dataset", { verified: true, provenance: "confirmed_case_runtime" }));
      automaticallyResolved += 1;
      continue;
    }
    const configured = mapValue(configuredValues, requirement.key);
    if (configured) {
      entries.push(runtimeEntryFromRequirement(requirement, configured, qaProfile === "qa" ? "qa_dataset" : "project_config", { verified: true, provenance: "confirmed_case_runtime" }));
      automaticallyResolved += 1;
      continue;
    }
    if (requirement.valuePolicy !== "dataset_required"
      && requirement.valueRole !== "expected_oracle"
      && requirement.scenarioDataPolicy === "synthetic_allowed") {
      const generated = resolveScenarioSyntheticValue({
        requirement: { ...requirement, valuePolicy: "scenario_controlled" } as any,
        seed: `${appSlug}:${caseId}:${requirement.key}`,
      });
      if (generated.status === "generated" && generated.value !== undefined) {
        entries.push(runtimeEntryFromRequirement(requirement, String(generated.value), "auto_generated", { generated: true, verified: false, provenance: "runtime_inference" }));
        automaticallyResolved += 1;
        continue;
      }
    }
    if (requirement.valueRole === "runtime_derived_oracle") {
      oracleRuntimeDerived.push(requirement.key);
      continue;
    }
    if (requirement.valueRole === "expected_oracle") {
      oracleAuthorityMissing.push(requirement.key);
      unresolved.push(requirement.key);
      continue;
    }
    if (requirement.required === false) continue;
    userRuntimeRequired.push(requirement.key);
    const supplied = nonEmpty(await prompt(requirementPrompt(requirement), {
      // Runtime credentials and dataset identifiers must never be echoed by
      // an interactive terminal, even when the upstream contract omits the
      // sensitive marker. Values still travel only through the secure context.
      secret: requirement.sensitive === true
        || requirement.fieldCapability.kind === "password"
        || requirement.key.startsWith("auth.")
        || requirement.inputRole === "scenario"
        || requirement.valuePolicy === "dataset_required",
    }));
    if (supplied) {
      entries.push(runtimeEntryFromRequirement(requirement, supplied, requirement.key.startsWith("auth.") ? "user_provided_qa_credentials" : "explicit_runtime_input", { verified: false, provenance: "user_entered" }));
      continue;
    }
    unresolved.push(requirement.key);
    if (requirement.valuePolicy === "dataset_required") break;
  }

  const resolvedKeys = new Set(entries.map((entry) => entry.key));
  const actionInputsRequired = requirements
    .filter((requirement) => classifyRuntimeRequirement(requirement) === "ACTION_INPUT")
    .map((requirement) => requirement.key);
  const actionInputsResolved = actionInputsRequired.filter((key) => resolvedKeys.has(key));
  const actionInputsGenerated = entries
    .filter((entry) => entry.generated === true && actionInputsRequired.includes(entry.key))
    .map((entry) => entry.key);
  const datasetInputsResolved = datasetRequired.filter((key) => resolvedKeys.has(key));
  for (const key of unresolved) {
    const requirement = requirements.find((candidate) => candidate.key === key);
    if (!requirement) continue;
    const classification = classifyRuntimeRequirement(requirement);
    if (classification === "SECURE_INPUT" || classification === "DATASET_REQUIRED_INPUT" || classification === "ACTION_INPUT") {
      executionBlockingKeys.push(key);
    }
  }

  return {
    entries,
    requirements,
    automaticallyResolved,
    userRuntimeRequired,
    datasetRequired,
    oracleRuntimeDerived,
    oracleAuthorityMissing,
    unresolved,
    executionBlockingKeys,
    executionReadiness: executionBlockingKeys.length === 0,
    validationReadiness: oracleAuthorityMissing.length === 0,
    promotionReadiness: false,
    actionInputsRequired,
    actionInputsResolved,
    actionInputsGenerated,
    datasetInputsResolved,
  };
}

async function promptVisible(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Secret prompt requires an interactive local terminal or QA_RUNTIME_PASSWORD");
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Secret input cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0008" || char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
    };
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

export async function resolveRuntimeCredentials(
  prompt: (question: string, options?: { secret?: boolean }) => Promise<string> = async (question, options) =>
    options?.secret ? promptSecret(question) : promptVisible(question),
): Promise<RuntimeCredentialInput> {
  const companyIdentifier = nonEmpty(process.env[RUNTIME_ENV.companyIdentifier])
    ?? nonEmpty(await prompt("RNC: "));
  const username = nonEmpty(process.env[RUNTIME_ENV.username])
    ?? nonEmpty(await prompt("Usuario: "));
  const password = nonEmpty(process.env[RUNTIME_ENV.password])
    ?? nonEmpty(await prompt("Contraseña: ", { secret: true }));
  if (!companyIdentifier || !username || !password) throw new Error("All runtime credentials are required");
  return { companyIdentifier, username, password };
}

function logRuntimeKeys(entries: DataContextEntry[]): void {
  for (const entry of entries) {
    const source = entry.source === "manual_runtime" ? "user_provided_qa_credentials" : entry.source;
    console.log(`${entry.key} resolved=true source=${source}${entry.sensitive ? " sensitive=true" : ""} generated=${entry.generated === true}`);
  }
}

export function buildDiscoveryChildInvocation(
  runnerArgs: SecureRuntimeRunnerArgs,
  env: NodeJS.ProcessEnv,
  options: { platform?: NodeJS.Platform; cwd?: string } = {},
): DiscoveryChildInvocation {
  const platform = options.platform ?? process.platform;
  const args = [
    "run", "discovery:case", "--", "--case-id", String(runnerArgs.caseId),
    "--app", runnerArgs.appSlug,
    ...(runnerArgs.section ? ["--section", runnerArgs.section] : []),
    ...(runnerArgs.headed ? ["--headed"] : []),
    ...(runnerArgs.forceRediscovery ? ["--overwrite"] : []),
    ...(runnerArgs.autoPromote ? ["--auto-promote"] : []),
  ];
  return {
    command: platform === "win32" ? "npm.cmd" : "npm",
    args,
    cwd: options.cwd ?? process.cwd(),
    env,
    shell: platform === "win32",
    stdio: "inherit",
  };
}

async function spawnDiscoveryChild(invocation: DiscoveryChildInvocation): Promise<ChildExecutionResult> {
  return new Promise((resolve, reject) => {
    // Windows cannot launch npm.cmd through CreateProcess with shell=false;
    // use the platform shell only for the command shim. Runtime values remain
    // in the environment/context file and never enter this argv list.
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      stdio: invocation.stdio,
      shell: invocation.shell,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({
      exitCode: typeof code === "number" ? code : 1,
      signal,
    }));
  });
}

export async function runSecureRuntimeDiscovery(
  runnerArgs: SecureRuntimeRunnerArgs,
  dependencies: SecureRuntimeRunnerDependencies = {},
): Promise<ChildExecutionResult> {
  const prompt = dependencies.prompt ?? (async (question, options) =>
    options?.secret ? promptSecret(question) : promptVisible(question));
  const resolution = dependencies.resolveRuntimeEntries
    ? await dependencies.resolveRuntimeEntries({ appSlug: runnerArgs.appSlug, caseId: runnerArgs.caseId, prompt })
    : await resolveRuntimeRequirements(runnerArgs.appSlug, runnerArgs.caseId, prompt);
  const executionBlockingKeys = resolution.executionBlockingKeys
    ?? resolution.unresolved.filter((key) => !resolution.oracleAuthorityMissing.includes(key));
  console.log(`[runtime-input-contract] required=${resolution.requirements.length} automaticallyResolved=${resolution.automaticallyResolved} userRuntimeRequired=${resolution.userRuntimeRequired.length} datasetRequired=${resolution.datasetRequired.length} oracleRuntimeDerived=${resolution.oracleRuntimeDerived.length} oracleAuthorityMissing=${resolution.oracleAuthorityMissing.length} unresolved=${resolution.unresolved.length} executionReadiness=${resolution.executionReadiness ?? executionBlockingKeys.length === 0} validationReadiness=${resolution.validationReadiness ?? resolution.oracleAuthorityMissing.length === 0}`);
  if (executionBlockingKeys.length > 0) {
    const datasetMissing = resolution.unresolved.filter((key) => resolution.datasetRequired.includes(key));
    const code = datasetMissing.length > 0 ? "DATASET_AUTHORITY_MISSING" : "RUNTIME_INPUT_AUTHORITY_MISSING";
    throw new Error(`${code} keys=[${executionBlockingKeys.join(",")}] unresolvedCount=${resolution.unresolved.length} validationBlockers=${resolution.oracleAuthorityMissing.length}`);
  }
  const entriesByCase = { [String(runnerArgs.caseId)]: resolution.entries };
  const entries = entriesByCase[String(runnerArgs.caseId)] ?? [];
  const tempBase = dependencies.tempRoot ?? os.tmpdir();
  const runtimeDir = await fsp.mkdtemp(path.join(tempBase, "web-ai-automation-runtime-"));
  const jobId = dependencies.jobId ?? `secure-runtime-${process.pid}-${Date.now()}`;
  let runtimeContextPath: string | undefined;

  try {
    runtimeContextPath = writeRuntimeContextIfPresent(jobId, { runtimeEntriesByCase: entriesByCase } as never, runtimeDir);
    if (!runtimeContextPath) throw new Error("Runtime context was not materialized");
    const authResolved = entries.filter((entry) => entry.key.startsWith("auth.")).length;
    logRuntimeKeys(entries);
    console.log(`secureRuntimeSourceReady=${authResolved === 3} credentialsResolved=${authResolved}/3`);

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DISCOVERY_RUNTIME_CONTEXT: runtimeContextPath,
      ...(runnerArgs.testRailProjectId ? { TESTRAIL_PROJECT_ID: runnerArgs.testRailProjectId } : {}),
      ...(runnerArgs.testRailSuiteId ? { TESTRAIL_SUITE_ID: runnerArgs.testRailSuiteId } : {}),
      ...(runnerArgs.testRailSectionId ? { TESTRAIL_SECTION_ID: runnerArgs.testRailSectionId } : {}),
    };
    console.log(`runtimeContextTransport=DISCOVERY_RUNTIME_CONTEXT forceRediscovery=${runnerArgs.forceRediscovery}`);
    const invocation = buildDiscoveryChildInvocation(runnerArgs, childEnv);
    const result = await (dependencies.spawnChild ?? spawnDiscoveryChild)(invocation);
    if (result.signal) console.log(`childSignal=${result.signal}`);
    return result;
  } finally {
    if (runtimeContextPath) await deleteRuntimeContextIfExists(jobId, runtimeDir);
    await fsp.rm(runtimeDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = parseSecureRuntimeRunnerArgs(process.argv.slice(2));
  const result = await runSecureRuntimeDiscovery(args);
  process.exitCode = result.exitCode;
}

const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("secure-runtime-runner.ts");
if (isMainModule) main().catch((error) => { console.error(`[secure-runtime-runner] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
