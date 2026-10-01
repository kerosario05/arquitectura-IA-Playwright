/**
 * Observable lifecycle of a recording's step generation ("derive").
 *
 * Derive used to run entirely inside the HTTP request: on a long recording the client or the QA Lab
 * proxy gave up (504 after 5 min) while the engine kept working, and nothing told the panel whether
 * generation was still running, done or failed. Derive now runs in the background and reports its
 * stage here; the panel polls it to show "Generando pasos…".
 *
 * In-memory on purpose: progress only matters while this process is generating. After a restart a
 * finished derivation is still visible through the trace status ("derived").
 */

export const DERIVATION_STAGES = ["normalizing", "building_steps", "ai_enrichment", "saving"] as const;
export type DerivationStage = (typeof DERIVATION_STAGES)[number];

export type DerivationStageUpdate = {
  stage: DerivationStage;
  /** Functional actions captured (taps, fills, selections, key presses) after normalization. */
  actionCount?: number;
  /** Steps generated for the observed primary scenario. */
  stepCount?: number;
};

export type DerivationStatus = "deriving" | "derived" | "failed";

export type DerivationProgress = {
  recordingId: string;
  status: DerivationStatus;
  stage?: DerivationStage;
  /** 1-based position of `stage` in DERIVATION_STAGES (0 before the first stage starts). */
  stageIndex: number;
  stageCount: number;
  actionCount?: number;
  stepCount?: number;
  scenarioCount?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
};

const progressByRecording = new Map<string, DerivationProgress>();

export function getDerivationProgress(recordingId: string): DerivationProgress | undefined {
  const progress = progressByRecording.get(recordingId);
  return progress ? { ...progress } : undefined;
}

export function isDeriving(recordingId: string): boolean {
  return progressByRecording.get(recordingId)?.status === "deriving";
}

export function beginDerivation(recordingId: string, now: () => Date = () => new Date()): DerivationProgress {
  const at = now().toISOString();
  const progress: DerivationProgress = {
    recordingId,
    status: "deriving",
    stageIndex: 0,
    stageCount: DERIVATION_STAGES.length,
    startedAt: at,
    updatedAt: at,
  };
  progressByRecording.set(recordingId, progress);
  return { ...progress };
}

export function reportDerivationStage(recordingId: string, update: DerivationStageUpdate, now: () => Date = () => new Date()): void {
  const progress = progressByRecording.get(recordingId);
  if (!progress || progress.status !== "deriving") return;
  progress.stage = update.stage;
  progress.stageIndex = DERIVATION_STAGES.indexOf(update.stage) + 1;
  if (update.actionCount !== undefined) progress.actionCount = update.actionCount;
  if (update.stepCount !== undefined) progress.stepCount = update.stepCount;
  progress.updatedAt = now().toISOString();
}

export function completeDerivation(recordingId: string, scenarioCount: number, now: () => Date = () => new Date()): void {
  const progress = progressByRecording.get(recordingId);
  if (!progress) return;
  const at = now().toISOString();
  progress.status = "derived";
  progress.stageIndex = progress.stageCount;
  progress.scenarioCount = scenarioCount;
  progress.updatedAt = at;
  progress.completedAt = at;
}

export function failDerivation(recordingId: string, error: unknown, now: () => Date = () => new Date()): void {
  const progress = progressByRecording.get(recordingId);
  if (!progress) return;
  const at = now().toISOString();
  progress.status = "failed";
  progress.errorCode = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "DERIVATION_FAILED";
  progress.errorMessage = error instanceof Error ? error.message : String(error);
  progress.updatedAt = at;
  progress.completedAt = at;
}

/**
 * Starts `run` in the background unless a derivation for this recording is already running, in
 * which case the running one is returned (a second click never launches a second derivation).
 */
export function startBackgroundDerivation(
  recordingId: string,
  run: (onProgress: (update: DerivationStageUpdate) => void) => Promise<{ scenarioCount: number }>,
): DerivationProgress {
  const running = progressByRecording.get(recordingId);
  if (running?.status === "deriving") return { ...running };
  const started = beginDerivation(recordingId);
  // Next turn of the event loop: the derivation's synchronous part (normalizing, building steps)
  // must not run before the caller has answered its HTTP request.
  setImmediate(() => {
    Promise.resolve()
      .then(() => run((update) => reportDerivationStage(recordingId, update)))
      .then((result) => completeDerivation(recordingId, result.scenarioCount))
      .catch((err) => {
        console.error(`[recording-derivation] recordingId=${recordingId} failed: ${err instanceof Error ? err.message : String(err)}`);
        failDerivation(recordingId, err);
      });
  });
  return started;
}

/** Test-only reset. */
export function resetDerivationProgressForTests(): void {
  progressByRecording.clear();
}
