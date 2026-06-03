import fs from "node:fs";
import path from "node:path";
import { config } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import type { RawTestRailCase } from "../../types/testrail.types";
import {
  buildScenarioPreviewScenarioId,
  ScenarioPreviewCaseMapping,
  ScenarioPreviewPublishContext,
} from "./testrail-sync-types";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const STORE_PATH = path.join(ROOT, ".artifacts", "testrail", "scenario-case-mappings.json");

type MappingStore = {
  version: number;
  mappings: ScenarioPreviewCaseMapping[];
};

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readStore(): MappingStore {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return { version: 1, mappings: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as Partial<MappingStore>;
    return {
      version: 1,
      mappings: Array.isArray(parsed.mappings) ? parsed.mappings as ScenarioPreviewCaseMapping[] : [],
    };
  } catch {
    return { version: 1, mappings: [] };
  }
}

function writeStore(store: MappingStore): void {
  ensureDir(STORE_PATH);
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function scenarioCacheKey(scenarioId: string, cacheKey: string, projectId: number, suiteId?: number, sectionId?: number): string {
  return [scenarioId, cacheKey, projectId, suiteId ?? "na", sectionId ?? "na"].join("|");
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s.]+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

export function sanitizeTestRailRef(value: string): string {
  const normalized = normalizeToken(value);
  if (!normalized) return "";
  if (normalized.length > 64) return normalized.slice(0, 64);
  return normalized;
}

export function buildSafeRefsFilter(input: {
  refs?: Array<string | undefined | null>;
  ref?: string | undefined | null;
  fallback?: string;
}): string {
  const raw = input.refs ?? (input.ref ? [input.ref] : []);
  const normalized = raw
    .map((value) => (typeof value === "string" ? sanitizeTestRailRef(value) : ""))
    .filter((value) => /^[A-Z0-9_-]{2,64}$/.test(value));
  const deduped = Array.from(new Set(normalized)).slice(0, 20);
  if (deduped.length > 0) return deduped.join(",");
  // Never return undefined — use fallback or generate a safe default
  if (input.fallback && /^[A-Z0-9_-]{2,64}$/.test(sanitizeTestRailRef(input.fallback))) {
    return sanitizeTestRailRef(input.fallback);
  }
  return "UNKNOWN-REF";
}

export function buildScenarioRefCandidates(
  scenario: ScenarioPreviewPublishContext["scenarios"][number],
  scenarioId: string,
  storyKey?: string,
): string[] {
  const keyRef = storyKey ? `${storyKey}-${scenarioId}` : undefined;
  const candidates = [
    keyRef,
    scenario.sourceIssueKey,
    scenarioId,
  ];
  return Array.from(new Set(candidates.filter((value): value is string => Boolean(value))));
}

export function buildSafeTestRailRefs(
  scenario: ScenarioPreviewPublishContext["scenarios"][number],
  scenarioId: string,
  storyKey?: string,
): string {
  const storyPrefix = sanitizeTestRailRef(storyKey ?? "");
  const scenarioToken = sanitizeTestRailRef(scenarioId);
  const storyScenarioRef = storyPrefix ? `${storyPrefix}-${scenarioToken}` : "";
  const ref = storyScenarioRef || sanitizeTestRailRef(scenario.sourceIssueKey ?? "") || scenarioToken || `PREVIEW-${scenarioId}`;
  return ref.replace(/[,|]/g, "").slice(0, 64) || `PREVIEW-${scenarioId}`.slice(0, 64);
}

function isRefs500Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("HTTP 500") && message.includes("Undefined array key refs");
}

async function recoverCaseAfterRefs500(
  client: TestRailClient,
  ctx: ScenarioPreviewPublishContext,
  scenarioTitle: string,
  scenarioId: string,
): Promise<{ case: RawTestRailCase; action: "created_with_warning" } | null> {
  try {
    const sectionCases = await client.getCases(String(ctx.projectId), ctx.suiteId ? String(ctx.suiteId) : undefined, String(ctx.sectionId));
    const normalizedTarget = normalizeTitle(scenarioTitle);
    const candidates = sectionCases.filter((c) => c.section_id === ctx.sectionId && normalizeTitle(c.title) === normalizedTarget);
    if (candidates.length === 0) return null;

    const byCustomId = candidates.find((c) => String(c.custom_scenario_id ?? "") === scenarioId);
    const found = byCustomId ?? candidates[0];

    console.log(`[testrail-publish] add_case returned 500 refs but case exists caseId=${found.id}`);
    console.log(`[testrail-publish] recoveredCreatedCase=true`);
    return { case: found, action: "created_with_warning" };
  } catch (searchError) {
    console.warn(`[testrail-publish] recovery search failed: ${searchError instanceof Error ? searchError.message : String(searchError)}`);
    return null;
  }
}

