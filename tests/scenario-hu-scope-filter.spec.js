"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_hu_scope_filter_1 = require("../src/scenarios/scenario-hu-scope-filter");
test_1.test.describe("HU Scope Filter - Product Alignment", () => {
    (0, test_1.test)("HU de tarjetas + catálogo tarjetas/cuentas/préstamos → seeds solo tarjetas", () => {
        const issue = {
            key: "AA-123",
            summary: "Visualizar tarjetas de crédito disponibles",
            description: "Como usuario quiero ver todas las tarjetas de crédito para elegir una",
            acceptanceCriteria: "Se muestran tarjetas Visa, Mastercard y opciones de crédito",
            labels: ["tarjetas", "credito"],
            components: ["Banca Digital"],
            status: "In Progress",
            issueType: "Story",
        };
        const targetPaths = {
            "Tarjeta Crédito Visa Clásica": {
                target: "Tarjeta Crédito Visa Clásica",
                requiredIntermediates: ["Inicio", "Tarjetas"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Tarjetas",
                    subcategory: "Crédito",
                    variant: "Visa",
                    productLabel: "Tarjeta Crédito Visa Clásica",
                    normalizedLabel: "tarjeta_credito_visa_clasica",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
            "Tarjeta Crédito Mastercard Gold": {
                target: "Tarjeta Crédito Mastercard Gold",
                requiredIntermediates: ["Inicio", "Tarjetas"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Tarjetas",
                    subcategory: "Crédito",
                    variant: "Mastercard",
                    productLabel: "Tarjeta Crédito Mastercard Gold",
                    normalizedLabel: "tarjeta_credito_mastercard_gold",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
            "Cuenta de Ahorros Personal en Pesos": {
                target: "Cuenta de Ahorros Personal en Pesos",
                requiredIntermediates: ["Inicio", "Cuentas"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Cuentas de Efectivo",
                    subcategory: "Ahorros",
                    variant: "Pesos",
                    productLabel: "Cuenta de Ahorros Personal en Pesos",
                    normalizedLabel: "cuenta_ahorros_personal_pesos",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
            "Préstamo Personal": {
                target: "Préstamo Personal",
                requiredIntermediates: ["Inicio", "Préstamos"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Préstamos",
                    subcategory: "Personal",
                    productLabel: "Préstamo Personal",
                    normalizedLabel: "prestamo_personal",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
        };
        const routeProfile = {
            name: "kiosko",
            entry: [],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: [],
            representativeFixture: {},
            notes: [],
        };
        const result = (0, scenario_hu_scope_filter_1.filterTargetPathsByIssueScope)(issue, targetPaths, routeProfile);
        // Should only include tarjetas, NOT cuentas or préstamos
        (0, test_1.expect)(result.diagnostics.totalProducts).toBe(4);
        (0, test_1.expect)(result.diagnostics.alignedProducts).toBe(2);
        (0, test_1.expect)(result.diagnostics.filteredOutProducts).toBe(2);
        (0, test_1.expect)(result.alignedTargetPaths).toHaveProperty("Tarjeta Crédito Visa Clásica");
        (0, test_1.expect)(result.alignedTargetPaths).toHaveProperty("Tarjeta Crédito Mastercard Gold");
        (0, test_1.expect)(result.alignedTargetPaths).not.toHaveProperty("Cuenta de Ahorros Personal en Pesos");
        (0, test_1.expect)(result.alignedTargetPaths).not.toHaveProperty("Préstamo Personal");
        // Matched keywords should include tarjeta-related terms
        (0, test_1.expect)(result.diagnostics.matchedKeywords.length).toBeGreaterThan(0);
        (0, test_1.expect)(result.diagnostics.matchedKeywords.some((k) => k.includes("tarjeta") || k.includes("credito"))).toBe(true);
    });
    (0, test_1.test)("HU amplia 'información de productos' → puede usar varias categorías", () => {
        const issue = {
            key: "AA-456",
            summary: "Navegar por información de productos financieros",
            description: "Como usuario quiero explorar todos los productos financieros disponibles incluyendo tarjetas, cuentas y préstamos",
            acceptanceCriteria: "Se muestran categorías: Tarjetas, Cuentas de Efectivo, Préstamos",
            labels: ["productos", "informacion"],
            components: [],
            status: "In Progress",
            issueType: "Story",
        };
        const targetPaths = {
            "Tarjeta Crédito Visa": {
                target: "Tarjeta Crédito Visa",
                requiredIntermediates: ["Inicio", "Tarjetas"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Tarjetas",
                    productLabel: "Tarjeta Crédito Visa",
                    normalizedLabel: "tarjeta_credito_visa",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
            "Cuenta de Ahorros": {
                target: "Cuenta de Ahorros",
                requiredIntermediates: ["Inicio", "Cuentas"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Cuentas de Efectivo",
                    productLabel: "Cuenta de Ahorros",
                    normalizedLabel: "cuenta_ahorros",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
            "Préstamo Personal": {
                target: "Préstamo Personal",
                requiredIntermediates: ["Inicio", "Préstamos"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Préstamos",
                    productLabel: "Préstamo Personal",
                    normalizedLabel: "prestamo_personal",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
        };
        const routeProfile = {
            name: "kiosko",
            entry: [],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: [],
            representativeFixture: {},
            notes: [],
        };
        const result = (0, scenario_hu_scope_filter_1.filterTargetPathsByIssueScope)(issue, targetPaths, routeProfile);
        // HU is broad - should include ALL categories mentioned
        (0, test_1.expect)(result.diagnostics.totalProducts).toBe(3);
        (0, test_1.expect)(result.diagnostics.alignedProducts).toBe(3); // All aligned
        (0, test_1.expect)(result.diagnostics.filteredOutProducts).toBe(0);
        (0, test_1.expect)(result.alignedTargetPaths).toHaveProperty("Tarjeta Crédito Visa");
        (0, test_1.expect)(result.alignedTargetPaths).toHaveProperty("Cuenta de Ahorros");
        (0, test_1.expect)(result.alignedTargetPaths).toHaveProperty("Préstamo Personal");
    });
    (0, test_1.test)("HU sin match claro → warning y fallback a todos los productos", () => {
        const issue = {
            key: "AA-789",
            summary: "Prueba genérica del sistema",
            description: "Verificar funcionalidad general",
            acceptanceCriteria: null,
            labels: [],
            components: [],
            status: "In Progress",
            issueType: "Story",
        };
        const targetPaths = {
            "Tarjeta Visa": {
                target: "Tarjeta Visa",
                requiredIntermediates: ["Inicio", "Tarjetas"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Tarjetas",
                    productLabel: "Tarjeta Visa",
                    normalizedLabel: "tarjeta_visa",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
            "Cuenta Ahorros": {
                target: "Cuenta Ahorros",
                requiredIntermediates: ["Inicio", "Cuentas"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Cuentas",
                    productLabel: "Cuenta Ahorros",
                    normalizedLabel: "cuenta_ahorros",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
        };
        const routeProfile = {
            name: "test-app",
            entry: [],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: [],
            representativeFixture: {},
            notes: [],
        };
        const result = (0, scenario_hu_scope_filter_1.filterTargetPathsByIssueScope)(issue, targetPaths, routeProfile);
        // No clear match - warning issued, fallback to all
        (0, test_1.expect)(result.diagnostics.warnings.length).toBeGreaterThan(0);
        (0, test_1.expect)(result.diagnostics.warnings[0]).toContain("No products aligned");
        (0, test_1.expect)(result.diagnostics.alignedProducts).toBe(2); // Fallback to all
        (0, test_1.expect)(result.alignedTargetPaths).toHaveProperty("Tarjeta Visa");
        (0, test_1.expect)(result.alignedTargetPaths).toHaveProperty("Cuenta Ahorros");
    });
    (0, test_1.test)("no issue context → fallback a todos los productos con warning", () => {
        const targetPaths = {
            "Producto A": {
                target: "Producto A",
                requiredIntermediates: ["Inicio"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    productLabel: "Producto A",
                    normalizedLabel: "producto_a",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
        };
        const result = (0, scenario_hu_scope_filter_1.filterTargetPathsByIssueScope)(null, targetPaths, null);
        (0, test_1.expect)(result.diagnostics.warnings.length).toBe(1);
        (0, test_1.expect)(result.diagnostics.warnings[0]).toContain("No issue context");
        (0, test_1.expect)(result.diagnostics.alignedProducts).toBe(1);
        (0, test_1.expect)(result.alignedTargetPaths).toHaveProperty("Producto A");
    });
    (0, test_1.test)("domainTerms ayuda con sinónimos (tarjeta → card, crédito → credit)", () => {
        const issue = {
            key: "AA-999",
            summary: "View credit cards",
            description: "As a user I want to see credit card options",
            acceptanceCriteria: "Display all credit card products",
            labels: ["cards", "credit"],
            components: [],
            status: "In Progress",
            issueType: "Story",
        };
        const targetPaths = {
            "Tarjeta de Crédito Visa": {
                target: "Tarjeta de Crédito Visa",
                requiredIntermediates: ["Inicio", "Tarjetas"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Tarjetas",
                    subcategory: "Crédito",
                    productLabel: "Tarjeta de Crédito Visa",
                    normalizedLabel: "tarjeta_credito_visa",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
            "Cuenta de Ahorro": {
                target: "Cuenta de Ahorro",
                requiredIntermediates: ["Inicio", "Cuentas"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Cuentas",
                    productLabel: "Cuenta de Ahorro",
                    normalizedLabel: "cuenta_ahorro",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
        };
        const routeProfile = {
            name: "test-app",
            entry: [],
            aliases: {},
            intermediates: {},
            domainTerms: {
                tarjeta: ["card", "carte"],
                credito: ["credit", "crédit"],
                cuenta: ["account", "compte"],
            },
            visibleControls: [],
            representativeFixture: {},
            notes: [],
        };
        const result = (0, scenario_hu_scope_filter_1.filterTargetPathsByIssueScope)(issue, targetPaths, routeProfile);
        // Should match "Tarjeta de Crédito" via domainTerms (credit→crédito, card→tarjeta)
        (0, test_1.expect)(result.diagnostics.alignedProducts).toBe(1);
        (0, test_1.expect)(result.alignedTargetPaths).toHaveProperty("Tarjeta de Crédito Visa");
        (0, test_1.expect)(result.alignedTargetPaths).not.toHaveProperty("Cuenta de Ahorro");
    });
    (0, test_1.test)("aliases ayuda con normalización (info productos → información de productos)", () => {
        const issue = {
            key: "AA-111",
            summary: "Ver info productos",
            description: "Acceder a info de productos bancarios",
            acceptanceCriteria: null,
            labels: [],
            components: [],
            status: "In Progress",
            issueType: "Story",
        };
        const targetPaths = {
            Producto1: {
                target: "Producto1",
                requiredIntermediates: ["Inicio", "Información de productos", "Tarjetas"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Tarjetas",
                    productLabel: "Producto1",
                    normalizedLabel: "producto1",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
            Producto2: {
                target: "Producto2",
                requiredIntermediates: ["Inicio", "Servicios", "Pagos"],
                confidence: "high",
                source: "runtime_discovery",
                productMetadata: {
                    category: "Servicios",
                    productLabel: "Producto2",
                    normalizedLabel: "producto2",
                    presentationType: "detail_page",
                    discoveredAt: new Date().toISOString(),
                },
            },
        };
        const routeProfile = {
            name: "test-app",
            entry: [],
            aliases: {
                "Información de productos": ["Info productos", "Info de productos"],
            },
            intermediates: {},
            domainTerms: {},
            visibleControls: [],
            representativeFixture: {},
            notes: [],
        };
        const result = (0, scenario_hu_scope_filter_1.filterTargetPathsByIssueScope)(issue, targetPaths, routeProfile);
        // Should match Producto1 via alias matching
        (0, test_1.expect)(result.diagnostics.alignedProducts).toBeGreaterThan(0);
        (0, test_1.expect)(result.alignedTargetPaths).toHaveProperty("Producto1");
    });
});
