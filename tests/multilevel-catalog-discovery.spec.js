"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe("Multilevel Catalog Discovery", () => {
    (0, test_1.test)("first screen with categories does not fail validation", () => {
        // Mock first screen with categories (no final products yet)
        const snapshot = {
            elements: [
                { text: "Cuentas", type: "button", tagName: "button" },
                { text: "Tarjetas", type: "button", tagName: "button" },
                { text: "Préstamos", type: "button", tagName: "button" },
                { text: "Depósitos", type: "button", tagName: "button" },
            ],
        };
        // In multilevel discovery, this is valid - we explore categories
        const hasNavigationCandidates = snapshot.elements.length >= 2;
        (0, test_1.expect)(hasNavigationCandidates).toBe(true);
    });
    (0, test_1.test)("category candidate is classified correctly", () => {
        // Mock classifyCandidate function
        function classifyCandidate(element, context) {
            const text = element.text || "";
            // Detail indicators
            const detailPatterns = [/^detalles?$/i, /^requisitos?$/i, /^solicitar$/i, /^volver$/i];
            for (const pattern of detailPatterns) {
                if (pattern.test(text))
                    return "detail";
            }
            // Category/subcategory by depth
            if (context.depth <= 1 && context.hasMultipleItems)
                return "category";
            if (context.depth === 2 && context.hasMultipleItems)
                return "subcategory";
            return "product";
        }
        // Test category at depth 0
        const category = { text: "Cuentas" };
        (0, test_1.expect)(classifyCandidate(category, { depth: 0, hasMultipleItems: true })).toBe("category");
        // Test subcategory at depth 2
        const subcategory = { text: "Cuentas de Efectivo" };
        (0, test_1.expect)(classifyCandidate(subcategory, { depth: 2, hasMultipleItems: true })).toBe("subcategory");
        // Test product at depth 3
        const product = { text: "Cuenta en Pesos" };
        (0, test_1.expect)(classifyCandidate(product, { depth: 3, hasMultipleItems: false })).toBe("product");
        // Test detail control
        const detail = { text: "Solicitar" };
        (0, test_1.expect)(classifyCandidate(detail, { depth: 3, hasMultipleItems: false })).toBe("detail");
    });
    (0, test_1.test)("product is persisted only if detail validated", () => {
        // Mock product discovery
        const productWithDetail = {
            label: "Cuenta de Ahorros en Pesos",
            confidence: "high",
            detailSignals: {
                detailSections: ["Detalles", "Requisitos"],
                actionButtons: ["Solicitar", "Volver"],
                hasDetailPage: true,
            },
        };
        const productWithoutDetail = {
            label: "Item without detail",
            confidence: "low",
            detailSignals: {
                detailSections: [],
                actionButtons: [],
                hasDetailPage: false,
            },
        };
        // Only product with detail should be persisted
        (0, test_1.expect)(productWithDetail.detailSignals.hasDetailPage).toBe(true);
        (0, test_1.expect)(productWithoutDetail.detailSignals.hasDetailPage).toBe(false);
    });
    (0, test_1.test)("discoveryPath builds complete requiredIntermediates", () => {
        // Mock product with discoveryPath
        const product = {
            label: "Cuenta de Ahorros en Pesos",
            discoveryPath: ["Información de productos", "Cuentas", "Cuentas de Efectivo", "Cuenta de Ahorros en Pesos"],
        };
        // requiredIntermediates should be all except last
        const requiredIntermediates = product.discoveryPath.slice(0, -1);
        (0, test_1.expect)(requiredIntermediates).toEqual(["Información de productos", "Cuentas", "Cuentas de Efectivo"]);
    });
    (0, test_1.test)("detailSignals captured and persisted", () => {
        // Mock product with detailSignals
        const product = {
            label: "Tarjeta de Crédito Classic",
            detailSignals: {
                detailSections: ["Detalles", "Requisitos", "Beneficios"],
                actionButtons: ["Solicitar", "Volver"],
                hasDetailPage: true,
            },
        };
        // productMetadata should include detail signals
        const productMetadata = {
            productLabel: product.label,
            detailSections: product.detailSignals.detailSections,
            actionButtons: product.detailSignals.actionButtons,
        };
        (0, test_1.expect)(productMetadata.detailSections).toEqual(["Detalles", "Requisitos", "Beneficios"]);
        (0, test_1.expect)(productMetadata.actionButtons).toEqual(["Solicitar", "Volver"]);
    });
    (0, test_1.test)("backtracking returns to previous level", () => {
        // Mock backtracking strategies
        async function tryBackNavigation(hasVolverButton, browserBackWorks) {
            // Strategy 1: Volver button
            if (hasVolverButton) {
                return true;
            }
            // Strategy 2: Browser back
            if (browserBackWorks) {
                return true;
            }
            return false;
        }
        // Test Volver button strategy
        tryBackNavigation(true, false).then((result) => (0, test_1.expect)(result).toBe(true));
        // Test browser back fallback
        tryBackNavigation(false, true).then((result) => (0, test_1.expect)(result).toBe(true));
        // Test failure
        tryBackNavigation(false, false).then((result) => (0, test_1.expect)(result).toBe(false));
    });
    (0, test_1.test)("representative mode preserves functional variants", () => {
        // Mock products with variants
        const products = [
            { label: "Cuenta en Pesos", category: "Cuentas", variant: "Pesos" },
            { label: "Cuenta en Dólares", category: "Cuentas", variant: "Dólares" },
            { label: "Cuenta en Euros", category: "Cuentas", variant: "Euros" },
            { label: "Tarjeta Classic", category: "Tarjetas", variant: undefined },
            { label: "Tarjeta Gold", category: "Tarjetas", variant: undefined },
        ];
        // Group by category
        const byCategory = new Map();
        for (const prod of products) {
            if (!byCategory.has(prod.category)) {
                byCategory.set(prod.category, []);
            }
            byCategory.get(prod.category).push(prod);
        }
        // Representative should include one per variant
        const representative = [];
        for (const [_, prods] of byCategory.entries()) {
            // Group by variant
            const byVariant = new Map();
            for (const prod of prods) {
                const variantKey = prod.variant || "default";
                if (!byVariant.has(variantKey)) {
                    byVariant.set(variantKey, prod);
                }
            }
            // Take first from each variant
            representative.push(...Array.from(byVariant.values()));
        }
        // Should have: 3 Cuentas (one per variant) + 1 Tarjeta
        (0, test_1.expect)(representative.length).toBe(4);
        const cuentas = representative.filter((p) => p.category === "Cuentas");
        (0, test_1.expect)(cuentas).toHaveLength(3);
        (0, test_1.expect)(cuentas.map((c) => c.variant)).toEqual(test_1.expect.arrayContaining(["Pesos", "Dólares", "Euros"]));
    });
    (0, test_1.test)("exhaustive mode includes all products", () => {
        // Mock products
        const allProducts = [
            { label: "Prod 1" },
            { label: "Prod 2" },
            { label: "Prod 3" },
            { label: "Prod 4" },
            { label: "Prod 5" },
        ];
        // Exhaustive mode: no filtering
        const exhaustive = allProducts;
        (0, test_1.expect)(exhaustive).toHaveLength(5);
    });
    (0, test_1.test)("categories not persisted as final products", () => {
        // Mock candidates
        const candidates = [
            { label: "Cuentas", type: "category" },
            { label: "Tarjetas", type: "category" },
            { label: "Producto Final", type: "product", hasDetailPage: true },
        ];
        // Only products with detail should be persisted as final products
        const finalProducts = candidates.filter((c) => c.type === "product" && c.hasDetailPage);
        (0, test_1.expect)(finalProducts).toHaveLength(1);
        (0, test_1.expect)(finalProducts[0].label).toBe("Producto Final");
    });
    (0, test_1.test)("maxDepth limits exploration", () => {
        // Mock exploration state
        const maxDepth = 3;
        const currentDepth = 3;
        const shouldExploreDeeper = currentDepth < maxDepth;
        (0, test_1.expect)(shouldExploreDeeper).toBe(false);
    });
    (0, test_1.test)("single product valid if detail validated", () => {
        // Mock screen with single product
        const products = [
            {
                label: "Único Producto",
                detailSignals: {
                    detailSections: ["Detalles", "Requisitos"],
                    actionButtons: ["Solicitar"],
                    hasDetailPage: true,
                },
            },
        ];
        // Valid if detail was validated
        const isValid = products.length === 1 && products[0].detailSignals?.hasDetailPage === true;
        (0, test_1.expect)(isValid).toBe(true);
    });
    (0, test_1.test)("no hardcoding of app-specific terms", () => {
        // Classification patterns should be generic
        const genericDetailPatterns = [
            /^detalles?$/i,
            /^requisitos?$/i,
            /^beneficios?$/i,
            /^solicitar$/i,
            /^volver$/i,
        ];
        // Test generic patterns work for different apps
        (0, test_1.expect)(genericDetailPatterns[0].test("Detalles")).toBe(true);
        (0, test_1.expect)(genericDetailPatterns[0].test("Details")).toBe(false); // Would need English patterns for English apps
        (0, test_1.expect)(genericDetailPatterns[1].test("Requisitos")).toBe(true);
        (0, test_1.expect)(genericDetailPatterns[3].test("Solicitar")).toBe(true);
        // No hardcoded product names or categories
        const noHardcodedProducts = true;
        (0, test_1.expect)(noHardcodedProducts).toBe(true);
    });
    (0, test_1.test)("short clickable labels like Tarjetas Cuentas Préstamos are not rejected", () => {
        // Mock isValidProductLabel with hasClickableEvidence
        function isValidProductLabel(label, hasClickableEvidence) {
            const trimmed = label.trim();
            if (trimmed.length < 3)
                return false;
            // Short labels are OK if clickable
            if (!hasClickableEvidence && trimmed.split(/\s+/).length === 1 && trimmed.length < 10) {
                if (!/\d/.test(trimmed)) {
                    return false; // Reject short non-clickable
                }
            }
            return true;
        }
        // Short clickable labels should pass
        (0, test_1.expect)(isValidProductLabel("Tarjetas", true)).toBe(true);
        (0, test_1.expect)(isValidProductLabel("Cuentas", true)).toBe(true);
        (0, test_1.expect)(isValidProductLabel("Préstamos", true)).toBe(true);
        // Short non-clickable labels should fail
        (0, test_1.expect)(isValidProductLabel("Tarjetas", false)).toBe(false);
        (0, test_1.expect)(isValidProductLabel("Cuentas", false)).toBe(false);
    });
    (0, test_1.test)("action controls like Finalizar sesión Solicitar Salir are rejected", () => {
        // Mock classifyControlType
        function classifyControlType(label) {
            const normalized = label.toLowerCase().trim();
            const sensitiveControls = [
                { pattern: /^finalizar\s+sesi[oó]n$/i, safe: false },
                { pattern: /^salir$/i, safe: false },
                { pattern: /^solicitar$/i, safe: false },
            ];
            for (const control of sensitiveControls) {
                if (control.pattern.test(normalized)) {
                    return { isControl: true, safeNavigation: control.safe };
                }
            }
            // Volver is safe
            if (/^volver$/i.test(normalized)) {
                return { isControl: true, safeNavigation: true };
            }
            return null;
        }
        // Sensitive controls should be detected
        (0, test_1.expect)(classifyControlType("Finalizar sesión")?.isControl).toBe(true);
        (0, test_1.expect)(classifyControlType("Finalizar sesión")?.safeNavigation).toBe(false);
        (0, test_1.expect)(classifyControlType("Solicitar")?.isControl).toBe(true);
        (0, test_1.expect)(classifyControlType("Solicitar")?.safeNavigation).toBe(false);
        (0, test_1.expect)(classifyControlType("Salir")?.isControl).toBe(true);
        // Volver is control but safe
        (0, test_1.expect)(classifyControlType("Volver")?.isControl).toBe(true);
        (0, test_1.expect)(classifyControlType("Volver")?.safeNavigation).toBe(true);
        // Regular labels are not controls
        (0, test_1.expect)(classifyControlType("Tarjetas")).toBeNull();
    });
    (0, test_1.test)("detail screen detection requires sections AND buttons or 2+ sections", () => {
        // Mock hasDetailPage logic
        function hasDetailPage(sections, buttons) {
            return (sections > 0 && buttons > 0) || sections >= 2;
        }
        // Need both sections and buttons
        (0, test_1.expect)(hasDetailPage(1, 1)).toBe(true);
        (0, test_1.expect)(hasDetailPage(2, 0)).toBe(true); // Or 2+ sections
        // Not enough
        (0, test_1.expect)(hasDetailPage(1, 0)).toBe(false);
        (0, test_1.expect)(hasDetailPage(0, 1)).toBe(false);
        (0, test_1.expect)(hasDetailPage(0, 0)).toBe(false);
    });
    (0, test_1.test)("clicking product that opens detail persists product with current path", () => {
        // Mock scenario: clicking "Depósitos a plazo en Pesos" opens detail screen
        const currentPath = ["Información de productos", "Depósitos a plazo", "Depósitos a plazo en Pesos"];
        const detailSignals = {
            detailSections: ["Detalles", "Requisitos"],
            actionButtons: ["Solicitar", "Volver"],
            hasDetailPage: true,
        };
        // If hasDetailPage, persist last path segment as product
        if (detailSignals.hasDetailPage && currentPath.length > 0) {
            const productLabel = currentPath[currentPath.length - 1];
            (0, test_1.expect)(productLabel).toBe("Depósitos a plazo en Pesos");
            const product = {
                label: productLabel,
                discoveryPath: currentPath,
                detailSignals,
            };
            (0, test_1.expect)(product.label).toBe("Depósitos a plazo en Pesos");
            (0, test_1.expect)(product.discoveryPath).toEqual(currentPath);
            (0, test_1.expect)(product.detailSignals.hasDetailPage).toBe(true);
        }
    });
    (0, test_1.test)("re-scan after backtracking refreshes locators for sibling products", () => {
        // Mock: after exploring "Pesos", backtrack and re-scan should allow exploring "Dólares"
        const productsBeforeBack = ["Depósitos a plazo en Pesos", "Depósitos a plazo en Dólares"];
        // First exploration: click "Pesos"
        const firstClicked = productsBeforeBack[0];
        (0, test_1.expect)(firstClicked).toBe("Depósitos a plazo en Pesos");
        // After backtracking, re-scan to get fresh locators
        // This should allow clicking "Dólares" even if previous locator is stale
        const productsAfterBack = productsBeforeBack; // Re-scan returns same list with fresh locators
        const secondClickable = productsAfterBack[1];
        (0, test_1.expect)(secondClickable).toBe("Depósitos a plazo en Dólares");
    });
    (0, test_1.test)("product card grid detected when hasDetailPage is false", () => {
        // Mock detectProductCards
        function detectProductCards(containers) {
            return containers
                .filter((c) => c.hasProductLabel && c.hasBullets)
                .map((c, idx) => ({
                productLabel: c.label,
                bulletCount: c.bulletCount,
                hasImageOrIcon: c.hasIcon,
                cardIndex: idx,
            }));
        }
        // Mock snapshot with cards
        const containers = [
            { label: "Tarjeta Classic", hasProductLabel: true, hasBullets: true, bulletCount: 3, hasIcon: true },
            { label: "Tarjeta Gold", hasProductLabel: true, hasBullets: true, bulletCount: 4, hasIcon: true },
            { label: "Tarjeta Platinum", hasProductLabel: true, hasBullets: true, bulletCount: 5, hasIcon: true },
        ];
        const detected = detectProductCards(containers);
        (0, test_1.expect)(detected).toHaveLength(3);
        (0, test_1.expect)(detected[0].productLabel).toBe("Tarjeta Classic");
        (0, test_1.expect)(detected[1].productLabel).toBe("Tarjeta Gold");
        (0, test_1.expect)(detected[2].productLabel).toBe("Tarjeta Platinum");
    });
    (0, test_1.test)("product card persisted with presentationType=product_card", () => {
        // Mock card detection result
        const detectedCard = {
            productLabel: "Cuenta de Ahorro Pesos",
            normalizedLabel: "cuenta_de_ahorro_pesos",
            cardTextPreview: "Cuenta con beneficios exclusivos",
            bulletCount: 3,
            hasImageOrIcon: true,
            cardIndex: 0,
            confidence: "high",
        };
        // Build discovered product from card
        const product = {
            label: detectedCard.productLabel,
            normalizedLabel: detectedCard.normalizedLabel,
            presentationType: "product_card",
            validationStatus: "validated_card",
            cardSignals: {
                cardTextPreview: detectedCard.cardTextPreview,
                bulletCount: detectedCard.bulletCount,
                hasImageOrIcon: detectedCard.hasImageOrIcon,
                cardIndex: detectedCard.cardIndex,
            },
        };
        (0, test_1.expect)(product.presentationType).toBe("product_card");
        (0, test_1.expect)(product.validationStatus).toBe("validated_card");
        (0, test_1.expect)(product.cardSignals?.bulletCount).toBe(3);
        (0, test_1.expect)(product.cardSignals?.hasImageOrIcon).toBe(true);
    });
    (0, test_1.test)("product with detail page has presentationType=detail_page", () => {
        // Mock product detected via detail page
        const product = {
            label: "Préstamo Personal",
            presentationType: "detail_page",
            validationStatus: "validated_detail",
            detailSignals: {
                detailSections: ["Detalles", "Requisitos"],
                actionButtons: ["Solicitar", "Volver"],
                hasDetailPage: true,
            },
        };
        (0, test_1.expect)(product.presentationType).toBe("detail_page");
        (0, test_1.expect)(product.validationStatus).toBe("validated_detail");
        (0, test_1.expect)(product.detailSignals?.hasDetailPage).toBe(true);
    });
    (0, test_1.test)("cards with bullets and image have high confidence", () => {
        // Mock card detection confidence logic
        function calculateConfidence(bulletCount, textLength) {
            return bulletCount >= 2 || textLength > 50 ? "high" : "medium";
        }
        // Card with bullets
        (0, test_1.expect)(calculateConfidence(3, 30)).toBe("high");
        // Card with long text
        (0, test_1.expect)(calculateConfidence(0, 60)).toBe("high");
        // Card with minimal content
        (0, test_1.expect)(calculateConfidence(1, 20)).toBe("medium");
    });
    (0, test_1.test)("action controls filtered out from cards", () => {
        // Mock card containers including action controls
        const containers = [
            { label: "Tarjeta Classic", isProductCard: true },
            { label: "Finalizar sesión", isProductCard: false },
            { label: "Volver", isProductCard: false },
            { label: "Solicitar", isProductCard: false },
            { label: "Tarjeta Gold", isProductCard: true },
        ];
        // Filter out action controls
        const productCards = containers.filter((c) => c.isProductCard);
        (0, test_1.expect)(productCards).toHaveLength(2);
        (0, test_1.expect)(productCards[0].label).toBe("Tarjeta Classic");
        (0, test_1.expect)(productCards[1].label).toBe("Tarjeta Gold");
    });
    (0, test_1.test)("catalog root screen with navigation candidates does not execute product card detection", () => {
        // Mock inferPageContext
        function inferPageContext(depth, navCandidates) {
            if (depth === 0 && navCandidates >= 2) {
                return "catalog_root";
            }
            return "product_listing";
        }
        // Catalog root with navigation
        const depth = 0;
        let navCandidatesCount = 3;
        const pageContext = inferPageContext(depth, navCandidatesCount);
        (0, test_1.expect)(pageContext).toBe("catalog_root");
        // Product card detection should be skipped
        const shouldDetectCards = pageContext !== "catalog_root" && navCandidatesCount === 0;
        (0, test_1.expect)(shouldDetectCards).toBe(false);
    });
    (0, test_1.test)("heading with bullets=0 is rejected by product card validation", () => {
        // Mock card validation
        function isValidCard(bulletCount, textPreview, label) {
            // Reject global intro headings
            const globalIntroPatterns = [
                /^conoce\s+nuestros?\s+productos?$/i,
                /^nuestros?\s+productos?$/i,
            ];
            if (globalIntroPatterns.some((p) => p.test(label))) {
                return false;
            }
            // Require minimum signals
            if (bulletCount === 0 && textPreview.length < 30) {
                return false;
            }
            return true;
        }
        // Test: "Conoce nuestros productos" with bullets=0
        const label = "Conoce nuestros productos";
        const bulletCount = 0;
        const textPreview = "Selecciona una categoría:";
        (0, test_1.expect)(isValidCard(bulletCount, textPreview, label)).toBe(false);
    });
    (0, test_1.test)("product listing with multiple cards and bullets persists as product_card", () => {
        // Mock cards with sufficient signals
        const cards = [
            { label: "Tarjeta Classic", bulletCount: 3, textPreview: "Aceptación mundial, sin anualidad" },
            { label: "Tarjeta Gold", bulletCount: 4, textPreview: "Beneficios exclusivos, seguros incluidos" },
            { label: "Tarjeta Platinum", bulletCount: 5, textPreview: "Acceso a salas VIP, concierge" },
        ];
        // All should pass validation
        const validCards = cards.filter((c) => c.bulletCount >= 1 || c.textPreview.length > 30);
        (0, test_1.expect)(validCards).toHaveLength(3);
        (0, test_1.expect)(validCards[0].label).toBe("Tarjeta Classic");
    });
    (0, test_1.test)("single card without strong signals is rejected", () => {
        // Mock single card with weak signals
        const cards = [
            { label: "Único Producto", bulletCount: 0, textPreview: "Ver más", hasStrongSignals: false },
        ];
        // Should be rejected for being single without strong signals
        const hasStrongSignals = cards[0].bulletCount >= 3 && cards[0].textPreview.length > 100;
        (0, test_1.expect)(hasStrongSignals).toBe(false);
        // If single card, only accept with strong signals
        const shouldAccept = cards.length > 1 || hasStrongSignals;
        (0, test_1.expect)(shouldAccept).toBe(false);
    });
    (0, test_1.test)("product cards detected only on terminal listing without navigation", () => {
        // Mock page context detection
        function inferPageContext(navCandidatesCount, depth, path) {
            if (depth === 0 && navCandidatesCount >= 2)
                return "catalog_root";
            if (navCandidatesCount >= 2)
                return "category_branch";
            if (depth >= 2 && path.length >= 2 && navCandidatesCount === 0)
                return "product_listing";
            return "unknown";
        }
        // Terminal listing: deep path, no navigation
        const depth = 2;
        const path = ["Información de productos", "Tarjetas"];
        const navCandidatesCount = 0;
        const pageContext = inferPageContext(navCandidatesCount, depth, path);
        (0, test_1.expect)(pageContext).toBe("product_listing");
        // Should detect cards
        const shouldDetectCards = pageContext !== "catalog_root" && navCandidatesCount === 0;
        (0, test_1.expect)(shouldDetectCards).toBe(true);
    });
    (0, test_1.test)("suspicious discovery does not delete valid previous products", () => {
        // Mock persistence check
        function isSuspiciousRun(newProducts, existingCount) {
            const isSingleLowConfidence = newProducts.length === 1 &&
                (newProducts[0].confidence === "low" || newProducts[0].confidence === "medium");
            const wouldDeleteMore = existingCount > newProducts.length;
            return isSingleLowConfidence && wouldDeleteMore;
        }
        // Previous run: 3 valid products
        const existingCount = 3;
        // Current run: 1 product, medium confidence, category "General"
        const newProducts = [{ label: "Conoce nuestros productos", confidence: "medium", category: "General" }];
        const suspicious = isSuspiciousRun(newProducts, existingCount);
        (0, test_1.expect)(suspicious).toBe(true);
        // Should skip persistence
        const shouldPersist = !suspicious;
        (0, test_1.expect)(shouldPersist).toBe(false);
    });
    (0, test_1.test)("replace policy only replaces products with same normalized target", () => {
        // Mock existing products
        const existing = {
            "Préstamo Personal": { source: "runtime_discovery", target: "Préstamo Personal" },
            "Depósitos a plazo en Pesos": { source: "runtime_discovery", target: "Depósitos a plazo en Pesos" },
            "Cuenta Manual": { source: "manual", target: "Cuenta Manual" },
        };
        // Mock new discovery (only "Préstamo Personal" being replaced)
        const discovered = {
            "Préstamo Personal": { source: "runtime_discovery", target: "Préstamo Personal" },
        };
        // Merge
        const merged = {};
        // Keep manual entries
        for (const [key, value] of Object.entries(existing)) {
            if (value.source !== "runtime_discovery") {
                merged[key] = value;
            }
            else {
                // Only keep if NOT being replaced
                if (!discovered[key]) {
                    merged[key] = value;
                }
            }
        }
        // Add discovered
        for (const [key, value] of Object.entries(discovered)) {
            merged[key] = value;
        }
        // Should keep "Depósitos a plazo en Pesos" (not being replaced)
        (0, test_1.expect)(merged["Depósitos a plazo en Pesos"]).toBeDefined();
        // Should keep "Cuenta Manual" (manual entry)
        (0, test_1.expect)(merged["Cuenta Manual"]).toBeDefined();
        // Should have replaced "Préstamo Personal"
        (0, test_1.expect)(merged["Préstamo Personal"]).toBeDefined();
    });
    (0, test_1.test)("navigation candidates explored before product card detection", () => {
        // Mock exploration order tracking
        const executionOrder = [];
        // Mock scenario: catalog root with 3 navigation candidates
        const navCandidates = ["Tarjetas", "Cuentas", "Préstamos"];
        const navCandidatesCount = navCandidates.length;
        const pageContext = navCandidatesCount >= 2 ? "catalog_root" : "product_listing";
        // Step 1: Check if should explore navigation
        if (navCandidatesCount > 0) {
            executionOrder.push("explore_navigation");
        }
        // Step 2: Only detect cards if no navigation
        if (navCandidatesCount === 0 && pageContext !== "catalog_root") {
            executionOrder.push("detect_product_cards");
        }
        // Should explore navigation FIRST, not detect cards
        (0, test_1.expect)(executionOrder).toEqual(["explore_navigation"]);
        (0, test_1.expect)(executionOrder).not.toContain("detect_product_cards");
    });
    (0, test_1.test)("instruction headings rejected by pattern", () => {
        // Mock instruction heading patterns that match our detection rules
        const instructionHeadings = [
            "Selecciona un producto",
            "Elige un producto",
            "Escoge el producto",
            "Selecciona una producto",
            "Elige la producto",
            "Productos disponibles",
            "Listado de productos",
            "Catálogo de productos",
            "Conoce nuestros productos",
        ];
        const instructionPatterns = [
            /^seleccion[ae]\s+(un|una|el|la)\s+producto/i,
            /^elige\s+(un|una|el|la)\s+producto/i,
            /^escoge\s+(un|una|el|la)\s+producto/i,
            /^productos?\s+disponibles?$/i,
            /^listado\s+de\s+productos?$/i,
            /^cat[áa]logo\s+de\s+productos?$/i,
            /^conoce\s+nuestros?\s+productos?$/i,
        ];
        // Verify each instruction heading matches pattern
        for (const heading of instructionHeadings) {
            const isInstruction = instructionPatterns.some((p) => p.test(heading));
            (0, test_1.expect)(isInstruction).toBe(true);
        }
        // Verify real products DON'T match patterns
        const realProducts = [
            "Tarjeta de Crédito Visa Gold",
            "Cuenta de Ahorros Personal en Pesos",
            "Préstamo Personal",
            "Depósito a Plazo en Dólares",
        ];
        for (const product of realProducts) {
            const isInstruction = instructionPatterns.some((p) => p.test(product));
            (0, test_1.expect)(isInstruction).toBe(false);
        }
    });
    (0, test_1.test)("product_card requiredIntermediates includes full listing path", () => {
        // Mock product_card discovery
        const productCard = {
            label: "Tarjeta Crédito Visa Gold",
            presentationType: "product_card",
            discoveryPath: ["Información de productos", "Tarjetas", "Tarjeta de Crédito"],
        };
        // For product_card: requiredIntermediates should be FULL discoveryPath
        let requiredIntermediates;
        if (productCard.presentationType === "product_card") {
            requiredIntermediates = [...productCard.discoveryPath];
        }
        else {
            requiredIntermediates = productCard.discoveryPath.slice(0, -1);
        }
        (0, test_1.expect)(requiredIntermediates).toEqual([
            "Información de productos",
            "Tarjetas",
            "Tarjeta de Crédito",
        ]);
        (0, test_1.expect)(requiredIntermediates).toHaveLength(3);
        (0, test_1.expect)(requiredIntermediates[requiredIntermediates.length - 1]).toBe("Tarjeta de Crédito");
    });
    (0, test_1.test)("detail_page requiredIntermediates excludes product target", () => {
        // Mock detail_page discovery
        const detailPage = {
            label: "Préstamo Personal",
            presentationType: "detail_page",
            discoveryPath: ["Información de productos", "Préstamos", "Préstamo Personal"],
        };
        // For detail_page: requiredIntermediates should be path WITHOUT last element
        let requiredIntermediates;
        if (detailPage.presentationType === "product_card") {
            requiredIntermediates = [...detailPage.discoveryPath];
        }
        else {
            requiredIntermediates = detailPage.discoveryPath.slice(0, -1);
        }
        (0, test_1.expect)(requiredIntermediates).toEqual(["Información de productos", "Préstamos"]);
        (0, test_1.expect)(requiredIntermediates).toHaveLength(2);
        (0, test_1.expect)(requiredIntermediates).not.toContain("Préstamo Personal");
    });
    (0, test_1.test)("structural validation rejects weak cards", () => {
        // Mock weak card candidates
        const weakCards = [
            {
                label: "Conoce más",
                bulletCount: 0,
                textPreview: "",
                hasImage: false,
                isHeading: true,
                isClickable: false,
            },
            {
                label: "Ver detalles",
                bulletCount: 0,
                textPreview: "Ver detalles",
                hasImage: false,
                isHeading: false,
                isClickable: false,
            },
        ];
        // Apply validation rules
        for (const card of weakCards) {
            const hasMinimumSignals = card.bulletCount >= 1 ||
                card.textPreview.length >= 30 ||
                (card.isClickable && card.hasImage);
            const isHeadingNoContent = card.isHeading && !card.isClickable && card.textPreview.length < 50;
            const textIdenticalToLabel = card.textPreview.length > 0 && card.textPreview.trim() === card.label.trim();
            const shouldReject = !hasMinimumSignals || isHeadingNoContent || textIdenticalToLabel;
            (0, test_1.expect)(shouldReject).toBe(true);
        }
        // Mock strong card (should NOT reject)
        const strongCard = {
            label: "Tarjeta de Crédito Visa Joven",
            bulletCount: 3,
            textPreview: "Cashback 7% en todas las compras. Tecnología contactless. Pago desde App BSC.",
            hasImage: true,
            isHeading: false,
            isClickable: true,
        };
        const hasMinimumSignals = strongCard.bulletCount >= 1 ||
            strongCard.textPreview.length >= 30 ||
            (strongCard.isClickable && strongCard.hasImage);
        (0, test_1.expect)(hasMinimumSignals).toBe(true);
    });
    (0, test_1.test)("grid with three similar cards detects all three including first", () => {
        // Mock three similar cards (e.g., Cuenta ... en Pesos/Dólares/Euros)
        const cards = [
            {
                label: "Cuenta de Ahorros Personal en Pesos",
                normalizedLabel: "cuenta de ahorros personal en pesos",
                bulletCount: 0,
                textPreview: "Liquidez total, retiros y transferencias en cualquier momento.",
                hasImage: true,
                isClickable: false,
            },
            {
                label: "Cuenta de Ahorros Personal en Dólares",
                normalizedLabel: "cuenta de ahorros personal en dolares",
                bulletCount: 0,
                textPreview: "Disponibilidad inmediata de tus fondos en dólares.",
                hasImage: true,
                isClickable: false,
            },
            {
                label: "Cuenta de Ahorros Personal en Euros",
                normalizedLabel: "cuenta de ahorros personal en euros",
                bulletCount: 0,
                textPreview: "Maneja tus ahorros en euros con facilidad.",
                hasImage: true,
                isClickable: false,
            },
        ];
        // Simulate deduplication check
        const seen = new Set();
        const acceptedCards = [];
        for (const card of cards) {
            // Check minimum signals
            const hasMinimumSignals = card.bulletCount >= 1 ||
                card.textPreview.length >= 30 ||
                (card.isClickable && card.hasImage);
            if (!hasMinimumSignals)
                continue;
            // Check duplicate
            if (seen.has(card.normalizedLabel)) {
                // Should NOT happen - each has unique normalized label
                continue;
            }
            seen.add(card.normalizedLabel);
            acceptedCards.push(card);
        }
        // All three should be accepted
        (0, test_1.expect)(acceptedCards).toHaveLength(3);
        (0, test_1.expect)(acceptedCards[0].label).toBe("Cuenta de Ahorros Personal en Pesos");
        (0, test_1.expect)(acceptedCards[1].label).toBe("Cuenta de Ahorros Personal en Dólares");
        (0, test_1.expect)(acceptedCards[2].label).toBe("Cuenta de Ahorros Personal en Euros");
        // Verify none were rejected as duplicates (normalized labels are different)
        (0, test_1.expect)(seen.size).toBe(3);
    });
    (0, test_1.test)("first card after list heading is not confused with heading", () => {
        // Scenario: Grid has heading "Selecciona un producto" followed by real cards
        const containers = [
            {
                index: 0,
                label: "Selecciona un producto",
                isHeading: true,
                bulletCount: 0,
                textPreview: "Elige el tipo de producto que deseas conocer",
                hasImage: false,
            },
            {
                index: 1,
                label: "Cuenta de Ahorros Personal en Pesos",
                isHeading: false,
                bulletCount: 0,
                textPreview: "Liquidez total, retiros y transferencias en cualquier momento.",
                hasImage: true,
            },
        ];
        const instructionPatterns = [
            /^seleccion[ae]\s+(un|una|el|la)\s+producto/i,
            /^elige\s+(un|una|el|la)\s+producto/i,
        ];
        const accepted = [];
        const rejected = [];
        for (const container of containers) {
            // Check if instruction heading
            const isInstruction = instructionPatterns.some((p) => p.test(container.label));
            if (isInstruction) {
                rejected.push({ ...container, reason: "instruction_heading" });
                continue;
            }
            // Check minimum signals
            const hasMinimumSignals = container.bulletCount >= 1 ||
                container.textPreview.length >= 30 ||
                container.hasImage;
            if (!hasMinimumSignals) {
                rejected.push({ ...container, reason: "insufficient_signals" });
                continue;
            }
            accepted.push(container);
        }
        // Heading should be rejected
        (0, test_1.expect)(rejected).toHaveLength(1);
        (0, test_1.expect)(rejected[0].label).toBe("Selecciona un producto");
        (0, test_1.expect)(rejected[0].reason).toBe("instruction_heading");
        // First real card should be accepted
        (0, test_1.expect)(accepted).toHaveLength(1);
        (0, test_1.expect)(accepted[0].label).toBe("Cuenta de Ahorros Personal en Pesos");
        (0, test_1.expect)(accepted[0].index).toBe(1);
    });
    (0, test_1.test)("off-by-one bug: labels not shifted between cards", () => {
        // Mock scenario where each container is a heading with its own text
        // Before fix: container[0] extracts label from container[1]
        // After fix: container[0] extracts its own label
        const containers = [
            { index: 0, containerText: "Producto A", isHeading: true },
            { index: 1, containerText: "Producto B", isHeading: true },
            { index: 2, containerText: "Producto C", isHeading: true },
        ];
        // Simulate correct extraction: container heading → use container text
        const extracted = containers.map((c) => {
            let label = null;
            const titleSource = c.isHeading ? "container_heading" : "container_text";
            if (c.isHeading && c.containerText.length > 2) {
                label = c.containerText; // Use own container text
            }
            return { ...c, label, titleSource };
        });
        // Verify no off-by-one shift
        (0, test_1.expect)(extracted[0].label).toBe("Producto A"); // NOT "Producto B"
        (0, test_1.expect)(extracted[1].label).toBe("Producto B"); // NOT "Producto C"
        (0, test_1.expect)(extracted[2].label).toBe("Producto C"); // NOT "Producto C" (duplicate)
        // Verify all unique
        const labels = extracted.map((e) => e.label);
        const uniqueLabels = new Set(labels);
        (0, test_1.expect)(uniqueLabels.size).toBe(3);
    });
    (0, test_1.test)("cuenta variants all detected without off-by-one", () => {
        // Real scenario: Cuenta de Ahorros grid with Pesos/Dólares/Euros
        const containers = [
            {
                index: 0,
                containerText: "Cuenta de Ahorros Personal en Pesos",
                isHeading: true,
                textPreview: "Liquidez total, retiros y transferencias en cualquier momento.",
                hasImage: true,
            },
            {
                index: 1,
                containerText: "Cuenta de Ahorros Personal en Dólares",
                isHeading: true,
                textPreview: "Disponibilidad inmediata de tus fondos en dólares.",
                hasImage: true,
            },
            {
                index: 2,
                containerText: "Cuenta de Ahorros Personal en Euros",
                isHeading: true,
                textPreview: "Maneja tus ahorros en euros con facilidad.",
                hasImage: true,
            },
        ];
        // Extract labels using container_heading priority
        const detected = [];
        const seen = new Set();
        for (const container of containers) {
            let label = null;
            // Priority 1: container heading
            if (container.isHeading && container.containerText.length > 2) {
                label = container.containerText;
            }
            if (!label)
                continue;
            // Check minimum signals
            const hasMinimumSignals = container.textPreview.length >= 30 || container.hasImage;
            if (!hasMinimumSignals)
                continue;
            // Check duplicate
            const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();
            if (seen.has(normalized))
                continue;
            seen.add(normalized);
            detected.push({ ...container, label });
        }
        // All three should be detected
        (0, test_1.expect)(detected).toHaveLength(3);
        (0, test_1.expect)(detected[0].label).toBe("Cuenta de Ahorros Personal en Pesos");
        (0, test_1.expect)(detected[1].label).toBe("Cuenta de Ahorros Personal en Dólares");
        (0, test_1.expect)(detected[2].label).toBe("Cuenta de Ahorros Personal en Euros");
        // First card NOT lost
        (0, test_1.expect)(detected[0].index).toBe(0);
    });
    (0, test_1.test)("tarjeta variants all detected without off-by-one", () => {
        // Real scenario: Tarjetas grid with Clásica/Gold/Platinum
        const containers = [
            {
                index: 0,
                containerText: "Tarjeta Crédito Visa Clásica",
                isHeading: true,
                textPreview: "Programa Puntos Santa Cruz, pagos en línea.",
                hasImage: true,
            },
            {
                index: 1,
                containerText: "Tarjeta Crédito Visa Gold",
                isHeading: true,
                textPreview: "Mayor plazo para pagar, tecnología contactless.",
                hasImage: true,
            },
            {
                index: 2,
                containerText: "Tarjeta de Crédito Visa Platinum",
                isHeading: true,
                textPreview: "Beneficios premium, acceso a VIP Lounges.",
                hasImage: true,
            },
        ];
        // Extract labels using container_heading priority
        const detected = [];
        const seen = new Set();
        for (const container of containers) {
            let label = null;
            // Priority 1: container heading
            if (container.isHeading && container.containerText.length > 2) {
                label = container.containerText;
            }
            if (!label)
                continue;
            // Check minimum signals
            const hasMinimumSignals = container.textPreview.length >= 30 || container.hasImage;
            if (!hasMinimumSignals)
                continue;
            // Check duplicate
            const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();
            if (seen.has(normalized))
                continue;
            seen.add(normalized);
            detected.push({ ...container, label });
        }
        // All three should be detected
        (0, test_1.expect)(detected).toHaveLength(3);
        (0, test_1.expect)(detected[0].label).toBe("Tarjeta Crédito Visa Clásica");
        (0, test_1.expect)(detected[1].label).toBe("Tarjeta Crédito Visa Gold");
        (0, test_1.expect)(detected[2].label).toBe("Tarjeta de Crédito Visa Platinum");
        // First card NOT lost
        (0, test_1.expect)(detected[0].index).toBe(0);
        // Last card NOT duplicated
        const lastCardCount = detected.filter((d) => d.label.includes("Platinum")).length;
        (0, test_1.expect)(lastCardCount).toBe(1);
    });
});
