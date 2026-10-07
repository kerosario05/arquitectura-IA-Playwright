import fs from "node:fs";
import path from "node:path";
import { spawn as spawnChild } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { CodexDiscoveryResult, QaLabReference, TaskContract } from "./types";

type JsonRecord = Record<string, any>;
const TERMINAL = /^(completed|completed_with_failures|failed|error|cancelled|canceled|blocked|success|passed)$/i;

function record(value: unknown): JsonRecord { return value && typeof value === "object" ? value as JsonRecord : {}; }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function nonNegative(value: unknown): number { return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0; }
function jobId(value: JsonRecord): string { return text(value.id ?? value.jobId ?? value.runId ?? value.data?.id ?? value.data?.jobId ?? value.data?.runId); }
export function extractScopeCountDiagnostics(logText: string): string[] {
  return logText.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/reason=scoped_scope_not_unique strategy=([a-z-]+) scopeMatchCount=(\d+)/i);
    return match ? [`scoped_scope_not_unique strategy=${match[1]} scopeMatchCount=${match[2]}`] : [];
  }).slice(-5);
}
export function extractFunctionalFailureDiagnostics(logText: string): string[] {
  return logText.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/\[functional-execution\]\s+exitCode=\d+\s+error=(.+?)(?:\s+file=|$)/i);
    return match ? [redact(match[1].replace(/^"|"$/g, "")).slice(0, 2000)] : [];
  }).slice(-3);
}
function redact(value: string): string {
  return value.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED_TOKEN]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|credential|secret|token)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

const SAFE_PROJECT_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_CAPTURED_STREAM_BYTES = 64 * 1024;

function validatedDiscoveryArgs(reference: QaLabReference, inputPath: string): string[] {
  const projectSlug = reference.projectSlug ?? "";
  if (!SAFE_PROJECT_SLUG.test(projectSlug)) throw new Error("Local Discovery fallback requires a validated project slug.");
  const historicalInput = path.resolve(reference.inputPath ?? "");
  const expectedInput = path.resolve(process.cwd(), ".artifacts", "scenario-preview-runs", reference.id, "preview-scenarios.json");
  if (historicalInput !== expectedInput) throw new Error("Local Discovery fallback rejected an input path outside the referenced job artifacts.");
  const expectedSourceArgs = ["run", "discovery:preview", "--", "--input", expectedInput, "--app", projectSlug, "--overwrite", "--auto-promote", "--auto-pom", "--rerun-active"];
  if (!reference.validatedCommand || JSON.stringify(reference.validatedCommand) !== JSON.stringify(expectedSourceArgs)) {
    throw new Error("Local Discovery fallback rejected a command that does not match the validated job command and flags.");
  }
  return ["run", "discovery:preview", "--", "--input", inputPath, "--app", projectSlug, "--overwrite", "--auto-promote", "--auto-pom", "--rerun-active"];
}

export function assertDiscoveryInputProject(input: unknown, projectSlug: string): void {
  const scenarios = Array.isArray(input) ? input : [input];
  const slugs = scenarios.map((scenario) => text(record(scenario).appSlug).toLowerCase());
  if (!slugs.length || slugs.some((slug) => !slug || slug !== projectSlug.toLowerCase())) {
    throw new Error("Local Discovery fallback project mismatch between saved input and validated project.");
  }
}

