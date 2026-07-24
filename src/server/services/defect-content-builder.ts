/**
 * Shared defect content builders (title, description, severity) used by BOTH the web
 * scenario-preview pipeline and the mobile launch-execution pipeline, so a failed case
 * produces the same specific, non-generic defect regardless of platform.
 *
 * Pure functions — no I/O beyond diagnostic console.log. Extracted from
 * scenario-preview-runner.ts to keep web and mobile defect content consistent.
 */

export type DefectSeverity = "low" | "medium" | "high" | "critical";

export function sanitizeRawError(raw?: string): string {
  if (!raw) return "";

  // 1. Strip ANSI escape codes
  let s = raw
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

  // 2. Redact Bearer tokens first (before generic "authorization" key matching)
  s = s.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");

  // 3. Redact secrets (case-insensitive patterns with common delimiters)
  const secretKeys = [
    "password", "passwd", "pwd",
    "token", "access_token", "refresh_token", "api_key", "apikey", "api-key",
    "authorization", "auth",
    "cookie", "set-cookie",
    "otp", "otp_secret", "otpsecret",
    "client_secret", "clientsecret", "client-secret",
    "secret", "private_key", "privatekey",
  ];
  for (const key of secretKeys) {
    s = s.replace(
      new RegExp(`(${key})\\s*[:=]\\s*(["\\\']?)(?:Bearer\\s+)?\\S+\\2`, "gi"),
      (_m, p1) => `${p1}=[REDACTED]`
    );
    s = s.replace(
      new RegExp(`"(${key})"\\s*:\\s*"[^"]*"`, "gi"),
      (_m, p1) => `"${p1}":"[REDACTED]"`
    );
  }

  // 4. Sanitize paths
  s = s.replace(/[A-Za-z]:\\[^\s,;]*?([^\\\s,;]+\.\w{2,5})/g, "[LOCAL_PATH]\\$1");
  s = s.replace(/\.artifacts[\\/\S]*?([^\\/\s,;]+\.\w{2,5})/g, "[ARTIFACT_PATH]\\$1");

  // 5. Normalize whitespace
  s = s.replace(/\s+/g, " ").trim();

  // 6. Truncate
  const maxLen = 500;
  if (s.length > maxLen) s = s.slice(0, maxLen) + "...";

  return s;
}

export function mapReasonCodeToHuman(reasonCode?: string, rawError?: string): string {
  if (!reasonCode && !rawError) return "";
  const code = (reasonCode ?? "").toLowerCase();
  if (code.includes("assertion_not_found") || code.includes("assertion") && !code.includes("assertion")) {
    return "La validación esperada no fue encontrada en la pantalla.";
  }
  if (code.includes("target_not_found") || code.includes("element_not_found") || code.includes("locator_resolution_failed")) {
    return "No se encontró el elemento necesario para continuar la ejecución.";
  }
  if (code.includes("timeout") || code.includes("navigation_timeout")) {
    return "La navegación o acción esperada no completó dentro del tiempo límite.";
  }
  if (code.includes("auth_failed") || code.includes("auth_flow") || code.includes("authentication")) {
    return "La autenticación no alcanzó el estado final esperado.";
  }
  if (code.includes("execution_exception") || code.includes("net::err_") || code.includes("page.goto")) {
    const err = sanitizeRawError(rawError);
    return err || "La aplicación no respondió al intentar ejecutar la prueba.";
  }
  if (code.includes("detail_evidence") || code.includes("detail_screenshot")) {
    return "No se obtuvo la evidencia requerida para validar la pantalla de detalle.";
  }
  if (code.includes("ambiguous_target")) {
    return "Se encontraron múltiples opciones coincidentes y no fue posible determinar la correcta.";
  }
  if (code) {
    return `La ejecución falló con código: ${code}`;
  }
  const sanitized = sanitizeRawError(rawError);
  return sanitized || "La ejecución automatizada no pudo completarse correctamente.";
}

export function formatTestRailId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("C") && trimmed.length > 1 && /^\d+$/.test(trimmed.slice(1)) ? trimmed : `C${trimmed}`;
}

