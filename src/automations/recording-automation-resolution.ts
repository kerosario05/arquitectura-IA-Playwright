import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { RecordedScenario } from "../recording/trace-to-scenario";

/**
 * Reuse-before-regenerate resolution for a Recording scenario about to be executed.
 *
 * "Ejecutar Automatización" must not treat every click as a first run: a scenario that
 * already has a TestRail case and a still-fresh promoted spec has nothing left to decide —
 * it should just run. This module is the one place that decision gets made, from the two
 * durable mappings the Recording domain already persists on the scenario itself
 * (`testRailCaseId`, `promotedSpec`), never from a title or a button's label.
 */

export type TestRailDestination = { projectId: string; suiteId?: string; sectionId: string };

export type TestRailResolution =
  | { status: "existing"; caseId: number; destinationMatched: true; source: "persisted_mapping" | "testrail_structured_lookup" }
  | { status: "missing"; destinationMatched: false; source: "none" };

/**
 * Two destinations are the same case-filing target when project and section agree. Suite is
 * compared only when both sides actually carry one: a section belongs to exactly one suite in
 * TestRail, so a caller that only ever supplied a section (the common case — the picker
 * resolves suite from section) must not be treated as a mismatch against a persisted mapping
 * that also lacks one.
 */
export function destinationsMatch(a: TestRailDestination, b: TestRailDestination): boolean {
  if (a.projectId !== b.projectId) return false;
  if (a.sectionId !== b.sectionId) return false;
  if (a.suiteId && b.suiteId && a.suiteId !== b.suiteId) return false;
  return true;
}

/**
 * Legacy fallback for a scenario whose `testRailCaseId` was persisted before destinations were
 * tracked (no `testRailDestination` on record). Optional and injected — tests never need a real
 * TestRail client, and callers with no way to look a case up simply get "missing" instead of a
 * false "existing".
 */
export type TestRailCaseLookup = (caseId: number) => Promise<{ projectId?: string; sectionId?: string } | null>;

export type SpecResolutionStatus = "fresh" | "missing" | "stale";

export type SpecResolution = {
  status: SpecResolutionStatus;
  path?: string;
  hash?: string;
  reason?: string;
};

export type RecordingAutomationDecision =
  | "reuse_existing"
  | "generate_spec"
  | "create_testrail_case"
  | "create_case_and_generate_spec";

export type ScenarioAutomationPlan = {
  scenarioId: string;
  testRail: TestRailResolution;
  spec: SpecResolution;
  decision: RecordingAutomationDecision;
};

/**
 * Structured identity only, and scoped to the destination the user actually picked.
 * `RecordedScenario.testRailCaseId`/`testRailDestination` are the same fields the existing
 * publish flow (`recordings.ts` `/:recordingId/testrail`) already writes after a successful
 * publish — this reads them, it never re-derives existence from a title or a TestRail search.
 *
 * A caseId alone is never enough: the same recording can be re-run against a different
 * project/suite/section, so a persisted caseId is only "existing" when its recorded
 * destination matches the one just selected. And a destination match alone is still not
 * proof: the persisted mapping only records what was true at publish time, and the case can
 * since have been deleted or moved directly in TestRail (a STALE_MAPPING). Whenever a live
 * lookup is available, "existing" is only ever returned once TestRail itself confirms the
 * case still exists in this exact project/section — local metadata alone never proves
 * existence, it only narrows which case to verify. When no lookup is available at all (no
 * TestRail client configured), the persisted mapping is the only signal there is and is
 * trusted as before. Either way, the lookup is always structured (TestRail's own
 * section/project on the case), never fuzzy-title matching.
 */
