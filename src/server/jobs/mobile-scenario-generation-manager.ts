import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { config, requireJiraConfig } from "../../config/env";
import { JiraClient } from "../../clients/jira.client";
import {
  generateMobileScenarios,
  type MobileGeneratedScenario,
  type MobileRejectedIssue,
  type MobileScenarioGenerationResult,
  type MobileScenarioIssueCompletedEvent,
  type MobileScenarioIssueStartEvent,
} from "../../scenarios/mobile-scenario-generator";

const MOBILE_SCENARIO_GENERATION_VERSION = "mobile-scenarios-async-v1";

export type MobileScenarioGenerationStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type MobileScenarioGenerationIssueProgress = {
  issueKey: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  scenarioCount: number;
  rejectedCount: number;
  reasonCode?: string;
  errorMessage?: string;
};

export type MobileScenarioGenerationRequest = {
  projectKey: string;
  sprintId?: number;
  activeSprint?: boolean;
  status?: string;
  maxResults?: number;
  appSlug?: string;
  selectedIssueKeys?: string[];
  sourceRevision?: string;
  launchDraftId?: string;
};

export type MobileScenarioGenerationJobResult = MobileScenarioGenerationResult & {
  scenariosByIssue: Record<string, MobileGeneratedScenario[]>;
  rejectedByIssue: Record<string, MobileRejectedIssue[]>;
  consolidated: {
    totalScenarios: number;
    totalRejected: number;
    perIssueScenarioCount: Record<string, number>;
    perIssueRejectedCount: Record<string, number>;
  };
};

export type MobileScenarioGenerationJob = {
  generationJobId: string;
  requestId: string;
  launchDraftId?: string;
  appSlug?: string;
  issueKeys: string[];
  idempotencyKey: string;
  idempotencyKeyHash: string;
  status: MobileScenarioGenerationStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  consumersWaiting: number;
  issueProgress: MobileScenarioGenerationIssueProgress[];
  partial: {
    scenariosByIssue: Record<string, MobileGeneratedScenario[]>;
    rejectedByIssue: Record<string, MobileRejectedIssue[]>;
    completedIssues: number;
    totalIssues: number;
    totalScenarios: number;
    totalRejected: number;
  };
  result?: MobileScenarioGenerationJobResult;
  error?: { code: string; message: string };
};

type MobileScenarioGenerationRecord = MobileScenarioGenerationJob & {
  normalizedPayload: {
    projectKey: string;
    sprintId?: number;
    activeSprint?: boolean;
    status?: string;
    maxResults: number;
    appSlug?: string;
    selectedIssueKeys: string[];
    sourceRevision?: string;
    launchDraftId?: string;
  };
};

type StartGenerationResult = {
  job: MobileScenarioGenerationJob;
  reused: boolean;
  cacheHit: boolean;
};

type RunnerInput = MobileScenarioGenerationRecord["normalizedPayload"];

type MobileScenarioGenerationRunner = (
  input: RunnerInput,
  handlers: {
    onIssuesResolved: (issueKeys: string[]) => void;
    onIssueStart: (event: MobileScenarioIssueStartEvent) => void;
    onIssueCompleted: (event: MobileScenarioIssueCompletedEvent) => void;
  },
) => Promise<MobileScenarioGenerationResult>;

const jobsById = new Map<string, MobileScenarioGenerationRecord>();
const idempotencyToJobId = new Map<string, string>();
const runningPromisesByJobId = new Map<string, Promise<void>>();
let generationRunnerForTesting: MobileScenarioGenerationRunner | null = null;

// ── Durable persistence of terminal generation results ─────────────────────
// Survives a Node process restart so a completed/failed generation can be
// recovered by generationJobId without re-invoking the AI provider.
const GENERATION_DISK_DIR = path.join(process.cwd(), ".artifacts", "mobile-scenario-generations");

/**
 * Minimal serializable DTO persisted to disk. It carries enough app/context
 * (normalizedPayload) to keep logical multi-project isolation, and only plain
 * data — never Promises, Maps or runtime state.
 */