export function buildLegacyDefectDescription(scenarioTitle: string, failureReason?: string): string {
  const reason = (failureReason ?? "").toLowerCase();
  let problem = "El escenario falló durante la ejecución automatizada y requiere revisión.";
  if (reason.includes("assertion_not_found") || reason.includes("assertion")) {
    problem = "Durante la ejecución del escenario, no se encontró en pantalla la información esperada para completar la validación.";
  } else if (reason.includes("timeout")) {
    problem = "El escenario no pudo completarse porque la pantalla o acción esperada tardó más de lo permitido.";
  } else if (reason.includes("target_not_found") || reason.includes("element_not_found")) {
    problem = "No se encontró en pantalla la opción o elemento necesario para continuar con el escenario.";
  } else if (reason.includes("click_failed")) {
    problem = "No fue posible seleccionar la opción requerida durante la ejecución del escenario.";
  } else if (reason.includes("auth_failed") || reason.includes("authentication")) {
    problem = "No se pudo completar correctamente el flujo de autenticación requerido para ejecutar el escenario.";
  }
  console.log(`[defect-description] scenarioId=${scenarioTitle} source=legacy sections=3 hasFailedStep=false hasExpectedResult=false hasActualResult=false hasEvidence=false hasTestRail=false`);
  return `Escenario: ${scenarioTitle}\n\n${problem}\n\nAcción sugerida: revisar la evidencia y confirmar si corresponde a un defecto funcional o ajuste del caso de prueba.`;
}

export function buildStructuredDefectDescription(params: {
  scenarioId: string;
  scenarioTitle: string;
  failureReason?: string;
  technicalContext?: Record<string, unknown>;
  jobId?: string;
}): string {
  const tc = params.technicalContext;
  const hasTc = tc && Object.keys(tc).length > 0;

  // Fallback to legacy builder when no technicalContext
  if (!hasTc) return buildLegacyDefectDescription(params.scenarioTitle, params.failureReason);

  const lines: string[] = [];

  // Scenario header
  lines.push(`Escenario:`);
  lines.push(`${params.scenarioId} — ${params.scenarioTitle}`);
  lines.push("");

  // Result
  lines.push("Resultado:");
  lines.push("Fallido");
  lines.push("");

  // Failed step
  const failedAtStep = typeof tc.failedAtStep === "number" ? tc.failedAtStep : undefined;
  const failedTarget = typeof tc.failedTarget === "string" ? tc.failedTarget : undefined;
  if (failedAtStep != null || failedTarget) {
    lines.push("Paso fallido:");
    const stepParts: string[] = [];
    if (failedAtStep != null) stepParts.push(`Paso ${failedAtStep}`);
    if (failedTarget) stepParts.push(failedTarget);
    lines.push(stepParts.join(": "));
    lines.push("");
  }

  // Last successful step
  const ls = tc.lastSuccessfulStep as Record<string, unknown> | undefined;
  if (ls && typeof ls.stepIndex === "number") {
    lines.push("Último paso exitoso:");
    const lsParts: string[] = [`Paso ${ls.stepIndex}`];
    if (typeof ls.action === "string") lsParts.push(ls.action);
    if (typeof ls.target === "string") lsParts.push(ls.target);
    lines.push(lsParts.join(": "));
    lines.push("");
  }

  // Expected result
  if (typeof tc.expectedResult === "string" && tc.expectedResult.trim().length > 0) {
    lines.push("Resultado esperado:");
    lines.push(tc.expectedResult);
    lines.push("");
  }

  // Actual result / reason
  const reasonCode = typeof tc.reasonCode === "string" ? tc.reasonCode : undefined;
  const rawError = typeof tc.rawError === "string" ? tc.rawError : undefined;
  const actualSummary = mapReasonCodeToHuman(reasonCode, rawError);
  if (actualSummary) {
    lines.push("Resultado actual:");
    lines.push(actualSummary);
    lines.push("");
  }

  // Technical code
  if (reasonCode) {
    lines.push("Código técnico:");
    lines.push(reasonCode);
    lines.push("");
  }

  // Execution
  if (params.jobId) {
    lines.push("Ejecución:");
    lines.push(params.jobId);
    lines.push("");
  }

  // TestRail
  const trCaseId = typeof tc.testRailCaseId === "number" || typeof tc.testRailCaseId === "string" ? String(tc.testRailCaseId) : undefined;
  const trRunId = typeof tc.testRailRunId === "number" || typeof tc.testRailRunId === "string" ? String(tc.testRailRunId) : undefined;
  if (trCaseId || trRunId) {
    const trParts: string[] = [];
    if (trCaseId) trParts.push(`Caso ${formatTestRailId(trCaseId)}`);
    if (trRunId) trParts.push(`Run ${trRunId}`);
    lines.push("TestRail:");
    lines.push(trParts.join(" · "));
    lines.push("");
  }

  // Evidence
  const hasEvidence = Boolean(tc.evidenceDir) || Boolean(tc.evidencePath) || Boolean(ls?.evidencePath);
  lines.push("Evidencia:");
  lines.push(hasEvidence ? "Evidencia técnica disponible." : "No se registró evidencia visual.");
  lines.push("");

  // Diagnostic counters
  let sections = 0;
  if (failedAtStep != null || failedTarget) sections++;
  if (ls) sections++;
  if (tc.expectedResult) sections++;
  if (actualSummary) sections++;
  if (reasonCode) sections++;
  if (trCaseId || trRunId) sections++;
  console.log(`[defect-description] scenarioId=${params.scenarioId} source=technical_context sections=${sections} hasFailedStep=${failedAtStep != null || Boolean(failedTarget)} hasExpectedResult=${Boolean(tc.expectedResult)} hasActualResult=${Boolean(actualSummary)} hasEvidence=${hasEvidence} hasTestRail=${Boolean(trCaseId || trRunId)}`);

  return lines.join("\n").trim();
}

