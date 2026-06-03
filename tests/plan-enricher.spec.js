"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const plan_enricher_1 = require("../src/plans/plan-enricher");
function createPlan(description) {
    return {
        version: "1.0",
        source: "rule_based",
        status: "draft",
        scenario: { source: "manual", title: "demo" },
        requiredData: [],
        steps: [
            { index: 1, action: "navigate", target: "APP_BASE_URL" },
            { index: 2, action: "noop", description, evidence: true }
        ],
        createdAt: new Date().toISOString()
    };
}
function createSnapshot(elements) {
    return {
        version: "1.0",
        url: "https://example.com",
        title: "Example",
        capturedAt: new Date().toISOString(),
        elements,
        summary: { totalElements: elements.length, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 }
    };
}
const contextWithCedula = {
    entries: [{ key: "cedula", value: "001", source: "test_data", sensitive: true }],
    counts: { total: 1, sensitive: 1, nonSensitive: 0 }
};
(0, test_1.test)("converts noop fill with resolved data", () => {
    const plan = createPlan("Ingresar cédula");
    const snapshot = createSnapshot([
        {
            id: "i1",
            type: "input",
            label: "Cédula",
            visible: true,
            candidateLocators: [{ strategy: "label", value: "Cédula", confidence: 0.85 }],
            dataHints: ["cedula"]
        }
    ]);
    const result = (0, plan_enricher_1.enrichExecutionPlanWithSnapshot)({
        plan,
        snapshot,
        dataContext: contextWithCedula,
        aliases: {},
        missingInputBehavior: "fail"
    });
    (0, test_1.expect)(result.plan.steps[1].action).toBe("fill");
    (0, test_1.expect)(result.plan.status).toBe("validated");
});
(0, test_1.test)("does not convert fill when missing data and marks needs_data", () => {
    const plan = createPlan("Ingresar cédula");
    const snapshot = createSnapshot([
        {
            id: "i1",
            type: "input",
            label: "Cédula",
            visible: true,
            candidateLocators: [{ strategy: "label", value: "Cédula", confidence: 0.85 }],
            dataHints: ["cedula"]
        }
    ]);
    const result = (0, plan_enricher_1.enrichExecutionPlanWithSnapshot)({
        plan,
        snapshot,
        dataContext: { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } },
        aliases: {},
        missingInputBehavior: "fail"
    });
    (0, test_1.expect)(result.plan.steps[1].action).toBe("noop");
    (0, test_1.expect)(result.plan.status).toBe("needs_data");
});
(0, test_1.test)("converts noop click with button", () => {
    const plan = createPlan("Presionar consultar");
    const snapshot = createSnapshot([
        {
            id: "b1",
            type: "button",
            text: "Consultar",
            visible: true,
            candidateLocators: [{ strategy: "text", value: "Consultar", confidence: 0.75 }],
            dataHints: []
        }
    ]);
    const result = (0, plan_enricher_1.enrichExecutionPlanWithSnapshot)({
        plan,
        snapshot,
        dataContext: contextWithCedula,
        aliases: {},
        missingInputBehavior: "fail"
    });
    (0, test_1.expect)(result.plan.steps[1].action).toBe("click");
});
(0, test_1.test)("converts assert with heading", () => {
    const plan = createPlan("Validar resultado");
    const snapshot = createSnapshot([
        {
            id: "h1",
            type: "heading",
            text: "Validar resultado",
            visible: true,
            candidateLocators: [{ strategy: "text", value: "Resultado", confidence: 0.75 }],
            dataHints: []
        }
    ]);
    const result = (0, plan_enricher_1.enrichExecutionPlanWithSnapshot)({
        plan,
        snapshot,
        dataContext: contextWithCedula,
        aliases: {},
        missingInputBehavior: "fail"
    });
    (0, test_1.expect)(result.plan.steps[1].action).toBe("assertVisible");
});
(0, test_1.test)("keeps noop on low confidence and marks needs_discovery", () => {
    const plan = createPlan("Presionar consultar");
    const snapshot = createSnapshot([]);
    const result = (0, plan_enricher_1.enrichExecutionPlanWithSnapshot)({
        plan,
        snapshot,
        dataContext: contextWithCedula,
        aliases: {},
        missingInputBehavior: "fail"
    });
    (0, test_1.expect)(result.plan.steps[1].action).toBe("noop");
    (0, test_1.expect)(result.plan.status).toBe("needs_discovery");
});
(0, test_1.test)("does not mutate original plan", () => {
    const plan = createPlan("Presionar consultar");
    const snapshot = createSnapshot([]);
    const copy = JSON.parse(JSON.stringify(plan));
    void (0, plan_enricher_1.enrichExecutionPlanWithSnapshot)({
        plan,
        snapshot,
        dataContext: contextWithCedula,
        aliases: {},
        missingInputBehavior: "fail"
    });
    (0, test_1.expect)(plan).toEqual(copy);
});
(0, test_1.test)("does not convert without candidate locator", () => {
    const plan = createPlan("Presionar consultar");
    const snapshot = createSnapshot([
        {
            id: "b1",
            type: "button",
            text: "Consultar",
            visible: true,
            candidateLocators: [],
            dataHints: []
        }
    ]);
    const result = (0, plan_enricher_1.enrichExecutionPlanWithSnapshot)({
        plan,
        snapshot,
        dataContext: contextWithCedula,
        aliases: {},
        missingInputBehavior: "fail"
    });
    (0, test_1.expect)(result.plan.steps[1].action).toBe("noop");
});
