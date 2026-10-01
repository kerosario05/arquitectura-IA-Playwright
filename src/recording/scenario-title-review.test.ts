import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { RecordedScenario } from "./trace-to-scenario";
import { keepReviewerTitles, loadTitleCatalog, renameScenarioTitle, reviewScenarioTitles, scenarioTitleKey, type TitleCatalogEntry } from "./scenario-title-review";

function scenario(scenarioId: string, title: string, scenarioGoal?: string): RecordedScenario {
  return { scenarioId, title, ...(scenarioGoal ? { scenarioGoal } : {}) } as RecordedScenario;
}

function entry(source: "recording" | "case", id: string, title: string, extra: Partial<TitleCatalogEntry> = {}): TitleCatalogEntry {
  return { source, id, title, key: scenarioTitleKey(title), ...extra };
}

test("accents, case, punctuation, connectors, verb/noun and plurals do not make titles different", () => {
  assert.equal(scenarioTitleKey("Consulta de préstamo"), scenarioTitleKey("Consulta prestamo"));
  assert.equal(scenarioTitleKey("Consultar Tarjeta"), scenarioTitleKey("Consulta tarjetas"));
  assert.equal(
    scenarioTitleKey("Desde ¡Hola!: Estados de cuenta > Cancelar"),
    scenarioTitleKey("desde hola estados cuenta cancelar"),
  );
  assert.notEqual(scenarioTitleKey("Desde ¡Hola!: Estados de cuenta"), scenarioTitleKey("Desde ¡Hola!: Estados de cuenta > Cancelar"));
});

test("reports the same title in another recording and in a promoted case", () => {
  const title = "Desde ¡Hola!: Explora nuestros productos > … > Préstamo Personal > Solicitar > Generar Turno";
  const reviews = reviewScenarioTitles([scenario("REC-AAAAAAAA-01", title)], [
    entry("recording", "REC-AAAAAAAA-01", title, { recordingId: "aaaaaaaa" }),
    entry("recording", "REC-BBBBBBBB-01", title, { recordingId: "bbbbbbbb" }),
    entry("case", "preview-001-prestamo", "Desde Hola: Explora nuestros productos > … > Préstamo personal > Solicitar > Generar turno"),
    entry("case", "preview-001-tarjeta", "Tarjeta"),
  ]);
  const review = reviews["REC-AAAAAAAA-01"];
  assert.deepEqual(review.conflicts.map((conflict) => conflict.id), ["REC-BBBBBBBB-01", "preview-001-prestamo"]);
  assert.deepEqual(review.reasons, ["duplicate_title"]);
  assert.equal(review.weak, false);
});

test("the case promoted from the scenario itself is not a duplicate", () => {
  const reviews = reviewScenarioTitles([scenario("REC-AAAAAAAA-01", "Desde ¡Hola!: Estados de cuenta")], [
    entry("case", "rec-aaaaaaaa-01-desde-hola", "Desde ¡Hola!: Estados de cuenta", { sourceScenarioId: "REC-AAAAAAAA-01" }),
  ]);
  assert.deepEqual(reviews["REC-AAAAAAAA-01"].conflicts, []);
});

test("two scenarios of the same recording with one title conflict with each other", () => {
  const reviews = reviewScenarioTitles(
    [scenario("REC-AAAAAAAA-01", "Desde ¡Hola!: Canje de Puntos"), scenario("REC-AAAAAAAA-01-ALT-1", "Desde ¡Hola!: Canje de puntos")],
    [],
  );
  assert.deepEqual(reviews["REC-AAAAAAAA-01"].conflicts.map((conflict) => conflict.id), ["REC-AAAAAAAA-01-ALT-1"]);
});

test("a title that is only the typed goal and names nothing is weak", () => {
  const reviews = reviewScenarioTitles(
    [scenario("REC-1-01", "roque 10", "roque 10"), scenario("REC-2-01", "Prueba", "Prueba"), scenario("REC-3-01", "Consultar balance de la cuenta", "Consultar balance de la cuenta")],
    [],
  );
  assert.deepEqual(reviews["REC-1-01"].reasons, ["typed_goal_title", "generic_title"]);
  assert.equal(reviews["REC-1-01"].weak, true);
  assert.equal(reviews["REC-2-01"].weak, true);
  // A descriptive goal is still flagged as typed, but it is not weak.
  assert.deepEqual(reviews["REC-3-01"].reasons, ["typed_goal_title"]);
  assert.equal(reviews["REC-3-01"].weak, false);
});

test("the catalog reads recording scenarios and promoted cases from disk", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "title-catalog-"));
  try {
    const caseDir = path.join(root, "app", "sections", "default-section", "cases", "preview-001-roque-10");
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, "case.meta.json"), JSON.stringify({ title: "roque 10", sourceScenarioId: "PREVIEW-001" }));
    fs.mkdirSync(path.join(root, "app", "sections", "default-section", "cases", "no-meta"), { recursive: true });

    const catalog = loadTitleCatalog("app", root);
    assert.deepEqual(catalog.map((item) => [item.source, item.id, item.title]), [["case", "preview-001-roque-10", "roque 10"]]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("renaming changes only the title and marks it as the reviewer's", () => {
  const scenarios = [scenario("REC-1-01", "Desde ¡Hola!: Estados de cuenta"), scenario("REC-1-01-ALT-1", "Desde ¡Hola!: Canje de Puntos")];
  const renamed = renameScenarioTitle(scenarios, "REC-1-01", "  Consultar   estado de cuenta por cédula ");
  assert.equal(renamed.ok, true);
  if (!renamed.ok) return;
  assert.equal(renamed.scenario.title, "Consultar estado de cuenta por cédula");
  assert.equal(renamed.scenario.titleEditedByUser, true);
  assert.deepEqual(renamed.scenarios.map((item) => item.title), ["Consultar estado de cuenta por cédula", "Desde ¡Hola!: Canje de Puntos"]);
});

test("renaming refuses a title too short to name a case, or an unknown scenario", () => {
  const scenarios = [scenario("REC-1-01", "Desde ¡Hola!: Estados de cuenta")];
  assert.deepEqual(renameScenarioTitle(scenarios, "REC-1-01", " ab "), { ok: false, code: "TITLE_TOO_SHORT" });
  assert.deepEqual(renameScenarioTitle(scenarios, "REC-9-01", "Un título válido"), { ok: false, code: "SCENARIO_NOT_FOUND" });
});

test("regenerating a recording keeps the titles a reviewer typed, and only those", () => {
  const previous = [
    { ...scenario("REC-1-01", "Consultar estado de cuenta"), titleEditedByUser: true },
    scenario("REC-1-01-ALT-1", "Desde ¡Hola!: Canje de Puntos"),
  ];
  const regenerated = [scenario("REC-1-01", "Desde ¡Hola!: Estados de cuenta > Cancelar"), scenario("REC-1-01-ALT-1", "Desde ¡Hola!: Canje de puntos nuevo")];
  const kept = keepReviewerTitles(regenerated, previous);
  assert.deepEqual(kept.map((item) => item.title), ["Consultar estado de cuenta", "Desde ¡Hola!: Canje de puntos nuevo"]);
  assert.equal(kept[0].titleEditedByUser, true);
  assert.equal(kept[1].titleEditedByUser, undefined);
});
