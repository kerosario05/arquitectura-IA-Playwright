"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_normalizer_1 = require("../src/automations/scenario-normalizer");
function makeRouteProfile() {
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
(0, test_1.test)("canonical registry prefers visual labels over semantic domain terms", () => {
    const registry = (0, scenario_normalizer_1.buildCanonicalLabelRegistry)(makeRouteProfile(), null);
    (0, test_1.expect)(registry.get("prestamos")?.canonical).toBe("Préstamos");
    (0, test_1.expect)(registry.get("prestamos")?.source).toBe("alias");
    (0, test_1.expect)(registry.get("prestamo")?.canonical).toBe("préstamo");
    (0, test_1.expect)(registry.get("prestamo")?.source).toBe("domainTerm");
});
(0, test_1.test)("visualOnly canonical map excludes semantic-only domain terms", () => {
    const map = (0, scenario_normalizer_1.buildCanonicalLabelMap)(makeRouteProfile(), null, {
        visualOnly: true,
        includeDomainTerms: false,
    });
    (0, test_1.expect)(map.get("prestamos")).toBe("Préstamos");
    (0, test_1.expect)(map.get("prestamo")).toBeUndefined();
});
