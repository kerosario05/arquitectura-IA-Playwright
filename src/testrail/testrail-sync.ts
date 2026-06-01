import type { TestRailClient } from "../clients/testrail.client";
import type { TestScenario } from "../types/testrail.types";

export type CaseSyncResult = {
  jiraKey: string;
  caseId: number;
  action: "created" | "updated";
};

export async function syncScenarioToTestRail(
  client: TestRailClient,
  scenario: TestScenario,
  projectId: string,
  suiteId: string | undefined,
  sectionId: string
): Promise<CaseSyncResult> {
  const stepsSeparated = scenario.steps.map((s) => ({
    content: s.action,
    expected: s.expected ?? ""
  }));

  const existing = await client.getCasesByRefs(projectId, scenario.externalId, suiteId, sectionId);

  if (existing.length > 0) {
    const updated = await client.updateCase(existing[0].id, {
      title: scenario.title,
      refs: scenario.externalId,
      preconditions: scenario.preconditions,
      stepsSeparated
    });
    return { jiraKey: scenario.externalId, caseId: updated.id, action: "updated" };
  }

  const created = await client.addCase(sectionId, {
    title: scenario.title,
    refs: scenario.externalId,
    preconditions: scenario.preconditions,
    stepsSeparated
  });
  return { jiraKey: scenario.externalId, caseId: created.id, action: "created" };
}
