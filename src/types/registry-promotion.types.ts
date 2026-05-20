import type { ExecutionPlan } from "./execution-plan.types";
import type { RegistryObject } from "./object-registry.types";
import type { PromotedAutomationIndexEntry } from "./automation-promotion.types";

export type PendingDiscoveredObject = RegistryObject & {
  discoveredAt?: string;
  sourceStep?: number;
  confidence: number;
};

export type RegistryPromotionOptions = {
  fromDir: string;
  dryRun: boolean;
  approve: boolean;
  confidenceThreshold: number;
  promoteObjects: boolean;
  promotePlan: boolean;
  promoteAutomation: boolean;
  includeSections: boolean;
  excludeGlobalNavigation: boolean;
  caseId?: number;
};

export type RegistryPromotionConflict = {
  key: string;
  existingLocator: string;
  incomingLocator: string;
  reason: string;
};

export type RegistryPromotionDecision = {
  object: PendingDiscoveredObject;
  reason: string;
};

export type RegistryPromotionReport = {
  mode: "dry_run" | "approved";
  fromDir: string;
  objectsToPromote: RegistryObject[];
  objectsSkipped: RegistryPromotionDecision[];
  duplicatesMerged: Array<{ keptKey: string; droppedKeys: string[]; reason: string }>;
  conflicts: RegistryPromotionConflict[];
  planToPromote?: ExecutionPlan;
  automationToCreate?: {
    id: string;
    caseId?: number;
    title: string;
  };
  promotedAutomation?: PromotedAutomationIndexEntry;
  warnings: string[];
  registryPath: string;
  registryWritten: boolean;
  backupPath?: string;
};
