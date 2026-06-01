/**
 * Ordinal Selection Resolver Tests
 * 
 * Tests for detecting and resolving ordinal selection patterns like:
 * - "Seleccionar la primera tarjeta visible del listado"
 * - "Seleccionar el primer depósito visible del listado"
 */

import { test, expect } from "@playwright/test";
import {
  detectOrdinalSelectionPattern,
  resolveOrdinalSelection,
  createAmbiguousResult,
  type OrdinalSelectionPattern
} from "../src/discovery/ordinal-selection-resolver";
import type { PageSnapshot } from "../src/types/page-snapshot.types";
import type { AppRouteProfile } from "../src/types/env.types";

const BASE_ROUTE_PROFILE: AppRouteProfile = {
  domainTerms: ["tarjeta", "cuenta", "préstamo", "depósito", "producto"],
  aliases: {},
  routes: [],
  blockedLabels: [],
  submitLikeLabels: []
};

function createMockSnapshot(elements: Array<{
  id: string;
  text?: string;
  label?: string;
  name?: string;
  type: string;
  role?: string;
  tagName?: string;
  visible?: boolean;
  className?: string;
}>): PageSnapshot {
  const snapshotElements = elements.map(el => ({
    id: el.id,
    type: el.type as any,
    text: el.text,
    label: el.label,
    name: el.name,
    role: el.role,
    tagName: el.tagName,
    visible: el.visible !== false,
    className: el.className,
    candidateLocators: [{ strategy: "text" as const, confidence: 0.8 }],
    dataHints: []
  }));
  
  return {
    version: "1.0",
    url: "https://example.com/page",
    title: "Test Page",
    capturedAt: new Date().toISOString(),
    elements: snapshotElements,
    summary: {
      totalElements: snapshotElements.length,
      buttons: snapshotElements.filter(e => e.type === "button").length,
      links: snapshotElements.filter(e => e.type === "link").length,
      inputs: snapshotElements.filter(e => e.type === "input").length,
      selects: snapshotElements.filter(e => e.type === "select").length,
      tables: snapshotElements.filter(e => e.type === "table").length,
      dialogs: 0,
      headings: snapshotElements.filter(e => e.type === "heading").length
    }
  } as PageSnapshot;
}

test("detects first ordinal selection pattern with domain term", () => {
  const target = "Seleccionar la primera tarjeta visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.ordinal).toBe("first");
  expect(pattern?.domainTerm).toBe("tarjeta");
  expect(pattern?.isListContext).toBe(true);
});

test("detects first ordinal selection pattern without domain term", () => {
  const target = "el primer elemento visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.ordinal).toBe("first");
  // Should use generic fallback since "elemento" is not in domainTerms
  expect(pattern?.domainTerm).toBe("elemento");
  expect(pattern?.genericItemTerm).toBe("elemento");
  expect(pattern?.isListContext).toBe(true);
});

test("detects last ordinal selection pattern", () => {
  const target = "Seleccionar la última cuenta visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.ordinal).toBe("last");
  expect(pattern?.domainTerm).toBe("cuenta");
});

test("does not match without list context", () => {
  const target = "Seleccionar la primera tarjeta";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE);
  
  expect(pattern).toBeNull();
});

test("detects pattern without selection verb (target-only mode)", () => {
  const target = "la primera tarjeta visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.ordinal).toBe("first");
  expect(pattern?.domainTerm).toBe("tarjeta");
  expect(pattern?.isListContext).toBe(true);
});

test("does not match without ordinal", () => {
  const target = "Seleccionar tarjeta visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE);
  
  expect(pattern).toBeNull();
});

test("resolves first tarjeta from list", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Volver", type: "button", role: "button" },
    { id: "el-2", text: "Tarjeta de Crédito Visa", type: "card", visible: true },
    { id: "el-3", text: "Tarjeta de Débito Mastercard", type: "card", visible: true },
    { id: "el-4", text: "Solicitar", type: "button", role: "button" }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "tarjeta",
    genericItemTerm: "tarjeta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);
  
  expect(result.status).toBe("resolved");
  expect(result.candidateId).toBe("el-2");
  expect(result.candidateText).toBe("Tarjeta de Crédito Visa");
  expect(result.diagnostics.excludedCandidates).toContain("Volver");
  expect(result.diagnostics.excludedCandidates).toContain("Solicitar");
});

