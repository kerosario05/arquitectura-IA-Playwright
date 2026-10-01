import fs from "node:fs";
import path from "node:path";
import { explicitProjectSlugFromUserText, invokeTaskIntake } from "../src/orchestrator/codex-orchestrator-invoker";
import { readQaLabBackendLogContext } from "../src/orchestrator/qa-lab-log-context";
import { readRepositoryCheckpoint } from "../src/orchestrator/repo-checkpoint";
import { parseQaLabReference } from "../src/orchestrator/qa-lab-reference";
import { enrichDiscoveryJobReference, enrichRecordingReference } from "../src/orchestrator/qa-lab-reference-context";
import { normalizeTaskSteps, selectTaskSteps } from "../src/orchestrator/task-steps";
import { explicitRuntimeUrlFromMessage } from "../src/orchestrator/task-contract-input";
import { findLatestFreshPhysicalEvidenceSource, loadState, runOneIteration, saveState, seedFreshPhysicalEvidenceFromTask, stateDir } from "../src/orchestrator/orchestrator-runner";
import type { OrchestratorEvent, TaskContract } from "../src/orchestrator/types";

type Request = { taskId: string; threadId?: string; message: string; builderAgent?: "CLAUDE_BUILDER" | "CODEX_BUILDER" };
const repoRoot = path.resolve(__dirname, "..");
const taskRoot = path.join(repoRoot, ".artifacts", "orchestrator", "tasks");

