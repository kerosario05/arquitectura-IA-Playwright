"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordingError = void 0;
exports.activeRecordingFor = activeRecordingFor;
exports.getActiveRecording = getActiveRecording;
exports.resolveRecordingTarget = resolveRecordingTarget;
exports.startRecording = startRecording;
exports.recordingProgress = recordingProgress;
exports.stopRecording = stopRecording;
exports.deriveScenarios = deriveScenarios;
exports.getRecordingScenarios = getRecordingScenarios;
const node_crypto_1 = require("node:crypto");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const job_store_1 = require("./job-store");
const mobile_test_runner_1 = require("./mobile-test-runner");
const emulator_manager_1 = require("../../mobile/emulator-manager");
const android_sdk_1 = require("../../mobile/android-sdk");
const project_reader_1 = require("../../db/project-reader");
const android_session_recorder_1 = require("../../recording/mobile/android-session-recorder");
const web_session_recorder_1 = require("../../recording/web/web-session-recorder");
const recording_store_1 = require("../../recording/recording-store");
const trace_normalizer_1 = require("../../recording/trace-normalizer");
const trace_to_scenario_1 = require("../../recording/trace-to-scenario");
const canonical_recording_contract_1 = require("../../recording/canonical-recording-contract");
const trace_ai_enricher_1 = require("../../recording/trace-ai-enricher");
const ai_provider_factory_1 = require("../../ai/ai-provider-factory");
const semantic_recording_1 = require("../../recording/semantic-recording");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const active = new Map();
/** Index from app slug to recording id, so a caller only holding the slug can find it. */
function activeRecordingFor(projectSlug) {
    for (const entry of active.values()) {
        if (entry.trace.projectSlug === projectSlug)
            return entry;
    }
    return undefined;
}
function getActiveRecording(recordingId) {
    return active.get(recordingId);
}
class RecordingError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "RecordingError";
    }
}
exports.RecordingError = RecordingError;
/**
 * Reads the project registry to decide what to record.
 *
 * The whole point of picking a project first is that nothing about the target is typed by
 * hand: package, activity and base URL all come from the configuration the user already
 * filled in, so a recording can never drift onto a different app than the project's.
 */
