import { test, expect } from "@playwright/test";
import { extractHuFunctionalClickTargets } from "../src/scenarios/effective-click-authority";
import { buildRequirementAccounting } from "../src/scenarios/scenario-functional-quality";

test("quoted and named unquoted targets are preserved", () => {
  const huText = [
    'Seleccionar "Acción Alfa".',
    'Hacer clic en botón "Acción Beta".',
    "Seleccionar Productos.",
  ].join(" ");

  const targets = extractHuFunctionalClickTargets(huText);

  expect(targets).toContain("Acción Alfa");
  expect(targets).toContain("Acción Beta");
  expect(targets).toContain("Productos");
});

test("generic determiner references are rejected as click targets", () => {
  const huText = [
    "Seleccionar un elemento.",
    "Seleccionar este tipo.",
    "Seleccionar uno de los elementos.",
    "Seleccionar un producto.",
  ].join(" ");

  const targets = extractHuFunctionalClickTargets(huText);

  expect(targets).not.toContain("un elemento");
  expect(targets).not.toContain("este tipo");
  expect(targets).not.toContain("uno de los elementos");
  expect(targets).not.toContain("un producto");
  expect(targets.length).toBe(0);
});

test("narrative obligation can still remain a functional requirement", () => {
  const huText = "Seleccionar un elemento de la lista para continuar.";

  const targets = extractHuFunctionalClickTargets(huText);
  expect(targets).toHaveLength(0);

  const acct = buildRequirementAccounting([], [], huText, "GEN");
  const obligations = acct.requirements.filter(
    (r) => r.category === "action" || r.category === "prerequisite",
  );
  expect(obligations.length).toBeGreaterThanOrEqual(1);
});