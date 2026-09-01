import { test, expect } from "@playwright/test";
import { extractPrerequisiteTargets } from "../src/scenarios/scenario-functional-quality";
import { extractHuFunctionalClickTargets } from "../src/scenarios/effective-click-authority";

const HU_TEXT = [
  "Para continuar debe seleccionar Opción Alfa.",
  "Antes de continuar haga clic en Acción Beta.",
].join(" ");

test("same prerequisite clause → requirementAccounting target = huFunctionalClickTargets target", () => {
  const prerequisiteTargets = extractPrerequisiteTargets(HU_TEXT);
  const prereqKeys = prerequisiteTargets.map((p) => p.actionTarget);

  const huTargets = extractHuFunctionalClickTargets(HU_TEXT);

  expect(prereqKeys.length).toBeGreaterThanOrEqual(2);

  for (const key of prereqKeys) {
    expect(
      huTargets.some((t) => t.toLowerCase().includes(key.toLowerCase())),
      `huFunctionalClickTargets must include prerequisite target "${key}"`,
    ).toBeTruthy();
  }
});

test("different verb variants → same shared targets", () => {
  const huText = [
    "Para continuar debe seleccionar Opción Alfa.",
    "Antes de continuar haga clic en Acción Beta.",
    "Primero seleccionar Elemento Gamma.",
  ].join(" ");

  const prerequisiteTargets = extractPrerequisiteTargets(huText);
  const prereqKeys = prerequisiteTargets.map((p) => p.actionTarget);

  const huTargets = extractHuFunctionalClickTargets(huText);

  expect(prereqKeys.length).toBeGreaterThanOrEqual(3);

  for (const key of prereqKeys) {
    expect(
      huTargets.some((t) => t.toLowerCase().includes(key.toLowerCase())),
      `huFunctionalClickTargets must include prerequisite target "${key}"`,
    ).toBeTruthy();
  }
});

test("narrative sentence → no prerequisite targets from either extractor", () => {
  const narrative = "El usuario observa la pantalla principal y espera a que se carguen los datos.";

  const prereqTargets = extractPrerequisiteTargets(narrative);
  const huTargets = extractHuFunctionalClickTargets(narrative);

  expect(prereqTargets.length).toBe(0);
  expect(huTargets.length).toBe(0);
});