async function runLocalValidatedDiscovery(reference: QaLabReference, freshId: string): Promise<JsonRecord> {
  if (reference.kind !== "discovery-job" || !reference.inputPath || !reference.projectSlug) throw new Error("Local Discovery fallback requires a validated job reference.");
  const repoRoot = process.cwd();
  const sourceInput = path.resolve(reference.inputPath);
  if (!fs.existsSync(sourceInput)) throw new Error("Local Discovery fallback cannot find the saved input artifact for the referenced job.");
  let parsedInput: unknown;
  try { parsedInput = JSON.parse(fs.readFileSync(sourceInput, "utf8")); }
  catch { throw new Error("Local Discovery fallback rejected malformed saved input JSON."); }
  assertDiscoveryInputProject(parsedInput, reference.projectSlug);

  const artifactsRoot = path.resolve(repoRoot, ".artifacts", "scenario-preview-runs");
  const runDir = path.join(artifactsRoot, freshId);
  const runDirPrefix = `${artifactsRoot}${path.sep}`;
  if (!runDir.startsWith(runDirPrefix) || freshId === reference.id) throw new Error("Local Discovery fallback generated an invalid or reused run id.");
  fs.mkdirSync(runDir, { recursive: true });
  const freshInput = path.join(runDir, "preview-scenarios.json");
  fs.copyFileSync(sourceInput, freshInput);
  const args = validatedDiscoveryArgs(reference, freshInput);
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let processError = "";
  let exitCode: number | null = null;
  const appendBounded = (current: Buffer, chunk: Buffer): Buffer => Buffer.concat([current, chunk]).subarray(-MAX_CAPTURED_STREAM_BYTES);

  await new Promise<void>((resolve) => {
    let child;
    try {
      child = spawnChild(command, args, {
        cwd: repoRoot,
        env: { ...process.env, EVIDENCE_RUN_ID: freshId },
        shell: process.platform === "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      processError = error instanceof Error ? error.message : String(error);
      resolve();
      return;
    }
    child.stdout?.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, Buffer.from(chunk)); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, Buffer.from(chunk)); });
    child.on("error", (error) => { processError = error.message; });
    child.on("close", (code) => { exitCode = code; resolve(); });
  });

  const stdoutText = redact(stdout.toString("utf8"));
  const stderrText = redact(stderr.toString("utf8"));
  fs.writeFileSync(path.join(runDir, "stdout.log"), stdoutText, "utf8");
  fs.writeFileSync(path.join(runDir, "stderr.log"), stderrText, "utf8");
  let results: JsonRecord = {};
  const resultsPath = path.join(runDir, "results.json");
  if (fs.existsSync(resultsPath)) {
    try { results = record(JSON.parse(fs.readFileSync(resultsPath, "utf8"))); }
    catch { processError ||= "Fresh Discovery CLI produced malformed results.json."; }
  }
  const summary = record(results.summary);
  const status = processError || exitCode !== 0 || nonNegative(summary.failed) > 0 ? "completed_with_failures" : "completed";
  const externalBlocker = !fs.existsSync(resultsPath) && (Boolean(processError) || exitCode !== 0);
  const job = { id: freshId, status, params: { appSlug: reference.projectSlug }, summary, exitCode, ...(processError ? { processError: redact(processError) } : {}) };
  fs.writeFileSync(path.join(runDir, "job.json"), JSON.stringify(job, null, 2), "utf8");
  return {
    ...job,
    results,
    artifactsDir: runDir,
    logs: [stdoutText, stderrText].flatMap((value) => value.split(/\r?\n/)).filter(Boolean).slice(-12),
    ...(externalBlocker ? { externalBlocker: true, errorMessage: processError || `Local Discovery CLI exited with code ${exitCode ?? "unknown"} before writing results.json.` } : {}),
  };
}

async function requestJson(url: string, init?: RequestInit): Promise<JsonRecord> {
  const response = await fetch(url, init);
  const body = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { parsed = { message: body.slice(0, 2000) }; }
  if (!response.ok) throw new Error(`QA Lab ${init?.method ?? "GET"} ${new URL(url).pathname} returned HTTP ${response.status}: ${text(record(parsed).message ?? record(parsed).error).slice(0, 1200)}`);
  return record(parsed);
}

async function getWithDependencyWait(url: string, onWaiting?: (reason: string, retryInMs: number) => void): Promise<JsonRecord> {
  let delay = 1000;
  for (;;) {
    try { return await requestJson(url); }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!/HTTP (?:502|503|504)|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(reason)) throw error;
      onWaiting?.(reason, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(30000, Math.round(delay * 1.7));
    }
  }
}

