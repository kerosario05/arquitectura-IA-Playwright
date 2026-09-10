import * as fs from "node:fs";
import * as path from "node:path";
import type { RecordingSummary, SessionTrace } from "./session-trace.types";
import type { RecordedScenario } from "./trace-to-scenario";
import { normalizeEvents, summarizeTrace } from "./trace-normalizer";

/**
 * On-disk home of recorded sessions.
 *
 * Two storage classes, deliberately separated:
 *
 * - The TRACE and the derived scenarios live under the app profile, next to everything else
 *   the project owns, and persist. They are text, they carry no raw imagery, and sensitive
 *   values were replaced with keys at capture time.
 * - The FRAMES live in a temp directory that is deleted the moment derivation finishes.
 *   They exist only to give the AI visual context for a few seconds. Nothing downstream may
 *   reference a frame path, because it is guaranteed to be gone.
 *
 * `sweepOrphanFrames` exists because a crash between capture and derivation would otherwise
 * leave screenshots of a banking app on disk indefinitely; the server calls it at startup.
 */

const RECORDINGS_ROOT = path.join("automations", "apps");
const FRAMES_ROOT = path.join(".artifacts", "tmp", "recordings");

function sanitize(segment: string): string {
  if (segment.includes("..") || segment.includes("/") || segment.includes("\\")) {
    throw new Error(`Path traversal detected: ${segment}`);
  }
  const clean = segment.replace(/[^a-zA-Z0-9_-]/g, "").trim();
  if (!clean) throw new Error(`Invalid path segment: ${segment}`);
  return clean;
}

export function recordingDir(appSlug: string, recordingId: string): string {
  return path.join(RECORDINGS_ROOT, sanitize(appSlug), "recordings", sanitize(recordingId));
}

/** Frames never live under the app profile — they are temporary by contract. */
export function framesDir(recordingId: string): string {
  return path.join(FRAMES_ROOT, sanitize(recordingId));
}

function tracePath(appSlug: string, recordingId: string): string {
  return path.join(recordingDir(appSlug, recordingId), "trace.json");
}

function scenariosPath(appSlug: string, recordingId: string): string {
  return path.join(recordingDir(appSlug, recordingId), "scenarios.json");
}

export function saveTrace(trace: SessionTrace): void {
  const dir = recordingDir(trace.appSlug, trace.recordingId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tracePath(trace.appSlug, trace.recordingId), JSON.stringify(trace, null, 2), "utf8");
}

export function loadTrace(appSlug: string, recordingId: string): SessionTrace | null {
  const file = tracePath(appSlug, recordingId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as SessionTrace;
  } catch {
    return null;
  }
}

export function saveScenarios(appSlug: string, recordingId: string, scenarios: RecordedScenario[]): void {
  const dir = recordingDir(appSlug, recordingId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(scenariosPath(appSlug, recordingId), JSON.stringify(scenarios, null, 2), "utf8");
}

export function loadScenarios(appSlug: string, recordingId: string): RecordedScenario[] {
  const file = scenariosPath(appSlug, recordingId);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as RecordedScenario[]) : [];
  } catch {
    return [];
  }
}

export function ensureFramesDir(recordingId: string): string {
  const dir = framesDir(recordingId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Deletes the frames of one recording and strips their paths from the trace.
 *
 * Clearing the paths matters as much as deleting the files: a trace that still points at
 * frames invites a later reader to try to load them, and silently degrades into broken
 * references. After this runs the trace states plainly that the visual material is gone.
 */
export function discardFrames(trace: SessionTrace): SessionTrace {
  const dir = framesDir(trace.recordingId);
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    ...trace,
    events: trace.events.map(({ framePath, ...rest }) => rest),
  };
}

/** Removes frame directories left behind by a crashed or killed recording. */
export function sweepOrphanFrames(): number {
  if (!fs.existsSync(FRAMES_ROOT)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(FRAMES_ROOT)) {
    try {
      fs.rmSync(path.join(FRAMES_ROOT, entry), { recursive: true, force: true });
      removed += 1;
    } catch {
      // A directory still held open by a dying process is retried on the next boot.
    }
  }
  return removed;
}

export function toSummary(trace: SessionTrace, scenarioCount = 0): RecordingSummary {
  const stats = summarizeTrace(normalizeEvents(trace.events), trace);
  return {
    recordingId: trace.recordingId,
    projectSlug: trace.projectSlug,
    appSlug: trace.appSlug,
    platform: trace.platform,
    label: trace.label,
    status: trace.status,
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    durationMs: trace.durationMs,
    eventCount: trace.events.length,
    screenCount: trace.screens.length,
    actionCount: stats.actions,
    hasNarrative: Boolean(trace.narrative?.trim()),
    scenarioCount,
    errorMessage: trace.errorMessage,
  };
}

/** Lists recordings for one app, newest first. */
export function listRecordings(appSlug: string): RecordingSummary[] {
  const dir = path.join(RECORDINGS_ROOT, sanitize(appSlug), "recordings");
  if (!fs.existsSync(dir)) return [];
  const summaries: RecordingSummary[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const trace = loadTrace(appSlug, entry);
    if (!trace) continue;
    summaries.push(toSummary(trace, loadScenarios(appSlug, entry).length));
  }
  return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function deleteRecording(appSlug: string, recordingId: string): boolean {
  const dir = recordingDir(appSlug, recordingId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(framesDir(recordingId), { recursive: true, force: true });
  return true;
}
