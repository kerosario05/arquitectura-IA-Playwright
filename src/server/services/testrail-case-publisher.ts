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
import { describeTestRailRecordingPayload, validateTestRailRecordingPayload } from "../../recording/testrail-recording-payload";
import { serializeTestRailSteps } from "../../testrail/testrail-step-serializer";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const STORE_PATH = path.join(ROOT, ".artifacts", "testrail", "scenario-case-mappings.json");

type MappingStore = {
  version: number;
  mappings: ScenarioPreviewCaseMapping[];
};

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

const RECOVERY_TIMEOUT_MS = 30000;

/**
 * TestRail can commit an add_case and fail while running its post-processing hook.  Recording
 * publication therefore treats a post-send 5xx as ambiguous and gives the case a bounded,
 * adaptive reconciliation window.  These are deliberately scoped to reconciliation; they do
 * not turn ordinary publisher calls into long retries.
 */
const AMBIGUOUS_RECONCILIATION_ATTEMPTS = Math.max(1, Number(process.env.TESTRAIL_AMBIGUOUS_RECONCILIATION_ATTEMPTS ?? 3));
const AMBIGUOUS_RECONCILIATION_DEADLINE_MS = Math.max(250, Number(process.env.TESTRAIL_AMBIGUOUS_RECONCILIATION_DEADLINE_MS ?? 10000));
const AMBIGUOUS_RECONCILIATION_INITIAL_DELAY_MS = Math.max(25, Number(process.env.TESTRAIL_AMBIGUOUS_RECONCILIATION_INITIAL_DELAY_MS ?? 150));

function sectionCaseSnapshot(
  client: TestRailClient,
  ctx: ScenarioPreviewPublishContext,
): Promise<RawTestRailCase[]> {
  return client.getCases(
    String(ctx.projectId),
    ctx.suiteId ? String(ctx.suiteId) : undefined,
    String(ctx.sectionId),
  );
}

function newlyAppearedCases(
  beforeIds: ReadonlySet<number>,
  cases: readonly RawTestRailCase[],
  sectionId: number,
  title: string,
  refs?: string,
): RawTestRailCase[] {
  const normalizedTitle = normalizeTitle(title);
  const normalizedRefs = refs?.trim();
  const delta = cases.filter((candidate) =>
    candidate.section_id === sectionId
    && !beforeIds.has(candidate.id)
    && normalizeTitle(candidate.title) === normalizedTitle,
  );
  if (!normalizedRefs) return delta;
  const withRefs = delta.filter((candidate) => String(candidate.refs ?? "").trim() === normalizedRefs);
  // Refs are useful discrimination only when the API actually returns them.  Do not discard a
  // title match merely because a compatible TestRail response omits refs.
  return withRefs.length > 0 ? withRefs : delta;
}