async function resolveRecordingTarget(projectSlug) {
    const cfg = await (0, project_reader_1.getProjectConfigurationBySlug)(projectSlug);
    if (!cfg) {
        throw new RecordingError("PROJECT_NOT_FOUND", `No existe el proyecto ${projectSlug}`);
    }
    const isMobile = cfg.projectType === 2;
    if (isMobile) {
        if (!cfg.mobile?.packageName) {
            throw new RecordingError("PROJECT_NOT_CONFIGURED", `El proyecto ${projectSlug} no tiene configuración móvil (packageName) para grabar`);
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
        throw new RecordingError("PROJECT_NOT_CONFIGURED", `El proyecto ${projectSlug} no tiene baseUrl configurada para grabar`);
    }
    return {
        appSlug: cfg.slug,
        platform: "web",
        baseUrl: cfg.web.baseUrl,
        ignoreHTTPSErrors: cfg.web.ignoreHTTPSErrors === true,
    };
}
/** Brings the app to the foreground so the walkthrough starts where the user expects. */
async function launchAndroidApp(deviceId, appPackage, appActivity, onLog) {
    const adb = (0, android_sdk_1.resolveAndroidSdk)().adbPath;
    const component = appActivity
        ? appActivity.startsWith(".") || !appActivity.includes("/")
            ? `${appPackage}/${appActivity}`
            : appActivity
        : undefined;
    try {
        await execFileAsync(adb, ["-s", deviceId, "shell", "am", "force-stop", appPackage]);
        if (component) {
            await execFileAsync(adb, ["-s", deviceId, "shell", "am", "start", "-n", component]);
        }
        else {
            await execFileAsync(adb, ["-s", deviceId, "shell", "monkey", "-p", appPackage, "-c", "android.intent.category.LAUNCHER", "1"]);
        }
        onLog(`[recording] app ${appPackage} en primer plano`);
        await new Promise((r) => setTimeout(r, 2500));
    }
    catch (err) {
        onLog(`[recording] no se pudo abrir la app automáticamente: ${err instanceof Error ? err.message : String(err)}`);
    }
}
async function startRecording(params) {
    // A label identifies the recording in the list; it is not the scenario goal.
    // Recording derivation must never silently promote a generic label to goal authority.
    const requestedGoal = params.recordingGoal?.trim();
    if (!requestedGoal) {
        throw new RecordingError("MISSING_RECORDING_GOAL", "Define el objetivo de la grabación antes de iniciar");
    }
    const target = await resolveRecordingTarget(params.projectSlug);
    const platform = params.platform ?? target.platform;
    const existing = activeRecordingFor(params.projectSlug);
    if (existing) {
        throw new RecordingError("RECORDING_ALREADY_ACTIVE", `Ya hay una grabación activa para ${params.projectSlug} (${existing.recordingId})`);
    }
    const recordingId = (0, node_crypto_1.randomUUID)();
    const job = job_store_1.jobStore.create("session-recording", {
        recordingId,
        projectSlug: params.projectSlug,
        platform,
    });
    const onLog = (line) => job_store_1.jobStore.appendLog(job.id, line);
    job_store_1.jobStore.update(job.id, { status: "running", startedAt: new Date().toISOString() });
    const trace = {
        recordingId,
        projectSlug: params.projectSlug,
        appSlug: target.appSlug,
        platform,
        appPackage: target.appPackage,
        baseUrl: target.baseUrl,
        label: params.label,
        recordingGoal: (0, semantic_recording_1.normalizeRecordingGoal)(params.recordingGoal, "USER_DECLARED"),
        recordingDataPolicy: (0, semantic_recording_1.normalizeRecordingDataPolicy)(params.recordingDataPolicy),
        startedAt: new Date().toISOString(),
        status: "starting",
        events: [],
        screens: [],
    };
    onLog(`[recording:goal-lineage] backendRequestGoal=${JSON.stringify(params.recordingGoal)} jobGoal=${JSON.stringify(trace.recordingGoal?.declaredGoal)} traceGoal=${JSON.stringify(trace.recordingGoal?.normalizedGoal)}`);
    const framesDir = (0, recording_store_1.ensureFramesDir)(recordingId);
    try {
        let recorder;
        if (platform === "android") {
            const mobileTarget = (0, mobile_test_runner_1.resolveMobileTarget)({
                appSlug: target.appSlug,
                apkPath: target.apkPath,
                appPackage: target.appPackage,
                appActivity: target.appActivity,
                avdName: params.avdName,
                headless: params.headless,
            });
            await (0, mobile_test_runner_1.ensureMobileInfra)(mobileTarget, onLog, { runId: recordingId });
            const deviceId = (0, emulator_manager_1.getStatus)().deviceId;
            if (!deviceId) {
                throw new RecordingError("DEVICE_NOT_AVAILABLE", "No hay dispositivo Android disponible para grabar");
            }
            await launchAndroidApp(deviceId, target.appPackage, target.appActivity, onLog);
            recorder = new android_session_recorder_1.AndroidSessionRecorder({
                deviceId,
                appPackage: target.appPackage,
                framesDir,
                persistQaCredentials: true,
                sensitiveLabels: params.sensitiveLabels,
                onEvent: (event) => {
                    trace.events.push(event);
                    (0, recording_store_1.saveTrace)(trace);
                },
                onScreen: (screen) => {
                    const existingIndex = trace.screens.findIndex((item) => item.screenKey === screen.screenKey);
                    if (existingIndex >= 0)
                        trace.screens[existingIndex] = screen;
                    else
                        trace.screens.push(screen);
                    (0, recording_store_1.saveTrace)(trace);
                },
                onLog,
            });
        }
        else {
            recorder = new web_session_recorder_1.WebSessionRecorder({
                baseUrl: target.baseUrl,
                ignoreHTTPSErrors: target.ignoreHTTPSErrors,
                framesDir,
                persistQaCredentials: true,
                sensitiveLabels: params.sensitiveLabels,
                onEvent: (event) => {
                    trace.events.push(event);
                    (0, recording_store_1.saveTrace)(trace);
                },
                onScreen: (screen) => {
                    const existingIndex = trace.screens.findIndex((item) => item.screenKey === screen.screenKey);
                    if (existingIndex >= 0)
                        trace.screens[existingIndex] = screen;
                    else
                        trace.screens.push(screen);
                    (0, recording_store_1.saveTrace)(trace);
                },
                onLog,
            });
        }
        const started = await recorder.start();
        if (!started) {
            throw new RecordingError("TOUCH_CAPTURE_UNAVAILABLE", "No se pueden capturar los toques en este dispositivo: ningún dispositivo de entrada reporta " +
                "ejes de posición (revisa el log de la grabación para ver los dispositivos detectados). " +
                "La grabación se detiene en lugar de producir un recorrido sin acciones.");
        }
        trace.status = "recording";
        (0, recording_store_1.saveTrace)(trace);
        onLog(`[recording:goal-lineage] persistedGoal=${JSON.stringify((0, recording_store_1.loadTrace)(trace.appSlug, trace.recordingId)?.recordingGoal?.declaredGoal)}`);
        active.set(recordingId, { recordingId, jobId: job.id, trace, recorder });
        onLog(`[recording] grabación ${recordingId} iniciada sobre ${target.appSlug} (${platform})`);
        return { recordingId, jobId: job.id, summary: (0, recording_store_1.toSummary)(trace) };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        trace.status = "failed";
        trace.errorMessage = message;
        (0, recording_store_1.saveTrace)(trace);
        job_store_1.jobStore.update(job.id, { status: "failed", errorMessage: message, completedAt: new Date().toISOString() });
        onLog(`[recording] fallo al iniciar: ${message}`);
        throw err;
    }
}
function recordingProgress(recordingId) {
    const entry = active.get(recordingId);
    if (!entry)
        return null;
    const source = { events: [...entry.trace.events], screens: [...entry.trace.screens] };
    if (entry.liveProjection && !(0, semantic_recording_1.hasSignificantSemanticChange)(entry.liveProjection.source, source)) {
        entry.liveProjection.noiseRefreshSkipped += 1;
        return {
            summary: (0, recording_store_1.toSummary)(entry.trace),
            live: { ...entry.recorder.snapshotProgress(), semanticRefreshCount: entry.liveProjection.refreshCount, noiseRefreshSkipped: entry.liveProjection.noiseRefreshSkipped },
            scenarios: entry.liveProjection.scenarios,
            semanticModel: entry.liveProjection.semanticModel,
        };
    }
    const events = (0, trace_normalizer_1.normalizeEvents)(source.events);
    const primary = (0, trace_to_scenario_1.buildHappyPathScenario)(entry.trace, events);
    const livePrimary = { ...primary, status: "IN_PROGRESS" };
    const segments = (0, trace_normalizer_1.segmentTrace)(events, entry.trace);
    const candidates = [
        ...(0, trace_to_scenario_1.buildGateNegatives)(entry.trace, segments, primary),
        ...(0, trace_to_scenario_1.buildAlternativePathScenarios)(entry.trace, events, primary),
    ];
    const scoped = (0, trace_to_scenario_1.filterGoalScopedSuggestions)(entry.trace.recordingGoal?.normalizedGoal ?? entry.trace.label, candidates);
    const semanticBase = (0, semantic_recording_1.buildSemanticRecordingModel)(entry.trace, events);
    const semanticModel = (0, semantic_recording_1.attachScenarioSuggestions)({
        ...semanticBase,
        primaryScenario: {
            scenarioId: livePrimary.scenarioId,
            title: livePrimary.title,
            provenance: "OBSERVED",
            status: "IN_PROGRESS",
            sourceEventRefs: livePrimary.sourceEventRefs ?? [],
            traceBacked: true,
            containsUnexecutedActions: false,
            needsReview: livePrimary.hasUncertainSteps,
        },
    }, scoped.suggestions.map((scenario) => ({
        suggestionId: scenario.scenarioId,
        title: scenario.title,
        provenance: scenario.suggestionCategory === "DERIVED_VALIDATION" ? "DERIVED_VALIDATION" : "DERIVED_ALTERNATIVE",
        confidence: scenario.confidence ?? 0.85,
        goalRelevanceScore: scenario.goalRelevanceScore ?? 0.5,
        goalRelevanceReasons: scenario.goalRelevanceReasons ?? [],
        needsReview: true,
        rationale: scenario.rationale ?? "Derivado de evidencia observada durante la grabación.",
        sourceEventRefs: scenario.sourceEventRefs ?? events.map((_, index) => `event-${index + 1}`),
        steps: scenario.testRailSteps.map((step) => step.content),
        expectedResultCandidate: scenario.testRailSteps.at(-1)?.expected,
        oracleAuthority: "review_required",
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
        summary: (0, recording_store_1.toSummary)(entry.trace),
        live: { ...entry.recorder.snapshotProgress(), semanticRefreshCount: entry.liveProjection.refreshCount, noiseRefreshSkipped: entry.liveProjection.noiseRefreshSkipped },
        scenarios: entry.liveProjection.scenarios,
        semanticModel,
    };
}
async function stopRecording(recordingId) {
    const entry = active.get(recordingId);
    if (!entry) {
        throw new RecordingError("RECORDING_NOT_ACTIVE", `No hay una grabación activa con id ${recordingId}`);
    }
    const onLog = (line) => job_store_1.jobStore.appendLog(entry.jobId, line);
    entry.trace.status = "stopping";
    const { events, screens } = await entry.recorder.stop();
    const endedAt = new Date();
    entry.trace.events = events;
    entry.trace.screens = screens;
    entry.trace.endedAt = endedAt.toISOString();
    entry.trace.durationMs = endedAt.getTime() - new Date(entry.trace.startedAt).getTime();
    entry.trace.status = "stopped";
    (0, recording_store_1.saveTrace)(entry.trace);
    // Stopping is the authoritative raw-recording boundary.  The deterministic semantic base
    // does not require AI and is persisted now so a stopped recording never has a trace without
    // its semantic authority.  Scenario suggestions remain the separate derive operation.
    const stoppedSemantic = (0, semantic_recording_1.buildSemanticRecordingModel)(entry.trace, (0, trace_normalizer_1.normalizeEvents)(events));
    (0, recording_store_1.saveSemanticRecording)(stoppedSemantic);
    const observedPrimary = (0, trace_to_scenario_1.materializeObservedPrimaryScenario)(entry.trace, (0, trace_normalizer_1.normalizeEvents)(events));
    if (observedPrimary) {
        // STOP owns the observed primary. This is the only scenario written by the deterministic
        // lane; deriveScenarios may later merge optional suggestions without cloning this identity.
        (0, recording_store_1.saveScenarios)(entry.trace.appSlug, recordingId, [observedPrimary]);
        onLog(`[recording:lifecycle] state=PRIMARY_MATERIALIZED scenarioId=${observedPrimary.scenarioId} aiScenarioGenerationInvoked=false`);
    }
    else {
        onLog(`[recording:lifecycle] state=PRIMARY_NOT_MATERIALIZED reason=insufficient_observed_authority aiScenarioGenerationInvoked=false`);
    }
    onLog(`[recording:lifecycle] state=TRACE_READY semanticBase=SEMANTIC_READY recordingId=${recordingId}`);
    active.delete(recordingId);
    const stats = (0, trace_normalizer_1.summarizeTrace)((0, trace_normalizer_1.normalizeEvents)(events), entry.trace);
    onLog(`[recording] grabación detenida: ${stats.actions} acciones, ${stats.screens} pantallas, ${stats.transitions} transiciones`);
    job_store_1.jobStore.update(entry.jobId, { status: "done", completedAt: endedAt.toISOString() });
    return (0, recording_store_1.toSummary)(entry.trace, observedPrimary ? 1 : 0);
}
/**
 * Turns a stopped recording into scenarios, then destroys the visual material.
 *
 * The frame deletion is in a `finally` and not at the end of the happy path: a derivation
 * that throws must not leave screenshots of a banking session on disk. Re-deriving later
 * works from the trace and the narrative, which is exactly why the narrative is produced
 * before the frames go.
 */
async function deriveScenarios(appSlug, recordingId, options = {}) {
    const trace = (0, recording_store_1.loadTrace)(appSlug, recordingId);
    if (!trace) {
        throw new RecordingError("RECORDING_NOT_FOUND", `No se encontró la grabación ${recordingId}`);
    }
    if (trace.status === "recording" || trace.status === "starting") {
        throw new RecordingError("RECORDING_IN_PROGRESS", "Detén la grabación antes de generar escenarios");
    }
    if (!(trace.recordingGoal?.declaredGoal?.trim() || trace.recordingGoal?.normalizedGoal?.trim())) {
        throw new RecordingError("MISSING_RECORDING_GOAL", "No se puede generar escenarios sin un objetivo de grabación declarado");
    }
    const entryJobId = active.get(recordingId)?.jobId;
    const onLog = (line) => {
        if (entryJobId)
            job_store_1.jobStore.appendLog(entryJobId, line);
        else
            console.log(line);
    };
    try {
        const events = (0, trace_normalizer_1.normalizeEvents)(trace.events);
        const segments = (0, trace_normalizer_1.segmentTrace)(events, trace);
        const happyPath = (0, trace_to_scenario_1.buildHappyPathScenario)(trace, events, { title: options.title });
        let ai;
        try {
            // Recording proposals share the canonical scenario-generation purpose/configuration.
            // This preserves purpose-specific provider/model overrides instead of silently using
            // the generic AI lane.
            ai = await (0, ai_provider_factory_1.createScenarioAiProvider)();
        }
        catch {
            ai = undefined;
        }
        const enrichment = await (0, trace_ai_enricher_1.enrichFromTrace)(trace, segments, happyPath, ai, onLog);
        onLog(`[recording:goal-lineage] deriveGoal=${JSON.stringify(trace.recordingGoal?.declaredGoal)} scenarioGoal=${JSON.stringify(trace.recordingGoal?.declaredGoal ?? trace.recordingGoal?.normalizedGoal)}`);
        const enrichedHappyPath = {
            ...(0, trace_ai_enricher_1.applyStory)(happyPath, enrichment),
            // The declared goal is the authority for the observed primary. AI enrichment can
            // improve prose, but may not turn the primary into another case.
            ...(trace.recordingGoal?.declaredGoal?.trim()
                ? { title: (0, trace_to_scenario_1.capTitle)(trace.recordingGoal.declaredGoal.trim()) }
                : {}),
        };
        // Build the semantic model before suggestions so deterministic mutation materialization
        // can use the observed component/option/repeat evidence. The primary remains observed and
        // immutable; only derived scenarios are produced from it.
        const baseSemantic = (0, semantic_recording_1.buildSemanticRecordingModel)(trace, events);
        const canonicalPrimary = (0, canonical_recording_contract_1.enrichRecordedScenarioContract)(enrichedHappyPath, baseSemantic.canonicalInteractions ?? [], baseSemantic.technicalObservations.map((observation) => observation.observationId), baseSemantic);
        const mutationOpportunities = (0, canonical_recording_contract_1.detectMutationOpportunities)(canonicalPrimary, baseSemantic);
        const mutationRejectedReasons = [];
        const mutationScenarios = mutationOpportunities.map((opportunity) => {
            const materializerInput = {
                primaryScenarioId: opportunity.basePrimaryScenarioId,
                mutationType: opportunity.mutationType,
                operationTypes: opportunity.operations.map((operation) => operation.type),
                entityScopes: opportunity.operations.flatMap((operation) => operation.type === "clone_entity" ? [operation.sourceEntityScope, operation.targetEntityScope] : operation.type === "remove_entity" ? [operation.entityScope] : []),
            };
            const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(canonicalPrimary, opportunity);
            const diagnostics = materialized.mutationDiagnostics;
            onLog(`[recording:mutation-audit] proposalMutationType=${opportunity.mutationType} parsedOperations=${JSON.stringify(materializerInput.operationTypes)} materializerInput=${JSON.stringify(materializerInput)} materializerOutputStepCount=${materialized.testRailSteps.length} materializerOutputEntityScopes=${JSON.stringify(materialized.entityActionBlocks?.map((block) => block.entityScope) ?? [])}`);
            if (diagnostics?.rejectionReason)
                mutationRejectedReasons.push(diagnostics.rejectionReason);
            return materialized;
        }).filter((scenario) => !scenario.mutationDiagnostics?.rejectionReason);
        const negatives = (0, trace_to_scenario_1.buildGateNegatives)(trace, segments, canonicalPrimary);
        const aiNegatives = enrichment.extraNegatives.map((n, index) => ({
            scenarioId: `${enrichedHappyPath.scenarioId}-AI-${index + 1}`,
            title: (0, trace_to_scenario_1.capTitle)(n.title),
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
        const aiCandidateEvaluations = enrichment.aiProposals.map((proposal) => {
            const quality = (0, trace_to_scenario_1.evaluateRecordingSuggestionQuality)(trace.recordingGoal?.declaredGoal ?? trace.recordingGoal?.normalizedGoal ?? trace.label, trace, canonicalPrimary, proposal);
            return { proposal, quality, scenario: (0, trace_to_scenario_1.materializeRecordingSuggestion)(canonicalPrimary, proposal, quality) };
        });
        const aiProposals = aiCandidateEvaluations
            .filter(({ quality }) => quality.finalDecision === "accepted")
            .map(({ scenario }) => scenario);
        // Ordered as a reviewer reads them: what was walked end to end, then its blocks, then
        // everything the recording only justifies.
        // Segments remain derivation evidence only. A recording goal has one observed primary;
        // top-level suggestions are filtered and deduplicated separately.
        const segmentScenarios = (0, trace_to_scenario_1.buildSegmentScenarios)(trace, events, segments, canonicalPrimary);
        const alternatives = (0, trace_to_scenario_1.buildAlternativePathScenarios)(trace, events, canonicalPrimary);
        const scoped = (0, trace_to_scenario_1.filterGoalScopedSuggestions)(trace.recordingGoal?.normalizedGoal ?? trace.label, [...negatives, ...aiNegatives, ...aiProposals, ...alternatives, ...mutationScenarios], 0.6, canonicalPrimary);
        const scenarios = [canonicalPrimary, ...scoped.suggestions];
        const previousSemantic = (0, recording_store_1.loadSemanticRecording)(appSlug, recordingId);
        const derivation = {
            version: (previousSemantic?.derivation?.version ?? 0) + 1,
            generatedAt: new Date().toISOString(),
            executed: true,
            primaryCount: 1,
            suggestionCount: scoped.suggestions.length,
            opportunitiesDetected: mutationOpportunities.length,
            candidatesGenerated: enrichment.aiProposals.length + negatives.length + alternatives.length + mutationScenarios.length,
            rejectedBecause: [
                ...(scoped.irrelevantCandidatesRejected > 0 ? ["goal_relevance_gate"] : []),
                ...(scoped.duplicatesRemoved > 0 ? ["duplicate_suggestion"] : []),
                ...scoped.rejectedBecause,
                ...mutationRejectedReasons,
                ...aiCandidateEvaluations.flatMap(({ quality }) => quality.rejectionReason ? [quality.rejectionReason] : []),
            ],
        };
        const semantic = (0, semantic_recording_1.attachScenarioSuggestions)({
            ...baseSemantic,
            mutationOpportunities,
            suggestionDiagnostics: {
                opportunitiesDetected: mutationOpportunities.length,
                candidatesGenerated: enrichment.aiProposals.length + negatives.length + alternatives.length + mutationScenarios.length,
                acceptedForDisplay: scoped.suggestions.length,
                rejectedBecause: [
                    ...(scoped.irrelevantCandidatesRejected > 0 ? ["goal_relevance_gate"] : []),
                    ...(scoped.duplicatesRemoved > 0 ? ["duplicate_suggestion"] : []),
                    ...scoped.rejectedBecause,
                    ...mutationRejectedReasons,
                    ...aiCandidateEvaluations.flatMap(({ quality }) => quality.rejectionReason ? [quality.rejectionReason] : []),
                ],
            },
            derivation,
            primaryScenario: {
                scenarioId: canonicalPrimary.scenarioId,
                title: canonicalPrimary.title,
                provenance: "OBSERVED",
                sourceEventRefs: canonicalPrimary.sourceEventRefs ?? [],
                traceBacked: true,
                containsUnexecutedActions: false,
                needsReview: canonicalPrimary.hasUncertainSteps,
            },
            aiGeneration: {
                providerSuccess: enrichment.schemaValid && !enrichment.fallbackUsed,
                schemaValidation: enrichment.schemaValid,
                fallbackUsed: enrichment.fallbackUsed,
                provider: enrichment.usage?.provider,
                model: enrichment.usage?.model,
                inputTokens: enrichment.usage?.inputTokens,
                cachedTokens: enrichment.usage?.cachedInputTokens,
                nonCachedTokens: enrichment.usage?.nonCachedInputTokens,
                outputTokens: enrichment.usage?.outputTokens,
                totalTokens: enrichment.usage?.totalPhysicalTokens,
                contextBeforeChars: enrichment.contextBeforeChars,
                contextAfterChars: enrichment.contextAfterChars,
                candidates: aiCandidateEvaluations.map(({ proposal, quality }) => ({
                    title: proposal.title,
                    type: proposal.type,
                    rationale: proposal.rationale,
                    sourceEvidenceRefs: proposal.sourceEvidenceRefs,
                    expectedResultCandidate: proposal.expectedResultCandidate,
                    oracleAuthority: proposal.oracleAuthority,
                    goalRelated: proposal.goalRelated,
                    needsReview: proposal.needsReview,
                    finalDecision: quality.finalDecision,
                    rejectionReason: quality.rejectionReason,
                })),
                providerRejected: enrichment.aiRejected,
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
            sharedSetupRef: scenario.sharedSetupRef,
            scenarioSpecificSteps: scenario.scenarioSpecificSteps?.map((step) => step.content),
            quality: scenario.quality,
            fullStepsAvailable: true,
            entityScopes: scenario.entityActionBlocks?.map((block) => block.entityScope) ?? [],
            runtimeInputRequirements: scenario.runtimeInputRequirements,
            readiness: scenario.readiness,
            mutationType: scenario.mutation?.mutationType,
        })));
        (0, recording_store_1.saveSemanticRecording)(semantic);
        onLog(`[recording] escenarios: 1 principal observado, ${scoped.suggestions.length} sugerencias relevantes; ` +
            `segmentos internos=${segmentScenarios.length}, candidatos_rechazados=${scoped.irrelevantCandidatesRejected}, ` +
            `duplicados_eliminados=${scoped.duplicatesRemoved}`);
        (0, recording_store_1.saveScenarios)(appSlug, recordingId, scenarios);
        const derived = {
            ...(0, recording_store_1.discardFrames)(trace),
            narrative: enrichment.narrative,
            status: "derived",
        };
        (0, recording_store_1.saveTrace)(derived);
        onLog(`[recording] ${scenarios.length} escenarios generados desde la grabación ${recordingId}`);
        return { summary: (0, recording_store_1.toSummary)(derived, scenarios.length), scenarios, narrative: enrichment.narrative, semanticModel: semantic, derivation };
    }
    finally {
        // Even on failure the frames go: they only ever existed to feed this call.
        const current = (0, recording_store_1.loadTrace)(appSlug, recordingId);
        if (current && current.status !== "derived") {
            (0, recording_store_1.saveTrace)((0, recording_store_1.discardFrames)(current));
        }
    }
}
function getRecordingScenarios(appSlug, recordingId) {
    return (0, recording_store_1.loadScenarios)(appSlug, recordingId);
}
