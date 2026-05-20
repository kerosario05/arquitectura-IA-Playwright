import type { ActionCapability, ActionRegistry } from "../types/action-registry.types";
import type { PlanAction } from "../types/execution-plan.types";

export const actionRegistry: ActionRegistry = {
  version: "1.0",
  actions: [
    {
      action: "navigate",
      requiresTarget: true,
      requiresValue: false,
      requiresExpected: false,
      allowsValueKey: false,
      description: "Navigates to a target route or app base URL."
    },
    {
      action: "login",
      requiresTarget: false,
      requiresValue: false,
      requiresExpected: false,
      allowsValueKey: false,
      description: "Applies configured login strategy."
    },
    {
      action: "click",
      requiresTarget: true,
      requiresValue: false,
      requiresExpected: false,
      allowsValueKey: false,
      description: "Clicks a target element."
    },
    {
      action: "fill",
      requiresTarget: true,
      requiresValue: true,
      requiresExpected: false,
      allowsValueKey: true,
      description: "Fills a field with literal value or valueKey."
    },
    {
      action: "select",
      requiresTarget: true,
      requiresValue: true,
      requiresExpected: false,
      allowsValueKey: true,
      description: "Selects a value in selectable control."
    },
    {
      action: "check",
      requiresTarget: true,
      requiresValue: false,
      requiresExpected: false,
      allowsValueKey: false,
      description: "Checks target option."
    },
    {
      action: "uncheck",
      requiresTarget: true,
      requiresValue: false,
      requiresExpected: false,
      allowsValueKey: false,
      description: "Unchecks target option."
    },
    {
      action: "press",
      requiresTarget: true,
      requiresValue: true,
      requiresExpected: false,
      allowsValueKey: false,
      description: "Presses keyboard key on target."
    },
    {
      action: "waitFor",
      requiresTarget: false,
      requiresValue: false,
      requiresExpected: false,
      allowsValueKey: false,
      description: "Waits by timeout or target readiness."
    },
    {
      action: "assertVisible",
      requiresTarget: true,
      requiresValue: false,
      requiresExpected: false,
      allowsValueKey: false,
      description: "Asserts target visibility."
    },
    {
      action: "assertText",
      requiresTarget: true,
      requiresValue: false,
      requiresExpected: true,
      allowsValueKey: false,
      description: "Asserts expected text on target."
    },
    {
      action: "assertUrl",
      requiresTarget: false,
      requiresValue: false,
      requiresExpected: true,
      allowsValueKey: false,
      description: "Asserts URL expectation."
    },
    {
      action: "screenshot",
      requiresTarget: false,
      requiresValue: false,
      requiresExpected: false,
      allowsValueKey: false,
      description: "Captures screenshot evidence."
    },
    {
      action: "noop",
      requiresTarget: false,
      requiresValue: false,
      requiresExpected: false,
      allowsValueKey: false,
      description: "Placeholder step for future enrichment."
    }
  ]
};

export function getActionCapability(action: PlanAction): ActionCapability | undefined {
  return actionRegistry.actions.find((entry) => entry.action === action);
}

export function listSupportedActions(): PlanAction[] {
  return actionRegistry.actions.map((entry) => entry.action);
}
