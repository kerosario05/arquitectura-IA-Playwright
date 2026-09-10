import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";

async function main(): Promise<void> {
  const client = new TestRailClient(requireTestRailConfig(config));
  const testRail = config.integrations.testRail;
  const cases = await client.getCases(String(testRail.projectId), String(testRail.suiteId), String(testRail.sectionId));
  for (const item of cases) {
    const text = [item.custom_preconds, item.custom_steps, item.custom_expected]
      .filter((value): value is string => typeof value === "string")
      .join("\n");
    console.log(JSON.stringify({ caseId: item.id, title: item.title, hasContractDeclaration: /^\s*(?:[-*]\s*)?.+\s*\([^(),]+,\s*[^()]+\)/m.test(text) }));
  }
}

void main();
