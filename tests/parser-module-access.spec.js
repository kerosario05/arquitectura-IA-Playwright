"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const step_intent_parser_1 = require("../src/discovery/step-intent-parser");
(0, test_1.test)("'Acceder al módulo \"Generar cartas\"' produces action target 'Generar cartas'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Acceder al módulo "Generar cartas".');
    (0, test_1.expect)(intents.length).toBeGreaterThan(0);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Generar cartas");
});
(0, test_1.test)("'Ingresar al módulo \"Pago de productos\"' produces action target 'Pago de productos'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Ingresar al módulo "Pago de productos".');
    (0, test_1.expect)(intents.length).toBeGreaterThan(0);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Pago de productos");
});
(0, test_1.test)("'Abrir el módulo \"Consulta de balance\"' produces action target 'Consulta de balance'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Abrir el módulo "Consulta de balance".');
    (0, test_1.expect)(intents.length).toBeGreaterThan(0);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Consulta de balance");
});
(0, test_1.test)("Module access steps are not classified as assertion targets", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Acceder al módulo "Generar cartas".');
    const classified = (0, step_intent_parser_1.classifyStepSet)(intents);
    (0, test_1.expect)(classified.assertionIntents.length).toBe(0);
    (0, test_1.expect)(classified.actionIntents.length).toBeGreaterThan(0);
});
(0, test_1.test)("C37869 parser includes 'Generar cartas' before 'Carta de referencia'", () => {
    const fullStep = 'Acceder al módulo "Generar cartas".Seleccionar "Carta de referencia".';
    const intents = (0, step_intent_parser_1.parseStepIntent)(fullStep);
    const actionTargets = intents.filter(i => i.actionTarget).map(i => i.actionTarget);
    (0, test_1.expect)(actionTargets).toContain("Generar cartas");
    (0, test_1.expect)(actionTargets).toContain("Carta de referencia");
    const generacionIndex = actionTargets.indexOf("Generar cartas");
    const cartaIndex = actionTargets.indexOf("Carta de referencia");
    (0, test_1.expect)(generacionIndex).toBeLessThan(cartaIndex);
});
(0, test_1.test)("Assertion 'Validar que se muestre la vista previa de la carta' remains assertion target", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Validar que se muestre la vista previa de la carta.');
    (0, test_1.expect)(intents.length).toBeGreaterThan(0);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
});
(0, test_1.test)("'Continuar.' as functional step is action target", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Continuar.');
    (0, test_1.expect)(intents.length).toBeGreaterThan(0);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Continuar");
});
(0, test_1.test)("'Acceder a \"Generar cartas\"' produces action target", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Acceder a "Generar cartas".');
    (0, test_1.expect)(intents.length).toBeGreaterThan(0);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Generar cartas");
});
(0, test_1.test)("'Ir al módulo \"Transacciones\"' produces action target", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Ir al módulo "Transacciones".');
    (0, test_1.expect)(intents.length).toBeGreaterThan(0);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Transacciones");
});
(0, test_1.test)("'Entrar a \"Configuración\"' produces action target", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)('Entrar a "Configuración".');
    (0, test_1.expect)(intents.length).toBeGreaterThan(0);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Configuración");
});
