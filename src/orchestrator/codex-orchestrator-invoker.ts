/**
 * CODEX ORCHESTRATOR -- the reasoning/evidence-review agent. NOT the deterministic state
 * machine (that stays in state-machine.ts and remains the final authority: every decision this
 * agent proposes is re-validated by `validateAgentDecision` before anything is invoked). Source
 * read-only: sandbox is always `-s read-only`, never workspace-write/danger-full-access.
 *
 * Reuses the EXISTING `runCodexCli`/`resolveCodexCliPath` primitives (src/agent/codex-cli-*)
 * verbatim -- the same real, already-proven CLI syntax `scripts/codex-qa-verify.ps1` uses
 * (`-m <model>`, `-c model_reasoning_effort=<level>`, `-s <sandbox>`). No new flags invented.
 */
import { runCodexCli } from "../agent/codex-cli-runner";
import { resolveCodexCliPath } from "../agent/codex-cli-resolver";
import type {
  ClaudeResult,
  CodexPhysicalResult,
  CodexDiscoveryResult,
  OrchestratorDecision,
  OrchestratorState,
  TaskContract,
} from "./types";
import { readQaLabBackendLogContext } from "./qa-lab-log-context";
import { readRepositoryCheckpoint } from "./repo-checkpoint";

export const CODEX_ORCHESTRATOR_MODEL = "gpt-6-luna";
export const CODEX_ORCHESTRATOR_EFFORT = "medium";
export const CODEX_ORCHESTRATOR_SANDBOX = "read-only";

export function codexOrchestratorArgs(): string[] {
  return ["-m", CODEX_ORCHESTRATOR_MODEL, "-c", `model_reasoning_effort=${CODEX_ORCHESTRATOR_EFFORT}`, "-s", CODEX_ORCHESTRATOR_SANDBOX, "--skip-git-repo-check"];
}

export function buildOrchestratorReviewRunnerInput(command: string, repoRoot: string, prompt: string, timeoutMs?: number) {
  return {
    command,
    extraArgs: codexOrchestratorArgs(),
    prompt,
    promptAsStdin: true as const,
    cwd: repoRoot,
    timeoutMs,
    taskType: "unknown" as const,
    purpose: "qa_lab_orchestrator_review",
  };
}

export function buildTaskIntakeRunnerInput(command: string, repoRoot: string, userText: string, context: string, timeoutMs?: number) {
  return {
    command,
    extraArgs: codexOrchestratorArgs(),
    prompt: buildTaskIntakePrompt(userText, context),
    promptAsStdin: true as const,
    cwd: repoRoot,
    timeoutMs,
    taskType: "unknown" as const,
    purpose: "qa_lab_task_intake",
  };
}

export type TaskIntakeDraft = Pick<TaskContract, "objective" | "successCriteria" | "physicalValidationRequired" | "currentFrontier"> & Pick<TaskContract, "steps" | "qaLabBaseUrl" | "runtimeUrl" | "projectSlug">;

export function buildTaskIntakePrompt(userText: string, context: string): string {
  return [
    "Eres CODEX ORCHESTRATOR en modo TASK INTAKE. Fuente READ-ONLY; no edites archivos.",
    "Convierte la descripcion natural en un borrador de TaskContract para el Orchestrator existente.",
    "No inventes URLs, casos, locators, IDs, datos funcionales ni resultados. Usa criterios verificables y genericos.",
    "El ciclo se clasifica por la etiqueta explícita de la solicitud: recordingId/recordId = Recording; jobId = Discovery/Auto-POM. El ID es contexto histórico; el test posterior debe crear un run nuevo.",
    "Copia únicamente los pasos físicos ordenados, qaLabBaseUrl, projectSlug y runtimeUrl cuando estén explícitos en la solicitud/configuración del proyecto; no inventes esos valores. Si la solicitud contiene projectSlug explícito, ese valor prevalece sobre cualquier nombre de proyecto citado dentro del prompt o de evidencia histórica. Si faltan, devuelve steps=[], qaLabBaseUrl=., projectSlug=. y runtimeUrl=.",
    "Si falta informacion indispensable para un criterio verificable, indica HUMAN_GATE en missingData.",
    "Responde solo con estas lineas:",
    "objective=",
    "physicalValidationRequired=true|false",
    "currentFrontier=",
    "successCriteria=[criterio 1, criterio 2]",
    "steps=[paso 1, paso 2]",
    "qaLabBaseUrl=",
    "projectSlug=",
    "runtimeUrl=",
    "missingData=[]",
    "USER_DESCRIPTION:", userText,
    "REPOSITORY_CONTEXT:", context,
  ].join("\n");
}

