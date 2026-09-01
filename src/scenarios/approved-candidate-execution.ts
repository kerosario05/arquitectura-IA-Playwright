import crypto from "node:crypto";
import type { ApprovedDiscoveryCandidateExecutionRequest } from "./scenario-types";
import * as fs from "node:fs";
import * as path from "node:path";
import { evaluateDestinationEvidence } from "./destination-evidence";
import { persistRuntimeTransition } from "../knowledge/runtime-knowledge-persister";

const seenExecutions = new Set<string>();

function baseUrl(appSlug: string): string | null {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "automations", "apps", appSlug, "app.config.json"), "utf8"));
    return config.baseUrl ?? config.appProfile?.baseUrl ?? null;
  } catch { return null; }
}

export async function executeApprovedDiscoveryCandidate(request: ApprovedDiscoveryCandidateExecutionRequest): Promise<Record<string, unknown>> {
  const target = request.discoveryTarget;
  const candidate = request.candidate;
  const base = baseUrl(request.appSlug);
  const reject = (reason: string) => ({ ok: false, status: "rejected", reason, executionId: request.executionId, discoveryTarget: target, candidate });
  if (!request.approved) return reject("explicit_approval_required");
  if (target.scope !== "branch" || !target.branchId || !target.sourceRequirementId) return reject("invalid_branch_target");
  if (candidate.source !== "runtime_observation" || !candidate.candidateId || !candidate.target) return reject("invalid_candidate_provenance");
  if (seenExecutions.has(request.executionId)) return reject("duplicate_execution");
  if (!base) return reject("base_url_unavailable");
  if (/confirm|submit|send|pay|transfer|generate|delete|remove|cancel/i.test(candidate.target)) return reject("unsafe_candidate");
  seenExecutions.add(request.executionId);
  const fingerprint = crypto.createHash("sha256").update(`${candidate.candidateId}:${candidate.target}:${target.branchId}`).digest("hex").slice(0, 16);
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
    const before = { url: page.url(), title: await page.title(), body: await page.locator("body").innerText().catch(() => "") };
    const locators = candidate.role === "link"
      ? [page.getByRole("link", { name: candidate.target, exact: true })]
      : [page.getByRole("button", { name: candidate.target, exact: true }), page.getByText(candidate.target, { exact: true })];
    let locator = locators[0];
    for (const option of locators) { if (await option.count() === 1) { locator = option; break; } }
    if (await locator.count() !== 1) { await browser.close(); return reject("candidate_not uniquely_revalidated"); }
    await locator.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const after = { url: page.url(), title: await page.title(), body: await page.locator("body").innerText().catch(() => "") };
    const transitionDetected = before.url !== after.url || before.title !== after.title || before.body !== after.body;
    const destinationEvidence = evaluateDestinationEvidence({
      beforeRouteIdentity: before.url,
      afterRouteIdentity: after.url,
      expectedRouteIdentity: undefined,
      transitionDetected,
      transitionValidated: transitionDetected,
      branchId: target.branchId,
      sourceRequirementId: target.sourceRequirementId,
    });
    const knowledgePersisted = transitionDetected && await persistRuntimeTransition(request.appSlug, {
      sourceTechnicalScreenKey: before.url,
      destinationTechnicalScreenKey: after.url,
      actionLocatorIdentity: candidate.target,
      actionBusinessLabel: candidate.target,
      actionDescription: "approved discovery candidate action",
      transitionValidated: true,
      semanticDestinationValidated: destinationEvidence.destinationValidation === "validated",
      destinationSemanticAuthority: destinationEvidence.destinationValidation === "validated" ? "validated" : "pending",
      observedRouteIdentity: after.url,
      requirementIds: [target.sourceRequirementId],
      branchId: target.branchId,
      sourceIssueKey: request.issueKey,
      scenarioId: target.scenarioId,
    });
    await browser.close();
    return {
      ok: true, status: "executed", executionId: request.executionId, candidateId: candidate.candidateId, candidateFingerprint: fingerprint,
      discoveryTarget: target, candidate, candidateRevalidated: true, safetyRevalidated: true, realBrowserExecuted: true,
      actionActuallyExecuted: true, actionExecutionBacked: true, beforeRouteIdentity: before.url, afterRouteIdentity: after.url,
      transitionDetected, transitionValidated: transitionDetected, ...destinationEvidence,
      knowledgePersisted, persisted: knowledgePersisted, trustedForReuse: false,
    };
  } catch (error) {
    return { ...reject("execution_failed"), error: error instanceof Error ? error.message : String(error) };
  }
}
