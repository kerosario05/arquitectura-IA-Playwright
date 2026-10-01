/**
 * Parses the structured text blocks Claude Builder and Codex Physical are required to emit
 * (see prompt-builder.ts / scripts/codex-qa-verify.ps1) into typed results. Deliberately a small,
 * forgiving key=value / section parser -- never a prose-understanding heuristic. Missing/
 * malformed fields default to the SAFEST (fail-closed) value: readyForPhysicalReplay=false,
 * satisfied lists empty, humanGate/externalBlocker/sourceChanged=false only when explicitly
 * absent (never inferred true, since a parse gap is not evidence of a real gate).
 */
import type { ClaudeResult, CodexPhysicalResult } from "./types";

/** Single wire-schema authority shared by prompt, Claude CLI validation, and result parsing. */
export const BUILDER_RESULT_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    actor: { type: "string", enum: ["CLAUDE", "CODEX_BUILDER"] },
    file: { type: "string" }, function: { type: "string" }, condition: { type: "string" }, reason: { type: "string" },
    filesChanged: { type: "array", items: { type: "string" } },
    behaviorChanged: { type: "boolean" }, sharedCoreReused: { type: "boolean" }, hardcoded: { type: "boolean" },
    positionUsed: { type: "boolean" }, sleepAdded: { type: "boolean" },
    passed: { type: "integer", minimum: 0 }, failed: { type: "integer", minimum: 0 },
    newTypeErrors: { type: "integer", minimum: 0 }, preExistingTypeErrors: { type: "integer", minimum: 0 },
    readyForPhysicalReplay: { type: "boolean" },
    successCriteriaSatisfied: { type: "array", items: { type: "string" } },
    successCriteriaOpen: { type: "array", items: { type: "string" } },
    humanGate: { type: "boolean" }, sourceChanged: { type: "boolean" }, externalBlocker: { type: "boolean" },
  },
  required: [
    "actor", "file", "function", "condition", "reason", "filesChanged", "behaviorChanged", "sharedCoreReused",
    "hardcoded", "positionUsed", "sleepAdded", "passed", "failed", "newTypeErrors", "preExistingTypeErrors",
    "readyForPhysicalReplay", "successCriteriaSatisfied", "successCriteriaOpen", "humanGate", "sourceChanged", "externalBlocker",
  ],
} as const;

type BuilderWireResult = Record<string, unknown>;

function structuredBuilderResult(text: string): BuilderWireResult | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const outer = parsed as Record<string, unknown>;
    const candidate = outer.structured_output ?? outer.result ?? outer;
    if (typeof candidate === "string") {
      const inner: unknown = JSON.parse(candidate);
      return inner && typeof inner === "object" && !Array.isArray(inner) ? inner as BuilderWireResult : undefined;
    }
    return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as BuilderWireResult : undefined;
  } catch { return undefined; }
}

export function structuredBuilderGate(text: string): boolean | undefined {
  const structured = structuredBuilderResult(text);
  return structured ? structured.humanGate === true : undefined;
}

export function structuredBuilderSourceChanged(text: string): boolean | undefined {
  const structured = structuredBuilderResult(text);
  return structured ? structured.sourceChanged === true : undefined;
}

function field(text: string, name: string): string | undefined {
  const match = text.match(new RegExp(`^${name}=(.*)$`, "mi"));
  return match ? match[1].trim() : undefined;
}

function boolField(text: string, name: string): boolean {
  return (field(text, name) ?? "").toLowerCase() === "true";
}

