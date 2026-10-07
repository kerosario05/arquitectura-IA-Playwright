import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { WebSessionRecorder } from "../recording/web/web-session-recorder";
import type { RecordedEvent, RecordedScreen, SessionTrace } from "../recording/session-trace.types";
import { buildHappyPathScenario } from "../recording/trace-to-scenario";
import { buildSemanticRecordingModel } from "../recording/semantic-recording";
import { hydratePersistedScenarios } from "../recording/persisted-scenario-hydration";
import { loadScenarios, loadSemanticRecording, loadTrace, saveScenarios, saveSemanticRecording, saveTrace } from "../recording/recording-store";
import { toSharedMcpScenario } from "../recording/canonical-recording-contract";
import { auditPersistedRecordingCorpus } from "../recording/recording-regression-corpus";
import { toVirtualCase, type VirtualCase } from "../types/scenario-preview.types";

type DashboardEvent = { sequence: number; time: string; message: string; level: "info" | "ok" | "fail" };
type DashboardState = {
  title: string;
  mode: "recording-engine";
  status: string;
  statusLabel: string;
  jobId: string;
  total: number;
  completed: number;
  passed: number;
  failed: number;
  promoted: number;
  current: Record<string, unknown> | null;
  projects: Array<{ slug: string; total: number; completed: number }>;
  recordingCorpus?: {
    total: number;
    passed: number;
    blocked: number;
    failed: number;
    sourceHashesVerified: boolean;
    projects: Array<{ slug: string; total: number; passed: number; blocked: number; failed: number }>;
  };
  scenarios: Array<Record<string, unknown>>;
  jobs: unknown[];
  events: DashboardEvent[];
  eventSequence: number;
  reportPath?: string;
};

const SYNTHETIC_PASSWORD = "qa-lab-recording-fixture-secret";
const FIXTURE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recording fixture</title></head><body>
<main><a href="/form" data-testid="open-form">Crear perfil</a></main></body></html>`;
const FORM_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Formulario de prueba</title></head><body>
<main><h1>Nuevo perfil</h1><form method="post" action="/complete">
<label for="profile-name">Nombre</label><input id="profile-name" name="profileName" type="text" autocomplete="off">
<label for="profile-password">Contraseña</label><input id="profile-password" name="profilePassword" type="password" autocomplete="new-password">
<label for="profile-currency">Moneda</label><select id="profile-currency" name="currency"><option value="DOP">DOP</option><option value="USD">USD</option></select>
<button type="submit">Guardar perfil</button></form></main></body></html>`;
const COMPLETE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Perfil creado</title></head><body><main><h1>Perfil creado</h1><p>La operación finalizó correctamente.</p></main></body></html>`;

function parseArgs(argv: string[]): { statePath: string; artifactsRoot: string } {
  const value = (flag: string, fallback: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  return {
    statePath: path.resolve(value("--state", path.join(osTempDir(), "qa-lab-recording-regression-state.json"))),
    artifactsRoot: path.resolve(value("--artifacts-root", ".artifacts/recording-regression")),
  };
}

function osTempDir(): string {
  return process.env.TEMP || process.env.TMPDIR || ".";
}

function readState(statePath: string): DashboardState {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8")) as DashboardState;
  } catch {
    return {
      title: "Regresión motor de grabación", mode: "recording-engine", status: "preparando", statusLabel: "Preparando",
      jobId: "", total: 1, completed: 0, passed: 0, failed: 0, promoted: 0, current: null,
      projects: [], scenarios: [], jobs: [], events: [], eventSequence: 0,
    };
  }
}

function writeState(statePath: string, state: DashboardState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state), "utf8");
  try {
    fs.renameSync(tempPath, statePath);
  } catch {
    fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
    fs.rmSync(tempPath, { force: true });
  }
}

function addEvent(statePath: string, state: DashboardState, message: string, level: DashboardEvent["level"] = "info"): void {
  state.eventSequence += 1;
  state.events.push({ sequence: state.eventSequence, time: new Date().toLocaleTimeString("es-DO", { hour12: false }), message, level });
  if (state.events.length > 1000) state.events = state.events.slice(-1000);
  writeState(statePath, state);
}

function setStage(statePath: string, state: DashboardState, label: string, message: string): void {
  state.status = "running";
  state.statusLabel = label;
  if (state.current) state.current.statusLabel = label;
  addEvent(statePath, state, message);
}

function fixtureServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(FIXTURE_HTML);
    } else if (request.method === "GET" && request.url === "/form") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(FORM_HTML);
    } else if (request.method === "POST" && request.url === "/complete") {
      request.resume();
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(COMPLETE_HTML);
    } else {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("FIXTURE_SERVER_ADDRESS_UNAVAILABLE");
    return { server, baseUrl: `http://127.0.0.1:${address.port}/` };
  });
}

