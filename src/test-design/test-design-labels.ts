import type { TestDesignPriority, TestDesignScenarioType } from "./test-design.types";

/** Spanish labels shared by everything published outside QA Lab (Jira sub-tasks, TestRail). */

export const PRIORITY_LABELS: Record<TestDesignPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

export const TYPE_LABELS: Record<TestDesignScenarioType, string> = {
  functional: "Funcional",
  negative: "Negativo",
  edge: "Borde",
  regression: "Regresión",
  other: "Otro",
};