export async function resolveTestRailForScenario(
  scenario: Pick<RecordedScenario, "testRailCaseId" | "testRailDestination">,
  destination: TestRailDestination,
  lookupCase?: TestRailCaseLookup,
): Promise<TestRailResolution> {
  const caseId = scenario.testRailCaseId;
  const hasCaseId = typeof caseId === "number" && Number.isInteger(caseId) && caseId > 0;
  if (!hasCaseId) {
    return { status: "missing", destinationMatched: false, source: "none" };
  }

  const persistedDestination = scenario.testRailDestination;
  if (persistedDestination && !destinationsMatch(persistedDestination, destination)) {
    // The case exists, but not in the destination that was just selected — it must be
    // resolved (created, if needed) within that destination instead of being reused blind.
    return { status: "missing", destinationMatched: false, source: "none" };
  }

  if (lookupCase) {
    const remote = await lookupCase(caseId);
    const remoteConfirms = Boolean(
      remote
      && String(remote.projectId ?? "") === destination.projectId
      && String(remote.sectionId ?? "") === destination.sectionId,
    );
    if (remoteConfirms) {
      return {
        status: "existing",
        caseId,
        destinationMatched: true,
        source: persistedDestination ? "persisted_mapping" : "testrail_structured_lookup",
      };
    }
    // Either the case no longer exists in TestRail, or it no longer belongs to this
    // project/section: a persisted mapping that TestRail itself won't confirm is stale, not
    // existing.
    return { status: "missing", destinationMatched: false, source: "none" };
  }

  // No TestRail access at all — there is no way to verify one way or the other, so the
  // persisted mapping (if any) remains the only available signal.
  if (persistedDestination) {
    return { status: "existing", caseId, destinationMatched: true, source: "persisted_mapping" };
  }

  return { status: "missing", destinationMatched: false, source: "none" };
}

export type SpecFilesystemAdapter = {
  readFile: (filePath: string) => Promise<string>;
  readAutomationEntry: (automationPath: string) => Promise<{ status?: string; specVerificationStatus?: string } | undefined>;
};

const defaultAdapter: SpecFilesystemAdapter = {
  readFile: (filePath) => fs.readFile(filePath, "utf-8"),
  readAutomationEntry: async (automationPath) => {
    try {
      return JSON.parse(await fs.readFile(automationPath, "utf-8"));
    } catch {
      return undefined;
    }
  },
};

function hashSpecText(specText: string): string {
  return createHash("sha256").update(specText, "utf8").digest("hex");
}

/**
 * Freshness is never "the file exists" or "it's recent" — it is the same physical-hash
 * identity `persisted-spec-revalidation.ts` already uses to decide whether a verified spec
 * is still the one that was validated (`buildPromotedArtifactIdentity`'s sha256, compared
 * against the hash recorded at promotion time), plus the promotion authority
 * (`automation.json`'s own `status`/`specVerificationStatus`) that governs whether that spec
 * is allowed to run at all. A hash match with a demoted/failed automation entry is stale,
 * not fresh — the spec text alone is not the authority.
 */
export async function resolveSpecForScenario(
  scenario: Pick<RecordedScenario, "promotedSpec">,
  adapter: SpecFilesystemAdapter = defaultAdapter,
): Promise<SpecResolution> {
  const promoted = scenario.promotedSpec;
  if (!promoted) {
    return { status: "missing", reason: "no_promoted_spec_recorded" };
  }

  let specText: string;
  try {
    specText = await adapter.readFile(promoted.specPath);
  } catch {
    return { status: "missing", path: promoted.specPath, reason: "spec_file_not_found" };
  }

  const currentHash = hashSpecText(specText);
  if (currentHash !== promoted.specHash) {
    return { status: "stale", path: promoted.specPath, hash: currentHash, reason: "spec_hash_changed" };
  }

  const automationPath = path.join(path.dirname(promoted.specPath), "automation.json");
  const automation = await adapter.readAutomationEntry(automationPath);
  if (!automation) {
    return { status: "stale", path: promoted.specPath, hash: currentHash, reason: "automation_entry_missing" };
  }
  if (automation.status !== "active") {
    return { status: "stale", path: promoted.specPath, hash: currentHash, reason: `automation_status:${automation.status ?? "unknown"}` };
  }
  if (automation.specVerificationStatus !== "passed") {
    return { status: "stale", path: promoted.specPath, hash: currentHash, reason: `spec_verification_status:${automation.specVerificationStatus ?? "unknown"}` };
  }

  return { status: "fresh", path: promoted.specPath, hash: currentHash };
}

/** The matrix itself — every branch is reachable independently, per scenario. */
export function decideAutomationRoute(testRail: TestRailResolution, spec: SpecResolution): RecordingAutomationDecision {
  const caseExists = testRail.status === "existing";
  const specFresh = spec.status === "fresh";

  if (caseExists && specFresh) return "reuse_existing"; // A
  if (caseExists && !specFresh) return "generate_spec"; // B
  if (!caseExists && specFresh) return "create_testrail_case"; // C
  return "create_case_and_generate_spec"; // D
}

