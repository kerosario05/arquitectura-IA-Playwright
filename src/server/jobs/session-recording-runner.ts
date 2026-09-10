import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { jobStore } from "./job-store";
import { resolveMobileTarget, ensureMobileInfra } from "./mobile-test-runner";
import { getStatus as getEmulatorStatus } from "../../mobile/emulator-manager";
import { resolveAndroidSdk } from "../../mobile/android-sdk";
import { getProjectConfigurationBySlug } from "../../db/project-reader";
import { AndroidSessionRecorder } from "../../recording/mobile/android-session-recorder";
import { WebSessionRecorder } from "../../recording/web/web-session-recorder";
import {
  discardFrames,
  ensureFramesDir,
  loadScenarios,
  loadTrace,
  saveScenarios,
  saveTrace,
  saveSemanticRecording,
  toSummary,
} from "../../recording/recording-store";
import { normalizeEvents, segmentTrace, summarizeTrace } from "../../recording/trace-normalizer";
import {
  buildAlternativePathScenarios,
  buildGateNegatives,
  buildHappyPathScenario,
  buildSegmentScenarios,
  capTitle,
  filterGoalScopedSuggestions,
  type RecordedScenario,
} from "../../recording/trace-to-scenario";
import { applyStory, enrichFromTrace } from "../../recording/trace-ai-enricher";
import { createGeneralAiProvider } from "../../ai/ai-provider-factory";
import type { RecordedEvent, RecordingDataPolicy, RecordingPlatform, RecordingSummary, SessionTrace } from "../../recording/session-trace.types";
import {
  attachScenarioSuggestions,
  buildSemanticRecordingModel,
  hasSignificantSemanticChange,
  normalizeRecordingDataPolicy,
  normalizeRecordingGoal,
  type SemanticRecordingModel,
} from "../../recording/semantic-recording";

const execFileAsync = promisify(execFile);

/**
 * Lifecycle of a recorded exploration session.
 *
 * A recording is long-lived and human-paced: it starts, then waits — possibly for minutes —
 * while a person walks the app, and only ends when they say so. That is why it is held in a
 * registry rather than run to completion like every other job: there is no work to finish,
 * only an observer to keep alive. The job entry exists so the UI gets the same log stream as
 * every other operation.
 *
 * Derivation is a separate call on purpose. Stopping should never block on an AI round-trip,
 * and a recording whose derivation failed must remain re-derivable from the trace it already
 * saved.
 */

export type StartRecordingParams = {
  /** Project whose configuration decides WHICH app is recorded. */
  projectSlug: string;
  label?: string;
  recordingGoal?: string;
  recordingDataPolicy?: Partial<RecordingDataPolicy>;
  /** Overrides the platform implied by the project type. Rarely needed. */
  platform?: RecordingPlatform;
  avdName?: string;
  headless?: boolean;
  /** Extra field labels to redact beyond the built-in list. */
  sensitiveLabels?: string[];
};

type LiveSemanticProjection = {
  source: { events: RecordedEvent[]; screens: SessionTrace["screens"] };
  scenarios: RecordedScenario[];
  semanticModel: SemanticRecordingModel;
  refreshCount: number;
  noiseRefreshSkipped: number;
};

type ActiveRecording = {
  recordingId: string;
  jobId: string;
  trace: SessionTrace;
  recorder: AndroidSessionRecorder | WebSessionRecorder;
  liveProjection?: LiveSemanticProjection;
};

const active = new Map<string, ActiveRecording>();

/** Index from app slug to recording id, so a caller only holding the slug can find it. */
export function activeRecordingFor(projectSlug: string): ActiveRecording | undefined {
  for (const entry of active.values()) {
    if (entry.trace.projectSlug === projectSlug) return entry;
  }
  return undefined;
}

export function getActiveRecording(recordingId: string): ActiveRecording | undefined {
  return active.get(recordingId);
}

export class RecordingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RecordingError";
  }
}

type ResolvedProject = {
  appSlug: string;
  platform: RecordingPlatform;
  appPackage?: string;
  appActivity?: string;
  apkPath?: string;
  baseUrl?: string;
  ignoreHTTPSErrors?: boolean;
};

/**
 * Reads the project registry to decide what to record.
 *
 * The whole point of picking a project first is that nothing about the target is typed by
 * hand: package, activity and base URL all come from the configuration the user already
 * filled in, so a recording can never drift onto a different app than the project's.
 */
