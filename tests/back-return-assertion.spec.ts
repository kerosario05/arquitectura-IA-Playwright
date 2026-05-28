/**
 * Back/Return Assertion Matching Tests
 * 
 * Tests for semantic matching of back/return assertions.
 * Verifies that "Volver al menú principal" can match "Volver al menú" or "Volver".
 */

import { test, expect } from "@playwright/test";
import { resolveAssertionTargets, type AssertionTargetInput } from "../src/discovery/assertion-resolver";
import type { PageSnapshot, SnapshotElement } from "../src/types/page-snapshot.types";

function createSnapshotWithButtons(buttonTexts: string[]): PageSnapshot {
  const elements: SnapshotElement[] = buttonTexts.map((text, index) => ({
    id: `button-${index}`,
    type: "button" as const,
    tagName: "button",
    role: "button",
    text,
    visible: true,
    candidateLocators: [{ strategy: "role", role: "button", name: text, confidence: 0.9 }],
    dataHints: []
  }));
  
  return {
    version: "1.0",
    url: "http://example.com/test",
    title: "Test Page",
    capturedAt: new Date().toISOString(),
    elements,
    summary: {
      totalElements: elements.length,
      inputs: 0,
      buttons: buttonTexts.length,
      links: 0,
      selects: 0,
      tables: 0,
      dialogs: 0,
      headings: 0
    }
  };
}

test.describe("Back/Return Assertion Matching", () => {
  test("Volver al menú principal matches Volver al menú", () => {
    const snapshot = createSnapshotWithButtons(["Volver al menú", "Inicio", "Solicitar"]);
    
    const assertionTargets: AssertionTargetInput[] = [
      {
        index: 0,
        action: "Validar que se muestre 'Volver al menú principal'",
        target: "Volver al menú principal",
        source: "action"
      }
    ];
    
    const results = resolveAssertionTargets(snapshot, assertionTargets);
    
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(results[0].matchedText).toBe("Volver al menú");
    expect(results[0].confidence).toBeGreaterThanOrEqual(0.8);
    expect(results[0].matchReason).toContain("alias");
    expect(results[0].originalTarget).toBe("Volver al menú principal");
    expect(results[0].matchedTarget).toBe("Volver al menú");
  });

  test("Volver al menú principal matches Volver", () => {
    const snapshot = createSnapshotWithButtons(["Volver", "Inicio", "Solicitar"]);
    
    const assertionTargets: AssertionTargetInput[] = [
      {
        index: 0,
        action: "Validar que se muestre 'Volver al menú principal'",
        target: "Volver al menú principal",
        source: "action"
      }
    ];
    
    const results = resolveAssertionTargets(snapshot, assertionTargets);
    
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(results[0].matchedText).toBe("Volver");
    expect(results[0].confidence).toBeGreaterThanOrEqual(0.7);
    expect(results[0].matchReason).toContain("alias");
  });

  test("Volver al listado de productos matches Volver", () => {
    const snapshot = createSnapshotWithButtons(["Volver", "Productos", "Detalle"]);
    
    const assertionTargets: AssertionTargetInput[] = [
      {
        index: 0,
        action: "Validar que se muestre 'Volver al listado de productos'",
        target: "Volver al listado de productos",
        source: "action"
      }
    ];
    
    const results = resolveAssertionTargets(snapshot, assertionTargets);
    
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(results[0].matchedText).toBe("Volver");
    expect(results[0].confidence).toBeGreaterThanOrEqual(0.7);
  });

  test("Regresar al inicio matches Regresar", () => {
    const snapshot = createSnapshotWithButtons(["Regresar", "Inicio", "Continuar"]);
    
    const assertionTargets: AssertionTargetInput[] = [
      {
        index: 0,
        action: "Validar que se muestre 'Regresar al inicio'",
        target: "Regresar al inicio",
        source: "action"
      }
    ];
    
    const results = resolveAssertionTargets(snapshot, assertionTargets);
    
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(results[0].matchedText).toBe("Regresar");
    expect(results[0].confidence).toBeGreaterThanOrEqual(0.7);
  });

  test("Non-back assertions do not use alias matching", () => {
    const snapshot = createSnapshotWithButtons(["Tarjetas", "Préstamos", "Depósitos"]);
    
    const assertionTargets: AssertionTargetInput[] = [
      {
        index: 0,
        action: "Validar que se muestre 'Tarjetas de Crédito'",
        target: "Tarjetas de Crédito",
        source: "action"
      }
    ];
    
    const results = resolveAssertionTargets(snapshot, assertionTargets);
    
    expect(results).toHaveLength(1);
    // "Tarjetas" matches via contains_match (not alias)
    expect(results[0].status).toBe("passed");
    expect(results[0].matchedText).toBe("Tarjetas");
    expect(results[0].matchReason).toBe("contains_match");
    // Should NOT have back/return diagnostics
    expect(results[0].originalTarget).toBeUndefined();
    expect(results[0].matchedTarget).toBeUndefined();
  });

  test("Exact match still works for back assertions", () => {
    const snapshot = createSnapshotWithButtons(["Volver al menú principal", "Inicio"]);
    
    const assertionTargets: AssertionTargetInput[] = [
      {
        index: 0,
        action: "Validar que se muestre 'Volver al menú principal'",
        target: "Volver al menú principal",
        source: "action"
      }
    ];
    
    const results = resolveAssertionTargets(snapshot, assertionTargets);
    
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(results[0].matchedText).toBe("Volver al menú principal");
    expect(results[0].confidence).toBe(1.0);
    expect(results[0].matchReason).toBe("exact_match");
  });

  test("Back assertion fails when no matching button exists", () => {
    const snapshot = createSnapshotWithButtons(["Solicitar", "Cancelar", "Cerrar"]);
    
    const assertionTargets: AssertionTargetInput[] = [
      {
        index: 0,
        action: "Validar que se muestre 'Volver al menú principal'",
        target: "Volver al menú principal",
        source: "action"
      }
    ];
    
    const results = resolveAssertionTargets(snapshot, assertionTargets);
    
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].confidence).toBeLessThan(0.6);
    // Should still include diagnostics about attempted aliases
    expect(results[0].assertionDiagnostics).toBeDefined();
  });

  test("Atrás matches back assertion", () => {
    const snapshot = createSnapshotWithButtons(["Atrás", "Siguiente"]);
    
    const assertionTargets: AssertionTargetInput[] = [
      {
        index: 0,
        action: "Validar que se muestre 'Volver'",
        target: "Volver",
        source: "action"
      }
    ];
    
    const results = resolveAssertionTargets(snapshot, assertionTargets);
    
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(results[0].matchedText).toBe("Atrás");
    expect(results[0].confidence).toBeGreaterThanOrEqual(0.7);
    expect(results[0].matchReason).toContain("alias");
  });
});