type PersistedGenerationDTO = {
  version: string;
  generationJobId: string;
  requestId: string;
  launchDraftId?: string;
  appSlug?: string;
  issueKeys: string[];
  idempotencyKey: string;
  idempotencyKeyHash: string;
  status: MobileScenarioGenerationStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  consumersWaiting: number;
  issueProgress: MobileScenarioGenerationIssueProgress[];
  partial: MobileScenarioGenerationRecord["partial"];
  result?: MobileScenarioGenerationRecord["result"];
  error?: MobileScenarioGenerationRecord["error"];
  normalizedPayload: MobileScenarioGenerationRecord["normalizedPayload"];
};

function toPersistedDTO(record: MobileScenarioGenerationRecord): PersistedGenerationDTO {
  return {
    version: MOBILE_SCENARIO_GENERATION_VERSION,
    generationJobId: record.generationJobId,
    requestId: record.requestId,
    launchDraftId: record.launchDraftId,
    appSlug: record.appSlug,
    issueKeys: [...record.issueKeys],
    idempotencyKey: record.idempotencyKey,
    idempotencyKeyHash: record.idempotencyKeyHash,
    status: record.status,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    consumersWaiting: record.consumersWaiting,
    issueProgress: record.issueProgress.map((entry) => ({ ...entry })),
    partial: {
      scenariosByIssue: record.partial.scenariosByIssue,
      rejectedByIssue: record.partial.rejectedByIssue,
      completedIssues: record.partial.completedIssues,
      totalIssues: record.partial.totalIssues,
      totalScenarios: record.partial.totalScenarios,
      totalRejected: record.partial.totalRejected,
    },
    result: record.result,
    error: record.error,
    normalizedPayload: record.normalizedPayload,
  };
}

function generationDiskPath(generationJobId: string): string {
  return path.join(GENERATION_DISK_DIR, `${generationJobId}.json`);
}

