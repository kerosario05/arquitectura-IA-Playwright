import { test, expect } from "@playwright/test";
import {
  isSelectionLikeTarget,
  isSubmitLikeTarget,
  promoteToClickableAncestor
} from "../src/discovery/selection-state-detector";

test("isSelectionLikeTarget detects 'Seleccionar A quien pueda interesar' as action_select", () => {
  expect(isSelectionLikeTarget("A quien pueda interesar", { action: "Seleccionar A quien pueda interesar", actionType: "action_select" })).toBe(true);
});

test("isSelectionLikeTarget detects actionType='action_select' as selection-like", () => {
  expect(isSelectionLikeTarget("Cuenta de ahorros", { actionType: "action_select" })).toBe(true);
  expect(isSelectionLikeTarget("Carta de referencia", { actionType: "action_select" })).toBe(true);
});

test("isSelectionLikeTarget detects 'A quien pueda interesar' as selection-like by keyword", () => {
  expect(isSelectionLikeTarget("A quien pueda interesar")).toBe(true);
});

test("isSelectionLikeTarget detects 'destinatario' as selection-like", () => {
  expect(isSelectionLikeTarget("destinatario")).toBe(true);
});

test("isSelectionLikeTarget detects 'opción' as selection-like", () => {
  expect(isSelectionLikeTarget("opción")).toBe(true);
  expect(isSelectionLikeTarget("opcion")).toBe(true);
});

test("isSelectionLikeTarget detects 'producto' as selection-like", () => {
  expect(isSelectionLikeTarget("producto")).toBe(true);
});

test("isSelectionLikeTarget detects 'tarjeta' as selection-like", () => {
  expect(isSelectionLikeTarget("tarjeta")).toBe(true);
});

test("isSelectionLikeTarget detects 'radio option' as selection-like", () => {
  expect(isSelectionLikeTarget("radio option")).toBe(true);
});

test("isSelectionLikeTarget detects 'checkbox option' as selection-like", () => {
  expect(isSelectionLikeTarget("checkbox option")).toBe(true);
});

test("isSelectionLikeTarget detects 'list item' as selection-like", () => {
  expect(isSelectionLikeTarget("list item")).toBe(true);
});

test("isSelectionLikeTarget detects 'card' as selection-like", () => {
  expect(isSelectionLikeTarget("card")).toBe(true);
});

test("isSelectionLikeTarget detects 'elegir' action as selection-like", () => {
  expect(isSelectionLikeTarget("Carta de referencia", { action: "elegir" })).toBe(true);
});

test("isSelectionLikeTarget detects 'marcar' action as selection-like", () => {
  expect(isSelectionLikeTarget("Opción A", { action: "marcar" })).toBe(true);
});

test("isSelectionLikeTarget detects 'escoger' action as selection-like", () => {
  expect(isSelectionLikeTarget("Producto X", { action: "escoger" })).toBe(true);
});

test("isSelectionLikeTarget returns false for navigation targets", () => {
  expect(isSelectionLikeTarget("Generar cartas")).toBe(false);
  expect(isSelectionLikeTarget("Transacciones y servicios")).toBe(false);
});

test("isSubmitLikeTarget detects 'continuar' as submit-like", () => {
  expect(isSubmitLikeTarget("continuar")).toBe(true);
});

test("isSubmitLikeTarget detects 'confirmar' as submit-like", () => {
  expect(isSubmitLikeTarget("confirmar")).toBe(true);
});

test("isSubmitLikeTarget detects 'enviar' as submit-like", () => {
  expect(isSubmitLikeTarget("enviar")).toBe(true);
});

test("isSubmitLikeTarget detects 'iniciar sesión' as submit-like", () => {
  expect(isSubmitLikeTarget("iniciar sesión")).toBe(true);
});

test("isSubmitLikeTarget detects 'generar' as submit-like", () => {
  expect(isSubmitLikeTarget("generar")).toBe(true);
});

test("isSubmitLikeTarget detects 'pagar' as submit-like", () => {
  expect(isSubmitLikeTarget("pagar")).toBe(true);
});

test("isSubmitLikeTarget detects 'transferir' as submit-like", () => {
  expect(isSubmitLikeTarget("transferir")).toBe(true);
});

test("isSubmitLikeTarget detects 'solicitar' as submit-like", () => {
  expect(isSubmitLikeTarget("solicitar")).toBe(true);
});

test("isSubmitLikeTarget detects 'finalizar' as submit-like", () => {
  expect(isSubmitLikeTarget("finalizar")).toBe(true);
});

test("isSubmitLikeTarget detects 'aprobar' as submit-like", () => {
  expect(isSubmitLikeTarget("aprobar")).toBe(true);
});

test("isSubmitLikeTarget returns false for selection targets", () => {
  expect(isSubmitLikeTarget("cuenta de ahorros")).toBe(false);
  expect(isSubmitLikeTarget("A quien pueda interesar")).toBe(false);
  expect(isSubmitLikeTarget("Carta de referencia")).toBe(false);
});

test("selection-like target is not submit-like", () => {
  expect(isSelectionLikeTarget("A quien pueda interesar")).toBe(true);
  expect(isSubmitLikeTarget("A quien pueda interesar")).toBe(false);
});

test("submit-like target is not selection-like", () => {
  expect(isSubmitLikeTarget("continuar")).toBe(true);
  expect(isSelectionLikeTarget("continuar")).toBe(false);
});

test("isSelectionLikeTarget detects selection screen heading context", () => {
  const snapshotWithHeading = {
    elements: [
      { text: "Seleccione un destinatario", role: "heading", tagName: "h2" },
      { text: "A quien pueda interesar", role: "button" }
    ]
  } as any;

  expect(isSelectionLikeTarget("A quien pueda interesar", { snapshot: snapshotWithHeading })).toBe(true);
});

test("isSelectionLikeTarget detects '¿A quién va dirigida la carta?' heading", () => {
  const snapshotWithHeading = {
    elements: [
      { text: "¿A quién va dirigida la carta?", role: "heading", tagName: "h2" },
      { text: "A quien pueda interesar", role: "button" }
    ]
  } as any;

  expect(isSelectionLikeTarget("A quien pueda interesar", { snapshot: snapshotWithHeading })).toBe(true);
});

test("isSelectionLikeTarget detects 'Destinatario' heading", () => {
  const snapshotWithHeading = {
    elements: [
      { text: "Destinatario", role: "heading", tagName: "h3" },
      { text: "A quien pueda interesar", role: "button" }
    ]
  } as any;

  expect(isSelectionLikeTarget("A quien pueda interesar", { snapshot: snapshotWithHeading })).toBe(true);
});

test("isSelectionLikeTarget detects 'Opciones' heading", () => {
  const snapshotWithHeading = {
    elements: [
      { text: "Opciones", role: "heading", tagName: "h2" },
      { text: "Carta de referencia", role: "button" }
    ]
  } as any;

  expect(isSelectionLikeTarget("Carta de referencia", { snapshot: snapshotWithHeading })).toBe(true);
});

test("isSelectionLikeTarget without heading context still works by keyword", () => {
  const snapshotNoHeading = {
    elements: [
      { text: "Generar cartas", role: "heading" },
      { text: "Carta de referencia", role: "button" }
    ]
  } as any;

  expect(isSelectionLikeTarget("Carta de referencia", { snapshot: snapshotNoHeading })).toBe(true);
});
