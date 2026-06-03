import { test, expect } from "@playwright/test";
import { buildCanonicalLabelMap, buildCanonicalLabelRegistry } from "../src/automations/scenario-normalizer";
import type { McpRouteProfile } from "../src/scenarios/scenario-types";

function makeRouteProfile(): McpRouteProfile {
  return {
    name: "informacion_productos",
    entry: [
      { businessLabel: "iniciar", visibleLabel: "Iniciar" },
      { businessLabel: "informacion_productos", visibleLabel: "Información de productos" },
    ],
    aliases: {
      prestamos: "Préstamos",
    },
    intermediates: {},
    domainTerms: {
      producto: ["producto", "préstamo"],
    },
    visibleControls: ["Iniciar", "Información de productos", "Préstamos", "Finalizar sesión"],
    representativeFixture: {},
    notes: [],
  };
}

test("canonical registry prefers visual labels over semantic domain terms", () => {
  const registry = buildCanonicalLabelRegistry(makeRouteProfile(), null);

  expect(registry.get("prestamos")?.canonical).toBe("Préstamos");
  expect(registry.get("prestamos")?.source).toBe("alias");
  expect(registry.get("prestamo")?.canonical).toBe("préstamo");
  expect(registry.get("prestamo")?.source).toBe("domainTerm");
});

test("visualOnly canonical map excludes semantic-only domain terms", () => {
  const map = buildCanonicalLabelMap(makeRouteProfile(), null, {
    visualOnly: true,
    includeDomainTerms: false,
  });

  expect(map.get("prestamos")).toBe("Préstamos");
  expect(map.get("prestamo")).toBeUndefined();
});
