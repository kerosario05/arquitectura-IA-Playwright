"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const mobile_passthrough_screen_1 = require("./mobile-passthrough-screen");
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
function el(partial) {
    return {
        locator: { strategy: "accessibilityId", value: partial.label },
        ...partial,
    };
}
function screen(title, elements) {
    return {
        screenId: title.toLowerCase().replace(/\s+/g, "-"),
        title,
        elements,
        discoveredAt: "2026-09-02T00:00:00.000Z",
        discoverySource: "automated_discovery",
    };
}
describe("normalizeLabel / isContinueLabel", () => {
    test("strips accents and case", () => {
        node_assert_1.default.strictEqual((0, mobile_passthrough_screen_1.normalizeLabel)("Continúa!"), "continua");
        node_assert_1.default.strictEqual((0, mobile_passthrough_screen_1.normalizeLabel)("  SIGUIENTE  "), "siguiente");
    });
    test("recognizes accented and cased continue labels", () => {
        for (const label of ["Continuar", "continúa", "SIGUIENTE", "Entendido", "Comenzar", "Next"]) {
            node_assert_1.default.ok((0, mobile_passthrough_screen_1.isContinueLabel)(label), `should match: ${label}`);
        }
    });
    test("does not match unrelated labels", () => {
        for (const label of ["Cancelar", "Volver", "Cerrar sesión", "Reintentar", ""]) {
            node_assert_1.default.ok(!(0, mobile_passthrough_screen_1.isContinueLabel)(label), `should not match: ${label}`);
        }
    });
    test("does not match a label that merely contains the word inside another", () => {
        node_assert_1.default.ok(!(0, mobile_passthrough_screen_1.isContinueLabel)("discontinuar servicio"));
    });
});
describe("isPassthroughScreen", () => {
    test("single Continuar button qualifies", () => {
        const s = screen("Bienvenido", [
            el({ label: "Te damos la bienvenida", role: "text", locator: undefined }),
            el({ label: "Continuar", role: "button" }),
        ]);
        node_assert_1.default.ok((0, mobile_passthrough_screen_1.isPassthroughScreen)(s));
    });
    test("a screen with an input does NOT qualify", () => {
        const s = screen("Identificación", [
            el({ label: "Número de documento", role: "input" }),
            el({ label: "Continuar", role: "button" }),
        ]);
        node_assert_1.default.ok(!(0, mobile_passthrough_screen_1.isPassthroughScreen)(s), "an input means a real decision");
    });
    test("a screen with a toggle does NOT qualify", () => {
        const s = screen("Términos", [
            el({ label: "Acepto los términos", role: "toggle" }),
            el({ label: "Continuar", role: "button" }),
        ]);
        node_assert_1.default.ok(!(0, mobile_passthrough_screen_1.isPassthroughScreen)(s), "a consent toggle must be handled explicitly");
    });
    test("two actionable buttons do NOT qualify", () => {
        const s = screen("Confirmación", [
            el({ label: "Continuar", role: "button" }),
            el({ label: "Cancelar", role: "button" }),
        ]);
        node_assert_1.default.ok(!(0, mobile_passthrough_screen_1.isPassthroughScreen)(s), "two options mean the user chooses");
    });
    test("a gated Continuar does NOT qualify", () => {
        const s = screen("Resumen", [
            el({ label: "Continuar", role: "button", gated: true, enabledWhen: ["scroll al final"] }),
        ]);
        node_assert_1.default.ok(!(0, mobile_passthrough_screen_1.isPassthroughScreen)(s), "gated control needs its gate satisfied first");
    });
    test("a single non-continue button does NOT qualify", () => {
        const s = screen("Error", [el({ label: "Reintentar", role: "button" })]);
        node_assert_1.default.ok(!(0, mobile_passthrough_screen_1.isPassthroughScreen)(s));
    });
    test("text-only screen (no actionable control) does NOT qualify", () => {
        const s = screen("Cargando", [el({ label: "Espere", role: "text", locator: undefined })]);
        node_assert_1.default.ok(!(0, mobile_passthrough_screen_1.isPassthroughScreen)(s));
    });
});
describe("buildPassthroughStep", () => {
    test("builds the click on the advance control", () => {
        const s = screen("Casi listo", [
            el({ label: "Ya casi terminamos", role: "text", locator: undefined }),
            el({ label: "Continuar", role: "button", locator: { strategy: "accessibilityId", value: "btn-continuar" } }),
        ]);
        const step = (0, mobile_passthrough_screen_1.buildPassthroughStep)(s);
        node_assert_1.default.ok(step);
        node_assert_1.default.strictEqual(step.action, "click");
        node_assert_1.default.deepStrictEqual(step.target, { strategy: "accessibilityId", value: "btn-continuar" });
        node_assert_1.default.match(step.description ?? "", /Casi listo/);
    });
    test("returns null for a non-passthrough screen", () => {
        const s = screen("Login", [el({ label: "Usuario", role: "input" }), el({ label: "Continuar", role: "button" })]);
        node_assert_1.default.strictEqual((0, mobile_passthrough_screen_1.buildPassthroughStep)(s), null);
    });
});
describe("withPassthroughSteps", () => {
    test("appends the advance for each passthrough screen crossed", () => {
        const entry = [
            { action: "click", target: { strategy: "accessibilityId", value: "Registrarme" } },
        ];
        const screens = [
            screen("Bienvenida", [el({ label: "Continuar", role: "button", locator: { strategy: "accessibilityId", value: "c1" } })]),
            screen("Aviso legal", [el({ label: "Entendido", role: "button", locator: { strategy: "accessibilityId", value: "c2" } })]),
        ];
        const out = (0, mobile_passthrough_screen_1.withPassthroughSteps)(entry, screens);
        node_assert_1.default.strictEqual(out.length, 3);
        node_assert_1.default.deepStrictEqual(out.map((s) => s.target?.value), ["Registrarme", "c1", "c2"]);
    });
    test("does not duplicate a control the flow already handles explicitly", () => {
        const entry = [
            { action: "click", target: { strategy: "accessibilityId", value: "c1" } },
        ];
        const screens = [
            screen("Bienvenida", [el({ label: "Continuar", role: "button", locator: { strategy: "accessibilityId", value: "c1" } })]),
        ];
        const out = (0, mobile_passthrough_screen_1.withPassthroughSteps)(entry, screens);
        node_assert_1.default.strictEqual(out.length, 1, "explicit step wins over the inferred advance");
    });
    test("ignores screens that are not passthrough", () => {
        const entry = [];
        const screens = [screen("Identificación", [el({ label: "Documento", role: "input" }), el({ label: "Continuar", role: "button" })])];
        node_assert_1.default.strictEqual((0, mobile_passthrough_screen_1.withPassthroughSteps)(entry, screens).length, 0);
    });
});
describe("consent rows are not advance controls", () => {
    test("a long consent sentence is never treated as Continuar", () => {
        // Regression: "acepto" used to be an advance label matched by prefix, so a walk tapped
        // the terms checkbox row instead of the real button and never left the screen.
        const consent = ", Acepto los Términos y condiciones y la Política de datos personales";
        node_assert_1.default.ok(!(0, mobile_passthrough_screen_1.isContinueLabel)(consent), "consent row must not read as an advance control");
    });
    test("punctuation around a real advance label is still tolerated", () => {
        node_assert_1.default.ok((0, mobile_passthrough_screen_1.isContinueLabel)(", Continuar"));
        node_assert_1.default.ok((0, mobile_passthrough_screen_1.isContinueLabel)("Continuar "));
    });
    test("a sentence merely starting with an advance verb is not a button", () => {
        node_assert_1.default.ok(!(0, mobile_passthrough_screen_1.isContinueLabel)("Continuar significa que aceptas el contrato"));
    });
});
