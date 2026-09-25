"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const knowledge_health_1 = require("./knowledge-health");
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
function screen(over = {}) {
    return {
        knowledgeKind: "route_menu_snapshot",
        screenKey: "screen",
        clickTargets: ["Enviar código de validación", "Continuar"],
        assertionTargets: ["Hola"],
        observedControls: [{ label: "Continuar", enabled: true }],
        trustedForReuse: true,
        validationStatus: "validated",
        runCount: 1,
        ...over,
    };
}
const ids = (r) => r.findings.map((f) => f.id);
describe("analyzeKnowledgeHealth", () => {
    test("an empty file fails, not warns — nothing can be generated from it", () => {
        const r = (0, knowledge_health_1.analyzeKnowledgeHealth)([]);
        node_assert_1.default.strictEqual(r.severity, "fail");
        node_assert_1.default.ok(ids(r).includes("empty_knowledge"));
    });
    test("knowledge without a single screen fails — the exact shape of the kind mismatch", () => {
        const r = (0, knowledge_health_1.analyzeKnowledgeHealth)([{ knowledgeKind: "route_transition" }]);
        node_assert_1.default.strictEqual(r.severity, "fail");
        node_assert_1.default.ok(ids(r).includes("no_screen_items"));
    });
    test("screens that exist but do not reach the generator are reported", () => {
        const r = (0, knowledge_health_1.analyzeKnowledgeHealth)([screen(), screen({ screenKey: "otra", trustedForReuse: false })]);
        node_assert_1.default.ok(ids(r).includes("screens_not_readable"));
        node_assert_1.default.strictEqual(r.readableByGenerator, 1);
        node_assert_1.default.strictEqual(r.screenItems, 2);
    });
    test("one state per screen everywhere is flagged as probable collapse", () => {
        const r = (0, knowledge_health_1.analyzeKnowledgeHealth)([screen(), screen({ screenKey: "otra" })]);
        node_assert_1.default.ok(ids(r).includes("no_multi_state_screens"));
    });
    test("two states of one screen clear that flag", () => {
        const r = (0, knowledge_health_1.analyzeKnowledgeHealth)([
            screen({ observedControls: [{ label: "Continuar", enabled: false }] }),
            screen({ assertionTargets: ["Indica el código recibido"] }),
        ]);
        node_assert_1.default.ok(!ids(r).includes("no_multi_state_screens"));
        node_assert_1.default.strictEqual(r.screensWithMultipleStates, 1);
    });
    test("captures predating gate state are reported", () => {
        const r = (0, knowledge_health_1.analyzeKnowledgeHealth)([screen({ observedControls: [{ label: "Continuar" }] })]);
        node_assert_1.default.ok(ids(r).includes("captures_without_gate_state"));
        node_assert_1.default.strictEqual(r.itemsMissingEnabledCapture, 1);
    });
    test("no disabled control anywhere is reported — the generator cannot see gates", () => {
        const r = (0, knowledge_health_1.analyzeKnowledgeHealth)([screen()]);
        node_assert_1.default.ok(ids(r).includes("no_gate_evidence"));
    });
    test("healthy knowledge reports ok and nothing else", () => {
        const r = (0, knowledge_health_1.analyzeKnowledgeHealth)([
            screen({ observedControls: [{ label: "Continuar", enabled: false }] }),
            screen({ assertionTargets: ["Indica el código recibido"], observedControls: [{ label: "Continuar", enabled: true }] }),
        ]);
        node_assert_1.default.strictEqual(r.severity, "ok");
        node_assert_1.default.deepStrictEqual(ids(r), ["healthy"]);
    });
    test("counts items by kind for the summary", () => {
        const r = (0, knowledge_health_1.analyzeKnowledgeHealth)([screen(), { knowledgeKind: "route_transition" }]);
        node_assert_1.default.strictEqual(r.itemsByKind["route_menu_snapshot"], 1);
        node_assert_1.default.strictEqual(r.itemsByKind["route_transition"], 1);
    });
    test("reads the legacy kind name too, so old files are not called empty", () => {
        const r = (0, knowledge_health_1.analyzeKnowledgeHealth)([screen({ knowledgeKind: "screen_observed" })]);
        node_assert_1.default.ok(!ids(r).includes("no_screen_items"));
        node_assert_1.default.strictEqual(r.readableByGenerator, 1);
    });
});