/** Starts a fresh QA Lab Discovery job through the supported rerun API and waits for its own terminal result. */
export async function runDiscoveryRerun(
  task: TaskContract,
  reference: QaLabReference,
  iteration: number,
  onWaiting?: (reason: string, retryInMs: number) => void,
  options: { localRunner?: (reference: QaLabReference, freshId: string) => Promise<JsonRecord> } = {},
): Promise<CodexDiscoveryResult> {
  if (reference.kind !== "discovery-job" || !reference.inputPath || !reference.projectSlug) throw new Error("Discovery tester requires a validated historical job, input artifact, and resolved project.");
  if (!task.qaLabBaseUrl) throw new Error("Discovery tester requires the configured QA Lab API base URL in TaskContract.qaLabBaseUrl.");
  const base = task.qaLabBaseUrl.replace(/\/+$/, "");
  let source: JsonRecord | undefined;
  let current: JsonRecord | undefined;
  let freshId: string | undefined;
  let sourceProject = "";
  try {
    source = await getWithDependencyWait(`${base}/api/runs/${encodeURIComponent(reference.id)}`, onWaiting);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!/HTTP 404\b/i.test(reason)) throw error;
    // The API may have lost its in-memory historical job after a restart. The exact job input,
    // project and command were independently resolved from disk before this actor was dispatched;
    // rerun that allowlisted command into a distinct artifact directory instead of blocking.
    freshId = randomUUID();
    current = await (options.localRunner ?? runLocalValidatedDiscovery)(reference, freshId);
  }
  if (source) {
    sourceProject = text(source.params?.appSlug ?? source.params?.targetAppSlug ?? source.appSlug);
    if (!sourceProject || sourceProject.toLowerCase() !== reference.projectSlug.toLowerCase()) throw new Error(`Historical job project mismatch: expected ${reference.projectSlug}, received ${sourceProject || "unresolved"}.`);
    const started = await requestJson(`${base}/api/runs/${encodeURIComponent(reference.id)}/rerun`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "all" }) });
    freshId = jobId(started);
    if (!freshId || freshId === reference.id) throw new Error(`QA Lab rerun did not return a distinct new job id (source=${reference.id}).`);
    current = started;
    let delay = 500;
    for (;;) {
      const status = text(current.status ?? current.state ?? current.data?.status);
      if (TERMINAL.test(status)) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(5000, Math.round(delay * 1.5));
      current = await getWithDependencyWait(`${base}/api/runs/${encodeURIComponent(freshId)}`, onWaiting);
    }
  }
  if (!current || !freshId) throw new Error("Discovery rerun did not produce a job result.");
  const diskRunDir = path.resolve(process.cwd(), ".artifacts", "scenario-preview-runs", freshId);
  const diskResultPath = path.join(diskRunDir, "results.json");
  let results = record(current.results);
  if (fs.existsSync(diskResultPath)) { try { results = record(JSON.parse(fs.readFileSync(diskResultPath, "utf8"))); } catch { /* Keep API result when local artifact is malformed. */ } }
  const summary = { ...record(results.summary), ...record(current.summary) };
  const resultCases = Array.isArray(results.cases) ? results.cases.map(record) : [];
  const result = resultCases[0] ?? {};
  const appSlug = text(current.params?.appSlug ?? current.params?.targetAppSlug ?? result.appSlug ?? sourceProject);
  if (appSlug.toLowerCase() !== reference.projectSlug.toLowerCase()) throw new Error(`Fresh job project mismatch: expected ${reference.projectSlug}, received ${appSlug || "unresolved"}.`);
  const passed = nonNegative(summary.passed ?? result.passed ?? result.summary?.passed);
  const failed = nonNegative(summary.failed ?? result.failed ?? result.summary?.failed);
  const promotionAllowed = Boolean(result.promotionAllowed ?? summary.promotionAllowed ?? current.promotionAllowed);
  const failedGates = Object.entries(record(summary.failureGroups)).filter(([, count]) => nonNegative(count) > 0).map(([name]) => name);
  const status = /^(completed|success|passed)$/i.test(text(current.status)) && failed === 0 ? "passed" : /blocked|cancel/i.test(text(current.status)) ? "blocked" : "failed";
  const specWritten = Boolean(result.specWritten ?? result.specGeneration?.written ?? result.specGeneration?.status === "passed");
  const automationReady = Boolean(result.automationReady ?? summary.automationReady);
  const succeeded = status === "passed" && promotionAllowed;
  const satisfied = task.successCriteria.filter((criterion) => {
    const checks: boolean[] = [];
    if (/job(id)?|corrida|run fresh|nueva ejecuci[oó]n/i.test(criterion)) checks.push(freshId !== reference.id);
    if (/proyecto|appslug|project/i.test(criterion)) checks.push(appSlug.toLowerCase() === reference.projectSlug!.toLowerCase());
    if (/spec|promoci[oó]n|promot/i.test(criterion)) checks.push(succeeded && specWritten && promotionAllowed);
    if (/auto.?pom|page object|\bpom\b/i.test(criterion)) checks.push(succeeded && automationReady);
    if (/passed|sin fall|exitos|terminan en verde/i.test(criterion)) checks.push(succeeded && failed === 0);
    return checks.length > 0 && checks.every(Boolean);
  });
  const open = task.successCriteria.filter((criterion) => !satisfied.includes(criterion));
  const log = Array.isArray(current.logs) ? current.logs : [];
  const decisive = log.map((line: unknown) => text(line)).filter((line: string) => /first loss|failed|error|promotion|spec generation/i.test(line)).slice(-5);
  decisive.push(...extractScopeCountDiagnostics(log.map((line: unknown) => text(line)).join("\n")));
  if (fs.existsSync(path.join(diskRunDir, "stdout.log"))) {
    try {
      const stdout = fs.readFileSync(path.join(diskRunDir, "stdout.log"), "utf8");
      decisive.push(...extractFunctionalFailureDiagnostics(stdout));
      decisive.push(...extractScopeCountDiagnostics(stdout));
    }
    catch { /* Keep API diagnostics when local stdout cannot be read. */ }
  }
  const runtimeFailure = decisive.find((line) => /structural_authority|action_owner|functional-execution|Promoted .* failed/i.test(line));
  const eligibility = text(result.specEligibilityReason ?? result.specGeneration?.reason ?? result.promotion?.reason);
  const firstLoss = succeeded ? undefined : {
    boundary: text(result.firstLoss?.boundary ?? summary.firstLoss?.boundary) || failedGates[0] || "Discovery/Auto-POM fresh job",
    evidence: redact(`jobId=${freshId}; project=${appSlug}; status=${text(current.status)}; passed=${passed}; failed=${failed}; promotionAllowed=${promotionAllowed}; specEligibilityReason=${eligibility || "unreported"}; ${decisive.join(" | ")}`).slice(0, 4000),
    reason: redact(text(result.errorMessage ?? result.failureReason ?? summary.errorMessage ?? current.errorMessage) || runtimeFailure || eligibility || "Fresh Discovery/Auto-POM job did not satisfy promotion readiness.").slice(0, 2000),
  };
  const localArtifacts = ["job.json", "results.json", "stdout.log", "stderr.log"].map((name) => path.join(diskRunDir, name)).filter((file) => fs.existsSync(file));
  return {
    actor: "CODEX_TESTER", taskId: task.taskId, iteration, sourceJobId: reference.id, jobId: freshId, appSlug,
    status, total: nonNegative(summary.total ?? current.summary?.total), passed, failed, promotionAllowed,
    specWritten, automationReady,
    failedGates, artifacts: [...new Set([...localArtifacts, text(current.artifactsDir), text(result.artifactsDir)].filter(Boolean))], firstLoss,
    successCriteriaSatisfied: satisfied, successCriteriaOpen: open, humanGate: false, externalBlocker: Boolean(current.externalBlocker), sourceChanged: false,
  };
}
