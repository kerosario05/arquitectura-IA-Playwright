/**
 * How a web recording is shown to the person driving it.
 *
 * - "headed": the recorder opens a visible Chromium on the machine running the engine -- a QA's
 *   own PC. Unchanged default.
 * - "remote": the engine runs as a service with no desktop (Windows Server, session 0). Chromium
 *   runs headless on the server and is streamed into the QA Lab panel; the person's clicks and
 *   keys come back over a WebSocket (see live-view-session.ts).
 */
export type RecordingPresentation = "headed" | "remote";

export type RecordingViewport = { width: number; height: number };

/** Tall enough that kiosk home actions below 800px are visible; the page still scrolls. */
export const DEFAULT_RECORDING_VIEWPORT: RecordingViewport = { width: 1280, height: 1024 };

const MIN_SIDE = 320;
const MAX_SIDE = 3840;

export function resolveRecordingPresentation(env: NodeJS.ProcessEnv = process.env): RecordingPresentation {
  return env.RECORDING_PRESENTATION?.trim().toLowerCase() === "remote" ? "remote" : "headed";
}

/** `RECORDING_VIEWPORT=1280x1024` (also `1280*1024`); anything malformed falls back to the default. */
export function resolveRecordingViewport(env: NodeJS.ProcessEnv = process.env): RecordingViewport {
  const match = env.RECORDING_VIEWPORT?.trim().match(/^(\d{3,4})\s*[x*×]\s*(\d{3,4})$/i);
  if (!match) return { ...DEFAULT_RECORDING_VIEWPORT };
  const width = Number(match[1]);
  const height = Number(match[2]);
  const valid = (side: number) => side >= MIN_SIDE && side <= MAX_SIDE;
  return valid(width) && valid(height) ? { width, height } : { ...DEFAULT_RECORDING_VIEWPORT };
}

/** A remote recording with nobody watching or acting for this long is stopped (default 15 min). */
export function resolveRemoteRecordingIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.RECORDING_IDLE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 15 * 60_000;
}
