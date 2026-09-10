import { expect, test } from "@playwright/test";
import {
  parseStepIntent,
  parseSingleIntent,
  classifyStepSet,
  normalizeText,
  cleanActionTarget
} from "../src/discovery/step-intent-parser";

test("parse 'Abrir Información de productos > Tarjetas > Tarjeta de Crédito' as navigation_path", () => {
  const intents = parseStepIntent("Abrir Información de productos > Tarjetas > Tarjeta de Crédito.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("navigation_path");
  expect(intents[0].path).toEqual(["Información de productos", "Tarjetas", "Tarjeta de Crédito"]);
});

test("parse 'Abrir A > B > C' as navigation_path", () => {
  const intents = parseStepIntent("Abrir A > B > C");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("navigation_path");
  expect(intents[0].path).toEqual(["A", "B", "C"]);
});

test("parse 'Ir a A / B / C' as navigation_path", () => {
  const intents = parseStepIntent("Ir a A / B / C");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("navigation_path");
  expect(intents[0].path).toEqual(["A", "B", "C"]);
});

test("parse 'Navegar a A -> B -> C' as navigation_path", () => {
  const intents = parseStepIntent("Navegar a A -> B -> C");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("navigation_path");
  expect(intents[0].path).toEqual(["A", "B", "C"]);
});

test("parse 'Acceder a Módulo de Productos > Tarjetas' as navigation_path", () => {
  const intents = parseStepIntent("Acceder a Módulo de Productos > Tarjetas.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("navigation_path");
  expect(intents[0].path).toEqual(["Módulo de Productos", "Tarjetas"]);
});

test("parse 'Desde el listado de tarjetas de crédito' as precondition_context", () => {
  const intents = parseStepIntent("Desde el listado de tarjetas de crédito.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("precondition_context");
  expect(intents[0].context).toBe("tarjetas de crédito");
  expect(intents[0].contextType).toContain("listado de");
});

test("parse 'Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta Crédito Visa Clásica'' as precondition + action", () => {
  const text = "Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta Crédito Visa Clásica'.";
  const intents = parseStepIntent(text);

  expect(intents.length).toBe(2);

  const precondition = intents.find((i) => i.type === "precondition_context");
  expect(precondition).toBeDefined();
  expect(precondition!.context).toBe("tarjetas de crédito");

  const action = intents.find((i) => i.type === "action_select");
  expect(action).toBeDefined();
  expect(action!.actionTarget).toBe("Tarjeta Crédito Visa Clásica");
});

test("parse 'Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta de Crédito Visa Platinum'' as precondition + action", () => {
  const text = "Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta de Crédito Visa Platinum'.";
  const intents = parseStepIntent(text);

  expect(intents.length).toBe(2);

  const precondition = intents.find((i) => i.type === "precondition_context");
  expect(precondition).toBeDefined();
  expect(precondition!.context).toBe("tarjetas de crédito");

  const action = intents.find((i) => i.type === "action_select");
  expect(action).toBeDefined();
  expect(action!.actionTarget).toBe("Tarjeta de Crédito Visa Platinum");
});

test("parse 'Clic en 'Solicitar'' as action_click", () => {
  const intents = parseStepIntent("Clic en 'Solicitar'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Solicitar");
});

test("parse 'Seleccionar 'Tarjeta Crédito Visa Clásica'' as action_select", () => {
  const intents = parseStepIntent("Seleccionar 'Tarjeta Crédito Visa Clásica'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_select");
  expect(intents[0].actionTarget).toBe("Tarjeta Crédito Visa Clásica");
});

test("parse 'Seleccionar una tarjeta, preferiblemente 'Tarjeta Crédito Visa Clásica'' as optional_action", () => {
  const text = "Seleccionar una tarjeta, preferiblemente 'Tarjeta Crédito Visa Clásica'.";
  const intents = parseStepIntent(text);
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("optional_action");
  expect(intents[0].actionTarget).toBe("Tarjeta Crédito Visa Clásica");
  expect(intents[0].isOptional).toBe(true);
});

test("parse 'Hacer clic en 'Solicitar'' as action_click", () => {
  const intents = parseStepIntent("Hacer clic en 'Solicitar'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Solicitar");
});

test("parse 'Presionar 'Continuar'' as action_click", () => {
  const intents = parseStepIntent("Presionar 'Continuar'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Continuar");
});

test("parse 'Validar listado de tarjetas de crédito' as assertion", () => {
  const intents = parseStepIntent("Validar listado de tarjetas de crédito.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
  expect(intents[0].actionTarget).toBe("listado de tarjetas de crédito");
});

test("parse 'Verificar que se muestra Visa Clásica' as assertion", () => {
  const intents = parseStepIntent("Verificar que se muestra Visa Clásica.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
  expect(intents[0].actionTarget).toBe("que se muestra Visa Clásica");
});

test("parse 'Comprobar saldo disponible' as assertion", () => {
  const intents = parseStepIntent("Comprobar saldo disponible.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
  expect(intents[0].actionTarget).toBe("saldo disponible");
});

test("does not classify actions as assertions", () => {
  const actions = [
    "Seleccionar 'Tarjeta Crédito Visa Clásica'.",
    "Clic en 'Solicitar'.",
    "Seleccionar una tarjeta, preferiblemente 'Visa Clásica'."
  ];

  for (const action of actions) {
    const intents = parseStepIntent(action);
    const hasAssertion = intents.some((i) => i.type === "assertion");
    expect(hasAssertion).toBe(false);
  }
});

test("does not classify preconditions as assertions", () => {
  const text = "Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta Crédito Visa Clásica'.";
  const intents = parseStepIntent(text);
  const hasAssertion = intents.some((i) => i.type === "assertion");
  expect(hasAssertion).toBe(false);
});

test("'Abrir URL del Kiosko' is classified as setup_route", () => {
  const intents = parseStepIntent("Abrir URL del Kiosko.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
  expect(intents[0].actionTarget).toBe("APP_BASE_URL");
});

test("classifyStepSet separates intents correctly", () => {
  const intents = [
    { type: "navigation_path" as const, originalText: "Abrir A > B", normalizedText: "abrir a > b", path: ["A", "B"], priority: 10 },
    { type: "action_select" as const, originalText: "Seleccionar 'X'", normalizedText: "seleccionar 'x'", actionTarget: "X", actionVerb: "seleccionar", priority: 5 },
    { type: "assertion" as const, originalText: "Validar X", normalizedText: "validar x", actionTarget: "X", actionVerb: "validar", priority: 3 }
  ];

  const result = classifyStepSet(intents as any);

  expect(result.setupIntents.length).toBe(1);
  expect(result.setupIntents[0].type).toBe("navigation_path");
  expect(result.actionIntents.length).toBe(1);
  expect(result.actionIntents[0].type).toBe("action_select");
  expect(result.assertionIntents.length).toBe(1);
  expect(result.assertionIntents[0].type).toBe("assertion");
});

test("C37755 full scenario parsing", () => {
  const scenarioSteps = [
    "Abrir Información de productos > Tarjetas > Tarjeta de Crédito.",
    "Seleccionar una tarjeta, preferiblemente 'Tarjeta Crédito Visa Clásica'.",
    "Clic en 'Solicitar'."
  ];

  const allIntents = scenarioSteps.map((s) => parseStepIntent(s));
  const flat = allIntents.flat();

  const navigation = flat.find((i) => i.type === "navigation_path");
  expect(navigation).toBeDefined();
  expect(navigation!.path).toEqual(["Información de productos", "Tarjetas", "Tarjeta de Crédito"]);

  const optional = flat.find((i) => i.type === "optional_action");
  expect(optional).toBeDefined();
  expect(optional!.actionTarget).toBe("Tarjeta Crédito Visa Clásica");

  const click = flat.find((i) => i.type === "action_click");
  expect(click).toBeDefined();
  expect(click!.actionTarget).toBe("Solicitar");
});

test("parse 'Escoger 'Opción A'' as action_select", () => {
  const intents = parseStepIntent("Escoger 'Opción A'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_select");
  expect(intents[0].actionTarget).toBe("Opción A");
});

test("parse 'Elegir 'Opción B'' as action_select", () => {
  const intents = parseStepIntent("Elegir 'Opción B'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_select");
  expect(intents[0].actionTarget).toBe("Opción B");
});

test("parse 'Ingresar '12345'' as action_fill", () => {
  const intents = parseStepIntent("Ingresar '12345'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("12345");
});

test("fill reconoce un placeholder con modificador secreto de forma genérica", () => {
  const intents = parseStepIntent('Ingresar el valor secreto [secret.key] en el campo "Campo secreto".');
  expect(intents).toHaveLength(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("Campo secreto");
  expect(intents[0].valueKey).toBe("secret.key");
});

test("fill normal y secreto conservan claves namespaced y click sigue siendo click", () => {
  const normal = parseStepIntent('Ingresar el valor [user.id] en el campo "Usuario".');
  const secret = parseStepIntent('Ingresar el valor secreto [credentials.secret] en el campo "Clave".');
  const click = parseStepIntent('Hacer clic en "Continuar".');

  expect(normal[0]).toMatchObject({ type: "action_fill", valueKey: "user.id" });
  expect(secret[0]).toMatchObject({ type: "action_fill", valueKey: "credentials.secret" });
  expect(click[0]).toMatchObject({ type: "action_click", actionTarget: "Continuar" });
});

test("preserva el binding estructural de selector y valor en una acción compuesta", () => {
  const intents = parseStepIntent(
    'En la primera línea de registro, hacer clic en el selector "Currency" del campo "Compensation" y seleccionar el valor [row.currency].'
  );

  const selection = intents.find((intent) => intent.type === "action_select");
  expect(selection).toMatchObject({
    actionTarget: "Currency",
    selectionField: "Currency",
    associatedField: "Compensation",
    valueKey: "row.currency",
    valueSource: "test_data"
  });
});

test("preserva el binding del editor de monto en una acción compuesta", () => {
  const intents = parseStepIntent(
    'En la primera línea de registro, hacer clic en el campo de monto asociado a "Compensation" e ingresar el valor [row.amount].'
  );

  const fill = intents.find((intent) => intent.type === "action_fill");
  expect(fill).toMatchObject({
    actionTarget: "monto",
    associatedField: "Compensation",
    valueKey: "row.amount",
    valueSource: "test_data"
  });
});

test("mantiene los bindings semánticos de los pasos fresh de selección y monto", () => {
  const currency = parseStepIntent(
    'En la primera línea de colaborador, hacer clic en el selector "Moneda" del campo "Ingresos" y seleccionar el valor [employee_1.currency].'
  ).find((intent) => intent.type === "action_select");
  const income = parseStepIntent(
    'En la primera línea de colaborador, hacer clic en el campo de monto asociado a "Ingresos" e ingresar el valor [employee_1.income].'
  ).find((intent) => intent.type === "action_fill");

  expect(currency).toMatchObject({
    actionTarget: "Moneda",
    selectionField: "Moneda",
    associatedField: "Ingresos",
    valueKey: "employee_1.currency"
  });
  expect(income).toMatchObject({
    actionTarget: "monto",
    associatedField: "Ingresos",
    valueKey: "employee_1.income"
  });
});

test("parse 'Clic en Iniciar' without quotes as action_click", () => {
  const intents = parseStepIntent("Clic en Iniciar.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Iniciar");
});

test("parse 'Seleccionar Tarjeta de Crédito' without quotes as action_select", () => {
  const intents = parseStepIntent("Seleccionar Tarjeta de Crédito.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_select");
  expect(intents[0].actionTarget).toBe("Tarjeta de Crédito");
});

test("does not hardcode Kiosko texts", () => {
  const fs = require("fs");
  const path = require("path");
  const content = fs.readFileSync(path.join(__dirname, "../src/discovery/step-intent-parser.ts"), "utf-8");

  expect(content).not.toContain("Información de productos");
  expect(content).not.toContain("Tarjeta de Crédito");
  expect(content).not.toContain("Banco Santa Cruz");
  expect(content).not.toContain("Kiosko");
  expect(content).not.toContain("C37750");
  expect(content).not.toContain("tarjetas");
});

test("empty text returns empty array", () => {
  expect(parseStepIntent("")).toEqual([]);
  expect(parseStepIntent("   ")).toEqual([]);
});

test("unknown step returns unknown type", () => {
  const intents = parseStepIntent("Hacer algo completamente diferente.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("unknown");
});

test("multiple steps in one string separated by period", () => {
  const intents = parseStepIntent("Clic en 'A'. Clic en 'B'.");
  expect(intents.length).toBe(2);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("A");
  expect(intents[1].type).toBe("action_click");
  expect(intents[1].actionTarget).toBe("B");
});

test("parse 'Tocar 'Menú'' as action_click", () => {
  const intents = parseStepIntent("Tocar 'Menú'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Menú");
});

test("divide 'Click en iniciarClick en Informacion de productos' into 2 intents", () => {
  const text = "Click en iniciarClick en Informacion de productos";
  const intents = parseStepIntent(text);

  expect(intents.length).toBe(2);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("iniciar");
  expect(intents[1].type).toBe("action_click");
  expect(intents[1].actionTarget).toBe("Informacion de productos");
});

test("divide múltiples Click pegados: 'Click en AClick en BClick en C'", () => {
  const text = "Click en AClick en BClick en C";
  const intents = parseStepIntent(text);

  expect(intents.length).toBe(3);
  expect(intents[0].actionTarget).toBe("A");
  expect(intents[1].actionTarget).toBe("B");
  expect(intents[2].actionTarget).toBe("C");
});

test("respeta target quoted: 'Click en AClick 'Tarjeta Crédito Visa Clásica''", () => {
  const text = "Click en AClick 'Tarjeta Crédito Visa Clásica'";
  const intents = parseStepIntent(text);

  expect(intents.length).toBe(2);
  expect(intents[0].actionTarget).toBe("A");
  expect(intents[1].actionTarget).toBe("Tarjeta Crédito Visa Clásica");
});

test("clasifica 'Opcional: validar botón 'Solicitar'' como optional_action", () => {
  const text = "Opcional: validar botón 'Solicitar'.";
  const intents = parseStepIntent(text);

  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("optional_action");
  expect(intents[0].actionTarget).toBe("Solicitar");
  expect(intents[0].isOptional).toBe(true);
});

test("clasifica 'Optional: validate button 'Continue'' como optional_action", () => {
  const text = "Optional: validate button 'Continue'.";
  const intents = parseStepIntent(text);

  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("optional_action");
  expect(intents[0].actionTarget).toBe("Continue");
  expect(intents[0].isOptional).toBe(true);
});

test("no manda optional_action a assertionIntents obligatorios", () => {
  const intents = parseStepIntent("Opcional: validar botón 'Solicitar'.");

  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("optional_action");
  expect(intents[0].isOptional).toBe(true);
  expect(intents[0].type).not.toBe("assertion");
});

test("full regression del step real de C37751: concatenated clicks", () => {
  const text = "Click en iniciarClick en Informacion de productos Click en tarjetasClick en tarjetas de creditoClick 'Tarjeta Crédito Visa Clásica'.Validar detalle de producto.Opcional: validar botón 'Solicitar'.";
  const intents = parseStepIntent(text);

  const actionClicks = intents.filter(
    (i) => i.type === "action_click" || i.type === "action_select"
  );
  const assertions = intents.filter((i) => i.type === "assertion");
  const optionals = intents.filter((i) => i.type === "optional_action");

  expect(actionClicks.length).toBe(5);
  expect(actionClicks[0].actionTarget).toBe("iniciar");
  expect(actionClicks[1].actionTarget).toBe("Informacion de productos");
  expect(actionClicks[2].actionTarget).toBe("tarjetas");
  expect(actionClicks[3].actionTarget).toBe("tarjetas de credito");
  expect(actionClicks[4].actionTarget).toBe("Tarjeta Crédito Visa Clásica");

  expect(assertions.length).toBe(1);
  expect(assertions[0].actionTarget).toBe("detalle de producto");

  expect(optionals.length).toBe(1);
  expect(optionals[0].actionTarget).toBe("Solicitar");
  expect(optionals[0].isOptional).toBe(true);
});

test("optional_action no aparece como assertion obligatoria", () => {
  const text = "Opcional: validar botón 'Solicitar'.";
  const intents = parseStepIntent(text);

  const hasAssertion = intents.some((i) => i.type === "assertion");
  const hasOptional = intents.some((i) => i.type === "optional_action");

  expect(hasAssertion).toBe(false);
  expect(hasOptional).toBe(true);
});

test("divide 'Validar AValidar B' into 2 assertion intents", () => {
  const text = "Validar AValidar B";
  const intents = parseStepIntent(text);

  expect(intents.length).toBe(2);
  expect(intents[0].type).toBe("assertion");
  expect(intents[0].actionTarget).toBe("A");
  expect(intents[1].type).toBe("assertion");
  expect(intents[1].actionTarget).toBe("B");
});

test("Hacer clic en no se parte por 'clic'", () => {
  const intents = parseStepIntent("Hacer clic en 'Solicitar'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Solicitar");
});

test("splitByIntentBoundaries no parte palabras normales compuestas", () => {
  const { splitByIntentBoundaries } = require("../src/discovery/step-intent-parser");
  const fragments = splitByIntentBoundaries("Click en inicio");
  expect(fragments.length).toBe(1);
  expect(fragments[0]).toBe("Click en inicio");
});

test("multiple spaces between concatenated actions are handled", () => {
  const text = "Click en A  Click en B";
  const intents = parseStepIntent(text);
  expect(intents.length).toBe(2);
  expect(intents[0].actionTarget).toBe("A");
  expect(intents[1].actionTarget).toBe("B");
});

test("Opcional: sin texto quoted usa todo el resto como target", () => {
  const intents = parseStepIntent("Opcional: verificar saldo disponible.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("optional_action");
  expect(intents[0].actionTarget).toBe("verificar saldo disponible");
  expect(intents[0].isOptional).toBe(true);
});

test("presionar pegado se divide correctamente", () => {
  const text = "Click en Apresionar B";
  const intents = parseStepIntent(text);
  expect(intents.length).toBe(2);
  expect(intents[0].actionTarget).toBe("A");
  expect(intents[1].actionTarget).toBe("B");
});

test("seleccionar pegado se divide correctamente", () => {
  const text = "Click en Aseleccionar B";
  const intents = parseStepIntent(text);
  expect(intents.length).toBe(2);
  expect(intents[0].actionTarget).toBe("A");
  expect(intents[1].actionTarget).toBe("B");
});

test("'Abrir URL del portal web' es setup_route", () => {
  const intents = parseStepIntent("Abrir URL del portal web.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
  expect(intents[0].actionTarget).toBe("APP_BASE_URL");
});

test("'Abrir la aplicación' es setup_route", () => {
  const intents = parseStepIntent("Abrir la aplicación.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
});

test("'Acceder al portal web' es setup_route", () => {
  const intents = parseStepIntent("Acceder al portal web.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
});

test("'Ingresar al sistema' es setup_route", () => {
  const intents = parseStepIntent("Ingresar al sistema.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
});

test("'Navegar a la URL' es setup_route", () => {
  const intents = parseStepIntent("Navegar a la URL.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
});

test("'Open web portal' es setup_route", () => {
  const intents = parseStepIntent("Open web portal.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
});

test("'Launch application' es setup_route", () => {
  const intents = parseStepIntent("Launch application.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
});

test("'Navigate to URL' es setup_route", () => {
  const intents = parseStepIntent("Navigate to URL.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
});

test("'Go to the home page' es setup_route", () => {
  const intents = parseStepIntent("Go to the home page.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
});

test("setup_route no se clasifica como action_click", () => {
  const phrases = [
    "Abrir URL del portal web",
    "Abrir la aplicación",
    "Acceder al portal web",
    "Navegar a la URL"
  ];
  for (const phrase of phrases) {
    const intents = parseStepIntent(phrase + ".");
    const hasClick = intents.some((i) => i.type === "action_click");
    expect(hasClick).toBe(false);
  }
});

test("setup_route no se clasifica como assertion", () => {
  const phrases = [
    "Abrir URL del portal web",
    "Abrir la aplicación",
    "Acceder al portal web"
  ];
  for (const phrase of phrases) {
    const intents = parseStepIntent(phrase + ".");
    const hasAssertion = intents.some((i) => i.type === "assertion");
    expect(hasAssertion).toBe(false);
  }
});

test("'Ingresar usuario' se clasifica como action_fill, no setup_route", () => {
  const intents = parseStepIntent("Ingresar usuario standard_user.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("usuario standard_user");
});

test("'Ingresar contraseña' se clasifica como action_fill, no setup_route", () => {
  const intents = parseStepIntent("Ingresar contraseña.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
});

test("'Hacer clic en Login' se clasifica como action_click, no setup_route", () => {
  const intents = parseStepIntent("Hacer clic en Login.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Login");
});

test("'Abrir Información de productos > Tarjetas > Tarjeta de Crédito' sigue siendo navigation_path", () => {
  const intents = parseStepIntent("Abrir Información de productos > Tarjetas > Tarjeta de Crédito.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("navigation_path");
  expect(intents[0].path).toBeDefined();
});

test("'Ir a la página principal' es setup_route", () => {
  const intents = parseStepIntent("Ir a la página principal.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
});

test("fill: 'Escribir el valor del dato 'usuario_valido' en el campo 'Username'' → target Username, valueKey usuario_valido, source test_data", () => {
  const intents = parseStepIntent("Escribir el valor del dato 'usuario_valido' en el campo 'Username'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("Username");
  expect(intents[0].valueKey).toBe("usuario_valido");
  expect(intents[0].valueSource).toBe("test_data");
  expect(intents[0].value).toBeUndefined();
});

test("fill: 'Ingresar el valor del dato 'contrasena_valida' en el campo 'Password'' → target Password, valueKey contrasena_valida, source test_data", () => {
  const intents = parseStepIntent("Ingresar el valor del dato 'contrasena_valida' en el campo 'Password'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("Password");
  expect(intents[0].valueKey).toBe("contrasena_valida");
  expect(intents[0].valueSource).toBe("test_data");
});

test("fill: 'Escribir 'standard_user' en el campo 'Username'' → target Username, value standard_user, source literal", () => {
  const intents = parseStepIntent("Escribir 'standard_user' en el campo 'Username'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("Username");
  expect(intents[0].value).toBe("standard_user");
  expect(intents[0].valueSource).toBe("literal");
  expect(intents[0].valueKey).toBeUndefined();
});

test("fill: 'Completar el campo 'Correo' con el dato 'email_valido'' → target Correo, valueKey email_valido, source test_data", () => {
  const intents = parseStepIntent("Completar el campo 'Correo' con el dato 'email_valido'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("Correo");
  expect(intents[0].valueKey).toBe("email_valido");
  expect(intents[0].valueSource).toBe("test_data");
});

test("fill: 'Type the value of data 'valid_user' into field 'Username'' → target Username, valueKey valid_user, source test_data", () => {
  const intents = parseStepIntent("Type the value of data 'valid_user' into field 'Username'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("Username");
  expect(intents[0].valueKey).toBe("valid_user");
  expect(intents[0].valueSource).toBe("test_data");
});

test("fill: 'Fill field 'Email' with data 'valid_email'' → target Email, valueKey valid_email, source test_data", () => {
  const intents = parseStepIntent("Fill field 'Email' with data 'valid_email'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("Email");
  expect(intents[0].valueKey).toBe("valid_email");
  expect(intents[0].valueSource).toBe("test_data");
});

test("fill: 'Enter the value of test data 'my_key' into field 'MyField'' → target MyField, valueKey my_key", () => {
  const intents = parseStepIntent("Enter the value of test data 'my_key' into field 'MyField'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("MyField");
  expect(intents[0].valueKey).toBe("my_key");
  expect(intents[0].valueSource).toBe("test_data");
});

test("fill: 'Completar el campo 'Nombre' con 'Juan'' → target Nombre, value Juan, source literal", () => {
  const intents = parseStepIntent("Completar el campo 'Nombre' con 'Juan'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("Nombre");
  expect(intents[0].value).toBe("Juan");
  expect(intents[0].valueSource).toBe("literal");
});

test("fill: 'Type 'hello' into field 'Greeting'' → target Greeting, value hello, source literal", () => {
  const intents = parseStepIntent("Type 'hello' into field 'Greeting'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("Greeting");
  expect(intents[0].value).toBe("hello");
  expect(intents[0].valueSource).toBe("literal");
});

test("fill simple existente: 'Ingresar '12345'' sigue funcionando como action_fill", () => {
  const intents = parseStepIntent("Ingresar '12345'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("12345");
});

test("fill: 'Digitar 'clave' en el campo 'Codigo'' → target Codigo, value clave, source literal", () => {
  const intents = parseStepIntent("Digitar 'clave' en el campo 'Codigo'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toBe("Codigo");
  expect(intents[0].value).toBe("clave");
  expect(intents[0].valueSource).toBe("literal");
});

test("fill no mezcla usuario_valido con target: en pattern de dato, el target es el campo no la key", () => {
  const intents = parseStepIntent("Escribir el valor del dato 'usuario_valido' en el campo 'Username'.");
  expect(intents[0].actionTarget).not.toBe("usuario_valido");
  expect(intents[0].actionTarget).toBe("Username");
});

test("click sigue funcionando: 'Clic en 'Login'' es action_click no fill", () => {
  const intents = parseStepIntent("Clic en 'Login'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Login");
});

test("assertion sigue funcionando: 'Validar que se muestre 'Products'' es assertion", () => {
  const intents = parseStepIntent("Validar que se muestre 'Products'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
});

test("setup_route sigue funcionando: 'Abrir URL del portal web' es setup_route", () => {
  const intents = parseStepIntent("Abrir URL del portal web.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_route");
});

test("'Esperar que esté visible 'Swag Labs'' se clasifica como assertion con target 'Swag Labs'", () => {
  const intents = parseStepIntent("Esperar que esté visible 'Swag Labs'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
  expect(intents[0].actionTarget).toBe("Swag Labs");
});

test("'Wait for visible 'Continue'' se clasifica como assertion con target 'Continue'", () => {
  const intents = parseStepIntent("Wait for visible 'Continue'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
  expect(intents[0].actionTarget).toBe("Continue");
});

test("'Validar que se muestre 'Products'' extrae 'Products' como actionTarget", () => {
  const intents = parseStepIntent("Validar que se muestre 'Products'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
  expect(intents[0].actionTarget).toBe("Products");
});

test("assertion sin quotes conserva texto completo como actionTarget", () => {
  const intents = parseStepIntent("Validar listado de productos.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
  expect(intents[0].actionTarget).toBe("listado de productos");
});

// --- Login Setup (setup_authentication) ---

test("'Iniciar sesión con el dato 'A' y 'B'' es setup_authentication con valueKeys", () => {
  const intents = parseStepIntent("Iniciar sesión con el dato 'usuario_valido' y 'contrasena_valida'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_authentication");
  expect(intents[0].valueKeys).toEqual(["usuario_valido", "contrasena_valida"]);
});

test("'Log in with data 'A' and 'B'' es setup_authentication con valueKeys", () => {
  const intents = parseStepIntent("Log in with data 'valid_user' and 'valid_pass'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_authentication");
  expect(intents[0].valueKeys).toEqual(["valid_user", "valid_pass"]);
});

test("'Iniciar sesión' sin datos explicitos usa defaults", () => {
  const intents = parseStepIntent("Iniciar sesión.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_authentication");
  expect(intents[0].valueKeys).toEqual(["usuario_valido", "contrasena_valida"]);
});

test("setup_authentication no se clasifica como assertion ni action_click", () => {
  const intents = parseStepIntent("Iniciar sesión con el dato 'A' y 'B'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_authentication");
  expect(intents[0].type).not.toBe("assertion");
  expect(intents[0].type).not.toBe("action_click");
});

// --- Composite Actions ---

test("'Agregar 'X' al carrito' es composite_action con associatedEntity", () => {
  const intents = parseStepIntent("Agregar 'Sauce Labs Backpack' al carrito.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("composite_action");
  expect(intents[0].actionTarget).toBe("Sauce Labs Backpack");
  expect(intents[0].associatedEntity).toBe("Sauce Labs Backpack");
  expect(intents[0].actionVerb).toBe("add_to_cart");
});

test("'Add 'X' to cart' es composite_action", () => {
  const intents = parseStepIntent("Add 'Sauce Labs Backpack' to cart.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("composite_action");
  expect(intents[0].actionTarget).toBe("Sauce Labs Backpack");
  expect(intents[0].associatedEntity).toBe("Sauce Labs Backpack");
});

test("'Añadir 'X' al carrito' es composite_action", () => {
  const intents = parseStepIntent("Añadir 'Bike Light' al carrito.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("composite_action");
  expect(intents[0].associatedEntity).toBe("Bike Light");
});

test("composite_action no se clasifica como assertion", () => {
  const intents = parseStepIntent("Agregar 'Sauce Labs Backpack' al carrito.");
  expect(intents[0].type).not.toBe("assertion");
  expect(intents[0].type).not.toBe("action_click");
});

// --- Associated Entity in Click Actions ---

test("'Clic en 'Add to cart' asociado al producto 'X'' extrae associatedEntity", () => {
  const intents = parseStepIntent("Clic en 'Add to cart' asociado al producto 'Sauce Labs Backpack'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Add to cart");
  expect(intents[0].associatedEntity).toBe("Sauce Labs Backpack");
});

test("'Click on 'Remove' associated with product 'X'' extrae associatedEntity", () => {
  const intents = parseStepIntent("Click on 'Remove' associated with product 'Sauce Labs Backpack'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Remove");
  expect(intents[0].associatedEntity).toBe("Sauce Labs Backpack");
});

test("'Clic en 'X' relacionado con 'Y'' extrae associatedEntity", () => {
  const intents = parseStepIntent("Clic en 'Add to cart' relacionado con el producto 'Sauce Labs Backpack'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].associatedEntity).toBe("Sauce Labs Backpack");
});

// --- Step Number Stripping ---

test("step number '1. ' se elimina del texto", () => {
  const intents = parseStepIntent("1. Clic en 'Login'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Login");
});

test("step number '2) ' se elimina del texto", () => {
  const intents = parseStepIntent("2) Iniciar sesión con el dato 'A' y 'B'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("setup_authentication");
  expect(intents[0].valueKeys).toEqual(["A", "B"]);
});

test("step number 'N. ' se elimina del texto", () => {
  const intents = parseStepIntent("3. Validar que se muestre 'Products'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
  expect(intents[0].actionTarget).toBe("Products");
});

// --- classifyStepSet con nuevos tipos ---

test("classifyStepSet pone setup_authentication en setupIntents", () => {
  const intents = parseStepIntent("Iniciar sesión con el dato 'A' y 'B'.");
  const classified = classifyStepSet(intents);
  expect(classified.setupIntents.length).toBe(1);
  expect(classified.setupIntents[0].type).toBe("setup_authentication");
  expect(classified.assertionIntents.length).toBe(0);
  expect(classified.actionIntents.length).toBe(0);
});

test("classifyStepSet pone composite_action en actionIntents", () => {
  const intents = parseStepIntent("Agregar 'Sauce Labs Backpack' al carrito.");
  const classified = classifyStepSet(intents);
  expect(classified.actionIntents.length).toBe(1);
  expect(classified.actionIntents[0].type).toBe("composite_action");
  expect(classified.assertionIntents.length).toBe(0);
  expect(classified.setupIntents.length).toBe(0);
});

test("assertion con slash no se clasifica como navigation_path", () => {
  const intents = parseStepIntent("Validar detalle/listado de productos");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
  expect(intents[0].type).not.toBe("navigation_path");
});

test("esperar con slash se clasifica como assertion", () => {
  const intents = parseStepIntent("Esperar pantalla/resumen final");
  expect(intents[0].type).toBe("assertion");
});

test("click pegado con ruta se divide en click + navigation_path", () => {
  const intents = parseStepIntent("clic en iniciar>Abrir A > B > C");
  expect(intents.length).toBe(2);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("iniciar");
  expect(intents[1].type).toBe("navigation_path");
  expect(intents[1].path).toEqual(["A", "B", "C"]);
});

test("click con separador residual limpia target", () => {
  const intents = parseStepIntent("clic en iniciar>");
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("iniciar");
});

test("cleanActionTarget limpia separadores residuales en extremos", () => {
  expect(cleanActionTarget(" Información de productos > ")).toBe("Información de productos");
  expect(cleanActionTarget("> iniciar")).toBe("iniciar");
  expect(cleanActionTarget("Solicitar.")).toBe("Solicitar");
});

test("no divide emails y dominios por puntos", () => {
  const intents = parseStepIntent("Ingresar correo de prueba usando teclado virtual: correo@empresa.com.do o equivalente configurado.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_fill");
  expect(intents[0].actionTarget).toContain("correo@empresa.com.do");
});

test("no divide urls por puntos", () => {
  const intents = parseStepIntent("Verificar https://example.com/path");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("assertion");
});

// --- Semantic Roles & Relation Contexts ---

test("'Clic en el producto visible relacionado con 'X'' extrae semanticRole 'product' y actionTarget 'X'", () => {
  const intents = parseStepIntent("Clic en el producto visible relacionado con 'X'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("X");
  expect(intents[0].semanticRole).toBe("product");
});

test("'Clic en la opción relacionada con 'Préstamo' dentro de la categoría actual' extrae semanticRole y relationContext", () => {
  const intents = parseStepIntent("Clic en la opción relacionada con 'Préstamo' dentro de la categoría actual.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Préstamo");
  expect(intents[0].semanticRole).toBe("option");
  expect(intents[0].relationContext).toBe("categoría actual");
});

test("'Hacer clic en la card asociada a 'Visa'' extrae semanticRole 'card'", () => {
  const intents = parseStepIntent("Hacer clic en la card asociada a 'Visa'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Visa");
  expect(intents[0].semanticRole).toBe("card");
});

test("'Clic en la categoría relacionada con 'Préstamo'' extrae semanticRole 'category'", () => {
  const intents = parseStepIntent("Clic en la categoría relacionada con 'Préstamo'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Préstamo");
  expect(intents[0].semanticRole).toBe("category");
});

test("'Clic en el ítem relacionado con 'X'' extrae semanticRole 'item'", () => {
  const intents = parseStepIntent("Clic en el ítem asociado a 'X'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("X");
  expect(intents[0].semanticRole).toBe("item");
});

test("'Clic en la sección relacionada con 'Ahorros'' extrae semanticRole 'section'", () => {
  const intents = parseStepIntent("Clic en la sección relacionada con 'Ahorros'.");
  expect(intents.length).toBe(1);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Ahorros");
  expect(intents[0].semanticRole).toBe("section");
});

test("targets repetidos con mismo texto pero roles distintos no se deduplican en parseo", () => {
  const text = "Clic en el producto relacionado con 'A'. Clic en la card asociada a 'A'.";
  const intents = parseStepIntent(text);
  expect(intents.length).toBe(2);
  const product = intents.find(i => i.semanticRole === "product");
  const card = intents.find(i => i.semanticRole === "card");
  expect(product).toBeDefined();
  expect(card).toBeDefined();
  expect(product!.actionTarget).toBe(card!.actionTarget);
  expect(product!.semanticRole).not.toBe(card!.semanticRole);
});

test("no hardcodear textos de productos específicos en step-intent-parser", () => {
  const fs = require("fs");
  const path = require("path");
  const content = fs.readFileSync(path.join(__dirname, "../src/discovery/step-intent-parser.ts"), "utf-8");
  expect(content).not.toContain("Sauce Labs");
  expect(content).not.toContain("Préstamo");
  expect(content).not.toContain("Visa");
  expect(content).not.toContain("Ahorros");
  expect(content).not.toContain("Kiosko");
  expect(content).not.toContain("C37753");
  expect(content).not.toContain("C37853");
});
