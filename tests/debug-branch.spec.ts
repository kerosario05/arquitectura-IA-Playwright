import { describe, expect, it } from "vitest";
import { extractFunctionalBranchesFromHu } from "../src/scenarios/scenario-preview.service";

const HU = `
Al seleccionar cualquiera de las opciones del menú principal, el sistema debe:
- "Estados de cuenta": mostrar estados de cuenta del cliente (requiere autenticación)
- "Consulta de balance": mostrar balance consolidado (requiere autenticación)
- "Cartas y certificaciones": emitir carta o certificado (requiere autenticación)
- "Canje de Puntos": canjear puntos por beneficios (requiere autenticación)
- "Explora nuestros productos": redirigir al módulo de información de productos (sin autenticación)
`;

describe("isLikelyBranchOption debug", () => {
  it("single option alone", () => {
    const b = extractFunctionalBranchesFromHu(HU, ["Explora nuestros productos"], [], []);
    console.log("SINGLE", JSON.stringify(b.map(x => ({label:x.sourceLabel, intent:x.accessIntent})), null, 2));
    expect(b.length).toBe(1);
  });
});
