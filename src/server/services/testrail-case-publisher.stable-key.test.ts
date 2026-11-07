import assert from "node:assert/strict";
import test from "node:test";
import { stableScenarioKey } from "./testrail-case-publisher";

const ctx = { projectId: 10, suiteId: 17, sectionId: 7605 };

test("the same story and title give the same key whatever the launch, steps or spacing", () => {
  const a = stableScenarioKey({ sourceIssueKey: "AA-97", title: "Login  Satisfactorio" }, ctx);
  const b = stableScenarioKey({ sourceIssueKey: "aa-97", title: " login satisfactorio " }, ctx);
  assert.ok(a);
  assert.equal(a, b);
});

test("another title, story, or section is another scenario", () => {
  const base = stableScenarioKey({ sourceIssueKey: "AA-97", title: "Login" }, ctx);
  assert.notEqual(base, stableScenarioKey({ sourceIssueKey: "AA-97", title: "Logout" }, ctx));
  assert.notEqual(base, stableScenarioKey({ sourceIssueKey: "AA-98", title: "Login" }, ctx));
  assert.notEqual(base, stableScenarioKey({ sourceIssueKey: "AA-97", title: "Login" }, { ...ctx, sectionId: 1 }));
});

test("a story key the launch made up, or no story, has no identity", () => {
  assert.equal(stableScenarioKey({ sourceIssueKey: "launch-3", title: "Login" }, ctx), undefined);
  assert.equal(stableScenarioKey({ title: "Login" }, ctx), undefined);
  assert.equal(stableScenarioKey({ sourceIssueKey: "AA-97", title: "  " }, ctx), undefined);
});
