import fs from "node:fs";
import path from "node:path";

/**
 * Facts about a discovery case that stopped before it could be promoted, taken from what the discovery run already
 * left behind: its `case_started` / `case_finished` log events and its `evidence.json`. The checklist uses them so a
 * defect says which step failed and what evidence exists, instead of only the batch-level reason code.
 */
export type DiscoveryFailureContext = {
  failedAtStep?: number;
  failedStepText?: string;
  failedTarget?: string;
  expectedResult?: string;
  evidenceDir?: string;
  evidenceJsonPath?: string;
  screenshotPath?: string;
  lastSuccessfulStep?: { stepIndex: number; action?: string; target?: string; evidencePath?: string };
};

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** `Presionar "Sí, cancelar"` -> `Sí, cancelar`; a step without quotes keeps its whole text. */
export function targetOfStepText(stepText: string): string {
  return /["“«]([^"”»]+)["”»]/.exec(stepText)?.[1]?.trim() || stepText.trim();
}

/** The failed step number and text of one case, from the child run's JSON log events (the last `case_finished` wins). */
export function parseDiscoveryCaseFailure(logs: readonly string[], caseKey: string): Pick<DiscoveryFailureContext, "failedAtStep" | "failedStepText" | "failedTarget"> {
  let steps: string[] = [];
  let failedAtStep: number | undefined;
  for (const line of logs) {
    const text = String(line).trim();
    if (!text.startsWith("{")) continue;
    let event: Record<string, unknown>;
    try { event = JSON.parse(text); } catch { continue; }
    if (String(event.caseId ?? "") !== caseKey) continue;
    if (event.type === "case_started" && Array.isArray(event.steps)) steps = event.steps.filter((step): step is string => typeof step === "string");
    if (event.type === "case_finished") failedAtStep = event.status === "failed" && Number.isInteger(event.failedAtStep) && Number(event.failedAtStep) > 0 ? Number(event.failedAtStep) : undefined;
  }
  const failedStepText = failedAtStep ? str(steps[failedAtStep - 1]) : undefined;
  return {
    ...(failedAtStep ? { failedAtStep } : {}),
    ...(failedStepText ? { failedStepText, failedTarget: targetOfStepText(failedStepText) } : {}),
  };
}

/** Evidence the discovery run saved for a scenario (`<scenarioDir>/evidence.json` and its screenshots). */
export function readDiscoveryScenarioEvidence(scenarioDir: string): Pick<DiscoveryFailureContext, "expectedResult" | "evidenceDir" | "evidenceJsonPath" | "screenshotPath" | "lastSuccessfulStep"> {
  const evidenceJsonPath = path.join(scenarioDir, "evidence.json");
  if (!fs.existsSync(evidenceJsonPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(evidenceJsonPath, "utf8")) as Record<string, any>;
    const steps: Array<Record<string, any>> = Array.isArray(parsed.steps) ? parsed.steps : [];
    const passed = steps.filter((step) => String(step.status ?? "").toLowerCase() === "passed");
    const last = passed[passed.length - 1];
    const lastIndex = Number(last?.stepIndex ?? last?.index);
    const screenshotPath = str(parsed.finalScreenEvidence?.path) ?? str(last?.screenshotPath) ?? str(last?.evidencePath);
    return {
      evidenceDir: scenarioDir,
      evidenceJsonPath,
      ...(str(parsed.expectedResult) ? { expectedResult: str(parsed.expectedResult) } : {}),
      ...(screenshotPath ? { screenshotPath } : {}),
      ...(last && Number.isInteger(lastIndex)
        ? { lastSuccessfulStep: { stepIndex: lastIndex, action: str(last.action) ?? str(last.stepText), target: str(last.target), evidencePath: str(last.screenshotPath) ?? str(last.evidencePath) } }
        : {}),
    };
  } catch {
    return {};
  }
}
