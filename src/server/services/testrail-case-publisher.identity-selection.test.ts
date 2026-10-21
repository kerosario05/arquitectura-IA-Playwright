import assert from "node:assert/strict";
import test from "node:test";
import { selectExactScenarioCase } from "./testrail-case-publisher";
import type { RawTestRailCase } from "../../types/testrail.types";

const caseRecord = (id: number, refs: string, title = "Same title"): RawTestRailCase => ({
  id, title, section_id: 7158, refs,
} as RawTestRailCase);

test("publisher does not reuse the sole TestRail search result when its scenario ref differs", () => {
  const candidate = caseRecord(54488, "AA-110-AA-110JIRA3");
  assert.equal(selectExactScenarioCase([candidate], { sectionId: 7158 }, ["AA-110-AA-110JIRA1"]), undefined);
});

test("publisher selects a case only by exact scenario ref, regardless of title similarity", () => {
  const candidate = caseRecord(54488, "AA-110-AA-110JIRA3", "Old title");
  assert.equal(selectExactScenarioCase([candidate], { sectionId: 7158 }, ["AA-110-AA-110JIRA3"]), candidate);
});

test("publisher rejects ambiguous exact TestRail refs rather than collapsing scenario mappings", () => {
  assert.throws(() => selectExactScenarioCase([
    caseRecord(54488, "AA-110-AA-110JIRA3"),
    caseRecord(54489, "AA-110-AA-110JIRA3"),
  ], { sectionId: 7158 }, ["AA-110-AA-110JIRA3"]), /testrail_scenario_mapping_ambiguous/);
});

test("publisher never reuses a matching-ref case from another TestRail section", () => {
  const candidate = caseRecord(54488, "AA-110-AA-110JIRA3");
  assert.equal(selectExactScenarioCase([{ ...candidate, section_id: 4761 }], { sectionId: 7158 }, ["AA-110-AA-110JIRA3"]), undefined);
});
