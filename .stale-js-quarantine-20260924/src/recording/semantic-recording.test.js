"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const semantic_recording_1 = require("./semantic-recording");
const trace_to_scenario_1 = require("./trace-to-scenario");
function trace(overrides = {}) {
    return {
        recordingId: "recording-1",
        projectSlug: "web-project",
        appSlug: "web-project",
        platform: "web",
        baseUrl: "https://example.test",
        label: "Alta de colaborador",
        startedAt: new Date(0).toISOString(),
        status: "stopped",
        screens: [{
                screenKey: "screen-a",
                title: "Pantalla principal",
                fingerprint: "technical-fingerprint",
                url: "https://example.test/form",
                firstSeenAt: 0,
                controls: [],
                texts: [],
            }],
        events: [
            { seq: 0, t: 1, kind: "fill", screenKey: "screen-a", target: { label: "Nombre", role: "textbox", locators: [{ strategy: "aria-label", value: "Nombre" }] }, value: "Ana" },
            { seq: 1, t: 2, kind: "fill", screenKey: "screen-a", target: { label: "Contraseña", role: "textbox", sensitive: true, locators: [{ strategy: "aria-label", value: "Contraseña" }] }, redactedKey: "auth.password" },
            { seq: 2, t: 3, kind: "tap", screenKey: "screen-a", target: { label: "Selector", role: "combobox", locators: [{ strategy: "role", value: "combobox|Selector" }] } },
        ],
        ...overrides,
    };
}
(0, node_test_1.default)("derives semantic assets without rewriting the raw trace", () => {
    const input = trace();
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(input);
    strict_1.default.equal(input.events.length, 3);
    strict_1.default.equal(model.source, "SessionTrace");
    strict_1.default.equal(model.datasets[0].valueRole, "action_input");
    strict_1.default.equal(model.datasets[0].source, "RECORDED_CONFIRMED");
    strict_1.default.equal(model.datasets[1].valueRole, "secure_input");
    strict_1.default.equal(model.datasets[1].value, undefined);
    strict_1.default.equal(model.semanticEvents[2].controlAffordance, "selectable");
    strict_1.default.ok(model.technicalObservations.every((observation) => observation.status === "VALIDATED"));
});
(0, node_test_1.default)("never exposes a technical fingerprint as a semantic title", () => {
    const input = trace();
    input.screens[0].title = "screen-a-fingerprint";
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(input);
    strict_1.default.equal(model.semanticScreens[0].title, undefined);
});
(0, node_test_1.default)("keeps username as a normal action input while the web plan stays key-based", () => {
    const input = trace();
    input.events = [{
            seq: 0,
            t: 1,
            kind: "fill",
            screenKey: "screen-a",
            target: { label: "Nombre de usuario", role: "input", locators: [{ strategy: "aria-label", value: "Nombre de usuario" }] },
            value: "should-not-appear",
        }];
    const scenario = (0, trace_to_scenario_1.buildHappyPathScenario)(input, input.events);
    strict_1.default.equal(scenario.webSteps[1]?.value, undefined);
    strict_1.default.equal(scenario.webSteps[1]?.valueKey, "nombre_de_usuario");
    strict_1.default.equal(scenario.requiredData[0]?.sensitive, false);
    strict_1.default.equal(scenario.requiredData[0]?.valueRole, "action_input");
    strict_1.default.equal(scenario.testRailSteps[1]?.stepTemplate, "Ingresar [nombre_de_usuario] en \"Nombre de usuario\"");
    strict_1.default.equal(scenario.testRailSteps[1]?.renderedStep, 'Ingresar "should-not-appear" en "Nombre de usuario"');
});
(0, node_test_1.default)("materializes QA password under the invariant recording policy", () => {
    const input = trace({
        recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: false, includeQaCredentialsInTestRail: false },
        events: [{
                seq: 0,
                t: 1,
                kind: "fill",
                screenKey: "screen-a",
                target: { label: "Contraseña", role: "input", inputType: "password", locators: [{ strategy: "aria-label", value: "Contraseña" }] },
                value: "secret-value",
            }],
    });
    const allowedScenario = (0, trace_to_scenario_1.buildHappyPathScenario)(input, input.events);
    strict_1.default.equal(allowedScenario.testRailSteps[1]?.sensitive, true);
    strict_1.default.equal(allowedScenario.requiredData[0]?.exampleValue, "secret-value");
    strict_1.default.equal(allowedScenario.testRailSteps[1]?.renderedStep, 'Ingresar "secret-value" en "Contraseña"');
    const edited = (0, trace_to_scenario_1.materializeRecordedScenario)(allowedScenario, { [allowedScenario.testRailSteps[1]?.valueKey ?? ""]: "edited-value" });
    strict_1.default.equal(edited.testRailSteps[1]?.stepTemplate, allowedScenario.testRailSteps[1]?.stepTemplate);
    strict_1.default.equal(edited.testRailSteps[1]?.renderedStep, 'Ingresar "edited-value" en "Contraseña"');
});
(0, node_test_1.default)("rejects format masks and generic labels as durable semantic fields", () => {
    strict_1.default.equal((0, semantic_recording_1.detectFormatMask)("000-0000000-0"), true);
    strict_1.default.equal((0, semantic_recording_1.detectFormatMask)("dd/mm/yyyy"), true);
    for (const label of ["000-0000000-0", "Indicar...", "campo"]) {
        const resolution = (0, semantic_recording_1.resolveRecordedField)({ label, role: "input", inputType: "text", locators: [] });
        strict_1.default.equal(resolution.semanticField, null);
        strict_1.default.equal(resolution.needsReview, true);
    }
});
(0, node_test_1.default)("structural header association outranks a format placeholder", () => {
    const resolution = (0, semantic_recording_1.resolveRecordedField)({
        label: "000-000-0000",
        placeholder: "000-000-0000",
        headerContext: "Teléfono del colaborador",
        role: "input",
        locators: [],
    });
    strict_1.default.equal(resolution.semanticField, "Teléfono del colaborador");
    strict_1.default.equal(resolution.needsReview, false);
    strict_1.default.equal(resolution.formatHint, "000-000-0000");
});
(0, node_test_1.default)("unresolved values remain preserved and primary wording stays functional", () => {
    const input = trace({
        recordingGoal: { declaredGoal: "Agregar varios colaboradores", normalizedGoal: "Agregar varios colaboradores", provenance: "USER_DECLARED", needsReview: false },
        events: [{
                seq: 0,
                t: 1,
                kind: "fill",
                screenKey: "screen-a",
                target: { label: "Indicar...", role: "input", locators: [] },
                value: "calidad@test.com.do",
            }],
    });
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(input);
    const field = model.datasets[0];
    strict_1.default.equal(field.semanticField, null);
    strict_1.default.equal(field.value, "calidad@test.com.do");
    strict_1.default.equal(field.needsReview, true);
    const scenario = (0, trace_to_scenario_1.buildHappyPathScenario)(input, input.events);
    strict_1.default.match(scenario.description, /Agregar varios colaboradores/);
    strict_1.default.doesNotMatch(scenario.description, /screen-a|pantalla 1|fingerprint/);
    strict_1.default.match(scenario.testRailSteps.at(-1)?.renderedStep ?? "", /calidad@test.com.do/);
    strict_1.default.match(scenario.testRailSteps.at(-1)?.renderedStep ?? "", /Campo pendiente de identificar/);
});
(0, node_test_1.default)("maps compound children only from shared row structure", () => {
    const input = trace({
        events: [
            { seq: 0, t: 1, kind: "tap", screenKey: "screen-a", target: { label: "Moneda", role: "combobox", rowIdentity: "row-1", locators: [{ strategy: "role", value: "combobox|Moneda" }] } },
            { seq: 1, t: 2, kind: "fill", screenKey: "screen-a", target: { label: "campo", role: "input", rowIdentity: "row-1", headerContext: "Monto", locators: [{ strategy: "css", value: "#amount" }] }, value: "1500" },
        ],
    });
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(input);
    const compound = model.semanticComponents.find((component) => component.compoundField);
    strict_1.default.ok(compound);
    strict_1.default.equal(compound?.children?.length, 2);
    strict_1.default.equal(compound?.children?.[1]?.affordance, "editable");
});
(0, node_test_1.default)("does not split an aggregate compound display value without child evidence", () => {
    const input = trace({
        events: [{
                seq: 0,
                t: 1,
                kind: "fill",
                screenKey: "screen-a",
                target: { label: "campo", role: "input", rowIdentity: "row-1", associatedField: "Ingresos", locators: [] },
                value: "DOP 1,5000",
            }],
    });
    strict_1.default.equal((0, semantic_recording_1.aggregateTextUsedAsValue)(input.events[0]), true);
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(input);
    strict_1.default.equal(model.datasets.length, 1);
    strict_1.default.equal(model.datasets[0]?.value, "DOP 1,5000");
    strict_1.default.equal(model.datasets[0]?.needsReview, true);
    strict_1.default.match(model.datasets[0]?.reviewReason ?? "", /aggregate_compound/);
});
(0, node_test_1.default)("preserves selection and amount as two datasets when two controls are observed", () => {
    const input = trace({
        events: [
            { seq: 0, t: 1, kind: "tap", screenKey: "screen-a", target: { label: "DOP", role: "option", rowIdentity: "row-1", associatedField: "Ingresos", afterValue: "DOP", locators: [{ strategy: "text", value: "DOP" }] } },
            { seq: 1, t: 2, kind: "fill", screenKey: "screen-a", target: { label: "campo", role: "input", rowIdentity: "row-1", associatedField: "Ingresos", locators: [{ strategy: "css", value: "#amount" }] }, value: "1500" },
        ],
    });
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(input);
    strict_1.default.deepEqual(model.datasets.map((item) => item.value), ["DOP", "1500"]);
    const scenario = (0, trace_to_scenario_1.buildHappyPathScenario)(input, input.events);
    strict_1.default.match(scenario.testRailSteps.map((step) => step.renderedStep ?? "").join(" | "), /DOP/);
    strict_1.default.match(scenario.testRailSteps.map((step) => step.renderedStep ?? "").join(" | "), /1500/);
});
(0, node_test_1.default)("materializes the V1 compound roles and technical state separately", () => {
    const input = trace({
        events: [
            {
                seq: 0,
                t: 1,
                kind: "tap",
                screenKey: "screen-a",
                target: {
                    label: "USD",
                    role: "option",
                    interactionType: "select",
                    compoundRole: "selection",
                    associatedField: "Ingresos",
                    cellRef: "cell:1:ingresos",
                    rowRef: "row:1",
                    headerRef: "header:Ingresos",
                    afterValue: "USD",
                    dynamicLifecycle: { selectedOption: "USD", options: ["USD", "DOP"], observationWindowMs: 180 },
                    locators: [{ strategy: "text", value: "USD" }],
                },
            },
            {
                seq: 1,
                t: 2,
                kind: "fill",
                screenKey: "screen-a",
                target: {
                    label: "campo",
                    role: "input",
                    compoundRole: "amount_or_text",
                    associatedField: "Ingresos",
                    cellRef: "cell:1:ingresos",
                    rowRef: "row:1",
                    headerRef: "header:Ingresos",
                    beforeState: { value: "" },
                    afterState: { value: "1500" },
                    locators: [{ strategy: "css", value: "#amount" }],
                },
                value: "1500",
            },
        ],
    });
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(input);
    strict_1.default.deepEqual(model.datasets.map((item) => item.valueKey).sort(), ["ingresos_seleccion", "ingresos_valor"]);
    strict_1.default.equal(model.semanticEvents[0]?.action, "select");
    strict_1.default.equal(model.technicalObservations[0]?.cellRef, "cell:1:ingresos");
    const compound = model.semanticComponents.find((component) => component.compoundField);
    strict_1.default.deepEqual(compound?.children?.map((child) => child.semanticRole), ["selection", "amount_or_text"]);
    strict_1.default.equal(compound?.children?.[0]?.valueKey, "ingresos_seleccion");
    strict_1.default.equal(compound?.children?.[1]?.valueKey, "ingresos_valor");
});
(0, node_test_1.default)("propagates a child beforeinput buffer instead of the compound display", () => {
    const input = trace({
        events: [{
                seq: 0,
                t: 1,
                kind: "fill",
                screenKey: "screen-a",
                target: {
                    label: "display",
                    role: "input",
                    compoundRole: "amount_or_text",
                    associatedField: "Compound",
                    rowRef: "row-a",
                    cellRef: "cell-a",
                    eventTargetRef: "child-input",
                    currentTargetRef: "compound-parent",
                    deepestEditableTargetRef: "child-input",
                    inputEventData: ["5", "5", "0", "0", "0"],
                    inputTypes: ["insertText", "insertText", "insertText", "insertText", "insertText"],
                    displayValue: "Option 55,000",
                    committedValue: "Option 55,000",
                    technicalTargetCandidates: [{
                            targetType: "structural",
                            semanticRole: "amount_or_text",
                            locatorCandidates: [{ strategy: "structural", value: "cell-a|amount_or_text" }],
                            structuralContext: { rowRef: "row-a", cellRef: "cell-a" },
                            interactionEvidence: ["event-1"],
                            confidence: 0.9,
                            validatedByInteraction: true,
                        }],
                    locators: [{ strategy: "structural", value: "cell-a" }],
                },
                value: "Option 55,000",
            }],
    });
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(input);
    strict_1.default.equal(model.datasets[0]?.value, "55000");
    strict_1.default.equal(model.datasets[0]?.displayValue, "Option 55,000");
});
(0, node_test_1.default)("stable component identity keeps sibling controls separate inside one container", () => {
    const input = trace({
        events: [
            { seq: 0, t: 1, kind: "fill", screenKey: "screen-a", target: { label: "RNC", role: "textbox", containerIdentity: "form", bounds: { x: 10, y: 20, width: 100, height: 20 }, locators: [{ strategy: "css", value: "#rnc" }] }, value: "1" },
            { seq: 1, t: 2, kind: "fill", screenKey: "screen-a", target: { label: "Usuario", role: "textbox", containerIdentity: "form", bounds: { x: 10, y: 60, width: 100, height: 20 }, locators: [{ strategy: "css", value: "#user" }] }, value: "u" },
            { seq: 2, t: 3, kind: "fill", screenKey: "screen-a", target: { label: "Clave", role: "textbox", containerIdentity: "form", bounds: { x: 10, y: 100, width: 100, height: 20 }, locators: [{ strategy: "css", value: "#password" }] }, value: "p" },
        ],
    });
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(input);
    const controls = model.semanticComponents.filter((component) => component.screenIdentity === "screen-a");
    strict_1.default.equal(new Set(controls.map((component) => component.componentId)).size, controls.length);
    strict_1.default.ok(controls.length >= 3);
});
