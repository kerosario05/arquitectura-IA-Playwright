"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const web_session_recorder_1 = require("./web-session-recorder");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
describe("buildWebLocators", () => {
    test("keeps a structural candidate for an unlabeled editable compound child", () => {
        const locators = (0, web_session_recorder_1.buildWebLocators)({
            kind: "input",
            label: "",
            compoundRole: "amount_or_text",
            gridRef: "grid:runtime",
            rowRef: "row:runtime",
            cellRef: "cell:runtime",
            headerRef: "header:measure",
            technicalTargetCandidates: [{
                    targetType: "editable",
                    semanticRole: "amount_or_text",
                    locatorCandidates: [{ strategy: "structural", value: "grid=grid:runtime|row=row:runtime|cell=cell:runtime|header=header:measure|role=amount_or_text", confidence: 0.72 }],
                    interactionEvidence: ["input"],
                    confidence: 0.9,
                    validatedByInteraction: true,
                }],
        });
        node_assert_1.default.equal(locators.some((locator) => locator.strategy === "structural"), true);
        node_assert_1.default.equal(locators.some((locator) => /nth|first|coordinate/i.test(locator.value)), false);
    });
    test("keeps the strongest identity when the page says it is unique", () => {
        const locators = (0, web_session_recorder_1.buildWebLocators)({
            kind: "click",
            label: "Continuar",
            testId: "continue-btn",
            text: "Continuar",
            ranks: { testId: { count: 1, index: 0 }, text: { count: 1, index: 0 } },
        });
        node_assert_1.default.deepStrictEqual(locators[0], { strategy: "data-testid", value: "continue-btn", confidence: 0.98 });
    });
    // Measured in a real browser: two buttons carrying the same aria-label, where only the
    // visible text tells them apart. The shared identity must not win.
    test("demotes an identity shared with other elements below a unique one", () => {
        const locators = (0, web_session_recorder_1.buildWebLocators)({
            kind: "click",
            label: "Enviar código de validación",
            ariaLabel: "Enviar código de validación",
            text: "Teléfono",
            ranks: { ariaLabel: { count: 2, index: 1 }, text: { count: 1, index: 0 } },
        });
        node_assert_1.default.strictEqual(locators[0].strategy, "text");
        node_assert_1.default.strictEqual(locators[0].value, "Teléfono");
        const shared = locators.find((l) => l.strategy === "aria-label");
        node_assert_1.default.strictEqual(shared?.ambiguous, true);
        node_assert_1.default.strictEqual(shared?.matchIndex, 1);
    });
    test("marks the step uncertain when every identity is shared", () => {
        const locators = (0, web_session_recorder_1.buildWebLocators)({
            kind: "click",
            label: "Ver",
            ariaLabel: "Ver",
            text: "Ver",
            ranks: { ariaLabel: { count: 4, index: 2 }, text: { count: 4, index: 2 } },
        });
        node_assert_1.default.ok(locators.every((l) => l.ambiguous === true));
        // Below the 0.7 the scenario builder uses to flag a step as uncertain.
        node_assert_1.default.ok((locators[0].confidence ?? 1) < 0.7);
    });
    test("falls back to the plain ranking when the page reported no measurements", () => {
        const locators = (0, web_session_recorder_1.buildWebLocators)({
            kind: "click",
            label: "Salir",
            ariaLabel: "Salir",
            text: "Salir",
        });
        node_assert_1.default.strictEqual(locators[0].strategy, "aria-label");
        node_assert_1.default.strictEqual(locators[0].confidence, 0.9);
        node_assert_1.default.ok(locators.every((l) => l.ambiguous === undefined));
    });
});
describe("isSensitiveField", () => {
    test("a password input is sensitive regardless of its label", () => {
        node_assert_1.default.strictEqual((0, web_session_recorder_1.isSensitiveField)({ kind: "input", label: "", inputType: "password" }), true);
    });
    test("an OTP field is caught by its label", () => {
        node_assert_1.default.strictEqual((0, web_session_recorder_1.isSensitiveField)({ kind: "input", label: "Código OTP" }), true);
    });
    test("an ordinary field is not", () => {
        node_assert_1.default.strictEqual((0, web_session_recorder_1.isSensitiveField)({ kind: "input", label: "Usuario" }), false);
    });
});
