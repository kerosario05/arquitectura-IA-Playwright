import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("SQL Server migration stores exact TestRail-to-Design lineage by case id", () => {
  const sql = fs.readFileSync("sql/schema/007-test-design-published-case-link.sql", "utf8");
  assert.match(sql, /CREATE TABLE dbo\.TestDesignPublishedCaseLink/);
  assert.match(sql, /testRailCaseId int NOT NULL/);
  assert.match(sql, /jiraScenarioId nvarchar\(128\) NULL/);
  assert.match(sql, /contentVersion char\(64\) NOT NULL/);
  assert.match(sql, /scenarioJson nvarchar\(max\) NOT NULL/);
  assert.match(sql, /PRIMARY KEY \(testRailCaseId\)/);
  assert.match(sql, /projectSlug, testRailProjectId, issueKey/);
});
