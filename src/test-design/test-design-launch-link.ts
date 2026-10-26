import type { RawTestRailCase, UpdateCaseInput } from "../types/testrail.types";
import type { TestDesignPublishedCaseLink } from "./test-design.types";
import { toCaseInput } from "./test-design-publisher";
import { testRailPayloadContentVersion, testRailRemoteContentVersion, toJiraSemanticDesignScenario } from "./test-design-lineage";

export type TestDesignCaseResolution = "sync_and_run" | "run_as_testrail";

export type TestDesignLinkClient = {
  getCase(caseId: number): Promise<RawTestRailCase>;
  updateCase(caseId: number, input: UpdateCaseInput): Promise<RawTestRailCase>;
};

export type TestDesignLinkConflict = {
  caseId: number;
  issueKey: string;
  designScenarioId: string;
  reason: "content_changed" | "project_changed";
  options: TestDesignCaseResolution[];
};

export async function resolveTestDesignLaunchLinks(input: {
  caseIds: number[];
  projectId: number;
  appSlug: string;
  links: TestDesignPublishedCaseLink[];
  resolutions?: Record<string, TestDesignCaseResolution>;
  client: TestDesignLinkClient;
}): Promise<{ linked: TestDesignPublishedCaseLink[]; conflicts: TestDesignLinkConflict[] }> {
  const byCase = new Map(input.links.map(link => [link.testRailCaseId, link]));
  const linked: TestDesignPublishedCaseLink[] = [];
  const conflicts: TestDesignLinkConflict[] = [];
  for (const caseId of [...new Set(input.caseIds)]) {
    const link = byCase.get(caseId);
    if (!link) continue;
    const projectChanged = link.projectSlug.toLocaleLowerCase() !== input.appSlug.toLocaleLowerCase()
      || link.testRailProjectId !== input.projectId;
    const remote = await input.client.getCase(caseId);
    const contentChanged = testRailRemoteContentVersion(remote) !== link.contentVersion;
    const reason = projectChanged ? "project_changed" : contentChanged ? "content_changed" : null;
    const resolution = input.resolutions?.[String(caseId)];
    if (reason && !resolution) {
      conflicts.push({
        caseId,
        issueKey: link.issueKey,
        designScenarioId: link.designScenarioId,
        reason,
        options: projectChanged ? ["run_as_testrail"] : ["sync_and_run", "run_as_testrail"],
      });
      continue;
    }
    if (reason && resolution === "run_as_testrail") continue;
    if (reason && (projectChanged || resolution !== "sync_and_run")) continue;

    if (reason === "content_changed" && resolution === "sync_and_run") {
      const payload = toCaseInput(link.scenario, link.issueKey, { requiredCustomFields: {}, caseOracle: "" });
      const update: UpdateCaseInput = {
        title: payload.title,
        refs: payload.refs,
        preconditions: payload.preconditions,
        stepsSeparated: payload.stepsSeparated,
        customExpected: payload.customExpected,
      };
      await input.client.updateCase(caseId, update);
      const synced = await input.client.getCase(caseId);
      const syncedVersion = testRailRemoteContentVersion(synced);
      const intendedVersion = testRailPayloadContentVersion(payload);
      if (syncedVersion !== intendedVersion) {
        throw new Error(`TestRail case ${caseId} did not match the published Design content after synchronization`);
      }
    }

    if (toJiraSemanticDesignScenario(link.scenario, link.issueKey)) linked.push(link);
  }
  return { linked, conflicts };
}