export async function resolveRecordingTarget(projectSlug: string): Promise<ResolvedProject> {
  const cfg = await getProjectConfigurationBySlug(projectSlug);
  if (!cfg) {
    throw new RecordingError("PROJECT_NOT_FOUND", `No existe el proyecto ${projectSlug}`);
  }
  const isMobile = cfg.projectType === 2;
  if (isMobile) {
    if (!cfg.mobile?.packageName) {
      throw new RecordingError(
        "PROJECT_NOT_CONFIGURED",
        `El proyecto ${projectSlug} no tiene configuración móvil (packageName) para grabar`,
      );
    }
    return {
      appSlug: cfg.slug,
      platform: "android",
      appPackage: cfg.mobile.packageName,
      appActivity: cfg.mobile.mainActivity,
      apkPath: cfg.mobile.apkPath,
    };
  }
  if (!cfg.web?.baseUrl) {
    throw new RecordingError(
      "PROJECT_NOT_CONFIGURED",
      `El proyecto ${projectSlug} no tiene baseUrl configurada para grabar`,
    );
  }
  return {
    appSlug: cfg.slug,
    platform: "web",
    baseUrl: cfg.web.baseUrl,
    ignoreHTTPSErrors: cfg.web.ignoreHTTPSErrors === true,
  };
}

