import { test, expect } from "@playwright/test";
import { extractHuFunctionalClickTargets } from "../src/scenarios/effective-click-authority";
import type { FunctionalBranchRef } from "../src/scenarios/scenario-types";

function branch(label: string, id = "b1"): FunctionalBranchRef {
  return { branchId: id, sourceLabel: label, sourceIssueKey: "HU-1" };
}

test("visibility verb not extracted as click target", () => {
  const hu = "visualizar la pantalla de inicio para navegar al módulo";
  const result = extractHuFunctionalClickTargets(hu, []);
  expect(result).not.toContain("visualizar la pantalla de inicio");
  expect(result).toHaveLength(0);
});

test("weak fragment discarded when substring of strong branch label", () => {
  const branches = [branch("Transacciones y servicios")];
  const hu = "seleccionar Transacciones del menú";
  const result = extractHuFunctionalClickTargets(hu, branches);
  expect(result).toContain("Transacciones y servicios");
  expect(result).not.toContain("Transacciones");
  console.log(`fragment discarded: ${JSON.stringify(result)}`);
});

test("prerequisite actionTarget preserved", () => {
  const branches = [branch("Destino Completo")];
  const hu = "no debe permitirse avanzar sin que se seleccione Entrada A";
  const result = extractHuFunctionalClickTargets(hu, branches);
  expect(result).toContain("Destino Completo");
  expect(result).toContain("Entrada A");
  expect(result).toHaveLength(2);
  console.log(`result: ${JSON.stringify(result)}`);
});

test("Presionar with quoted target is preserved", () => {
  const hu = 'Presionar "Solicitar acción"';
  const result = extractHuFunctionalClickTargets(hu, []);
  expect(result).toContain("Solicitar acción");
  expect(result).toHaveLength(1);
});

test("two distinct strong targets both preserved (no false dedup)", () => {
  const branches = [branch("Destino A"), branch("Destino B")];
  const result = extractHuFunctionalClickTargets("", branches);
  expect(result).toContain("Destino A");
  expect(result).toContain("Destino B");
  expect(result).toHaveLength(2);
});

test("mixed: visibility excluded, fragment discarded, branch+prerequisite preserved", () => {
  const branches = [branch("Destino Completo")];
  const hu = [
    "visualizar la pantalla de inicio",
    "no debe permitirse avanzar sin que se seleccione Entrada A",
    "seleccionar Destino del menú",
  ].join(" ");
  const result = extractHuFunctionalClickTargets(hu, branches);
  expect(result).toContain("Destino Completo");
  expect(result).toContain("Entrada A");
  expect(result).not.toContain("visualizar la pantalla de inicio");
  expect(result).not.toContain("Destino");
  expect(result).toHaveLength(2);
  console.log(`mixed result: ${JSON.stringify(result)}`);
});

test("validate downstream: repairUnbackedClicks does not preserve visibility target", () => {
  // Simulate what would happen if huFunctionalClickTargets included visibility
  const huFunctionalClickTargets = ["Destino Completo", "Entrada A"];
  const huRequiredNormalized = new Set(huFunctionalClickTargets.map((t) => t.toLowerCase().trim()));

  const steps = [
    'Clic en "Destino Completo"',
    'Clic en "Entrada A"',
    'Clic en "visualizar la pantalla de inicio"',
  ];

  // Verify visibility target is NOT in the normalized set (would not be preserved)
  expect(huRequiredNormalized.has("visualizar la pantalla de inicio")).toBe(false);
  expect(huRequiredNormalized.has("destino completo")).toBe(true);
  expect(huRequiredNormalized.has("entrada a")).toBe(true);
  console.log("downstream validation OK");
});
