import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SemanticRecordingModel } from "./semantic-recording";
import { buildSemanticRecordingModel } from "./semantic-recording";
import type { SessionTrace } from "./session-trace.types";
import { hydratePersistedScenarios } from "./persisted-scenario-hydration";
import { buildHappyPathScenario, type RecordedScenario } from "./trace-to-scenario";

export type RecordingCorpusStatus = "passed" | "blocked" | "failed";

export type RecordingCorpusEntry = {
  appSlug: string;
  recordingId: string;
  status: RecordingCorpusStatus;
  reason?: "trace_missing" | "trace_invalid" | "trace_not_stopped" | "unsupported_platform" | "no_events" | "scenario_invalid" | "source_changed";
  eventCount: number;
  scenarioCount: number;
  sourceHashVerified: boolean;
};

export type RecordingCorpusAudit = {
  total: number;
  passed: number;
  blocked: number;
  failed: number;
  sourceHashesVerified: boolean;
  entries: RecordingCorpusEntry[];
};

type RecordingFiles = {
  appSlug: string;
  recordingId: string;
  directory: string;
};

const STAGING_APP_PREFIX = "recording-regression-";

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function listRecordingFiles(appsRoot: string): RecordingFiles[] {
  if (!fs.existsSync(appsRoot)) return [];
  const result: RecordingFiles[] = [];
  for (const app of fs.readdirSync(appsRoot, { withFileTypes: true })) {
    if (!app.isDirectory() || app.name.startsWith(STAGING_APP_PREFIX)) continue;
    const recordingsDir = path.join(appsRoot, app.name, "recordings");
    if (!fs.existsSync(recordingsDir)) continue;
    for (const recording of fs.readdirSync(recordingsDir, { withFileTypes: true })) {
      if (!recording.isDirectory()) continue;
      result.push({ appSlug: app.name, recordingId: recording.name, directory: path.join(recordingsDir, recording.name) });
    }
  }
  return result.sort((left, right) => left.appSlug.localeCompare(right.appSlug) || left.recordingId.localeCompare(right.recordingId));
}

function parseJson<T>(content: Buffer): T | undefined {
  try { return JSON.parse(content.toString("utf8")) as T; } catch { return undefined; }
}

function countEvents(trace: SessionTrace | undefined): number {
  return Array.isArray(trace?.events) ? trace.events.length : 0;
}

function auditRecording(files: RecordingFiles): RecordingCorpusEntry {
  const tracePath = path.join(files.directory, "trace.json");
  if (!fs.existsSync(tracePath)) {
    return { appSlug: files.appSlug, recordingId: files.recordingId, status: "blocked", reason: "trace_missing", eventCount: 0, scenarioCount: 0, sourceHashVerified: true };
  }

  const sourceFiles = ["trace.json", "scenarios.json", "semantic-recording.json"]
    .map((name) => path.join(files.directory, name))
    .filter((file) => fs.existsSync(file));
  const sourceHashes = new Map(sourceFiles.map((file) => [file, sha256(fs.readFileSync(file))]));
  const trace = parseJson<SessionTrace>(fs.readFileSync(tracePath));
  const base = { appSlug: files.appSlug, recordingId: files.recordingId, eventCount: countEvents(trace), scenarioCount: 0 };

  const blocked = (reason: RecordingCorpusEntry["reason"]): RecordingCorpusEntry => ({
    ...base,
    status: "blocked",
    reason,
    sourceHashVerified: hashesStillMatch(sourceHashes),
  });

  if (!trace || trace.appSlug !== files.appSlug || trace.recordingId !== files.recordingId || !Array.isArray(trace.events)) return blocked("trace_invalid");
  if (trace.status !== "stopped") return blocked("trace_not_stopped");
  if (trace.platform !== "web") return blocked("unsupported_platform");
  if (trace.events.length === 0) return blocked("no_events");

  const scenariosPath = path.join(files.directory, "scenarios.json");
  const persistedScenarios = fs.existsSync(scenariosPath)
    ? parseJson<RecordedScenario[]>(fs.readFileSync(scenariosPath))
    : undefined;
  if (persistedScenarios !== undefined && !Array.isArray(persistedScenarios)) return blocked("scenario_invalid");

  const semanticPath = path.join(files.directory, "semantic-recording.json");
  const persistedSemantic = fs.existsSync(semanticPath)
    ? parseJson<SemanticRecordingModel>(fs.readFileSync(semanticPath))
    : undefined;
  if (fs.existsSync(semanticPath) && !persistedSemantic) return blocked("scenario_invalid");

  try {
    const derived = persistedScenarios?.length
      ? persistedScenarios
      : [buildHappyPathScenario(trace, trace.events)];
    if (!derived.length || derived.some((scenario) => !Array.isArray(scenario.webSteps) || !scenario.scenarioId)) return blocked("scenario_invalid");
    const semantic = persistedSemantic ?? buildSemanticRecordingModel(trace, trace.events);
    const hydrated = hydratePersistedScenarios(derived, semantic, trace);
    if (!hydrated.length || hydrated.some((scenario) => scenario.sourceRecordingId !== files.recordingId || !scenario.testRailSteps.length)) return blocked("scenario_invalid");
    if (!hashesStillMatch(sourceHashes)) {
      return { ...base, status: "failed", reason: "source_changed", scenarioCount: hydrated.length, sourceHashVerified: false };
    }
    return { ...base, status: "passed", scenarioCount: hydrated.length, sourceHashVerified: true };
  } catch {
    return blocked("scenario_invalid");
  }

  function hashesStillMatch(expected: Map<string, string>): boolean {
    return [...expected].every(([file, hash]) => fs.existsSync(file) && sha256(fs.readFileSync(file)) === hash);
  }
}

/**
 * Audits the persisted recording corpus in memory only. Source traces and projections are read
 * for the current recording contract, but are never normalized back to disk or copied to staging.
 * This is the corpus gate that complements the fixture's full Discovery/AutoPOM promotion run.
 */
export function auditPersistedRecordingCorpus(appsRoot = path.resolve("automations", "apps")): RecordingCorpusAudit {
  const entries = listRecordingFiles(path.resolve(appsRoot)).map(auditRecording);
  const passed = entries.filter((entry) => entry.status === "passed").length;
  const blocked = entries.filter((entry) => entry.status === "blocked").length;
  const failed = entries.filter((entry) => entry.status === "failed").length;
  return {
    total: entries.length,
    passed,
    blocked,
    failed,
    sourceHashesVerified: entries.every((entry) => entry.sourceHashVerified),
    entries,
  };
}
