import { test, expect } from "@playwright/test";
import { extractPrerequisiteTargets } from "../src/scenarios/scenario-functional-quality";

test("negative blocking select prerequisite → quoted target with select intent", () => {
  const huText = 'No debe permitirse avanzar sin que el usuario seleccione el botón "Acción Alfa".';

  const targets = extractPrerequisiteTargets(huText);

  expect(targets.length).toBe(1);
  expect(targets[0].actionTarget).toBe("Acción Alfa");
  expect(targets[0].actionIntent).toBe("select");
});

test("negative blocking click prerequisite → quoted target with click intent", () => {
  const huText = 'No debe permitirse continuar sin que el usuario haga clic en "Acción Beta".';

  const targets = extractPrerequisiteTargets(huText);

  expect(targets.length).toBe(1);
  expect(targets[0].actionTarget).toBe("Acción Beta");
  expect(targets[0].actionIntent).toBe("click");
});

test("negative control → no prerequisite for non-blocking 'sin que'", () => {
  const huText = "El sistema muestra un mensaje sin que el usuario intervenga.";

  const targets = extractPrerequisiteTargets(huText);

  expect(targets.length).toBe(0);
});