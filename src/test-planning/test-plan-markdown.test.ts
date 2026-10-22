import assert from "node:assert/strict";
import test from "node:test";
import {
  danglingCoverageTitles,
  gherkinIssues,
  parseTestPlan,
  renameScenarioReferences,
  serializeTestPlan,
  stepKeywordOptions,
  validateEditedScenarios,
  type PlanScenario,
} from "./test-plan-markdown";

const SPANISH = [
  "---",
  "jira_issue: AB-1",
  "status: complete",
  "---",
  "",
  "# AB-1 — plan de pruebas funcionales",
  "",
  "## Cobertura",
  "",
  "| Regla | Escenario(s) |",
  "|---|---|",
  "| 1 | Escenario: Ingreso exitoso; Escenario: Ingreso fallido |",
  "",
  "Camino feliz: **Ingreso exitoso**, incluido abajo.",
  "",
  "## Escenarios",
  "",
  "```gherkin",
  "# language: es",
  "Característica: Ingreso",
  "",
  "  # Regla 1",
  "  Escenario: Ingreso exitoso",
  "    Dado que el cliente tiene credenciales",
  "    Cuando ingresa usuario y contraseña",
  "    Entonces ve el Home",
  "",
  "  # Regla 1 — negativo",
  "  Esquema del escenario: Ingreso fallido",
  "    Dado que el cliente ingresa \"<usuario>\"",
  "    Cuando presiona \"Continuar\"",
  "    Entonces ve el mensaje \"<mensaje>\"",
  "",
  "    Ejemplos:",
  "      | usuario | mensaje        |",
  "      | ana     | Clave inválida |",
  "      | a\\|b   | Usuario raro   |",
  "```",
  "",
].join("\n");

const ENGLISH_NO_FEATURE = [
  "---",
  "jira_issue: AB-2",
  "---",
  "",
  "| 1 | Scenario: First, Scenario: Second |",
  "",
  "```gherkin",
  "Scenario: First",
  "  Given a precondition",
  "  When an action",
  "  Then a result",
  "",
  "Scenario: Second",
  "  Given another precondition",
  "  When another action",
  "  Then another result",
  "```",
  "",
].join("\r\n");

test("unchanged plans serialize byte-for-byte (LF and CRLF)", () => {
  for (const text of [SPANISH, ENGLISH_NO_FEATURE]) {
    const plan = parseTestPlan(text);
    assert.equal(plan.readOnlyReason, null);
    assert.equal(serializeTestPlan(plan, plan.scenarios), text);
  }
  assert.equal(parseTestPlan(ENGLISH_NO_FEATURE).eol, "\r\n");
});

test("parses Spanish plans with outlines, comments and escaped cells", () => {
  const plan = parseTestPlan(SPANISH);
  assert.equal(plan.language, "es");
  assert.deepEqual(plan.frontmatter, { jira_issue: "AB-1", status: "complete" });
  assert.equal(plan.scenarios.length, 2);
  const [ok, failed] = plan.scenarios;
  assert.deepEqual(ok.comments, ["Regla 1"]);
  assert.equal(ok.keyword, "Escenario");
  assert.deepEqual(ok.steps[0], { keyword: "Dado", text: "que el cliente tiene credenciales" });
  assert.equal(failed.keyword, "Esquema del escenario");
  assert.deepEqual(failed.examples[0].header, ["usuario", "mensaje"]);
  assert.deepEqual(failed.examples[0].rows[1], ["a|b", "Usuario raro"]);
  assert.deepEqual(plan.layout, { scenarioIndent: "  ", stepIndent: "    ", examplesIndent: "    ", tableIndent: "      " });
});

test("detects English plans without a language header or Feature line", () => {
  const plan = parseTestPlan(ENGLISH_NO_FEATURE);
  assert.equal(plan.language, "en");
  assert.deepEqual(plan.scenarios.map((s) => s.title), ["First", "Second"]);
  assert.deepEqual(gherkinIssues(ENGLISH_NO_FEATURE, "en"), []);
});

test("only edited scenarios are re-rendered", () => {
  const plan = parseTestPlan(SPANISH);
  const edited: PlanScenario[] = structuredClone(plan.scenarios);
  [edited[0].steps[0], edited[0].steps[1]] = [edited[0].steps[1], edited[0].steps[0]];
  const out = serializeTestPlan(plan, edited);
  assert.ok(out.includes("    Cuando ingresa usuario y contraseña\n    Dado que el cliente tiene credenciales\n"));
  // The untouched outline keeps its original (escaped, hand-aligned) table.
  assert.ok(out.includes("      | a\\|b   | Usuario raro   |"));
  assert.equal(parseTestPlan(out).readOnlyReason, null);
});

