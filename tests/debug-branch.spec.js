"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
const HU = `
Al seleccionar cualquiera de las opciones del menú principal, el sistema debe:
- "Estados de cuenta": mostrar estados de cuenta del cliente (requiere autenticación)
- "Consulta de balance": mostrar balance consolidado (requiere autenticación)
- "Cartas y certificaciones": emitir carta o certificado (requiere autenticación)
- "Canje de Puntos": canjear puntos por beneficios (requiere autenticación)
- "Explora nuestros productos": redirigir al módulo de información de productos (sin autenticación)
`;
(0, vitest_1.describe)("isLikelyBranchOption debug", () => {
    (0, vitest_1.it)("single option alone", () => {
        const b = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU, ["Explora nuestros productos"], [], []);
        console.log("SINGLE", JSON.stringify(b.map(x => ({ label: x.sourceLabel, intent: x.accessIntent })), null, 2));
        (0, vitest_1.expect)(b.length).toBe(1);
    });
});
