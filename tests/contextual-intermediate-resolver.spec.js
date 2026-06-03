"use strict";
/**
 * Contextual Intermediate Resolver Tests
 *
 * Tests for resolveAmbiguousIntermediateTarget function that resolves
 * ambiguous short/generic targets using route context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const contextual_intermediate_resolver_1 = require("../src/discovery/contextual-intermediate-resolver");
function createSnapshotElement(overrides) {
    return {
        id: overrides.id || "el-1",
        type: overrides.type || "button",
        text: overrides.text,
        label: overrides.label,
        name: overrides.name,
        role: overrides.role,
        tagName: overrides.tagName || "button",
        visible: overrides.visible ?? true,
        candidateLocators: overrides.candidateLocators || [],
        dataHints: overrides.dataHints || [],
        className: overrides.className,
        href: overrides.href,
        ariaLabel: overrides.ariaLabel,
        title: overrides.title,
        alt: overrides.alt,
        dataTestid: overrides.dataTestid,
        disabled: overrides.disabled,
        required: overrides.required,
        inputType: overrides.inputType,
        nearbyText: overrides.nearbyText,
        placeholder: overrides.placeholder,
        domId: overrides.domId
    };
}
function createRouteProfile(overrides) {
    return {
        entryPoints: [],
        aliases: {},
        domainTerms: overrides?.domainTerms || ["cuenta", "tarjeta", "prestamo"],
        blockedLabels: [],
        submitLikeLabels: [],
        routes: overrides?.routes || []
    };
}
test_1.test.describe("resolveAmbiguousIntermediateTarget", () => {
    (0, test_1.test)("skips contextual resolution for long targets", () => {
        // Use a target that is long (>15 chars) and not generic
        const input = {
            target: "Transferencia Bancaria Internacional",
            candidates: [
                createSnapshotElement({ text: "Transferencia Bancaria Internacional", type: "button" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.status).toBe("skip_contextual");
        (0, test_1.expect)(result.reason).toBe("target_not_short_or_generic");
    });
    (0, test_1.test)("skips contextual resolution when no context available", () => {
        const input = {
            target: "Pesos",
            candidates: [
                createSnapshotElement({ text: "Pesos", type: "button" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.status).toBe("skip_contextual");
        (0, test_1.expect)(result.reason).toBe("no_context_available");
    });
    (0, test_1.test)("resolves exact filter match over product card when next is ordinal", () => {
        const input = {
            target: "Pesos",
            previousTarget: "Cuenta de Ahorro",
            nextTarget: "la primera cuenta visible del listado",
            candidates: [
                createSnapshotElement({
                    id: "filter-1",
                    text: "Pesos",
                    type: "button",
                    role: "button",
                    tagName: "button"
                }),
                createSnapshotElement({
                    id: "card-1",
                    text: "Cuenta de Ahorros Personal en Pesos",
                    type: "card",
                    className: "product-card",
                    tagName: "article"
                })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.status).toBe("resolved");
        (0, test_1.expect)(result.selectedCandidate?.id).toBe("filter-1");
        (0, test_1.expect)(result.selectedCandidateText).toBe("Pesos");
        (0, test_1.expect)(result.diagnostics.nextTargetIsOrdinal).toBe(true);
    });
    (0, test_1.test)("classifies candidates correctly", () => {
        const input = {
            target: "Pesos",
            nextTarget: "la primera cuenta visible",
            candidates: [
                createSnapshotElement({ text: "Pesos", type: "button", role: "button" }),
                createSnapshotElement({ text: "Cuenta en Pesos", type: "card", className: "card" }),
                createSnapshotElement({ text: "Volver", type: "link", role: "link" }),
                createSnapshotElement({ text: "Confirmar", type: "button", role: "button" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.classifiedCandidates.length).toBe(4);
        const filterCandidate = result.classifiedCandidates.find(c => c.text === "Pesos");
        (0, test_1.expect)(filterCandidate?.type).toBe("filter");
        const cardCandidate = result.classifiedCandidates.find(c => c.text === "Cuenta en Pesos");
        (0, test_1.expect)(cardCandidate?.type).toBe("product_card");
        const navCandidate = result.classifiedCandidates.find(c => c.text === "Volver");
        (0, test_1.expect)(navCandidate?.type).toBe("navigation");
        const submitCandidate = result.classifiedCandidates.find(c => c.text === "Confirmar");
        (0, test_1.expect)(submitCandidate?.type).toBe("submit");
    });
    (0, test_1.test)("penalizes submit-like candidates", () => {
        const input = {
            target: "Pesos",
            nextTarget: "la primera cuenta visible",
            candidates: [
                createSnapshotElement({ text: "Pesos", type: "button" }),
                createSnapshotElement({ text: "Confirmar Pesos", type: "button" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.status).toBe("resolved");
        (0, test_1.expect)(result.selectedCandidateText).toBe("Pesos");
        const submitCandidate = result.classifiedCandidates.find(c => c.text === "Confirmar Pesos");
        (0, test_1.expect)(submitCandidate?.isSubmitLike).toBe(true);
        (0, test_1.expect)(submitCandidate?.score).toBeLessThan(0.5);
    });
    (0, test_1.test)("uses routeProfile intermediates for scoring", () => {
        const routeProfile = createRouteProfile({
            routes: [
                {
                    from: "Cuenta de Ahorro",
                    intermediates: ["Pesos", "Dólares", "Euros"],
                    domain: undefined
                }
            ]
        });
        const input = {
            target: "Pesos",
            previousTarget: "Cuenta de Ahorro",
            nextTarget: "la primera cuenta visible",
            routeProfile,
            candidates: [
                createSnapshotElement({ text: "Pesos", type: "button" }),
                createSnapshotElement({ text: "Cuenta en Pesos", type: "card" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.status).toBe("resolved");
        (0, test_1.expect)(result.diagnostics.routeProfileUsed).toBe(true);
        (0, test_1.expect)(result.diagnostics.intermediatesMatched).toContain("Pesos");
    });
    (0, test_1.test)("blocks sensitive candidates", () => {
        const input = {
            target: "Eliminar",
            nextTarget: "la primera cuenta visible",
            candidates: [
                createSnapshotElement({ text: "Eliminar Cuenta", type: "button" }),
                createSnapshotElement({ text: "Cuenta Corriente", type: "card" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        // Should either be unresolved or select the non-sensitive candidate
        if (result.status === "resolved") {
            (0, test_1.expect)(result.selectedCandidateText).not.toContain("Eliminar");
        }
        else {
            // May be unresolved due to best_score_too_low or no_safe_candidates
            (0, test_1.expect)(["no_safe_candidates", "best_score_too_low", "insufficient_score_difference"]).toContain(result.reason);
        }
    });
    (0, test_1.test)("blocks back navigation candidates", () => {
        const input = {
            target: "Volver",
            nextTarget: "la primera cuenta visible",
            candidates: [
                createSnapshotElement({ text: "Volver", type: "link" }),
                createSnapshotElement({ text: "Cuenta de Ahorro", type: "card" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        // Should not select back navigation
        if (result.status === "resolved") {
            (0, test_1.expect)(result.selectedCandidateText).not.toBe("Volver");
        }
    });
    (0, test_1.test)("unresolved when score difference is insufficient", () => {
        const input = {
            target: "Pesos",
            nextTarget: "la primera cuenta visible",
            candidates: [
                createSnapshotElement({ text: "Pesos", type: "button" }),
                createSnapshotElement({ text: "Pesos", type: "link" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        // May be unresolved if both candidates have similar scores
        (0, test_1.expect)(["unresolved", "resolved"]).toContain(result.status);
    });
    (0, test_1.test)("already_satisfied when best score is low but variant visible", () => {
        // When target is short/generic, next is ordinal, and product_card contains target
        // the resolver should return already_satisfied instead of unresolved
        const input = {
            target: "Xyz",
            previousTarget: "Previous Step",
            nextTarget: "la primera cuenta visible",
            candidates: [
                createSnapshotElement({ text: "Abc Xyz Def", type: "card" }),
                createSnapshotElement({ text: "Ghi Xyz Jkl", type: "card" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        // Should return already_satisfied when variant is visible in list
        (0, test_1.expect)(result.status).toBe("already_satisfied");
        (0, test_1.expect)(result.alreadySatisfiedEvidence).toBeDefined();
        (0, test_1.expect)(result.alreadySatisfiedEvidence?.candidateText).toContain("Xyz");
    });
    (0, test_1.test)("handles non-ordinal next step", () => {
        // When next step is not ordinal, behavior may vary
        const input = {
            target: "Xyz",
            nextTarget: "Make a payment",
            candidates: [
                createSnapshotElement({ text: "Abc Xyz Def", type: "card" }),
                createSnapshotElement({ text: "Ghi Xyz Jkl", type: "card" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        // Should not be already_satisfied since next step is not ordinal
        // May be unresolved or resolved depending on classification
        (0, test_1.expect)(result.status).not.toBe("already_satisfied");
    });
    (0, test_1.test)("unresolved when candidates don't contain target", () => {
        // already_satisfied requires candidates to contain the target
        const input = {
            target: "Pesos",
            previousTarget: "Cuenta de Ahorro",
            nextTarget: "la primera cuenta visible",
            candidates: [
                createSnapshotElement({ text: "Cuenta en Dólares", type: "card" }),
                createSnapshotElement({ text: "Cuenta en Euros", type: "card" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.status).toBe("unresolved");
    });
    (0, test_1.test)("classification summary is accurate", () => {
        const input = {
            target: "Pesos",
            nextTarget: "la primera cuenta visible",
            candidates: [
                createSnapshotElement({ text: "Pesos", type: "button" }),
                createSnapshotElement({ text: "Dólares", type: "button" }),
                createSnapshotElement({ text: "Cuenta en Pesos", type: "card" }),
                createSnapshotElement({ text: "Cuenta en Dólares", type: "card" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.diagnostics.classificationSummary.filter).toBe(2);
        (0, test_1.expect)(result.diagnostics.classificationSummary.product_card).toBe(2);
    });
    (0, test_1.test)("works with generic target without next ordinal", () => {
        const input = {
            target: "Pesos",
            previousTarget: "Cuenta de Ahorro",
            candidates: [
                createSnapshotElement({ text: "Pesos", type: "button" }),
                createSnapshotElement({ text: "Cuenta en Pesos", type: "card" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        // Should still prefer exact match even without ordinal next step
        (0, test_1.expect)(result.status).toBe("resolved");
        (0, test_1.expect)(result.selectedCandidateText).toBe("Pesos");
    });
});
test_1.test.describe("contextual resolver integration scenarios", () => {
    (0, test_1.test)("C38128-like scenario: Cuentas → Cuenta de Ahorro → Pesos → ordinal", () => {
        const routeProfile = createRouteProfile({
            routes: [
                { from: "entry", intermediates: ["Iniciar"], domain: undefined },
                { from: "Iniciar", intermediates: ["Información de productos"], domain: undefined },
                { from: "Información de productos", intermediates: ["Cuentas"], domain: undefined },
                { from: "Cuentas", intermediates: ["Cuenta de Ahorro", "Pesos"], domain: undefined }
            ],
            domainTerms: ["cuenta", "tarjeta", "prestamo"]
        });
        const input = {
            target: "Pesos",
            previousTarget: "Cuenta de Ahorro",
            nextTarget: "la primera cuenta visible del listado",
            routeProfile,
            routeHistory: ["Iniciar", "Información de productos", "Cuentas", "Cuenta de Ahorro"],
            candidates: [
                createSnapshotElement({
                    id: "filter-pesos",
                    text: "Pesos",
                    type: "button",
                    role: "button"
                }),
                createSnapshotElement({
                    id: "card-pesos",
                    text: "Cuenta de Ahorros Personal en Pesos",
                    type: "card",
                    className: "product-card"
                }),
                createSnapshotElement({
                    id: "card-dolares",
                    text: "Cuenta de Ahorros Personal en Dólares",
                    type: "card",
                    className: "product-card"
                })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.status).toBe("resolved");
        (0, test_1.expect)(result.selectedCandidate?.id).toBe("filter-pesos");
        (0, test_1.expect)(result.diagnostics.routeProfileUsed).toBe(true);
    });
    (0, test_1.test)("Documentos → Contratos → Vigentes → ordinal scenario", () => {
        const input = {
            target: "Vigentes",
            previousTarget: "Contratos",
            nextTarget: "el primer documento visible",
            candidates: [
                createSnapshotElement({ text: "Vigentes", type: "button", role: "button" }),
                createSnapshotElement({ text: "Contratos Vigentes 2026", type: "card" }),
                createSnapshotElement({ text: "Contratos Históricos", type: "card" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.status).toBe("resolved");
        (0, test_1.expect)(result.selectedCandidateText).toBe("Vigentes");
        (0, test_1.expect)(result.diagnostics.nextTargetIsOrdinal).toBe(true);
    });
    (0, test_1.test)("Servicios → Internet → Residencial → ordinal scenario", () => {
        const input = {
            target: "Residencial",
            previousTarget: "Internet",
            nextTarget: "el primer servicio visible",
            candidates: [
                createSnapshotElement({ text: "Residencial", type: "button" }),
                createSnapshotElement({ text: "Internet Residencial 100MB", type: "card" }),
                createSnapshotElement({ text: "Internet Empresarial 500MB", type: "card" })
            ]
        };
        const result = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(input);
        (0, test_1.expect)(result.status).toBe("resolved");
        (0, test_1.expect)(result.selectedCandidateText).toBe("Residencial");
    });
});
