"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const automation_reuse_1 = require("../src/automations/automation-reuse");
function makeEntry(overrides) {
    return {
        id: overrides.id,
        title: overrides.title,
        planPath: `automations/plans/${overrides.id}.plan.json`,
        specPath: `tests/generated/${overrides.id}.spec.ts`,
        status: overrides.status ?? "active",
        source: "rule_based",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        caseId: overrides.caseId,
        externalId: overrides.externalId,
        tags: overrides.tags
    };
}
test_1.test.describe("extractFunctionalCode", () => {
    (0, test_1.test)("extracts C37372 from title with code prefix", () => {
        (0, test_1.expect)((0, automation_reuse_1.extractFunctionalCode)("C37372 - Acceso al modulo Informacion de productos")).toBe("C37372");
    });
    (0, test_1.test)("extracts C37374 from title with code in middle", () => {
        (0, test_1.expect)((0, automation_reuse_1.extractFunctionalCode)("C37374 - Visualizar detalle de Tarjeta Visa Clasica")).toBe("C37374");
    });
    (0, test_1.test)("extracts code from title without separator", () => {
        (0, test_1.expect)((0, automation_reuse_1.extractFunctionalCode)("C37372 Acceso al modulo")).toBe("C37372");
    });
    (0, test_1.test)("returns undefined when no code present", () => {
        (0, test_1.expect)((0, automation_reuse_1.extractFunctionalCode)("Acceso al modulo Informacion de productos")).toBeUndefined();
    });
    (0, test_1.test)("returns undefined for short numbers that are not case codes", () => {
        (0, test_1.expect)((0, automation_reuse_1.extractFunctionalCode)("Step 123 of test")).toBeUndefined();
    });
    (0, test_1.test)("extracts 6-digit code", () => {
        (0, test_1.expect)((0, automation_reuse_1.extractFunctionalCode)("C123456 - Long code test")).toBe("C123456");
    });
    (0, test_1.test)("extracts 4-digit code", () => {
        (0, test_1.expect)((0, automation_reuse_1.extractFunctionalCode)("C1234 - Short code test")).toBe("C1234");
    });
});
test_1.test.describe("normalizeTitle", () => {
    (0, test_1.test)("removes C code prefix with separator", () => {
        (0, test_1.expect)((0, automation_reuse_1.normalizeTitle)("C37372 - Acceso al modulo Informacion de productos")).toBe("acceso al modulo informacion de productos");
    });
    (0, test_1.test)("removes C code without separator", () => {
        (0, test_1.expect)((0, automation_reuse_1.normalizeTitle)("C37372 Acceso al modulo")).toBe("acceso al modulo");
    });
    (0, test_1.test)("normalizes accents", () => {
        (0, test_1.expect)((0, automation_reuse_1.normalizeTitle)("Acceso a información")).toBe("acceso a informacion");
    });
    (0, test_1.test)("collapses multiple spaces", () => {
        (0, test_1.expect)((0, automation_reuse_1.normalizeTitle)("Acceso   al   modulo")).toBe("acceso al modulo");
    });
    (0, test_1.test)("handles empty string", () => {
        (0, test_1.expect)((0, automation_reuse_1.normalizeTitle)("")).toBe("");
    });
    (0, test_1.test)("two equivalent titles normalize to same value", () => {
        const t1 = (0, automation_reuse_1.normalizeTitle)("C37372 - Acceso al modulo Informacion de productos");
        const t2 = (0, automation_reuse_1.normalizeTitle)("Acceso al modulo Informacion de productos");
        (0, test_1.expect)(t1).toBe(t2);
    });
});
test_1.test.describe("findReusableAutomation", () => {
    (0, test_1.test)("finds automation by same functionalCode", () => {
        const automations = [
            makeEntry({ id: "c37616-c37372-acceso", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37616 }),
            makeEntry({ id: "c37617-c37373-other", title: "C37373 - Other test", caseId: 37617 })
        ];
        const match = (0, automation_reuse_1.findReusableAutomation)(37749, "C37372 - Acceso al modulo Informacion de productos", automations);
        (0, test_1.expect)(match).toBeDefined();
        (0, test_1.expect)(match.entry.id).toBe("c37616-c37372-acceso");
        (0, test_1.expect)(match.matchType).toBe("functional_code");
        (0, test_1.expect)(match.confidence).toBe(0.95);
    });
    (0, test_1.test)("finds exact same-case automation first", () => {
        const automations = [
            makeEntry({ id: "c37750-same-case", title: "Consulta listado de tarjetas de credito", caseId: 37750 }),
            makeEntry({ id: "c37616-similar", title: "Consulta listado de tarjetas de credito", caseId: 37616 })
        ];
        const match = (0, automation_reuse_1.findReusableAutomation)(37750, "Consulta listado de tarjetas de credito", automations);
        (0, test_1.expect)(match).toBeDefined();
        (0, test_1.expect)(match.entry.id).toBe("c37750-same-case");
        (0, test_1.expect)(match.matchType).toBe("same_case");
        (0, test_1.expect)(match.confidence).toBe(1);
    });
    (0, test_1.test)("finds automation by normalized title when functionalCode differs", () => {
        const automations = [
            makeEntry({ id: "c37616-no-code-acceso", title: "Acceso al modulo Informacion de productos", caseId: 37616 })
        ];
        const match = (0, automation_reuse_1.findReusableAutomation)(37749, "Acceso al modulo Informacion de productos", automations);
        (0, test_1.expect)(match).toBeDefined();
        (0, test_1.expect)(match.entry.id).toBe("c37616-no-code-acceso");
        (0, test_1.expect)(match.matchType).toBe("normalized_title");
        (0, test_1.expect)(match.confidence).toBe(0.8);
    });
    (0, test_1.test)("does not find match if functionalCode and title differ", () => {
        const automations = [
            makeEntry({ id: "c37616-c37372-acceso", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37616 })
        ];
        const match = (0, automation_reuse_1.findReusableAutomation)(37750, "C99999 - Completely different test", automations);
        (0, test_1.expect)(match).toBeUndefined();
    });
    (0, test_1.test)("skips inactive automations even when same caseId as target", () => {
        const automations = [
            makeEntry({ id: "c37749-c37372-acceso", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37749, status: "disabled" })
        ];
        const match = (0, automation_reuse_1.findReusableAutomation)(37749, "C37372 - Acceso al modulo Informacion de productos", automations);
        (0, test_1.expect)(match).toBeUndefined();
    });
    (0, test_1.test)("sk inactive automations", () => {
        const automations = [
            makeEntry({ id: "c37616-c37372-acceso", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37616, status: "disabled" })
        ];
        const match = (0, automation_reuse_1.findReusableAutomation)(37749, "C37372 - Acceso al modulo Informacion de productos", automations);
        (0, test_1.expect)(match).toBeUndefined();
    });
    (0, test_1.test)("skips draft automations", () => {
        const automations = [
            makeEntry({ id: "c37616-c37372-acceso", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37616, status: "draft" })
        ];
        const match = (0, automation_reuse_1.findReusableAutomation)(37749, "C37372 - Acceso al modulo Informacion de productos", automations);
        (0, test_1.expect)(match).toBeUndefined();
    });
    (0, test_1.test)("returns undefined for empty automations list", () => {
        const match = (0, automation_reuse_1.findReusableAutomation)(37749, "C37372 - Test", []);
        (0, test_1.expect)(match).toBeUndefined();
    });
    (0, test_1.test)("functional_code match has higher confidence than normalized_title", () => {
        const automations = [
            makeEntry({ id: "c37616-title-match", title: "Acceso al modulo Informacion de productos", caseId: 37616 }),
            makeEntry({ id: "c37617-code-match", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37617 })
        ];
        const match = (0, automation_reuse_1.findReusableAutomation)(37749, "C37372 - Acceso al modulo Informacion de productos", automations);
        (0, test_1.expect)(match).toBeDefined();
        (0, test_1.expect)(match.entry.id).toBe("c37617-code-match");
        (0, test_1.expect)(match.matchType).toBe("functional_code");
    });
});
test_1.test.describe("cloneExecutionPlan", () => {
    function makePlan(overrides) {
        return {
            version: "1.0",
            source: "rule_based",
            status: "validated",
            scenario: {
                source: "testrail",
                externalId: "C37372",
                caseId: 37616,
                title: "C37372 - Acceso al modulo Informacion de productos"
            },
            requiredData: [],
            steps: [
                { index: 1, action: "navigate", target: "APP_BASE_URL" },
                { index: 2, action: "click", target: { strategy: "text", value: "Consultar" } }
            ],
            createdAt: new Date().toISOString(),
            ...overrides
        };
    }
    (0, test_1.test)("clones plan with new caseId", () => {
        const plan = makePlan();
        const cloned = (0, automation_reuse_1.cloneExecutionPlan)(plan, 37749, "C37749 - Acceso al modulo Informacion de productos", "c37616-c37372-acceso");
        (0, test_1.expect)(cloned.scenario.caseId).toBe(37749);
        (0, test_1.expect)(cloned.scenario.title).toBe("C37749 - Acceso al modulo Informacion de productos");
        (0, test_1.expect)(cloned.scenario.externalId).toBe("C37372");
    });
    (0, test_1.test)("preserves steps from original plan", () => {
        const plan = makePlan();
        const cloned = (0, automation_reuse_1.cloneExecutionPlan)(plan, 37749, "New Title", "source-id");
        (0, test_1.expect)(cloned.steps).toHaveLength(2);
        (0, test_1.expect)(cloned.steps[0].action).toBe("navigate");
        (0, test_1.expect)(cloned.steps[1].action).toBe("click");
    });
    (0, test_1.test)("preserves requiredData from original plan", () => {
        const plan = makePlan({
            requiredData: [{ key: "cedula", required: true, resolved: true }]
        });
        const cloned = (0, automation_reuse_1.cloneExecutionPlan)(plan, 37749, "New Title", "source-id");
        (0, test_1.expect)(cloned.requiredData).toHaveLength(1);
        (0, test_1.expect)(cloned.requiredData[0].key).toBe("cedula");
    });
    (0, test_1.test)("adds reuse note to plan", () => {
        const plan = makePlan();
        const cloned = (0, automation_reuse_1.cloneExecutionPlan)(plan, 37749, "New Title", "c37616-c37372-acceso");
        (0, test_1.expect)(cloned.notes).toContain("Reused from automation: c37616-c37372-acceso");
    });
    (0, test_1.test)("appends reuse note to existing notes", () => {
        const plan = makePlan({ notes: ["Existing note"] });
        const cloned = (0, automation_reuse_1.cloneExecutionPlan)(plan, 37749, "New Title", "source-id");
        (0, test_1.expect)(cloned.notes).toContain("Existing note");
        (0, test_1.expect)(cloned.notes).toContain("Reused from automation: source-id");
    });
    (0, test_1.test)("does not mutate original plan", () => {
        const plan = makePlan();
        const originalCaseId = plan.scenario.caseId;
        const originalTitle = plan.scenario.title;
        (0, automation_reuse_1.cloneExecutionPlan)(plan, 37749, "New Title", "source-id");
        (0, test_1.expect)(plan.scenario.caseId).toBe(originalCaseId);
        (0, test_1.expect)(plan.scenario.title).toBe(originalTitle);
    });
    (0, test_1.test)("preserves plan status", () => {
        const plan = makePlan({ status: "validated" });
        const cloned = (0, automation_reuse_1.cloneExecutionPlan)(plan, 37749, "New Title", "source-id");
        (0, test_1.expect)(cloned.status).toBe("validated");
    });
    (0, test_1.test)("preserves plan source", () => {
        const plan = makePlan({ source: "rule_based" });
        const cloned = (0, automation_reuse_1.cloneExecutionPlan)(plan, 37749, "New Title", "source-id");
        (0, test_1.expect)(cloned.source).toBe("rule_based");
    });
});