function redactLine(raw: string): string {
  let line = raw.replaceAll(SYNTHETIC_PASSWORD, "[REDACTED]").replaceAll("Regression User", "[TEST DATA]");
  line = line.replace(/(password|contrasena|contraseña|otp|token|secret|authorization|api[_-]?key)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}\]]+)/gi, "$1$2\"[REDACTED]\"");
  line = line.replace(/(Ingresar\s+)("[^"]*"|'[^']*')(\s+en\s+["']?(?:contraseña|password|otp|token))/gi, "$1[REDACTED]$3");
  return line.length > 1800 ? `${line.slice(0, 1800)} … [línea truncada]` : line;
}

function updateFromDiscoveryLog(statePath: string, state: DashboardState, raw: string): void {
  const line = redactLine(raw.trim());
  if (!line) return;
  const promotedStep = line.match(/\[promoted-step\]\s+stepIndex=(\d+)\s+phase=([A-Za-z0-9_-]+)/);
  if (promotedStep && state.current) {
    state.current.stepIndex = Number(promotedStep[1]);
    state.current.statusLabel = `Discovery · paso ${promotedStep[1]} · ${promotedStep[2]}`;
  }
  const caseStart = line.match(/\[discovery:preview\]\s+starting\s+([^:]+):\s*(.*)/);
  if (caseStart && state.current) {
    state.current.caseId = caseStart[1];
    state.current.title = caseStart[2] || state.current.title;
  }
  const failed = /phase=failed|status=failed|promotionAllowed=false|\[functional-execution\].*exitCode=[1-9]/i.test(line);
  const passed = /phase=passed|promotionAllowed=true|promotionStatus=promoted/i.test(line);
  addEvent(statePath, state, line, failed ? "fail" : passed ? "ok" : "info");
}

function runDiscovery(statePath: string, state: DashboardState, inputPath: string, appSlug: string, jobId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");
    const child = spawn(process.execPath, [tsxCli, "src/cli/discovery-preview.ts", "--input", inputPath, "--app", appSlug, "--overwrite", "--auto-promote", "--auto-pom", "--rerun-active", "--defer-evidence-consolidation"], {
      cwd: process.cwd(),
      env: { ...process.env, EVIDENCE_RUN_ID: jobId },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const consume = (chunk: string, isError: boolean) => {
      const lines = (isError ? stderrBuffer : stdoutBuffer) + chunk;
      const completeLines = lines.split(/\r?\n/);
      const remainder = completeLines.pop() ?? "";
      if (isError) stderrBuffer = remainder;
      else stdoutBuffer = remainder;
      for (const line of completeLines) updateFromDiscoveryLog(statePath, state, line);
    };
    child.stdout.on("data", (chunk: string) => consume(chunk, false));
    child.stderr.on("data", (chunk: string) => consume(chunk, true));
    child.on("error", reject);
    child.on("close", (code) => {
      if (stdoutBuffer) updateFromDiscoveryLog(statePath, state, stdoutBuffer);
      if (stderrBuffer) updateFromDiscoveryLog(statePath, state, stderrBuffer);
      resolve(code ?? 1);
    });
  });
}

function writeIsolatedAppConfig(appSlug: string, baseUrl: string): void {
  const appDir = path.resolve("automations", "apps", appSlug);
  if (fs.existsSync(appDir)) throw new Error("STAGING_APP_PROFILE_COLLISION");
  fs.mkdirSync(appDir, { recursive: true });
  const now = new Date().toISOString();
  const config = {
    appProfile: { appSlug, source: "cli", name: "Regression fixture", baseUrl, createdAt: now, updatedAt: now },
    baseUrl,
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "fail",
    ignoreHTTPSErrors: false,
    updatedAt: now,
  };
  fs.writeFileSync(path.join(appDir, "app.config.json"), JSON.stringify(config, null, 2), "utf8");
}

