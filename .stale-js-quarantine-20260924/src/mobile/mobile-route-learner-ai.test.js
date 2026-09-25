"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const mobile_route_learner_ai_1 = require("./mobile-route-learner-ai");
const mobile_route_learner_1 = require("./mobile-route-learner");
const mobile_knowledge_extractor_1 = require("./mobile-knowledge-extractor");
function test(label, fn) {
    promises.push(fn().then(() => console.log(`  PASS  ${label}`), (err) => {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }));
}
const promises = [];
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
const PKG = "com.appconversacionalbsc";
function node(attrs) {
    const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
    return `<android.view.ViewGroup ${a} />`;
}
/**
 * The app's real welcome screen: a login form (user + password) plus the control that leaves
 * it towards registration. This is the screen the walk used to get stuck on.
 */
const BIENVENIDO_XML = `<?xml version="1.0" encoding="UTF-8"?><hierarchy>` +
    [
        `<android.widget.TextView package="${PKG}" class="android.widget.TextView" text="Bienvenido" displayed="true" clickable="false" />`,
        `<android.widget.EditText package="${PKG}" class="android.widget.EditText" text="example@gmail.com" displayed="true" clickable="true" />`,
        `<android.widget.EditText package="${PKG}" class="android.widget.EditText" text="Contraseña" displayed="true" clickable="true" />`,
        node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Acceso biométrico", clickable: "true", enabled: "true", displayed: "true" }),
        node({ package: PKG, class: "android.view.ViewGroup", "content-desc": ", ¿Primera vez aquí?, Crea tu cuenta en minutos, ", clickable: "true", enabled: "true", displayed: "true" }),
    ].join("") +
    `</hierarchy>`;
