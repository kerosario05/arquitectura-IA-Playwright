"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const selection_state_detector_1 = require("../src/discovery/selection-state-detector");
(0, test_1.test)("isSelectionLikeTarget detects 'Seleccionar A quien pueda interesar' as action_select", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("A quien pueda interesar", { action: "Seleccionar A quien pueda interesar", actionType: "action_select" })).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects actionType='action_select' as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("Cuenta de ahorros", { actionType: "action_select" })).toBe(true);
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("Carta de referencia", { actionType: "action_select" })).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'A quien pueda interesar' as selection-like by keyword", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("A quien pueda interesar")).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'destinatario' as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("destinatario")).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'opción' as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("opción")).toBe(true);
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("opcion")).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'producto' as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("producto")).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'tarjeta' as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("tarjeta")).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'radio option' as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("radio option")).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'checkbox option' as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("checkbox option")).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'list item' as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("list item")).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'card' as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("card")).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'elegir' action as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("Carta de referencia", { action: "elegir" })).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'marcar' action as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("Opción A", { action: "marcar" })).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'escoger' action as selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("Producto X", { action: "escoger" })).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget returns false for navigation targets", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("Generar cartas")).toBe(false);
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("Transacciones y servicios")).toBe(false);
});
(0, test_1.test)("isSubmitLikeTarget detects 'continuar' as submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("continuar")).toBe(true);
});
(0, test_1.test)("isSubmitLikeTarget detects 'confirmar' as submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("confirmar")).toBe(true);
});
(0, test_1.test)("isSubmitLikeTarget detects 'enviar' as submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("enviar")).toBe(true);
});
(0, test_1.test)("isSubmitLikeTarget detects 'iniciar sesión' as submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("iniciar sesión")).toBe(true);
});
(0, test_1.test)("isSubmitLikeTarget detects 'generar' as submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("generar")).toBe(true);
});
(0, test_1.test)("isSubmitLikeTarget detects 'pagar' as submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("pagar")).toBe(true);
});
(0, test_1.test)("isSubmitLikeTarget detects 'transferir' as submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("transferir")).toBe(true);
});
(0, test_1.test)("isSubmitLikeTarget detects 'solicitar' as submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("solicitar")).toBe(true);
});
(0, test_1.test)("isSubmitLikeTarget detects 'finalizar' as submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("finalizar")).toBe(true);
});
(0, test_1.test)("isSubmitLikeTarget detects 'aprobar' as submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("aprobar")).toBe(true);
});
(0, test_1.test)("isSubmitLikeTarget returns false for selection targets", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("cuenta de ahorros")).toBe(false);
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("A quien pueda interesar")).toBe(false);
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("Carta de referencia")).toBe(false);
});
(0, test_1.test)("selection-like target is not submit-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("A quien pueda interesar")).toBe(true);
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("A quien pueda interesar")).toBe(false);
});
(0, test_1.test)("submit-like target is not selection-like", () => {
    (0, test_1.expect)((0, selection_state_detector_1.isSubmitLikeTarget)("continuar")).toBe(true);
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("continuar")).toBe(false);
});
(0, test_1.test)("isSelectionLikeTarget detects selection screen heading context", () => {
    const snapshotWithHeading = {
        elements: [
            { text: "Seleccione un destinatario", role: "heading", tagName: "h2" },
            { text: "A quien pueda interesar", role: "button" }
        ]
    };
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("A quien pueda interesar", { snapshot: snapshotWithHeading })).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects '¿A quién va dirigida la carta?' heading", () => {
    const snapshotWithHeading = {
        elements: [
            { text: "¿A quién va dirigida la carta?", role: "heading", tagName: "h2" },
            { text: "A quien pueda interesar", role: "button" }
        ]
    };
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("A quien pueda interesar", { snapshot: snapshotWithHeading })).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'Destinatario' heading", () => {
    const snapshotWithHeading = {
        elements: [
            { text: "Destinatario", role: "heading", tagName: "h3" },
            { text: "A quien pueda interesar", role: "button" }
        ]
    };
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("A quien pueda interesar", { snapshot: snapshotWithHeading })).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget detects 'Opciones' heading", () => {
    const snapshotWithHeading = {
        elements: [
            { text: "Opciones", role: "heading", tagName: "h2" },
            { text: "Carta de referencia", role: "button" }
        ]
    };
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("Carta de referencia", { snapshot: snapshotWithHeading })).toBe(true);
});
(0, test_1.test)("isSelectionLikeTarget without heading context still works by keyword", () => {
    const snapshotNoHeading = {
        elements: [
            { text: "Generar cartas", role: "heading" },
            { text: "Carta de referencia", role: "button" }
        ]
    };
    (0, test_1.expect)((0, selection_state_detector_1.isSelectionLikeTarget)("Carta de referencia", { snapshot: snapshotNoHeading })).toBe(true);
});
