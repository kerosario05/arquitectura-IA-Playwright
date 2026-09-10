import assert from "node:assert/strict";
import test from "node:test";
import { resolveSectionCases } from "./testrail";

function rawCase(id: number, customPreconds?: string) {
  return {
    id,
    title: `Case ${id}`,
    section_id: 7,
    suite_id: 8,
    custom_preconds: customPreconds,
    custom_steps: "Abrir la aplicación",
    custom_expected: "La aplicación responde",
    custom_marker: `raw-${id}`,
  } as any;
}

function clientWith(cases: any[]) {
  return {
    getSection: async () => ({ id: 7, project_id: 1, suite_id: 8 }),
    getCases: async () => cases,
  } as any;
}

test("marks a correctly transformed case without requirements as success", async () => {
  const response = await resolveSectionCases(clientWith([rawCase(93001)]), { sectionId: 7 });
  const returned = response.body.cases[0];

  assert.equal(response.status, 200);
  assert.equal(returned.custom_marker, "raw-93001");
  assert.equal(returned.normalizedScenario.caseId, 93001);
  assert.equal(returned.normalizedScenario.source, "testrail");
  assert.equal(returned.runtimeTransformStatus, "success");
  assert.deepEqual(returned.inputRequirements, []);
});

test("marks a correctly transformed case with runtime requirements as success", async () => {
  const response = await resolveSectionCases(clientWith([rawCase(93002, "Cuenta (account.id, text)")]), { sectionId: 7 });

  assert.equal(response.body.cases[0].runtimeTransformStatus, "success");
  assert.equal(response.body.cases[0].inputRequirements[0].key, "account.id");
  assert.equal(response.body.cases[0].inputRequirements[0].source, "contract");
});

test("materializes transformed requirements for the matching local TestRail project and case", async () => {
  const persisted: any[] = [];
  const response = await resolveSectionCases(
    clientWith([rawCase(93006)]),
    { sectionId: 7, projectId: 30 },
    () => ({
      normalizedScenario: { caseId: 93006 },
      inputRequirements: [
        { key: "auth.company", label: "Company", controlType: "text", required: true },
        { key: "auth.username", label: "Username", controlType: "text", required: true },
        { key: "auth.password", label: "Password", controlType: "password", required: true, sensitive: true },
      ],
      unresolvedPlaceholders: [],
      conflicts: [],
    } as any),
    {
      resolveLocalProject: async () => ({ id: "local-project", slug: "portal-project" }),
      materialize: async (input: any) => persisted.push(input),
    },
  );

  assert.equal(response.body.cases[0].runtimeTransformStatus, "success");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].localProjectSlug, "portal-project");
  assert.equal(persisted[0].caseId, 93006);
  assert.deepEqual(persisted[0].requirements.map((requirement: any) => requirement.key), [
    "auth.company",
    "auth.username",
    "auth.password",
  ]);
});

test("does not destructively materialize an empty derived requirement list", async () => {
  let materialized = 0;
  await resolveSectionCases(
    clientWith([rawCase(93010)]),
    { sectionId: 7, projectId: 30 },
    () => ({
      normalizedScenario: { caseId: 93010 },
      inputRequirements: [],
      unresolvedPlaceholders: [],
      conflicts: [],
    } as any),
    {
      resolveLocalProject: async () => ({ id: "local-project", slug: "portal-project" }),
      materialize: async () => { materialized += 1; },
    },
  );

  assert.equal(materialized, 0);
});

test("marks a failed transformation without exposing error details", async () => {
  const response = await resolveSectionCases(
    clientWith([rawCase(93003)]),
    { sectionId: 7 },
    () => { throw new Error("sensitive case content"); },
  );
  const returned = response.body.cases[0];

  assert.equal(returned.custom_marker, "raw-93003");
  assert.equal(returned.runtimeTransformStatus, "error");
  assert.equal(returned.runtimeTransformErrorCode, "runtime_transform_failed");
  assert.equal(returned.normalizedScenario, null);
  assert.deepEqual(returned.inputRequirements, []);
  assert.deepEqual(returned.unresolvedPlaceholders, []);
  assert.deepEqual(returned.conflicts, []);
  assert.equal(JSON.stringify(returned).includes("sensitive case content"), false);
});

