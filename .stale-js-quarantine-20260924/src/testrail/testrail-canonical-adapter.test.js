"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const testrail_canonical_adapter_1 = require("./testrail-canonical-adapter");
const rawCase = {
    id: 901,
    section_id: 12,
    title: "  Recover an account  ",
    custom_preconds: "The account is active",
    custom_steps: "1. Open recovery.\n2. Submit the form.",
    custom_expected: "Recovery succeeds",
};
(0, node_test_1.default)("canonicalizes a normal manual TestRail case deterministically", () => {
    const first = (0, testrail_canonical_adapter_1.canonicalizeTestRailCase)(rawCase);
    const second = (0, testrail_canonical_adapter_1.canonicalizeTestRailCase)(rawCase);
    strict_1.default.deepEqual(first, second);
    strict_1.default.equal(first.canonicalSchemaVersion, "canonical-scenario-1");
    strict_1.default.equal(first.scenarioId, "testrail-case-901");
    strict_1.default.deepEqual(first.sourceRef, { kind: "testrail", caseId: 901, sectionId: 12 });
    strict_1.default.equal(first.title, "Recover an account");
    strict_1.default.deepEqual(first.preconditions, ["The account is active"]);
    strict_1.default.deepEqual(first.steps.map((step) => ({ order: step.order, action: step.action, expected: step.expected })), [
        { order: 1, action: "Open recovery.", expected: undefined },
        { order: 2, action: "Submit the form.", expected: undefined },
    ]);
    strict_1.default.deepEqual(first.expectedResults, ["Recovery succeeds"]);
    strict_1.default.equal(first.requirements.length, 1);
    strict_1.default.equal(first.requirements[0]?.kind, "expected_result");
    strict_1.default.equal(first.requirements[0]?.description, "Recovery succeeds");
    strict_1.default.equal(first.requirements[0]?.requirementId, "requirement:testrail:case:901:expected:1");
    strict_1.default.equal(first.branches, undefined);
    strict_1.default.equal(first.provenance.canonicalizationMode, "deterministic_normalized");
    strict_1.default.deepEqual(first.provenance.sourceRef, first.sourceRef);
});
(0, node_test_1.default)("maps explicit separated TestRail step expectations to stable requirement references", () => {
    const canonical = (0, testrail_canonical_adapter_1.canonicalizeTestRailCase)({
        id: 902,
        title: "Review result",
        custom_steps_separated: [
            { content: "Open the result", expected: "Result is visible" },
            { content: "Close the result", expected: "Result is closed" },
        ],
    });
    strict_1.default.deepEqual(canonical.steps.map((step) => ({ order: step.order, action: step.action, expected: step.expected, requirementRefs: step.requirementRefs })), [
        { order: 1, action: "Open the result", expected: "Result is visible", requirementRefs: ["requirement:testrail:case:902:step:1:expected"] },
        { order: 2, action: "Close the result", expected: "Result is closed", requirementRefs: ["requirement:testrail:case:902:step:2:expected"] },
    ]);
    strict_1.default.deepEqual(canonical.expectedResults, ["Result is visible", "Result is closed"]);
    strict_1.default.equal(canonical.requirements.length, 2);
    strict_1.default.deepEqual(canonical.steps.map((step) => step.requirementRefs), [
        ["requirement:testrail:case:902:step:1:expected"],
        ["requirement:testrail:case:902:step:2:expected"],
    ]);
    strict_1.default.equal("executionReadiness" in canonical, false);
    strict_1.default.equal("inputRequirements" in canonical, false);
    strict_1.default.equal("namedProfileRef" in canonical.requirements, false);
    strict_1.default.equal("locator" in canonical.steps[0], false);
});
(0, node_test_1.default)("assigns stable identity and semantic polarity to assertion steps", () => {
    const canonical = (0, testrail_canonical_adapter_1.canonicalizeTestRailCase)({
        id: 903,
        title: "Validate a rejected form",
        custom_steps_separated: [
            { content: "Fill the form" },
            { content: "Validar que se muestre la validación" },
            { content: "Validar que no permita continuar" },
        ],
        custom_expected: "The invalid form remains blocked",
    });
    strict_1.default.deepEqual(canonical.steps.map((step) => step.requirementRefs), [
        undefined,
        ["requirement:testrail:case:903:step:2:assertion"],
        ["requirement:testrail:case:903:step:3:assertion"],
    ]);
    strict_1.default.equal(canonical.requirements.find((item) => item.requirementId.endsWith("step:2:assertion"))?.polarity, "positive");
    strict_1.default.equal(canonical.requirements.find((item) => item.requirementId.endsWith("step:2:assertion"))?.polarityResolvedAt, "canonical_adapter");
    strict_1.default.equal(canonical.requirements.find((item) => item.requirementId.endsWith("step:3:assertion"))?.polarity, "negative");
    strict_1.default.equal(canonical.steps[2]?.canonicalAssertion?.polarity, "negative");
    strict_1.default.deepEqual(canonical.expectedResultRequirementRefs, []);
});
(0, node_test_1.default)("preserves parent boundaries and requirement lineage for composite assertion steps", () => {
    const canonical = (0, testrail_canonical_adapter_1.canonicalizeTestRailCase)({
        id: 904,
        title: "Validate a constrained transition",
        custom_steps_separated: [
            ...Array.from({ length: 12 }, (_, index) => ({ content: `Perform action ${index + 1}` })),
            { content: 'Al salir del campo "subject", validar que el campo quede inválido y que se muestre un mensaje asociado al dato.' },
            { content: 'Validar que, mientras el campo "subject" permanezca inválido, la acción "advance" permanezca deshabilitada y no permita continuar.' },
        ],
    });
    strict_1.default.equal(canonical.steps.length, 14);
    strict_1.default.equal(canonical.steps[12]?.canonicalAssertion?.childExpectations?.length, 2);
    strict_1.default.equal(canonical.steps[12]?.canonicalAssertion?.trigger, "leave_field");
    strict_1.default.equal(canonical.steps[13]?.canonicalAssertion?.intent, "transition_blocked");
    strict_1.default.equal(canonical.steps[13]?.canonicalAssertion?.advanceAction, "advance");
    strict_1.default.equal(canonical.requirements.length, 2);
    strict_1.default.equal(canonical.steps[12]?.requirementRefs?.length, 1);
    strict_1.default.equal(canonical.steps[13]?.requirementRefs?.length, 1);
    strict_1.default.equal(canonical.steps.filter((step) => step.canonicalAssertion).length, 2);
});
