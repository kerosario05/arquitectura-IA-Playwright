import assert from "node:assert/strict";
import test from "node:test";
import {
  findPublishIssues,
  MAX_TITLE_LENGTH,
  normalizeScenario,
  normalizeScenarios,
  TestDesignValidationError,
} from "./test-design.validation";

test("fills defaults and trims text", () => {
  const s = normalizeScenario({ title: "  Login válido ", steps: [{ action: " Ingresar ", expected: " Ok " }] }, 0);
  assert.equal(s.title, "Login válido");
  assert.deepEqual(s.steps, [{ action: "Ingresar", expected: "Ok" }]);
  assert.equal(s.priority, "medium");
  assert.equal(s.type, "functional");
  assert.equal(s.selectedForTestRail, true);
  assert.equal(s.selectedForJira, true);
  assert.equal(s.testRailCaseId, null);
  assert.equal(s.origin, "manual");
  assert.equal(s.edited, false);
  assert.match(s.id, /^[0-9a-f-]{36}$/);
});

test("keeps the given id, origin, selections and edited flag", () => {
  const s = normalizeScenario(
    { id: "sc-1", title: "x", origin: "ai", selectedForTestRail: false, selectedForJira: true, edited: true },
    0,
  );
  assert.equal(s.id, "sc-1");
  assert.equal(s.origin, "ai");
  assert.equal(s.selectedForTestRail, false);
  assert.equal(s.edited, true);
});

test("uses the origin default when none is given", () => {
  assert.equal(normalizeScenario({ title: "x" }, 0, { origin: "ai" }).origin, "ai");
});

test("accepts plain-string steps and drops blank rows", () => {
  const s = normalizeScenario({ title: "x", steps: ["Abrir", { action: "", expected: "" }, { action: "Guardar" }] }, 0);
  assert.deepEqual(s.steps, [
    { action: "Abrir", expected: "" },
    { action: "Guardar", expected: "" },
  ]);
});

test("accepts TestRail ids written as C1234", () => {
  assert.equal(normalizeScenario({ title: "x", testRailCaseId: "C1234" }, 0).testRailCaseId, 1234);
  assert.throws(() => normalizeScenario({ title: "x", testRailCaseId: "abc" }, 0), TestDesignValidationError);
});

test("rejects wrong shapes instead of guessing", () => {
  assert.throws(() => normalizeScenarios({}), TestDesignValidationError);
  assert.throws(() => normalizeScenario("texto", 0), TestDesignValidationError);
  assert.throws(() => normalizeScenario({ title: 5 }, 0), TestDesignValidationError);
  assert.throws(() => normalizeScenario({ title: "x", steps: "uno" }, 0), TestDesignValidationError);
  assert.throws(
    () => normalizeScenario({ title: "x".repeat(MAX_TITLE_LENGTH + 1) }, 0),
    TestDesignValidationError,
  );
});

test("rejects repeated scenario ids", () => {
  assert.throws(
    () => normalizeScenarios([{ id: "a", title: "1" }, { id: "a", title: "2" }]),
    /repetido/,
  );
});

test("publish checks only look at scenarios selected for that destination", () => {
  const scenarios = normalizeScenarios([
    { id: "ok", title: "Completo", steps: [{ action: "Abrir", expected: "Abre" }] },
    { id: "untitled", title: "", steps: [{ action: "Abrir" }], expectedResult: "Abre", selectedForJira: false },
    { id: "nosteps", title: "Sin pasos", expectedResult: "algo", selectedForTestRail: false },
  ]);

  assert.deepEqual(
    findPublishIssues(scenarios, "testrail").map((i) => [i.scenarioId, i.problem]),
    [["untitled", "sin título"]],
  );
  assert.deepEqual(
    findPublishIssues(scenarios, "jira").map((i) => [i.scenarioId, i.problem]),
    [["nosteps", "sin pasos"]],
  );
});

test("a scenario needs an expected result somewhere", () => {
  const [s] = normalizeScenarios([{ id: "a", title: "x", steps: [{ action: "Abrir" }] }]);
  assert.deepEqual(findPublishIssues([s], "testrail").map((i) => i.problem), ["sin resultado esperado"]);
});