function emit(type: string, data: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ type, ...data })}\n`);
}

function contextFiles(userText: string): string {
  const docs = readRepositoryCheckpoint(repoRoot);
  const logContext = readQaLabBackendLogContext(repoRoot, {
    projectSlug: explicitProjectSlugFromUserText(userText),
    threadContext: "",
    objective: userText.slice(0, 1600),
    currentFrontier: "task intake",
  });
  return `${docs}\n--- QA LAB BACKEND LOG · diagnostic context only ---\n${logContext}`;
}

function persistEvent(event: OrchestratorEvent): void {
  const file = path.join(stateDir(repoRoot, event.taskId), "events.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}

function redactSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED_TOKEN]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|credential|secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function loadThreadContext(threadId: string, currentMessage: string): { text: string; states: any[] } {
  const root = path.join(repoRoot, ".artifacts", "orchestrator");
  if (!fs.existsSync(root)) return { text: "", states: [] };
  const runs: { state: any; events: OrchestratorEvent[] }[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".trash") continue;
    const stateFile = path.join(root, entry.name, "state.json");
    if (!fs.existsSync(stateFile)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if ((state.task?.conversationThreadId ?? state.task?.taskId) !== threadId) continue;
      const eventsFile = path.join(root, entry.name, "events.jsonl");
      const events = fs.existsSync(eventsFile)
        ? fs.readFileSync(eventsFile, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as OrchestratorEvent]; } catch { return []; } })
        : [];
      runs.push({ state, events });
    } catch { /* Ignore unrelated or legacy malformed task files. */ }
  }
  const eventOrder = (event: OrchestratorEvent) => Date.parse(event.timestamp ?? "") || 0;
  const orderedRuns = [...runs].sort((a, b) => {
    const aAt = Date.parse(a.state.iterations?.at(-1)?.at ?? "") || 0;
    const bAt = Date.parse(b.state.iterations?.at(-1)?.at ?? "") || 0;
    return aAt - bAt;
  });
  const messages = runs.flatMap(({ events }) => events
    .filter((event) => (event.actor === "USER" && event.summary !== currentMessage) || ["DECISION", "REVIEW", "ACTOR_STARTED", "ACTOR_FINISHED", "ACTOR_FAILED", "FALLBACK"].includes(event.type))
    .map((event) => ({ at: eventOrder(event), text: `${event.actor === "USER" ? "USUARIO" : event.actor} · ${event.summary}` })))
    .sort((a, b) => a.at - b.at)
    .map(({ text }) => text);
  const original = runs.find(({ state }) => state.task?.taskId === threadId)?.state ?? orderedRuns[0]?.state;
  const latest = orderedRuns.at(-1)?.state;
  const context = [
    original?.task?.objective ? `Objetivo original: ${original.task.objective}` : "",
    latest?.task?.currentFrontier ? `Última frontera registrada: ${latest.task.currentFrontier}` : "",
    latest ? `Última corrida: status=${latest.status}; taskId=${latest.task.taskId}` : "",
    ...messages.slice(-20),
  ].filter(Boolean).map(redactSecrets).join("\n");
  return { text: context.slice(-16000), states: runs.map(({ state }) => state) };
}

async function main(): Promise<void> {
  const input = await new Promise<string>((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      value += chunk;
      if (value.length > 80 * 1024) reject(new Error("Studio task request exceeds the allowed size."));
    });
    process.stdin.on("end", () => resolve(value));
    process.stdin.on("error", reject);
  });
  const request = JSON.parse(input) as Request;
  if (!/^task-[a-zA-Z0-9-]{1,100}$/.test(request.taskId) || (request.threadId && !/^task-[a-zA-Z0-9-]{1,100}$/.test(request.threadId)) || typeof request.message !== "string" || !request.message.trim() || (request.builderAgent !== undefined && request.builderAgent !== "CLAUDE_BUILDER" && request.builderAgent !== "CODEX_BUILDER")) {
    throw new Error("Invalid Studio task request.");
  }

  const threadId = request.threadId ?? request.taskId;
  const parsedReference = parseQaLabReference(request.message);
  if (!parsedReference) throw new Error("Include exactly one recordingId/recordId or jobId; IDs are classified by their label, not their UUID format.");
  const qaLabReference = parsedReference.kind === "discovery-job"
    ? enrichDiscoveryJobReference(repoRoot, parsedReference)
    : enrichRecordingReference(repoRoot, parsedReference);
  const explicitSlug = explicitProjectSlugFromUserText(request.message);
  if (explicitSlug && qaLabReference.projectSlug && explicitSlug.toLowerCase() !== qaLabReference.projectSlug.toLowerCase()) {
    throw new Error(`Project mismatch: request specifies ${explicitSlug}, but the referenced QA Lab job belongs to ${qaLabReference.projectSlug}. No actor was started.`);
  }
  if (explicitSlug) qaLabReference.projectSlug = explicitSlug;
  if (qaLabReference.kind === "discovery-job" && !qaLabReference.inputPath) {
    throw new Error(`Discovery job ${qaLabReference.id} has no validated preview-scenarios.json in its artifacts; refusing to guess an input file.`);
  }
  const threadHistory = request.threadId ? loadThreadContext(threadId, redactSecrets(request.message.trim())) : { text: "", states: [] };
  const threadContext = threadHistory.text;
  emit("intake_started", { taskId: request.taskId });
  const safeMessage = redactSecrets(request.message.trim());
  const intake = await invokeTaskIntake(repoRoot, safeMessage, `${contextFiles(safeMessage)}\nCHAT_THREAD_CONTEXT (historical only):\n${threadContext || "(new thread)"}`);
  if ("available" in intake) throw new Error(`Orchestrator intake unavailable: ${intake.reason}`);
  if (!intake.draft) throw new Error(`Task intake needs human input: ${intake.missingData.join(", ") || "incomplete task contract"}`);

  const intakeSteps = normalizeTaskSteps((intake.draft as unknown as { steps?: unknown }).steps);
  const referenceSteps = normalizeTaskSteps(qaLabReference.steps);
  const taskSteps = selectTaskSteps(intakeSteps, referenceSteps, qaLabReference.kind === "recording");
  const explicitRuntimeUrl = explicitRuntimeUrlFromMessage(safeMessage);

  const task: TaskContract = {
    taskId: request.taskId,
    ...intake.draft,
    ...(taskSteps.length ? { steps: taskSteps } : {}),
    physicalValidationRequired: qaLabReference.kind === "recording",
    ...(qaLabReference.kind === "recording" ? {
      physicalValidationRequired: true,
      ...(intake.draft.runtimeUrl ? {} : explicitRuntimeUrl ? { runtimeUrl: explicitRuntimeUrl } : qaLabReference.runtimeUrl ? { runtimeUrl: qaLabReference.runtimeUrl } : {}),
    } : {}),
    ...(qaLabReference.projectSlug ? { projectSlug: qaLabReference.projectSlug } : {}),
    builderAgent: request.builderAgent ?? "CLAUDE_BUILDER",
    ...(!intake.draft.qaLabBaseUrl ? { qaLabBaseUrl: process.env.QA_LAB_API_BASE_URL ?? "http://localhost:3001" } : {}),
    qaLabReference,
    conversationThreadId: threadId,
    ...(threadContext ? { threadContext } : {}),
    physicalGreens: [],
    allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"],
  };
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.writeFileSync(path.join(taskRoot, `${task.taskId}.json`), JSON.stringify(task, null, 2), "utf8");
  let state = loadState(repoRoot, task);
  const evidenceSourceTaskId = findLatestFreshPhysicalEvidenceSource(threadHistory.states, task);
  if (evidenceSourceTaskId && state.iterations.length === 0) {
    state = seedFreshPhysicalEvidenceFromTask(repoRoot, state, evidenceSourceTaskId);
    const sourceIteration = state.iterations.find((iteration) => iteration.evidenceSourceTaskId === evidenceSourceTaskId);
    const handoffEvent: OrchestratorEvent = {
      timestamp: new Date().toISOString(),
      taskId: task.taskId,
      iteration: 0,
      actor: "ORCHESTRATOR",
      type: "EVIDENCE_HANDED_OFF",
      summary: "Fresh physical evidence carried forward from the same chat; no new run was implied.",
      metadata: { sourceTaskId: evidenceSourceTaskId, freshRunId: sourceIteration?.codexPhysicalResult?.freshRunId ?? "" },
    };
    persistEvent(handoffEvent);
    emit("orchestrator_event", { event: handoffEvent });
  }
  saveState(repoRoot, state);
  emit("task_created", { taskId: task.taskId, objective: task.objective, qaLabReference: task.qaLabReference, projectSlug: task.projectSlug });

  while (state.status === "RUNNING") {
    state = await runOneIteration(repoRoot, state, {
      dryRun: false,
      useCodexOrchestratorAgent: true,
      onEvent: (event) => {
        persistEvent(event);
        emit("orchestrator_event", { event });
      },
    });
    saveState(repoRoot, state);
  }
  emit("terminal", { taskId: task.taskId, status: state.status });
}

main().catch((error: unknown) => {
  emit("failure", { message: error instanceof Error ? error.message : "Orchestrator worker failed." });
  process.exitCode = 1;
});
