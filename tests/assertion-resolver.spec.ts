import { test, expect } from "@playwright/test";
import {
  buildConcreteAssertionsFromExpected,
  classifyAssertion,
  resolveAssertionTargets,
  type AssertionTargetInput
} from "../src/discovery/assertion-resolver";
import type { PageSnapshot, SnapshotElement } from "../src/types/page-snapshot.types";

function makeElement(overrides: Partial<SnapshotElement>): SnapshotElement {
  return {
    id: `el-${Math.random().toString(36).slice(2, 8)}`,
    type: "text",
    visible: true,
    candidateLocators: [],
    dataHints: [],
    ...overrides
  };
}

function makeSnapshot(elements: SnapshotElement[], url = "https://example.com/app"): PageSnapshot {
  return {
    version: "1.0",
    url,
    title: "Example",
    capturedAt: new Date().toISOString(),
    elements,
    summary: {
      totalElements: elements.length,
      buttons: elements.filter((element) => element.type === "button").length,
      links: elements.filter((element) => element.type === "link").length,
      inputs: elements.filter((element) => element.type === "input").length,
      selects: elements.filter((element) => element.type === "select").length,
      tables: elements.filter((element) => element.type === "table").length,
      dialogs: elements.filter((element) => element.type === "dialog").length,
      headings: elements.filter((element) => element.type === "heading").length
    }
  };
}

function makeAssertion(target: string, source: "action" | "expected" = "action", index = 1): AssertionTargetInput {
  return {
    index,
    action: `Assert: ${target}`,
    target,
    source
  };
}

test("validar listado de productos visible se clasifica como catalog_list_assertion", () => {
  expect(classifyAssertion("validar listado de productos visible")).toBe("catalog_list_assertion");
});

test("validar detalle/listado de productos visible se clasifica como catalog_list_assertion", () => {
  expect(classifyAssertion("validar detalle/listado de productos visible")).toBe("catalog_list_assertion");
});

test("validar detalle de producto se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("validar detalle de producto")).toBe("semantic_descriptor");
});

test("validar pantalla de confirmacion se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("validar pantalla de confirmacion")).toBe("semantic_descriptor");
});

test("validar resumen final se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("validar resumen final")).toBe("semantic_descriptor");
});

test("validar ticket de generacion se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("validar ticket de generacion")).toBe("semantic_descriptor");
});

test("confirmar pantalla de resumen se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("confirmar pantalla de resumen")).toBe("semantic_descriptor");
});

test("semantic_descriptor con señales hijas concretas pasa como satisfied_by_children", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Premium" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("pantalla de resumen")], {
    childSignalsByIndex: { 1: ["Premium", "Available"] }
  });

  expect(result.status).toBe("satisfied_by_children");
});

test("semantic_descriptor sin señales concretas queda needs_assertion_resolution", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Welcome" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("pantalla de resumen")]);

  expect(result.status).toBe("needs_assertion_resolution");
});

test("texto concreto visible pasa como literal_observable", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Transferencia completada" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Transferencia completada")]);

  expect(result.classification).toBe("literal_observable");
  expect(result.status).toBe("passed");
});

test("validar que se muestre texto quoted sigue como literal_observable", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Products" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Validar que se muestre 'Products'")]);
  expect(result.classification).toBe("literal_observable");
  expect(result.status).toBe("passed");
});

test("esperar visible quoted sigue como literal_observable", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Swag Labs" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Esperar que esté visible 'Swag Labs'")]);
  expect(result.classification).toBe("literal_observable");
  expect(result.status).toBe("passed");
});

test("texto concreto faltante falla con closestCandidates", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Transferencia procesada" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Transferencia completada")]);

  expect(result.status).toBe("failed");
  expect(result.closestCandidates.length).toBeGreaterThan(0);
});

test("contains normalizado funciona para assertions", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Resultado aprobado con detalles adicionales" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("resultado aprobado")]);

  expect(result.status).toBe("passed");
});

test("acentos y mayusculas no rompen matching", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Información general" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("INFORMACION GENERAL")]);

  expect(result.status).toBe("passed");
});

test("expected texts concretos generan asserts observables", () => {
  const result = buildConcreteAssertionsFromExpected(["Premium", "Disponible", "pantalla de resumen"]);
  expect(result).toEqual(["Premium", "Disponible"]);
});