/** Brings the app to the foreground so the walkthrough starts where the user expects. */
async function launchAndroidApp(
  deviceId: string,
  appPackage: string,
  appActivity: string | undefined,
  onLog: (line: string) => void,
): Promise<void> {
  const adb = resolveAndroidSdk().adbPath;
  const component = appActivity
    ? appActivity.startsWith(".") || !appActivity.includes("/")
      ? `${appPackage}/${appActivity}`
      : appActivity
    : undefined;
  try {
    await execFileAsync(adb, ["-s", deviceId, "shell", "am", "force-stop", appPackage]);
    if (component) {
      await execFileAsync(adb, ["-s", deviceId, "shell", "am", "start", "-n", component]);
    } else {
      await execFileAsync(adb, ["-s", deviceId, "shell", "monkey", "-p", appPackage, "-c", "android.intent.category.LAUNCHER", "1"]);
    }
    onLog(`[recording] app ${appPackage} en primer plano`);
    await new Promise((r) => setTimeout(r, 2500));
  } catch (err) {
    onLog(`[recording] no se pudo abrir la app automáticamente: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function startRecording(params: StartRecordingParams): Promise<{
  recordingId: string;
  jobId: string;
  summary: RecordingSummary;
}> {
  const target = await resolveRecordingTarget(params.projectSlug);
  const platform = params.platform ?? target.platform;

  const existing = activeRecordingFor(params.projectSlug);
  if (existing) {
    throw new RecordingError(
      "RECORDING_ALREADY_ACTIVE",
      `Ya hay una grabación activa para ${params.projectSlug} (${existing.recordingId})`,
    );
  }

  const recordingId = randomUUID();
  const job = jobStore.create("session-recording", {
    recordingId,
    projectSlug: params.projectSlug,
    platform,
  });
  const onLog = (line: string) => jobStore.appendLog(job.id, line);
  jobStore.update(job.id, { status: "running", startedAt: new Date().toISOString() });

  const trace: SessionTrace = {
    recordingId,
    projectSlug: params.projectSlug,
    appSlug: target.appSlug,
    platform,
    appPackage: target.appPackage,
    baseUrl: target.baseUrl,
    label: params.label,
    recordingGoal: normalizeRecordingGoal(params.recordingGoal ?? params.label),
    recordingDataPolicy: normalizeRecordingDataPolicy(params.recordingDataPolicy),
    startedAt: new Date().toISOString(),
    status: "starting",
    events: [],
    screens: [],
  };

  const framesDir = ensureFramesDir(recordingId);

  try {
    let recorder: AndroidSessionRecorder | WebSessionRecorder;

    if (platform === "android") {
      const mobileTarget = resolveMobileTarget({
        appSlug: target.appSlug,
        apkPath: target.apkPath,
        appPackage: target.appPackage,
        appActivity: target.appActivity,
        avdName: params.avdName,
        headless: params.headless,
      });
      await ensureMobileInfra(mobileTarget, onLog, { runId: recordingId });
      const deviceId = getEmulatorStatus().deviceId;
      if (!deviceId) {
        throw new RecordingError("DEVICE_NOT_AVAILABLE", "No hay dispositivo Android disponible para grabar");
      }
      await launchAndroidApp(deviceId, target.appPackage!, target.appActivity, onLog);

      recorder = new AndroidSessionRecorder({
        deviceId,
        appPackage: target.appPackage,
        framesDir,
        persistQaCredentials: trace.recordingDataPolicy?.persistQaCredentials === true,
        sensitiveLabels: params.sensitiveLabels,
        onEvent: (event) => {
          trace.events.push(event);
          saveTrace(trace);
        },
        onScreen: (screen) => {
          const existingIndex = trace.screens.findIndex((item) => item.screenKey === screen.screenKey);
          if (existingIndex >= 0) trace.screens[existingIndex] = screen;
          else trace.screens.push(screen);
          saveTrace(trace);
        },
        onLog,
      });
    } else {
      recorder = new WebSessionRecorder({
        baseUrl: target.baseUrl!,
        ignoreHTTPSErrors: target.ignoreHTTPSErrors,
        framesDir,
        persistQaCredentials: trace.recordingDataPolicy?.persistQaCredentials === true,
        sensitiveLabels: params.sensitiveLabels,
        onEvent: (event) => {
          trace.events.push(event);
          saveTrace(trace);
        },
        onScreen: (screen) => {
          const existingIndex = trace.screens.findIndex((item) => item.screenKey === screen.screenKey);
          if (existingIndex >= 0) trace.screens[existingIndex] = screen;
          else trace.screens.push(screen);
          saveTrace(trace);
        },
        onLog,
      });
    }

    const started = await recorder.start();
    if (!started) {
      throw new RecordingError(
        "TOUCH_CAPTURE_UNAVAILABLE",
        "No se pueden capturar los toques en este dispositivo: ningún dispositivo de entrada reporta " +
          "ejes de posición (revisa el log de la grabación para ver los dispositivos detectados). " +
          "La grabación se detiene en lugar de producir un recorrido sin acciones.",
      );
    }

    trace.status = "recording";
    saveTrace(trace);
    active.set(recordingId, { recordingId, jobId: job.id, trace, recorder });
    onLog(`[recording] grabación ${recordingId} iniciada sobre ${target.appSlug} (${platform})`);

    return { recordingId, jobId: job.id, summary: toSummary(trace) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trace.status = "failed";
    trace.errorMessage = message;
    saveTrace(trace);
    jobStore.update(job.id, { status: "failed", errorMessage: message, completedAt: new Date().toISOString() });
    onLog(`[recording] fallo al iniciar: ${message}`);
    throw err;
  }
}

export function recordingProgress(recordingId: string): {
  summary: RecordingSummary;
  live: { events: number; screens: number; currentScreen: string; semanticRefreshCount: number; noiseRefreshSkipped: number };
  scenarios: RecordedScenario[];
  semanticModel: SemanticRecordingModel;
} | null {
  const entry = active.get(recordingId);
  if (!entry) return null;
  const source = { events: [...entry.trace.events], screens: [...entry.trace.screens] };
  if (entry.liveProjection && !hasSignificantSemanticChange(entry.liveProjection.source, source)) {
    entry.liveProjection.noiseRefreshSkipped += 1;
    return {
      summary: toSummary(entry.trace),
      live: { ...entry.recorder.snapshotProgress(), semanticRefreshCount: entry.liveProjection.refreshCount, noiseRefreshSkipped: entry.liveProjection.noiseRefreshSkipped },
      scenarios: entry.liveProjection.scenarios,
      semanticModel: entry.liveProjection.semanticModel,
    };
  }
  const events = normalizeEvents(source.events);
  const primary = buildHappyPathScenario(entry.trace, events);
  const livePrimary: RecordedScenario = { ...primary, status: "IN_PROGRESS" };
  const segments = segmentTrace(events, entry.trace);
  const candidates = [
    ...buildGateNegatives(entry.trace, segments, primary),
    ...buildAlternativePathScenarios(entry.trace, events, primary),
  ];
  const scoped = filterGoalScopedSuggestions(
    entry.trace.recordingGoal?.normalizedGoal ?? entry.trace.label,
    candidates,
  );
  const semanticBase = buildSemanticRecordingModel(entry.trace, events);
  const semanticModel = attachScenarioSuggestions({
    ...semanticBase,
    primaryScenario: {
      scenarioId: livePrimary.scenarioId,
      title: livePrimary.title,
      provenance: "OBSERVED" as const,
      status: "IN_PROGRESS" as const,
      sourceEventRefs: livePrimary.sourceEventRefs ?? [],
      traceBacked: true as const,
      containsUnexecutedActions: false as const,
      needsReview: livePrimary.hasUncertainSteps,
    },
  }, scoped.suggestions.map((scenario) => ({
    suggestionId: scenario.scenarioId,
    title: scenario.title,
    provenance: scenario.suggestionCategory === "DERIVED_VALIDATION" ? "DERIVED_VALIDATION" as const : "DERIVED_ALTERNATIVE" as const,
    confidence: scenario.confidence ?? 0.85,
    goalRelevanceScore: scenario.goalRelevanceScore ?? 0.5,
    goalRelevanceReasons: scenario.goalRelevanceReasons ?? [],
    needsReview: true,
    rationale: scenario.rationale ?? "Derivado de evidencia observada durante la grabación.",
    sourceEventRefs: scenario.sourceEventRefs ?? events.map((_, index) => `event-${index + 1}`),
    steps: scenario.testRailSteps.map((step) => step.content),
    expectedResultCandidate: scenario.testRailSteps.at(-1)?.expected,
    oracleAuthority: "review_required" as const,
    dataRequirements: scenario.requiredData.map((item) => item.key),
    technicalObservationRefs: semanticBase.technicalObservations.map((item) => item.observationId),
  })));
  entry.liveProjection = {
    source,
    scenarios: [livePrimary, ...scoped.suggestions],
    semanticModel,
    refreshCount: (entry.liveProjection?.refreshCount ?? 0) + 1,
    noiseRefreshSkipped: entry.liveProjection?.noiseRefreshSkipped ?? 0,
  };
  return {
    summary: toSummary(entry.trace),
    live: { ...entry.recorder.snapshotProgress(), semanticRefreshCount: entry.liveProjection.refreshCount, noiseRefreshSkipped: entry.liveProjection.noiseRefreshSkipped },
    scenarios: entry.liveProjection.scenarios,
    semanticModel,
  };
}

export async function stopRecording(recordingId: string): Promise<RecordingSummary> {
  const entry = active.get(recordingId);
  if (!entry) {
    throw new RecordingError("RECORDING_NOT_ACTIVE", `No hay una grabación activa con id ${recordingId}`);
  }
  const onLog = (line: string) => jobStore.appendLog(entry.jobId, line);

  entry.trace.status = "stopping";
  const { events, screens } = await entry.recorder.stop();
  const endedAt = new Date();

  entry.trace.events = events;
  entry.trace.screens = screens;
  entry.trace.endedAt = endedAt.toISOString();
  entry.trace.durationMs = endedAt.getTime() - new Date(entry.trace.startedAt).getTime();
  entry.trace.status = "stopped";
  saveTrace(entry.trace);
  active.delete(recordingId);

  const stats = summarizeTrace(normalizeEvents(events), entry.trace);
  onLog(
    `[recording] grabación detenida: ${stats.actions} acciones, ${stats.screens} pantallas, ${stats.transitions} transiciones`,
  );
  jobStore.update(entry.jobId, { status: "done", completedAt: endedAt.toISOString() });

  return toSummary(entry.trace);
}

export type DeriveResult = {
  summary: RecordingSummary;
  scenarios: RecordedScenario[];
  narrative: string;
  semanticModel: SemanticRecordingModel;
};

/**
 * Turns a stopped recording into scenarios, then destroys the visual material.
 *
 * The frame deletion is in a `finally` and not at the end of the happy path: a derivation
 * that throws must not leave screenshots of a banking session on disk. Re-deriving later
 * works from the trace and the narrative, which is exactly why the narrative is produced
 * before the frames go.
 */
export async function deriveScenarios(
  appSlug: string,
  recordingId: string,
  options: { title?: string } = {},
): Promise<DeriveResult> {
  const trace = loadTrace(appSlug, recordingId);
  if (!trace) {
    throw new RecordingError("RECORDING_NOT_FOUND", `No se encontró la grabación ${recordingId}`);
  }
  if (trace.status === "recording" || trace.status === "starting") {
    throw new RecordingError("RECORDING_IN_PROGRESS", "Detén la grabación antes de generar escenarios");
  }

  const entryJobId = active.get(recordingId)?.jobId;
  const onLog = (line: string) => {
    if (entryJobId) jobStore.appendLog(entryJobId, line);
    else console.log(line);
  };

  try {
    const events = normalizeEvents(trace.events);
    const segments = segmentTrace(events, trace);
    const happyPath = buildHappyPathScenario(trace, events, { title: options.title });

    let ai;
    try {
      ai = await createGeneralAiProvider();
    } catch {
      ai = undefined;
    }

    const enrichment = await enrichFromTrace(trace, segments, happyPath, ai, onLog);
    const enrichedHappyPath = applyStory(happyPath, enrichment);

    const negatives = buildGateNegatives(trace, segments, enrichedHappyPath);
    const aiNegatives: RecordedScenario[] = enrichment.extraNegatives.map((n, index) => ({
      scenarioId: `${enrichedHappyPath.scenarioId}-AI-${index + 1}`,
      title: capTitle(n.title),
      description: n.basedOn ? `${n.description}\n\nObservado en la grabación: "${n.basedOn}".` : n.description,
      preconditions: enrichedHappyPath.preconditions,
      kind: "negative",
      // Anchored on something the recording saw, but never walked: nobody entered a wrong
      // code or let a session expire during the capture.
      provenance: "derived",
      mobileSteps: [],
      webSteps: [],
      testRailSteps: n.steps,
      requiredData: [],
      stepTargets: [],
      sourceRecordingId: recordingId,
      hasUncertainSteps: false,
      suggestionCategory: "AI_PROPOSED",
    }));

    // Ordered as a reviewer reads them: what was walked end to end, then its blocks, then
    // everything the recording only justifies.
    // Segments remain derivation evidence only. A recording goal has one observed primary;
    // top-level suggestions are filtered and deduplicated separately.
    const segmentScenarios = buildSegmentScenarios(trace, events, segments, enrichedHappyPath);
    const alternatives = buildAlternativePathScenarios(trace, events, enrichedHappyPath);
    const scoped = filterGoalScopedSuggestions(
      trace.recordingGoal?.normalizedGoal ?? trace.label,
      [...negatives, ...aiNegatives, ...alternatives],
    );
    const scenarios = [enrichedHappyPath, ...scoped.suggestions];
    const baseSemantic = buildSemanticRecordingModel(trace, events);
    const semantic = attachScenarioSuggestions({
      ...baseSemantic,
      primaryScenario: {
        scenarioId: enrichedHappyPath.scenarioId,
        title: enrichedHappyPath.title,
        provenance: "OBSERVED" as const,
        sourceEventRefs: enrichedHappyPath.sourceEventRefs ?? [],
        traceBacked: true as const,
        containsUnexecutedActions: false as const,
        needsReview: enrichedHappyPath.hasUncertainSteps,
      },
    }, scoped.suggestions.map((scenario) => ({
      suggestionId: scenario.scenarioId,
      title: scenario.title,
      provenance: scenario.scenarioId.includes("-AI-")
        ? "AI_PROPOSED"
        : scenario.suggestionCategory === "DERIVED_VALIDATION" ? "DERIVED_VALIDATION" : "DERIVED_ALTERNATIVE",
      confidence: scenario.confidence ?? 0.85,
      needsReview: true,
      rationale: scenario.rationale ?? "Derivado de evidencia observada; requiere revisión.",
      goalRelevanceScore: scenario.goalRelevanceScore ?? 0.5,
      goalRelevanceReasons: scenario.goalRelevanceReasons ?? [],
      sourceEventRefs: scenario.sourceEventRefs ?? events.map((_, index) => `event-${index + 1}`),
      steps: scenario.testRailSteps.map((step) => step.content),
      expectedResultCandidate: scenario.expectedResultCandidate ?? scenario.testRailSteps.at(-1)?.expected,
      oracleAuthority: scenario.oracleAuthority ?? "review_required",
      dataRequirements: scenario.requiredData.map((data) => data.key),
      technicalObservationRefs: baseSemantic.technicalObservations.map((observation) => observation.observationId),
    })));
    saveSemanticRecording(semantic);
    onLog(
      `[recording] escenarios: 1 principal observado, ${scoped.suggestions.length} sugerencias relevantes; ` +
        `segmentos internos=${segmentScenarios.length}, candidatos_rechazados=${scoped.irrelevantCandidatesRejected}, ` +
        `duplicados_eliminados=${scoped.duplicatesRemoved}`,
    );
    saveScenarios(appSlug, recordingId, scenarios);

    const derived: SessionTrace = {
      ...discardFrames(trace),
      narrative: enrichment.narrative,
      status: "derived",
    };
    saveTrace(derived);

    onLog(`[recording] ${scenarios.length} escenarios generados desde la grabación ${recordingId}`);
    return { summary: toSummary(derived, scenarios.length), scenarios, narrative: enrichment.narrative, semanticModel: semantic };
  } finally {
    // Even on failure the frames go: they only ever existed to feed this call.
    const current = loadTrace(appSlug, recordingId);
    if (current && current.status !== "derived") {
      saveTrace(discardFrames(current));
    }
  }
}

export function getRecordingScenarios(appSlug: string, recordingId: string): RecordedScenario[] {
  return loadScenarios(appSlug, recordingId);
}
