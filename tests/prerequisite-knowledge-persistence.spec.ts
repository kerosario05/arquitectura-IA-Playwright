import { test, expect } from "@playwright/test";
import { buildRequirementAccounting } from "../src/scenarios/scenario-functional-quality";
import { extractHuDeclaredItems } from "../src/knowledge/hu-declared-persister";

const HU_WITH_PREREQS = [
  "Para continuar debe seleccionar Iniciar.",
  "Antes de continuar haga clic en Continuar.",
  "El usuario consulta su saldo.",
].join(" ");

test("explicit prerequisites enter requirementAccounting and hu_declared Knowledge with dynamic targets", () => {
  const accounting = buildRequirementAccounting([], [], HU_WITH_PREREQS, "HU-TEST-1");

  const prerequisiteRequirements = accounting.requirements.filter((r) => r.category === "prerequisite");
  expect(prerequisiteRequirements).toHaveLength(2);

  const items = extractHuDeclaredItems(accounting, [], "HU-TEST-1");
  const prerequisiteItems = items.filter((i) => i.category === "prerequisite");
  expect(prerequisiteItems).toHaveLength(2);

  // Two DIFFERENT targets prove the extraction is generic (no label hardcode).
  const targets = prerequisiteItems.map((i) => i.actionTarget).sort();
  expect(targets).toEqual(["Continuar", "Iniciar"]);

  const iniciar = prerequisiteItems.find((i) => i.actionTarget === "Iniciar")!;
  expect(iniciar.actionIntent).toBe("select");
  const continuar = prerequisiteItems.find((i) => i.actionTarget === "Continuar")!;
  expect(continuar.actionIntent).toBe("click");

  for (const item of prerequisiteItems) {
    // HU-declared knowledge contract — never runtime authority.
    expect(item.source).toBe("hu_declared");
    expect(item.knowledgeKind).toBe("hu_declared");
    expect(item.validationStatus).toBe("pending");
    expect(item.executionBacked).toBe(false);
    expect(item.trustedForReuse).toBe(false);
    // Only what the HU declares is persisted — destination/origin are absent.
    expect(item.expectedDestination).toBeUndefined();
    expect(item.destinationScreenKey).toBeUndefined();
    expect(item.screenKey).toBeUndefined();
  }
});

test("narrative sentence produces no prerequisite item", () => {
  const accounting = buildRequirementAccounting([], [], "El usuario consulta su saldo.", "HU-TEST-2");
  expect(accounting.requirements.filter((r) => r.category === "prerequisite")).toHaveLength(0);

  const items = extractHuDeclaredItems(accounting, [], "HU-TEST-2");
  expect(items.filter((i) => i.category === "prerequisite")).toHaveLength(0);
});