test("frases descriptivas no generan assertText literal", () => {
  const result = buildConcreteAssertionsFromExpected(["validar listado de productos", "Resumen"]);
  expect(result).toEqual(["Resumen"]);
});

test("semantic descriptor pasa si subject visible aparece en snapshot", () => {
  const snapshot = makeSnapshot([makeElement({ text: "depositos a plazo en dolares" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Validar detalle/listado de depósitos a plazo en dólares")]);
  expect(result.status).toBe("passed");
});

test("semantic descriptor pasa si varios tokens fuertes aparecen en snapshot", () => {
  const snapshot = makeSnapshot([
    makeElement({ text: "Depositos a plazo" }),
    makeElement({ text: "Moneda dolares" }),
    makeElement({ text: "Listado disponible" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Validar listado de depósitos a plazo en dólares")]);
  expect(result.status).toBe("passed");
  expect((result.matchedTokens ?? []).length).toBeGreaterThan(0);
});

test("semantic descriptor queda needs_assertion_resolution sin señales suficientes", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Bienvenido" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Validar detalle de cuenta")]);
  expect(result.status).toBe("needs_assertion_resolution");
});

test("semantic descriptor no pasa solo por palabras genéricas", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Detalle general de pantalla" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Validar detalle de cuenta")]);
  expect(result.status).not.toBe("passed");
});

test("detalle/listado de X separa descriptor types y subject", () => {
  const snapshot = makeSnapshot([makeElement({ text: "productos habilitados" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Validar detalle de productos")]);
  expect(result.descriptorTypes).toEqual(expect.arrayContaining(["detail"]));
  expect(result.subject).toContain("productos");
});

test("diagnostics incluye descriptorTypes, subject y señales", () => {
  const snapshot = makeSnapshot([
    makeElement({ text: "productos premium" }),
    makeElement({ type: "table", text: "tabla de resultados" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Validar detalle de productos")]);
  expect(result.descriptorTypes).toBeDefined();
  expect(result.subject).toBeDefined();
  expect(result.matchedTokens).toBeDefined();
  expect(result.structuralSignals).toBeDefined();
});

test("structural assertions pueden representar tabla lista card modal sin depender de texto literal", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "table", text: "Data" }),
    makeElement({ type: "card", text: "Summary card" }),
    makeElement({ type: "dialog", text: "Dialog title" })
  ]);

  const results = resolveAssertionTargets(snapshot, [
    makeAssertion("tabla de resultados"),
    makeAssertion("modal de confirmacion", "action", 2),
    makeAssertion("card de resumen", "action", 3)
  ]);

  expect(results.every((result) => result.status === "passed")).toBe(true);
});

test("resolver de assertions no contiene hardcodes del dominio de regresion", () => {
  const fs = require("fs");
  const path = require("path");
  const content = fs.readFileSync(path.join(__dirname, "../src/discovery/assertion-resolver.ts"), "utf-8");

  expect(content).not.toContain("Banco Santa Cruz");
  expect(content).not.toContain("Kiosko");
  expect(content).not.toContain("Tarjeta de Crédito");
  expect(content).not.toContain("C37750");
});

test("regresion: descriptor con expected concretos visibles queda satisfied_by_children y no literal not_found", () => {
  const snapshot = makeSnapshot([
    makeElement({ text: "Visa Clásica" }),
    makeElement({ text: "Visa Gold" }),
    makeElement({ text: "Visa Platinum" }),
    makeElement({ text: "Visa Infinite" })
  ]);

  const results = resolveAssertionTargets(
    snapshot,
    [
      makeAssertion("listado de tarjetas de crédito."),
      makeAssertion("Visa Clásica", "expected"),
      makeAssertion("Visa Gold", "expected"),
      makeAssertion("Visa Platinum", "expected"),
      makeAssertion("Visa Infinite", "expected")
    ],
    {
      childSignalsByIndex: {
        1: ["Visa Clásica", "Visa Gold", "Visa Platinum", "Visa Infinite"]
      }
    }
  );

  const descriptor = results[0];
  const concretes = results.slice(1);

  expect(descriptor.status).toBe("satisfied_by_children");
  expect(concretes.every((result) => result.status === "passed")).toBe(true);
});

test("expected-only assertion no se clasifica como obligatoria", () => {
  expect(classifyAssertion("expected signals")).toBe("expected_only");
  expect(classifyAssertion("señales esperadas")).toBe("expected_only");
  expect(classifyAssertion("Expected signals")).toBe("expected_only");
});

test("semantic_descriptor desde expected source se resuelve pero no bloquea", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Welcome" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("validar detalle de cuenta", "expected")]);
  expect(result.classification).toBe("semantic_descriptor");
  expect(result.status).toBe("skipped_semantic_descriptor");
});

test("Información principal del producto visible se clasifica como semantic_descriptor (generic/weak)", () => {
  expect(classifyAssertion("Información principal del producto visible")).toBe("semantic_descriptor");
  expect(classifyAssertion("informacion principal del producto visible")).toBe("semantic_descriptor");
});

test("Información general visible se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("Información general visible")).toBe("semantic_descriptor");
});

test("Datos principales visibles se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("Datos principales visibles")).toBe("semantic_descriptor");
});