function parseIntakeList(text: string, fieldName: string): string[] {
  const match = text.match(new RegExp(`^${fieldName}=\\[(.*)\\]$`, "mi"));
  if (!match) return [];
  return match[1].split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseTaskIntake(text: string): { draft?: TaskIntakeDraft; missingData: string[] } {
  const line = (name: string) => text.match(new RegExp(`^${name}=(.*)$`, "mi"))?.[1]?.trim() ?? "";
  const missingRaw = text.match(/^missingData=\[(.*)\]$/mi)?.[1] ?? "";
  const missingData = missingRaw.split(",").map((item) => item.trim()).filter(Boolean);
  const objective = line("objective");
  const currentFrontier = line("currentFrontier");
  const successCriteria = parseIntakeList(text, "successCriteria");
  const steps = parseIntakeList(text, "steps");
  const qaLabBaseUrl = line("qaLabBaseUrl");
  const projectSlug = line("projectSlug");
  const runtimeUrl = line("runtimeUrl");
  if (!objective || !currentFrontier || successCriteria.length === 0) return { missingData: [...missingData, "complete TaskContract fields"] };
  return { draft: { objective, currentFrontier, successCriteria, physicalValidationRequired: line("physicalValidationRequired") !== "false", ...(steps.length ? { steps } : {}), ...(qaLabBaseUrl && qaLabBaseUrl !== "." ? { qaLabBaseUrl } : {}), ...(projectSlug && projectSlug !== "." ? { projectSlug } : {}), ...(runtimeUrl && runtimeUrl !== "." ? { runtimeUrl } : {}) }, missingData };
}

export function explicitProjectSlugFromUserText(text: string): string | undefined {
  const matches = [...text.matchAll(/["']?projectSlug["']?\s*[:=]\s*["']?([a-z0-9][a-z0-9_-]*)/gi)];
  return matches.at(-1)?.[1]?.toLowerCase();
}

export async function invokeTaskIntake(repoRoot: string, userText: string, context: string, timeoutMs?: number): Promise<{ draft?: TaskIntakeDraft; missingData: string[] } | CodexOrchestratorAvailability> {
  const availability = await resolveCodexOrchestratorCommand(repoRoot);
  if (!availability.available) return availability;
  const result = await runCodexCli(buildTaskIntakeRunnerInput(availability.command, repoRoot, userText, context, timeoutMs));
  const parsed = parseTaskIntake(result.stdout);
  const explicitProjectSlug = explicitProjectSlugFromUserText(userText);
  if (parsed.draft && explicitProjectSlug) parsed.draft.projectSlug = explicitProjectSlug;
  return parsed;
}

export type CodexOrchestratorProposal = {
  decision: OrchestratorDecision["decision"];
  earliestFirstLoss?: { boundary: string; evidence: string; reason: string };
  physicalGreensPreserved: string[];
  successCriteriaSatisfied: string[];
  successCriteriaOpen: string[];
  nextActor?: OrchestratorDecision["nextActor"];
  claudeEffort?: string;
  claudeEffortReason?: string;
  requiredSkills?: string[];
  requiredPlugins?: string[];
  contextStrategy?: string;
  /** Present only when decision=CALL_CLAUDE -- the agent's own critical prompt draft. */
  claudePromptDraft?: string;
};

function field(text: string, name: string): string | undefined {
  const match = text.match(new RegExp(`^${name}=(.*)$`, "mi"));
  return match ? match[1].trim() : undefined;
}

function listField(text: string, name: string): string[] {
  const raw = field(text, name);
  if (!raw) return [];
  const inner = raw.replace(/^\[|\]$/g, "").trim();
  if (!inner) return [];
  return inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** Builds the evidence-review prompt sent to the Codex Orchestrator agent. Contains the FULL
 * task/state/evidence context it needs to reason critically -- never asks it to invent evidence. */
export function buildOrchestratorReviewPrompt(
  state: OrchestratorState,
  evidence: ClaudeResult | CodexPhysicalResult | CodexDiscoveryResult | undefined,
  qaLabLogContext = "(no disponible)",
  repoRoot = process.cwd(),
): string {
  const task = state.task;
  const lines: string[] = [];
  lines.push("Eres el CODEX ORCHESTRATOR: agente de razonamiento critico/evaluacion de evidencia.");
  lines.push("NO eres el guardrail final -- una state machine determinista revalida tu decision.");
  lines.push("Fuente READ-ONLY: nunca edites, ni propongas editar, ningun archivo.");
  lines.push("");
  lines.push(`taskId=${task.taskId}`);
  lines.push(`objective=${task.objective}`);
  lines.push(`successCriteria=${JSON.stringify(task.successCriteria)}`);
  lines.push(`physicalValidationRequired=${task.physicalValidationRequired}`);
  lines.push(`physicalGreens=${JSON.stringify(state.physicalGreens)}`);
  lines.push(`lastFirstLossSignature=${state.lastFirstLossSignature ?? "(none)"}`);
  lines.push(`lastFirstLossRepeatCount=${state.lastFirstLossRepeatCount}`);
  lines.push(`noProgressLimit=${task.noProgressLimit ?? 3}`);
  lines.push("");
  lines.push("CHECKPOINT AUTORITATIVO (documentos completos; aplicar antes de decidir/delegar):");
  lines.push(readRepositoryCheckpoint(repoRoot));
  if (task.threadContext) {
    lines.push("HISTORIAL DEL HILO (contexto histórico, no sustituye evidencia estructurada fresca):");
    lines.push(task.threadContext);
  }
  lines.push("");
  lines.push("EVIDENCIA MAS RECIENTE (unica autoridad -- no asumas nada fuera de esto):");
  lines.push(evidence ? JSON.stringify(evidence, null, 2) : "(ninguna -- primera iteracion)");
  lines.push("");
  lines.push("QA LAB BACKEND LOG (contexto diagnóstico reciente; no es evidencia fresh ni reemplaza el resultado estructurado):");
  lines.push(qaLabLogContext);
  lines.push("");
  lines.push("REGLAS DE EVALUACION CRITICA (obligatorias):");
  lines.push("- tests GREEN o readyForPhysicalReplay=true de Claude NUNCA es SUCCESS si physicalValidationRequired=true.");
  lines.push("- Un CodexPhysicalResult con physical.fresh=false NUNCA satisface un criterio fisico.");
  lines.push("- Un boundary ya listado en physicalGreens NUNCA se reabre sin evidencia CONTRADICTORIA en la evidencia mas reciente.");
  lines.push("- Si Claude declara resolver una condicion (ej. un atributo DOM) pero su propio fix/tests no la cubren, es una CONTRADICCION: senalarla, no aceptarla.");
  lines.push("- humanGate=true de Claude es una solicitud de revision, no una decision terminal automatica: contrasta first-loss, TaskContract, historial/artifacts y QA LAB BACKEND LOG; decide si hay un siguiente paso acotado (CALL_CLAUDE/CALL_CODEX_PHYSICAL), un bloqueo externo demostrado, o intervencion humana realmente indispensable.");
  lines.push("- Nunca descartes un HUMAN_GATE por conveniencia: si no puedes justificar con evidencia un siguiente paso seguro, conserva HUMAN_GATE y explica qué decisión/input humano falta. Nunca aceptes SUCCESS desde un Claude HUMAN_GATE.");
  lines.push("- No inventes locators, credenciales, identidad de proyecto ni evidencia fresh; logs/historial solo son contexto diagnóstico. Source-change guard y HUMAN_GATE de CODEX_PHYSICAL no se pueden anular.");
  lines.push("- Nunca proponer SUCCESS con successCriteriaOpen no vacio.");
  lines.push("- Para una referencia discovery-job, el tester corre el rerun QA Lab y devuelve evidencia estructurada; nunca lo confundas con una recording física.");
  lines.push("- Nunca proponer invocar dos actores en el mismo paso.");
  lines.push("- Exactamente UN earliest first-loss por decision.");
  lines.push("");
  lines.push("POLITICA DE EFFORT PARA CLAUDE BUILDER (solo aplica si decision=CALL_CLAUDE):");
  lines.push("- Claude Builder SIEMPRE se invoca con claudeEffort=medium.");
  lines.push("- La decision de effort no se escala ni se reduce segun la tarea.");
  lines.push("- Nunca proponer high/xhigh/max.");
  lines.push("");
  lines.push("Responde EXCLUSIVAMENTE con este contrato (una linea por campo, sin prosa adicional):");
  lines.push("decision=CALL_CLAUDE|CALL_CODEX_PHYSICAL|CALL_CODEX_TESTER|SUCCESS|HUMAN_GATE|EXTERNAL_BLOCKER");
  lines.push("earliestFirstLossBoundary=");
  lines.push("earliestFirstLossEvidence=");
  lines.push("earliestFirstLossReason=");
  lines.push("physicalGreensPreserved=[]");
  lines.push("successCriteriaSatisfied=[]");
  lines.push("successCriteriaOpen=[]");
  lines.push("nextActor=CLAUDE_BUILDER|CODEX_PHYSICAL|CODEX_TESTER|(none)");
  lines.push("claudeEffort=medium (si decision=CALL_CLAUDE; politica fija)");
  lines.push("requiredSkills=[qa-lab-low-token-debug, ponytail, caveman] (default -- solo agrega otra si la tarea REALMENTE la necesita, nunca irrelevante)");
  lines.push("requiredPlugins=[] (vacio salvo necesidad real)");
  lines.push("contextStrategy=(una linea: checkpoint-first, artifact paths, no logs completos, 1 first-loss)");
  lines.push("Si decision=CALL_CLAUDE, agrega despues una seccion:");
  lines.push("CLAUDE_PROMPT_START");
  lines.push("(el prompt critico completo: skill headers, REPO AUTORITATIVO, TAREA UNICA, FRESH EVIDENCE,");
  lines.push("FIRST LOSS, WHY EARLIEST, NO REABRIR, OBJETIVO, INVARIANTES, ALLOWED MICROFIX, NO-TOUCH,");
  lines.push("PROHIBIDO, TESTS, PHYSICAL GATE, OUTPUT CONTRACT, STOP)");
  lines.push("CLAUDE_PROMPT_END");
  return lines.join("\n");
}

export function parseOrchestratorProposal(text: string): CodexOrchestratorProposal {
  const decisionRaw = field(text, "decision") ?? "HUMAN_GATE";
  const validDecisions: OrchestratorDecision["decision"][] = ["CALL_CLAUDE", "CALL_CODEX_PHYSICAL", "CALL_CODEX_TESTER", "SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"];
  const decision = (validDecisions as string[]).includes(decisionRaw) ? (decisionRaw as OrchestratorDecision["decision"]) : "HUMAN_GATE";
  const boundary = field(text, "earliestFirstLossBoundary");
  const promptMatch = text.match(/CLAUDE_PROMPT_START\n([\s\S]*?)\nCLAUDE_PROMPT_END/);
  const nextActorRaw = field(text, "nextActor");
  return {
    decision,
    earliestFirstLoss: boundary
      ? { boundary, evidence: field(text, "earliestFirstLossEvidence") ?? "", reason: field(text, "earliestFirstLossReason") ?? "" }
      : undefined,
    physicalGreensPreserved: listField(text, "physicalGreensPreserved"),
    successCriteriaSatisfied: listField(text, "successCriteriaSatisfied"),
    successCriteriaOpen: listField(text, "successCriteriaOpen"),
    nextActor: nextActorRaw === "CLAUDE_BUILDER" || nextActorRaw === "CODEX_PHYSICAL" || nextActorRaw === "CODEX_TESTER" ? nextActorRaw : undefined,
    claudeEffort: field(text, "claudeEffort"),
    requiredSkills: listField(text, "requiredSkills"),
    requiredPlugins: listField(text, "requiredPlugins"),
    contextStrategy: field(text, "contextStrategy"),
    claudeEffortReason: field(text, "claudeEffortReason"),
    claudePromptDraft: promptMatch ? promptMatch[1] : undefined,
  };
}

export type CodexOrchestratorAvailability =
  | { available: true; command: string }
  | { available: false; reason: string };

export async function resolveCodexOrchestratorCommand(cwd: string): Promise<CodexOrchestratorAvailability> {
  const resolution = await resolveCodexCliPath({ cwd });
  if (!resolution.found) {
    return { available: false, reason: resolution.message };
  }
  return { available: true, command: resolution.command };
}

/** Invokes the Codex Orchestrator agent for one evaluation. Source READ-ONLY (`-s read-only`),
 * model/effort fixed by the current policy. */
export async function invokeCodexOrchestrator(
  repoRoot: string,
  state: OrchestratorState,
  evidence: ClaudeResult | CodexPhysicalResult | CodexDiscoveryResult | undefined,
  timeoutMs?: number,
): Promise<{ proposal: CodexOrchestratorProposal; rawStdout: string } | CodexOrchestratorAvailability> {
  const availability = await resolveCodexOrchestratorCommand(repoRoot);
  if (!availability.available) return availability;
  const prompt = buildOrchestratorReviewPrompt(state, evidence, readQaLabBackendLogContext(repoRoot, state.task), repoRoot);
  const result = await runCodexCli(buildOrchestratorReviewRunnerInput(availability.command, repoRoot, prompt, timeoutMs));
  return { proposal: parseOrchestratorProposal(result.stdout), rawStdout: result.stdout };
}
