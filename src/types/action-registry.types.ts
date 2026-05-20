import type { PlanAction } from "./execution-plan.types";

export type ActionCapability = {
  action: PlanAction;
  requiresTarget: boolean;
  requiresValue: boolean;
  requiresExpected: boolean;
  allowsValueKey: boolean;
  description: string;
};

export type ActionRegistry = {
  version: "1.0";
  actions: ActionCapability[];
};