test("does not materialize a case when runtime transformation fails", async () => {
  let materialized = 0;
  const response = await resolveSectionCases(
    clientWith([rawCase(93007)]),
    { sectionId: 7, projectId: 30 },
    () => { throw new Error("runtime transform failed"); },
    {
      resolveLocalProject: async () => ({ id: "local-project", slug: "portal-project" }),
      materialize: async () => { materialized += 1; },
    },
  );

  assert.equal(response.body.cases[0].runtimeTransformStatus, "error");
  assert.equal(materialized, 0);
});

test("keeps the batch when one runtime transformation fails", async () => {
  const response = await resolveSectionCases(
    clientWith([rawCase(93004), rawCase(93005)]),
    { sectionId: 7 },
    (currentCase) => {
      if (currentCase.id === 93004) throw new Error("runtime transform failed");
      return {
        normalizedScenario: { caseId: currentCase.id },
        inputRequirements: [],
        unresolvedPlaceholders: [],
        conflicts: [],
      } as any;
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.cases.length, 2);
  assert.equal(response.body.cases[0].id, 93004);
  assert.equal(response.body.cases[0].runtimeTransformStatus, "error");
  assert.deepEqual(response.body.cases[0].inputRequirements, []);
  assert.equal(response.body.cases[1].id, 93005);
  assert.equal(response.body.cases[1].runtimeTransformStatus, "success");
  assert.equal(response.body.cases[1].normalizedScenario.caseId, 93005);
});

test("uses a valid localProjectId directly without reverse lookup", async () => {
  let directLookups = 0;
  let reverseLookups = 0;
  const persisted: any[] = [];

  const response = await resolveSectionCases(
    clientWith([rawCase(93008)]),
    { sectionId: 7, projectId: 30, localProjectId: "local-project-1" },
    () => ({
      normalizedScenario: { caseId: 93008 },
      inputRequirements: [{ key: "account.id", required: true }],
      unresolvedPlaceholders: [],
      conflicts: [],
    } as any),
    {
      resolveLocalProjectById: async () => {
        directLookups += 1;
        return { id: "local-project-1", slug: "portal-project" };
      },
      resolveLocalProject: async () => {
        reverseLookups += 1;
        return { id: "legacy-project", slug: "legacy-project" };
      },
      materialize: async (input: any) => persisted.push(input),
    } as any,
  );

  assert.equal(response.status, 200);
  assert.equal(directLookups, 1);
  assert.equal(reverseLookups, 0);
  assert.equal(persisted[0].localProjectId, "local-project-1");
});

test("rejects an unknown localProjectId without legacy fallback", async () => {
  let reverseLookups = 0;
  const response = await resolveSectionCases(
    clientWith([rawCase(93009)]),
    { sectionId: 7, projectId: 30, localProjectId: "missing-project" },
    undefined,
    {
      resolveLocalProjectById: async () => null,
      resolveLocalProject: async () => {
        reverseLookups += 1;
        return { id: "legacy-project", slug: "legacy-project" };
      },
    } as any,
  );

  assert.equal(response.status, 404);
  assert.equal(response.body.error, "local_project_not_found");
  assert.equal(reverseLookups, 0);
});

test("keeps reverse lookup when localProjectId is absent", async () => {
  let reverseLookups = 0;
  const response = await resolveSectionCases(
    clientWith([rawCase(93010)]),
    { sectionId: 7, projectId: 30 },
    undefined,
    {
      resolveLocalProject: async () => {
        reverseLookups += 1;
        return { id: "legacy-project", slug: "legacy-project" };
      },
      materialize: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(reverseLookups, 1);
});
