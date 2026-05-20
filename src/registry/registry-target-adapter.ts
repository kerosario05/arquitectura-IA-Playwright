import type { PlanTarget } from "../types/execution-plan.types";
import type { RegistryLocator } from "../types/object-registry.types";

export function registryLocatorToPlanTarget(locator: RegistryLocator): PlanTarget {
  switch (locator.strategy) {
    case "role":
      return {
        strategy: "role",
        role: locator.role,
        name: locator.name,
        exact: locator.exact
      };
    case "text":
      return {
        strategy: "text",
        value: locator.value ?? locator.name,
        name: locator.name,
        exact: locator.exact
      };
    case "label":
      return {
        strategy: "label",
        value: locator.value ?? locator.name,
        name: locator.name,
        exact: locator.exact
      };
    case "placeholder":
      return {
        strategy: "placeholder",
        value: locator.value ?? locator.name,
        name: locator.name,
        exact: locator.exact
      };
    case "testId":
      return {
        strategy: "testId",
        value: locator.value
      };
    case "css":
      return {
        strategy: "css",
        value: locator.value
      };
    case "xpath":
      return {
        strategy: "xpath",
        value: locator.value
      };
    default:
      return {
        strategy: "css",
        value: locator.value
      };
  }
}
