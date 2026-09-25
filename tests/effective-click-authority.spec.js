"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const effective_click_authority_1 = require("../src/scenarios/effective-click-authority");
(0, test_1.test)("branchRequiredClicks remain generation metadata, not execution authority", () => {
    const branches = [
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
    const branchRequiredClicks = (0, effective_click_authority_1.collectBranchRequiredClicks)(branches);
    const merged = (0, effective_click_authority_1.mergeEffectiveAllowedClicks)(["Iniciar"], branchRequiredClicks);
    (0, test_1.expect)(branchRequiredClicks).toEqual(["Información de productos", "Transacciones y servicios"]);
    (0, test_1.expect)(merged.effectiveAllowedClicks).toEqual(["Iniciar"]);
    (0, test_1.expect)(merged.addedFromBranchRequired).toBe(0);
});
(0, test_1.test)("protected execution clicks remain allowed without branch hint promotion", () => {
    const routeProfileAllowedClicks = ["Iniciar", "Información de productos"];
    const branchRequiredClicks = ["Transacciones y servicios"];
    const protectedClicks = ["Iniciar", "Detalle de productos"];
    const merged = (0, effective_click_authority_1.mergeEffectiveAllowedClicks)(routeProfileAllowedClicks, branchRequiredClicks, protectedClicks);
    (0, test_1.expect)(merged.effectiveAllowedClicks.length).toBeGreaterThanOrEqual(routeProfileAllowedClicks.length);
    (0, test_1.expect)(merged.effectiveAllowedClicks).toEqual(test_1.expect.arrayContaining(["Iniciar", "Información de productos", "Detalle de productos"]));
    (0, test_1.expect)(merged.effectiveAllowedClicks).not.toContain("Transacciones y servicios");
});
(0, test_1.test)("branch click is not promoted when routeProfile authority is smaller", () => {
    const beforeRepairSnapshot = ["Iniciar", "Información de productos", "Detalle"];
    const intermediateRouteProfileClicks = ["Iniciar", "Información de productos", "Detalle"];
    const branchRequiredClicks = ["Transacciones y servicios"];
    const merged = (0, effective_click_authority_1.mergeEffectiveAllowedClicks)(intermediateRouteProfileClicks, branchRequiredClicks, beforeRepairSnapshot);
    (0, test_1.expect)(beforeRepairSnapshot.length).toBe(3);
    (0, test_1.expect)(merged.effectiveAllowedClicks.length).toBe(3);
    (0, test_1.expect)(merged.effectiveAllowedClicks).not.toContain("Transacciones y servicios");
});
