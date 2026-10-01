import http from "node:http";
import https from "node:https";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type QaLabRuntimeAction = "ensure" | "restart";

export type RuntimeTargetWaitOptions = {
  probe?: (url: string) => Promise<number>;
  pause?: (milliseconds: number) => Promise<void>;
  onWaiting?: (attempt: number, reason: string) => void;
  onReady?: (attempts: number) => void;
};

function probeRuntimeTarget(url: string): Promise<number> {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(parsed, {
      method: "HEAD",
      // This probe establishes availability only. The recorder/browser keeps its own TLS policy.
      ...(parsed.protocol === "https:" ? { rejectUnauthorized: false } : {}),
    }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.setTimeout(5_000, () => request.destroy(new Error("Runtime target probe timed out.")));
    request.once("error", reject);
    request.end();
  });
}

/** Keep a recording task alive while its configured target is unavailable. Any HTTP response
 * below 500 proves the endpoint is accepting requests; transport errors and 5xx are retried. */
export async function waitForRuntimeTarget(runtimeUrl: string, options: RuntimeTargetWaitOptions = {}): Promise<void> {
  const parsed = new URL(runtimeUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Runtime target must use HTTP or HTTPS.");
  const probe = options.probe ?? probeRuntimeTarget;
  const pause = options.pause ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let attempt = 0;
  let delay = 1_000;
  let announcedWaiting = false;
  while (true) {
    attempt += 1;
    try {
      const status = await probe(parsed.toString());
      if (status < 500) {
        if (announcedWaiting) options.onReady?.(attempt - 1);
        return;
      }
      throw new Error(`HTTP ${status}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!announcedWaiting) {
        announcedWaiting = true;
        options.onWaiting?.(attempt, reason);
      }
      await pause(delay);
      delay = Math.min(30_000, delay * 2);
    }
  }
}

/** Starts QA Lab's engine API and frontend as managed local services before physical validation.
 * A source-changing Builder result selects `restart`, so the next fresh run cannot hit stale code. */
export async function prepareQaLabRuntime(repoRoot: string, action: QaLabRuntimeAction): Promise<void> {
  const frontendRoot = process.env.QA_LAB_FRONTEND_ROOT?.trim();
  if (!frontendRoot) throw new Error("QA_LAB_FRONTEND_ROOT is not configured; refusing to run physical validation against an unprepared QA Lab.");

  const scriptPath = path.join(repoRoot, "scripts", "qa-lab-runtime.ps1");
  try {
    await execFileAsync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
      "-Action", action, "-FrontendRoot", path.resolve(frontendRoot),
    ], { cwd: repoRoot, maxBuffer: 64 * 1024, windowsHide: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`QA Lab runtime ${action} failed: ${message}`);
  }
}
