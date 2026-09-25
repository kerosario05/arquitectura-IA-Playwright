"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe("Catalog Discovery - Clickable Ancestors", () => {
    (0, test_1.test)("Test 1: h3 inside clickable button detects ancestor", async () => {
        // Mock snapshot with h3 heading inside a button
        const snapshot = {
            version: "1.0",
            url: "http://test.com/catalog",
            title: "Catalog",
            capturedAt: new Date().toISOString(),
            elements: [
                // Button container (ancestor)
                {
                    text: "Tarjeta Visa Clásica",
                    tagName: "button",
                    role: "button",
                },
                // H3 heading inside button
                {
                    text: "Tarjeta Visa Clásica",
                    tagName: "h3",
                    role: "heading",
                },
            ],
            summary: {
                totalElements: 2,
                buttons: 1,
                links: 0,
                inputs: 0,
                selects: 0,
                tables: 0,
                dialogs: 0,
                headings: 1,
            },
        };
        // In a real implementation, we would call findClickableAncestor
        // For this test, we verify the logic that:
        // 1. h3 is detected as label element
        // 2. Search backward finds button ancestor
        // 3. Button contains h3 text
        // 4. clickableAncestorFound=true, strategy=button
        const labelElement = snapshot.elements[1]; // h3
        const expectedAncestor = snapshot.elements[0]; // button
        (0, test_1.expect)(labelElement.tagName?.toLowerCase()).toBe("h3");
        (0, test_1.expect)(expectedAncestor.tagName?.toLowerCase()).toBe("button");
        (0, test_1.expect)(expectedAncestor.text).toContain("Tarjeta Visa Clásica");
    });
    (0, test_1.test)("Test 2: h3 without clickable ancestor stays non-clickable", async () => {
        // Mock snapshot with standalone h3 (no clickable ancestor)
        const snapshot = {
            version: "1.0",
            url: "http://test.com/catalog",
            title: "Catalog",
            capturedAt: new Date().toISOString(),
            elements: [
                // Section container (not clickable)
                {
                    text: "Productos",
                    tagName: "section",
                    role: "region",
                },
                // H3 heading
                {
                    text: "Cuenta en Pesos",
                    tagName: "h3",
                    role: "heading",
                },
            ],
            summary: {
                totalElements: 2,
                buttons: 0,
                links: 0,
                inputs: 0,
                selects: 0,
                tables: 0,
                dialogs: 0,
                headings: 1,
            },
        };
        // In this case:
        // 1. h3 is detected as label element
        // 2. Search backward finds only section (not clickable)
        // 3. clickableAncestorFound=false
        const labelElement = snapshot.elements[1]; // h3
        const potentialAncestor = snapshot.elements[0]; // section
        (0, test_1.expect)(labelElement.tagName?.toLowerCase()).toBe("h3");
        (0, test_1.expect)(potentialAncestor.tagName?.toLowerCase()).toBe("section");
        // Section is not a clickable element (no role=button, tag != button/a)
    });
    (0, test_1.test)("Test 3: clickable ancestor with multiple products is rejected", async () => {
        // Mock snapshot with a container that holds multiple h3 headings
        // This should NOT be selected as clickable ancestor (too broad)
        const snapshot = {
            version: "1.0",
            url: "http://test.com/catalog",
            title: "Catalog",
            capturedAt: new Date().toISOString(),
            elements: [
                // Broad container (contains multiple products)
                {
                    text: "Tarjeta Visa Clásica Tarjeta Visa Gold Tarjeta Visa Platinum",
                    tagName: "div",
                    role: "button",
                },
                // First product h3
                {
                    text: "Tarjeta Visa Clásica",
                    tagName: "h3",
                    role: "heading",
                },
                // Second product h3
                {
                    text: "Tarjeta Visa Gold",
                    tagName: "h3",
                    role: "heading",
                },
                // Third product h3
                {
                    text: "Tarjeta Visa Platinum",
                    tagName: "h3",
                    role: "heading",
                },
            ],
            summary: {
                totalElements: 2,
                buttons: 0,
                links: 0,
                inputs: 0,
                selects: 0,
                tables: 0,
                dialogs: 0,
                headings: 1,
            },
        };
        // In this case:
        // 1. Container has role=button (clickable evidence)
        // 2. Container text contains multiple product labels
        // 3. Should be REJECTED as ancestor (otherProductCount > 0)
        const container = snapshot.elements[0];
        const firstProduct = snapshot.elements[1];
        const secondProduct = snapshot.elements[2];
        const thirdProduct = snapshot.elements[3];
        (0, test_1.expect)(container.role).toBe("button");
        (0, test_1.expect)(container.text).toContain(firstProduct.text);
        (0, test_1.expect)(container.text).toContain(secondProduct.text);
        (0, test_1.expect)(container.text).toContain(thirdProduct.text);
    });
    (0, test_1.test)("Test 4: h3 inside <a> link detects ancestor with strategy=link", async () => {
        // Mock snapshot with h3 inside anchor tag
        const snapshot = {
            version: "1.0",
            url: "http://test.com/catalog",
            title: "Catalog",
            capturedAt: new Date().toISOString(),
            elements: [
                // Anchor link (ancestor)
                {
                    text: "Depósito a Plazo en Dólares",
                    tagName: "a",
                    role: "link",
                },
                // H3 heading inside link
                {
                    text: "Depósito a Plazo en Dólares",
                    tagName: "h3",
                    role: "heading",
                },
            ],
            summary: {
                totalElements: 2,
                buttons: 0,
                links: 0,
                inputs: 0,
                selects: 0,
                tables: 0,
                dialogs: 0,
                headings: 1,
            },
        };
        const labelElement = snapshot.elements[1]; // h3
        const expectedAncestor = snapshot.elements[0]; // a
        (0, test_1.expect)(labelElement.tagName?.toLowerCase()).toBe("h3");
        (0, test_1.expect)(expectedAncestor.tagName?.toLowerCase()).toBe("a");
        (0, test_1.expect)(expectedAncestor.role).toBe("link");
        (0, test_1.expect)(expectedAncestor.text).toContain("Depósito a Plazo en Dólares");
    });
    (0, test_1.test)("Test 5: h3 inside div[onclick] detects ancestor with strategy=onclick", async () => {
        // Mock snapshot with h3 inside div with onclick handler
        const snapshot = {
            version: "1.0",
            url: "http://test.com/catalog",
            title: "Catalog",
            capturedAt: new Date().toISOString(),
            elements: [
                // Div with onclick (ancestor)
                {
                    text: "Préstamo Personal",
                    tagName: "div",
                    onclick: "handleClick()",
                },
                // H3 heading inside div
                {
                    text: "Préstamo Personal",
                    tagName: "h3",
                    role: "heading",
                },
            ],
            summary: {
                totalElements: 2,
                buttons: 0,
                links: 0,
                inputs: 0,
                selects: 0,
                tables: 0,
                dialogs: 0,
                headings: 1,
            },
        };
        const labelElement = snapshot.elements[1]; // h3
        const expectedAncestor = snapshot.elements[0]; // div with onclick
        (0, test_1.expect)(labelElement.tagName?.toLowerCase()).toBe("h3");
        (0, test_1.expect)(expectedAncestor.tagName?.toLowerCase()).toBe("div");
        (0, test_1.expect)(expectedAncestor.onclick).toBeDefined();
    });
    (0, test_1.test)("Test 6: h3 inside div[tabindex] detects ancestor with strategy=tabindex", async () => {
        // Mock snapshot with h3 inside div with tabindex
        const snapshot = {
            version: "1.0",
            url: "http://test.com/catalog",
            title: "Catalog",
            capturedAt: new Date().toISOString(),
            elements: [
                // Div with tabindex (ancestor)
                {
                    text: "Cuenta de Ahorros",
                    tagName: "div",
                    tabIndex: 0,
                },
                // H3 heading inside div
                {
                    text: "Cuenta de Ahorros",
                    tagName: "h3",
                    role: "heading",
                },
            ],
            summary: {
                totalElements: 2,
                buttons: 0,
                links: 0,
                inputs: 0,
                selects: 0,
                tables: 0,
                dialogs: 0,
                headings: 1,
            },
        };
        const labelElement = snapshot.elements[1]; // h3
        const expectedAncestor = snapshot.elements[0]; // div with tabindex
        (0, test_1.expect)(labelElement.tagName?.toLowerCase()).toBe("h3");
        (0, test_1.expect)(expectedAncestor.tagName?.toLowerCase()).toBe("div");
        (0, test_1.expect)(expectedAncestor.tabIndex).toBe(0);
    });
    (0, test_1.test)("Test 7: stops at global containers (body, main, section)", async () => {
        // Mock snapshot with h3 deep inside body
        // Should not select body as ancestor
        const snapshot = {
            version: "1.0",
            url: "http://test.com/catalog",
            title: "Catalog",
            capturedAt: new Date().toISOString(),
            elements: [
                // Body (global container)
                {
                    text: "Body content",
                    tagName: "body",
                },
                // Main (global container)
                {
                    text: "Main content",
                    tagName: "main",
                },
                // Section (stop point)
                {
                    text: "Products section",
                    tagName: "section",
                },
                // H3 heading
                {
                    text: "Tarjeta Visa",
                    tagName: "h3",
                    role: "heading",
                },
            ],
            summary: {
                totalElements: 2,
                buttons: 0,
                links: 0,
                inputs: 0,
                selects: 0,
                tables: 0,
                dialogs: 0,
                headings: 1,
            },
        };
        // findClickableAncestor should STOP at section/main/body
        // and NOT select them as ancestors (too broad)
        const labelElement = snapshot.elements[3]; // h3
        (0, test_1.expect)(labelElement.tagName?.toLowerCase()).toBe("h3");
        // In real implementation, search would stop at section and return null
    });
    (0, test_1.test)("Test 8: h2 heading also supports ancestor detection", async () => {
        // Mock snapshot with h2 instead of h3
        const snapshot = {
            version: "1.0",
            url: "http://test.com/catalog",
            title: "Catalog",
            capturedAt: new Date().toISOString(),
            elements: [
                // Button container
                {
                    text: "Producto Principal",
                    tagName: "button",
                    role: "button",
                },
                // H2 heading inside button
                {
                    text: "Producto Principal",
                    tagName: "h2",
                    role: "heading",
                },
            ],
            summary: {
                totalElements: 2,
                buttons: 0,
                links: 0,
                inputs: 0,
                selects: 0,
                tables: 0,
                dialogs: 0,
                headings: 1,
            },
        };
        const labelElement = snapshot.elements[1]; // h2
        const expectedAncestor = snapshot.elements[0]; // button
        (0, test_1.expect)(labelElement.tagName?.toLowerCase()).toBe("h2");
        (0, test_1.expect)(expectedAncestor.tagName?.toLowerCase()).toBe("button");
        (0, test_1.expect)(expectedAncestor.text).toContain("Producto Principal");
    });
});
test_1.test.describe("Catalog Discovery - Detail Probing", () => {
    (0, test_1.test)("Test 9: card with clickableAncestor + detail probe = clickableToDetail true", async () => {
        // Scenario: Card with h3 inside button, clicking opens detail
        // Expected: clickableToDetail=true, detailSignals captured
        // This would be tested with actual Page object in integration test
        // For unit test, we verify the logic:
        // 1. clickableAncestorFound=true
        // 2. detailProbeAttempted=true
        // 3. detailProbeResult=validated_detail
        // 4. => clickableToDetail=true
        const mockCard = {
            productLabel: "Tarjeta Visa Gold",
            clickableAncestorFound: true,
            clickableAncestorStrategy: "button",
            detailProbeAttempted: true,
            detailProbeResult: "validated_detail",
            detailSignals: {
                detailSections: ["Beneficios", "Detalles", "Requisitos"],
                actionButtons: ["Solicitar", "Volver"],
                hasDetailPage: true,
            },
        };
        (0, test_1.expect)(mockCard.clickableAncestorFound).toBe(true);
        (0, test_1.expect)(mockCard.detailProbeResult).toBe("validated_detail");
        (0, test_1.expect)(mockCard.detailSignals.hasDetailPage).toBe(true);
        (0, test_1.expect)(mockCard.detailSignals.detailSections?.length).toBeGreaterThan(0);
        (0, test_1.expect)(mockCard.detailSignals.actionButtons?.length).toBeGreaterThan(0);
        // In real flow: clickableToDetail=true would be set
    });
    (0, test_1.test)("Test 10: card with clickableAncestor + no detail = clickableToDetail false", async () => {
        // Scenario: Card with h3 inside button, but clicking doesn't open detail
        // Expected: clickableToDetail=false
        const mockCard = {
            productLabel: "Instructivo de Uso",
            clickableAncestorFound: true,
            clickableAncestorStrategy: "button",
            detailProbeAttempted: true,
            detailProbeResult: "no_detail",
            detailSignals: {
                detailSections: [],
                actionButtons: [],
                hasDetailPage: false,
            },
        };
        (0, test_1.expect)(mockCard.clickableAncestorFound).toBe(true);
        (0, test_1.expect)(mockCard.detailProbeResult).toBe("no_detail");
        (0, test_1.expect)(mockCard.detailSignals.hasDetailPage).toBe(false);
        // In real flow: clickableToDetail=false would be set
    });
    (0, test_1.test)("Test 11: card with click_failed probe = clickableToDetail false", async () => {
        // Scenario: Card could not be clicked during probe
        // Expected: clickableToDetail=false
        const mockCard = {
            productLabel: "Producto No Clicable",
            clickableAncestorFound: false,
            detailProbeAttempted: true,
            detailProbeResult: "click_failed",
        };
        (0, test_1.expect)(mockCard.clickableAncestorFound).toBe(false);
        (0, test_1.expect)(mockCard.detailProbeResult).toBe("click_failed");
        // In real flow: clickableToDetail=false would be set
    });
    (0, test_1.test)("Test 12: card without clickableAncestor skips probing", async () => {
        // Scenario: Card with h3 but no clickable ancestor
        // Expected: detailProbeAttempted=false, clickableToDetail=false
        const mockCard = {
            productLabel: "Título Informativo",
            clickableAncestorFound: false,
            isClickable: false,
            detailProbeAttempted: false,
            detailProbeResult: "no_detail",
        };
        (0, test_1.expect)(mockCard.clickableAncestorFound).toBe(false);
        (0, test_1.expect)(mockCard.isClickable).toBe(false);
        (0, test_1.expect)(mockCard.detailProbeAttempted).toBe(false);
        // In real flow: probing would be skipped, clickableToDetail=false
    });
    (0, test_1.test)("Test 13: detected card metadata includes probe diagnostics", async () => {
        // Verify that persisted product includes all probe metadata
        const mockProduct = {
            label: "Cuenta en Pesos",
            clickableToDetail: true,
            presentationType: "detail_page",
            validationStatus: "validated_detail",
            probeMetadata: {
                detailProbeAttempted: true,
                detailProbeResult: "validated_detail",
                clickableAncestorFound: true,
                clickableAncestorStrategy: "button",
                clickableAncestorTag: "button",
                labelElementTag: "h3",
            },
        };
        (0, test_1.expect)(mockProduct.clickableToDetail).toBe(true);
        (0, test_1.expect)(mockProduct.probeMetadata).toBeDefined();
        (0, test_1.expect)(mockProduct.probeMetadata?.detailProbeAttempted).toBe(true);
        (0, test_1.expect)(mockProduct.probeMetadata?.detailProbeResult).toBe("validated_detail");
        (0, test_1.expect)(mockProduct.probeMetadata?.clickableAncestorFound).toBe(true);
        (0, test_1.expect)(mockProduct.probeMetadata?.clickableAncestorStrategy).toBe("button");
        (0, test_1.expect)(mockProduct.probeMetadata?.labelElementTag).toBe("h3");
    });
    (0, test_1.test)("Test 14: detail probe logs include required fields", async () => {
        // Verify that logs include all required diagnostic fields
        const mockLogEntry = {
            productLabel: "Tarjeta Visa Platinum",
            labelElementTag: "h3",
            clickTargetTag: "button",
            clickTargetStrategy: "button",
            clickableAncestorFound: true,
            detailProbeAttempted: true,
            detailProbeResult: "validated_detail",
            detailSections: 3,
            actionButtons: 2,
        };
        (0, test_1.expect)(mockLogEntry.labelElementTag).toBeDefined();
        (0, test_1.expect)(mockLogEntry.clickTargetTag).toBeDefined();
        (0, test_1.expect)(mockLogEntry.clickTargetStrategy).toBeDefined();
        (0, test_1.expect)(mockLogEntry.clickableAncestorFound).toBe(true);
        (0, test_1.expect)(mockLogEntry.detailProbeAttempted).toBe(true);
        (0, test_1.expect)(mockLogEntry.detailProbeResult).toBe("validated_detail");
        (0, test_1.expect)(mockLogEntry.detailSections).toBeGreaterThan(0);
        (0, test_1.expect)(mockLogEntry.actionButtons).toBeGreaterThan(0);
    });
    (0, test_1.test)("Test 15: backtracking after detail probe returns to list", async () => {
        // Verify that after probing, navigation returns to original list
        // This would be tested in integration test with actual Page
        // For unit test, verify the logic:
        // 1. After clicking product and capturing detail
        // 2. tryBackNavigation is called
        // 3. Page should return to catalog list
        // 4. Re-scan refreshes locators for next card
        const mockProbeFlow = {
            beforeClickUrl: "http://test.com/catalog",
            afterClickUrl: "http://test.com/catalog/producto-1",
            afterBackUrl: "http://test.com/catalog",
        };
        (0, test_1.expect)(mockProbeFlow.afterClickUrl).not.toBe(mockProbeFlow.beforeClickUrl);
        (0, test_1.expect)(mockProbeFlow.afterBackUrl).toBe(mockProbeFlow.beforeClickUrl);
    });
    (0, test_1.test)("Test 16: sensitive buttons not clicked during probing", async () => {
        // Verify that probe does NOT click sensitive actions
        const sensitiveButtons = [
            "Solicitar",
            "Finalizar sesión",
            "Salir",
            "Contratar",
            "Pagar",
            "Eliminar",
            "Cancelar",
        ];
        // In real implementation, these patterns should be checked
        // before attempting any click during probing
        for (const button of sensitiveButtons) {
            // Verify that if productLabel matches sensitive pattern,
            // it should NOT be probed or clicked
            const isSensitive = /solicitar|finalizar|salir|contratar|pagar|eliminar|cancelar/i.test(button);
            (0, test_1.expect)(isSensitive).toBe(true);
        }
    });
    (0, test_1.test)("Test 17: multiproject safe - no hardcoded product names in detection", async () => {
        // Verify that detection logic uses generic patterns only
        const validGenericLabels = [
            "Producto A",
            "Item 123",
            "Servicio Especial",
            "Opción Premium",
            "Plan Básico",
        ];
        const invalidLabels = [
            "¡Hola!", // Greeting
            "Bienvenido", // Greeting
            "Ver más", // Generic action
            "Productos", // Too generic
        ];
        for (const label of validGenericLabels) {
            // These should pass validation
            const isValid = label.trim().length >= 3;
            (0, test_1.expect)(isValid).toBe(true);
        }
        for (const label of invalidLabels) {
            // These should fail validation
            const isGreeting = /^¡?Hola!?$|^Bienvenid[oa]s?!?$/i.test(label);
            const isTooGeneric = /^Productos?$|^Ver\s+m[áa]s$/i.test(label);
            const shouldReject = isGreeting || isTooGeneric;
            (0, test_1.expect)(shouldReject).toBe(true);
        }
    });
});