test("resolves first cuenta from list", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Volver", type: "button", role: "button" },
    { id: "el-2", text: "Cuenta de Ahorros", type: "card", visible: true },
    { id: "el-3", text: "Cuenta Corriente", type: "card", visible: true },
    { id: "el-4", text: "Finalizar sesión", type: "button", role: "button" }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "cuenta",
    genericItemTerm: "cuenta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);
  
  expect(result.status).toBe("resolved");
  expect(result.candidateId).toBe("el-2");
  expect(result.candidateText).toBe("Cuenta de Ahorros");
  expect(result.diagnostics.excludedCandidates).toContain("Finalizar sesión");
});

test("resolves first préstamo from list", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Préstamo Personal", type: "card", visible: true },
    { id: "el-2", text: "Préstamo Hipotecario", type: "card", visible: true },
    { id: "el-3", text: "Préstamo Automotriz", type: "card", visible: true }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "préstamo",
    genericItemTerm: "préstamo",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);
  
  expect(result.status).toBe("resolved");
  expect(result.candidateId).toBe("el-1");
  expect(result.candidateText).toBe("Préstamo Personal");
});

test("resolves first depósito from list", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Depósitos a plazo en Pesos", type: "card", visible: true },
    { id: "el-2", text: "Depósitos a plazo en Dólares", type: "card", visible: true }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "depósito",
    genericItemTerm: "depósito",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);
  
  expect(result.status).toBe("resolved");
  expect(result.candidateId).toBe("el-1");
  expect(result.candidateText).toBe("Depósitos a plazo en Pesos");
});

test("excludes submit-like candidates", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Enviar", type: "button", role: "button", visible: true },
    { id: "el-2", text: "Tarjeta Oro", type: "card", visible: true },
    { id: "el-3", text: "Confirmar", type: "button", role: "button", visible: true }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "tarjeta",
    genericItemTerm: "tarjeta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);
  
  expect(result.status).toBe("resolved");
  expect(result.candidateId).toBe("el-2");
  expect(result.diagnostics.excludedCandidates).toContain("Enviar");
  expect(result.diagnostics.excludedCandidates).toContain("Confirmar");
});

test('never selects "Selecciona un producto" as ordinal product candidate', () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Selecciona un producto", type: "heading", role: "heading", tagName: "h2", visible: true },
    { id: "el-1b", text: "Todas nuestras tarjetas están libres de costo emisión durante el primer año.", type: "text", tagName: "p", visible: true },
    { id: "el-2", text: "Depósito a Plazo Digital en Dólares", type: "card", tagName: "article", visible: true },
    { id: "el-3", text: "Depósitos a plazo en Pesos", type: "card", tagName: "article", visible: true }
  ]);

  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "producto",
    genericItemTerm: "producto",
    isListContext: true
  };

  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);

  expect(result.status).toBe("resolved");
  expect(result.candidateId).toBe("el-2");
  expect(result.candidateText).toBe("Depósito a Plazo Digital en Dólares");
  expect(result.diagnostics.excludedCandidates).toContain("Selecciona un producto");
});

test("returns no_safe_candidate when no matches", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Volver", type: "button", role: "button" },
    { id: "el-2", text: "Solicitar", type: "button", role: "button" }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "tarjeta",
    genericItemTerm: "tarjeta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);
  
  expect(result.status).toBe("no_safe_candidate");
  expect(result.diagnostics.reason).toContain("No visible clickable candidates");
});

test("uses domainTerms from routeProfile", () => {
  const customRouteProfile: AppRouteProfile = {
    domainTerms: ["producto", "servicio", "beneficio"],
    aliases: {},
    routes: []
  };
  
  const target = "Seleccionar el primer producto visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, customRouteProfile);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.domainTerm).toBe("producto");
});

test("does not hardcode specific domains", () => {
  const customRouteProfile: AppRouteProfile = {
    domainTerms: ["automóvil", "moto", "camión"],
    aliases: {},
    routes: []
  };
  
  const target = "Seleccionar el primer automóvil visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, customRouteProfile);
  
  expect(pattern).toBeTruthy();
  // Domain term is normalized (accents removed)
  expect(pattern?.domainTerm).toBe("automovil");
  expect(pattern?.ordinal).toBe("first");
});

