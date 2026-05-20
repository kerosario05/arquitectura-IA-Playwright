import type {
  ObjectRegistry,
  ObjectRegistryValidationIssue,
  ObjectRegistryValidationResult,
  RegistryLocator,
  RegistryObject,
  RegistryObjectType
} from "../types/object-registry.types";

const allowedTypes = new Set<RegistryObjectType>([
  "page",
  "section",
  "button",
  "link",
  "input",
  "select",
  "checkbox",
  "radio",
  "table",
  "text",
  "modal",
  "menu",
  "card",
  "unknown"
]);

const allowedStrategies = new Set(["role", "text", "label", "placeholder", "testId", "css", "xpath"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(
  issues: ObjectRegistryValidationIssue[],
  level: "error" | "warning",
  code: string,
  message: string,
  objectKey?: string
): void {
  issues.push({ level, code, message, objectKey });
}

function validateLocator(locator: RegistryLocator, objectKey: string, issues: ObjectRegistryValidationIssue[]): void {
  if (!allowedStrategies.has(locator.strategy)) {
    issue(issues, "error", "LOCATOR_STRATEGY_INVALID", "locator.strategy is not allowed.", objectKey);
    return;
  }

  if (locator.strategy === "role") {
    if (!hasText(locator.role) || !hasText(locator.name)) {
      issue(issues, "error", "LOCATOR_ROLE_FIELDS_REQUIRED", "role strategy requires role and name.", objectKey);
    }
    return;
  }

  if (locator.strategy === "text" || locator.strategy === "label" || locator.strategy === "placeholder") {
    if (!hasText(locator.value) && !hasText(locator.name)) {
      issue(issues, "error", "LOCATOR_VALUE_OR_NAME_REQUIRED", `${locator.strategy} requires value or name.`, objectKey);
    }
    return;
  }

  if ((locator.strategy === "testId" || locator.strategy === "css" || locator.strategy === "xpath") && !hasText(locator.value)) {
    issue(issues, "error", "LOCATOR_VALUE_REQUIRED", `${locator.strategy} requires value.`, objectKey);
  }

  if (locator.strategy === "css" || locator.strategy === "xpath") {
    issue(issues, "warning", "LOCATOR_LOW_RESILIENCE", `${locator.strategy} locators are less resilient.`, objectKey);
  }
}

function validateObject(item: RegistryObject, issues: ObjectRegistryValidationIssue[]): void {
  const objectKey = item.key;
  if (!hasText(item.key)) {
    issue(issues, "error", "OBJECT_KEY_REQUIRED", "Object key is required.");
  }
  if (!hasText(item.name)) {
    issue(issues, "error", "OBJECT_NAME_REQUIRED", "Object name is required.", objectKey);
  }
  if (!allowedTypes.has(item.type)) {
    issue(issues, "error", "OBJECT_TYPE_INVALID", "Object type is not allowed.", objectKey);
  }
  if (!isObject(item.locator)) {
    issue(issues, "error", "OBJECT_LOCATOR_REQUIRED", "Object locator is required.", objectKey);
  } else {
    validateLocator(item.locator as RegistryLocator, objectKey, issues);
  }

  if (item.stable === false) {
    issue(issues, "warning", "OBJECT_NOT_STABLE", "Object marked as unstable.", objectKey);
  }

  if (Array.isArray(item.aliases)) {
    const normalized = item.aliases.map((alias) => alias.trim().toLowerCase()).filter(Boolean);
    if (new Set(normalized).size !== normalized.length) {
      issue(issues, "warning", "ALIASES_DUPLICATED", "Object aliases contain duplicates.", objectKey);
    }
  }
}

export function validateObjectRegistry(registry: unknown): ObjectRegistryValidationResult {
  const issues: ObjectRegistryValidationIssue[] = [];

  if (!isObject(registry)) {
    return {
      valid: false,
      issues: [{ level: "error", code: "REGISTRY_OBJECT_REQUIRED", message: "Object registry must be an object." }]
    };
  }

  if (registry.version !== "1.0") {
    issue(issues, "error", "REGISTRY_VERSION_INVALID", "Registry version must be '1.0'.");
  }

  if (!Array.isArray(registry.objects)) {
    issue(issues, "error", "REGISTRY_OBJECTS_ARRAY", "Registry objects must be an array.");
  } else {
    const keys = new Set<string>();
    for (const rawObject of registry.objects) {
      if (!isObject(rawObject)) {
        issue(issues, "error", "OBJECT_INVALID", "Each registry object must be an object.");
        continue;
      }
      const item = rawObject as RegistryObject;
      if (hasText(item.key)) {
        const normalizedKey = item.key.trim().toLowerCase();
        if (keys.has(normalizedKey)) {
          issue(issues, "error", "OBJECT_KEY_DUPLICATED", "Object key must be unique.", item.key);
        }
        keys.add(normalizedKey);
      }
      validateObject(item, issues);
    }
  }

  return {
    valid: !issues.some((entry) => entry.level === "error"),
    issues
  };
}

export function assertValidObjectRegistry(registry: unknown): asserts registry is ObjectRegistry {
  const result = validateObjectRegistry(registry);
  if (!result.valid) {
    const message = result.issues
      .filter((entry) => entry.level === "error")
      .map((entry) => `${entry.code}: ${entry.message}`)
      .join("; ");
    throw new Error(`Invalid object registry: ${message || "unknown validation error"}`);
  }
}
