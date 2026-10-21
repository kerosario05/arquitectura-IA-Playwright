import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildExistingJiraCaseScenarios, resolveExistingJiraCaseValues } from "./jira-existing-case-requirements";
import { collectMissingJiraRequiredInputs } from "./jira-required-input-validation";

function fixture(entries: Array<{ caseId: number; id: string; tags?: string[]; manifest: unknown[] }>) {
  const cwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jira-existing-"));
  const automations = entries.map((e) => {
    const dir = path.join(root, "cases", e.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "promoted-data.json"), JSON.stringify({ version: "1.0", generatedAt: "", entries: e.manifest }));
    return { id: e.id, caseId: e.caseId, title: `t${e.id}`, externalId: "X-1", tags: e.tags, specPath: path.join(dir, "case.spec.ts") };
  });
  fs.mkdirSync(path.join(root, "automations", "apps", "app"), { recursive: true });
  fs.writeFileSync(path.join(root, "automations", "apps", "app", "index.json"), JSON.stringify({ version: "1.0", updatedAt: "", automations }));
  process.chdir(root);
  return () => process.chdir(cwd);
}

const field = { key: "field_a", fieldName: "Field A", stepIndex: 5, required: true, maskedValue: "***12" };

test("Jira-linked existing case with maskedValue-only manifest requires an input; explicit value satisfies it", async () => {
  const restore = fixture([{ caseId: 1, id: "a", tags: ["jira_generated"], manifest: [field] }]);
  try {
    const scenarios = await buildExistingJiraCaseScenarios("app", [1]);
    assert.equal(scenarios.length, 1);
    assert.deepEqual(scenarios[0].inputRequirements?.map((r) => r.key), ["field_a"]);
    assert.equal(collectMissingJiraRequiredInputs(scenarios, { "1": {} }).length, 1);
    assert.equal(collectMissingJiraRequiredInputs(scenarios, { "1": { field_a: "v" } }).length, 0);
  } finally { restore(); }
});

test("persisted real manifest value, non-required entries and non-Jira cases add no requirement", async () => {
  const restore = fixture([
    { caseId: 1, id: "a", tags: ["jira_generated"], manifest: [{ ...field, value: "real" }, { ...field, key: "opt", required: false }] },
    { caseId: 2, id: "b", manifest: [field] },
  ]);
  try {
    const scenarios = await buildExistingJiraCaseScenarios("app", [1, 2, 3]);
    assert.deepEqual(scenarios.map((s) => [s.scenarioId, s.inputRequirements?.length]), [["1", 0]]);
  } finally { restore(); }
});

const deps = (rows: Record<string, Array<{ key: string; value: unknown }>>) => ({
  resolveProject: async (slug: string) => (slug === "app" ? { id: "P1" } : null),
  loadValues: async (pid: string, cid: number) => rows[`${pid}:${cid}`] ?? [],
});

test("confirmed DB runtime value satisfies requirement (key normalized); explicit value wins", async () => {
  const restore = fixture([{ caseId: 1, id: "a", tags: ["jira_generated"], manifest: [field] }]);
  try {
    const scenarios = await buildExistingJiraCaseScenarios("app", [1]);
    const d = deps({ "P1:1": [{ key: " FIELD_A ", value: "db" }] });
    const resolved = await resolveExistingJiraCaseValues("app", scenarios, { "1": {} }, d);
    assert.equal(collectMissingJiraRequiredInputs(scenarios, resolved).length, 0);
    assert.equal(resolved["1"].field_a, "db");
    const explicit = await resolveExistingJiraCaseValues("app", scenarios, { "1": { field_a: "req" } }, d);
    assert.equal(explicit["1"].field_a, "req");
  } finally { restore(); }
});

test("confirmed values do not cross case ids or projects", async () => {
  const restore = fixture([{ caseId: 1, id: "a", tags: ["jira_generated"], manifest: [field] }]);
  try {
    const scenarios = await buildExistingJiraCaseScenarios("app", [1]);
    const other = deps({ "P1:2": [{ key: "field_a", value: "x" }], "P2:1": [{ key: "field_a", value: "y" }] });
    assert.equal(collectMissingJiraRequiredInputs(scenarios, await resolveExistingJiraCaseValues("app", scenarios, { "1": {} }, other)).length, 1);
    const noProject = await resolveExistingJiraCaseValues("unknown", scenarios, { "1": {} }, deps({ "P1:1": [{ key: "field_a", value: "z" }] }));
    assert.equal(collectMissingJiraRequiredInputs(scenarios, noProject).length, 1);
  } finally { restore(); }
});
