import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlansExecutionSummary } from "../types/plan-execution.types";

export async function writePlanExecutionResults(summary: PlansExecutionSummary, outputPath: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(summary, null, 2), "utf-8");
}
