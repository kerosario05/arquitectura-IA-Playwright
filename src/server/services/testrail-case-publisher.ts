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

type RecoveryResult =
  | { found: true; case: RawTestRailCase; strength: "cache_key_and_scenario_id" | "scenario_id_and_title" | "exact_title" }
  | { found: false; reason: "no_candidates" | "search_failed" | "ambiguous"; candidateCount?: number; candidateIds?: number[] };

async function recoverCaseAfterRefs500(
  client: TestRailClient,
  ctx: ScenarioPreviewPublishContext,
  scenarioTitle: string,
  scenarioId: string,
): Promise<RecoveryResult> {
  try {
    const sectionCases = await client.getCases(String(ctx.projectId), ctx.suiteId ? String(ctx.suiteId) : undefined, String(ctx.sectionId));
    const normalizedTarget = normalizeTitle(scenarioTitle);
    const sectionScoped = sectionCases.filter((c) => c.section_id === ctx.sectionId);
    const candidates = sectionScoped.filter((c) => normalizeTitle(c.title) === normalizedTarget);

    if (candidates.length === 0) {
      // Try broader: search by custom_cache_key + custom_scenario_id even if title doesn't match
      const cacheKey = ctx.cacheKey;
      const byCacheAndScenario = sectionScoped.filter(
        (c) => String(c.custom_cache_key ?? "") === cacheKey && String(c.custom_scenario_id ?? "") === scenarioId,
      );
      if (byCacheAndScenario.length === 1) {
        console.log(`[testrail-publish] recovered by cache_key+scenario_id caseId=${byCacheAndScenario[0].id}`);
        return { found: true, case: byCacheAndScenario[0], strength: "cache_key_and_scenario_id" };
      }
      if (byCacheAndScenario.length > 1) {
        const ids = byCacheAndScenario.map((c) => c.id);
        console.warn(`[testrail-publish] recovery ambiguous by cache_key+scenario_id candidates=${ids.length} ids=${ids.join(",")}`);
        return { found: false, reason: "ambiguous", candidateCount: ids.length, candidateIds: ids };
      }

      // No title match, no cache match — search by custom_scenario_id alone as last resort
      const byScenarioId = sectionScoped.filter((c) => String(c.custom_scenario_id ?? "") === scenarioId);
      if (byScenarioId.length === 1) {
        console.log(`[testrail-publish] recovered by scenario_id alone caseId=${byScenarioId[0].id}`);
        return { found: true, case: byScenarioId[0], strength: "scenario_id_and_title" };
      }
      if (byScenarioId.length > 1) {
        const ids = byScenarioId.map((c) => c.id);
        console.warn(`[testrail-publish] recovery ambiguous by scenario_id only candidates=${ids.length} ids=${ids.join(",")}`);
        return { found: false, reason: "ambiguous", candidateCount: ids.length, candidateIds: ids };
      }

      return { found: false, reason: "no_candidates" };
    }

    // We have title-match candidates — narrow down by strong keys
    const cacheKey = ctx.cacheKey;
    const byCacheAndScenario = candidates.filter(
      (c) => String(c.custom_cache_key ?? "") === cacheKey && String(c.custom_scenario_id ?? "") === scenarioId,
    );
    if (byCacheAndScenario.length === 1) {
      console.log(`[testrail-publish] recovered by cache_key+scenario_id caseId=${byCacheAndScenario[0].id}`);
      return { found: true, case: byCacheAndScenario[0], strength: "cache_key_and_scenario_id" };
    }
    if (byCacheAndScenario.length > 1) {
      const ids = byCacheAndScenario.map((c) => c.id);
      console.warn(`[testrail-publish] recovery ambiguous by cache_key+scenario_id (title match) candidates=${ids.length} ids=${ids.join(",")}`);
      return { found: false, reason: "ambiguous", candidateCount: ids.length, candidateIds: ids };
    }

    // Next: match by custom_scenario_id alone
    const byScenarioId = candidates.filter((c) => String(c.custom_scenario_id ?? "") === scenarioId);
    if (byScenarioId.length === 1) {
      console.log(`[testrail-publish] recovered by scenario_id caseId=${byScenarioId[0].id}`);
      return { found: true, case: byScenarioId[0], strength: "scenario_id_and_title" };
    }
    if (byScenarioId.length > 1) {
      const ids = byScenarioId.map((c) => c.id);
      console.warn(`[testrail-publish] recovery ambiguous by scenario_id candidates=${ids.length} ids=${ids.join(",")}`);
      return { found: false, reason: "ambiguous", candidateCount: ids.length, candidateIds: ids };
    }

    // Fallback: single exact title match
    if (candidates.length === 1) {
      console.log(`[testrail-publish] recovered by exact title caseId=${candidates[0].id}`);
      return { found: true, case: candidates[0], strength: "exact_title" };
    }

    // Multiple title matches, no strong key disambiguation
    const ids = candidates.map((c) => c.id);
    console.warn(`[testrail-publish] recovery ambiguous by title (no strong keys) candidates=${ids.length} ids=${ids.join(",")}`);
    return { found: false, reason: "ambiguous", candidateCount: ids.length, candidateIds: ids };
  } catch (searchError) {
    console.warn(`[testrail-publish] recovery search failed: ${searchError instanceof Error ? searchError.message : String(searchError)}`);
    return { found: false, reason: "search_failed" };
  }
}

