"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const step_intent_classifier_1 = require("../src/plans/step-intent-classifier");
(0, test_1.test)("Ingresar cédula is fill", () => {
    (0, test_1.expect)((0, step_intent_classifier_1.classifyStepIntent)("Ingresar cédula")).toBe("fill");
});
(0, test_1.test)("Presionar consultar is click", () => {
    (0, test_1.expect)((0, step_intent_classifier_1.classifyStepIntent)("Presionar consultar")).toBe("click");
});
(0, test_1.test)("Validar resultado is assert", () => {
    (0, test_1.expect)((0, step_intent_classifier_1.classifyStepIntent)("Validar resultado")).toBe("assert");
});
(0, test_1.test)("Iniciar sesión is login", () => {
    (0, test_1.expect)((0, step_intent_classifier_1.classifyStepIntent)("Iniciar sesión")).toBe("login");
});
(0, test_1.test)("Esperar carga is wait", () => {
    (0, test_1.expect)((0, step_intent_classifier_1.classifyStepIntent)("Esperar carga")).toBe("wait");
});
(0, test_1.test)("ambiguous text is unknown", () => {
    (0, test_1.expect)((0, step_intent_classifier_1.classifyStepIntent)("Revisar algo")).toBe("unknown");
});