function parseFlatJsonObject(rawValue: string): Record<string, unknown> {
  const parsed = JSON.parse(rawValue) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid TESTRAIL_REQUIRED_CASE_FIELDS_JSON. Expected a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function parseRequiredCaseFields(rawValue?: string): Record<string, string> {
  if (!rawValue || !rawValue.trim() || rawValue.trim().toLowerCase() === "undefined") {
    return {};
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseFlatJsonObject(rawValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid TESTRAIL_REQUIRED_CASE_FIELDS_JSON";
    throw new Error(message);
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      result[key] = trimmed;
    }
  }
  return result;
}

function getConfiguredRequiredCaseFields(): Record<string, string> {
  const configured = config.integrations.testRail?.requiredCaseFields ?? {};
  try {
    const runtime = parseRequiredCaseFields(process.env.TESTRAIL_REQUIRED_CASE_FIELDS_JSON);
    return { ...configured, ...runtime };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[testrail-publish] ignoring invalid TESTRAIL_REQUIRED_CASE_FIELDS_JSON: ${message}`);
    return configured;
  }
}

function toStepsSeparated(scenario: ScenarioPreviewPublishContext["scenarios"][number]): Array<{ content: string; expected?: string }> {
  return scenario.steps.map((step, index) => ({
    content: step.replace(/^\d+[\.)]\s*/, "").trim(),
    expected: index === scenario.steps.length - 1 ? scenario.expectedResult : "",
  }));
}

function buildCustomFields(ctx: ScenarioPreviewPublishContext, scenarioId: string): Record<string, unknown> {
  const requiredCaseFields = getConfiguredRequiredCaseFields();
  const customFields: Record<string, unknown> = {
    custom_source: "qa_lab_generated",
    custom_scenario_id: scenarioId,
    custom_app_slug: ctx.appSlug,
    custom_sprint_id: ctx.sprintId ?? "",
    custom_story_key: ctx.storyKey ?? "",
    custom_cache_key: ctx.cacheKey,
  };

  for (const [key, value] of Object.entries(requiredCaseFields)) {
    if (key === "custom_case_oracle" || key === "custom_expected") {
      continue;
    }
    customFields[key] = value;
  }

  return customFields;
}

function sanitizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildCustomCaseOracle(scenario: ScenarioPreviewPublishContext["scenarios"][number], requiredCaseFields: Record<string, string>): string {
  const explicitOracle = sanitizeText(stripHtml((scenario as ScenarioPreviewPublishContext["scenarios"][number] & { caseOracle?: string }).caseOracle ?? ""));
  if (explicitOracle) return explicitOracle;

  const expectedResult = sanitizeText(stripHtml(scenario.expectedResult));
  if (expectedResult) return expectedResult;

  const validationLines = scenario.steps
    .map((step) => sanitizeText(stripHtml(step)))
    .filter((step): step is string => Boolean(step))
    .filter((step) => /^(?:validar|verificar|comprobar|confirmar|esperar|assert|should|validate|check)\b/i.test(step) || /\b(?:visible|muestre|mostrar|aparezca|exista|existan|se presente)\b/i.test(step));

  if (validationLines.length > 0) {
    return `Resultado esperado:\n- ${validationLines.join("\n- ")}`;
  }

  if (requiredCaseFields.custom_case_oracle) {
    return sanitizeText(requiredCaseFields.custom_case_oracle) ?? "Automatizado: validación funcional según pasos y resultado esperado del escenario.";
  }

  return "Automatizado: validación funcional según pasos y resultado esperado del escenario.";
}

function collectCustomFieldNames(customFields: Record<string, unknown>, hasExpected: boolean, hasCaseOracle: boolean): string[] {
  const keys = Object.keys(customFields);
  const fieldNames = new Set(keys);
  if (hasExpected) fieldNames.add("custom_expected");
  if (hasCaseOracle) fieldNames.add("custom_case_oracle");
  return Array.from(fieldNames);
}

function detectMissingRequiredField(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/custom_([a-z0-9_]+)\s+es obligatorio/i) ?? message.match(/:(custom_[a-z0-9_]+)\b/i);
  return match?.[1] ? `custom_${match[1].replace(/^custom_/, "")}` : undefined;
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

export function buildCustomExpected(scenario: ScenarioPreviewPublishContext["scenarios"][number]): string {
  const explicitExpected = sanitizeText(stripHtml(scenario.expectedResult));
  if (explicitExpected) return explicitExpected;

  const validationLines = scenario.steps
    .map((step) => sanitizeText(stripHtml(step)))
    .filter((step): step is string => Boolean(step))
    .filter((step) => /^(?:validar|verificar|comprobar|confirmar|esperar|assert|should|validate|check)\b/i.test(step) || /\b(?:visible|visible|muestre|mostrar|aparezca|aparezca|exista|existan|se presente)\b/i.test(step));

  if (validationLines.length > 0) {
    return `Resultado esperado:\n- ${validationLines.join("\n- ")}`;
  }

  return "El escenario debe completarse correctamente y las validaciones definidas deben cumplirse.";
}

function uniqueCaseIds(caseIds: number[]): number[] {
  return Array.from(new Set(caseIds));
}

export async function publishScenariosToTestRail(
  client: TestRailClient,
  ctx: ScenarioPreviewPublishContext,
): Promise<{
  mappings: ScenarioPreviewCaseMapping[];
  created: number;
  updated: number;
  reused: number;
  caseIds: number[];
}> {
  const store = readStore();
  const mappings: ScenarioPreviewCaseMapping[] = [];
  const caseIds: number[] = [];
  let created = 0;
  let updated = 0;
  let reused = 0;
  const requiredCaseFields = getConfiguredRequiredCaseFields();

  for (const [index, scenario] of ctx.scenarios.entries()) {
    const scenarioId = buildScenarioPreviewScenarioId(scenario, index);
    const key = scenarioCacheKey(scenarioId, ctx.cacheKey, ctx.projectId, ctx.suiteId, ctx.sectionId);
    const existingMapping = store.mappings.find((m) => scenarioCacheKey(m.scenarioId, m.cacheKey, m.projectId, m.suiteId, m.sectionId) === key);

    const stepsSeparated = toStepsSeparated(scenario);
    const customFields = buildCustomFields(ctx, scenarioId);
    const preconditions = sanitizeText(scenario.preconditions.join(" | "));
    const customExpected = buildCustomExpected(scenario);
    const customCaseOracle = buildCustomCaseOracle(scenario, requiredCaseFields);
        const refs = existingMapping?.testRailRef ?? buildSafeTestRailRefs(scenario, scenarioId, ctx.storyKey);
    const hasRefs = Boolean(refs);
    const refsType = typeof refs;
    const refsLength = typeof refs === "string" ? refs.length : 0;
    const refsPreview = refs.replace(/[|,]/g, "");
    console.log(`[testrail-debug] endpoint=add_case method=POST payloadKeys=title,custom_preconds,custom_expected,custom_case_oracle,custom_fields,refs queryKeys=none hasRefs=${hasRefs} refsType=${refsType} refsLength=${refsLength} refsPreview="${refsPreview}"`);
    console.log(`[testrail-publish] case=${scenarioId} refs="${refsPreview}" hasRefs=${hasRefs}`);
    const normalizedScenarioTitle = normalizeTitle(scenario.title);
    const customFieldNames = collectCustomFieldNames(customFields, Boolean(customExpected), Boolean(customCaseOracle));
    console.log(`[testrail-publish] case=${scenarioId} hasExpected=${Boolean(customExpected)} hasCaseOracle=${Boolean(customCaseOracle)} customFields=${customFieldNames.join(",")}`);

    let testRailCase: RawTestRailCase;
    let mappingSource: ScenarioPreviewCaseMapping["source"] = "created";

    try {
      if (existingMapping) {
        testRailCase = await client.updateCase(existingMapping.testRailCaseId, {
          title: scenario.title,
          refs,
          preconditions,
          customExpected,
          customCaseOracle,
          stepsSeparated,
          customFields,
        });
        mappingSource = "updated";
        updated += 1;
      } else {
        let found: RawTestRailCase[] = [];
        found = await client.getCasesByRefs(String(ctx.projectId), refs, ctx.suiteId ? String(ctx.suiteId) : undefined, String(ctx.sectionId));

        if (found.length === 0 && typeof client.getCases === "function") {
          const sectionCases = await client.getCases(String(ctx.projectId), ctx.suiteId ? String(ctx.suiteId) : undefined, String(ctx.sectionId));
          found = sectionCases.filter((c) => normalizeTitle(c.title) === normalizedScenarioTitle);
          if (found.length === 0) {
            found = sectionCases.filter((c) => normalizeTitle(c.title).includes(normalizedScenarioTitle) || normalizedScenarioTitle.includes(normalizeTitle(c.title)));
          }
        }

        const sectionCases = found.filter((c) => c.section_id === ctx.sectionId);
        const exactTitleReuse = sectionCases.find((c) => normalizeTitle(c.title) === normalizedScenarioTitle);
        const reusedCase = exactTitleReuse ?? (sectionCases.length === 1 ? sectionCases[0] : undefined);
        if (reusedCase) {
          testRailCase = await client.updateCase(reusedCase.id, {
            title: scenario.title,
            refs,
            preconditions,
            customExpected,
            customCaseOracle,
            stepsSeparated,
            customFields,
          });
          mappingSource = "reused";
          reused += 1;
        } else {
          testRailCase = await client.addCase(String(ctx.sectionId), {
            title: scenario.title,
            refs,
            preconditions,
            customExpected,
            customCaseOracle,
            stepsSeparated,
            customFields,
          });
          mappingSource = "created";
          created += 1;
        }
      }
    } catch (error) {
      const missingField = detectMissingRequiredField(error);
      if (missingField) {
        console.warn(`[testrail-publish] required field missing fieldName=${missingField} case=${scenarioId}`);
      }

      // Refs 500 recovery: TestRail creates the case but crashes on refs plugin/hook
      if (error && isRefs500Error(error) && mappingSource === "created") {
        const recovered = await recoverCaseAfterRefs500(client, ctx, scenario.title, scenarioId);
        if (recovered) {
          created += 1;
          testRailCase = recovered.case;
          mappingSource = recovered.action === "created_with_warning" ? "recovered" : "created";
          console.log(`[testrail-publish] recovered case=${scenarioId} caseId=${recovered.case.id} action=${recovered.action}`);
          // skip throw — continue with recovered case
        } else {
          console.error(`[testrail-publish] refs 500 recovery failed for case=${scenarioId}`);
          throw error;
        }
      } else {
        throw error;
      }
    }

        const mapping: ScenarioPreviewCaseMapping = {
          scenarioId,
          scenarioTitle: scenario.title,
          cacheKey: ctx.cacheKey,
          testRailRef: refs,
          testRailCaseId: testRailCase.id,
          sectionId: ctx.sectionId,
          projectId: ctx.projectId,
      suiteId: ctx.suiteId,
      updatedAt: new Date().toISOString(),
      source: mappingSource,
    };
    mappings.push(mapping);
    caseIds.push(testRailCase.id);
  }

  const existingByKey = new Map<string, ScenarioPreviewCaseMapping>();
  for (const mapping of store.mappings) {
    existingByKey.set(scenarioCacheKey(mapping.scenarioId, mapping.cacheKey, mapping.projectId, mapping.suiteId, mapping.sectionId), mapping);
  }
  for (const mapping of mappings) {
    existingByKey.set(scenarioCacheKey(mapping.scenarioId, mapping.cacheKey, mapping.projectId, mapping.suiteId, mapping.sectionId), mapping);
  }

  writeStore({ version: 1, mappings: Array.from(existingByKey.values()) });

  const uniqueCaseIdsList = uniqueCaseIds(caseIds);
  if (uniqueCaseIdsList.length < mappings.length) {
    console.warn(`[testrail-publish] warning uniqueCaseIds=${uniqueCaseIdsList.length} scenarioCount=${mappings.length}`);
  }

  return { mappings, created, updated, reused, caseIds: uniqueCaseIdsList };
}

export function readPersistedScenarioMappings(): ScenarioPreviewCaseMapping[] {
  return readStore().mappings;
}