// Infer defect severity and severityReason from failure context.
export function inferDefectSeverity(failureReason?: string, _scenarioId?: string, _scenarioTitle?: string): { severity: DefectSeverity; severityReason: string } {
  const reason = (failureReason ?? "").toLowerCase();
  // critical: auth failures, total blockage
  if (reason.includes("auth_failed") || reason.includes("authentication") || reason.includes("login") || reason.includes("otp")) {
    return { severity: "critical", severityReason: "Fallo de autenticación o bloqueo total que impide ejecutar el flujo." };
  }
  // high: product/detail loading failures, missing key fields
  if (reason.includes("target_not_found") || reason.includes("element_not_found") || reason.includes("selection") || reason.includes("no carga") ||
      reason.includes("producto") || reason.includes("balance") || reason.includes("monto") || reason.includes("tasa") ||
      reason.includes("fecha") || reason.includes("estado") || reason.includes("certificado") || reason.includes("detalle") ||
      reason.includes("listado")) {
    return { severity: "high", severityReason: "El fallo afecta información principal esperada por la Historia de Usuario." };
  }
  // low: formatting, labels, copy, warnings
  if (reason.includes("formato") || reason.includes("copy") || reason.includes("label") ||
      reason.includes("warning") || reason.includes("texto secundario")) {
    return { severity: "low", severityReason: "El fallo corresponde a un aspecto visual o de formato menor." };
  }
  // default: medium
  return { severity: "medium", severityReason: "Validación esperada no encontrada. Requiere revisión funcional." };
}

/**
 * Builds a personalized defect headline that LEADS with the concrete failure, so two defects
 * no longer collapse to the same generic phrase:
 *   1. the specific element that wasn't found  → `No se encontró "<target>"`
 *   2. else the expected result that didn't happen → `No se cumplió: <expectedResult>`
 *   3. else the reason-code mapping / raw failure text (last-resort generic)
 * `expectedResult` and `failureReason` are passed explicitly (not only via technicalContext)
 * so the title stays specific even when technicalContext was stripped to empty.
 */
export function buildDefectTitle(params: {
  scenarioId: string;
  scenarioTitle: string;
  severity: DefectSeverity;
  technicalContext?: Record<string, unknown>;
  failureReason?: string;
  expectedResult?: string;
}): string {
  const tc = params.technicalContext ?? {};
  const severityLabel: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };

  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trim() + "…" : s);
  const reasonCode = typeof tc.reasonCode === "string" ? tc.reasonCode : undefined;
  const rawError = typeof tc.rawError === "string" ? tc.rawError : undefined;
  const failedAtStep = typeof tc.failedAtStep === "number" ? tc.failedAtStep : undefined;
  const failedTarget = typeof tc.failedTarget === "string" ? tc.failedTarget.trim() : undefined;
  // Prefer the explicit expectedResult, then whatever landed in technicalContext.
  const expected = (params.expectedResult?.trim() || (typeof tc.expectedResult === "string" ? tc.expectedResult.trim() : "")).replace(/[.]+$/, "");

  // (A) Lead with the most defect-specific signal available.
  let core: string;
  if (failedTarget) {
    core = `No se encontró "${clip(failedTarget, 60)}"`;
  } else if (expected) {
    core = `No se cumplió: ${clip(expected, 90)}`;
  } else {
    let cause = mapReasonCodeToHuman(reasonCode, rawError);
    if (!cause && params.failureReason) cause = sanitizeRawError(params.failureReason);
    if (!cause) cause = "La ejecución automatizada no pudo completarse";
    core = cause.replace(/[.]+$/, "").trim();
  }

  // Location suffix: the failing step (target is already named in the core when present).
  const location = failedAtStep != null ? ` (paso ${failedAtStep})` : "";

  // Trim the scenario title so the headline stays readable.
  const scenarioLabel = params.scenarioTitle && params.scenarioTitle !== params.scenarioId
    ? clip(params.scenarioTitle, 70)
    : params.scenarioId;

  const title = `[${severityLabel[params.severity]}] ${core}${location} — ${scenarioLabel}`;
  return title.length > 200 ? title.slice(0, 199) + "…" : title;
}
