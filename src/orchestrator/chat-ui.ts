import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { explicitProjectSlugFromUserText, invokeTaskIntake, type TaskIntakeDraft } from "./codex-orchestrator-invoker";
import { readQaLabBackendLogContext } from "./qa-lab-log-context";
import { readRepositoryCheckpoint } from "./repo-checkpoint";
import { loadState, runOneIteration, stateDir } from "./orchestrator-runner";
import type { OrchestratorEvent, OrchestratorState, TaskContract } from "./types";

function taskDir(repoRoot: string): string { return path.join(repoRoot, ".artifacts", "orchestrator", "tasks"); }
function contextFiles(repoRoot: string, userText: string): string {
  const docs = readRepositoryCheckpoint(repoRoot);
  const logContext = readQaLabBackendLogContext(repoRoot, {
    projectSlug: explicitProjectSlugFromUserText(userText),
    threadContext: "",
    objective: userText.slice(0, 1600),
    currentFrontier: "task intake",
  });
  return `${docs}\n--- QA LAB BACKEND LOG · diagnostic context only ---\n${logContext}`;
}
function taskId(): string { return `task-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`; }
export function materializeTaskContract(id: string, draft: TaskIntakeDraft): TaskContract {
  return { taskId: id, ...draft, physicalGreens: [], allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"] };
}
function persistEvent(repoRoot: string, event: OrchestratorEvent): void {
  const file = path.join(stateDir(repoRoot, event.taskId), "events.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}
function loadEvents(repoRoot: string, taskId: string): OrchestratorEvent[] {
  const file = path.join(stateDir(repoRoot, taskId), "events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as OrchestratorEvent]; } catch { return []; }
  });
}
function legacyHistory(state: OrchestratorState): string[] {
  return state.iterations.map((iteration) => {
    const lines = [
      `Iteration ${iteration.iteration}`,
      iteration.evidenceKind,
      `→ ${iteration.decision.decision}`,
      `→ ${iteration.decision.nextActor}`,
    ];
    const boundary = iteration.decision.earliestFirstLoss?.boundary;
    if (boundary) lines.push(`First loss: ${boundary}`);
    return lines.join("\n");
  });
}
export function loadHistory(repoRoot: string, state: OrchestratorState): string[] {
  const events = loadEvents(repoRoot, state.task.taskId);
  return events.length
    ? events.map((event) => `Iteration ${event.iteration}\n${summary(event)}`)
    : legacyHistory(state);
}
export function loadActivity(repoRoot: string, state: OrchestratorState): string[] {
  const events = loadEvents(repoRoot, state.task.taskId);
  return events.length ? events.map(summary) : legacyHistory(state);
}
function latestDecision(state: OrchestratorState) { return state.iterations.at(-1)?.decision; }
export function buildFinalTaskSummary(state: OrchestratorState): string | undefined {
  if (state.status === "RUNNING") return undefined;
  const last = state.iterations.at(-1);
  const decision = last?.decision;
  const satisfied = decision?.successCriteriaSatisfied ?? [];
  const satisfiedSet = new Set(satisfied);
  const open = decision?.successCriteriaOpen ?? state.task.successCriteria.filter((criterion) => !satisfiedSet.has(criterion));
  const openSet = new Set(open);
  const lines = [
    "FINAL SUMMARY",
    `TASK: ${state.task.taskId} — ${state.task.objective}`,
    `FINAL STATUS: ${state.status}`,
    "QUÉ OCURRIÓ:",
  ];
  if (state.iterations.length === 0) lines.push("- No hay iteraciones persistidas.");
  else {
    lines.push("- Orchestrator: evaluación determinística registrada.");
    for (const iteration of state.iterations) {
      const result = iteration.claudeResult;
      const physical = iteration.codexPhysicalResult;
      const effectiveActor = iteration.effectiveActor ?? (result?.actor === "CODEX_BUILDER" ? "CODEX_BUILDER" : result ? "CLAUDE_BUILDER" : undefined);
      if (effectiveActor) {
        const requested = iteration.requestedActor ? ` (solicitado: ${iteration.requestedActor})` : "";
        const fallback = iteration.fallbackReason ? `; fallback: ${iteration.fallbackReason}` : "";
        lines.push(`- ${effectiveActor}${requested}${fallback}.`);
      }
      if (result) lines.push(`- Resultado estructurado ${effectiveActor ?? result.actor}: humanGate=${result.result.humanGate}; sourceChanged=${result.result.sourceChanged === undefined ? "not reported" : result.result.sourceChanged}.`);
      if (physical) lines.push(`- CODEX_PHYSICAL: resultado de iteración ${physical.iteration}.`);
    }
  }
  lines.push("CAMBIOS:");
  const builderChanges = state.iterations.flatMap((iteration) => {
    const result = iteration.claudeResult;
    if (!result) return [];
    const actor = iteration.effectiveActor ?? (result.actor === "CODEX_BUILDER" ? "CODEX_BUILDER" : "CLAUDE_BUILDER");
    const files = result.fix.filesChanged;
    return [{ actor, files, changed: result.fix.behaviorChanged || files.length > 0, tests: result.tests }];
  });
  const physicalSourceChange = state.iterations.some((iteration) => iteration.codexPhysicalResult?.sourceChanged);
  if (!builderChanges.some((change) => change.changed) && !physicalSourceChange) lines.push("- No se reportaron cambios de source.");
  for (const change of builderChanges) {
    lines.push(`- ${change.actor}: ${change.changed ? `cambios reportados${change.files.length ? ` en ${change.files.join(", ")}` : ""}` : "sin cambios de source reportados"}; tests: ${change.tests.passed} passed, ${change.tests.failed} failed, ${change.tests.newTypeErrors} nuevos errores de tipos.`);
  }
  if (physicalSourceChange) lines.push("- CODEX_PHYSICAL reportó sourceChanged=true; revisar la guarda de cambios, sin atribuir autoría no persistida.");
  const physicalResults = state.iterations.flatMap((iteration) => iteration.codexPhysicalResult ? [iteration.codexPhysicalResult] : []);
  lines.push("VALIDACIÓN FÍSICA:");
  if (physicalResults.length === 0) lines.push("- No hay resultados físicos persistidos; NO VALIDADO FÍSICAMENTE.");
  for (const result of physicalResults) {
    if (!result.physical.fresh) lines.push("- NO VALIDADO FÍSICAMENTE (fresh=false). ");
    lines.push(`- fresh=${result.physical.fresh}; freshRunId=${result.freshRunId || "(vacío)"}; stepsExpected=${result.physical.stepsExpected}; stepsExecuted=${result.physical.stepsExecuted}; functionalExecution=${result.physical.functionalExecution}; causalOutcomeObserved=${result.physical.causalOutcomeObserved}.`);
  }
  lines.push("SUCCESS CRITERIA:");
  for (const criterion of state.task.successCriteria) lines.push(`${satisfiedSet.has(criterion) && !openSet.has(criterion) ? "✓" : "☐"} ${criterion}`);
  const firstLoss = decision?.earliestFirstLoss;
  const latestEvidence = last?.claudeResult?.firstLoss ?? last?.codexPhysicalResult?.firstLoss;
  lines.push("FIRST LOSS FINAL:");
  if (firstLoss) {
    lines.push(`- boundary: ${firstLoss.boundary}`, `- reason: ${firstLoss.reason}`);
    if (firstLoss.evidence) lines.push(`- evidence: ${firstLoss.evidence}`);
  } else if (latestEvidence) {
    lines.push(`- boundary: ${"file" in latestEvidence ? latestEvidence.file : latestEvidence.boundary}`, `- reason: ${latestEvidence.reason}`);
    if ("artifact" in latestEvidence && latestEvidence.artifact) lines.push(`- evidence: ${latestEvidence.artifact}`);
  } else lines.push("- No hay first loss persistido.");
  const stopDetail = decision?.stopReasonDetail;
  lines.push(`MOTIVO DE DETENCIÓN: ${stopDetail ?? "No se registró detalle adicional."}`);
  const stalePhysical = physicalResults.some((result) => !result.physical.fresh);
  const conclusion = state.status === "SUCCESS"
    ? "Validación completada."
    : state.status === "HUMAN_GATE"
      ? "La tarea requiere intervención antes de continuar."
      : "La tarea está bloqueada por una dependencia externa.";
  lines.push(`CONCLUSIÓN: ${conclusion}`);
  let nextAction: string;
  if (state.status === "SUCCESS" && open.length === 0 && state.task.successCriteria.every((criterion) => satisfiedSet.has(criterion))) {
    nextAction = "No se requiere acción adicional.";
  } else if (state.status === "HUMAN_GATE" && stalePhysical) {
    nextAction = "Obtener una corrida física fresh antes de continuar.";
  } else if (state.status === "EXTERNAL_BLOCKER" && stopDetail) {
    nextAction = `Resolver la dependencia externa indicada: ${stopDetail}`;
  } else if (open.length > 0) {
    nextAction = `Atender los criterios abiertos: ${open.join("; ")}`;
  } else {
    nextAction = stopDetail ? `Resolver la condición indicada: ${stopDetail}` : "Solicitar intervención para definir el siguiente paso.";
  }
  lines.push(`NEXT ACTION: ${nextAction}`);
  return lines.join("\n");
}
function render(repoRoot: string, state: OrchestratorState, activity: string[] = [], summaryText?: string): void {
  const last = state.iterations.at(-1); const decision = latestDecision(state);
  const evidence = last?.claudeResult ?? last?.codexPhysicalResult;
  console.clear();
  console.log("QA LAB ORCHESTRATOR");
  console.log(`Task: ${state.task.taskId}    Status: ${state.status}    Iteration: ${state.iterations.length}`);
  console.log(`Actor: ${last?.effectiveActor ?? decision?.nextActor ?? decision?.actor ?? "ORCHESTRATOR"}    Orchestrator: GPT-6 Luna / Medium`);
  console.log(`Last updated: ${last?.at ?? "not started"}`);
  console.log(`Physical greens: ${state.physicalGreens.join(", ") || "none"}`);
  console.log("\nCURRENT FRONTIER"); console.log(`  ${decision?.earliestFirstLoss?.boundary ?? state.task.currentFrontier}`);
  console.log("\nFIRST LOSS"); console.log(`  ${decision?.earliestFirstLoss?.reason ?? evidence?.firstLoss?.reason ?? "pending evidence"}`);
  console.log("\nSUCCESS CRITERIA");
  const satisfied = new Set(decision?.successCriteriaSatisfied ?? []);
  for (const criterion of state.task.successCriteria) console.log(`  ${satisfied.has(criterion) ? "✓" : "☐"} ${criterion}`);
  console.log("\nACTIVITY"); for (const line of activity.slice(-12)) console.log(`  ${line}`);
  if (summaryText) console.log(`\n${summaryText}`);
  console.log("\n> ");
}
function summary(event: OrchestratorEvent): string { return `${event.actor} ${event.type} · ${event.summary}`; }

const CHAT_COMMANDS = ["/new", "/status", "/history", "/tasks", "/open", "/summary", "/help", "/quit"] as const;
type ChatCommand = typeof CHAT_COMMANDS[number];
type ChatRoute = { kind: "command"; command: ChatCommand; argument?: string } | { kind: "unknown"; suggestion?: ChatCommand } | { kind: "intake" };

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[right.length];
}

export function routeChatInput(input: string): ChatRoute {
  if (!input.startsWith("/")) return { kind: "intake" };
  const open = input.match(/^\/open(?:\s+(.+))?$/);
  if (open) return { kind: "command", command: "/open", ...(open[1] ? { argument: open[1].trim() } : {}) };
  if ((CHAT_COMMANDS as readonly string[]).includes(input)) return { kind: "command", command: input as ChatCommand };
  const closest = CHAT_COMMANDS.map((command) => ({ command, distance: editDistance(input, command) }))
    .sort((a, b) => a.distance - b.distance || a.command.localeCompare(b.command))[0];
  return { kind: "unknown", ...(closest && closest.distance <= 2 ? { suggestion: closest.command } : {}) };
}

export async function runChat(repoRoot: string): Promise<void> {
  let active: OrchestratorState | undefined;
  const activity: string[] = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  const show = () => { if (active) render(repoRoot, active, activity); else console.log("QA LAB ORCHESTRATOR\nEscribe el problema o usa /help"); rl.prompt(); };
  const run = async () => {
    if (!active) return;
    while (active.status === "RUNNING") {
      active = await runOneIteration(repoRoot, active, { dryRun: false, useCodexOrchestratorAgent: true, onEvent: (event) => { activity.push(summary(event)); persistEvent(repoRoot, event); render(repoRoot, active!, activity); } });
      render(repoRoot, active, activity);
    }
    const finalSummary = buildFinalTaskSummary(active);
    if (finalSummary) console.log(`\n${finalSummary}\n`);
    rl.prompt();
  };
  const create = async (description: string) => {
    let intake: Awaited<ReturnType<typeof invokeTaskIntake>>;
    try {
      intake = await invokeTaskIntake(repoRoot, description, contextFiles(repoRoot, description));
    } catch (error) {
      console.error(`INTAKE_ERROR: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if ("available" in intake) { console.log(`HUMAN_GATE: ${intake.available ? "intake unavailable" : intake.reason}`); return; }
    if (!intake.draft) { console.log(`HUMAN_GATE: ${intake.missingData.join(", ")}`); return; }
    const id = taskId();
    const task = materializeTaskContract(id, intake.draft);
    fs.mkdirSync(taskDir(repoRoot), { recursive: true }); fs.writeFileSync(path.join(taskDir(repoRoot), `${id}.json`), JSON.stringify(task, null, 2), "utf8");
    active = loadState(repoRoot, task); activity.length = 0; render(repoRoot, active, activity); await run();
  };
  rl.on("line", async (line) => {
    const input = line.trim();
    try {
      if (!input) return show();
      const route = routeChatInput(input);
      if (route.kind === "unknown") {
        console.log(`Comando desconocido: ${input}`);
        if (route.suggestion) console.log(`¿Quisiste decir ${route.suggestion}?`);
        console.log("Usa /help para ver los comandos disponibles.");
        return show();
      }
      if (route.kind === "intake") return await create(input);
      if (route.command === "/quit") { console.log(active?.status === "RUNNING" ? "Saliendo; el actor hijo no se mata agresivamente." : "Bye"); rl.close(); return; }
      if (route.command === "/help") { console.log(`${CHAT_COMMANDS.slice(0, 4).join(" ")} /open <taskId> /summary ${CHAT_COMMANDS.slice(6).join(" ")}`); return show(); }
      if (route.command === "/new") { active = undefined; console.log("Describe el problema:"); return show(); }
      if (route.command === "/status") return show();
      if (route.command === "/history") { if (active) console.log(loadHistory(repoRoot, active).join("\n\n")); return show(); }
      if (route.command === "/summary") {
        const finalSummary = active ? buildFinalTaskSummary(active) : undefined;
        if (active) render(repoRoot, active, activity, finalSummary ?? "No hay resumen final: la task sigue RUNNING.");
        else console.log("No hay una task terminal abierta para resumir.");
        if (!active) rl.prompt();
        return;
      }
      if (route.command === "/tasks") { for (const file of fs.existsSync(taskDir(repoRoot)) ? fs.readdirSync(taskDir(repoRoot)).filter((f) => f.endsWith(".json")) : []) { const task = JSON.parse(fs.readFileSync(path.join(taskDir(repoRoot), file), "utf8")) as TaskContract; const state = loadState(repoRoot, task); console.log(`${task.taskId} | ${state.status} | ${state.iterations.length}`); } return show(); }
      if (route.command === "/open") { const id = route.argument ?? ""; if (!id) { console.log("Uso: /open <taskId>"); return show(); } const file = path.join(taskDir(repoRoot), `${id}.json`); if (fs.existsSync(file)) { const task = JSON.parse(fs.readFileSync(file, "utf8")) as TaskContract; active = loadState(repoRoot, task); activity.splice(0, activity.length, ...loadActivity(repoRoot, active)); render(repoRoot, active, activity); } else console.log(`Task no encontrada: ${id}`); return show(); }
    } catch (error) { console.error(`HUMAN_GATE: ${error instanceof Error ? error.message : String(error)}`); show(); }
  });
  rl.on("close", () => process.stdout.write("\n"));
  show();
}