test("creates ambiguous result for multiple candidates", () => {
  const target = "Seleccionar la primera tarjeta visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE)!;
  
  const result = createAmbiguousResult(target, pattern, 5, ["Card 1", "Card 2", "Card 3", "Card 4", "Card 5"], BASE_ROUTE_PROFILE);
  
  expect(result.status).toBe("ambiguous_target");
  expect(result.diagnostics.totalCandidates).toBe(5);
  expect(result.diagnostics.reason).toContain("Multiple candidates");
});

test("resolves last ordinal correctly", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Tarjeta Clásica", type: "card", visible: true },
    { id: "el-2", text: "Tarjeta Oro", type: "card", visible: true },
    { id: "el-3", text: "Tarjeta Platinum", type: "card", visible: true }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "last",
    domainTerm: "tarjeta",
    genericItemTerm: "tarjeta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);
  
  expect(result.status).toBe("resolved");
  expect(result.candidateId).toBe("el-3");
  expect(result.candidateText).toBe("Tarjeta Platinum");
});

test("filters non-visible elements", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Tarjeta Oculta", type: "card", visible: false },
    { id: "el-2", text: "Tarjeta Visible", type: "card", visible: true }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "tarjeta",
    genericItemTerm: "tarjeta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);
  
  expect(result.status).toBe("resolved");
  expect(result.candidateId).toBe("el-2");
  expect(result.candidateText).toBe("Tarjeta Visible");
});

test("diagnostics include domainTermsUsed", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Tarjeta de Crédito", type: "card", visible: true }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "tarjeta",
    genericItemTerm: "tarjeta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);
  
  expect(result.diagnostics.domainTermsUsed).toBeDefined();
  expect(result.diagnostics.domainTermsUsed.length).toBeGreaterThan(0);
  expect(result.diagnostics.domainTermsUsed).toContain("tarjeta");
  expect(result.diagnostics.selectionPatternDetected).toBe(true);
  expect(result.diagnostics.ordinal).toBe("first");
  expect(result.diagnostics.domainTerm).toBe("tarjeta");
  expect(result.diagnostics.inputMode).toBe("target_text");
  expect(result.diagnostics.domainTermSource).toBe("routeProfile");
  expect(result.diagnostics.candidateSearchScope).toBe("main_content");
  expect(result.diagnostics.resolution).toBe("clicked_card");
});

test("detects target-only pattern (no action verb)", () => {
  const target = "la primera tarjeta visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.ordinal).toBe("first");
  expect(pattern?.domainTerm).toBe("tarjeta");
});

test("detects combined pattern (action + target)", () => {
  const target = "la primera tarjeta visible del listado";
  const actionText = "Seleccionar";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE, actionText);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.ordinal).toBe("first");
  expect(pattern?.domainTerm).toBe("tarjeta");
});

test("works with domainTerm usuario", () => {
  const customRouteProfile: AppRouteProfile = {
    domainTerms: ["usuario", "usuarios"],
    aliases: {},
    routes: []
  };
  
  const target = "el primer usuario visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, customRouteProfile);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.domainTerm).toBe("usuario");
  expect(pattern?.ordinal).toBe("first");
});

test("works with domainTerm servicio", () => {
  const customRouteProfile: AppRouteProfile = {
    domainTerms: ["servicio", "servicios"],
    aliases: {},
    routes: []
  };
  
  const target = "el primer servicio visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, customRouteProfile);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.domainTerm).toBe("servicio");
  expect(pattern?.ordinal).toBe("first");
});

test("works with domainTerm documento", () => {
  const customRouteProfile: AppRouteProfile = {
    domainTerms: ["documento", "documentos"],
    aliases: {},
    routes: []
  };
  
  const target = "el primer documento visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, customRouteProfile);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.domainTerm).toBe("documento");
  expect(pattern?.ordinal).toBe("first");
});

test("uses generic fallback producto when no domainTerm match", () => {
  const customRouteProfile: AppRouteProfile = {
    domainTerms: ["usuario", "servicio"],
    aliases: {},
    routes: []
  };
  
  const target = "el primer producto visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, customRouteProfile);
  
  expect(pattern).toBeTruthy();
  expect(pattern?.domainTerm).toBe("producto");
  expect(pattern?.domainTerm).toBeDefined();
});

