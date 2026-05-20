import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExecutionPlan } from "../types/execution-plan.types";

export async function writeExecutionPlansToFile(plans: ExecutionPlan[], outputPath: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    count: plans.length,
    plans
  };

  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf-8");
}