function writeReport(runDir: string, state: DashboardState, checks: Record<string, unknown>): string {
  const reportPath = path.join(runDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ jobId: state.jobId, title: state.title, status: state.status, counts: { total: state.total, completed: state.completed, passed: state.passed, failed: state.failed, promoted: state.promoted }, checks, scenarios: state.scenarios, artifacts: runDir }, null, 2), "utf8");
  return reportPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const state = readState(args.statePath);
  const jobId = randomUUID();
  state.title = "Regresión motor de grabación";
  state.mode = "recording-engine";
  state.status = "running";
  state.statusLabel = "Iniciando fixture local";
  state.jobId = jobId;
  state.total = 1;
  state.completed = 0;
  state.passed = 0;
  state.failed = 0;
  state.promoted = 0;
  state.projects = [{ slug: "fixture-local", total: 1, completed: 0 }];
  state.scenarios = [{ projectSlug: "fixture-local", scenarioId: "REC-ENGINE-001", title: "Captura web completa", status: "running", promoted: false }];
  state.current = { projectSlug: "fixture-local", scenarioId: "REC-ENGINE-001", caseId: "REC-ENGINE-001", title: "Captura web completa", status: "running", statusLabel: "Preparando fixture", stepIndex: 0 };
  state.events = [];
  state.eventSequence = 0;
  writeState(args.statePath, state);

  const runDir = path.join(args.artifactsRoot, jobId);
  const recordingsRoot = path.join(runDir, "recordings");
  const appSlug = `recording-regression-${jobId.slice(0, 8)}`;
  const recordingId = `fixture-${jobId}`;
  const recordingAppSlug = "recording-engine-fixture";
  const recordingOptions = { rootDir: recordingsRoot };
  const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  let recorderDiagnosticsSuppressed = false;
  const suppressRecorderDiagnostics = () => {
    console.log = () => undefined;
    console.info = () => undefined;
    console.warn = () => undefined;
    console.error = () => undefined;
    recorderDiagnosticsSuppressed = true;
  };
  const restoreConsole = () => {
    if (!recorderDiagnosticsSuppressed) return;
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    recorderDiagnosticsSuppressed = false;
  };
  let fixture: Awaited<ReturnType<typeof fixtureServer>> | undefined;
  let recorder: WebSessionRecorder | undefined;
  let finalStatus: "completed" | "completed_with_failures" = "completed_with_failures";
  const checks: Record<string, unknown> = { sourceRecordingsTouched: false, testRailWrites: false };

  try {
    fs.mkdirSync(runDir, { recursive: true });
    addEvent(args.statePath, state, `Job de motor de grabación iniciado · ${jobId}`);
    setStage(args.statePath, state, "Auditando grabaciones persistidas", "Leyendo la carpeta de grabaciones en modo solo lectura; no se ejecutan acciones en aplicaciones reales.");
    suppressRecorderDiagnostics();
    let corpusAudit;
    try {
      corpusAudit = auditPersistedRecordingCorpus(path.resolve("automations", "apps"));
    } finally {
      restoreConsole();
    }
    checks.persistedRecordingCorpus = {
      total: corpusAudit.total,
      passed: corpusAudit.passed,
      blocked: corpusAudit.blocked,
      failed: corpusAudit.failed,
      sourceHashesVerified: corpusAudit.sourceHashesVerified,
      entries: corpusAudit.entries,
    };
    const corpusProjects = new Map<string, { total: number; passed: number; blocked: number; failed: number }>();
    for (const entry of corpusAudit.entries) {
      const project = corpusProjects.get(entry.appSlug) ?? { total: 0, passed: 0, blocked: 0, failed: 0 };
      project.total += 1;
      project[entry.status] += 1;
      corpusProjects.set(entry.appSlug, project);
    }
    state.recordingCorpus = {
      total: corpusAudit.total,
      passed: corpusAudit.passed,
      blocked: corpusAudit.blocked,
      failed: corpusAudit.failed,
      sourceHashesVerified: corpusAudit.sourceHashesVerified,
      projects: [...corpusProjects].map(([slug, counts]) => ({ slug, ...counts })),
    };
    checks.sourceRecordingsTouched = false;
    checks.sourceRecordingHashesVerified = corpusAudit.sourceHashesVerified;
    for (const entry of corpusAudit.entries) {
      state.current = {
        projectSlug: entry.appSlug,
        recordingId: entry.recordingId,
        title: "Contrato de grabación persistida",
        status: entry.status,
        statusLabel: entry.status === "passed" ? "Contrato verificado" : entry.reason ?? "Contrato no disponible",
      };
      addEvent(
        args.statePath,
        state,
        entry.status === "passed"
          ? `Grabación fuente intacta · ${entry.appSlug} · ${entry.recordingId} · escenarios=${entry.scenarioCount} · eventos=${entry.eventCount}`
          : `Grabación no ejecutable en auditoría local · ${entry.appSlug} · ${entry.recordingId} · razón=${entry.reason ?? "unknown"} · fuente intacta=${entry.sourceHashVerified}`,
        entry.status === "passed" ? "ok" : entry.status === "failed" ? "fail" : "info",
      );
    }
    if (!corpusAudit.sourceHashesVerified || corpusAudit.failed > 0) throw new Error("PERSISTED_RECORDING_SOURCE_INTEGRITY_FAILED");
    addEvent(args.statePath, state, `Auditoría de grabaciones persistidas · ${corpusAudit.passed} válidas · ${corpusAudit.blocked} bloqueadas · ${corpusAudit.failed} fallidas · hashes fuente verificados=${corpusAudit.sourceHashesVerified}`, corpusAudit.failed > 0 ? "fail" : "ok");

    state.current = { projectSlug: "fixture-local", scenarioId: "REC-ENGINE-001", caseId: "REC-ENGINE-001", title: "Captura web completa", status: "running", statusLabel: "Preparando fixture", stepIndex: 0 };
    setStage(args.statePath, state, "Capturando recorrido fixture", "Iniciando servidor y navegador fixture local.");
    fixture = await fixtureServer();
    const events: RecordedEvent[] = [];
    const screens: RecordedScreen[] = [];
    const recorderLogs: string[] = [];
    recorder = new WebSessionRecorder({
      baseUrl: fixture.baseUrl,
      framesDir: path.join(runDir, "frames"),
      captureScreenshots: false,
      headless: true,
      persistQaCredentials: false,
      sensitiveLabels: ["contraseña", "password"],
      onEvent: (event) => events.push(event),
      onScreen: (screen) => screens.push(screen),
      onLog: (line) => recorderLogs.push(redactLine(line)),
    });
    suppressRecorderDiagnostics();
    await recorder.start();
    await recorder.navigateToInitialPage();
    const page = recorder.liveViewTarget()?.page;
    if (!page) throw new Error("RECORDER_PAGE_NOT_AVAILABLE");
    await page.getByTestId("open-form").click();
    await page.getByLabel("Nombre").fill("Regression User");
    await page.getByLabel("Contraseña").fill(SYNTHETIC_PASSWORD);
    const currency = page.getByLabel("Moneda");
    await currency.click();
    await currency.press("ArrowDown");
    await currency.press("Enter");
    if (await currency.inputValue() !== "USD") throw new Error("FIXTURE_NATIVE_SELECTION_NOT_APPLIED");
    await page.getByRole("button", { name: "Guardar perfil" }).click();
    await page.getByRole("heading", { name: "Perfil creado" }).waitFor({ state: "visible" });
    const stopped = await recorder.stop();
    recorder = undefined;

    const trace: SessionTrace = {
      recordingId,
      projectSlug: recordingAppSlug,
      appSlug: recordingAppSlug,
      platform: "web",
      baseUrl: fixture.baseUrl,
      label: "Recording engine regression fixture",
      recordingGoal: { declaredGoal: "Crear perfil de prueba", normalizedGoal: "Crear perfil de prueba", provenance: "USER_DECLARED", needsReview: false },
      recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: false },
      captureAuthority: "v2",
      startedAt: new Date(Date.now() - 1000).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 1000,
      status: "stopped",
      events: stopped.events.length ? stopped.events : events,
      screens: stopped.screens.length ? stopped.screens : screens,
    };
    if (trace.events.length < 4) throw new Error(`RECORDER_CAPTURE_INCOMPLETE:${trace.events.length}`);
    saveTrace(trace, recordingOptions);
    const persistedTrace = loadTrace(recordingAppSlug, recordingId, recordingOptions);
    if (!persistedTrace) throw new Error("TRACE_PERSISTENCE_READBACK_FAILED");
    const semantic = buildSemanticRecordingModel(persistedTrace, persistedTrace.events);
    saveSemanticRecording(semantic, recordingOptions);
    const persistedSemantic = loadSemanticRecording(recordingAppSlug, recordingId, recordingOptions);
    if (!persistedSemantic) throw new Error("SEMANTIC_PERSISTENCE_READBACK_FAILED");

    setStage(args.statePath, state, "Derivando e rehidratando escenario", `Captura lista · ${persistedTrace.events.length} eventos · ${persistedTrace.screens.length} pantallas.`);
    const initialScenario = buildHappyPathScenario(persistedTrace, persistedTrace.events);
    saveScenarios(recordingAppSlug, recordingId, [initialScenario], recordingOptions);
    const persistedScenarios = loadScenarios(recordingAppSlug, recordingId, recordingOptions);
    const hydrated = hydratePersistedScenarios(persistedScenarios, persistedSemantic, persistedTrace);
    if (hydrated.length !== 1 || hydrated[0].testRailSteps.length === 0) throw new Error("SCENARIO_HYDRATION_FAILED");
    const scenarioJson = JSON.stringify(hydrated[0]);
    if (scenarioJson.includes(SYNTHETIC_PASSWORD)) throw new Error("SENSITIVE_VALUE_LEAKED_IN_HUMAN_SCENARIO");
    if (!hydrated[0].canonicalInteractions?.some((interaction) => interaction.action === "fill")) throw new Error("RECORDED_FILL_NOT_MATERIALIZED");
    if (!persistedTrace.events.some((event) => (event.target as any)?.playwrightRecorderEvidence?.nativeSelection?.clickedOption?.value === "USD")) throw new Error("RECORDED_NATIVE_SELECTION_NOT_MATERIALIZED");
    const nativeSelectionProjected = hydrated[0].webSteps?.some((step) => step.action === "select")
      && hydrated[0].testRailSteps.some((step) => step.content.startsWith("Seleccionar "));
    if (!nativeSelectionProjected) throw new Error("RECORDED_NATIVE_SELECTION_PROJECTION_FAILED");
    if (!hydrated[0].canonicalInteractions?.some((interaction) => interaction.action === "click")) throw new Error("RECORDED_CLICK_NOT_MATERIALIZED");
    checks.captureEvents = persistedTrace.events.length;
    checks.captureScreens = persistedTrace.screens.length;
    checks.tracePersistedAndReadBack = true;
    checks.semanticModelPersistedAndReadBack = true;
    checks.scenarioHydrated = true;
    checks.sensitiveValueAbsentFromScenarioSteps = true;
    checks.nativeSelectionProjection = true;
    checks.interactions = { click: true, fill: true, nativeSelection: true, navigation: persistedTrace.events.some((event) => event.kind === "navigate") };
    for (const line of recorderLogs) addEvent(args.statePath, state, line);
    restoreConsole();

    setStage(args.statePath, state, "Preparando Discovery y AutoPOM aislados", "Escenario del fixture convertido al contrato compartido de Discovery.");
    suppressRecorderDiagnostics();
    const datasetValues = Object.fromEntries(hydrated[0].requiredData.map((field) => [
      field.key,
      field.sensitive ? SYNTHETIC_PASSWORD : field.exampleValue ?? "Regression User",
    ]));
    const sharedScenario = toSharedMcpScenario(hydrated[0], appSlug, datasetValues);
    const virtualCase = toVirtualCase(sharedScenario, 0, "recording-engine-regression", "Motor de grabación", "local") as VirtualCase;
    virtualCase.id = `recording-regression-${jobId.slice(0, 8)}`;
    virtualCase.displayId = "REC-ENGINE-001";
    virtualCase.appSlug = appSlug;
    virtualCase.targetAppSlug = appSlug;
    virtualCase.title = "Captura web completa";
    virtualCase.recordingId = recordingId;
    virtualCase.recordedScenarioId = hydrated[0].scenarioId;
    (virtualCase as VirtualCase & { dataOverrides: Record<string, string> }).dataOverrides = {
      nombre: "Regression User",
      contrasena: SYNTHETIC_PASSWORD,
    };
    if (state.current) state.current.appSlug = appSlug;
    state.scenarios[0].appSlug = appSlug;
    restoreConsole();
    const inputPath = path.join(runDir, "preview-scenarios.json");
    fs.writeFileSync(inputPath, JSON.stringify([virtualCase], null, 2), "utf8");
    writeIsolatedAppConfig(appSlug, fixture.baseUrl);
    checks.uniqueStagingAppSlug = appSlug;
    checks.discoveryAutoPomRequested = true;

    setStage(args.statePath, state, "Discovery + AutoPOM + promoción", "Ejecutando el pipeline local sobre el fixture aislado.");
    const exitCode = await runDiscovery(args.statePath, state, inputPath, appSlug, jobId);
    const resultsPath = path.join(runDir, "results.json");
    // discovery:preview writes results beside the input. Keep that output in the job staging tree.
    const cliResultsPath = path.join(runDir, "results.json");
    let result: any;
    if (fs.existsSync(cliResultsPath)) result = JSON.parse(fs.readFileSync(cliResultsPath, "utf8"));
    else {
      // Compatibility: the preview CLI may write to a generated-case artifact directory in older versions.
      const candidate = path.resolve(".artifacts", "scenario-preview-runs", jobId, "results.json");
      if (fs.existsSync(candidate)) result = JSON.parse(fs.readFileSync(candidate, "utf8"));
    }
    if (!result && fs.existsSync(resultsPath)) result = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    const caseResult = result?.cases?.[0] ?? result?.results?.[0] ?? {};
    const promoted = caseResult.automationReady === true
      && caseResult.promotionAllowed === true
      && caseResult.specWritten === true
      && caseResult.promotionStatus === "promoted";
    checks.discoveryExitCode = exitCode;
    checks.discoveryStatus = caseResult.discoveryStatus ?? null;
    checks.autoPomStatus = caseResult.pomStatus ?? caseResult.specGenerationStatus ?? null;
    checks.promotionStatus = caseResult.promotionStatus ?? null;
    checks.promotionAllowed = caseResult.promotionAllowed === true;
    checks.specWritten = caseResult.specWritten === true;
    checks.testRailWrites = false;
    state.completed = 1;
    state.projects[0].completed = 1;
    state.passed = promoted ? 1 : 0;
    state.failed = promoted ? 0 : 1;
    state.promoted = promoted ? 1 : 0;
    state.scenarios[0].status = promoted ? "passed" : "failed";
    state.scenarios[0].promoted = promoted;
    state.current.status = promoted ? "passed" : "failed";
    state.current.statusLabel = promoted ? "Promovido" : "Pipeline bloqueado";
    state.status = promoted ? "completed" : "completed_with_failures";
    state.statusLabel = promoted ? "Regresión completada · caso promovido" : "Regresión completada · promoción bloqueada";
    finalStatus = promoted ? "completed" : "completed_with_failures";
    addEvent(args.statePath, state, promoted ? "Caso fixture promovido correctamente · Discovery, AutoPOM y gate aprobados." : `Caso fixture no promovido · revisar ${caseResult.reason ?? caseResult.promotionReason ?? "results.json"}.`, promoted ? "ok" : "fail");
    state.reportPath = writeReport(runDir, state, checks);
    addEvent(args.statePath, state, `Informe local guardado · ${state.reportPath}`, "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.completed = state.completed ? 1 : 0;
    state.failed = 1;
    state.status = "completed_with_failures";
    state.statusLabel = "Regresión del motor fallida";
    state.current = { ...(state.current ?? {}), status: "failed", statusLabel: "Falló la validación" };
    finalStatus = "completed_with_failures";
    addEvent(args.statePath, state, `Error de regresión · ${redactLine(message)}`, "fail");
    state.reportPath = writeReport(runDir, state, checks);
  } finally {
    if (recorder) await recorder.stop().catch(() => undefined);
    restoreConsole();
    if (fixture) await new Promise<void>((resolve) => fixture!.server.close(() => resolve()));
    state.status = finalStatus;
    writeState(args.statePath, state);
  }

  process.exitCode = finalStatus === "completed" ? 0 : 1;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("recording-engine-regression.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