const snapshot = (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(BIENVENIDO_XML);
/** The catalog index the layer will show the AI for a given control label. */
function indexOfControl(snap, labelPart) {
    const i = (0, mobile_route_learner_1.findActionableControls)(snap, PKG).findIndex((a) => a.label.includes(labelPart));
    node_assert_1.default.ok(i >= 0, `fixture must expose an actionable control matching "${labelPart}"`);
    return i;
}
/** Records what the layer asked, and answers with a canned JSON payload. */
function fakeAi(reply) {
    const seen = [];
    return {
        seen,
        provider: {
            providerType: "openai",
            providerName: "fake",
            model: "fake-model",
            async completeJson(request) {
                seen.push(request);
                return {
                    rawText: JSON.stringify(reply),
                    parsedJson: reply,
                    model: "fake-model",
                    providerName: "fake",
                    durationMs: 0,
                };
            },
        },
    };
}
const HU_REGISTRO = {
    issueKey: "AA-93",
    summary: "Registro de nuevo cliente desde la app",
    intent: "El cliente sin cuenta se registra ingresando su cédula",
};
describe("decideNextActionInterpreted on a form screen (needs_input)", () => {
    test("asks the AI instead of blindly filling the form", async () => {
        const { provider, seen } = fakeAi({ action: "tap", controlIndex: 0 });
        await (0, mobile_route_learner_ai_1.decideNextActionInterpreted)(snapshot, { appPackage: PKG }, { ai: provider, huContext: HU_REGISTRO });
        node_assert_1.default.strictEqual(seen.length, 1, "the AI must be consulted on a needs_input stop");
        const prompt = seen[0].messages.map((m) => m.content).join("\n");
        node_assert_1.default.ok(prompt.includes("Registro de nuevo cliente"), "the HU objective must reach the prompt");
        node_assert_1.default.ok(prompt.includes("Crea tu cuenta en minutos"), "the way out of the form must be offered");
        node_assert_1.default.ok(prompt.includes('"fill"'), "fill must be offered as an answer on a form screen");
    });
    test("a registration story leaves the login screen instead of typing credentials", async () => {
        const { provider } = fakeAi({ action: "tap", controlIndex: indexOfControl(snapshot, "Crea tu cuenta en minutos") });
        const d = await (0, mobile_route_learner_ai_1.decideNextActionInterpreted)(snapshot, { appPackage: PKG }, { ai: provider, huContext: HU_REGISTRO });
        node_assert_1.default.strictEqual(d.kind, "advance");
        node_assert_1.default.ok(d.kind === "advance" && d.target.value.includes("Crea tu cuenta en minutos"), `expected the sign-up control, got ${d.kind === "advance" ? d.target.value : "(stop)"}`);
    });
    test("when the form IS the objective, the fill path is handed back untouched", async () => {
        const { provider } = fakeAi({ action: "fill", reason: "el formulario pertenece al objetivo" });
        const d = await (0, mobile_route_learner_ai_1.decideNextActionInterpreted)(snapshot, { appPackage: PKG }, { ai: provider, huContext: HU_REGISTRO });
        node_assert_1.default.strictEqual(d.kind, "stop");
        node_assert_1.default.strictEqual(d.kind === "stop" && d.reason, "needs_input", "the runner's fill path must still run");
    });
    test("an AI stop on a form falls back to filling rather than ending the walk", async () => {
        const { provider } = fakeAi({ action: "stop", reason: "nada acerca al objetivo" });
        const d = await (0, mobile_route_learner_ai_1.decideNextActionInterpreted)(snapshot, { appPackage: PKG }, { ai: provider, huContext: HU_REGISTRO });
        node_assert_1.default.strictEqual(d.kind === "stop" && d.reason, "needs_input");
    });
    test("never presses a control that commits the flow", async () => {
        const commitXml = `<?xml version="1.0" encoding="UTF-8"?><hierarchy>` +
            `<android.widget.EditText package="${PKG}" class="android.widget.EditText" text="Cédula" displayed="true" clickable="true" />` +
            node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Registrarme", clickable: "true", enabled: "true", displayed: "true" }) +
            `</hierarchy>`;
        const commitSnap = (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(commitXml);
        const { provider } = fakeAi({ action: "tap", controlIndex: indexOfControl(commitSnap, "Registrarme") });
        const d = await (0, mobile_route_learner_ai_1.decideNextActionInterpreted)(commitSnap, { appPackage: PKG }, { ai: provider, huContext: HU_REGISTRO });
        node_assert_1.default.notStrictEqual(d.kind, "advance", "the submit guard must outrank the AI's choice");
    });
    test("without an AI provider the rule-based decision is unchanged", async () => {
        const d = await (0, mobile_route_learner_ai_1.decideNextActionInterpreted)(snapshot, { appPackage: PKG }, {});
        node_assert_1.default.strictEqual(d.kind === "stop" && d.reason, "needs_input");
    });
});
// No top-level await: this file is transpiled to CJS.
void Promise.all(promises).then(() => {
    console.log(`\n${promises.length} checks, ${process.exitCode ? "FAILED" : "all passed"}`);
});
// ── deriveTriggerKeywords ────────────────────────────────────────────────────
const mobile_route_learning_runner_1 = require("../server/jobs/mobile-route-learning-runner");
function syncTest(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
describe("deriveTriggerKeywords", () => {
    syncTest("an issue key alone is replaced by the story's own words", () => {
        const kws = (0, mobile_route_learning_runner_1.deriveTriggerKeywords)(["AA-93"], HU_REGISTRO, "aa-93");
        node_assert_1.default.ok(!kws.includes("AA-93"), "the Jira key can never appear in scenario text");
        node_assert_1.default.ok(kws.includes("registro"), `expected "registro" among ${JSON.stringify(kws)}`);
    });
    syncTest("real keywords from the caller are kept as given", () => {
        const kws = (0, mobile_route_learning_runner_1.deriveTriggerKeywords)(["registro", "crea tu cuenta"], HU_REGISTRO, "aa-93");
        node_assert_1.default.deepStrictEqual(kws, ["registro", "crea tu cuenta"]);
    });
    syncTest("generic words are dropped so unrelated stories are not hijacked", () => {
        const kws = (0, mobile_route_learning_runner_1.deriveTriggerKeywords)(["AA-93"], HU_REGISTRO, "aa-93");
        node_assert_1.default.ok(!kws.includes("cliente"), `"cliente" is too generic: ${JSON.stringify(kws)}`);
    });
    syncTest("an issue-key flowId is never used as a last-resort keyword", () => {
        node_assert_1.default.deepStrictEqual((0, mobile_route_learning_runner_1.deriveTriggerKeywords)([], undefined, "AA-93"), []);
    });
    syncTest("a meaningful flowId still serves as the last resort", () => {
        node_assert_1.default.deepStrictEqual((0, mobile_route_learning_runner_1.deriveTriggerKeywords)(undefined, undefined, "registro"), ["registro"]);
    });
});
// ── buildLearnedScreens ──────────────────────────────────────────────────────
const mobile_route_learning_runner_2 = require("../server/jobs/mobile-route-learning-runner");
describe("buildLearnedScreens", () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?><hierarchy>` +
        node({ package: PKG, class: "android.view.ViewGroup", "content-desc": ", Cédula", clickable: "true", enabled: "true", displayed: "true" }) +
        `<android.widget.EditText package="${PKG}" class="android.widget.EditText" text="402-12345678-9" displayed="true" clickable="true" />` +
        `</hierarchy>`;
    syncTest("publishes the locator the learner derived, not the bare label", () => {
        const screens = (0, mobile_route_learning_runner_2.buildLearnedScreens)([(0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(docXml)], PKG, "2026-01-01T00:00:00Z");
        const els = Object.values(screens).flatMap((s) => s.elements);
        const cedula = els.find((e) => e.label.includes("Cédula"));
        node_assert_1.default.ok(cedula, `no se publicó el control Cédula: ${JSON.stringify(els.map((e) => e.label))}`);
        node_assert_1.default.notStrictEqual(cedula.locator?.value, "Cédula", "publicar la etiqueta pelada es justo lo que la IA inventaba");
        node_assert_1.default.ok(cedula.locator?.value.includes("Cédula"), `el locator debe anclar en la identidad observada: ${JSON.stringify(cedula.locator)}`);
    });
    syncTest("publishes inputs with their positional locator", () => {
        const screens = (0, mobile_route_learning_runner_2.buildLearnedScreens)([(0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(docXml)], PKG, "2026-01-01T00:00:00Z");
        const input = Object.values(screens).flatMap((s) => s.elements).find((e) => e.role === "input");
        node_assert_1.default.ok(input, "el campo de documento debe publicarse");
        node_assert_1.default.ok(input.locator?.value.includes("EditText"), JSON.stringify(input.locator));
    });
    syncTest("distinct screens sharing a screenKey do not overwrite each other", () => {
        const otherXml = `<?xml version="1.0" encoding="UTF-8"?><hierarchy>` +
            node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Continuar", clickable: "true", enabled: "true", displayed: "true" }) +
            `</hierarchy>`;
        const screens = (0, mobile_route_learning_runner_2.buildLearnedScreens)([(0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(docXml), (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(otherXml)], PKG, "2026-01-01T00:00:00Z");
        node_assert_1.default.strictEqual(Object.keys(screens).length, 2, `se colapsaron: ${JSON.stringify(Object.keys(screens))}`);
    });
    syncTest("the same screen seen twice is captured once", () => {
        const screens = (0, mobile_route_learning_runner_2.buildLearnedScreens)([(0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(docXml), (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(docXml)], PKG, "2026-01-01T00:00:00Z");
        node_assert_1.default.strictEqual(Object.keys(screens).length, 1, JSON.stringify(Object.keys(screens)));
    });
});
// ── fieldAlreadyHolds ────────────────────────────────────────────────────────
const mobile_route_learning_runner_3 = require("../server/jobs/mobile-route-learning-runner");
describe("fieldAlreadyHolds", () => {
    syncTest("a masked rendering of the typed value counts as already present", () => {
        // The app displays "40229993734" back as "402-2999373-4"; retyping it duplicated the step.
        node_assert_1.default.strictEqual((0, mobile_route_learning_runner_3.fieldAlreadyHolds)({ label: "402-2999373-4", value: "40229993734" }), true);
        node_assert_1.default.strictEqual((0, mobile_route_learning_runner_3.fieldAlreadyHolds)({ label: "402-2999373-4", value: "402-2999373-4" }), true);
    });
    syncTest("a different value is still typed", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_runner_3.fieldAlreadyHolds)({ label: "402-2999373-4", value: "12345678901" }), false);
    });
    syncTest("a placeholder is not mistaken for content", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_runner_3.fieldAlreadyHolds)({ label: "402-12345678-9", value: "40229993734" }), false);
    });
    syncTest("an OTP is never considered already present", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_runner_3.fieldAlreadyHolds)({ label: "123456", value: "123456", otp: true }), false);
    });
    syncTest("an empty intended value is never skipped", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_runner_3.fieldAlreadyHolds)({ label: "", value: "" }), false);
    });
});
// ── allowSubmitLabels ────────────────────────────────────────────────────────
const mobile_route_learner_2 = require("./mobile-route-learner");
describe("allowSubmitLabels", () => {
    syncTest("a submit stays blocked when nothing was allowed", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learner_2.isBlockedSubmitLabel)("Enviar código de validación"), true);
        node_assert_1.default.strictEqual((0, mobile_route_learner_2.isBlockedSubmitLabel)("Registrarme"), true);
    });
    syncTest("only the named control is unblocked", () => {
        const allow = ["Enviar código de validación"];
        node_assert_1.default.strictEqual((0, mobile_route_learner_2.isBlockedSubmitLabel)("Enviar código de validación", allow), false);
        node_assert_1.default.strictEqual((0, mobile_route_learner_2.isBlockedSubmitLabel)("Registrarme", allow), true, "el resto del guard sigue en pie");
    });
    syncTest("matching ignores accents and case", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learner_2.isAllowedSubmit)("ENVIAR CODIGO DE VALIDACION", ["Enviar código de validación"]), true);
    });
    syncTest("a non-submit label is never reported as blocked", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learner_2.isBlockedSubmitLabel)("Continuar", ["Enviar código de validación"]), false);
    });
});
