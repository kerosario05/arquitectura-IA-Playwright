import { resolveDataKey } from "../data/data-key-resolver";

/** QA Lab sends overrides grouped by scenario. Never borrow another scenario's inputs. */
export function jiraRuntimeValues(overrides: unknown, scenarioId: string, displayId?: string): Record<string, string> {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return {};
  const values = overrides as Record<string, unknown>;
  const scoped = values[scenarioId] ?? (displayId ? values[displayId] : undefined);
  const selected = scoped && typeof scoped === "object" && !Array.isArray(scoped) ? scoped as Record<string, unknown> : values;
  return Object.fromEntries(Object.entries(selected).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export type JiraRuntimeInputRequirement = {
  key: string;
  label: string;
  dataCondition?: "valid" | "invalid" | "expired";
};

export type JiraScenarioRuntimeInputSet = {
  scenarioId: string;
  sourceIssueKey?: string;
  requirements: JiraRuntimeInputRequirement[];
  values: Record<string, string>;
};

export type JiraInvalidInputCollision = {
  scenarioId: string;
  inputKey: string;
  matchingScenarioId: string;
};

function normalizedInputLabel(value: string): string {
  return value.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function validInputKeyForNegative(key: string): string {
  return key.trim().toLocaleLowerCase("es")
    .replace(/(?:[_\-.](?:invalid|invalido|invalida|expired|expirado|expirada))$/i, "");
}

function hasEntityScope(key: string): boolean {
  return /(?:^|[._-])(?:entity|employee|person|customer|record)[._-]?\d+(?:[._-]|$)/i.test(key);
}

/**
 * Prevent a negative Jira scenario from submitting the same value that a positive
 * scenario in the same Jira story uses for the equivalent field. This is a strict
 * equality guard only; it does not guess or synthesize invalid data.
 */
export function findJiraInvalidInputCollisions(scenarios: JiraScenarioRuntimeInputSet[]): JiraInvalidInputCollision[] {
  const collisions: JiraInvalidInputCollision[] = [];
  for (const scenario of scenarios) {
    const issueKey = scenario.sourceIssueKey?.trim().toLocaleUpperCase("en-US");
    if (!issueKey) continue;
    for (const requirement of scenario.requirements) {
      if (requirement.dataCondition !== "invalid" && requirement.dataCondition !== "expired") continue;
      const negativeValue = scenario.values[requirement.key]?.trim();
      if (!negativeValue) continue;
      const baseKey = validInputKeyForNegative(requirement.key);
      const label = normalizedInputLabel(requirement.label);
      const matchingScenario = scenarios.find((candidate) => {
        if (candidate.scenarioId === scenario.scenarioId
          || candidate.sourceIssueKey?.trim().toLocaleUpperCase("en-US") !== issueKey) return false;
        return candidate.requirements.some((validRequirement) => {
          if (validRequirement.dataCondition === "invalid" || validRequirement.dataCondition === "expired") return false;
          const sameInput = validInputKeyForNegative(validRequirement.key) === baseKey
            || (!hasEntityScope(requirement.key)
              && !hasEntityScope(validRequirement.key)
              && normalizedInputLabel(validRequirement.label) === label);
          return sameInput && Boolean(candidate.values[validRequirement.key]?.trim())
            && candidate.values[validRequirement.key].trim() === negativeValue;
        });
      });
      if (matchingScenario) collisions.push({
        scenarioId: scenario.scenarioId,
        inputKey: requirement.key,
        matchingScenarioId: matchingScenario.scenarioId,
      });
    }
  }
  return collisions;
}

/** Keep the values handed to Discovery scoped to this scenario's declared inputs. */
export function jiraScenarioRuntimeValues(
  resolvedValues: Record<string, string>,
  configuredValues: Record<string, string>,
  requirements: JiraRuntimeInputRequirement[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const requirement of requirements) {
    const resolved = resolvedValues[requirement.key]?.trim();
    if (resolved) {
      values[requirement.key] = resolved;
      continue;
    }
    if (requirement.dataCondition === "invalid" || requirement.dataCondition === "expired") continue;
    const configured = configuredValues[requirement.key]?.trim();
    if (configured) values[requirement.key] = configured;
  }
  return values;
}

function normalizeConfiguredField(value: string): string {
  return value.trim().toLocaleLowerCase("es")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** Resolve an explicitly configured app-profile alias before the shared OTP fallback. */
function configuredProfileValueForField(
  fieldKey: string,
  fieldLabel: string,
  testData: Record<string, unknown>,
  aliases: Record<string, string[] | string> | undefined,
): { value?: string; profileDeclared: boolean } {
  const direct = testData[fieldKey];
  if (direct !== undefined && direct !== null && String(direct).trim()) {
    return { value: String(direct).trim(), profileDeclared: true };
  }

  const expected = new Set([normalizeConfiguredField(fieldKey), normalizeConfiguredField(fieldLabel)]);
  const matchingKeys = Object.entries(aliases ?? {})
    .filter(([key, rawAliases]) => {
      const values = Array.isArray(rawAliases) ? rawAliases : [rawAliases];
      return [key, ...values].some((value) => typeof value === "string" && expected.has(normalizeConfiguredField(value)));
    })
    .map(([key]) => key);
  const uniqueKeys = [...new Set(matchingKeys)];
  if (uniqueKeys.length !== 1) return { profileDeclared: uniqueKeys.length > 0 };

  const value = testData[uniqueKeys[0]];
  return typeof value === "string" && value.trim()
    ? { value: value.trim(), profileDeclared: true }
    : { profileDeclared: true };
}

/**
 * Resolve only Jira scenario inputs from the same profile/runtime sources used by
 * the framework data resolver. Scenario overrides remain authoritative and scoped;
 * configured valid credentials are never reused for explicitly invalid/expired data.
 */
export function resolveJiraConfiguredInputValues(options: {
  overrides: unknown;
  scenarioId: string;
  displayId?: string;
  requirements: JiraRuntimeInputRequirement[];
  testData?: Record<string, unknown>;
  testDataAliases?: Record<string, string[]>;
  environment?: Record<string, string | undefined>;
  profileUsername?: string;
  profilePassword?: string;
}): Record<string, string> {
  const values = jiraRuntimeValues(options.overrides, options.scenarioId, options.displayId);
  const testData = { ...(options.testData ?? {}) };
  const environment = { ...(options.environment ?? process.env) };

  // App profiles keep their credentials outside APP_TEST_DATA_JSON. Expose them
  // through the resolver's existing generic auth roles without logging values.
  if (options.profileUsername?.trim()) testData["auth.username"] ??= options.profileUsername;
  if (options.profilePassword?.trim()) testData["auth.password"] ??= options.profilePassword;
  environment.APP_USERNAME ??= options.profileUsername;
  environment.APP_PASSWORD ??= options.profilePassword;

  // Identity_Provider is the existing generic auth-flow source for an
  // application's identification field. Let semantic identifier requirements
  // resolve it via the shared company-identifier role.
  if (environment.Identity_Provider?.trim()) {
    testData["auth.company_identifier"] ??= environment.Identity_Provider;
  }
  if (environment.OTP_SECRET?.trim()) testData["auth.otp"] ??= environment.OTP_SECRET;

  for (const requirement of options.requirements) {
    if (values[requirement.key]?.trim()) continue;
    if (requirement.dataCondition === "invalid" || requirement.dataCondition === "expired") continue;

    const isAccessCode = /(?:\botp\b|one[_ -]?time|c[oó]digo.*(?:acceso|verificaci[oó]n|sms)|(?:acceso|verificaci[oó]n|sms).*c[oó]digo)/i
      .test(`${requirement.key} ${requirement.label}`);
    if (isAccessCode) {
      // Prefer an exact app-profile value/alias over a machine-wide OTP_SECRET.
      // If the profile declares this field but leaves it empty or ambiguous, fail
      // closed instead of silently borrowing a code from another app context.
      const profileValue = configuredProfileValueForField(
        requirement.key,
        requirement.label,
        testData,
        options.testDataAliases,
      );
      if (profileValue.value) {
        values[requirement.key] = profileValue.value;
        continue;
      }
      if (profileValue.profileDeclared) continue;

      // OTP_SECRET remains a generic fallback only when the linked app profile
      // has no matching field configuration. Never use it for transfer tokens.
      const otp = resolveDataKey("auth.otp", {
        testData,
        testDataAliases: options.testDataAliases,
        env: environment,
        field: requirement.label,
        context: "jira_semantic",
        missingInputBehavior: "fail",
      });
      if (otp.status === "resolved" && otp.value?.trim()) {
        values[requirement.key] = otp.value;
        continue;
      }
    }

    const resolution = resolveDataKey(requirement.key, {
      testData,
      testDataAliases: options.testDataAliases,
      env: environment,
      field: requirement.label,
      context: "jira_semantic",
      missingInputBehavior: "fail",
    });
    if (resolution.status === "resolved" && resolution.value?.trim()) {
      values[requirement.key] = resolution.value;
    }
  }

  return values;
}
