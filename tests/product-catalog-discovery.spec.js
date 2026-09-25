"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe("Product Catalog Discovery", () => {
    (0, test_1.test)("groups products by category", () => {
        // Mock discovered products
        const products = [
            {
                label: "Cuenta de Ahorros Personal en Pesos",
                normalizedLabel: "cuenta_de_ahorros_personal_en_pesos",
                category: "Cuentas de Efectivo",
                variant: "Pesos",
                confidence: "high",
                groupKey: "cuentas_efectivo_pesos",
            },
            {
                label: "Cuenta de Ahorros Personal en Dólares",
                normalizedLabel: "cuenta_de_ahorros_personal_en_dolares",
                category: "Cuentas de Efectivo",
                variant: "Dólares",
                confidence: "high",
                groupKey: "cuentas_efectivo_dolares",
            },
            {
                label: "Tarjeta de Crédito Classic",
                normalizedLabel: "tarjeta_de_credito_classic",
                category: "Tarjetas de crédito",
                confidence: "medium",
                groupKey: "tarjetas_credito_classic",
            },
        ];
        // Group by category
        const byCategory = new Map();
        for (const prod of products) {
            const cat = prod.category || "General";
            if (!byCategory.has(cat)) {
                byCategory.set(cat, []);
            }
            byCategory.get(cat).push(prod);
        }
        // Verify grouping
        (0, test_1.expect)(byCategory.size).toBe(2);
        (0, test_1.expect)(byCategory.get("Cuentas de Efectivo")).toHaveLength(2);
        (0, test_1.expect)(byCategory.get("Tarjetas de crédito")).toHaveLength(1);
    });
    (0, test_1.test)("selects representative products", () => {
        // Mock product groups (10 products, 3 categories)
        const productGroups = new Map();
        productGroups.set("Cuentas de Efectivo", [
            { label: "Cuenta 1", confidence: "high", groupKey: "cuenta_1" },
            { label: "Cuenta 2", confidence: "high", groupKey: "cuenta_2" },
            { label: "Cuenta 3", confidence: "medium", groupKey: "cuenta_3" },
            { label: "Cuenta 4", confidence: "low", groupKey: "cuenta_4" },
        ]);
        productGroups.set("Tarjetas de crédito", [
            { label: "Tarjeta 1", confidence: "high", groupKey: "tarjeta_1" },
            { label: "Tarjeta 2", confidence: "medium", groupKey: "tarjeta_2" },
            { label: "Tarjeta 3", confidence: "low", groupKey: "tarjeta_3" },
        ]);
        productGroups.set("Préstamos", [
            { label: "Préstamo 1", confidence: "high", groupKey: "prestamo_1" },
            { label: "Préstamo 2", confidence: "high", groupKey: "prestamo_2" },
            { label: "Préstamo 3", confidence: "medium", groupKey: "prestamo_3" },
        ]);
        // Select representative (max 2 per category)
        const maxPerCategory = 2;
        const selected = [];
        for (const [category, products] of productGroups.entries()) {
            const sorted = products.sort((a, b) => {
                const confA = a.confidence === "high" ? 3 : a.confidence === "medium" ? 2 : 1;
                const confB = b.confidence === "high" ? 3 : b.confidence === "medium" ? 2 : 1;
                if (confA !== confB)
                    return confB - confA;
                return a.label.length - b.label.length;
            });
            const take = Math.min(maxPerCategory, sorted.length);
            selected.push(...sorted.slice(0, take));
        }
        // Verify only 2 per category selected
        (0, test_1.expect)(selected).toHaveLength(6); // 2 + 2 + 2
        const byCat = new Map();
        for (const [cat, prods] of productGroups.entries()) {
            byCat.set(cat, selected.filter((s) => prods.includes(s)).length);
        }
        (0, test_1.expect)(byCat.get("Cuentas de Efectivo")).toBe(2);
        (0, test_1.expect)(byCat.get("Tarjetas de crédito")).toBe(2);
        (0, test_1.expect)(byCat.get("Préstamos")).toBe(2);
    });
    (0, test_1.test)("selects all products in exhaustive mode", () => {
        // Mock product groups
        const productGroups = new Map();
        productGroups.set("Cuentas", [
            { label: "Cuenta 1", groupKey: "cuenta_1" },
            { label: "Cuenta 2", groupKey: "cuenta_2" },
            { label: "Cuenta 3", groupKey: "cuenta_3" },
        ]);
        productGroups.set("Tarjetas", [
            { label: "Tarjeta 1", groupKey: "tarjeta_1" },
            { label: "Tarjeta 2", groupKey: "tarjeta_2" },
        ]);
        // Exhaustive mode: select all
        const allProducts = [];
        for (const products of productGroups.values()) {
            allProducts.push(...products);
        }
        // Verify all products selected
        (0, test_1.expect)(allProducts).toHaveLength(5);
    });
    (0, test_1.test)("builds targetPaths from discovered products", () => {
        // Mock discovered products
        const products = [
            {
                label: "Cuenta de Ahorros Personal en Pesos",
                normalizedLabel: "cuenta_ahorros_pesos",
                category: "Cuentas de Efectivo",
                variant: "Pesos",
                confidence: "high",
                groupKey: "cuentas_efectivo_pesos",
                isRepresentative: true,
            },
        ];
        const baseIntermediates = ["Iniciar", "Información de productos"];
        // Build targetPath
        const targetPaths = {};
        for (const product of products) {
            const requiredIntermediates = [...baseIntermediates];
            if (product.category) {
                requiredIntermediates.push(product.category);
            }
            targetPaths[product.label] = {
                target: product.label,
                requiredIntermediates,
                confidence: product.confidence,
                source: "runtime_discovery",
                productMetadata: {
                    category: product.category,
                    variant: product.variant,
                    productLabel: product.label,
                    normalizedLabel: product.normalizedLabel,
                    isRepresentative: product.isRepresentative,
                    groupKey: product.groupKey,
                    discoveredAt: test_1.expect.any(String),
                },
            };
        }
        // Verify targetPath structure
        (0, test_1.expect)(Object.keys(targetPaths)).toHaveLength(1);
        const tp = targetPaths["Cuenta de Ahorros Personal en Pesos"];
        (0, test_1.expect)(tp.target).toBe("Cuenta de Ahorros Personal en Pesos");
        (0, test_1.expect)(tp.requiredIntermediates).toEqual([
            "Iniciar",
            "Información de productos",
            "Cuentas de Efectivo",
        ]);
        (0, test_1.expect)(tp.source).toBe("runtime_discovery");
        (0, test_1.expect)(tp.productMetadata?.category).toBe("Cuentas de Efectivo");
        (0, test_1.expect)(tp.productMetadata?.variant).toBe("Pesos");
    });
    (0, test_1.test)("merges targetPaths preserving manual entries", () => {
        // Mock existing targetPaths
        const existing = {
            "Manual Entry 1": {
                target: "Manual Entry 1",
                requiredIntermediates: ["Step 1"],
                source: "manual",
            },
            "Old Discovery Entry": {
                target: "Old Discovery Entry",
                requiredIntermediates: ["Step 2"],
                source: "runtime_discovery",
            },
        };
        // Mock discovered targetPaths
        const discovered = {
            "New Discovery Entry": {
                target: "New Discovery Entry",
                requiredIntermediates: ["Step 3"],
                source: "runtime_discovery",
            },
            "Old Discovery Entry": {
                target: "Old Discovery Entry (updated)",
                requiredIntermediates: ["Step 4"],
                source: "runtime_discovery",
            },
        };
        // Merge logic
        const merged = {};
        // Keep manual entries
        for (const [key, value] of Object.entries(existing)) {
            if (value.source !== "runtime_discovery") {
                merged[key] = value;
            }
        }
        // Add discovered products
        for (const [key, value] of Object.entries(discovered)) {
            merged[key] = value;
        }
        // Verify merge result
        (0, test_1.expect)(Object.keys(merged)).toHaveLength(3);
        (0, test_1.expect)(merged["Manual Entry 1"]).toBeDefined(); // Preserved
        (0, test_1.expect)(merged["Manual Entry 1"].source).toBe("manual");
        (0, test_1.expect)(merged["Old Discovery Entry"]).toBeDefined(); // Replaced
        (0, test_1.expect)(merged["Old Discovery Entry"].target).toBe("Old Discovery Entry (updated)");
        (0, test_1.expect)(merged["New Discovery Entry"]).toBeDefined(); // Added
    });
});