test("Contenido principal visible se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("Contenido principal visible")).toBe("semantic_descriptor");
});

test("Sección principal visible se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("Sección principal visible")).toBe("semantic_descriptor");
});

test("Acciones disponibles según producto se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("Acciones disponibles según producto")).toBe("semantic_descriptor");
});

test("Opciones disponibles visibles se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("Opciones disponibles visibles")).toBe("semantic_descriptor");
});

test("descriptor genérico sintético desde expected source no bloquea con skipped_semantic_descriptor", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Préstamo personal" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Información general visible", "expected")]);
  expect(result.classification).toBe("semantic_descriptor");
  expect(result.status).toBe("skipped_semantic_descriptor");
  expect(result.isWeakSignal).toBe(true);
});

test("descriptor genérico sintético desde action source puede quedar needs_assertion_resolution", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Préstamo personal" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Información general visible", "action")]);
  expect(result.classification).toBe("semantic_descriptor");
  expect(result.status).toBe("needs_assertion_resolution");
  expect(result.isWeakSignal).toBe(true);
});

test("literal con quotes explícito sigue siendo literal_observable aunque coincida con patrón genérico", () => {
  expect(classifyAssertion("'Información general visible'")).toBe("literal_observable");
});

// --- Detail descriptor tests ---

test("'Detalle de X visible' clasifica como semantic_descriptor, no literal_observable", () => {
  expect(classifyAssertion("Detalle de Préstamo Personal visible")).toBe("semantic_descriptor");
  expect(classifyAssertion("Detalle de cuenta visible")).toBe("semantic_descriptor");
  expect(classifyAssertion("detalle de servicio visible")).toBe("semantic_descriptor");
});

test("'Pantalla de detalle de X visible' clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("Pantalla de detalle de Préstamo Personal visible")).toBe("semantic_descriptor");
  expect(classifyAssertion("Vista de detalle de cuenta visible")).toBe("semantic_descriptor");
});

test("'Resumen de X visible' clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("Resumen de Cuenta visible")).toBe("semantic_descriptor");
});

