import assert from "node:assert/strict";
import { test } from "node:test";
import { syncTestRailInputRequirements } from "./testrail-input-requirements-sync";

function dependencies(parsed: any) {
  const calls: any = { adapted: [], resolved: [], persisted: [] };
  return {
    calls,
    adapter: (rawCase: unknown) => {
      calls.adapted.push(rawCase);
      return parsed;
    },
    resolveProjectId: async (projectSlug: string) => {
      calls.resolved.push(projectSlug);
      return "project-id-from-resolver";
    },
    replaceForProjectAndCase: async (projectId: string, caseId: number, requirements: unknown[]) => {
      calls.persisted.push({ projectId, caseId, requirements });
    },
  };
}

test("syncs parsed requirements from contractual TestRail fields", async () => {
  const requirements = [{ key: "account.id", label: "Account id", controlType: "text", required: true, sensitive: false, allowedValues: [] }];
  const deps = dependencies({ requirements, unresolvedPlaceholders: [], conflicts: [] });
  const result = await syncTestRailInputRequirements({
    projectSlug: "project-a",
    caseId: 42,
    rawTestRailCase: {
      id: 42,
      title: "Fixture",
      custom_preconds: "Account id (account.id, text)",
      custom_steps: "Use [account.id]",
      custom_expected: "Expected result",
    },
  }, deps);

  assert.equal(result.persisted, true);
  assert.equal(deps.calls.adapted[0].id, 42);
  assert.deepEqual(deps.calls.persisted, [{ projectId: "project-id-from-resolver", caseId: 42, requirements }]);
});

test("does not resolve or persist when TestRail has no requirements", async () => {
  const deps = dependencies({ requirements: [], unresolvedPlaceholders: [], conflicts: [] });
  const result = await syncTestRailInputRequirements({ projectSlug: "project-b", caseId: 43, rawTestRailCase: { id: 43, title: "Fixture" } }, deps);

  assert.equal(result.persisted, false);
  assert.deepEqual(deps.calls.resolved, []);
  assert.deepEqual(deps.calls.persisted, []);
});

test("passes parser-deduplicated requirements without creating duplicates", async () => {
  const requirements = [{ key: "account.value", label: "Value", controlType: "text", required: true, sensitive: false, allowedValues: [] }];
  const deps = dependencies({ requirements, unresolvedPlaceholders: [], conflicts: [] });
  await syncTestRailInputRequirements({
    projectSlug: "project-c",
    caseId: 44,
    rawTestRailCase: { id: 44, title: "Fixture", custom_preconds: "Value (account.value, text)\nValue (account.value, text)" },
  }, deps);

  assert.deepEqual(deps.calls.persisted[0].requirements, requirements);
});

test("preserves the adapter conflict result instead of silently persisting it", async () => {
  const deps = dependencies({
    requirements: [{ key: "account.value" }],
    unresolvedPlaceholders: [],
    conflicts: [{ key: "account.value" }],
  });

  await assert.rejects(
    syncTestRailInputRequirements({
      projectSlug: "project-d",
      caseId: 45,
      rawTestRailCase: { id: 45, title: "Fixture" },
    }, deps),
    /conflicting input requirement metadata.*account\.value/,
  );
  assert.deepEqual(deps.calls.persisted, []);
});

test("keeps persistence isolated when caseId changes", async () => {
  const requirements = [{ key: "account.value" }];
  const deps = dependencies({ requirements, unresolvedPlaceholders: [], conflicts: [] });

  await syncTestRailInputRequirements({ projectSlug: "project-e", caseId: 46, rawTestRailCase: { id: 46, title: "First" } }, deps);
  await syncTestRailInputRequirements({ projectSlug: "project-e", caseId: 47, rawTestRailCase: { id: 47, title: "Second" } }, deps);

  assert.deepEqual(deps.calls.persisted.map((call: any) => call.caseId), [46, 47]);
});
