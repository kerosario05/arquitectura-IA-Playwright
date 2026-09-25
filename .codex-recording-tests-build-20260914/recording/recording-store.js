"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordingDir = recordingDir;
exports.framesDir = framesDir;
exports.saveTrace = saveTrace;
exports.loadTrace = loadTrace;
exports.saveScenarios = saveScenarios;
exports.saveSemanticRecording = saveSemanticRecording;
exports.loadSemanticRecording = loadSemanticRecording;
exports.loadScenarios = loadScenarios;
exports.ensureFramesDir = ensureFramesDir;
exports.discardFrames = discardFrames;
exports.sweepOrphanFrames = sweepOrphanFrames;
exports.toSummary = toSummary;
exports.listRecordings = listRecordings;
exports.deleteRecording = deleteRecording;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const trace_normalizer_1 = require("./trace-normalizer");
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
function sanitize(segment) {
    if (segment.includes("..") || segment.includes("/") || segment.includes("\\")) {
        throw new Error(`Path traversal detected: ${segment}`);
    }
    const clean = segment.replace(/[^a-zA-Z0-9_-]/g, "").trim();
    if (!clean)
        throw new Error(`Invalid path segment: ${segment}`);
    return clean;
}
function recordingDir(appSlug, recordingId) {
    return path.join(RECORDINGS_ROOT, sanitize(appSlug), "recordings", sanitize(recordingId));
}
/** Frames never live under the app profile — they are temporary by contract. */
function framesDir(recordingId) {
    return path.join(FRAMES_ROOT, sanitize(recordingId));
}
function tracePath(appSlug, recordingId) {
    return path.join(recordingDir(appSlug, recordingId), "trace.json");
}
function scenariosPath(appSlug, recordingId) {
    return path.join(recordingDir(appSlug, recordingId), "scenarios.json");
}
function semanticPath(appSlug, recordingId) {
    return path.join(recordingDir(appSlug, recordingId), "semantic-recording.json");
}
function saveTrace(trace) {
    const dir = recordingDir(trace.appSlug, trace.recordingId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tracePath(trace.appSlug, trace.recordingId), JSON.stringify(trace, null, 2), "utf8");
}
function loadTrace(appSlug, recordingId) {
    const file = tracePath(appSlug, recordingId);
    if (!fs.existsSync(file))
        return null;
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        return null;
    }
}
function saveScenarios(appSlug, recordingId, scenarios) {
    const dir = recordingDir(appSlug, recordingId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(scenariosPath(appSlug, recordingId), JSON.stringify(scenarios, null, 2), "utf8");
}
function saveSemanticRecording(model) {
    const dir = recordingDir(model.appSlug, model.recordingId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(semanticPath(model.appSlug, model.recordingId), JSON.stringify(model, null, 2), "utf8");
}
function loadSemanticRecording(appSlug, recordingId) {
    const file = semanticPath(appSlug, recordingId);
    if (!fs.existsSync(file))
        return null;
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        return null;
    }
}
function loadScenarios(appSlug, recordingId) {
    const file = scenariosPath(appSlug, recordingId);
    if (!fs.existsSync(file))
        return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function ensureFramesDir(recordingId) {
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
function discardFrames(trace) {
    const dir = framesDir(trace.recordingId);
    fs.rmSync(dir, { recursive: true, force: true });
    return {
        ...trace,
        events: trace.events.map(({ framePath, ...rest }) => rest),
    };
}
/** Removes frame directories left behind by a crashed or killed recording. */
function sweepOrphanFrames() {
    if (!fs.existsSync(FRAMES_ROOT))
        return 0;
    let removed = 0;
    for (const entry of fs.readdirSync(FRAMES_ROOT)) {
        try {
            fs.rmSync(path.join(FRAMES_ROOT, entry), { recursive: true, force: true });
            removed += 1;
        }
        catch {
            // A directory still held open by a dying process is retried on the next boot.
        }
    }
    return removed;
}
function toSummary(trace, scenarioCount = 0) {
    const stats = (0, trace_normalizer_1.summarizeTrace)((0, trace_normalizer_1.normalizeEvents)(trace.events), trace);
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
        recordingGoal: trace.recordingGoal?.declaredGoal ?? trace.recordingGoal?.normalizedGoal ?? trace.label,
        errorMessage: trace.errorMessage,
    };
}
/** Lists recordings for one app, newest first. */
function listRecordings(appSlug) {
    const dir = path.join(RECORDINGS_ROOT, sanitize(appSlug), "recordings");
    if (!fs.existsSync(dir))
        return [];
    const summaries = [];
    for (const entry of fs.readdirSync(dir)) {
        const trace = loadTrace(appSlug, entry);
        if (!trace)
            continue;
        summaries.push(toSummary(trace, loadScenarios(appSlug, entry).length));
    }
    return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
function deleteRecording(appSlug, recordingId) {
    const dir = recordingDir(appSlug, recordingId);
    if (!fs.existsSync(dir))
        return false;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(framesDir(recordingId), { recursive: true, force: true });
    return true;
}
