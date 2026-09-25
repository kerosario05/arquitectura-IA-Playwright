"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const promoted_spec_runtime_1 = require("./promoted-spec-runtime");
const promoted_field_target_contract_1 = require("./promoted-field-target-contract");
const promoted_spec_runtime_2 = require("./promoted-spec-runtime");
function withEnv(vars, fn) {
    const previous = {};
    for (const [key, value] of Object.entries(vars)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }
    return fn().finally(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined)
                delete process.env[key];
            else
                process.env[key] = value;
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
        locator: (selector) => selector === 'table, [role="grid"]' ? grids : grid,
        getByPlaceholder: () => candidate,
    };
}
(0, node_test_1.default)("Colaborador keeps recording identity and resolves its structured grid input", async () => {
    await withEnv({
        APP_SLUG: "portalempresarial",
        SECTION_SLUG: "default-section",
        SCENARIO_ID: "PREVIEW-001",
    }, async () => {
        const identity = (0, promoted_field_target_contract_1.resolvePromotedFieldIdentityFromPersistedContract)(12, "Colaborador");
        strict_1.default.equal(identity?.valueKey, "entity_1.colaborador");
        strict_1.default.deepEqual(identity?.technicalTargetRefs, [
            "role:input|000-0000000-0",
            "structural:grid=grid:table|row=row:2|cell=cell:Colaborador:row:2|header=header:Colaborador|role=amount_or_text",
        ]);
        const resolved = await (0, promoted_spec_runtime_1.resolvePromotedFieldLocator)(fakeStructuredPage(), "Colaborador", {
            targetIdentity: identity,
        });
        strict_1.default.equal(resolved?.strategy, "structured:grid-cell:placeholder");
        strict_1.default.equal(resolved?.scope, "container");
    });
});
(0, node_test_1.default)("compound Ingresos keeps selection and amount authorities and suppresses a stale callback", async () => {
    await withEnv({
        APP_SLUG: "portalempresarial",
        SECTION_SLUG: "default-section",
        SCENARIO_ID: "PREVIEW-001",
        PROMOTED_ENTITY_1_INGRESOS_SELECCION: "fixture-selection",
        EVIDENCE_ENABLED: "false",
    }, async () => {
        const selection = (0, promoted_field_target_contract_1.resolvePromotedFieldIdentityFromPersistedContract)(15, "Ingresos");
        const amount = (0, promoted_field_target_contract_1.resolvePromotedFieldIdentityFromPersistedContract)(16, "Ingresos");
        strict_1.default.equal(selection?.valueKey, "entity_1.ingresos_seleccion");
        strict_1.default.equal(selection?.semanticType, "selection");
        strict_1.default.match(selection?.technicalTargetRefs[0] ?? "", /role=selection/);
        strict_1.default.equal(amount?.valueKey, "entity_1.ingresos_valor");
        strict_1.default.match(amount?.technicalTargetRefs[0] ?? "", /role=amount_or_text/);
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
        };
        const runtime = new promoted_spec_runtime_2.PromotedSpecRuntime(page, { enabled: false, evidenceEnabled: false });
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
        strict_1.default.equal(staleCallbackCalled, false);
    });
});