async function recoverCaseCreatedAfterHttp500(params: {
  client: TestRailClient;
  ctx: ScenarioPreviewPublishContext;
  scenarioTitle: string;
  marker: string | undefined;
  scenarioId?: string;
}): Promise<{ found: true; case: RawTestRailCase } | { found: false; matches: number }> {
  const { client, ctx, scenarioTitle, marker, scenarioId } = params;
  const scenarioLabel = scenarioId ?? "unknown";

  const runRecovery = async (): Promise<{ found: true; case: RawTestRailCase } | { found: false; matches: number }> => {
    if (!marker || typeof client.getCases !== "function") {
      return { found: false, matches: 0 };
    }

    const sectionCases = await client.getCases(
      String(ctx.projectId),
      ctx.suiteId ? String(ctx.suiteId) : undefined,
      String(ctx.sectionId),
    );
    const normalizedScenarioTitle = normalizeTitle(scenarioTitle);
    const matches = sectionCases.filter((testCase) => {
      const sameSection = testCase.section_id === ctx.sectionId;
      const sameTitle = normalizeTitle(testCase.title) === normalizedScenarioTitle;
      const preconditions = String(testCase.custom_preconds ?? "");
      return sameSection && sameTitle && preconditions.includes(marker);
    });

    if (matches.length === 1) {
      return { found: true, case: matches[0] };
    }
    return { found: false, matches: matches.length };
  };

  // Total deadline for the whole recovery (not per-page). If the caller's timeout fires first,
  // we release the publisher without re-running add_case (the case may exist despite the 500).
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      console.warn(`[testrail-publish-recovery] status=timeout scenario=${scenarioLabel} sectionId=${ctx.sectionId} timeoutMs=${RECOVERY_TIMEOUT_MS}`);
      reject(new Error(`testrail_add_case_500_recovery_timeout: sectionId=${ctx.sectionId} scenarioId=${scenarioLabel} timeoutMs=${RECOVERY_TIMEOUT_MS}`));
    }, RECOVERY_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();
  });

  try {
    return await Promise.race([runRecovery(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  // The scenario's own canonical identity (e.g. "REC-D8DBD8F9-01", populated by
  // toPublishableScenario for Recording-sourced scenarios), when available, is what must be
  // matched exactly on a later execution (see verifyExistingMappingIsExactMatch) — prefer it
  // over the caller-supplied `scenarioId` parameter, which for Recording batches is the
  // publisher's own ephemeral, internal mapping id (e.g. "L-d8dbd8f9-001", built from
  // launchId+index — see buildScenarioPreviewScenarioId). That internal id is a legitimate
  // cache/dedup key inside this module, but it must never become part of the case's own
  // authoritative remote identity: it does not identify the scenario itself.
  const canonicalScenarioId = sanitizeTestRailRef(scenario.scenarioId ?? "");
  const scenarioToken = canonicalScenarioId || sanitizeTestRailRef(scenarioId);
  const storyScenarioRef = storyPrefix ? `${storyPrefix}-${scenarioToken}` : "";
  // sourceIssueKey (a Recording's or Jira story's grouping reference, e.g. "REC-D8DBD8F9") is
  // parent-level metadata shared by every scenario under it — it is never, by itself, a scenario
  // identity. When no storyKey was supplied this branch used to return sourceIssueKey bare,
  // which collided every scenario in the same Recording/story onto the identical refs value
  // (REC-XXXXXXXX-01, -02, -03 all publishing/reconciling as plain "REC-XXXXXXXX"). A canonical
  // scenario identity is already a complete, recording/story-scoped identity by itself, so it is
  // used directly rather than prefixed with sourceIssueKey again (which would just duplicate the
  // same "REC-D8DBD8F9" prefix); sourceIssueKey is only combined with scenarioToken as a
  // fallback when no canonical identity exists, exactly as before this fix.
  // buildScenarioRefCandidates still tries the bare sourceIssueKey too, so a case created under
  // the old bare-ref scheme is still found on lookup.
  const sourceIssuePrefix = sanitizeTestRailRef(scenario.sourceIssueKey ?? "");
  const sourceIssueScenarioRef = canonicalScenarioId
    ? canonicalScenarioId
    : sourceIssuePrefix ? `${sourceIssuePrefix}-${scenarioToken}` : "";
  const ref = storyScenarioRef || sourceIssueScenarioRef || scenarioToken || `PREVIEW-${scenarioId}`;
  return ref.replace(/[,|]/g, "").slice(0, 64) || `PREVIEW-${scenarioId}`.slice(0, 64);
}

export type ExistingMappingVerification =
  | { valid: true; case: RawTestRailCase }
  | { valid: false; reason: "remote_not_found" | "wrong_section" | "identity_not_exact" };

/**
 * A cached local mapping (the publisher's own persisted store, keyed by the virtual scenarioId +
 * destination) is a hint, never proof. TestRail itself must confirm the case still exists, still
 * belongs to this exact section, AND carries this exact scenario's own ref — not just the parent
 * Recording/story's bare grouping ref, which an older cached mapping (from before
 * buildSafeTestRailRefs started combining sourceIssueKey with the scenario's own token) may
 * still carry. `exactRefCandidates` must only ever contain scenario-specific refs (the freshly
 * computed buildSafeTestRailRefs output) — never the bare recording-level ref — so a mapping
 * built under the old, colliding ref scheme is correctly treated as stale/unverified rather than
 * an exact match. Pure and exported for hermetic testing.
 */
export function verifyExistingMappingIsExactMatch(
  remoteCase: RawTestRailCase | undefined,
  ctx: { sectionId: number },
  exactRefCandidates: string[],
): ExistingMappingVerification {
  if (!remoteCase) return { valid: false, reason: "remote_not_found" };
  if (typeof remoteCase.section_id === "number" && remoteCase.section_id !== ctx.sectionId) {
    return { valid: false, reason: "wrong_section" };
  }
  const remoteRef = (remoteCase.refs ?? "").trim();
  if (!remoteRef || !exactRefCandidates.includes(remoteRef)) {
    return { valid: false, reason: "identity_not_exact" };
  }
  return { valid: true, case: remoteCase };
}

function isLegacyPreviewPattern(id: string): boolean {
  // Legacy patterns: PREVIEW-001, PREVIEW-002, LAUNCH-001, LAUNCH-002
  // These are NOT globally unique and should not be used as persistent TestRail custom_scenario_id
  return /^(PREVIEW-\d{3}|LAUNCH-\d+)$/.test(id);
}

function isNewLaunchPattern(id: string): boolean {
  // New globally unique pattern: L-{hex8}-{3digits}
  // Example: L-abe094d6-001, L-abe094d6-002
  return /^L-[a-f0-9]{8}-\d{3}$/.test(id);
}

function shouldIgnoreLegacyAmbiguity(requestedId: string, candidateIds: Array<string | undefined>): boolean {
  // If requested ID is new format (L-{hex8}-{3digits}) and all candidates are legacy (PREVIEW-* or LAUNCH-*),
  // treat as not found instead of ambiguous
  if (!isNewLaunchPattern(requestedId)) return false;

  const validCandidates = candidateIds.filter((id): id is string => Boolean(id));
  if (validCandidates.length === 0) return false;

  const allLegacy = validCandidates.every(id => isLegacyPreviewPattern(id));
  return allLegacy;
}

function shouldSelectFirstExactMatch(requestedId: string, candidateIds: Array<string | undefined>): boolean {
  // If requested ID is new format and ALL candidates have the EXACT SAME ID as requested,
  // this means there are duplicate cases in TestRail with the same custom_scenario_id.
  // In this case, we should select one (first/most recent) instead of failing with ambiguous.
  if (!isNewLaunchPattern(requestedId)) return false;

  const validCandidates = candidateIds.filter((id): id is string => Boolean(id));
  if (validCandidates.length === 0) return false;

  const allExactMatch = validCandidates.every(id => id === requestedId);
  return allExactMatch;
}

function isRefs500Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("HTTP 500") && message.includes("Undefined array key refs");
}

type RecoveryResult =
  | { found: true; case: RawTestRailCase; strength: "cache_key_and_scenario_id" | "scenario_id_and_title" | "exact_title" | "unique_marker" | "unique_marker_ambiguous" }
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
        const candidateScenarioIds = byCacheAndScenario.map((c) => String(c.custom_scenario_id ?? ""));

        // If requested ID is new format and all candidates are legacy PREVIEW, treat as not found
        if (shouldIgnoreLegacyAmbiguity(scenarioId, candidateScenarioIds)) {
          console.log(`[testrail-publish] ignoring legacy PREVIEW ambiguity requestedId=${scenarioId} legacyCount=${candidateScenarioIds.length}`);
          return { found: false, reason: "no_candidates" };
        }

        // If all candidates have the EXACT SAME ID as requested, select first (duplicate cleanup needed in TestRail)
        if (shouldSelectFirstExactMatch(scenarioId, candidateScenarioIds)) {
          console.log(`[testrail-publish] selecting first of ${byCacheAndScenario.length} exact duplicates requestedId=${scenarioId} selectedCaseId=${byCacheAndScenario[0].id}`);
          return { found: true, case: byCacheAndScenario[0], strength: "cache_key_and_scenario_id" };
        }

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
        const candidateScenarioIds = byScenarioId.map((c) => String(c.custom_scenario_id ?? ""));

        // If requested ID is new format and all candidates are legacy PREVIEW, treat as not found
        if (shouldIgnoreLegacyAmbiguity(scenarioId, candidateScenarioIds)) {
          console.log(`[testrail-publish] ignoring legacy PREVIEW ambiguity requestedId=${scenarioId} legacyCount=${candidateScenarioIds.length}`);
          return { found: false, reason: "no_candidates" };
        }

        // If all candidates have the EXACT SAME ID as requested, select first (duplicate cleanup needed in TestRail)
        if (shouldSelectFirstExactMatch(scenarioId, candidateScenarioIds)) {
          console.log(`[testrail-publish] selecting first of ${byScenarioId.length} exact duplicates requestedId=${scenarioId} selectedCaseId=${byScenarioId[0].id}`);
          return { found: true, case: byScenarioId[0], strength: "scenario_id_and_title" };
        }

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

    // If multiple title-cache-scenario matches, try unique marker in custom_preconds
    const launchId = (ctx as any).launchId as string | undefined;
    const uniqueMarker = buildAutomationScenarioMarker(scenarioId, launchId) ?? "";
    if (uniqueMarker && candidates.length > 1) {
      console.log(`[testrail-recovery] addCase500 candidates=${candidates.length} title="${scenarioTitle}" checking unique marker`);
      const byMarker = candidates.filter((c) => {
        const preconds = String(c.custom_preconds ?? "");
        return preconds.includes(uniqueMarker);
      });
      if (byMarker.length === 1) {
        console.log(`[testrail-recovery] selectedByUniqueMarker caseId=${byMarker[0].id} marker="${uniqueMarker}"`);
        return { found: true, case: byMarker[0], strength: "unique_marker" };
      }
      if (byMarker.length > 1) {
        console.warn(`[testrail-recovery] multiple candidates with same unique marker, selecting first caseId=${byMarker[0].id}`);
        return { found: true, case: byMarker[0], strength: "unique_marker_ambiguous" };
      }
      console.log(`[testrail-recovery] no candidate found with unique marker "${uniqueMarker}"`);
    }

    if (byCacheAndScenario.length > 1) {
      const ids = byCacheAndScenario.map((c) => c.id);
      const candidateScenarioIds = byCacheAndScenario.map((c) => String(c.custom_scenario_id ?? ""));

      // If requested ID is new format and all candidates are legacy PREVIEW, treat as not found
      if (shouldIgnoreLegacyAmbiguity(scenarioId, candidateScenarioIds)) {
        console.log(`[testrail-publish] ignoring legacy PREVIEW ambiguity requestedId=${scenarioId} legacyCount=${candidateScenarioIds.length}`);
        return { found: false, reason: "no_candidates" };
      }

      // If all candidates have the EXACT SAME ID as requested, select first (duplicate cleanup needed in TestRail)
      if (shouldSelectFirstExactMatch(scenarioId, candidateScenarioIds)) {
        console.log(`[testrail-publish] selecting first of ${byCacheAndScenario.length} exact duplicates requestedId=${scenarioId} selectedCaseId=${byCacheAndScenario[0].id}`);
        return { found: true, case: byCacheAndScenario[0], strength: "cache_key_and_scenario_id" };
      }

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
      const candidateScenarioIds = byScenarioId.map((c) => String(c.custom_scenario_id ?? ""));

      // If requested ID is new format and all candidates are legacy PREVIEW, treat as not found
      if (shouldIgnoreLegacyAmbiguity(scenarioId, candidateScenarioIds)) {
        console.log(`[testrail-publish] ignoring legacy PREVIEW ambiguity requestedId=${scenarioId} legacyCount=${candidateScenarioIds.length}`);
        return { found: false, reason: "no_candidates" };
      }

      // If all candidates have the EXACT SAME ID as requested, select first (duplicate cleanup needed in TestRail)
      if (shouldSelectFirstExactMatch(scenarioId, candidateScenarioIds)) {
        console.log(`[testrail-publish] selecting first of ${byScenarioId.length} exact duplicates requestedId=${scenarioId} selectedCaseId=${byScenarioId[0].id}`);
        return { found: true, case: byScenarioId[0], strength: "scenario_id_and_title" };
      }

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
    const candidateScenarioIds = candidates.map((c) => String(c.custom_scenario_id ?? ""));

    // If requested ID is new format and all candidates are legacy PREVIEW, treat as not found
    if (shouldIgnoreLegacyAmbiguity(scenarioId, candidateScenarioIds)) {
      console.log(`[testrail-publish] ignoring legacy PREVIEW ambiguity requestedId=${scenarioId} legacyCount=${candidateScenarioIds.length}`);
      return { found: false, reason: "no_candidates" };
    }

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
  const diagnostic: Record<string, unknown> = {
    sectionId: ctx.sectionId,
    scenarioId,
    title: scenarioTitle,
    cacheKey: ctx.cacheKey,
    candidateCount: result.found ? undefined : ("candidateCount" in result ? result.candidateCount : undefined),
    candidateIds: result.found ? undefined : ("candidateIds" in result ? result.candidateIds : undefined),
  };

  // Add suggestion if ambiguous and appears to be new format vs legacy duplicates
  if (!result.found && result.reason === "ambiguous" && result.candidateIds) {
    diagnostic.suggestion = "Multiple duplicate cases found in TestRail. This may be due to legacy PREVIEW runs. Consider cleaning up duplicate cases in TestRail section or using publishStrategy=always_create with unique scenario IDs.";
    diagnostic.reason = "ambiguous_legacy_preview_duplicates_likely";
  }

  return diagnostic;
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
  const steps = scenario.steps
    .map((step) => ({ content: step.replace(/^\d+[\.)]\s*/, "").trim() }))
    .filter((s) => s.content.length > 0);
  // TestRail requires custom_steps to be non-empty — never return an empty steps list.
  if (steps.length === 0) {
    return [{ content: sanitizeText(stripHtml(scenario.title)) || "Ejecutar el escenario de prueba automatizado." }];
  }
  return steps;
}

function buildCustomFields(): Record<string, unknown> {
    const requiredCaseFields = getConfiguredRequiredCaseFields();
  // Publication identity and Recording provenance live in the server-side mapping store.
  // Do not synthesize custom TestRail fields: the configured template may not expose them,
  // and TestRail can commit a case before returning a post-processing error for unknown
  // fields. Explicitly configured fields remain available to both Jira/HU and Recording.
  const customFields: Record<string, unknown> = {};

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

function buildAutomationScenarioMarkerId(scenarioId: string, launchId?: string): string | undefined {
  if (!launchId) return undefined;
  const launchShortId = launchId.slice(0, 8);
  const scenarioToken = scenarioId.replace(/^L-/, "");
  if (scenarioToken.startsWith(`${launchShortId}-`)) {
    return scenarioToken;
  }
  return `${launchShortId}-${scenarioToken}`;
}

function buildAutomationScenarioMarker(scenarioId: string, launchId?: string): string | undefined {
  const markerId = buildAutomationScenarioMarkerId(scenarioId, launchId);
  return markerId ? `[automationScenarioId: ${markerId}]` : undefined;
}

function isAddCaseHttp500Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("HTTP 500") && message.includes("add_case/");
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

  return "Resultado esperado por confirmar";
}

async function findExistingCaseByCacheKey(
  client: TestRailClient,
  ctx: ScenarioPreviewPublishContext,
  scenarioId: string,
  fallbackTitle?: string,
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
    if (match) return match;

    // Recording's configured TestRail template may discard provenance custom fields. On a
    // retry after an ambiguous 5xx, an exact unique title is the remaining safe identity.
    // Never apply this fallback to the normal Jira/HU publisher, where repeated launches may
    // intentionally reuse a human title for distinct cases.
    if (ctx.recordingBatch && fallbackTitle) {
      const normalizedTitle = normalizeTitle(fallbackTitle);
      const titleMatches = sectionCases.filter((c) =>
        c.section_id === ctx.sectionId && normalizeTitle(c.title) === normalizedTitle,
      );
      if (titleMatches.length === 1) return titleMatches[0];
    }
    return null;
  } catch {
    return null;
  }
}