/** Atomic write: write to a .tmp file, then rename over the definitive file. */
function persistGenerationRecord(record: MobileScenarioGenerationRecord): void {
  try {
    fs.mkdirSync(GENERATION_DISK_DIR, { recursive: true });
    const finalPath = generationDiskPath(record.generationJobId);
    const tmpPath = `${finalPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(toPersistedDTO(record), null, 2), "utf-8");
    fs.renameSync(tmpPath, finalPath);
  } catch {
    // Persistence is best-effort: a failure must never break the in-memory flow.
  }
}

/**
 * Lazy recovery: reconstruct a record from disk when it is absent from memory.
 * Returns null (=> NOT_FOUND) when the file is missing, corrupt, or the id does
 * not match. Never triggers a new AI call.
 */
function loadGenerationRecord(generationJobId: string): MobileScenarioGenerationRecord | null {
  try {
    const finalPath = generationDiskPath(generationJobId);
    if (!fs.existsSync(finalPath)) return null;
    const raw = fs.readFileSync(finalPath, "utf-8");
    const dto = JSON.parse(raw) as PersistedGenerationDTO;
    if (!dto || typeof dto !== "object" || dto.generationJobId !== generationJobId) return null;
    if (typeof dto.status !== "string" || !Array.isArray(dto.issueKeys)) return null;
    return {
      generationJobId: dto.generationJobId,
      requestId: dto.requestId,
      launchDraftId: dto.launchDraftId,
      appSlug: dto.appSlug,
      issueKeys: [...dto.issueKeys],
      idempotencyKey: dto.idempotencyKey,
      idempotencyKeyHash: dto.idempotencyKeyHash,
      status: dto.status,
      createdAt: dto.createdAt,
      startedAt: dto.startedAt,
      finishedAt: dto.finishedAt,
      consumersWaiting: typeof dto.consumersWaiting === "number" ? dto.consumersWaiting : 0,
      issueProgress: Array.isArray(dto.issueProgress) ? dto.issueProgress.map((entry) => ({ ...entry })) : [],
      partial: {
        scenariosByIssue: dto.partial?.scenariosByIssue ?? {},
        rejectedByIssue: dto.partial?.rejectedByIssue ?? {},
        completedIssues: dto.partial?.completedIssues ?? 0,
        totalIssues: dto.partial?.totalIssues ?? 0,
        totalScenarios: dto.partial?.totalScenarios ?? 0,
        totalRejected: dto.partial?.totalRejected ?? 0,
      },
      result: dto.result,
      error: dto.error,
      normalizedPayload: dto.normalizedPayload,
    };
  } catch {
    return null;
  }
}

function isTerminalStatus(status: MobileScenarioGenerationStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function normalizeSelectedIssueKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((entry) => String(entry ?? "").trim())
      .filter((entry) => entry.length > 0),
  )).sort();
}

function normalizeRequest(input: MobileScenarioGenerationRequest): MobileScenarioGenerationRecord["normalizedPayload"] {
  const selectedIssueKeys = normalizeSelectedIssueKeys(input.selectedIssueKeys);
  return {
    projectKey: String(input.projectKey ?? "").trim(),
    sprintId: typeof input.sprintId === "number" && Number.isFinite(input.sprintId) ? Number(input.sprintId) : undefined,
    activeSprint: input.activeSprint === true,
    status: typeof input.status === "string" && input.status.trim().length > 0 ? input.status.trim() : undefined,
    maxResults: typeof input.maxResults === "number" && Number.isFinite(input.maxResults) && input.maxResults > 0
      ? Number(input.maxResults)
      : (selectedIssueKeys.length > 0 ? selectedIssueKeys.length : 50),
    appSlug: typeof input.appSlug === "string" && input.appSlug.trim().length > 0 ? input.appSlug.trim() : undefined,
    selectedIssueKeys,
    sourceRevision: typeof input.sourceRevision === "string" && input.sourceRevision.trim().length > 0 ? input.sourceRevision.trim() : undefined,
    launchDraftId: typeof input.launchDraftId === "string" && input.launchDraftId.trim().length > 0 ? input.launchDraftId.trim() : undefined,
  };
}

function buildIdempotencyKey(payload: MobileScenarioGenerationRecord["normalizedPayload"]): string {
  const idempotencyInput = {
    scope: "mobile-scenarios-generation",
    version: MOBILE_SCENARIO_GENERATION_VERSION,
    appSlug: payload.appSlug ?? "",
    projectKey: payload.projectKey,
    sprintId: payload.sprintId ?? null,
    activeSprint: payload.activeSprint === true,
    status: payload.status ?? "",
    maxResults: payload.maxResults,
    selectedIssueKeys: payload.selectedIssueKeys,
    sourceRevision: payload.sourceRevision ?? "",
    provider: process.env.AI_PROVIDER_NAME?.trim() || process.env.AI_PROVIDER?.trim() || "",
    model: process.env.AI_SCENARIO_MODEL?.trim() || process.env.AI_MODEL?.trim() || "",
  };
  return JSON.stringify(idempotencyInput);
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toSnapshot(record: MobileScenarioGenerationRecord): MobileScenarioGenerationJob {
  return {
    generationJobId: record.generationJobId,
    requestId: record.requestId,
    launchDraftId: record.launchDraftId,
    appSlug: record.appSlug,
    issueKeys: [...record.issueKeys],
    idempotencyKey: record.idempotencyKey,
    idempotencyKeyHash: record.idempotencyKeyHash,
    status: record.status,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    consumersWaiting: record.consumersWaiting,
    issueProgress: record.issueProgress.map((entry) => ({ ...entry })),
    partial: {
      scenariosByIssue: Object.fromEntries(
        Object.entries(record.partial.scenariosByIssue).map(([issueKey, scenarios]) => [issueKey, [...scenarios]]),
      ),
      rejectedByIssue: Object.fromEntries(
        Object.entries(record.partial.rejectedByIssue).map(([issueKey, rejected]) => [issueKey, [...rejected]]),
      ),
      completedIssues: record.partial.completedIssues,
      totalIssues: record.partial.totalIssues,
      totalScenarios: record.partial.totalScenarios,
      totalRejected: record.partial.totalRejected,
    },
    result: record.result,
    error: record.error,
  };
}

function updateIssueProgress(record: MobileScenarioGenerationRecord, issueKey: string, patch: Partial<MobileScenarioGenerationIssueProgress>): void {
  const index = record.issueProgress.findIndex((entry) => entry.issueKey === issueKey);
  if (index < 0) {
    record.issueProgress.push({
      issueKey,
      status: "pending",
      scenarioCount: 0,
      rejectedCount: 0,
      ...patch,
    });
    return;
  }
  record.issueProgress[index] = { ...record.issueProgress[index], ...patch };
}

async function defaultRunner(
  input: RunnerInput,
  handlers: {
    onIssuesResolved: (issueKeys: string[]) => void;
    onIssueStart: (event: MobileScenarioIssueStartEvent) => void;
    onIssueCompleted: (event: MobileScenarioIssueCompletedEvent) => void;
  },
): Promise<MobileScenarioGenerationResult> {
  const jiraConfig = requireJiraConfig(config);
  let resolvedSprintId = input.sprintId;
  if (!resolvedSprintId && input.activeSprint) {
    const jira = new JiraClient(jiraConfig);
    const activeSprint = await jira.getActiveSprint(input.projectKey);
    if (!activeSprint) {
      throw new Error(`No active sprint found for project ${input.projectKey}`);
    }
    resolvedSprintId = activeSprint.id;
  }
  if (!resolvedSprintId) {
    throw new Error("Missing sprintId (or activeSprint) for mobile scenario generation.");
  }
  return generateMobileScenarios(
    jiraConfig,
    input.projectKey,
    resolvedSprintId,
    input.status,
    input.maxResults,
    input.appSlug,
    {
      selectedIssueKeys: input.selectedIssueKeys,
      onIssuesResolved: handlers.onIssuesResolved,
      onIssueStart: handlers.onIssueStart,
      onIssueCompleted: handlers.onIssueCompleted,
    },
  );
}

async function runGeneration(record: MobileScenarioGenerationRecord): Promise<void> {
  record.status = "running";
  record.startedAt = new Date().toISOString();
  record.error = undefined;
  const runner = generationRunnerForTesting ?? defaultRunner;

  try {
    const result = await runner(record.normalizedPayload, {
      onIssuesResolved: (issueKeys) => {
        record.issueKeys = [...issueKeys];
        record.partial.totalIssues = issueKeys.length;
        record.issueProgress = issueKeys.map((issueKey) => ({
          issueKey,
          status: "pending",
          scenarioCount: 0,
          rejectedCount: 0,
        }));
      },
      onIssueStart: (event) => {
        updateIssueProgress(record, event.issueKey, {
          status: "running",
          startedAt: event.startedAt,
          errorMessage: undefined,
          reasonCode: undefined,
        });
      },
      onIssueCompleted: (event) => {
        updateIssueProgress(record, event.issueKey, {
          status: event.status,
          startedAt: event.startedAt,
          finishedAt: event.finishedAt,
          durationMs: event.durationMs,
          scenarioCount: event.scenarios.length,
          rejectedCount: event.rejected.length,
          reasonCode: event.classifiedReason,
          errorMessage: event.errorMessage,
        });
        record.partial.scenariosByIssue[event.issueKey] = [...event.scenarios];
        record.partial.rejectedByIssue[event.issueKey] = [...event.rejected];
        record.partial.completedIssues = record.issueProgress.filter((issue) => issue.status === "completed" || issue.status === "failed").length;
        record.partial.totalScenarios = Object.values(record.partial.scenariosByIssue).reduce((sum, scenarios) => sum + scenarios.length, 0);
        record.partial.totalRejected = Object.values(record.partial.rejectedByIssue).reduce((sum, rejected) => sum + rejected.length, 0);
      },
    });

    const perIssueScenarioCount: Record<string, number> = {};
    const perIssueRejectedCount: Record<string, number> = {};
    for (const [issueKey, issueScenarios] of Object.entries(record.partial.scenariosByIssue)) {
      perIssueScenarioCount[issueKey] = issueScenarios.length;
    }
    for (const [issueKey, issueRejected] of Object.entries(record.partial.rejectedByIssue)) {
      perIssueRejectedCount[issueKey] = issueRejected.length;
    }

    record.result = {
      ...result,
      scenariosByIssue: record.partial.scenariosByIssue,
      rejectedByIssue: record.partial.rejectedByIssue,
      consolidated: {
        totalScenarios: result.scenarios.length,
        totalRejected: result.rejected.length,
        perIssueScenarioCount,
        perIssueRejectedCount,
      },
    };
    record.status = "completed";
    record.finishedAt = new Date().toISOString();
    record.consumersWaiting = 0;
    // Durable: a completed job must persist its final result.scenarios to disk.
    persistGenerationRecord(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    record.consumersWaiting = 0;
    record.error = {
      code: "mobile_scenario_generation_failed",
      message,
    };
    persistGenerationRecord(record);
  }
}

export async function startOrReuseMobileScenarioGenerationJob(
  input: MobileScenarioGenerationRequest,
  metadata: { requestId?: string } = {},
): Promise<StartGenerationResult> {
  const normalizedPayload = normalizeRequest(input);
  const idempotencyKey = buildIdempotencyKey(normalizedPayload);
  const idempotencyKeyHash = hashString(idempotencyKey);
  const existingJobId = idempotencyToJobId.get(idempotencyKeyHash);
  if (existingJobId) {
    const existing = jobsById.get(existingJobId);
    if (existing) {
      if (existing.status === "pending" || existing.status === "running") {
        existing.consumersWaiting += 1;
        return { job: toSnapshot(existing), reused: true, cacheHit: false };
      }
      if (existing.status === "completed") {
        return { job: toSnapshot(existing), reused: true, cacheHit: true };
      }
    }
  }

  const createdAt = new Date().toISOString();
  const record: MobileScenarioGenerationRecord = {
    generationJobId: randomUUID(),
    requestId: metadata.requestId?.trim() || randomUUID(),
    launchDraftId: normalizedPayload.launchDraftId,
    appSlug: normalizedPayload.appSlug,
    issueKeys: [...normalizedPayload.selectedIssueKeys],
    idempotencyKey,
    idempotencyKeyHash,
    status: "pending",
    createdAt,
    consumersWaiting: 1,
    issueProgress: normalizedPayload.selectedIssueKeys.map((issueKey) => ({
      issueKey,
      status: "pending",
      scenarioCount: 0,
      rejectedCount: 0,
    })),
    partial: {
      scenariosByIssue: {},
      rejectedByIssue: {},
      completedIssues: 0,
      totalIssues: normalizedPayload.selectedIssueKeys.length,
      totalScenarios: 0,
      totalRejected: 0,
    },
    normalizedPayload,
  };

  jobsById.set(record.generationJobId, record);
  idempotencyToJobId.set(idempotencyKeyHash, record.generationJobId);
  const runningPromise = runGeneration(record).finally(() => {
    runningPromisesByJobId.delete(record.generationJobId);
  });
  runningPromisesByJobId.set(record.generationJobId, runningPromise);
  return { job: toSnapshot(record), reused: false, cacheHit: false };
}

export function getMobileScenarioGenerationJob(generationJobId: string): MobileScenarioGenerationJob | null {
  const record = jobsById.get(generationJobId);
  if (record) return toSnapshot(record);
  // Lazy recovery from durable disk storage (post-restart): reconstruct only from
  // serializable data and re-insert into memory. Never re-invokes the AI provider.
  const recovered = loadGenerationRecord(generationJobId);
  if (!recovered) return null;
  jobsById.set(recovered.generationJobId, recovered);
  idempotencyToJobId.set(recovered.idempotencyKeyHash, recovered.generationJobId);
  return toSnapshot(recovered);
}

export function isMobileScenarioGenerationJobTerminal(status: MobileScenarioGenerationStatus): boolean {
  return isTerminalStatus(status);
}

export function __setMobileScenarioGenerationRunnerForTesting(runner: MobileScenarioGenerationRunner | null): void {
  generationRunnerForTesting = runner;
}

export async function __awaitMobileScenarioGenerationForTesting(generationJobId: string): Promise<void> {
  const running = runningPromisesByJobId.get(generationJobId);
  if (running) await running;
}

export function __resetMobileScenarioGenerationStateForTesting(): void {
  jobsById.clear();
  idempotencyToJobId.clear();
  runningPromisesByJobId.clear();
  generationRunnerForTesting = null;
}
