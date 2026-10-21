import assert from "node:assert/strict";
import { test } from "node:test";
import { syncTestRailInputRequirements } from "./testrail-input-requirements-sync";
import type { RuntimeInputRequirement } from "./testrail-runtime-transformer";

function dependencies(parsed: any) {
  const calls: any = { adapted: [], resolved: [], persisted: [] };
  return {
    calls,
    loadPromotedRequirements: async () => [],
    adapter: (rawCase: unknown) => {
      calls.adapted.push(rawCase);
      return parsed;
    },
    getByProjectAndCase: async () => [],
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

test("selection keeps exact promoted execution keys across projects instead of inferring aliases", async () => {
  for (const projectSlug of ["fixture-banking", "fixture-orders"]) {
    const promoted: RuntimeInputRequirement[] = [{ key: "jira_step_16", label: "Source", required: true,
      source: "contract", fieldCapability: { kind: "select" }, valuePolicy: "scenario_controlled", scenarioDataPolicy: "explicit_value" }];
    const deps = dependencies({ requirements: [{ key: "input.source", label: "Source" }], unresolvedPlaceholders: [], conflicts: [] });
    const result = await syncTestRailInputRequirements({ projectSlug, caseId: 81,
      rawTestRailCase: { id: 81, title: "Fixture", custom_steps: 'Seleccionar valor en "Source"' },
    }, { ...deps, loadPromotedRequirements: async () => promoted,
      getByProjectAndCase: async () => [{ key: "input.source", label: "Source" }],
    });
    assert.deepEqual(result.requirements, promoted);
    assert.deepEqual(deps.calls.persisted[0].requirements, promoted);
    assert.equal(deps.calls.adapted.length, 0);
  }
});

test("selection sync infers only named fill targets and persists them under the selected project and case", async () => {
  const persisted: any[] = [];
  const result = await syncTestRailInputRequirements({
    projectSlug: "project-from-selection",
    caseId: 54374,
    rawTestRailCase: {
      id: 54374,
      title: "Rejected sign in",
      custom_steps_separated: [
        { content: 'Ingresar RNC en "RNC"' },
        { content: 'Ingresar usuario en "Usuario"' },
        { content: 'Ingresar una contraseña no válida en "Contraseña"' },
        { content: 'Presionar "Iniciar sesión"' },
      ],
    },
  }, {
    resolveProjectId: async (projectSlug) => projectSlug === "project-from-selection" ? "project-id" : null,
    getByProjectAndCase: async () => [],
    replaceForProjectAndCase: async (projectId, caseId, requirements) => { persisted.push({ projectId, caseId, requirements }); },
  });

  assert.equal(result.persisted, true);
  assert.deepEqual(result.requirements.map(({ key, label, controlType, sensitive }) => ({ key, label, controlType, sensitive })), [
    { key: "input.rnc", label: "RNC", controlType: "text", sensitive: false },
    { key: "input.usuario", label: "Usuario", controlType: "text", sensitive: false },
    { key: "input.contrasena", label: "Contraseña", controlType: "password", sensitive: true },
  ]);
  assert.equal(persisted[0].projectId, "project-id");
  assert.equal(persisted[0].caseId, 54374);
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

test("fills a partial selection contract with named list inputs while preserving saved keys and metadata", async () => {
  const existing = [{ key: "saved.user", label: "Usuario", controlType: "text", required: true, allowedValues: [] }];
  const result = await syncTestRailInputRequirements({ projectSlug: "other-project", caseId: 77,
    rawTestRailCase: { id: 77, title: "Lists", custom_steps: 'Ingresar usuario en "Usuario"\nSeleccionar cuenta en "Cuenta de origen"\nSelect a destination in "Destination"\nPresionar "Continuar"' },
  }, { resolveProjectId: async () => "local-project", getByProjectAndCase: async () => existing,
    replaceForProjectAndCase: async (_project, _case, fields) => { assert.equal(fields.length, 3); },
  });
  assert.deepEqual(result.requirements.map(field => [field.key, field.controlType]), [
    ["saved.user", "text"], ["input.cuenta_de_origen", "select"], ["input.destination", "select"],
  ]);
});
