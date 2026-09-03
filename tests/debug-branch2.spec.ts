import { extractFunctionalBranchesFromHu } from "../src/scenarios/scenario-preview.service";

const HU = `
Al seleccionar cualquiera de las opciones del menú principal, el sistema debe:
- "Estados de cuenta": mostrar estados de cuenta del cliente (requiere autenticación)
- "Consulta de balance": mostrar balance consolidado (requiere autenticación)
- "Cartas y certificaciones": emitir carta o certificado (requiere autenticación)
- "Canje de Puntos": canjear puntos por beneficios (requiere autenticación)
- "Explora nuestros productos": redirigir al módulo de información de productos (sin autenticación)
`;

const branches = extractFunctionalBranchesFromHu(
  HU,
  ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos", "Explora nuestros productos"],
  [],
  [],
);
console.log("BRANCHES", JSON.stringify(branches.map(b => ({label: b.sourceLabel, intent: b.accessIntent, dest: b.expectedDestination?.slice(0, 40)})), null, 2));
console.log("COUNTS", JSON.stringify({
  total: branches.length,
  auth: branches.filter(b => b.accessIntent === "authenticated").length,
  public: branches.filter(b => b.accessIntent === "public").length,
  unknown: branches.filter(b => b.accessIntent === "unknown").length,
}));
