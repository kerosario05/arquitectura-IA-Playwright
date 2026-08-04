import { expect, test } from "@playwright/test";
import {
  collectBranchRequiredClicks,
  mergeEffectiveAllowedClicks,
} from "../src/scenarios/effective-click-authority";
import type { FunctionalBranchRef } from "../src/scenarios/scenario-types";

test("branchRequiredClicks are preserved in effectiveAllowedClicks", () => {
  const branches: FunctionalBranchRef[] = [
    {
      branchId: "branch-public",
      sourceLabel: "Información de productos",
      actionIntent: "select_option",
      expectedDestination: "Módulo público",
      accessIntent: "public",
      evidenceSource: "user_story",
    },
    {
      branchId: "branch-auth",
      sourceLabel: "Transacciones y servicios",
      actionIntent: "start_authentication",
      expectedDestination: "Inicio de autenticación",
      accessIntent: "authenticated",
      evidenceSource: "user_story",
    },
  ];

  const branchRequiredClicks = collectBranchRequiredClicks(branches);
  const merged = mergeEffectiveAllowedClicks(["Iniciar"], branchRequiredClicks);
  expect(branchRequiredClicks).toEqual(["Información de productos", "Transacciones y servicios"]);
  expect(merged.effectiveAllowedClicks).toEqual(
    expect.arrayContaining(["Iniciar", "Información de productos", "Transacciones y servicios"]),
  );
});

test("effectiveAllowedClicks total does not decrease before intermediate repair", () => {
  const routeProfileAllowedClicks = ["Iniciar", "Información de productos"];
  const branchRequiredClicks = ["Transacciones y servicios"];
  const protectedClicks = ["Iniciar", "Transacciones y servicios", "Detalle de productos"];

  const merged = mergeEffectiveAllowedClicks(
    routeProfileAllowedClicks,
    branchRequiredClicks,
    protectedClicks,
  );

  expect(merged.effectiveAllowedClicks.length).toBeGreaterThanOrEqual(routeProfileAllowedClicks.length);
  expect(merged.effectiveAllowedClicks).toEqual(
    expect.arrayContaining(["Transacciones y servicios", "Detalle de productos"]),
  );
});

test("branch click from functional branch is not lost when routeProfile authority is smaller", () => {
  const beforeRepairSnapshot = [
    "Iniciar",
    "Información de productos",
    "Transacciones y servicios",
    "Detalle",
  ];
  const intermediateRouteProfileClicks = ["Iniciar", "Información de productos", "Detalle"];
  const branchRequiredClicks = ["Transacciones y servicios"];
  const merged = mergeEffectiveAllowedClicks(
    intermediateRouteProfileClicks,
    branchRequiredClicks,
    beforeRepairSnapshot,
  );

  expect(beforeRepairSnapshot.length).toBe(4);
  expect(merged.effectiveAllowedClicks.length).toBe(4);
  expect(merged.effectiveAllowedClicks).toContain("Transacciones y servicios");
});
