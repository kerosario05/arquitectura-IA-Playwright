import assert from "node:assert";
import { buildProjectDeleteStatements } from "./project-service";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(_name: string, fn: () => void): void {
  console.log(`\n${_name}`);
  fn();
}

describe("deleteProject cleanup order", () => {
  test("ProjectCaseInputRequirement is deleted before dbo.Projects in the same statement batch", () => {
    const statements = buildProjectDeleteStatements("project-1");
    const caseIdx = statements.findIndex((s) => s.includes("ProjectCaseInputRequirement"));
    const projectsIdx = statements.findIndex((s) => s.trim().startsWith("DELETE FROM dbo.Projects"));

    assert.ok(caseIdx >= 0, "missing DELETE for dbo.ProjectCaseInputRequirement");
    assert.ok(projectsIdx >= 0, "missing DELETE for dbo.Projects");
    assert.ok(caseIdx < projectsIdx, "ProjectCaseInputRequirement must be cleaned before deleting dbo.Projects");
  });

  test("existing child-table deletes are preserved unchanged", () => {
    const statements = buildProjectDeleteStatements("project-1");
    assert.ok(statements.some((s) => s.includes("ProjectKnowledge")));
    assert.ok(statements.some((s) => s.includes("WebProjectConfiguration")));
    assert.ok(statements.some((s) => s.includes("MobileProjectConfiguration")));
    assert.ok(statements.some((s) => s.includes("ProjectConfigurationHistory")));
  });
});