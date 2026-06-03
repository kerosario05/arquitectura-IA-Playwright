"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const step_intent_parser_1 = require("../src/discovery/step-intent-parser");
(0, test_1.test)("parse 'Abrir Información de productos > Tarjetas > Tarjeta de Crédito' as navigation_path", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Abrir Información de productos > Tarjetas > Tarjeta de Crédito.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("navigation_path");
    (0, test_1.expect)(intents[0].path).toEqual(["Información de productos", "Tarjetas", "Tarjeta de Crédito"]);
});
(0, test_1.test)("parse 'Abrir A > B > C' as navigation_path", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Abrir A > B > C");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("navigation_path");
    (0, test_1.expect)(intents[0].path).toEqual(["A", "B", "C"]);
});
(0, test_1.test)("parse 'Ir a A / B / C' as navigation_path", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Ir a A / B / C");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("navigation_path");
    (0, test_1.expect)(intents[0].path).toEqual(["A", "B", "C"]);
});
(0, test_1.test)("parse 'Navegar a A -> B -> C' as navigation_path", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Navegar a A -> B -> C");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("navigation_path");
    (0, test_1.expect)(intents[0].path).toEqual(["A", "B", "C"]);
});
(0, test_1.test)("parse 'Acceder a Módulo de Productos > Tarjetas' as navigation_path", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Acceder a Módulo de Productos > Tarjetas.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("navigation_path");
    (0, test_1.expect)(intents[0].path).toEqual(["Módulo de Productos", "Tarjetas"]);
});
(0, test_1.test)("parse 'Desde el listado de tarjetas de crédito' as precondition_context", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Desde el listado de tarjetas de crédito.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("precondition_context");
    (0, test_1.expect)(intents[0].context).toBe("tarjetas de crédito");
    (0, test_1.expect)(intents[0].contextType).toContain("listado de");
});
(0, test_1.test)("parse 'Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta Crédito Visa Clásica'' as precondition + action", () => {
    const text = "Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta Crédito Visa Clásica'.";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(2);
    const precondition = intents.find((i) => i.type === "precondition_context");
    (0, test_1.expect)(precondition).toBeDefined();
    (0, test_1.expect)(precondition.context).toBe("tarjetas de crédito");
    const action = intents.find((i) => i.type === "action_select");
    (0, test_1.expect)(action).toBeDefined();
    (0, test_1.expect)(action.actionTarget).toBe("Tarjeta Crédito Visa Clásica");
});
(0, test_1.test)("parse 'Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta de Crédito Visa Platinum'' as precondition + action", () => {
    const text = "Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta de Crédito Visa Platinum'.";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(2);
    const precondition = intents.find((i) => i.type === "precondition_context");
    (0, test_1.expect)(precondition).toBeDefined();
    (0, test_1.expect)(precondition.context).toBe("tarjetas de crédito");
    const action = intents.find((i) => i.type === "action_select");
    (0, test_1.expect)(action).toBeDefined();
    (0, test_1.expect)(action.actionTarget).toBe("Tarjeta de Crédito Visa Platinum");
});
(0, test_1.test)("parse 'Clic en 'Solicitar'' as action_click", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en 'Solicitar'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Solicitar");
});
(0, test_1.test)("parse 'Seleccionar 'Tarjeta Crédito Visa Clásica'' as action_select", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Seleccionar 'Tarjeta Crédito Visa Clásica'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_select");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Tarjeta Crédito Visa Clásica");
});
(0, test_1.test)("parse 'Seleccionar una tarjeta, preferiblemente 'Tarjeta Crédito Visa Clásica'' as optional_action", () => {
    const text = "Seleccionar una tarjeta, preferiblemente 'Tarjeta Crédito Visa Clásica'.";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("optional_action");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Tarjeta Crédito Visa Clásica");
    (0, test_1.expect)(intents[0].isOptional).toBe(true);
});
(0, test_1.test)("parse 'Hacer clic en 'Solicitar'' as action_click", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Hacer clic en 'Solicitar'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Solicitar");
});
(0, test_1.test)("parse 'Presionar 'Continuar'' as action_click", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Presionar 'Continuar'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Continuar");
});
(0, test_1.test)("parse 'Validar listado de tarjetas de crédito' as assertion", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Validar listado de tarjetas de crédito.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
    (0, test_1.expect)(intents[0].actionTarget).toBe("listado de tarjetas de crédito");
});
(0, test_1.test)("parse 'Verificar que se muestra Visa Clásica' as assertion", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Verificar que se muestra Visa Clásica.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
    (0, test_1.expect)(intents[0].actionTarget).toBe("que se muestra Visa Clásica");
});
(0, test_1.test)("parse 'Comprobar saldo disponible' as assertion", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Comprobar saldo disponible.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
    (0, test_1.expect)(intents[0].actionTarget).toBe("saldo disponible");
});
(0, test_1.test)("does not classify actions as assertions", () => {
    const actions = [
        "Seleccionar 'Tarjeta Crédito Visa Clásica'.",
        "Clic en 'Solicitar'.",
        "Seleccionar una tarjeta, preferiblemente 'Visa Clásica'."
    ];
    for (const action of actions) {
        const intents = (0, step_intent_parser_1.parseStepIntent)(action);
        const hasAssertion = intents.some((i) => i.type === "assertion");
        (0, test_1.expect)(hasAssertion).toBe(false);
    }
});
(0, test_1.test)("does not classify preconditions as assertions", () => {
    const text = "Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta Crédito Visa Clásica'.";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    const hasAssertion = intents.some((i) => i.type === "assertion");
    (0, test_1.expect)(hasAssertion).toBe(false);
});
(0, test_1.test)("'Abrir URL del Kiosko' is classified as setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Abrir URL del Kiosko.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
    (0, test_1.expect)(intents[0].actionTarget).toBe("APP_BASE_URL");
});
(0, test_1.test)("classifyStepSet separates intents correctly", () => {
    const intents = [
        { type: "navigation_path", originalText: "Abrir A > B", normalizedText: "abrir a > b", path: ["A", "B"], priority: 10 },
        { type: "action_select", originalText: "Seleccionar 'X'", normalizedText: "seleccionar 'x'", actionTarget: "X", actionVerb: "seleccionar", priority: 5 },
        { type: "assertion", originalText: "Validar X", normalizedText: "validar x", actionTarget: "X", actionVerb: "validar", priority: 3 }
    ];
    const result = (0, step_intent_parser_1.classifyStepSet)(intents);
    (0, test_1.expect)(result.setupIntents.length).toBe(1);
    (0, test_1.expect)(result.setupIntents[0].type).toBe("navigation_path");
    (0, test_1.expect)(result.actionIntents.length).toBe(1);
    (0, test_1.expect)(result.actionIntents[0].type).toBe("action_select");
    (0, test_1.expect)(result.assertionIntents.length).toBe(1);
    (0, test_1.expect)(result.assertionIntents[0].type).toBe("assertion");
});
(0, test_1.test)("C37755 full scenario parsing", () => {
    const scenarioSteps = [
        "Abrir Información de productos > Tarjetas > Tarjeta de Crédito.",
        "Seleccionar una tarjeta, preferiblemente 'Tarjeta Crédito Visa Clásica'.",
        "Clic en 'Solicitar'."
    ];
    const allIntents = scenarioSteps.map((s) => (0, step_intent_parser_1.parseStepIntent)(s));
    const flat = allIntents.flat();
    const navigation = flat.find((i) => i.type === "navigation_path");
    (0, test_1.expect)(navigation).toBeDefined();
    (0, test_1.expect)(navigation.path).toEqual(["Información de productos", "Tarjetas", "Tarjeta de Crédito"]);
    const optional = flat.find((i) => i.type === "optional_action");
    (0, test_1.expect)(optional).toBeDefined();
    (0, test_1.expect)(optional.actionTarget).toBe("Tarjeta Crédito Visa Clásica");
    const click = flat.find((i) => i.type === "action_click");
    (0, test_1.expect)(click).toBeDefined();
    (0, test_1.expect)(click.actionTarget).toBe("Solicitar");
});
(0, test_1.test)("parse 'Escoger 'Opción A'' as action_select", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Escoger 'Opción A'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_select");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Opción A");
});
(0, test_1.test)("parse 'Elegir 'Opción B'' as action_select", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Elegir 'Opción B'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_select");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Opción B");
});
(0, test_1.test)("parse 'Ingresar '12345'' as action_fill", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Ingresar '12345'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("12345");
});
(0, test_1.test)("parse 'Clic en Iniciar' without quotes as action_click", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en Iniciar.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Iniciar");
});
(0, test_1.test)("parse 'Seleccionar Tarjeta de Crédito' without quotes as action_select", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Seleccionar Tarjeta de Crédito.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_select");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Tarjeta de Crédito");
});
(0, test_1.test)("does not hardcode Kiosko texts", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(path.join(__dirname, "../src/discovery/step-intent-parser.ts"), "utf-8");
    (0, test_1.expect)(content).not.toContain("Información de productos");
    (0, test_1.expect)(content).not.toContain("Tarjeta de Crédito");
    (0, test_1.expect)(content).not.toContain("Banco Santa Cruz");
    (0, test_1.expect)(content).not.toContain("Kiosko");
    (0, test_1.expect)(content).not.toContain("C37750");
    (0, test_1.expect)(content).not.toContain("tarjetas");
});
(0, test_1.test)("empty text returns empty array", () => {
    (0, test_1.expect)((0, step_intent_parser_1.parseStepIntent)("")).toEqual([]);
    (0, test_1.expect)((0, step_intent_parser_1.parseStepIntent)("   ")).toEqual([]);
});
(0, test_1.test)("unknown step returns unknown type", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Hacer algo completamente diferente.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("unknown");
});
(0, test_1.test)("multiple steps in one string separated by period", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en 'A'. Clic en 'B'.");
    (0, test_1.expect)(intents.length).toBe(2);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("A");
    (0, test_1.expect)(intents[1].type).toBe("action_click");
    (0, test_1.expect)(intents[1].actionTarget).toBe("B");
});
(0, test_1.test)("parse 'Tocar 'Menú'' as action_click", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Tocar 'Menú'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Menú");
});
(0, test_1.test)("divide 'Click en iniciarClick en Informacion de productos' into 2 intents", () => {
    const text = "Click en iniciarClick en Informacion de productos";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(2);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("iniciar");
    (0, test_1.expect)(intents[1].type).toBe("action_click");
    (0, test_1.expect)(intents[1].actionTarget).toBe("Informacion de productos");
});
(0, test_1.test)("divide múltiples Click pegados: 'Click en AClick en BClick en C'", () => {
    const text = "Click en AClick en BClick en C";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(3);
    (0, test_1.expect)(intents[0].actionTarget).toBe("A");
    (0, test_1.expect)(intents[1].actionTarget).toBe("B");
    (0, test_1.expect)(intents[2].actionTarget).toBe("C");
});
(0, test_1.test)("respeta target quoted: 'Click en AClick 'Tarjeta Crédito Visa Clásica''", () => {
    const text = "Click en AClick 'Tarjeta Crédito Visa Clásica'";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(2);
    (0, test_1.expect)(intents[0].actionTarget).toBe("A");
    (0, test_1.expect)(intents[1].actionTarget).toBe("Tarjeta Crédito Visa Clásica");
});
(0, test_1.test)("clasifica 'Opcional: validar botón 'Solicitar'' como optional_action", () => {
    const text = "Opcional: validar botón 'Solicitar'.";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("optional_action");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Solicitar");
    (0, test_1.expect)(intents[0].isOptional).toBe(true);
});
(0, test_1.test)("clasifica 'Optional: validate button 'Continue'' como optional_action", () => {
    const text = "Optional: validate button 'Continue'.";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("optional_action");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Continue");
    (0, test_1.expect)(intents[0].isOptional).toBe(true);
});
(0, test_1.test)("no manda optional_action a assertionIntents obligatorios", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Opcional: validar botón 'Solicitar'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("optional_action");
    (0, test_1.expect)(intents[0].isOptional).toBe(true);
    (0, test_1.expect)(intents[0].type).not.toBe("assertion");
});
(0, test_1.test)("full regression del step real de C37751: concatenated clicks", () => {
    const text = "Click en iniciarClick en Informacion de productos Click en tarjetasClick en tarjetas de creditoClick 'Tarjeta Crédito Visa Clásica'.Validar detalle de producto.Opcional: validar botón 'Solicitar'.";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    const actionClicks = intents.filter((i) => i.type === "action_click" || i.type === "action_select");
    const assertions = intents.filter((i) => i.type === "assertion");
    const optionals = intents.filter((i) => i.type === "optional_action");
    (0, test_1.expect)(actionClicks.length).toBe(5);
    (0, test_1.expect)(actionClicks[0].actionTarget).toBe("iniciar");
    (0, test_1.expect)(actionClicks[1].actionTarget).toBe("Informacion de productos");
    (0, test_1.expect)(actionClicks[2].actionTarget).toBe("tarjetas");
    (0, test_1.expect)(actionClicks[3].actionTarget).toBe("tarjetas de credito");
    (0, test_1.expect)(actionClicks[4].actionTarget).toBe("Tarjeta Crédito Visa Clásica");
    (0, test_1.expect)(assertions.length).toBe(1);
    (0, test_1.expect)(assertions[0].actionTarget).toBe("detalle de producto");
    (0, test_1.expect)(optionals.length).toBe(1);
    (0, test_1.expect)(optionals[0].actionTarget).toBe("Solicitar");
    (0, test_1.expect)(optionals[0].isOptional).toBe(true);
});
(0, test_1.test)("optional_action no aparece como assertion obligatoria", () => {
    const text = "Opcional: validar botón 'Solicitar'.";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    const hasAssertion = intents.some((i) => i.type === "assertion");
    const hasOptional = intents.some((i) => i.type === "optional_action");
    (0, test_1.expect)(hasAssertion).toBe(false);
    (0, test_1.expect)(hasOptional).toBe(true);
});
(0, test_1.test)("divide 'Validar AValidar B' into 2 assertion intents", () => {
    const text = "Validar AValidar B";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(2);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
    (0, test_1.expect)(intents[0].actionTarget).toBe("A");
    (0, test_1.expect)(intents[1].type).toBe("assertion");
    (0, test_1.expect)(intents[1].actionTarget).toBe("B");
});
(0, test_1.test)("Hacer clic en no se parte por 'clic'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Hacer clic en 'Solicitar'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Solicitar");
});
(0, test_1.test)("splitByIntentBoundaries no parte palabras normales compuestas", () => {
    const { splitByIntentBoundaries } = require("../src/discovery/step-intent-parser");
    const fragments = splitByIntentBoundaries("Click en inicio");
    (0, test_1.expect)(fragments.length).toBe(1);
    (0, test_1.expect)(fragments[0]).toBe("Click en inicio");
});
(0, test_1.test)("multiple spaces between concatenated actions are handled", () => {
    const text = "Click en A  Click en B";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(2);
    (0, test_1.expect)(intents[0].actionTarget).toBe("A");
    (0, test_1.expect)(intents[1].actionTarget).toBe("B");
});
(0, test_1.test)("Opcional: sin texto quoted usa todo el resto como target", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Opcional: verificar saldo disponible.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("optional_action");
    (0, test_1.expect)(intents[0].actionTarget).toBe("verificar saldo disponible");
    (0, test_1.expect)(intents[0].isOptional).toBe(true);
});
(0, test_1.test)("presionar pegado se divide correctamente", () => {
    const text = "Click en Apresionar B";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(2);
    (0, test_1.expect)(intents[0].actionTarget).toBe("A");
    (0, test_1.expect)(intents[1].actionTarget).toBe("B");
});
(0, test_1.test)("seleccionar pegado se divide correctamente", () => {
    const text = "Click en Aseleccionar B";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(2);
    (0, test_1.expect)(intents[0].actionTarget).toBe("A");
    (0, test_1.expect)(intents[1].actionTarget).toBe("B");
});
(0, test_1.test)("'Abrir URL del portal web' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Abrir URL del portal web.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
    (0, test_1.expect)(intents[0].actionTarget).toBe("APP_BASE_URL");
});
(0, test_1.test)("'Abrir la aplicación' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Abrir la aplicación.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
});
(0, test_1.test)("'Acceder al portal web' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Acceder al portal web.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
});
(0, test_1.test)("'Ingresar al sistema' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Ingresar al sistema.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
});
(0, test_1.test)("'Navegar a la URL' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Navegar a la URL.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
});
(0, test_1.test)("'Open web portal' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Open web portal.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
});
(0, test_1.test)("'Launch application' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Launch application.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
});
(0, test_1.test)("'Navigate to URL' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Navigate to URL.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
});
(0, test_1.test)("'Go to the home page' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Go to the home page.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
});
(0, test_1.test)("setup_route no se clasifica como action_click", () => {
    const phrases = [
        "Abrir URL del portal web",
        "Abrir la aplicación",
        "Acceder al portal web",
        "Navegar a la URL"
    ];
    for (const phrase of phrases) {
        const intents = (0, step_intent_parser_1.parseStepIntent)(phrase + ".");
        const hasClick = intents.some((i) => i.type === "action_click");
        (0, test_1.expect)(hasClick).toBe(false);
    }
});
(0, test_1.test)("setup_route no se clasifica como assertion", () => {
    const phrases = [
        "Abrir URL del portal web",
        "Abrir la aplicación",
        "Acceder al portal web"
    ];
    for (const phrase of phrases) {
        const intents = (0, step_intent_parser_1.parseStepIntent)(phrase + ".");
        const hasAssertion = intents.some((i) => i.type === "assertion");
        (0, test_1.expect)(hasAssertion).toBe(false);
    }
});
(0, test_1.test)("'Ingresar usuario' se clasifica como action_fill, no setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Ingresar usuario standard_user.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("usuario standard_user");
});
(0, test_1.test)("'Ingresar contraseña' se clasifica como action_fill, no setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Ingresar contraseña.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
});
(0, test_1.test)("'Hacer clic en Login' se clasifica como action_click, no setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Hacer clic en Login.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Login");
});
(0, test_1.test)("'Abrir Información de productos > Tarjetas > Tarjeta de Crédito' sigue siendo navigation_path", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Abrir Información de productos > Tarjetas > Tarjeta de Crédito.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("navigation_path");
    (0, test_1.expect)(intents[0].path).toBeDefined();
});
(0, test_1.test)("'Ir a la página principal' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Ir a la página principal.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
});
(0, test_1.test)("fill: 'Escribir el valor del dato 'usuario_valido' en el campo 'Username'' → target Username, valueKey usuario_valido, source test_data", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Escribir el valor del dato 'usuario_valido' en el campo 'Username'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Username");
    (0, test_1.expect)(intents[0].valueKey).toBe("usuario_valido");
    (0, test_1.expect)(intents[0].valueSource).toBe("test_data");
    (0, test_1.expect)(intents[0].value).toBeUndefined();
});
(0, test_1.test)("fill: 'Ingresar el valor del dato 'contrasena_valida' en el campo 'Password'' → target Password, valueKey contrasena_valida, source test_data", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Ingresar el valor del dato 'contrasena_valida' en el campo 'Password'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Password");
    (0, test_1.expect)(intents[0].valueKey).toBe("contrasena_valida");
    (0, test_1.expect)(intents[0].valueSource).toBe("test_data");
});
(0, test_1.test)("fill: 'Escribir 'standard_user' en el campo 'Username'' → target Username, value standard_user, source literal", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Escribir 'standard_user' en el campo 'Username'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Username");
    (0, test_1.expect)(intents[0].value).toBe("standard_user");
    (0, test_1.expect)(intents[0].valueSource).toBe("literal");
    (0, test_1.expect)(intents[0].valueKey).toBeUndefined();
});
(0, test_1.test)("fill: 'Completar el campo 'Correo' con el dato 'email_valido'' → target Correo, valueKey email_valido, source test_data", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Completar el campo 'Correo' con el dato 'email_valido'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Correo");
    (0, test_1.expect)(intents[0].valueKey).toBe("email_valido");
    (0, test_1.expect)(intents[0].valueSource).toBe("test_data");
});
(0, test_1.test)("fill: 'Type the value of data 'valid_user' into field 'Username'' → target Username, valueKey valid_user, source test_data", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Type the value of data 'valid_user' into field 'Username'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Username");
    (0, test_1.expect)(intents[0].valueKey).toBe("valid_user");
    (0, test_1.expect)(intents[0].valueSource).toBe("test_data");
});
(0, test_1.test)("fill: 'Fill field 'Email' with data 'valid_email'' → target Email, valueKey valid_email, source test_data", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Fill field 'Email' with data 'valid_email'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Email");
    (0, test_1.expect)(intents[0].valueKey).toBe("valid_email");
    (0, test_1.expect)(intents[0].valueSource).toBe("test_data");
});
(0, test_1.test)("fill: 'Enter the value of test data 'my_key' into field 'MyField'' → target MyField, valueKey my_key", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Enter the value of test data 'my_key' into field 'MyField'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("MyField");
    (0, test_1.expect)(intents[0].valueKey).toBe("my_key");
    (0, test_1.expect)(intents[0].valueSource).toBe("test_data");
});
(0, test_1.test)("fill: 'Completar el campo 'Nombre' con 'Juan'' → target Nombre, value Juan, source literal", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Completar el campo 'Nombre' con 'Juan'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Nombre");
    (0, test_1.expect)(intents[0].value).toBe("Juan");
    (0, test_1.expect)(intents[0].valueSource).toBe("literal");
});
(0, test_1.test)("fill: 'Type 'hello' into field 'Greeting'' → target Greeting, value hello, source literal", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Type 'hello' into field 'Greeting'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Greeting");
    (0, test_1.expect)(intents[0].value).toBe("hello");
    (0, test_1.expect)(intents[0].valueSource).toBe("literal");
});
(0, test_1.test)("fill simple existente: 'Ingresar '12345'' sigue funcionando como action_fill", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Ingresar '12345'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("12345");
});
(0, test_1.test)("fill: 'Digitar 'clave' en el campo 'Codigo'' → target Codigo, value clave, source literal", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Digitar 'clave' en el campo 'Codigo'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Codigo");
    (0, test_1.expect)(intents[0].value).toBe("clave");
    (0, test_1.expect)(intents[0].valueSource).toBe("literal");
});
(0, test_1.test)("fill no mezcla usuario_valido con target: en pattern de dato, el target es el campo no la key", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Escribir el valor del dato 'usuario_valido' en el campo 'Username'.");
    (0, test_1.expect)(intents[0].actionTarget).not.toBe("usuario_valido");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Username");
});
(0, test_1.test)("click sigue funcionando: 'Clic en 'Login'' es action_click no fill", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en 'Login'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Login");
});
(0, test_1.test)("assertion sigue funcionando: 'Validar que se muestre 'Products'' es assertion", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Validar que se muestre 'Products'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
});
(0, test_1.test)("setup_route sigue funcionando: 'Abrir URL del portal web' es setup_route", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Abrir URL del portal web.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_route");
});
(0, test_1.test)("'Esperar que esté visible 'Swag Labs'' se clasifica como assertion con target 'Swag Labs'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Esperar que esté visible 'Swag Labs'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Swag Labs");
});
(0, test_1.test)("'Wait for visible 'Continue'' se clasifica como assertion con target 'Continue'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Wait for visible 'Continue'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Continue");
});
(0, test_1.test)("'Validar que se muestre 'Products'' extrae 'Products' como actionTarget", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Validar que se muestre 'Products'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Products");
});
(0, test_1.test)("assertion sin quotes conserva texto completo como actionTarget", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Validar listado de productos.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
    (0, test_1.expect)(intents[0].actionTarget).toBe("listado de productos");
});
// --- Login Setup (setup_authentication) ---
(0, test_1.test)("'Iniciar sesión con el dato 'A' y 'B'' es setup_authentication con valueKeys", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Iniciar sesión con el dato 'usuario_valido' y 'contrasena_valida'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_authentication");
    (0, test_1.expect)(intents[0].valueKeys).toEqual(["usuario_valido", "contrasena_valida"]);
});
(0, test_1.test)("'Log in with data 'A' and 'B'' es setup_authentication con valueKeys", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Log in with data 'valid_user' and 'valid_pass'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_authentication");
    (0, test_1.expect)(intents[0].valueKeys).toEqual(["valid_user", "valid_pass"]);
});
(0, test_1.test)("'Iniciar sesión' sin datos explicitos usa defaults", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Iniciar sesión.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_authentication");
    (0, test_1.expect)(intents[0].valueKeys).toEqual(["usuario_valido", "contrasena_valida"]);
});
(0, test_1.test)("setup_authentication no se clasifica como assertion ni action_click", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Iniciar sesión con el dato 'A' y 'B'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_authentication");
    (0, test_1.expect)(intents[0].type).not.toBe("assertion");
    (0, test_1.expect)(intents[0].type).not.toBe("action_click");
});
// --- Composite Actions ---
(0, test_1.test)("'Agregar 'X' al carrito' es composite_action con associatedEntity", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Agregar 'Sauce Labs Backpack' al carrito.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("composite_action");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Sauce Labs Backpack");
    (0, test_1.expect)(intents[0].associatedEntity).toBe("Sauce Labs Backpack");
    (0, test_1.expect)(intents[0].actionVerb).toBe("add_to_cart");
});
(0, test_1.test)("'Add 'X' to cart' es composite_action", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Add 'Sauce Labs Backpack' to cart.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("composite_action");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Sauce Labs Backpack");
    (0, test_1.expect)(intents[0].associatedEntity).toBe("Sauce Labs Backpack");
});
(0, test_1.test)("'Añadir 'X' al carrito' es composite_action", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Añadir 'Bike Light' al carrito.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("composite_action");
    (0, test_1.expect)(intents[0].associatedEntity).toBe("Bike Light");
});
(0, test_1.test)("composite_action no se clasifica como assertion", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Agregar 'Sauce Labs Backpack' al carrito.");
    (0, test_1.expect)(intents[0].type).not.toBe("assertion");
    (0, test_1.expect)(intents[0].type).not.toBe("action_click");
});
// --- Associated Entity in Click Actions ---
(0, test_1.test)("'Clic en 'Add to cart' asociado al producto 'X'' extrae associatedEntity", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en 'Add to cart' asociado al producto 'Sauce Labs Backpack'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Add to cart");
    (0, test_1.expect)(intents[0].associatedEntity).toBe("Sauce Labs Backpack");
});
(0, test_1.test)("'Click on 'Remove' associated with product 'X'' extrae associatedEntity", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Click on 'Remove' associated with product 'Sauce Labs Backpack'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Remove");
    (0, test_1.expect)(intents[0].associatedEntity).toBe("Sauce Labs Backpack");
});
(0, test_1.test)("'Clic en 'X' relacionado con 'Y'' extrae associatedEntity", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en 'Add to cart' relacionado con el producto 'Sauce Labs Backpack'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].associatedEntity).toBe("Sauce Labs Backpack");
});
// --- Step Number Stripping ---
(0, test_1.test)("step number '1. ' se elimina del texto", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("1. Clic en 'Login'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Login");
});
(0, test_1.test)("step number '2) ' se elimina del texto", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("2) Iniciar sesión con el dato 'A' y 'B'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("setup_authentication");
    (0, test_1.expect)(intents[0].valueKeys).toEqual(["A", "B"]);
});
(0, test_1.test)("step number 'N. ' se elimina del texto", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("3. Validar que se muestre 'Products'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Products");
});
// --- classifyStepSet con nuevos tipos ---
(0, test_1.test)("classifyStepSet pone setup_authentication en setupIntents", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Iniciar sesión con el dato 'A' y 'B'.");
    const classified = (0, step_intent_parser_1.classifyStepSet)(intents);
    (0, test_1.expect)(classified.setupIntents.length).toBe(1);
    (0, test_1.expect)(classified.setupIntents[0].type).toBe("setup_authentication");
    (0, test_1.expect)(classified.assertionIntents.length).toBe(0);
    (0, test_1.expect)(classified.actionIntents.length).toBe(0);
});
(0, test_1.test)("classifyStepSet pone composite_action en actionIntents", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Agregar 'Sauce Labs Backpack' al carrito.");
    const classified = (0, step_intent_parser_1.classifyStepSet)(intents);
    (0, test_1.expect)(classified.actionIntents.length).toBe(1);
    (0, test_1.expect)(classified.actionIntents[0].type).toBe("composite_action");
    (0, test_1.expect)(classified.assertionIntents.length).toBe(0);
    (0, test_1.expect)(classified.setupIntents.length).toBe(0);
});
(0, test_1.test)("assertion con slash no se clasifica como navigation_path", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Validar detalle/listado de productos");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
    (0, test_1.expect)(intents[0].type).not.toBe("navigation_path");
});
(0, test_1.test)("esperar con slash se clasifica como assertion", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Esperar pantalla/resumen final");
    (0, test_1.expect)(intents[0].type).toBe("assertion");
});
(0, test_1.test)("click pegado con ruta se divide en click + navigation_path", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("clic en iniciar>Abrir A > B > C");
    (0, test_1.expect)(intents.length).toBe(2);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("iniciar");
    (0, test_1.expect)(intents[1].type).toBe("navigation_path");
    (0, test_1.expect)(intents[1].path).toEqual(["A", "B", "C"]);
});
(0, test_1.test)("click con separador residual limpia target", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("clic en iniciar>");
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("iniciar");
});
(0, test_1.test)("cleanActionTarget limpia separadores residuales en extremos", () => {
    (0, test_1.expect)((0, step_intent_parser_1.cleanActionTarget)(" Información de productos > ")).toBe("Información de productos");
    (0, test_1.expect)((0, step_intent_parser_1.cleanActionTarget)("> iniciar")).toBe("iniciar");
    (0, test_1.expect)((0, step_intent_parser_1.cleanActionTarget)("Solicitar.")).toBe("Solicitar");
});
(0, test_1.test)("no divide emails y dominios por puntos", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Ingresar correo de prueba usando teclado virtual: correo@empresa.com.do o equivalente configurado.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_fill");
    (0, test_1.expect)(intents[0].actionTarget).toContain("correo@empresa.com.do");
});
(0, test_1.test)("no divide urls por puntos", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Verificar https://example.com/path");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("assertion");
});
// --- Semantic Roles & Relation Contexts ---
(0, test_1.test)("'Clic en el producto visible relacionado con 'X'' extrae semanticRole 'product' y actionTarget 'X'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en el producto visible relacionado con 'X'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("X");
    (0, test_1.expect)(intents[0].semanticRole).toBe("product");
});
(0, test_1.test)("'Clic en la opción relacionada con 'Préstamo' dentro de la categoría actual' extrae semanticRole y relationContext", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en la opción relacionada con 'Préstamo' dentro de la categoría actual.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Préstamo");
    (0, test_1.expect)(intents[0].semanticRole).toBe("option");
    (0, test_1.expect)(intents[0].relationContext).toBe("categoría actual");
});
(0, test_1.test)("'Hacer clic en la card asociada a 'Visa'' extrae semanticRole 'card'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Hacer clic en la card asociada a 'Visa'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Visa");
    (0, test_1.expect)(intents[0].semanticRole).toBe("card");
});
(0, test_1.test)("'Clic en la categoría relacionada con 'Préstamo'' extrae semanticRole 'category'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en la categoría relacionada con 'Préstamo'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Préstamo");
    (0, test_1.expect)(intents[0].semanticRole).toBe("category");
});
(0, test_1.test)("'Clic en el ítem relacionado con 'X'' extrae semanticRole 'item'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en el ítem asociado a 'X'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("X");
    (0, test_1.expect)(intents[0].semanticRole).toBe("item");
});
(0, test_1.test)("'Clic en la sección relacionada con 'Ahorros'' extrae semanticRole 'section'", () => {
    const intents = (0, step_intent_parser_1.parseStepIntent)("Clic en la sección relacionada con 'Ahorros'.");
    (0, test_1.expect)(intents.length).toBe(1);
    (0, test_1.expect)(intents[0].type).toBe("action_click");
    (0, test_1.expect)(intents[0].actionTarget).toBe("Ahorros");
    (0, test_1.expect)(intents[0].semanticRole).toBe("section");
});
(0, test_1.test)("targets repetidos con mismo texto pero roles distintos no se deduplican en parseo", () => {
    const text = "Clic en el producto relacionado con 'A'. Clic en la card asociada a 'A'.";
    const intents = (0, step_intent_parser_1.parseStepIntent)(text);
    (0, test_1.expect)(intents.length).toBe(2);
    const product = intents.find(i => i.semanticRole === "product");
    const card = intents.find(i => i.semanticRole === "card");
    (0, test_1.expect)(product).toBeDefined();
    (0, test_1.expect)(card).toBeDefined();
    (0, test_1.expect)(product.actionTarget).toBe(card.actionTarget);
    (0, test_1.expect)(product.semanticRole).not.toBe(card.semanticRole);
});
(0, test_1.test)("no hardcodear textos de productos específicos en step-intent-parser", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(path.join(__dirname, "../src/discovery/step-intent-parser.ts"), "utf-8");
    (0, test_1.expect)(content).not.toContain("Sauce Labs");
    (0, test_1.expect)(content).not.toContain("Préstamo");
    (0, test_1.expect)(content).not.toContain("Visa");
    (0, test_1.expect)(content).not.toContain("Ahorros");
    (0, test_1.expect)(content).not.toContain("Kiosko");
    (0, test_1.expect)(content).not.toContain("C37753");
    (0, test_1.expect)(content).not.toContain("C37853");
});
