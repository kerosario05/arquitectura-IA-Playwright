"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const trace_normalizer_1 = require("./trace-normalizer");
const canonical_recording_contract_1 = require("./canonical-recording-contract");
const trace_to_scenario_1 = require("./trace-to-scenario");
const trace_ai_enricher_1 = require("./trace-ai-enricher");
const scenario_to_testrail_1 = require("./scenario-to-testrail");
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
function ev(partial) {
    return {
        seq: 0,
        screenKey: "login",
        ...partial,
    };
}
function target(label, value = label, extra = {}) {
    return { label, locators: [{ strategy: "accessibilityId", value, confidence: 0.95 }], ...extra };
}
const TRACE = {
    recordingId: "aa11bb22-3333-4444-5555-666677778888",
    projectSlug: "banco-app",
    appSlug: "banco-app",
    platform: "android",
    appPackage: "com.bank.app",
    label: "Registro de usuario nuevo",
    startedAt: "2026-09-08T10:00:00.000Z",
    status: "stopped",
    events: [],
    screens: [
        { screenKey: "login", title: "Iniciar sesión", fingerprint: "f1", firstSeenAt: 0, controls: [], texts: ["Bienvenido"] },
        { screenKey: "otp", title: "Código de validación", fingerprint: "f2", firstSeenAt: 5000, controls: [], texts: ["Ingresa el código"] },
    ],
};
describe("normalizeEvents", () => {
    test("collapses a burst of per-character fills into the final value", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "fill", t: 100, target: target("Usuario"), value: "j" }),
            ev({ kind: "fill", t: 180, target: target("Usuario"), value: "ju" }),
            ev({ kind: "fill", t: 260, target: target("Usuario"), value: "juan" }),
        ]);
        node_assert_1.default.strictEqual(out.length, 1);
        node_assert_1.default.strictEqual(out[0].value, "juan");
    });
    test("retains one editing session with raw refs and intermediate values", () => {
        const raw = [
            ev({ seq: 0, kind: "note", t: 100, observationType: "before_input", target: { ...target("Puesto"), role: "input", associatedField: "Puesto", beforeState: { value: "" } } }),
            ev({ seq: 1, kind: "fill", t: 120, target: { ...target("Puesto"), role: "input", associatedField: "Puesto", inputValue: "a" }, value: "a" }),
            ev({ seq: 2, kind: "fill", t: 160, target: { ...target("Puesto"), role: "input", associatedField: "Puesto", inputValue: "analista" }, value: "analista" }),
            ev({ seq: 3, kind: "note", t: 200, observationType: "post_action", target: { ...target("Puesto"), role: "input", associatedField: "Puesto", afterState: { value: "analista" } } }),
        ];
        const sessions = (0, trace_normalizer_1.buildEditingSessions)(raw);
        const normalized = (0, trace_normalizer_1.normalizeEvents)(raw);
        node_assert_1.default.strictEqual(sessions.length, 1);
        node_assert_1.default.deepStrictEqual(sessions[0].intermediateValues, ["a"]);
        node_assert_1.default.strictEqual(sessions[0].finalValue, "analista");
        node_assert_1.default.deepStrictEqual(sessions[0].rawEventRefs, ["event-1", "event-2", "event-3", "event-4"]);
        node_assert_1.default.strictEqual(normalized.filter((event) => event.kind === "fill").length, 1);
        node_assert_1.default.strictEqual(normalized.find((event) => event.kind === "fill")?.value, "analista");
    });
    test("ignores live rendered row text when identifying a grid control", () => {
        const first = ev({
            kind: "fill",
            t: 100,
            target: {
                ...target("Indicar..."),
                role: "input",
                associatedField: "Puesto",
                headerContext: "Puesto",
                gridRef: "grid:table",
                rowRef: "row:cédula Indicar... 000-000-0000",
                cellRef: "cell:Puesto:row:cédula Indicar... 000-000-0000:320,415,167,55",
                bounds: { x: 396, y: 424, width: 150, height: 36 },
            },
            value: "a",
        });
        const afterRerender = ev({
            ...first,
            t: 200,
            target: {
                ...first.target,
                rowRef: "row:cédula YANET SORIANO RODRIGUEZ analista 000-000-0000",
                cellRef: "cell:Puesto:row:cédula YANET SORIANO RODRIGUEZ analista 000-000-0000:320,415,167,55",
            },
        });
        node_assert_1.default.strictEqual((0, trace_normalizer_1.stableControlIdentity)(first), (0, trace_normalizer_1.stableControlIdentity)(afterRerender));
    });
    test("uses the deepest editor value instead of a formatted compound parent", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({
                kind: "fill",
                t: 100,
                target: {
                    ...target("control"),
                    role: "input",
                    associatedField: "Ingresos",
                    compoundRole: "amount_or_text",
                    inputValue: "1500",
                    committedValue: "1500",
                    displayValue: "DOP 1,5000",
                    afterValue: "DOP 1,5000",
                },
                value: "DOP 1,5000",
            }),
        ]);
        node_assert_1.default.strictEqual(out[0].value, "1500");
        node_assert_1.default.strictEqual(out[0].target?.afterValue, "1500");
        node_assert_1.default.strictEqual(out[0].target?.displayValue, "DOP 1,5000");
    });
    test("promotes a dynamic option observation to one semantic selection", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({
                seq: 0,
                kind: "note",
                t: 100,
                observationType: "post_action",
                target: { ...target("DOP"), role: "option", compoundRole: "selection", associatedField: "Ingresos", afterValue: "DOP" },
            }),
            ev({
                seq: 1,
                kind: "tap",
                t: 120,
                target: { ...target("DOP"), role: "button", associatedField: "Ingresos", interactionType: "click" },
            }),
        ]);
        const selection = out.find((event) => event.kind === "tap");
        node_assert_1.default.strictEqual(selection?.target?.interactionType, "select");
        node_assert_1.default.strictEqual(selection?.target?.compoundRole, "selection");
        node_assert_1.default.strictEqual(selection?.target?.afterValue, "DOP");
    });
    test("bridges a portalized option to its structured grid trigger", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({
                kind: "note",
                t: 100,
                observationType: "pointer",
                target: {
                    label: "Indicar...",
                    locators: [],
                    interactionType: "click",
                    associatedField: "Tipo de ID",
                    gridRef: "grid:table",
                    rowRef: "row:2",
                    cellRef: "cell:Tipo de ID:row:2",
                },
            }),
            ev({
                kind: "tap",
                t: 120,
                target: {
                    label: "Indicar...",
                    locators: [],
                    interactionType: "click",
                    associatedField: "Tipo de ID",
                    gridRef: "grid:table",
                    rowRef: "row:2",
                    cellRef: "cell:Tipo de ID:row:2",
                },
            }),
            ev({
                kind: "note",
                t: 180,
                observationType: "pointer",
                target: {
                    label: "cédula",
                    locators: [],
                    interactionType: "select",
                    compoundRole: "selection",
                    afterValue: "cédula",
                    dynamicLifecycle: { selectedOption: "cédula", options: ["cédula"] },
                },
            }),
        ]);
        const selection = out.find((event) => event.kind === "tap" && event.target?.interactionType === "select");
        node_assert_1.default.strictEqual(selection?.target?.associatedField, "Tipo de ID");
        node_assert_1.default.strictEqual(selection?.target?.afterValue, "cédula");
        const canonical = (0, canonical_recording_contract_1.buildCanonicalInteractions)(out).find((interaction) => interaction.action === "select");
        node_assert_1.default.strictEqual(canonical?.semanticField, "Tipo de ID");
        node_assert_1.default.strictEqual(canonical?.recordedValue, "cédula");
    });
    test("keeps fills on different fields apart", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "fill", t: 100, target: target("Usuario"), value: "juan" }),
            ev({ kind: "fill", t: 200, target: target("Clave"), value: "1234" }),
        ]);
        node_assert_1.default.strictEqual(out.length, 2);
        node_assert_1.default.deepStrictEqual(out.filter((event) => event.kind === "fill").map((event) => event.value), ["juan", "1234"]);
    });
    test("committed value closes a masked session without leaking raw intermediate text", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "fill", t: 100, target: { ...target("000-000-0000"), associatedField: "Teléfono", role: "input", compoundRole: "amount_or_text", rawTypedValue: "prefijo829", inputValue: "829-000", committedValue: "829-000" }, value: "829-000" }),
        ]);
        node_assert_1.default.equal(out.find((event) => event.kind === "fill")?.value, "829-000");
    });
    test("mask activation remains technical evidence and is not a scenario action", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "tap", t: 100, target: { ...target("000-000-0000"), role: "button", associatedField: "Teléfono", placeholder: "000-000-0000" } }),
            ev({ kind: "note", t: 150, observationType: "post_action", target: { ...target("000-000-0000"), role: "button", associatedField: "Teléfono" } }),
            ev({ kind: "fill", t: 200, target: { ...target("000-000-0000"), role: "input", associatedField: "Teléfono", placeholder: "000-000-0000", compoundRole: "amount_or_text", committedValue: "829-000-0000" }, value: "829-000-0000" }),
        ]);
        const canonical = (0, canonical_recording_contract_1.buildCanonicalInteractions)(out);
        node_assert_1.default.equal(canonical.some((interaction) => interaction.action === "click" && interaction.description?.includes("000-000-0000")), false);
        node_assert_1.default.equal(canonical.some((interaction) => interaction.action === "fill"), true);
    });
    test("does not project the input focus tap as a second functional action", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "tap", t: 100, target: target("Usuario") }),
            ev({ kind: "fill", t: 150, target: target("Usuario"), value: "juan" }),
        ]);
        node_assert_1.default.deepStrictEqual(out.filter((event) => ["tap", "fill"].includes(event.kind)).map((event) => event.kind), ["fill"]);
    });
    test("drops a digitizer double-report on the same control", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "tap", t: 1000, target: target("Ingresar") }),
            ev({ kind: "tap", t: 1120, target: target("Ingresar") }),
        ]);
        node_assert_1.default.strictEqual(out.length, 1);
    });
    test("keeps a deliberate second press outside the debounce window", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "tap", t: 1000, target: target("Ingresar") }),
            ev({ kind: "tap", t: 3000, target: target("Ingresar") }),
        ]);
        node_assert_1.default.strictEqual(out.length, 2);
    });
    test("preserves the final snapshot and does not debounce a state-changing selection", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "fill", t: 100, target: { ...target("campo"), beforeState: { value: "" }, afterState: { value: "1" } }, value: "1" }),
            ev({ kind: "fill", t: 180, target: { ...target("campo"), beforeState: { value: "1" }, afterState: { value: "15" } }, value: "15" }),
            ev({ kind: "tap", t: 300, target: { ...target("USD"), interactionType: "select", afterValue: "USD", stateDelta: { ariaExpanded: true } } }),
            ev({ kind: "tap", t: 360, target: { ...target("USD"), interactionType: "select", afterValue: "USD", stateDelta: { ariaSelected: true } } }),
        ]);
        node_assert_1.default.equal(out.length, 3);
        node_assert_1.default.equal(out[0].value, "15");
        node_assert_1.default.equal(out[0].target?.afterState?.value, "15");
    });
    test("discards a screen_change that did not change the screen", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "screen_change", t: 500, screenKey: "login", toScreenKey: "login" }),
            ev({ kind: "screen_change", t: 900, screenKey: "login", toScreenKey: "otp" }),
        ]);
        node_assert_1.default.strictEqual(out.length, 1);
        node_assert_1.default.strictEqual(out[0].toScreenKey, "otp");
    });
    test("demotes an unlocatable tap to a note instead of a step", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "tap", t: 100, target: { label: "Bienvenido", locators: [] } }),
        ]);
        node_assert_1.default.strictEqual(out[0].kind, "note");
        node_assert_1.default.match(out[0].note ?? "", /Bienvenido/);
    });
    test("renumbers the surviving events contiguously", () => {
        const out = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "tap", t: 1000, target: target("A") }),
            ev({ kind: "tap", t: 1100, target: target("A") }),
            ev({ kind: "tap", t: 5000, target: target("B") }),
        ]);
        node_assert_1.default.deepStrictEqual(out.map((e) => e.seq), [0, 1]);
    });
});
describe("segmentTrace", () => {
    const events = (0, trace_normalizer_1.normalizeEvents)([
        ev({ kind: "fill", t: 100, screenKey: "login", target: target("Usuario"), value: "juan" }),
        ev({ kind: "tap", t: 900, screenKey: "login", target: target("Ingresar") }),
        ev({ kind: "screen_change", t: 1500, screenKey: "login", toScreenKey: "otp" }),
        ev({ kind: "fill", t: 4000, screenKey: "otp", target: target("Código"), value: "123456" }),
    ]);
    test("groups events by the screen they happened on", () => {
        const segments = (0, trace_normalizer_1.segmentTrace)(events, TRACE);
        node_assert_1.default.strictEqual(segments.length, 2);
        node_assert_1.default.strictEqual(segments[0].screenKey, "login");
        node_assert_1.default.strictEqual(segments[0].events.length, 3);
        node_assert_1.default.strictEqual(segments[1].screenKey, "otp");
    });
    test("records where a segment exits to", () => {
        const segments = (0, trace_normalizer_1.segmentTrace)(events, TRACE);
        node_assert_1.default.strictEqual(segments[0].exitsTo, "otp");
    });
    test("resolves the human title of each screen", () => {
        const segments = (0, trace_normalizer_1.segmentTrace)(events, TRACE);
        node_assert_1.default.strictEqual(segments[0].title, "Iniciar sesión");
    });
});
describe("buildHappyPathScenario", () => {
    const events = (0, trace_normalizer_1.normalizeEvents)([
        ev({ kind: "fill", t: 100, screenKey: "login", target: target("Usuario"), value: "juan" }),
        ev({ kind: "tap", t: 900, screenKey: "login", target: target("Ingresar") }),
        ev({ kind: "screen_change", t: 1500, screenKey: "login", toScreenKey: "otp" }),
    ]);
    const scenario = (0, trace_to_scenario_1.buildHappyPathScenario)(TRACE, events);
    test("opens the app before anything else", () => {
        node_assert_1.default.strictEqual(scenario.mobileSteps[0].action, "launchApp");
    });
    test("emits an executable step per real action, in order", () => {
        const actions = scenario.mobileSteps.map((s) => s.action);
        node_assert_1.default.deepStrictEqual(actions, ["launchApp", "fill", "click", "assertVisible"]);
    });
    test("carries the recorded locator into the step", () => {
        const fill = scenario.mobileSteps.find((s) => s.action === "fill");
        node_assert_1.default.deepStrictEqual(fill?.target, { strategy: "accessibilityId", value: "Usuario" });
        node_assert_1.default.strictEqual(fill?.value, "juan");
    });
    test("asserts the destination screen on every transition, not only at the end", () => {
        const assertion = scenario.mobileSteps.find((s) => s.action === "assertVisible");
        node_assert_1.default.match(assertion?.description ?? "", /Código de validación/);
    });
    test("exposes each typed field as editable required data without misclassifying username", () => {
        node_assert_1.default.strictEqual(scenario.requiredData.length, 1);
        node_assert_1.default.strictEqual(scenario.requiredData[0].key, "usuario");
        node_assert_1.default.strictEqual(scenario.requiredData[0].exampleValue, "juan");
        node_assert_1.default.strictEqual(scenario.requiredData[0].sensitive, false);
        node_assert_1.default.strictEqual(scenario.requiredData[0].valueRole, "action_input");
    });
    test("never puts a redacted value in the TestRail step text", () => {
        const redacted = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "fill", t: 100, target: target("Clave"), redactedKey: "clave" }),
        ]);
        const s = (0, trace_to_scenario_1.buildHappyPathScenario)(TRACE, redacted);
        const stepText = s.testRailSteps.map((x) => x.content).join(" ");
        node_assert_1.default.ok(!stepText.includes("undefined"));
        node_assert_1.default.match(s.testRailSteps[1].renderedStep ?? "", /Ingresar el valor seguro asociado a "Clave"/);
        node_assert_1.default.match(stepText, /Ingresar \[clave\] en "Clave"/);
        node_assert_1.default.strictEqual(s.requiredData[0].sensitive, true);
        node_assert_1.default.strictEqual(s.requiredData[0].exampleValue, undefined);
    });
    test("uses the recording label as the scenario title", () => {
        node_assert_1.default.strictEqual(scenario.title, "Registro de usuario nuevo");
    });
    test("does not add a tautological expectation to a fill action", () => {
        node_assert_1.default.ok(scenario.testRailSteps.length >= 4);
        const fillStep = scenario.testRailSteps.find((step) => step.classification === "FUNCTIONAL_ACTION" && step.valueKey === "usuario");
        node_assert_1.default.strictEqual(fillStep?.expected, "");
        node_assert_1.default.ok(scenario.testRailSteps.filter((step) => step.classification === "FUNCTIONAL_ASSERTION").every((step) => step.expected.trim().length > 0));
    });
    test("builds web plan steps instead of mobile ones for a web recording", () => {
        const webTrace = { ...TRACE, platform: "web", baseUrl: "https://app.test", appPackage: undefined };
        const s = (0, trace_to_scenario_1.buildHappyPathScenario)(webTrace, events);
        node_assert_1.default.strictEqual(s.mobileSteps.length, 0);
        node_assert_1.default.strictEqual(s.webSteps[0].action, "navigate");
        node_assert_1.default.strictEqual(s.webSteps[0].value, "https://app.test");
    });
    test("keeps a confirmed value in the human model when its technical locator is unavailable", () => {
        const webTrace = {
            ...TRACE,
            platform: "web",
            baseUrl: "https://app.test",
            appPackage: undefined,
            recordingDataPolicy: {
                persistRecordedValues: true,
                persistQaCredentials: false,
                includeQaCredentialsInTestRail: false,
            },
        };
        const s = (0, trace_to_scenario_1.buildHappyPathScenario)(webTrace, [
            ev({ kind: "fill", t: 100, target: { label: "Documento", role: "input", locators: [] }, value: "ABC123" }),
        ]);
        const field = s.requiredData[0];
        const humanStep = s.testRailSteps.at(-1);
        node_assert_1.default.equal(s.webSteps.length, 1);
        node_assert_1.default.equal(field.key, "documento");
        node_assert_1.default.equal(field.exampleValue, "ABC123");
        node_assert_1.default.equal(field.sensitive, false);
        node_assert_1.default.equal(humanStep?.stepTemplate, 'Ingresar [documento] en "Documento"');
        node_assert_1.default.equal(humanStep?.renderedStep, 'Ingresar "ABC123" en "Documento"');
        node_assert_1.default.equal(s.technicalReadiness, false);
    });
});
describe("buildGateNegatives", () => {
    const events = (0, trace_normalizer_1.normalizeEvents)([
        ev({ kind: "tap", t: 100, screenKey: "login", target: target("Usuario") }),
        ev({ kind: "tap", t: 900, screenKey: "login", target: target("Continuar", "Continuar", { enabled: false }) }),
    ]);
    const happy = (0, trace_to_scenario_1.buildHappyPathScenario)(TRACE, events);
    const negatives = (0, trace_to_scenario_1.buildGateNegatives)(TRACE, (0, trace_normalizer_1.segmentTrace)(events, TRACE), happy);
    test("derives one negative per control observed disabled", () => {
        node_assert_1.default.strictEqual(negatives.length, 1);
        node_assert_1.default.match(negatives[0].title, /Continuar/);
        node_assert_1.default.strictEqual(negatives[0].kind, "negative");
    });
    test("expects the gate to hold rather than the flow to advance", () => {
        const last = negatives[0].testRailSteps[negatives[0].testRailSteps.length - 1];
        node_assert_1.default.match(last.expected, /permanece deshabilitado/);
    });
    test("invents nothing when the recording saw no gate", () => {
        const clean = (0, trace_normalizer_1.normalizeEvents)([ev({ kind: "tap", t: 100, target: target("Ingresar") })]);
        const h = (0, trace_to_scenario_1.buildHappyPathScenario)(TRACE, clean);
        node_assert_1.default.deepStrictEqual((0, trace_to_scenario_1.buildGateNegatives)(TRACE, (0, trace_normalizer_1.segmentTrace)(clean, TRACE), h), []);
    });
});
describe("summarizeTrace", () => {
    test("counts actions, transitions and unusable taps separately", () => {
        const events = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "fill", t: 100, target: target("Usuario"), value: "juan" }),
            ev({ kind: "tap", t: 900, target: target("Ingresar") }),
            ev({ kind: "screen_change", t: 1500, screenKey: "login", toScreenKey: "otp" }),
            ev({ kind: "tap", t: 2000, target: { label: "", locators: [] } }),
        ]);
        const stats = (0, trace_normalizer_1.summarizeTrace)(events, TRACE);
        node_assert_1.default.strictEqual(stats.actions, 2);
        node_assert_1.default.strictEqual(stats.transitions, 1);
        node_assert_1.default.strictEqual(stats.unidentified, 1);
        node_assert_1.default.strictEqual(stats.screens, 2);
    });
    test("does not count recorder-only editor taps as functional actions", () => {
        const events = (0, trace_normalizer_1.normalizeEvents)([
            ev({ kind: "tap", t: 100, target: target("Indicar...") }),
            ev({ kind: "tap", t: 200, target: target("Seleccionar fila") }),
            ev({ kind: "tap", t: 300, target: target("Validar") }),
        ]);
        const stats = (0, trace_normalizer_1.summarizeTrace)(events, TRACE);
        node_assert_1.default.strictEqual(stats.actions, 1);
        node_assert_1.default.strictEqual(stats.taps, 1);
    });
});
// A two-screen walkthrough: the user identifies themselves, the app moves to the OTP screen,
// and they submit the code there.
const MULTI_SCREEN_EVENTS = (0, trace_normalizer_1.normalizeEvents)([
    ev({ kind: "fill", t: 100, screenKey: "login", target: target("Usuario"), value: "juan" }),
    ev({ kind: "tap", t: 900, screenKey: "login", target: target("Ingresar") }),
    ev({ kind: "screen_change", t: 1500, screenKey: "login", toScreenKey: "otp" }),
    ev({ kind: "fill", t: 6000, screenKey: "otp", target: target("Código"), value: "123456", redactedKey: "codigo" }),
    ev({ kind: "tap", t: 7000, screenKey: "otp", target: target("Validar") }),
]);
describe("buildSegmentScenarios", () => {
    const segments = (0, trace_normalizer_1.segmentTrace)(MULTI_SCREEN_EVENTS, TRACE);
    const happyPath = (0, trace_to_scenario_1.buildHappyPathScenario)(TRACE, MULTI_SCREEN_EVENTS);
    const scenarios = (0, trace_to_scenario_1.buildSegmentScenarios)(TRACE, MULTI_SCREEN_EVENTS, segments, happyPath);
    test("emits one scenario per block, excluding the last (that is the end-to-end run)", () => {
        node_assert_1.default.strictEqual(scenarios.length, 1);
        node_assert_1.default.strictEqual(scenarios[0].scope, "segment");
    });
    test("a block scenario is executable on its own: it keeps the steps that reach it", () => {
        const actions = scenarios[0].mobileSteps.map((s) => s.action);
        node_assert_1.default.deepStrictEqual(actions, ["launchApp", "fill", "click", "assertVisible"]);
    });
    test("every step of a block scenario was actually walked", () => {
        node_assert_1.default.strictEqual(scenarios[0].provenance, "observed");
    });
    test("stops short of the full flow, so it is not the end-to-end case renamed", () => {
        node_assert_1.default.ok(scenarios[0].testRailSteps.length < happyPath.testRailSteps.length);
    });
    test("a single-screen recording produces no block scenarios", () => {
        const single = (0, trace_normalizer_1.normalizeEvents)([ev({ kind: "tap", t: 100, screenKey: "login", target: target("Ingresar") })]);
        const path = (0, trace_to_scenario_1.buildHappyPathScenario)(TRACE, single);
        node_assert_1.default.deepStrictEqual((0, trace_to_scenario_1.buildSegmentScenarios)(TRACE, single, (0, trace_normalizer_1.segmentTrace)(single, TRACE), path), []);
    });
});
describe("buildAlternativePathScenarios", () => {
    // The login screen offered three controls; the walkthrough only pressed "Ingresar".
    const TRACE_WITH_CONTROLS = {
        ...TRACE,
        screens: [
            {
                ...TRACE.screens[0],
                controls: [
                    { label: "Ingresar", role: "button", locators: [{ strategy: "accessibilityId", value: "Ingresar" }] },
                    { label: "Crear cuenta", role: "button", locators: [{ strategy: "accessibilityId", value: "Crear cuenta" }] },
                    { label: "Olvidé mi clave", role: "button", locators: [{ strategy: "accessibilityId", value: "Olvidé mi clave" }] },
                    { label: "Continuar", role: "button", enabled: false, locators: [{ strategy: "accessibilityId", value: "Continuar" }] },
                ],
            },
            TRACE.screens[1],
        ],
    };
    const happyPath = (0, trace_to_scenario_1.buildHappyPathScenario)(TRACE_WITH_CONTROLS, MULTI_SCREEN_EVENTS);
    const scenarios = (0, trace_to_scenario_1.buildAlternativePathScenarios)(TRACE_WITH_CONTROLS, MULTI_SCREEN_EVENTS, happyPath);
    test("proposes the controls the walkthrough saw but never pressed", () => {
        node_assert_1.default.deepStrictEqual(scenarios.map((s) => s.title), ["Alternativa observada 1: Crear cuenta", "Alternativa observada 2: Olvidé mi clave"]);
    });
    test("skips a disabled control — that is a gate, not an alternative path", () => {
        node_assert_1.default.ok(!scenarios.some((s) => s.title.includes("Continuar")));
    });
    test("ends on the untaken control, reached by the steps that were walked", () => {
        const steps = scenarios[0].mobileSteps;
        node_assert_1.default.strictEqual(steps[0].action, "launchApp");
        node_assert_1.default.strictEqual(steps[steps.length - 1].action, "click");
        node_assert_1.default.deepStrictEqual(steps[steps.length - 1].target, {
            strategy: "accessibilityId",
            value: "Crear cuenta",
        });
    });
    test("is marked derived and leaves its expected result open", () => {
        node_assert_1.default.strictEqual(scenarios[0].provenance, "derived");
        node_assert_1.default.strictEqual(scenarios[0].hasUncertainSteps, true);
        node_assert_1.default.match(scenarios[0].testRailSteps[scenarios[0].testRailSteps.length - 1].expected, /Por confirmar/);
    });
});
describe("parseNegatives", () => {
    const transcript = 'Pantalla 1: Iniciar sesión\n  - El usuario presionó "Enviar código de validación"\n  Textos visibles: Continuar';
    test("keeps a negative anchored on something the recording saw", () => {
        const kept = (0, trace_ai_enricher_1.parseNegatives)([{ title: "Código incorrecto", basedOn: "Enviar código de validación", steps: [{ content: "x", expected: "y" }] }], transcript);
        node_assert_1.default.strictEqual(kept.length, 1);
        node_assert_1.default.strictEqual(kept[0].basedOn, "Enviar código de validación");
    });
    test("matches the anchor regardless of case and accents", () => {
        const kept = (0, trace_ai_enricher_1.parseNegatives)([{ title: "n", basedOn: "ENVIAR CODIGO DE VALIDACION", steps: [{ content: "x", expected: "y" }] }], transcript);
        node_assert_1.default.strictEqual(kept.length, 1);
    });
    test("discards a case invented around a control that is not there", () => {
        const kept = (0, trace_ai_enricher_1.parseNegatives)([{ title: "Reenviar", basedOn: "Reenviar código", steps: [{ content: "x", expected: "y" }] }], transcript);
        node_assert_1.default.deepStrictEqual(kept, []);
    });
    test("discards a negative with no anchor at all", () => {
        const kept = (0, trace_ai_enricher_1.parseNegatives)([{ title: "n", steps: [{ content: "x", expected: "y" }] }], transcript);
        node_assert_1.default.deepStrictEqual(kept, []);
    });
});
describe("stepTargets", () => {
    const events = (0, trace_normalizer_1.normalizeEvents)([
        ev({ kind: "fill", t: 100, screenKey: "login", target: target("Usuario"), value: "juan" }),
        ev({
            kind: "tap",
            t: 900,
            screenKey: "login",
            target: {
                label: "Enviar código de validación",
                locators: [
                    {
                        strategy: "androidUiAutomator",
                        value: 'new UiSelector().description("Enviar código de validación").instance(1)',
                        confidence: 0.5,
                        ambiguous: true,
                        matchIndex: 1,
                    },
                ],
            },
        }),
    ]);
    const scenario = (0, trace_to_scenario_1.buildHappyPathScenario)(TRACE, events);
    test("exposes the locator behind each executable step", () => {
        node_assert_1.default.deepStrictEqual(scenario.stepTargets.map((t) => [t.description, t.strategy]), [['Ingresar [usuario] en "Usuario"', "accessibilityId"], ['Presionar "Enviar código de validación"', "androidUiAutomator"]]);
    });
    test("points at the step it belongs to", () => {
        const tap = scenario.stepTargets[1];
        node_assert_1.default.strictEqual(scenario.mobileSteps[tap.stepIndex].action, "click");
        node_assert_1.default.strictEqual(scenario.mobileSteps[tap.stepIndex].target?.value, tap.value);
    });
    test("carries the ambiguity forward so a reviewer sees it", () => {
        node_assert_1.default.strictEqual(scenario.stepTargets[1].ambiguous, true);
        node_assert_1.default.strictEqual(scenario.hasUncertainSteps, true);
    });
});
describe("capTitle", () => {
    test("deja intacto un título normal", () => {
        node_assert_1.default.strictEqual((0, trace_to_scenario_1.capTitle)("Validar datos de contacto"), "Validar datos de contacto");
    });
    // Lo que rechazó TestRail: ":title es demasiado largo (250 caracteres como máximo)".
    test("recorta al límite que acepta TestRail", () => {
        const long = `Desde Pantalla: ${"etiqueta muy larga ".repeat(30)}`;
        const capped = (0, trace_to_scenario_1.capTitle)(long);
        node_assert_1.default.ok(capped.length <= 250);
        node_assert_1.default.ok(capped.endsWith("…"));
    });
    test("colapsa espacios para que el recorte no corte en un hueco", () => {
        node_assert_1.default.strictEqual((0, trace_to_scenario_1.capTitle)("  Dos   espacios  "), "Dos espacios");
    });
});
describe("toPublishableScenario", () => {
    const scenario = (0, trace_to_scenario_1.buildHappyPathScenario)(TRACE, MULTI_SCREEN_EVENTS);
    const publishable = (0, scenario_to_testrail_1.toPublishableScenario)(scenario, "banco-app", "aaccdbc7-1111-2222-3333-444455556666");
    test("conserva el resultado esperado de cada paso dentro del texto", () => {
        node_assert_1.default.ok(publishable.steps[0].includes("Esperado: La aplicación carga su pantalla inicial"));
    });
    test("usa la última expectativa como resultado global del caso", () => {
        const last = scenario.testRailSteps[scenario.testRailSteps.length - 1].expected;
        node_assert_1.default.strictEqual(publishable.expectedResult, last || "Resultado esperado por confirmar");
    });
    test("enlaza el caso con la grabación que lo originó", () => {
        node_assert_1.default.strictEqual(publishable.sourceIssueKey, "REC-AACCDBC7");
        node_assert_1.default.strictEqual(publishable.appSlug, "banco-app");
    });
    test("un escenario derivado no se marca como ejecutable", () => {
        const derived = { ...scenario, provenance: "derived" };
        node_assert_1.default.strictEqual((0, scenario_to_testrail_1.toPublishableScenario)(derived, "banco-app", "aaccdbc7").mcpExecutable, false);
        node_assert_1.default.strictEqual(publishable.mcpExecutable, true);
    });
});
