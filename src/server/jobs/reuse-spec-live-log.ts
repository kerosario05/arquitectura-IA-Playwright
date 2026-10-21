import * as fs from "node:fs/promises";
import * as path from "node:path";

export type ReusedSpecOutputLine = { stream: "stdout" | "stderr"; line: string };

/** Keep only per-step boundaries needed by the live panel; the child still runs unchanged. */
export function projectReusedSpecLiveOutput(event: ReusedSpecOutputLine): string | undefined {
  const match = event.line.match(/\[promoted-step\][^\n]*\bstepIndex\s*=\s*(\d+)\b[^\n]*\bphase\s*=\s*(start|passed|failed)\b(?:[^\n]*\bfailureClass\s*=\s*([\w-]+))?/i);
  if (!match) return undefined;
  const stepIndex = Number(match[1]);
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 1) return undefined;
  const phase = match[2].toLowerCase();
  const failureClass = match[3] ? ` failureClass=${match[3]}` : "";
  return `[promoted-step] stepIndex=${stepIndex} phase=${phase}${failureClass}`;
}

/** Reduce duplicated Playwright process output to a bounded, redacted error summary. */
export function summarizeReusedSpecError(error: unknown, maxChars = 1200): string | undefined {
  if (typeof error !== "string" || !error.trim()) return undefined;
  const lines = error
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^\[promote-plan\] (?:child stdout:|child stderr:|Spec verification failed diagnostics|Spec verification failed:)/i.test(line))
    .filter((line) => !/^Command failed:/i.test(line));
  const useful = lines.filter((line) => /\b(error|failed|failure|timeout|timed out|assert|expect|not found|trace\.zip|test-failed)\b/i.test(line));
  const unique = [...new Set(useful.length ? useful : lines.slice(-1))];
  if (!unique.length) return undefined;
  let summary = unique.slice(-4).join(" | ");
  if (summary.length > maxChars) summary = `${summary.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  return summary;
}

/** Keep the full already-redacted Playwright diagnostic available outside the live log stream. */
export async function persistReusedSpecDiagnostic(jobId: string, scenarioId: string, redactedError: string): Promise<string> {
  const safeJobId = jobId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeScenarioId = scenarioId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const directory = path.resolve(".artifacts", "reused-spec-runs", safeJobId);
  await fs.mkdir(directory, { recursive: true });
  const target = path.resolve(directory, `${safeScenarioId || "scenario"}-verification-error.txt`);
  if (!target.startsWith(`${directory}${path.sep}`)) throw new Error("REUSED_SPEC_DIAGNOSTIC_PATH_INVALID");
  await fs.writeFile(target, redactedError, "utf8");
  return target;
}
