"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const mobile_knowledge_extractor_1 = require("./mobile-knowledge-extractor");
const mobile_knowledge_resolver_1 = require("./mobile-knowledge-resolver");
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
const PKG = "com.appconversacionalbsc";
function node(cls, attrs) {
    const all = { package: PKG, class: cls, displayed: "true", ...attrs };
    return `<${cls} ${Object.entries(all).map(([k, v]) => `${k}="${v}"`).join(" ")} />`;
}
function screen(opts) {
    return [
        "<hierarchy>",
        node("android.widget.TextView", { text: "Hola Nr2rc, necesitamos que indiques y valides tus datos de contacto.", clickable: "false", heading: "true" }),
        node("android.view.ViewGroup", { "content-desc": "Enviar código de validación", clickable: "true", enabled: "true" }),
        node("android.view.ViewGroup", { "content-desc": "Continuar", clickable: "true", enabled: opts.continuarEnabled ? "true" : "false" }),
        node("android.view.ViewGroup", { "content-desc": "Salir", clickable: "true", enabled: "true" }),
        ...(opts.extra ?? []),
        "</hierarchy>",
    ].join("\n");
}
/** The contact screen before any code is sent: Continuar gated. */
const GATED = screen({ continuarEnabled: false });
/** The same screen once both codes validated: Continuar open — the observable proof of success. */
const OPEN = screen({ continuarEnabled: true });
/** The intermediate state: code sent, boxes on screen, Continuar still gated. */
const CODE_SENT = screen({
    continuarEnabled: false,
    extra: [node("android.widget.TextView", { text: "Indica el código recibido en el correo", clickable: "false" })],
});
describe("enabled state is captured", () => {
    test("records a gated submit control as disabled", () => {
        const snap = (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(GATED);
        const cont = snap.observedControls.find((c) => c.label === "Continuar");
        node_assert_1.default.strictEqual(cont?.enabled, false);
    });
    test("records the same control as enabled once the gate opens", () => {
        const cont = (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(OPEN).observedControls.find((c) => c.label === "Continuar");
        node_assert_1.default.strictEqual(cont?.enabled, true);
    });
    test("does not annotate plain text with an enabled flag", () => {
        const heading = (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(GATED).observedControls.find((c) => c.label.startsWith("Hola"));
        node_assert_1.default.strictEqual(heading?.enabled, undefined);
    });
});
describe("gate state makes the two states distinguishable", () => {
    test("same screen, different gate state, different fingerprint", () => {
        node_assert_1.default.notStrictEqual((0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(GATED).fingerprint, (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(OPEN).fingerprint);
    });
    test("but the screenKey stays the same — which is exactly why keying by it lost states", () => {
        node_assert_1.default.strictEqual((0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(GATED).screenKey, (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(OPEN).screenKey);
    });
    test("a new element also yields a new state", () => {
        node_assert_1.default.notStrictEqual((0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(GATED).fingerprint, (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(CODE_SENT).fingerprint);
    });
    test("the three states of the flow are three distinct fingerprints", () => {
        const prints = new Set([GATED, CODE_SENT, OPEN].map((x) => (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(x).fingerprint));
        node_assert_1.default.strictEqual(prints.size, 3);
    });
    test("an identical capture stays one state — no duplicates", () => {
        node_assert_1.default.strictEqual((0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(GATED).fingerprint, (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(GATED).fingerprint);
    });
});
describe("the learning file reaches the generator", () => {
    const item = (over) => ({
        knowledgeKind: "route_menu_snapshot",
        trustedForReuse: true,
        validationStatus: "validated",
        screenKey: "screen",
        clickTargets: ["Enviar código de validación", "Continuar", "Salir"],
        assertionTargets: ["Indica el código recibido en el correo"],
        runCount: 3,
        ...over,
    });
    test("reads the kind the persister actually writes", () => {
        const screens = (0, mobile_knowledge_resolver_1.selectRelevantMobileKnowledge)({ items: [item({})] }, "código de validación correo", 5);
        node_assert_1.default.strictEqual(screens.length, 1);
    });
    test("items under the old name still resolve", () => {
        const screens = (0, mobile_knowledge_resolver_1.selectRelevantMobileKnowledge)({ items: [item({ knowledgeKind: "screen_observed" })] }, "código de validación correo", 5);
        node_assert_1.default.strictEqual(screens.length, 1);
    });
    test("surfaces which controls were gated", () => {
        const screens = (0, mobile_knowledge_resolver_1.selectRelevantMobileKnowledge)({
            items: [
                item({
                    observedControls: [
                        { label: "Continuar", enabled: false },
                        { label: "Salir", enabled: true },
                    ],
                }),
            ],
        }, "código de validación correo", 5);
        node_assert_1.default.deepStrictEqual(screens[0].disabledTargets, ["Continuar"]);
    });
    test("no gated controls yields an empty list, not undefined", () => {
        const screens = (0, mobile_knowledge_resolver_1.selectRelevantMobileKnowledge)({ items: [item({})] }, "código de validación correo", 5);
        node_assert_1.default.deepStrictEqual(screens[0].disabledTargets, []);
    });
});
describe("a gated control that the app renders as non-clickable", () => {
    // How this app actually paints a blocked button: enabled="false" AND clickable="false".
    // Recording `enabled` only for clickables skipped exactly this node, which is why every
    // capture came back with zero gate evidence.
    const GATED_NON_CLICKABLE = [
        "<hierarchy>",
        node("android.widget.TextView", { text: "Hola Nr2rc, valida tus datos", clickable: "false", heading: "true" }),
        node("android.view.ViewGroup", { "content-desc": "Enviar código de validación", clickable: "true", enabled: "true" }),
        node("android.view.ViewGroup", { "content-desc": "Continuar", clickable: "false", enabled: "false" }),
        "</hierarchy>",
    ].join("\n");
    const OPEN_CLICKABLE = GATED_NON_CLICKABLE
        .replace('content-desc="Continuar" clickable="false" enabled="false"', 'content-desc="Continuar" clickable="true" enabled="true"');
    test("records the disabled state even though the node is not clickable", () => {
        const cont = (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(GATED_NON_CLICKABLE).observedControls.find((c) => c.label === "Continuar");
        node_assert_1.default.strictEqual(cont?.enabled, false);
    });
    test("that gate makes the state distinguishable from the open one", () => {
        node_assert_1.default.notStrictEqual((0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(GATED_NON_CLICKABLE).fingerprint, (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(OPEN_CLICKABLE).fingerprint);
    });
    test("plain text keeps its enabled flag when the source states it", () => {
        const heading = (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(GATED_NON_CLICKABLE).observedControls.find((c) => c.label.startsWith("Hola"));
        node_assert_1.default.strictEqual(heading?.enabled, undefined);
    });
});