type AmbiguousReconciliation =
  | { status: "RECONCILED_CREATED"; case: RawTestRailCase; attempts: number }
  | { status: "AMBIGUOUS_UNRESOLVED"; attempts: number }
  | { status: "AMBIGUOUS_DUPLICATE"; caseIds: number[]; attempts: number };

function isAmbiguousAfterAddCase(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") return status >= 500;
  // A transport exception after fetch() was initiated has no HTTP status. It is therefore
  // unsafe to assume that the server did not commit the case.
  return true;
}

async function reconcileAmbiguousRecordingCase(
  client: TestRailClient,
  ctx: ScenarioPreviewPublishContext,
  scenarioId: string,
  scenarioTitle: string,
  beforeIds: ReadonlySet<number>,
  refs?: string,
): Promise<AmbiguousReconciliation> {
  const startedAt = Date.now();
  let attempts = 0;
  let delayMs = AMBIGUOUS_RECONCILIATION_INITIAL_DELAY_MS;

  while (attempts < AMBIGUOUS_RECONCILIATION_ATTEMPTS && Date.now() - startedAt <= AMBIGUOUS_RECONCILIATION_DEADLINE_MS) {
    attempts += 1;
    try {
      const sectionCases = await sectionCaseSnapshot(client, ctx);
      const deltaMatches = newlyAppearedCases(beforeIds, sectionCases, ctx.sectionId, scenarioTitle, refs);
      // Internal metadata is preferred when a configured TestRail field preserves it.  The
      // delta remains mandatory: a historical case with the same metadata is not evidence that
      // this request created it.
      const identityMatches = deltaMatches.filter((candidate) =>
        String(candidate.custom_cache_key ?? "") === ctx.cacheKey
        && String(candidate.custom_scenario_id ?? "") === scenarioId,
      );
      const candidates = identityMatches.length > 0 ? identityMatches : deltaMatches;
      if (candidates.length === 1) {
        console.log(`[testrail-publish-reconciliation] scenario=${scenarioId} attempt=${attempts} state=RECONCILED_CREATED caseId=${candidates[0].id}`);
        return { status: "RECONCILED_CREATED", case: candidates[0], attempts };
      }
      if (candidates.length > 1) {
        const caseIds = candidates.map((candidate) => candidate.id);
        console.warn(`[testrail-publish-reconciliation] scenario=${scenarioId} attempt=${attempts} state=AMBIGUOUS_DUPLICATE caseIds=${caseIds.join(",")}`);
        return { status: "AMBIGUOUS_DUPLICATE", caseIds, attempts };
      }
      console.log(`[testrail-publish-reconciliation] scenario=${scenarioId} attempt=${attempts} state=not_visible candidates=0`);
    } catch (lookupError) {
      console.warn(`[testrail-publish-reconciliation] scenario=${scenarioId} attempt=${attempts} lookup=failed reason=${lookupError instanceof Error ? lookupError.message.slice(0, 160) : String(lookupError).slice(0, 160)}`);
    }
    const remainingMs = AMBIGUOUS_RECONCILIATION_DEADLINE_MS - (Date.now() - startedAt);
    if (attempts >= AMBIGUOUS_RECONCILIATION_ATTEMPTS || remainingMs <= 0) break;
    const waitMs = Math.min(delayMs, remainingMs);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    delayMs = Math.min(delayMs * 2, 2000);
  }
  console.warn(`[testrail-publish-reconciliation] scenario=${scenarioId} state=AMBIGUOUS_UNRESOLVED attempts=${attempts}`);
  return { status: "AMBIGUOUS_UNRESOLVED", attempts };
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
  reconciledCreated: Array<{ scenarioId: string; testRailCaseId: number }>;
  ambiguousDuplicates: Array<{ scenarioId: string; caseIds: number[] }>;
  ambiguousUnresolved: Array<{ scenarioId: string; status?: number; errorId?: string; reason: string; attempts: number }>;
  skipped: Array<{ scenarioId: string; testRailCaseId: number }>;
  failed: Array<{ scenarioId: string; status?: number; errorId?: string; reason: string }>;
  caseIds: number[];
}> {
  const store = readStore();
  const mappings: ScenarioPreviewCaseMapping[] = [];
  const caseIds: number[] = [];
  let created = 0;
  let updated = 0;
  let reused = 0;
  const reconciledCreated: Array<{ scenarioId: string; testRailCaseId: number }> = [];
  const ambiguousDuplicates: Array<{ scenarioId: string; caseIds: number[] }> = [];
  const ambiguousUnresolved: Array<{ scenarioId: string; status?: number; errorId?: string; reason: string; attempts: number }> = [];
  const skipped: Array<{ scenarioId: string; testRailCaseId: number }> = [];
  const failed: Array<{ scenarioId: string; status?: number; errorId?: string; reason: string }> = [];
  const requiredCaseFields = getConfiguredRequiredCaseFields();
  const idContext = {
    launchId: (ctx as any).launchId,
    cacheKey: ctx.cacheKey,
  };
  const scenarioIds = ctx.scenarios.map((s, i) => buildScenarioPreviewScenarioId(s, i, {
    ...idContext,
    sourceScenarioId: (s as any).launchScenarioId,
  }));
  console.log(`[testrail-publish] input scenarios count=${ctx.scenarios.length} ids=${scenarioIds.join(",")}`);

  for (const [index, scenario] of ctx.scenarios.entries()) {
    const scenarioId = buildScenarioPreviewScenarioId(scenario, index, {
      ...idContext,
      sourceScenarioId: (scenario as any).launchScenarioId,
    });
    const key = scenarioCacheKey(scenarioId, ctx.cacheKey, ctx.projectId, ctx.suiteId, ctx.sectionId);
    let existingMapping = store.mappings.find((m) => scenarioCacheKey(m.scenarioId, m.cacheKey, m.projectId, m.suiteId, m.sectionId) === key);

    // A Recording batch's own cached mapping is a hint, never proof — the case it points at may
    // since have been deleted directly in TestRail, or (for a mapping cached before
    // buildSafeTestRailRefs started combining sourceIssueKey with the scenario's own token) it
    // may carry only the parent Recording's bare grouping ref, which is never an exact scenario
    // match. Confirm remotely before ever reporting "skipped_already_published" for it; a stale
    // or unverifiable mapping is treated as not found so the normal create/reconciliation path
    // below runs and persists a fresh, exact mapping instead.
    if (existingMapping && ctx.recordingBatch) {
      const exactRefs = buildSafeTestRailRefs(scenario, scenarioId, ctx.storyKey);
      let remoteCase: RawTestRailCase | undefined;
      let lookupFailureReason = "lookup_unavailable";
      try {
        remoteCase = await client.getCase(existingMapping.testRailCaseId);
      } catch (lookupError) {
        lookupFailureReason = lookupError instanceof Error ? lookupError.message.slice(0, 160) : String(lookupError).slice(0, 160);
      }
      const verification = verifyExistingMappingIsExactMatch(remoteCase, ctx, [exactRefs]);
      if (!verification.valid) {
        const reason = !remoteCase ? lookupFailureReason : verification.reason;
        console.warn(
          `[testrail-publish] stale cached mapping scenario=${scenarioId} caseId=${existingMapping.testRailCaseId} ` +
          `reason=${reason} — treating as unmapped, proceeding through normal create/reconciliation path`
        );
        existingMapping = undefined;
      }
    }

    const stepsSeparated = toStepsSeparated(scenario);
    const customFields = buildCustomFields();
    const preconditionsBase = sanitizeText(scenario.preconditions.join(" | "));
    const launchId = (ctx as any).launchId as string | undefined;
    const uniqueMarker = buildAutomationScenarioMarker(scenarioId, launchId);
    const preconditionsBody =
      preconditionsBase ||
      "Precondiciones:\n- Aplicación disponible.\n- Usuario o datos de prueba configurados.";
    const preconditions = !ctx.suppressAutomationMarker && uniqueMarker
      ? `${preconditionsBody}\n${uniqueMarker}`
      : preconditionsBody;
    const customExpected = buildCustomExpected(scenario);
    const customCaseOracle = buildCustomCaseOracle(scenario, requiredCaseFields);
    const refs = existingMapping?.testRailRef ?? buildSafeTestRailRefs(scenario, scenarioId, ctx.storyKey);
    // Jira/HU and Recording deliberately share the client/template step policy. The source
    // model is adapted before this point; it must not select a second TestRail serialization.
    const sendsStructuredSteps = process.env.TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED?.toLowerCase() === "true";
    const sendsTextSteps = process.env.TESTRAIL_SEND_CUSTOM_STEPS_TEXT?.toLowerCase() !== "false";
    const diagnosticPayload = {
      title: scenario.title,
      refs,
      custom_preconds: preconditions,
      custom_expected: customExpected,
      custom_case_oracle: customCaseOracle,
      ...customFields,
      ...(sendsTextSteps ? { custom_steps: serializeTestRailSteps(stepsSeparated) } : {}),
      ...(sendsStructuredSteps ? { custom_steps_separated: stepsSeparated.map((step) => ({ content: step.content, expected: step.expected ?? "" })) } : {}),
    };
    const payloadDiagnostic = describeTestRailRecordingPayload(diagnosticPayload);
    const payloadValidation = validateTestRailRecordingPayload(diagnosticPayload);
    const diagnosticPath = path.join(ROOT, ".artifacts", "testrail", "recording-add-case-payload-diagnostic.json");
    ensureDir(diagnosticPath);
    fs.writeFileSync(diagnosticPath, JSON.stringify({
      sectionId: ctx.sectionId,
      templateId: process.env.TESTRAIL_TEMPLATE_ID ? Number(process.env.TESTRAIL_TEMPLATE_ID) : undefined,
      type_id: process.env.TESTRAIL_TYPE_ID ? Number(process.env.TESTRAIL_TYPE_ID) : undefined,
      priority_id: process.env.TESTRAIL_PRIORITY_ID ? Number(process.env.TESTRAIL_PRIORITY_ID) : undefined,
      ...payloadDiagnostic,
      validationErrors: payloadValidation,
    }, null, 2), "utf8");
    if (payloadValidation.length > 0) throw new Error(`testrail_recording_payload_invalid: ${payloadValidation.join("; ")}`);
    const hasRefs = Boolean(refs);
    const refsType = typeof refs;
    const refsLength = typeof refs === "string" ? refs.length : 0;
    const refsPreview = refs.replace(/[|,]/g, "");
    console.log(`[testrail-debug] endpoint=add_case method=POST payloadKeys=title,custom_preconds,custom_expected,custom_case_oracle,custom_fields,refs queryKeys=none hasRefs=${hasRefs} refsType=${refsType} refsLength=${refsLength} refsPreview="${refsPreview}"`);
    console.log(`[testrail-publish] case=${scenarioId} refs="${refsPreview}" hasRefs=${hasRefs}`);
    const normalizedScenarioTitle = normalizeTitle(scenario.title);
    const customFieldNames = collectCustomFieldNames(customFields, Boolean(customExpected), Boolean(customCaseOracle));
    console.log(`[testrail-publish] case=${scenarioId} hasExpected=${Boolean(customExpected)} hasCaseOracle=${Boolean(customCaseOracle)} customFields=${customFieldNames.join(",")}`);

    let testRailCase: RawTestRailCase | undefined;
    let mappingSource: ScenarioPreviewCaseMapping["source"] = "created";
    // Filled immediately before the actual create attempt.  A title match that predates this
    // request is historical evidence, not reconciliation evidence.
    let prePublishCaseIds: Set<number> = new Set();

    try {
      if (existingMapping) {
        if (ctx.recordingBatch) {
          testRailCase = {
            id: existingMapping.testRailCaseId,
            title: existingMapping.scenarioTitle,
            section_id: existingMapping.sectionId,
          } as RawTestRailCase;
          mappingSource = "skipped_already_published";
          skipped.push({ scenarioId, testRailCaseId: existingMapping.testRailCaseId });
        } else {
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
        }
      } else if (ctx.publishStrategy === "always_create") {
        // Dedup: before creating, check if a case with matching cache_key + scenario_id already exists from a previous 500
        const preExisting = await findExistingCaseByCacheKey(client, ctx, scenarioId, scenario.title);
        if (preExisting) {
          testRailCase = preExisting;
          mappingSource = "reused_from_same_launch_after_previous_500";
          reused += 1;
          console.log(`[testrail-publish] reused existing case after previous 500 scenario=${scenarioId} caseId=${testRailCase.id}`);
        } else {
          if (ctx.recordingBatch) {
            try {
              prePublishCaseIds = new Set((await sectionCaseSnapshot(client, ctx)).map((candidate) => candidate.id));
            } catch (snapshotError) {
              console.warn(`[testrail-publish-reconciliation] scenario=${scenarioId} before_snapshot=failed reason=${snapshotError instanceof Error ? snapshotError.message.slice(0, 160) : String(snapshotError).slice(0, 160)}`);
            }
          }
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
          if (isAddCaseHttp500Error(addErr)) {
            if (ctx.recordingBatch) {
              // Preserve the original TestRail status/error id.  The outer Recording batch
              // handler classifies this as post-send ambiguous and performs bounded polling.
              throw addErr;
            }
            console.warn(`[testrail-publish-recovery] status=started scenario=${scenarioId} sectionId=${ctx.sectionId}`);
            const recovered = await recoverCaseCreatedAfterHttp500({
              client,
              ctx,
              scenarioTitle: scenario.title,
              marker: uniqueMarker,
              scenarioId,
            });
            if (recovered.found) {
              testRailCase = recovered.case;
              mappingSource = "recovered_after_add_case_500";
              created += 1;
              console.log(`[testrail-publish-recovery] status=recovered caseId=${testRailCase.id}`);
            } else {
              console.warn(`[testrail-publish-recovery] status=failed matches=${recovered.matches}`);
              throw addErr;
            }
          } else if (addMsg.includes("Undefined array key") && addMsg.includes("refs")) {
            // RECOVERY #1: full addCase 500 — try to find the case that was created
            console.warn(`[testrail-publish] full addCase failed; attempting immediate recovery scenario=${scenarioId} reason=refs_error`);
            const recovery1 = await recoverCaseAfterRefs500(client, ctx, scenario.title, scenarioId);
            if (recovery1.found) {
              testRailCase = recovery1.case;
              mappingSource = "recovered_after_add_case_500";
              created += 1;
              console.log(`[testrail-publish] recovery after full addCase succeeded scenario=${scenarioId} caseId=${testRailCase.id} strength=${recovery1.strength}`);
            } else if (recovery1.reason === "ambiguous") {
              // Ambiguous recovery: retry with unique title containing the automationScenarioId
              const markerId = buildAutomationScenarioMarkerId(scenarioId, (ctx as any).launchId as string | undefined) ?? scenarioId;
              const uniqueTitle = `${scenario.title} [${markerId}]`;
              console.log(`[testrail-recovery] no marker match among legacy duplicates; retrying with unique title`);
              console.log(`[testrail-publish] retryWithUniqueTitle title="${uniqueTitle}" scenario=${scenarioId}`);
              try {
                testRailCase = await client.addCase(String(ctx.sectionId), {
                  title: uniqueTitle,
                  refs,
                  preconditions,
                  customExpected,
                  customCaseOracle,
                  stepsSeparated,
                  customFields,
                });
                mappingSource = "created_with_unique_title";
                created += 1;
                console.log(`[testrail-publish] createdWithUniqueTitle caseId=${testRailCase.id} scenario=${scenarioId}`);
              } catch (uniqueErr: any) {
                const uniqueMsg = uniqueErr.message ?? String(uniqueErr);
                // If even unique title fails with 500, try recovery with the new title
                if (uniqueMsg.includes("Undefined array key") && uniqueMsg.includes("refs")) {
                  const recoveryUnique = await recoverCaseAfterRefs500(client, ctx, uniqueTitle, scenarioId);
                  if (recoveryUnique.found) {
                    testRailCase = recoveryUnique.case;
                    mappingSource = "recovered_after_unique_title_500";
                    created += 1;
                    console.log(`[testrail-publish] recovery after unique title 500 succeeded caseId=${testRailCase.id}`);
                  } else {
                    const diag = recoveryDiagnosticInfo(ctx, scenario.title, scenarioId, recoveryUnique);
                    throw new Error(`testrail_add_case_500_recovery_ambiguous: unique title also ambiguous. sectionId=${ctx.sectionId} scenarioId=${scenarioId} diagnostic=${JSON.stringify(diag)}`);
                  }
                } else {
                  throw uniqueErr;
                }
              }
            } else {
              // No candidates found — try compatibility without refs but WITH custom fields for strong key matching
              console.warn(`[testrail-publish] recovery after full addCase found no candidates; trying compatibility payload scenario=${scenarioId}`);
              const stepsText = serializeTestRailSteps(stepsSeparated);
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
                    throw new Error(`testrail_refs_hook_failure: TestRail add_case failed even without refs in minimal required payload. This points to a TestRail/Jira coverage customization or plugin issue. sectionId=${ctx.sectionId} payloadKeys=${noRefsKeys} omittedKeys=refs,custom_refs,custom_steps_separated,unconfigured_custom_fields recoveryReason=${recovery2.reason} diagnostic=${JSON.stringify(diag)}`);
                  }
                }
                throw new Error(`testrail_add_case_minimal_failed: title+refs also failed: ${compatMsg}`);
              }
            }
          } else if (addMsg.includes("refs")) {
            // full addCase failed with generic refs error (not Undefined array key)
            console.warn(`[testrail-publish] addCase full payload failed; retrying with compatibility payload reason=refs_error case=${scenarioId}`);
            const refsField = process.env.TESTRAIL_REFS_FIELD || "both";
            const minimalPayload = refsField === "none"
              ? { title: scenario.title }
              : { title: scenario.title, refs: refs || "" };
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

      // Recording publication is a batch: one TestRail failure must be reported for this
      // scenario while the remaining selected scenarios continue. The legacy publisher keeps
      // its recovery behavior below for non-Recording callers.
      let handledRecordingBatchError = false;
      if (ctx.recordingBatch) {
        const errorRecord = error as { status?: unknown };
        const status = typeof errorRecord.status === "number" ? errorRecord.status : undefined;
        const errorText = error instanceof Error ? error.message : String(error);
        const idMatch = errorText.match(/(?:errorId|error id|id)=([A-Za-z0-9-]+)/i);
        if (isAmbiguousAfterAddCase(error)) {
          const reconciliation = await reconcileAmbiguousRecordingCase(client, ctx, scenarioId, scenario.title, prePublishCaseIds, refs);
          if (reconciliation.status === "RECONCILED_CREATED") {
            testRailCase = reconciliation.case;
            mappingSource = "recovered_after_add_case_500";
            reconciledCreated.push({ scenarioId, testRailCaseId: reconciliation.case.id });
            handledRecordingBatchError = true;
            console.warn(`[testrail-publish] ambiguous add_case reconciled scenario=${scenarioId} caseId=${reconciliation.case.id}`);
          } else {
            if (reconciliation.status === "AMBIGUOUS_DUPLICATE") {
              ambiguousDuplicates.push({ scenarioId, caseIds: reconciliation.caseIds });
              failed.push({ scenarioId, status, errorId: idMatch?.[1], reason: `AMBIGUOUS_DUPLICATE:${reconciliation.caseIds.join(",")}` });
            } else {
              ambiguousUnresolved.push({ scenarioId, status, errorId: idMatch?.[1], reason: errorText.slice(0, 500), attempts: reconciliation.attempts });
              failed.push({ scenarioId, status, errorId: idMatch?.[1], reason: `AMBIGUOUS_UNRESOLVED: ${errorText.slice(0, 500)}` });
            }
            console.error(`[testrail-publish] ambiguous add_case not retried scenario=${scenarioId} reconciliation=${reconciliation.status}`);
            continue;
          }
        } else {
          failed.push({ scenarioId, status, errorId: idMatch?.[1], reason: errorText.slice(0, 500) });
          console.error(`[testrail-publish] Recording scenario failed; continuing batch scenario=${scenarioId} status=${status ?? "unknown"}`);
          continue;
        }
      }

      // Refs 500 recovery: TestRail creates the case but crashes on refs plugin/hook
      if (handledRecordingBatchError) {
        // The ambiguous create was reconciled above; continue through the common mapping
        // persistence path so a later retry sees the recovered case.
      } else if (error && isRefs500Error(error) && mappingSource === "created") {
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

    // Every successful, recovered, reused, or skipped path must produce a case. Keep the
    // batch fail-soft if a future branch accidentally exits the catch without one.
    if (!testRailCase) {
      failed.push({ scenarioId, reason: "TESTRAIL_CASE_NOT_MATERIALIZED" });
      continue;
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
    // Make a successful case durable before the next add_case can fail.
    const currentStore = readStore();
    const durable = new Map<string, ScenarioPreviewCaseMapping>();
    for (const item of currentStore.mappings) durable.set(scenarioCacheKey(item.scenarioId, item.cacheKey, item.projectId, item.suiteId, item.sectionId), item);
    durable.set(scenarioCacheKey(mapping.scenarioId, mapping.cacheKey, mapping.projectId, mapping.suiteId, mapping.sectionId), mapping);
    writeStore({ version: 1, mappings: Array.from(durable.values()) });
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

  return { mappings, created, updated, reused, reconciledCreated, ambiguousDuplicates, ambiguousUnresolved, skipped, failed, caseIds: uniqueCaseIdsList };
}

export function readPersistedScenarioMappings(): ScenarioPreviewCaseMapping[] {
  return readStore().mappings;
}
