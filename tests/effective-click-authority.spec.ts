import { expect, test } from "@playwright/test";
import {
  collectBranchRequiredClicks,
  mergeEffectiveAllowedClicks,
} from "../src/scenarios/effective-click-authority";
import type { FunctionalBranchRef } from "../src/scenarios/scenario-types";

test("branchRequiredClicks remain generation metadata, not execution authority", () => {
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
  expect(merged.effectiveAllowedClicks).toEqual(["Iniciar"]);
  expect(merged.addedFromBranchRequired).toBe(0);
});

test("protected execution clicks remain allowed without branch hint promotion", () => {
  const routeProfileAllowedClicks = ["Iniciar", "Información de productos"];
  const branchRequiredClicks = ["Transacciones y servicios"];
  const protectedClicks = ["Iniciar", "Detalle de productos"];

  const merged = mergeEffectiveAllowedClicks(
    routeProfileAllowedClicks,
    branchRequiredClicks,
    protectedClicks,
  );

  expect(merged.effectiveAllowedClicks.length).toBeGreaterThanOrEqual(routeProfileAllowedClicks.length);
  expect(merged.effectiveAllowedClicks).toEqual(
    expect.arrayContaining(["Iniciar", "Información de productos", "Detalle de productos"]),
  );
  expect(merged.effectiveAllowedClicks).not.toContain("Transacciones y servicios");
});

test("branch click is not promoted when routeProfile authority is smaller", () => {
  const beforeRepairSnapshot = ["Iniciar", "Información de productos", "Detalle"];
  const intermediateRouteProfileClicks = ["Iniciar", "Información de productos", "Detalle"];
  const branchRequiredClicks = ["Transacciones y servicios"];
  const merged = mergeEffectiveAllowedClicks(
    intermediateRouteProfileClicks,
    branchRequiredClicks,
    beforeRepairSnapshot,
  );

  expect(beforeRepairSnapshot.length).toBe(3);
  expect(merged.effectiveAllowedClicks.length).toBe(3);
  expect(merged.effectiveAllowedClicks).not.toContain("Transacciones y servicios");
});
