import { test, expect } from "@playwright/test";
import { detectTransientScreen } from "../src/discovery/transient-screen-detector";
import type { PageSnapshot } from "../src/types/page-snapshot.types";

function makeSnapshot(elements: Array<{ text?: string; className?: string; tagName?: string }>, url?: string): PageSnapshot {
  return {
    url: url || "https://example.com",
    title: "Test Page",
    elements: elements as any,
    summary: {
      totalElements: elements.length,
      buttons: elements.filter(e => e.tagName === "button").length,
      inputs: elements.filter(e => e.tagName === "input").length
    }
  } as PageSnapshot;
}

test("detectTransientScreen detects 'Redirigiendo...' as transient", () => {
  const snapshot = makeSnapshot([
    { text: "Redirigiendo al menú de operaciones...", tagName: "p" }
  ], "https://example.com/authentication-success");

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(true);
  expect(result.reason).toBe("redirecting_after_auth");
  expect(result.confidence).toBeGreaterThanOrEqual(0.5);
});

test("detectTransientScreen detects 'Cargando...' as transient", () => {
  const snapshot = makeSnapshot([
    { text: "Cargando...", tagName: "p" }
  ]);

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(true);
  expect(result.reason).toBe("loading");
});

test("detectTransientScreen detects 'Autenticación exitosa' + 'Redirigiendo' as transient", () => {
  const snapshot = makeSnapshot([
    { text: "¡Autenticación exitosa!", tagName: "h2" },
    { text: "Redirigiendo al menú de operaciones...", tagName: "p" }
  ], "https://example.com/authentication-success");

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(true);
  expect(result.reason).toBe("redirecting_after_auth");
});

test("detectTransientScreen detects URL /authentication-success as transient", () => {
  const snapshot = makeSnapshot([
    { text: "Identidad validada", tagName: "h2" }
  ], "https://example.com/authentication-success");

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(true);
});

test("detectTransientScreen does not mark functional screen as transient", () => {
  const snapshot = makeSnapshot([
    { text: "Transacciones y Servicios", tagName: "h2" },
    { text: "Generar cartas", tagName: "button" },
    { text: "Estado de cuenta", tagName: "button" },
    { text: "Consulta de balance", tagName: "button" },
    { text: "Pago de productos", tagName: "button" }
  ], "https://example.com/operations-menu");

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(false);
});

test("detectTransientScreen detects 'Código verificado exitosamente' as transient", () => {
  const snapshot = makeSnapshot([
    { text: "¡Código verificado exitosamente!", tagName: "p" },
    { text: "Autenticación exitosa", tagName: "h2" }
  ]);

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(true);
  expect(result.reason).toBe("success_intermediate");
});

test("detectTransientScreen detects 'Por favor espere' as transient", () => {
  const snapshot = makeSnapshot([
    { text: "Por favor espere", tagName: "p" },
    { text: "Procesando su solicitud...", tagName: "p" }
  ]);

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(true);
});

test("detectTransientScreen returns false for empty snapshot", () => {
  const snapshot = makeSnapshot([]);

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(false);
});

test("detectTransientScreen considers product list with visible cards as stable", () => {
  const snapshot = makeSnapshot([
    { text: "Cuenta de Ahorros ****4962", tagName: "div" },
    { text: "Saldo: RD$ 10,000.00", tagName: "p" },
    { text: "Activa", tagName: "span" },
    { text: "Seleccionar", tagName: "button" }
  ], "https://example.com/generate-letters");

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(false);
});

test("detectTransientScreen considers '0 productos' as transient (data_loading)", () => {
  const snapshot = makeSnapshot([
    { text: "0 productos", tagName: "p" },
    { text: "Continuar (0 productos)", tagName: "button" }
  ], "https://example.com/generate-letters");

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(true);
  expect(result.reason).toBe("data_loading");
});

test("detectTransientScreen considers 'Cargando productos' as transient", () => {
  const snapshot = makeSnapshot([
    { text: "Cargando productos...", tagName: "p" }
  ], "https://example.com/generate-letters");

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(true);
  expect(result.reason).toBe("data_loading");
});

test("detectTransientScreen stable when product cards visible and no loading", () => {
  const snapshot = makeSnapshot([
    { text: "Cuenta de Ahorros ****4962", tagName: "div" },
    { text: "Saldo: RD$ 10,000.00", tagName: "p" },
    { text: "Activa", tagName: "span" },
    { text: "Tarjeta de Crédito ****1234", tagName: "div" },
    { text: "Limite: RD$ 50,000.00", tagName: "p" },
    { text: "Activa", tagName: "span" }
  ], "https://example.com/generate-letters");

  const result = detectTransientScreen(snapshot);
  expect(result.transient).toBe(false);
});
