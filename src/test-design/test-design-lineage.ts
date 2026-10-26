import { createHash } from "node:crypto";
import type { RawTestRailCase } from "../types/testrail.types";
import type { AddCaseInput } from "../types/testrail.types";
import { normalizeTestRailCase } from "../testrail/testrail-normalizer";
import type { TestDesignScenario } from "./test-design.types";

const DEFAULT_TESTRAIL_PRECONDITIONS = "Precondiciones:\n- App disponible.\n- Usuario o ambiente de prueba configurado.\n- Datos de prueba disponibles según el escenario.";

function cleanMarkup(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n?/g, "\n")
    .split("\n").map(line => line.replace(/[\t ]+/g, " ").trim()).filter(Boolean).join("\n");
}

function canonicalContent(content: {
  title?: unknown;
  preconditions?: unknown;
  steps?: Array<{ content?: unknown; expected?: unknown }>;
  expectedResult?: unknown;
}) {
  return JSON.stringify([
    cleanMarkup(content.title),
    cleanMarkup(typeof content.preconditions === "string" && content.preconditions.trim()
      ? content.preconditions : DEFAULT_TESTRAIL_PRECONDITIONS),
    (content.steps ?? []).map(step => [cleanMarkup(step.content), cleanMarkup(step.expected)]),
    cleanMarkup(content.expectedResult),
  ]);
}

export function testRailPayloadContentVersion(input: Pick<AddCaseInput, "title" | "preconditions" | "stepsSeparated" | "customExpected">): string {
  const canonical = canonicalContent({
    title: input.title,
    preconditions: input.preconditions,
    steps: input.stepsSeparated,
    expectedResult: input.customExpected,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function testRailRemoteContentVersion(raw: RawTestRailCase): string {
  const normalized = normalizeTestRailCase(raw);
  return createHash("sha256").update(canonicalContent({
    title: normalized.title,
    preconditions: normalized.preconditions,
    steps: normalized.steps.map(step => ({ content: step.action, expected: step.expected })),
    expectedResult: normalized.expectedResult,
  }), "utf8").digest("hex");
}

/** Routes the exact preserved Jira scenario; Design/TestRail text is used for version checks, not to rewrite its executable steps. */
export function toJiraSemanticDesignScenario(
  scenario: TestDesignScenario,
  issueKey: string,
): Record<string, unknown> | null {
  if (!scenario.jiraSourceScenario) return null;
  return {
    ...scenario.jiraSourceScenario,
    scenarioId: scenario.id,
    sourceIssueKey: issueKey.trim().toUpperCase(),
  };
}

/** Keep the lineage snapshot free of runtime datum values and mask any secret copied into prose. */
export function sanitizeTestDesignLineageScenario(scenario: TestDesignScenario): TestDesignScenario {
  const secrets = scenario.data.filter(datum => datum.sensitive && datum.value.trim()).map(datum => datum.value);
  const redact = (value: unknown): unknown => {
    if (typeof value === "string") return secrets.reduce((text, secret) => text.split(secret).join("[Protegido]"), value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redact(child)]));
    }
    return value;
  };
  const safe = redact(scenario) as TestDesignScenario;
  return { ...safe, data: safe.data.map(datum => ({ ...datum, value: "" })) };
}
