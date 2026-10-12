import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKnowledgeSections,
  buildProjectContextText,
  humanText,
  parseKnowledgeItems,
  readKnowledgeItems,
  summarize,
} from "./project-knowledge-context";

// Shapes taken from a real ProjectKnowledge row (app-conversacional).
const items = [
  {
    knowledgeKind: "route_menu_snapshot",
    screenKey: "bienvenido",
    trustedForReuse: true,
    assertionTargets: ["Bienvenido", "Usuario", "Contraseña", "¿Primera vez aquí?", "Crea tu cuenta en minutos"],
    clickTargets: ["example@gmail.com", "", ", ¿Primera vez aquí?, Crea tu cuenta en minutos, "],
  },
  {
    knowledgeKind: "route_menu_snapshot",
    screenKey: "home",
    assertionTargets: ["Home", "Play Store", "Gmail", "Photos", "YouTube"],
  },
  {
    knowledgeKind: "route_menu_snapshot",
    screenKey: "screen_cdca129ce8",
    assertionTargets: ["No pudimos realizar esta validación exitosamente.", "Ir al inicio"],
  },
  {
    knowledgeKind: "route_menu_snapshot",
    screenKey: "firma_de_documentos",
    assertionTargets: ["Firma de documentos", "Enviar código", "(829) ***-**00", "402-12345678-9"],
  },
  {
    knowledgeKind: "route_functional_observed",
    validationStatus: "validated",
    steps: ['new UiSelector().descriptionContains("Crea tu cuenta en minutos")', "Continuar"],
  },
  { knowledgeKind: "route_functional_observed", validationStatus: "pending", steps: ["No validado"] },
  { knowledgeKind: "hu_declared", expectedBehavior: "La sesión termina tras inactividad", sourceIssueKey: "AA-93" },
  { knowledgeKind: "hu_declared", expectedBehavior: "Mostrar nueva pantalla principal", sourceIssueKey: "AA-88" },
  { knowledgeKind: "route_transition", actionDescription: "click" },
];

test("humanText keeps what a tester reads and drops selectors, emails and data values", () => {
  assert.equal(humanText('new UiSelector().descriptionContains("Crea tu cuenta")'), "Crea tu cuenta");
  assert.equal(humanText(", ¿Primera vez aquí?, Crea tu cuenta, "), "¿Primera vez aquí?, Crea tu cuenta");
  assert.equal(humanText("example@gmail.com"), "");
  assert.equal(humanText("(829) ***-**00"), "");
  assert.equal(humanText("402-12345678-9"), "");
  assert.equal(humanText("new UiSelector().resourceId(\"x\")"), "");
  assert.equal(humanText(42), "");
});

test("screens: real titles, no launcher, no concatenated duplicates or data values", () => {
  const { screenLines } = buildKnowledgeSections(items);
  assert.deepEqual(screenLines, [
    "- Bienvenido: Usuario | Contraseña | ¿Primera vez aquí? | Crea tu cuenta en minutos",
    "- No pudimos realizar esta validación exitosamente.: Ir al inicio",
    "- Firma de documentos: Enviar código",
  ]);
});

test("flows: only validated ones, in readable steps", () => {
  assert.deepEqual(buildKnowledgeSections(items).flowLines, ["- Crea tu cuenta en minutos → Continuar"]);
});

test("behaviours: skip the story being designed, cite the others", () => {
  assert.deepEqual(buildKnowledgeSections(items, "aa-88").behaviourLines, [
    "- La sesión termina tras inactividad (AA-93)",
  ]);
  assert.equal(buildKnowledgeSections(items).behaviourLines.length, 2);
});

test("the context names the product and lists each section; summary counts them", () => {
  const sections = buildKnowledgeSections(items);
  const text = buildProjectContextText(
    { name: "App Conversacional", projectType: 2, web: null, mobile: { appName: "App Conversacional", platform: "android" } as never },
    sections,
  );
  assert.match(text, /^Proyecto: App Conversacional — Aplicación móvil "App Conversacional" \(android\)\./);
  assert.match(text, /Pantallas conocidas/);
  assert.match(text, /Recorridos validados/);
  assert.match(text, /Comportamientos definidos en otras historias/);
  assert.deepEqual(summarize(sections), { screens: 3, flows: 1, behaviours: 2, total: 6 });
});

test("reads ProjectKnowledge first and app.knowledge.json only when SQL has nothing", () => {
  const fileJson = JSON.stringify({ version: 1, items: [items[0], items[2]] });
  const reads: string[] = [];
  const readFile = (file: string) => {
    reads.push(file);
    return fileJson;
  };

  const fromDb = readKnowledgeItems({ slug: "app", knowledge: { knowledgeJson: JSON.stringify({ items }) } as never }, readFile);
  assert.equal(fromDb.length, items.length);
  assert.equal(reads.length, 0, "the file is not read when SQL has items");

  const emptyDb = readKnowledgeItems({ slug: "app", knowledge: { knowledgeJson: '{"items":[]}' } as never }, readFile);
  assert.equal(emptyDb.length, 2);
  assert.ok(reads[0].replace(/\\/g, "/").endsWith("automations/apps/app/app.knowledge.json"));

  assert.equal(readKnowledgeItems({ slug: "app", knowledge: null }, readFile).length, 2);
  assert.deepEqual(readKnowledgeItems({ slug: "app", knowledge: null }, () => null), []);
});

test("an empty project still names itself; bad JSON yields no items", () => {
  const empty = buildKnowledgeSections([]);
  const text = buildProjectContextText(
    { name: "Kiosko", projectType: 1, web: { baseUrl: "https://kiosko.local/" } as never, mobile: null },
    empty,
  );
  assert.equal(text, "Proyecto: Kiosko — Aplicación web en https://kiosko.local/.");
  assert.deepEqual(parseKnowledgeItems("no es json"), []);
  assert.deepEqual(parseKnowledgeItems(JSON.stringify({ items })).length, items.length);
  assert.deepEqual(parseKnowledgeItems(Buffer.from(JSON.stringify({ items: [items[0]] }), "utf16le")).length, 1);
});
