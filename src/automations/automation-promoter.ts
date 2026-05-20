import path from "node:path";
import { promoteExecutionPlan } from "./promote-plan";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PromotedAutomationIndexEntry } from "../types/automation-promotion.types";
import type { RegistryObject } from "../types/object-registry.types";

export async function promoteDiscoveryAutomation(input: {
  plan: ExecutionPlan;
  discoveryDir: string;
  promotedObjects: RegistryObject[];
}): Promise<PromotedAutomationIndexEntry> {
  const discoveredConfidences = input.promotedObjects.map((object) => {
    const tag = object.tags?.find((value) => value.startsWith("confidence:"));
    return tag ? Number(tag.split(":")[1]) : undefined;
  }).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const averageConfidence = discoveredConfidences.length
    ? discoveredConfidences.reduce((sum, value) => sum + value, 0) / discoveredConfidences.length
    : 0;
  const minConfidence = discoveredConfidences.length ? Math.min(...discoveredConfidences) : 0;

  return promoteExecutionPlan(
    {
      plan: input.plan,
      sourcePlanPath: path.join(input.discoveryDir, "discovered-plans.pending.json"),
      source: "discovery",
      overwrite: false
    },
    false,
    {
      discoveryDir: input.discoveryDir,
      confidenceSummary: {
        promotedCount: input.promotedObjects.length,
        averageConfidence,
        minConfidence
      },
      promotedObjects: input.promotedObjects.map((object) => object.key)
    }
  );
}
