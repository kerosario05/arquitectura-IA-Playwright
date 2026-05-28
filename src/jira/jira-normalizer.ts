import type { RawJiraIssue } from "../types/jira.types";
import type { TestScenario, TestScenarioStep } from "../types/testrail.types";
import { extractTextFromAdf } from "./adf-extractor";
import { extractDataHintsFromText } from "../testrail/testrail-normalizer";

export type JiraNormalizerOptions = {
  acceptanceCriteriaField?: string;
};

function extractIssueNumber(issueKey: string): number {
  const match = issueKey.match(/-(\d+)$/);
  if (match) return parseInt(match[1], 10);
  // Fallback hash when key format doesn't end in a number
  let hash = 0;
  for (let i = 0; i < issueKey.length; i++) {
    hash = ((hash << 5) - hash) + issueKey.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Section headers that mark the start of acceptance criteria in user story format
const ACCEPTANCE_CRITERIA_HEADERS = [
  /^criterios?\s+de\s+aceptaci[oó]n/i,
  /^acceptance\s+criteria/i,
  /^criterios?\s+de\s+aceptabilidad/i,
  /^condiciones?\s+de\s+aceptaci[oó]n/i,
  /^requisitos?\s+de\s+aceptaci[oó]n/i
];

// Section headers that mark the start of non-step sections to skip
const SKIP_SECTION_HEADERS = [
  /^historia\s+de\s+usuario/i,
  /^user\s+story/i,
  /^alcance/i,
  /^scope/i,
  /^descripci[oó]n/i,
  /^description/i,
  /^contexto/i,
  /^context/i,
  /^notas?/i,
  /^notes?/i
];

function extractAcceptanceCriteriaSection(lines: string[]): string[] | null {
  const startIdx = lines.findIndex((l) => ACCEPTANCE_CRITERIA_HEADERS.some((re) => re.test(l)));
  if (startIdx === -1) return null;

  // Collect lines after the header until the next section header or end
  const result: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Stop at any known section header
    if (
      ACCEPTANCE_CRITERIA_HEADERS.some((re) => re.test(line)) ||
      SKIP_SECTION_HEADERS.some((re) => re.test(line))
    ) {
      break;
    }
    result.push(line);
  }

  return result.length > 0 ? result : null;
}

function parseStepsFromText(text: string): string[] {
  if (!text.trim()) return [];

  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const gherkinPattern = /^(given|when|then|and|but)\s+/i;
  const listPattern = /^(?:\d+[.)]\s*|-\s*|\*\s*)/;

  // Try Gherkin first (works across any section)
  const hasGherkin = lines.some((l) => gherkinPattern.test(l));
  if (hasGherkin) {
    return lines
      .map((l) => l.match(/^(?:given|when|then|and|but)\s+(.+)/i)?.[1]?.trim())
      .filter((s): s is string => !!s && s.length > 2);
  }

  // Try to extract only the Criterios de Aceptación section
  const criteriaLines = extractAcceptanceCriteriaSection(lines);
  if (criteriaLines && criteriaLines.length > 0) {
    return criteriaLines
      .map((l) => l.replace(listPattern, "").trim())
      .filter((s) => s.length > 2);
  }

  // Fall back: if the text has list items, use only those
  const hasList = lines.some((l) => listPattern.test(l));
  if (hasList) {
    return lines
      .map((l) => l.replace(listPattern, "").trim())
      .filter((s) => s.length > 2);
  }

  // Last resort: skip known section headers, use remaining lines
  return lines
    .filter((l) => !ACCEPTANCE_CRITERIA_HEADERS.some((re) => re.test(l)))
    .filter((l) => !SKIP_SECTION_HEADERS.some((re) => re.test(l)))
    .filter((s) => s.length > 2);
}

export function normalizeJiraIssue(
  issue: RawJiraIssue,
  options: JiraNormalizerOptions = {}
): TestScenario {
  const { acceptanceCriteriaField = "description" } = options;

  const title = issue.fields.summary?.trim() || issue.key;

  const rawFieldValue =
    acceptanceCriteriaField === "description"
      ? issue.fields.description
      : issue.fields[acceptanceCriteriaField];

  let rawText = "";
  if (typeof rawFieldValue === "string") {
    rawText = rawFieldValue;
  } else if (
    rawFieldValue !== null &&
    rawFieldValue !== undefined &&
    typeof rawFieldValue === "object"
  ) {
    rawText = extractTextFromAdf(rawFieldValue as any);
  }

  const stepTexts = parseStepsFromText(rawText);

  let steps: TestScenarioStep[];

  if (stepTexts.length === 0) {
    steps = [
      {
        index: 1,
        action: title,
        expected: undefined,
        dataHints: extractDataHintsFromText(title)
      }
    ];
  } else {
    steps = stepTexts.map((action, i) => ({
      index: i + 1,
      action,
      expected: undefined,
      dataHints: extractDataHintsFromText(action)
    }));
  }

  return {
    source: "jira",
    externalId: issue.key,
    caseId: extractIssueNumber(issue.key),
    title,
    preconditions: undefined,
    references: issue.key,
    steps
  };
}

export function normalizeJiraIssues(
  issues: RawJiraIssue[],
  options?: JiraNormalizerOptions
): TestScenario[] {
  return issues.map((issue) => normalizeJiraIssue(issue, options));
}