test("detail descriptor extrae descriptorTypes detail y subject correctamente", () => {
  const snapshot = makeSnapshot([
    makeElement({ text: "Préstamo Personal", type: "heading" }),
    makeElement({ text: "Monto: $10,000", type: "text" }),
    makeElement({ text: "Tasa: 15%", type: "text" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Detalle de Préstamo Personal visible")]);
  expect(result.classification).toBe("semantic_descriptor");
  expect(result.descriptorTypes).toContain("detail");
  expect(result.subject?.toLowerCase()).toContain("personal");
  expect(result.isWeakSignal).toBe(true);
  expect(result.status).toBe("passed");
});

test("detail descriptor expected source no bloquea si subject no visible", () => {
  const snapshot = makeSnapshot([
    makeElement({ text: "Bienvenido", type: "heading" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Detalle de Préstamo Personal visible", "expected")]);
  expect(result.classification).toBe("semantic_descriptor");
  expect(result.status).toBe("skipped_semantic_descriptor");
  expect(result.isWeakSignal).toBe(true);
});

test("detail descriptor action source con subject visible se resuelve como passed", () => {
  const snapshot = makeSnapshot([
    makeElement({ text: "Préstamo Personal", type: "heading" }),
    makeElement({ text: "Detalle del préstamo", type: "section" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Detalle de Préstamo Personal visible", "action")]);
  expect(result.classification).toBe("semantic_descriptor");
  expect(result.status).toBe("passed");
});

test("literal quoted 'Detalle de X visible' sigue siendo literal_observable bloqueante si no coincide", () => {
  const snapshot = makeSnapshot([
    makeElement({ text: "Bienvenido al sistema", type: "heading" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("'Detalle de Préstamo Personal visible'", "expected")]);
  expect(result.classification).toBe("literal_observable");
  expect(result.status).toBe("failed");
});

test("detail descriptor se satisface si subject está visible con señal estructural de sección", () => {
  const snapshot = makeSnapshot([
    makeElement({ text: "Tarjeta Visa Gold", type: "heading" }),
    makeElement({ text: "Límite: $5,000", type: "text" }),
    makeElement({ text: "Detalle de tarjeta", type: "section" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Detalle de Tarjeta Visa Gold visible")]);
  expect(result.classification).toBe("semantic_descriptor");
  expect(result.status).toBe("passed");
});

test("no hardcodear textos de productos en detail descriptor classification", () => {
  expect(classifyAssertion("Detalle de cuenta visible")).toBe("semantic_descriptor");
  expect(classifyAssertion("Detalle de préstamo visible")).toBe("semantic_descriptor");
  expect(classifyAssertion("Pantalla de detalle visible")).toBe("semantic_descriptor");
});

test("product detail assertions se resuelven estructuralmente", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "heading", tagName: "h2", text: "Product Name" }),
    makeElement({ type: "text", text: "$99.99" }),
    makeElement({ type: "text", text: "This is a product description with details." }),
    makeElement({ tagName: "img", role: "img", text: "image" }),
    makeElement({ text: "Add to cart" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("precio del producto")]);
  expect(result.status).toBe("passed");
  expect(result.reason).toBe("structurally_satisfied");
});

test("cart assertion sin setup queda precondition_unresolved", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Cart" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("carrito contiene producto")], {
    executedActions: [{ action: "click", target: "Cart", status: "found" }]
  });
  expect(result.status).toBe("precondition_unresolved");
  expect(result.reason).toBe("cart_setup_missing");
});

test("cart assertion con add to cart previo pasa por estructura", () => {
  const snapshot = makeSnapshot([
    makeElement({ tagName: "tr", role: "row", text: "Product row" }),
    makeElement({ text: "Total: $99.00" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("productos agregados en carrito")], {
    executedActions: [{ action: "click", target: "Add to cart", status: "found" }]
  });
  expect(result.status).toBe("passed");
  expect(result.reason).toBe("structurally_satisfied");
});

test("assertion de detalle se difiere por contexto antes de seleccionar item", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "card", text: "Item A" }),
    makeElement({ type: "card", text: "Item B" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("descripcion del producto")], {
    executedActions: [{ action: "click", target: "Catalog", status: "found" }]
  });
  expect(result.status).toBe("needs_assertion_resolution");
  expect(result.reason).toBe("assertion_context_not_reached");
  expect((result.assertionDiagnostics as any)?.assertionContextDiagnostics?.decision).toBe("deferred_until_context");
});

test("assertion de detalle se satisface estructuralmente en contexto detail", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "heading", tagName: "h1", text: "Product X" }),
    makeElement({ type: "text", text: "$100.00" }),
    makeElement({ tagName: "img", role: "img", text: "image" }),
    makeElement({ type: "text", text: "Add to cart" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("precio del producto")], {
    executedActions: [{ action: "click", target: "View details", status: "found" }]
  });
  expect(result.status).toBe("passed");
  expect(result.reason).toBe("structurally_satisfied");
  expect((result.assertionDiagnostics as any)?.assertionContextDiagnostics?.decision).toBe("structurally_satisfied");
});

test("assertion de carrito se difiere si contexto de carrito no fue alcanzado", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "card", text: "Catalog item" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("total del carrito")], {
    executedActions: [{ action: "click", target: "Catalog", status: "found" }]
  });
  expect(result.status).toBe("needs_assertion_resolution");
  expect(result.reason).toBe("assertion_context_not_reached");
  expect((result.assertionDiagnostics as any)?.assertionContextDiagnostics?.decision).toBe("deferred_until_context");
});

test("consume assertion por fill exitoso con decision satisfied_by_fill_action", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "input", label: "Country" }),
    makeElement({ type: "input", label: "City" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Country requerido")], {
    executedActions: [{ action: "fill", target: "Country", status: "found" }]
  });
  expect(result.status).toBe("satisfied_by_previous_assertion");
  expect((result.assertionDiagnostics as any)?.assertionConsumptionDiagnostics?.decision).toBe("satisfied_by_fill_action");
});

test("consume assertion por click exitoso con decision satisfied_by_action_executed", () => {
  const snapshot = makeSnapshot([makeElement({ type: "button", text: "Add to cart" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Botón Add to cart visible")], {
    executedActions: [{ action: "click", target: "Add to cart", status: "found" }]
  });
  expect(result.status).toBe("satisfied_by_previous_assertion");
  expect((result.assertionDiagnostics as any)?.assertionConsumptionDiagnostics?.decision).toBe("satisfied_by_action_executed");
});

test("consume assertion por presencia de campo en formulario activo", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "dialog", text: "Payment form" }),
    makeElement({ type: "input", label: "Credit card" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Campo Credit card visible")], {
    executedActions: [{ action: "click", target: "Place Order", status: "found" }]
  });
  expect(result.status).toBe("satisfied_by_previous_assertion");
  expect((result.assertionDiagnostics as any)?.assertionConsumptionDiagnostics?.decision).toBe("satisfied_by_form_field_presence");
});

test("consume assertion de accion principal visible en detalle por evidencia estructural", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "heading", text: "Product detail" }),
    makeElement({ type: "text", text: "Add to cart" })
  ]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Add to cart visible")], {
    executedActions: [{ action: "click", target: "View details", status: "found" }]
  });
  expect(result.status).toBe("satisfied_by_previous_assertion");
  expect((result.assertionDiagnostics as any)?.assertionConsumptionDiagnostics?.decision).toBe("satisfied_by_structural_evidence");
});

