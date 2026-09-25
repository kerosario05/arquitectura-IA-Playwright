import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePromotedFieldLocator,
} from "./promoted-spec-runtime";
import {
  resolvePromotedFieldIdentityFromPersistedContract,
} from "./promoted-field-target-contract";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";

function withEnv(vars: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function fakeStructuredPage() {
  const candidate = {
    count: async () => 1,
    isVisible: async () => true,
    isDisabled: async () => false,
    evaluate: async () => "input",
  };
  const matchingCells = {
    count: async () => 1,
    getByPlaceholder: () => candidate,
    locator: () => candidate,
  };
  const cells = {
    filter: () => matchingCells,
  };
  const grid = {
    locator: () => cells,
  };
  const grids = {
    count: async () => 1,
    locator: () => cells,
  };
  return {
    locator: (selector: string) => selector === 'table, [role="grid"]' ? grids : grid,
    getByPlaceholder: () => candidate,
  } as any;
}

test("Colaborador keeps recording identity and resolves its structured grid input", async () => {
  await withEnv({
    APP_SLUG: "portalempresarial",
    SECTION_SLUG: "default-section",
    SCENARIO_ID: "PREVIEW-001",
  }, async () => {
    const identity = resolvePromotedFieldIdentityFromPersistedContract(12, "Colaborador");
    assert.equal(identity?.valueKey, "entity_1.colaborador");
    assert.deepEqual(identity?.technicalTargetRefs, [
      "role:input|000-0000000-0",
      "structural:grid=grid:table|row=row:2|cell=cell:Colaborador:row:2|header=header:Colaborador|role=amount_or_text",
    ]);

    const resolved = await resolvePromotedFieldLocator(fakeStructuredPage(), "Colaborador", {
      targetIdentity: identity,
    });
    assert.equal(resolved?.strategy, "structured:grid-cell:placeholder");
    assert.equal(resolved?.scope, "container");
  });
});

test("compound Ingresos keeps selection and amount authorities and suppresses a stale callback", async () => {
  await withEnv({
    APP_SLUG: "portalempresarial",
    SECTION_SLUG: "default-section",
    SCENARIO_ID: "PREVIEW-001",
    PROMOTED_ENTITY_1_INGRESOS_SELECCION: "fixture-selection",
    EVIDENCE_ENABLED: "false",
  }, async () => {
    const selection = resolvePromotedFieldIdentityFromPersistedContract(15, "Ingresos");
    const amount = resolvePromotedFieldIdentityFromPersistedContract(16, "Ingresos");
    assert.equal(selection?.valueKey, "entity_1.ingresos_seleccion");
    assert.equal(selection?.semanticType, "selection");
    assert.match(selection?.technicalTargetRefs[0] ?? "", /role=selection/);
    assert.equal(amount?.valueKey, "entity_1.ingresos_valor");
    assert.match(amount?.technicalTargetRefs[0] ?? "", /role=amount_or_text/);

    const option = {
      count: async () => 1,
      isVisible: async () => true,
      isDisabled: async () => false,
      click: async () => undefined,
    };
    const page = {
      on: () => undefined,
      url: () => "https://example.test/payroll/manualCreationTable",
      getByRole: () => option,
      getByText: () => option,
    } as any;
    const runtime = new PromotedSpecRuntime(page, { enabled: false, evidenceEnabled: false });
    let staleCallbackCalled = false;
    await runtime.selectPromotedItem({
      stepIndex: 15,
      target: "Ingresos",
      actionIntent: "select",
      action: async () => {
        staleCallbackCalled = true;
        throw new Error("stale callback must not run");
      },
    });
    assert.equal(staleCallbackCalled, false);
  });
});