test("moving, deleting and adding scenarios keeps blank-line layout", () => {
  const plan = parseTestPlan(ENGLISH_NO_FEATURE);
  const [first, second] = structuredClone(plan.scenarios);
  const added: PlanScenario = {
    id: "new-1",
    comments: ["New"],
    tags: ["@smoke"],
    keyword: "",
    title: "Third",
    steps: [
      { keyword: "Given", text: "x" },
      { keyword: "Then", text: "y" },
    ],
    examples: [],
    locked: null,
  };
  const out = serializeTestPlan(plan, [second, added, first]);
  assert.equal(
    out.split("```gherkin\r\n")[1],
    [
      "Scenario: Second",
      "  Given another precondition",
      "  When another action",
      "  Then another result",
      "",
      "# New",
      "@smoke",
      "Scenario: Third",
      "  Given x",
      "  Then y",
      "",
      "Scenario: First",
      "  Given a precondition",
      "  When an action",
      "  Then a result",
      "```",
      "",
    ].join("\r\n"),
  );
});

test("adding Examples turns a scenario into an outline and aligns the table", () => {
  const plan = parseTestPlan(SPANISH);
  const edited: PlanScenario[] = structuredClone(plan.scenarios);
  edited[0].examples.push({ keyword: "", name: "", header: ["dato"], rows: [["ñandú"], ["b"]] });
  const out = serializeTestPlan(plan, edited);
  assert.ok(out.includes("  Esquema del escenario: Ingreso exitoso\n"));
  assert.ok(out.includes("    Ejemplos:\n      | dato  |\n      | ñandú |\n      | b     |\n"));
  assert.deepEqual(validateEditedScenarios(plan, edited), []);
});

test("unsupported lines lock the scenario but keep the file round-trippable", () => {
  const text = SPANISH.replace("    Entonces ve el Home", "    Entonces ve el Home\n    Y, además, nada más");
  const plan = parseTestPlan(text);
  assert.equal(plan.readOnlyReason, null);
  assert.match(plan.scenarios[0].locked ?? "", /Y, además/);
  assert.equal(serializeTestPlan(plan, plan.scenarios), text);
  assert.equal(gherkinIssues(text, "es").length, 1);
  // Pre-existing problems do not block edits elsewhere.
  const edited: PlanScenario[] = structuredClone(plan.scenarios);
  edited[1].title = "Ingreso fallido por clave";
  assert.deepEqual(validateEditedScenarios(plan, edited), []);
});

test("Background and Rule make the plan read-only", () => {
  const text = SPANISH.replace("Característica: Ingreso\n", "Característica: Ingreso\n\n  Antecedentes:\n    Dado que la app está abierta\n");
  assert.match(parseTestPlan(text).readOnlyReason ?? "", /Antecedentes/);
});

test("plans without a gherkin block are read-only", () => {
  assert.match(parseTestPlan("# solo texto\n").readOnlyReason ?? "", /gherkin/);
});

test("validateEditedScenarios reports incomplete scenarios", () => {
  const plan = parseTestPlan(SPANISH);
  const edited: PlanScenario[] = structuredClone(plan.scenarios);
  edited[0].steps.push({ keyword: "Dado", text: "  " });
  edited[1].examples[0].rows.push(["solo una"]);
  const problems = validateEditedScenarios(plan, edited);
  assert.deepEqual(problems.map((p) => p.id), ["s1", "s2"]);
  assert.match(problems[0].errors.join(), /pasos vacíos/);
  assert.match(problems[1].errors.join(), /columnas/);
});

test("renaming updates coverage references and bold mentions only", () => {
  const plan = parseTestPlan(SPANISH);
  const head = renameScenarioReferences(plan.head, "Ingreso exitoso", "Ingreso exitoso con clave");
  assert.ok(head.includes("| 1 | Escenario: Ingreso exitoso con clave; Escenario: Ingreso fallido |"));
  assert.ok(head.includes("**Ingreso exitoso con clave**"));
  // A title that is a prefix of another must not be touched.
  assert.equal(renameScenarioReferences("Escenario: Ingreso fallido |", "Ingreso", "X"), "Escenario: Ingreso fallido |");
});

test("danglingCoverageTitles lists deleted scenarios still in coverage", () => {
  const plan = parseTestPlan(SPANISH);
  assert.deepEqual(danglingCoverageTitles(plan, [plan.scenarios[1]]), ["Ingreso exitoso"]);
});

test("stepKeywordOptions follows the plan language", () => {
  assert.deepEqual(
    stepKeywordOptions("es").map((o) => o.keyword),
    ["Dado", "Cuando", "Entonces", "Y", "Pero"],
  );
  assert.deepEqual(
    stepKeywordOptions("en").map((o) => o.keyword),
    ["Given", "When", "Then", "And", "But"],
  );
});