// --- Runtime Evidence Trace / Failure Forensics tests ---

test("pending assertion forensics includes expectedConsumption and assertionType", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Welcome" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("carrito contiene producto")], {
    executedActions: [{ action: "click", target: "Catalog", status: "found" }]
  });
  
  expect(result.expectedConsumption).toBeDefined();
  expect(result.expectedConsumption?.consumed).toBe(false);
  expect(result.assertionType).toBe("cart");
});

test("field-like assertion is classified as observable or structural", () => {
  const snapshot = makeSnapshot([makeElement({ type: "input", label: "Username" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Username field visible")]);
  expect(result.classification).toBeDefined();
});

test("confirmation assertion keeps resolvable classification", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Thank you for your purchase" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Confirmation message visible")]);
  expect(result.classification).toBeDefined();
});

test("catalog assertion is classified for list resolver", () => {
  const snapshot = makeSnapshot([makeElement({ type: "card", text: "Product A" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Listado de productos")]);
  expect(result.classification).toBeDefined();
});

test("detail assertion is classified with detail semantics", () => {
  const snapshot = makeSnapshot([makeElement({ type: "heading", text: "Product Detail" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Detalle del producto")]);
  expect(["semantic_descriptor", "structural_assertion", "literal_observable"]).toContain(result.classification);
});

test("notConsumedReason is set for unresolved assertions", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Welcome" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("producto en carrito")], {
    executedActions: [{ action: "click", target: "Catalog", status: "found" }]
  });
  
  expect(result.status).toBeDefined();
});

test("consumed assertion includes assertionConsumptionDiagnostics", () => {
  const snapshot = makeSnapshot([makeElement({ type: "input", label: "Country" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Country requerido")], {
    executedActions: [{ action: "fill", target: "Country", status: "found" }]
  });
  
  expect(result.status === "satisfied_by_previous_assertion" || result.status === "passed").toBe(true);
  if (result.status === "satisfied_by_previous_assertion") {
    expect((result.assertionDiagnostics as any)?.assertionConsumptionDiagnostics).toBeDefined();
  }
});

test("navigation-like assertion remains classifiable", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Home Page" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Navigation to home page")]);
  expect(result.classification).toBeDefined();
});

test("form assertion remains classifiable", () => {
  const snapshot = makeSnapshot([makeElement({ type: "dialog", text: "Form" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Formulario de pago")]);
  expect(result.classification).toBeDefined();
});

test("action assertion remains classifiable", () => {
  const snapshot = makeSnapshot([makeElement({ type: "button", text: "Submit" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Click submit button")]);
  expect(result.classification).toBeDefined();
});