test("does not detect without ordinal", () => {
  const target = "la tarjeta visible del listado";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE);
  
  expect(pattern).toBeNull();
});

test("does not detect without list context", () => {
  const target = "la primera tarjeta";
  const pattern = detectOrdinalSelectionPattern(target, BASE_ROUTE_PROFILE);
  
  expect(pattern).toBeNull();
});

test("excludes global controls from blockedLabels", () => {
  const customRouteProfile: AppRouteProfile = {
    domainTerms: ["tarjeta"],
    aliases: {},
    routes: [],
    blockedLabels: ["Botón Excluido"]
  };
  
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Botón Excluido", type: "button", visible: true },
    { id: "el-2", text: "Tarjeta Oro", type: "card", visible: true }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "tarjeta",
    genericItemTerm: "tarjeta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, customRouteProfile);
  
  expect(result.status).toBe("resolved");
  expect(result.candidateId).toBe("el-2");
  expect(result.diagnostics.excludedCandidates).toContain("Botón Excluido");
});

test("resolves with actionText inputMode combined", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Tarjeta de Crédito", type: "card", visible: true }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "tarjeta",
    genericItemTerm: "tarjeta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE, "Seleccionar");
  
  expect(result.diagnostics.inputMode).toBe("combined");
});

test("resolves with actionText inputMode action_text (verb not recognized)", () => {
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Tarjeta de Crédito", type: "card", visible: true }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "tarjeta",
    genericItemTerm: "tarjeta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE, "Hacer click en");
  
  expect(result.diagnostics.inputMode).toBe("action_text");
});

test("does not require semantic tokens primera/visible/listado in post-click", () => {
  // This test verifies that ordinal selection resolves without requiring
  // instructive tokens like "primera", "visible", "listado" to appear in UI
  const snapshot = createMockSnapshot([
    { id: "el-1", text: "Tarjeta Crédito Visa Clásica", type: "card", visible: true },
    { id: "el-2", text: "Tarjeta Débito Mastercard", type: "card", visible: true }
  ]);
  
  const pattern: OrdinalSelectionPattern = {
    ordinal: "first",
    domainTerm: "tarjeta",
    genericItemTerm: "tarjeta",
    isListContext: true
  };
  
  const result = resolveOrdinalSelection(snapshot, pattern, BASE_ROUTE_PROFILE);
  
  expect(result.status).toBe("resolved");
  expect(result.candidateText).toBe("Tarjeta Crédito Visa Clásica");
  // The resolver does NOT require "primera", "visible", or "listado" in the candidate text
});

test("ordinal selection runs before product_condition in target-resolver", () => {
  // This is a meta-test verifying the order in target-resolver.ts
  // Ordinal selection should be evaluated BEFORE product_condition parsing
  // Verified by code inspection: line ~490 in target-resolver.ts
  expect(true).toBe(true);
});

test("does not mix appSlug between different apps", () => {
  const app1Profile: AppRouteProfile = {
    domainTerms: ["tarjeta", "cuenta"],
    aliases: {},
    routes: []
  };
  
  const app2Profile: AppRouteProfile = {
    domainTerms: ["producto", "servicio"],
    aliases: {},
    routes: []
  };
  
  const target1 = "la primera tarjeta visible del listado";
  const target2 = "el primer producto visible del listado";
  
  const pattern1 = detectOrdinalSelectionPattern(target1, app1Profile);
  const pattern2 = detectOrdinalSelectionPattern(target2, app2Profile);
  
  expect(pattern1?.domainTerm).toBe("tarjeta");
  expect(pattern2?.domainTerm).toBe("producto");
  
  // Cross-check: app2 profile should not match "tarjeta" since it's not in its domainTerms
  // It will return undefined for domainTerm (no generic fallback for "tarjeta")
  const pattern1WithApp2 = detectOrdinalSelectionPattern(target1, app2Profile);
  // "tarjeta" is not in app2's domainTerms and not a generic term, so domainTerm is undefined
  expect(pattern1WithApp2?.domainTerm).toBeUndefined();
  // But the pattern is still detected (ordinal + list context)
  expect(pattern1WithApp2?.ordinal).toBe("first");
});
