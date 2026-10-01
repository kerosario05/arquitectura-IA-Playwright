/**
 * Generates the CRITICAL BOUNDED PROMPT the Orchestrator sends to Claude Builder, and the
 * compact physical-verification prompt it sends to Codex Physical (via scripts/codex-qa-verify.ps1's
 * own -Prompt parameter). Never invents CLI flags, never fabricates evidence -- every field comes
 * from the task contract or the Orchestrator's own decision.
 */
import type { CodexPhysicalResult, OrchestratorDecision, TaskContract } from "./types";
import { BUILDER_RESULT_JSON_SCHEMA } from "./result-parser";
import { ORCHESTRATOR_CHECKPOINT_FILES, readRepositoryCheckpoint } from "./repo-checkpoint";
import path from "node:path";

// Code-shaped forbidden AUTHORITY patterns only -- never plain prohibition prose (this file's own
// template legitimately says "sin nth/first/last/index" and "sin hardcodes" as instructions, which
// must never trip this guard; only an actual injected usage like `nth(3)`/`sleep(2000)` should).
const FORBIDDEN_HINTS = [/\bnth\(/i, /\.first\(\)/i, /\.last\(\)/i, /\bsleep\(\d/i, /\bwaitForTimeout\(/i];

export function buildClaudePrompt(
  task: TaskContract,
  decision: OrchestratorDecision,
  repoRoot: string,
  physicalEvidence?: CodexPhysicalResult,
): string {
  const firstLoss = decision.earliestFirstLoss;
  const lines: string[] = [];
  // Skill/plugin headers: compression mechanism -- invoke by reference, never repeat the skill's
  // own full rule text inline. requiredSkills defaults to the QA Lab trio (set by
  // validateAgentDecision); "ponytail"/"caveman" map to their own slash-invocation form.
  const skills = decision.requiredSkills && decision.requiredSkills.length > 0
    ? decision.requiredSkills
    : ["qa-lab-low-token-debug", "ponytail", "caveman"];
  for (const skill of skills) {
    if (skill === "qa-lab-low-token-debug") lines.push("$qa-lab-low-token-debug");
    else if (skill === "ponytail") lines.push("/ponytail:ponytail full");
    else if (skill === "caveman") lines.push("/caveman:caveman full");
    else lines.push(`/${skill}`);
  }
  for (const plugin of decision.requiredPlugins ?? []) lines.push(`(plugin: ${plugin})`);
  lines.push("");
  lines.push("REPO AUTORITATIVO:");
  lines.push(repoRoot);
  lines.push("");
  lines.push("CHECKPOINT AUTORITATIVO (contenido completo cargado; leer antes de actuar):");
  lines.push(ORCHESTRATOR_CHECKPOINT_FILES.join(", "));
  lines.push(readRepositoryCheckpoint(repoRoot));
  lines.push("");
  lines.push("TAREA UNICA:");
  lines.push(task.objective);
  if (task.qaLabReference) {
    lines.push("");
    lines.push("CICLO QA LAB SELECCIONADO POR EL ID EXPLÍCITO:");
    lines.push(`kind=${task.qaLabReference.kind}`);
    lines.push(`historicalReferenceId=${task.qaLabReference.id}`);
    lines.push(`projectSlug=${task.qaLabReference.projectSlug ?? task.projectSlug ?? "(resolver desde artifacts/logs y validar; no inferir)"}`);
    lines.push(task.qaLabReference.kind === "discovery-job"
      ? "Este job histórico es contexto. La validación posterior al fix debe lanzar un job Discovery/Auto-POM nuevo con su input validado. No lo trates como Recording ni como evidencia fresh."
      : "Esta recording es contexto. La validación posterior al fix debe crear una recording nueva en la sesión WebSessionRecorder-owned; nunca reutilizarla como evidencia fresh.");
  }
  if (task.threadContext) {
    lines.push("");
    lines.push("CONTEXTO HISTÓRICO DEL CHAT (solo contexto; no es evidencia nueva ni autoridad física):");
    lines.push(task.threadContext);
  }
  lines.push("");
  lines.push("EVIDENCIA FISICA:");
  lines.push(firstLoss ? `${firstLoss.evidence}` : "(ninguna evidencia física previa -- primera iteración)");
  if (physicalEvidence) {
    lines.push(`fresh=${physicalEvidence.physical.fresh}`);
    lines.push(`freshRunId=${physicalEvidence.freshRunId || "(missing)"}`);
    lines.push(`stepsExpected=${physicalEvidence.physical.stepsExpected}`);
    lines.push(`stepsExecuted=${physicalEvidence.physical.stepsExecuted}`);
    if (physicalEvidence.physical.fresh && task.qaLabReference?.kind === "recording" && physicalEvidence.freshRunId) {
      const projectSlug = task.projectSlug ?? task.qaLabReference.projectSlug;
      if (projectSlug) {
        const recordingId = physicalEvidence.recordingId ?? physicalEvidence.freshRunId;
        const artifactRoot = path.join(repoRoot, "automations", "apps", projectSlug, "recordings", recordingId);
        lines.push("ARTIFACTS DE ESTA FRESH RUN (rutas derivadas de projectSlug y freshRunId; verifica existencia antes de leer):");
        for (const name of ["trace.json", "semantic-recording.json", "scenarios.json"]) {
          lines.push(`- ${path.join(artifactRoot, name)}`);
        }
        lines.push(`- ${path.join(repoRoot, "qalab-backend.log")} (log compartido; verifica que su timestamp cubra esta corrida)`);
      }
    }
    if (physicalEvidence.firstLoss) {
      lines.push(`physicalFirstLoss=${physicalEvidence.firstLoss.boundary}`);
      lines.push(`physicalEvidence=${physicalEvidence.firstLoss.artifact}`);
      lines.push(`physicalReason=${physicalEvidence.firstLoss.reason}`);
    }
  }
  lines.push("");
  lines.push("FIRST LOSS:");
  lines.push(`file=${firstLoss?.boundary ?? task.currentFrontier}`);
  lines.push("function=(determinar mediante evidencia, no asumir)");
  lines.push(`condition=${firstLoss?.evidence ?? task.currentFrontier}`);
  lines.push(`reason=${firstLoss?.reason ?? "ver objetivo"}`);
  lines.push("");
  lines.push("NO REABRIR:");
  for (const green of decision.physicalGreensPreserved) lines.push(`- ${green}`);
  if (decision.physicalGreensPreserved.length === 0) lines.push("(ninguno registrado aun)");
  lines.push("");
  lines.push("OBJETIVO:");
  lines.push(task.objective);
  lines.push("");
  lines.push("CRITERIOS DE ÉXITO:");
  for (const criterion of task.successCriteria) lines.push(`- ${criterion}`);
  lines.push("");
  lines.push("INVARIANTES / ALCANCE / PROHIBIDO:");
  lines.push("Aplica el first-loss único, CORE multiproyecto, no hardcodes, no nth/first/last/index/coordenadas, no sleeps fijos y preserva PHYSICAL GREEN.");
  lines.push("LÍMITE DE ROLES: Builder solo modifica source y hace pruebas focales; nunca conduce QA Lab físico. La restricción de ejecución física manual no aplica al actor CODEX_PHYSICAL delegado por el Orchestrator: ese actor debe ejecutar el fresh run cuando el routing lo solicite.");
  lines.push("EXTERNAL_BLOCKER solo significa dependencia externa actualmente comprobada e imposible de resolver por source. Falta de logs/artifacts diagnósticos NO es external blocker si CODEX_PHYSICAL puede producirlos; deja sourceChanged=false y solicita esa siguiente acción mediante readyForPhysicalReplay=true, sin detener el ciclo.");
  lines.push("Mantén el cambio mínimo (2-3 búsquedas, ~5-6 archivos) y detente tras el first-loss probado.");
  lines.push("");
  lines.push("TESTS FOCALES:");
  lines.push("- ejecutar pruebas focalizadas del boundary tocado");
  lines.push("- ejecutar typecheck; comparar contra baseline preexistente, nunca aceptar nuevos errores");
  lines.push("- reiniciar backend y confirmar /health real si el cambio toca runtime");
  lines.push("");
  lines.push("PHYSICAL GATE:");
  lines.push(task.qaLabReference?.kind === "discovery-job"
    ? "DISCOVERY/AUTO-POM GATE: el Orchestrator entregará el input validado a Codex Tester mediante el rerun soportado por QA Lab; no uses CODEX_PHYSICAL ni una recording para validar este ciclo."
    : task.physicalValidationRequired
    ? "readyForPhysicalReplay=true NO es SUCCESS. El Orchestrator delega la prueba fisica a Codex Physical despues de este ticket."
    : "Esta tarea no requiere validacion fisica; successCriteriaSatisfied decide el cierre.");
  lines.push("");
  lines.push("SALIDA: devuelve únicamente un objeto JSON válido conforme al schema compartido; no uses Markdown ni prosa adicional.");
  lines.push(`SCHEMA CANÓNICO:\n${JSON.stringify(BUILDER_RESULT_JSON_SCHEMA)}`);
  lines.push(`actor debe identificar al Builder que responde (CLAUDE primario o CODEX_BUILDER si se activa el fallback); taskId=${task.taskId}; iteration=${decision.iteration}. Reporta todos los campos requeridos, sin omitir ni inventar valores.`);
  lines.push("");
  lines.push("STOP.");
  return lines.join("\n");
}

/** Compact prompt content for scripts/codex-qa-verify.ps1's own -Prompt parameter -- never the
 * full ticket, per that script's own documented contract (compact task description only). */
export function buildCodexPhysicalPrompt(task: TaskContract, decision: OrchestratorDecision, repoRoot: string): string {
  const firstLoss = decision.earliestFirstLoss;
  const parts: string[] = [];
  parts.push(`Tarea: ${task.objective}`);
  if (task.qaLabReference) parts.push(`Ciclo solicitado=${task.qaLabReference.kind}; ID histórico=${task.qaLabReference.id}. No reutilizarlo como evidencia fresh.`);
  parts.push(`CHECKPOINT AUTORITATIVO (antes de actuar, lee completos estos archivos desde ${repoRoot}; no dependas solo del resumen del prompt): ${ORCHESTRATOR_CHECKPOINT_FILES.join(", ")}`);
  parts.push(`QA Lab base URL: ${task.qaLabBaseUrl ?? "(no configurada en TaskContract)"}`);
  parts.push(`QA Lab projectSlug: ${task.projectSlug ?? "(no configurado en TaskContract)"}`);
  parts.push(`Runtime URL: ${task.runtimeUrl ?? "(no configurada en TaskContract)"}`);
  if (task.steps && task.steps.length > 0) parts.push(`Pasos físicos en orden exacto (JSON): ${JSON.stringify(task.steps)}`);
  parts.push("Ya estás ejecutando dentro del wrapper scripts/codex-qa-verify.ps1: no lo invoques de nuevo ni arranques otra instancia de Codex CLI. Conduce esta corrida directamente por la autoridad de QA Lab soportada sobre la sesión recorder-owned.");
  parts.push("Usa exclusivamente la frontera frontend QA Lab indicada; al crear una recording nueva pasa el projectSlug explícito a POST /api/recordings/start y conduce los pasos sobre la sesión/página propiedad del WebSessionRecorder mediante su API de control soportada. No infieras projectSlug desde appSlug/recordingId, no abras un runtime URL en un browser independiente ni contactes el backend runtime directamente.");
  parts.push("Reporta stepsExpected igual al número de pasos del contrato y stepsExecuted solo por pasos realmente ejecutados; no rellenes valores ausentes.");
  const authorityCriteria = [task.objective, task.currentFrontier, ...task.successCriteria].join("\n");
  if (/candidateTargets|technical authority|autoridad técnica|stable identifier|identificador estable|\brole\b/i.test(authorityCriteria)) {
    parts.push("Después de completar los pasos físicos, detén y deriva ESTA misma recording usando POST /api/recordings/:recordingId/stop y POST /api/recordings/:recordingId/derive; lee GET /api/recordings/:recordingId/scenarios. Inspecciona en el escenario derivado los candidateTargets, role y/o identificador técnico de las acciones pedidas por el contrato. Reporta solo valores presentes en ese artefacto y paths/líneas decisivas; si faltan, registra ese boundary como first-loss. Esta inspección posterior no añade navegación ni altera stepsExpected/stepsExecuted.");
  }
  parts.push(`Frontera a verificar: ${firstLoss?.boundary ?? task.currentFrontier}`);
  if (firstLoss?.reason) parts.push(`Motivo: ${firstLoss.reason}`);
  parts.push("Ejecuta un fresh run, nunca reutilices un job anterior. Reporta jobId, estado terminal, primer-loss y evidencia decisiva.");
  return parts.join(" ");
}

/** Fail-closed guard: never let a generated prompt smuggle a forbidden authority. Returns the
 * list of forbidden substrings found (empty = clean). */
export function findForbiddenHints(promptText: string): string[] {
  // Repository instructions are policy/reference material and may mention forbidden APIs in
  // prose/examples. Scan task/evidence text for injected authority, not the trusted checkpoint.
  const taskPayload = promptText.replace(
    /CHECKPOINT AUTORITATIVO \(contenido completo cargado; leer antes de actuar\):[\s\S]*?(?=\nTAREA UNICA:)/,
    "CHECKPOINT AUTORITATIVO [trusted repository policy omitted from executable-hint scan]",
  ).replace(
    /CONTEXTO HISTÓRICO DEL CHAT \(solo contexto; no es evidencia nueva ni autoridad física\):[\s\S]*?(?=\nEVIDENCIA FISICA:)/,
    "CONTEXTO HISTÓRICO DEL CHAT [historical reference omitted from executable-hint scan]",
  );
  return FORBIDDEN_HINTS.filter((pattern) => pattern.test(taskPayload)).map((pattern) => pattern.source);
}