function recoveryDiagnosticInfo(
  ctx: ScenarioPreviewPublishContext,
  scenarioTitle: string,
  scenarioId: string,
  result: RecoveryResult,
): Record<string, unknown> {
  return {
    sectionId: ctx.sectionId,
    scenarioId,
    title: scenarioTitle,
    cacheKey: ctx.cacheKey,
    candidateCount: result.found ? undefined : ("candidateCount" in result ? result.candidateCount : undefined),
    candidateIds: result.found ? undefined : ("candidateIds" in result ? result.candidateIds : undefined),
  };
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
  // Build clean steps: never mix global expectedResult into step-level expected.
  // Global expectedResult is sent separately via custom_expected.
  return scenario.steps.map((step) => ({
    content: step.replace(/^\d+[\.)]\s*/, "").trim(),
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

const TESTRAIL_DEFAULT_CASE_ORACLE = process.env.TESTRAIL_DEFAULT_CASE_ORACLE || "QA";

function buildCustomCaseOracle(scenario: ScenarioPreviewPublishContext["scenarios"][number], requiredCaseFields: Record<string, string>): string {
  // Priority: explicit scenario.caseOracle > TESTRAIL_DEFAULT_CASE_ORACLE > required fields > fallback
  const explicitOracle = sanitizeText(stripHtml((scenario as ScenarioPreviewPublishContext["scenarios"][number] & { caseOracle?: string }).caseOracle ?? ""));
  if (explicitOracle) return explicitOracle;

  if (TESTRAIL_DEFAULT_CASE_ORACLE) return TESTRAIL_DEFAULT_CASE_ORACLE;

  if (requiredCaseFields.custom_case_oracle) {
    return sanitizeText(requiredCaseFields.custom_case_oracle) ?? "QA";
  }

  return "QA";
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

async function findExistingCaseByCacheKey(
  client: TestRailClient,
  ctx: ScenarioPreviewPublishContext,
  scenarioId: string,
): Promise<RawTestRailCase | null> {
  try {
    const sectionCases = await client.getCases(String(ctx.projectId), ctx.suiteId ? String(ctx.suiteId) : undefined, String(ctx.sectionId));
    const cacheKey = ctx.cacheKey;
    const match = sectionCases.find(
      (c) =>
        c.section_id === ctx.sectionId &&
        String(c.custom_cache_key ?? "") === cacheKey &&
        String(c.custom_scenario_id ?? "") === scenarioId,
    );
    return match ?? null;
  } catch {
    return null;
  }
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

  const scenarioIds = ctx.scenarios.map((_, i) => buildScenarioPreviewScenarioId(_, i));
  console.log(`[testrail-publish] input scenarios count=${ctx.scenarios.length} ids=${scenarioIds.join(",")}`);

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
      } else if (ctx.publishStrategy === "always_create") {
        // Dedup: before creating, check if a case with matching cache_key + scenario_id already exists from a previous 500
        const preExisting = await findExistingCaseByCacheKey(client, ctx, scenarioId);
        if (preExisting) {
          testRailCase = preExisting;
          mappingSource = "reused_from_same_launch_after_previous_500";
          reused += 1;
          console.log(`[testrail-publish] reused existing case after previous 500 scenario=${scenarioId} caseId=${testRailCase.id}`);
        } else {
          try {
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
          } catch (addErr: any) {
          const addMsg = addErr.message ?? String(addErr);
          if (addMsg.includes("Undefined array key") && addMsg.includes("refs")) {
            // RECOVERY #1: full addCase 500 — try to find the case that was created
            console.warn(`[testrail-publish] full addCase failed; attempting immediate recovery scenario=${scenarioId} reason=refs_error`);
            const recovery1 = await recoverCaseAfterRefs500(client, ctx, scenario.title, scenarioId);
            if (recovery1.found) {
              testRailCase = recovery1.case;
              mappingSource = "recovered_after_add_case_500";
              created += 1;
              console.log(`[testrail-publish] recovery after full addCase succeeded scenario=${scenarioId} caseId=${testRailCase.id} strength=${recovery1.strength}`);
            } else if (recovery1.reason === "ambiguous") {
              const diag = recoveryDiagnosticInfo(ctx, scenario.title, scenarioId, recovery1);
              throw new Error(`testrail_add_case_500_recovery_ambiguous: full addCase 500 produced multiple candidates. sectionId=${ctx.sectionId} scenarioId=${scenarioId} diagnostic=${JSON.stringify(diag)}`);
            } else {
              // No candidates found — try compatibility without refs
              console.warn(`[testrail-publish] recovery after full addCase found no candidates; trying compatibility payload scenario=${scenarioId}`);
              const stepsText = stepsSeparated.map((s, i) => `${i + 1}. ${s.content}`).join("\n");
              const precondsText = typeof preconditions === "string" && preconditions.trim() ? preconditions : "Precondiciones:\n- App disponible.\n- Usuario o ambiente de prueba configurado.";
              const noRefsPayload = {
                title: scenario.title,
                custom_steps: stepsText,
                custom_preconds: precondsText,
                custom_expected: customExpected || "Validación funcional automatizada.",
                custom_case_oracle: customCaseOracle || process.env.TESTRAIL_DEFAULT_CASE_ORACLE || "QA",
              };
              const noRefsKeys = Object.keys(noRefsPayload).join(",");
              console.log(`[testrail-publish] compatibility no-refs payload keys=${noRefsKeys}`);
              try {
                testRailCase = await client.addCase(String(ctx.sectionId), noRefsPayload as any, { preservePayload: true });
                mappingSource = "created";
                created += 1;
                console.log(`[testrail-publish] compatibility retry succeeded case=${scenarioId} caseId=${testRailCase.id}`);
              } catch (compatErr: any) {
                const compatMsg = compatErr.message ?? String(compatErr);
                console.error(`[testrail-publish] compatibility addCase failed; attempting second recovery scenario=${scenarioId} error="${compatMsg.slice(0, 200)}"`);
                // RECOVERY #2: compatibility addCase also failed — try recovery again
                if (compatMsg.includes("Undefined array key") && compatMsg.includes("refs")) {
                  const recovery2 = await recoverCaseAfterRefs500(client, ctx, scenario.title, scenarioId);
                  if (recovery2.found) {
                    testRailCase = recovery2.case;
                    mappingSource = "recovered_after_add_case_500";
                    created += 1;
                    console.log(`[testrail-publish] recovery after compatibility addCase succeeded scenario=${scenarioId} caseId=${testRailCase.id} strength=${recovery2.strength}`);
                  } else if (recovery2.reason === "ambiguous") {
                    const diag = recoveryDiagnosticInfo(ctx, scenario.title, scenarioId, recovery2);
                    throw new Error(`testrail_add_case_500_recovery_ambiguous: compatibility addCase 500 produced multiple candidates. sectionId=${ctx.sectionId} scenarioId=${scenarioId} diagnostic=${JSON.stringify(diag)}`);
                  } else {
                    const diag = recoveryDiagnosticInfo(ctx, scenario.title, scenarioId, recovery2);
                    throw new Error(`testrail_refs_hook_failure: TestRail add_case failed even without refs in minimal required payload. This points to a TestRail/Jira coverage customization or plugin issue. sectionId=${ctx.sectionId} payloadKeys=${noRefsKeys} omittedKeys=refs,custom_refs,custom_steps_separated recoveryReason=${recovery2.reason} diagnostic=${JSON.stringify(diag)}`);
                  }
                }
                throw new Error(`testrail_add_case_minimal_failed: title+refs also failed: ${compatMsg}`);
              }
            }
          } else if (addMsg.includes("refs")) {
            // full addCase failed with generic refs error (not Undefined array key)
            console.warn(`[testrail-publish] addCase full payload failed; retrying with compatibility payload reason=refs_error case=${scenarioId}`);
            const minimalPayload = { title: scenario.title, refs: refs || "" };
            const compatKeys = Object.keys(minimalPayload).join(",");
            console.log(`[testrail-publish] compatibility payload keys=${compatKeys}`);
            try {
              testRailCase = await client.addCase(String(ctx.sectionId), minimalPayload as any, { compatibilityMode: true });
              mappingSource = "created";
              created += 1;
              console.log(`[testrail-publish] compatibility retry succeeded case=${scenarioId} caseId=${testRailCase.id}`);
            } catch (compatErr: any) {
              const compatMsg = compatErr.message ?? String(compatErr);
              console.error(`[testrail-publish] compatibility retry failed case=${scenarioId} error="${compatMsg.slice(0, 200)}"`);
              throw new Error(`testrail_add_case_minimal_failed: title+refs also failed: ${compatMsg}`);
            }
          } else {
            throw addErr;
          }
          }
        }
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
        if (recovered.found) {
          created += 1;
          testRailCase = recovered.case;
          mappingSource = "recovered_after_add_case_500";
          console.log(`[testrail-publish] recovered case=${scenarioId} caseId=${recovered.case.id} strength=${recovered.strength}`);
          // skip throw — continue with recovered case
        } else {
          const diag = recoveryDiagnosticInfo(ctx, scenario.title, scenarioId, recovered);
          console.error(`[testrail-publish] refs 500 recovery failed for case=${scenarioId} reason=${recovered.reason} diagnostic=${JSON.stringify(diag)}`);
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

  const resultIds = mappings.map((m) => m.scenarioId).join(",");
  const resultCaseIds = uniqueCaseIdsList.join(",");
  console.log(`[testrail-publish] output publishedCases count=${mappings.length} ids=${resultIds} caseIds=${resultCaseIds}`);

  return { mappings, created, updated, reused, caseIds: uniqueCaseIdsList };
}

export function readPersistedScenarioMappings(): ScenarioPreviewCaseMapping[] {
  return readStore().mappings;
}