export async function resolveScenarioAutomationPlan(
  scenario: Pick<RecordedScenario, "scenarioId" | "testRailCaseId" | "testRailDestination" | "promotedSpec">,
  destination: TestRailDestination,
  adapter: SpecFilesystemAdapter = defaultAdapter,
  lookupCase?: TestRailCaseLookup,
): Promise<ScenarioAutomationPlan> {
  const testRail = await resolveTestRailForScenario(scenario, destination, lookupCase);
  const spec = await resolveSpecForScenario(scenario, adapter);
  const decision = decideAutomationRoute(testRail, spec);
  return { scenarioId: scenario.scenarioId, testRail, spec, decision };
}

/** CASE F: each scenario's plan is computed independently — no cross-scenario influence. */
export async function resolveScenarioAutomationPlans(
  scenarios: Array<Pick<RecordedScenario, "scenarioId" | "testRailCaseId" | "testRailDestination" | "promotedSpec">>,
  destination: TestRailDestination,
  adapter: SpecFilesystemAdapter = defaultAdapter,
  lookupCase?: TestRailCaseLookup,
): Promise<ScenarioAutomationPlan[]> {
  return Promise.all(scenarios.map((scenario) => resolveScenarioAutomationPlan(scenario, destination, adapter, lookupCase)));
}

export type ExecutionDispatchPartition = {
  /** Runs the promoted spec directly: no publish, no generation, no discovery, no AI. */
  reuseScenarioIds: string[];
  /** Everything else — still needs a case created and/or a spec generated via the existing pipeline. */
  remainingScenarioIds: string[];
};

/**
 * Splits a resolved batch into the fast path vs. the existing publish/generate pipeline.
 * Pulled out of the route handler so the dispatch rule itself — which scenarios skip
 * generation entirely — is unit-testable without mounting the route or touching the
 * filesystem/child_process.
 *
 * A fresh promoted spec (`spec.status === "fresh"`) is fully validated and ready to execute
 * directly, regardless of what `testRail` currently resolves to. Gating this on
 * `decision === "reuse_existing"` (which additionally requires `testRail.status === "existing"`)
 * meant a scenario whose TestRail case couldn't be verified this run — whether genuinely absent
 * or merely unresolved (see resolveTestRailForScenario's own fail-closed "missing" on any
 * unverifiable mapping) — fell all the way through to the full publish+discovery+AI pipeline
 * even though nothing about the promoted spec itself needed regenerating. TestRail case
 * existence still separately governs whether a NEW case needs to be filed (see
 * decideAutomationRoute and recordings.ts's own needsCaseIds computation) — that remains a
 * decoupled, non-blocking concern, never a prerequisite for running an already-promoted spec.
 */
export function partitionScenariosForExecution(plans: ScenarioAutomationPlan[]): ExecutionDispatchPartition {
  const reuseScenarioIds: string[] = [];
  const remainingScenarioIds: string[] = [];
  for (const plan of plans) {
    (plan.spec.status === "fresh" ? reuseScenarioIds : remainingScenarioIds).push(plan.scenarioId);
  }
  return { reuseScenarioIds, remainingScenarioIds };
}

/**
 * Which scenarios actually need a NEW TestRail case filed this run — i.e. worth calling
 * `publishRecordingScenariosToTestRail` for at all. This is the TESTRAIL decision, and it is
 * deliberately independent of the SPEC decision (`partitionScenariosForExecution`): a scenario
 * whose `testRail.status` is `"missing"` still needs a case filed regardless of whether its spec
 * is already fresh — a fresh spec is a prerequisite for skipping regeneration, never for skipping
 * TestRail reconciliation. (A true rerun of `/api/runs/:jobId/rerun` never calls this function at
 * all — see rerun-runner.ts's own `resolvePromotedSpecReuse` — so rerun's "no publish" guarantee
 * is untouched by this.) Only a scenario whose case already exists in this exact destination is
 * excluded here, since nothing needs filing for it.
 */
export function computeTestRailPublishCandidates(plans: ScenarioAutomationPlan[]): Set<string> {
  return new Set(
    plans.filter((plan) => plan.testRail.status === "missing").map((plan) => plan.scenarioId),
  );
}