function intField(text: string, name: string): number {
  const raw = field(text, name);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function listField(text: string, name: string): string[] {
  const raw = field(text, name);
  if (!raw) return [];
  const inner = raw.replace(/^\[|\]$/g, "").trim();
  if (!inner) return [];
  return inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

export function hasBuilderResultContract(text: string, actor: ClaudeResult["actor"]): boolean {
  return getBuilderResultContractErrors(text, actor).length === 0;
}

/** Strictly reports contract omissions; it does not repair or interpret the response. */
export function getBuilderResultContractErrors(text: string, actor: ClaudeResult["actor"]): string[] {
  const structured = structuredBuilderResult(text);
  if (structured) {
    const errors: string[] = [];
    for (const name of BUILDER_RESULT_JSON_SCHEMA.required) if (!(name in structured)) errors.push(`missing required field ${name}`);
    for (const name of Object.keys(structured)) if (!(name in BUILDER_RESULT_JSON_SCHEMA.properties)) errors.push(`unexpected field ${name}`);
    if (structured.actor !== actor) errors.push(`missing or invalid actor=${actor}`);
    for (const [name, schema] of Object.entries(BUILDER_RESULT_JSON_SCHEMA.properties)) {
      if (!(name in structured)) continue;
      const value = structured[name];
      const valid = schema.type === "array"
        ? Array.isArray(value) && value.every((item) => typeof item === "string")
        : schema.type === "integer" ? Number.isInteger(value) && (value as number) >= 0
          : schema.type === "boolean" ? typeof value === "boolean" : typeof value === "string";
      if (!valid) errors.push(`invalid field ${name}`);
    }
    return errors;
  }
  const errors: string[] = [];
  if (!new RegExp(`^actor=${actor}$`, "mi").test(text)) errors.push(`missing or invalid actor=${actor}`);
  for (const marker of BUILDER_RESULT_JSON_SCHEMA.required.map((name) => `${name}=`)) {
    if (!new RegExp(`^${marker}`, "mi").test(text)) errors.push(`missing required field ${marker.slice(0, -1)}`);
  }
  return errors;
}

export function parseClaudeResult(text: string, taskId: string, iteration: number, actor: ClaudeResult["actor"] = "CLAUDE"): ClaudeResult {
  const structured = structuredBuilderResult(text);
  if (structured) {
    const strings = (key: string) => Array.isArray(structured[key]) ? (structured[key] as unknown[]).filter((value): value is string => typeof value === "string") : [];
    const string = (key: string) => typeof structured[key] === "string" ? structured[key] as string : "";
    const bool = (key: string) => structured[key] === true;
    const integer = (key: string) => Number.isInteger(structured[key]) && (structured[key] as number) >= 0 ? structured[key] as number : 0;
    return {
      actor, taskId, iteration,
      firstLoss: { file: string("file"), function: string("function"), condition: string("condition"), reason: string("reason") },
      fix: { filesChanged: strings("filesChanged"), behaviorChanged: bool("behaviorChanged"), sharedCoreReused: bool("sharedCoreReused"), hardcoded: bool("hardcoded"), positionUsed: bool("positionUsed"), sleepAdded: bool("sleepAdded") },
      tests: { passed: integer("passed"), failed: integer("failed"), newTypeErrors: integer("newTypeErrors"), preExistingTypeErrors: integer("preExistingTypeErrors") },
      result: { readyForPhysicalReplay: bool("readyForPhysicalReplay"), successCriteriaSatisfied: strings("successCriteriaSatisfied"), successCriteriaOpen: strings("successCriteriaOpen"), humanGate: bool("humanGate"), sourceChanged: bool("sourceChanged"), externalBlocker: bool("externalBlocker") },
    };
  }
  return {
    actor,
    taskId,
    iteration,
    firstLoss: {
      file: field(text, "file") ?? "",
      function: field(text, "function") ?? "",
      condition: field(text, "condition") ?? "",
      reason: field(text, "reason") ?? "",
    },
    fix: {
      filesChanged: listField(text, "filesChanged"),
      behaviorChanged: boolField(text, "behaviorChanged"),
      sharedCoreReused: boolField(text, "sharedCoreReused"),
      hardcoded: boolField(text, "hardcoded"),
      positionUsed: boolField(text, "positionUsed"),
      sleepAdded: boolField(text, "sleepAdded"),
    },
    tests: {
      passed: intField(text, "passed"),
      failed: intField(text, "failed"),
      newTypeErrors: intField(text, "newTypeErrors"),
      preExistingTypeErrors: intField(text, "preExistingTypeErrors"),
    },
    result: {
      readyForPhysicalReplay: boolField(text, "readyForPhysicalReplay"),
      successCriteriaSatisfied: listField(text, "successCriteriaSatisfied"),
      successCriteriaOpen: listField(text, "successCriteriaOpen"),
      humanGate: boolField(text, "humanGate"),
      sourceChanged: boolField(text, "sourceChanged"),
      externalBlocker: boolField(text, "externalBlocker"),
    },
  };
}

/** Parses scripts/codex-qa-verify.ps1's own FRESH RUN / FIRST LOSS output block. */
export function parseCodexPhysicalResult(text: string, taskId: string, iteration: number): CodexPhysicalResult {
  const guardStatus = field(text, "REPO_CHANGE_GUARD status") ?? field(text, "status");
  const sourceChanged = /REPO_CHANGE_GUARD status=HUMAN_GATE/i.test(text);
  const firstLossFile = field(text, "file");
  const firstLossReason = field(text, "reason");
  return {
    actor: "CODEX_PHYSICAL",
    taskId,
    iteration,
    freshRunId: field(text, "jobId") ?? "",
    recordingId: field(text, "recordingId"),
    replayRunId: field(text, "replayRunId"),
    physical: {
      fresh: /FRESH RUN/i.test(text) && !/reutiliza|stale|old job/i.test(text),
      stepsExpected: intField(text, "stepsExpected"),
      stepsExecuted: intField(text, "stepsExecuted"),
      firstFailedStep: field(text, "firstFailedStep"),
      functionalExecution: boolField(text, "functionalExecution"),
      causalOutcomeObserved: boolField(text, "causalOutcomeObserved"),
    },
    firstLoss: firstLossFile
      ? { boundary: firstLossFile, artifact: field(text, "condition") ?? "", reason: firstLossReason ?? "" }
      : undefined,
    successCriteriaSatisfied: listField(text, "successCriteriaSatisfied"),
    successCriteriaOpen: listField(text, "successCriteriaOpen"),
    humanGate: boolField(text, "humanGate") || Boolean(guardStatus && /HUMAN_GATE/i.test(guardStatus)),
    externalBlocker: boolField(text, "externalBlocker"),
    sourceChanged,
  };
}
