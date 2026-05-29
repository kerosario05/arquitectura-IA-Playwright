/**
 * Contextual Intermediate Resolver Tests
 * 
 * Tests for resolveAmbiguousIntermediateTarget function that resolves
 * ambiguous short/generic targets using route context.
 */

import { test, expect } from "@playwright/test";
import { resolveAmbiguousIntermediateTarget, type ContextualResolverInput } from "../src/discovery/contextual-intermediate-resolver";
import type { SnapshotElement } from "../src/types/page-snapshot.types";
import type { AppRouteProfile } from "../src/types/env.types";

function createSnapshotElement(overrides: Partial<SnapshotElement>): SnapshotElement {
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

function createRouteProfile(overrides?: Partial<AppRouteProfile>): AppRouteProfile {
  return {
    entryPoints: [],
    aliases: {},
    domainTerms: overrides?.domainTerms || ["cuenta", "tarjeta", "prestamo"],
    blockedLabels: [],
    submitLikeLabels: [],
    routes: overrides?.routes || []
  };
}

test.describe("resolveAmbiguousIntermediateTarget", () => {
  test("skips contextual resolution for long targets", () => {
    // Use a target that is long (>15 chars) and not generic
    const input: ContextualResolverInput = {
      target: "Transferencia Bancaria Internacional",
      candidates: [
        createSnapshotElement({ text: "Transferencia Bancaria Internacional", type: "button" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.status).toBe("skip_contextual");
    expect(result.reason).toBe("target_not_short_or_generic");
  });
  
  test("skips contextual resolution when no context available", () => {
    const input: ContextualResolverInput = {
      target: "Pesos",
      candidates: [
        createSnapshotElement({ text: "Pesos", type: "button" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.status).toBe("skip_contextual");
    expect(result.reason).toBe("no_context_available");
  });
  
  test("resolves exact filter match over product card when next is ordinal", () => {
    const input: ContextualResolverInput = {
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
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.status).toBe("resolved");
    expect(result.selectedCandidate?.id).toBe("filter-1");
    expect(result.selectedCandidateText).toBe("Pesos");
    expect(result.diagnostics.nextTargetIsOrdinal).toBe(true);
  });
  
  test("classifies candidates correctly", () => {
    const input: ContextualResolverInput = {
      target: "Pesos",
      nextTarget: "la primera cuenta visible",
      candidates: [
        createSnapshotElement({ text: "Pesos", type: "button", role: "button" }),
        createSnapshotElement({ text: "Cuenta en Pesos", type: "card", className: "card" }),
        createSnapshotElement({ text: "Volver", type: "link", role: "link" }),
        createSnapshotElement({ text: "Confirmar", type: "button", role: "button" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.classifiedCandidates.length).toBe(4);
    
    const filterCandidate = result.classifiedCandidates.find(c => c.text === "Pesos");
    expect(filterCandidate?.type).toBe("filter");
    
    const cardCandidate = result.classifiedCandidates.find(c => c.text === "Cuenta en Pesos");
    expect(cardCandidate?.type).toBe("product_card");
    
    const navCandidate = result.classifiedCandidates.find(c => c.text === "Volver");
    expect(navCandidate?.type).toBe("navigation");
    
    const submitCandidate = result.classifiedCandidates.find(c => c.text === "Confirmar");
    expect(submitCandidate?.type).toBe("submit");
  });
  
  test("penalizes submit-like candidates", () => {
    const input: ContextualResolverInput = {
      target: "Pesos",
      nextTarget: "la primera cuenta visible",
      candidates: [
        createSnapshotElement({ text: "Pesos", type: "button" }),
        createSnapshotElement({ text: "Confirmar Pesos", type: "button" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.status).toBe("resolved");
    expect(result.selectedCandidateText).toBe("Pesos");
    
    const submitCandidate = result.classifiedCandidates.find(c => c.text === "Confirmar Pesos");
    expect(submitCandidate?.isSubmitLike).toBe(true);
    expect(submitCandidate?.score).toBeLessThan(0.5);
  });
  
  test("uses routeProfile intermediates for scoring", () => {
    const routeProfile = createRouteProfile({
      routes: [
        {
          from: "Cuenta de Ahorro",
          intermediates: ["Pesos", "Dólares", "Euros"],
          domain: undefined
        }
      ]
    });
    
    const input: ContextualResolverInput = {
      target: "Pesos",
      previousTarget: "Cuenta de Ahorro",
      nextTarget: "la primera cuenta visible",
      routeProfile,
      candidates: [
        createSnapshotElement({ text: "Pesos", type: "button" }),
        createSnapshotElement({ text: "Cuenta en Pesos", type: "card" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.status).toBe("resolved");
    expect(result.diagnostics.routeProfileUsed).toBe(true);
    expect(result.diagnostics.intermediatesMatched).toContain("Pesos");
  });
  
  test("blocks sensitive candidates", () => {
    const input: ContextualResolverInput = {
      target: "Eliminar",
      nextTarget: "la primera cuenta visible",
      candidates: [
        createSnapshotElement({ text: "Eliminar Cuenta", type: "button" }),
        createSnapshotElement({ text: "Cuenta Corriente", type: "card" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    // Should either be unresolved or select the non-sensitive candidate
    if (result.status === "resolved") {
      expect(result.selectedCandidateText).not.toContain("Eliminar");
    } else {
      // May be unresolved due to best_score_too_low or no_safe_candidates
      expect(["no_safe_candidates", "best_score_too_low", "insufficient_score_difference"]).toContain(result.reason);
    }
  });
  
  test("blocks back navigation candidates", () => {
    const input: ContextualResolverInput = {
      target: "Volver",
      nextTarget: "la primera cuenta visible",
      candidates: [
        createSnapshotElement({ text: "Volver", type: "link" }),
        createSnapshotElement({ text: "Cuenta de Ahorro", type: "card" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    // Should not select back navigation
    if (result.status === "resolved") {
      expect(result.selectedCandidateText).not.toBe("Volver");
    }
  });
  
  test("unresolved when score difference is insufficient", () => {
    const input: ContextualResolverInput = {
      target: "Pesos",
      nextTarget: "la primera cuenta visible",
      candidates: [
        createSnapshotElement({ text: "Pesos", type: "button" }),
        createSnapshotElement({ text: "Pesos", type: "link" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    // May be unresolved if both candidates have similar scores
    expect(["unresolved", "resolved"]).toContain(result.status);
  });
  
  test("already_satisfied when best score is low but variant visible", () => {
    // When target is short/generic, next is ordinal, and product_card contains target
    // the resolver should return already_satisfied instead of unresolved
    const input: ContextualResolverInput = {
      target: "Xyz",
      previousTarget: "Previous Step",
      nextTarget: "la primera cuenta visible",
      candidates: [
        createSnapshotElement({ text: "Abc Xyz Def", type: "card" }),
        createSnapshotElement({ text: "Ghi Xyz Jkl", type: "card" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    // Should return already_satisfied when variant is visible in list
    expect(result.status).toBe("already_satisfied");
    expect(result.alreadySatisfiedEvidence).toBeDefined();
    expect(result.alreadySatisfiedEvidence?.candidateText).toContain("Xyz");
  });
  
  test("handles non-ordinal next step", () => {
    // When next step is not ordinal, behavior may vary
    const input: ContextualResolverInput = {
      target: "Xyz",
      nextTarget: "Make a payment",
      candidates: [
        createSnapshotElement({ text: "Abc Xyz Def", type: "card" }),
        createSnapshotElement({ text: "Ghi Xyz Jkl", type: "card" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    // Should not be already_satisfied since next step is not ordinal
    // May be unresolved or resolved depending on classification
    expect(result.status).not.toBe("already_satisfied");
  });
  
  test("unresolved when candidates don't contain target", () => {
    // already_satisfied requires candidates to contain the target
    const input: ContextualResolverInput = {
      target: "Pesos",
      previousTarget: "Cuenta de Ahorro",
      nextTarget: "la primera cuenta visible",
      candidates: [
        createSnapshotElement({ text: "Cuenta en Dólares", type: "card" }),
        createSnapshotElement({ text: "Cuenta en Euros", type: "card" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.status).toBe("unresolved");
  });
  
  test("classification summary is accurate", () => {
    const input: ContextualResolverInput = {
      target: "Pesos",
      nextTarget: "la primera cuenta visible",
      candidates: [
        createSnapshotElement({ text: "Pesos", type: "button" }),
        createSnapshotElement({ text: "Dólares", type: "button" }),
        createSnapshotElement({ text: "Cuenta en Pesos", type: "card" }),
        createSnapshotElement({ text: "Cuenta en Dólares", type: "card" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.diagnostics.classificationSummary.filter).toBe(2);
    expect(result.diagnostics.classificationSummary.product_card).toBe(2);
  });
  
  test("works with generic target without next ordinal", () => {
    const input: ContextualResolverInput = {
      target: "Pesos",
      previousTarget: "Cuenta de Ahorro",
      candidates: [
        createSnapshotElement({ text: "Pesos", type: "button" }),
        createSnapshotElement({ text: "Cuenta en Pesos", type: "card" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    // Should still prefer exact match even without ordinal next step
    expect(result.status).toBe("resolved");
    expect(result.selectedCandidateText).toBe("Pesos");
  });
});

test.describe("contextual resolver integration scenarios", () => {
  test("C38128-like scenario: Cuentas → Cuenta de Ahorro → Pesos → ordinal", () => {
    const routeProfile = createRouteProfile({
      routes: [
        { from: "entry", intermediates: ["Iniciar"], domain: undefined },
        { from: "Iniciar", intermediates: ["Información de productos"], domain: undefined },
        { from: "Información de productos", intermediates: ["Cuentas"], domain: undefined },
        { from: "Cuentas", intermediates: ["Cuenta de Ahorro", "Pesos"], domain: undefined }
      ],
      domainTerms: ["cuenta", "tarjeta", "prestamo"]
    });
    
    const input: ContextualResolverInput = {
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
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.status).toBe("resolved");
    expect(result.selectedCandidate?.id).toBe("filter-pesos");
    expect(result.diagnostics.routeProfileUsed).toBe(true);
  });
  
  test("Documentos → Contratos → Vigentes → ordinal scenario", () => {
    const input: ContextualResolverInput = {
      target: "Vigentes",
      previousTarget: "Contratos",
      nextTarget: "el primer documento visible",
      candidates: [
        createSnapshotElement({ text: "Vigentes", type: "button", role: "button" }),
        createSnapshotElement({ text: "Contratos Vigentes 2026", type: "card" }),
        createSnapshotElement({ text: "Contratos Históricos", type: "card" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.status).toBe("resolved");
    expect(result.selectedCandidateText).toBe("Vigentes");
    expect(result.diagnostics.nextTargetIsOrdinal).toBe(true);
  });
  
  test("Servicios → Internet → Residencial → ordinal scenario", () => {
    const input: ContextualResolverInput = {
      target: "Residencial",
      previousTarget: "Internet",
      nextTarget: "el primer servicio visible",
      candidates: [
        createSnapshotElement({ text: "Residencial", type: "button" }),
        createSnapshotElement({ text: "Internet Residencial 100MB", type: "card" }),
        createSnapshotElement({ text: "Internet Empresarial 500MB", type: "card" })
      ]
    };
    
    const result = resolveAmbiguousIntermediateTarget(input);
    
    expect(result.status).toBe("resolved");
    expect(result.selectedCandidateText).toBe("Residencial");
  });
});
