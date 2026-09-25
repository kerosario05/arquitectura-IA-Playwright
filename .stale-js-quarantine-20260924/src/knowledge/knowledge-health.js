"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeKnowledgeHealth = analyzeKnowledgeHealth;
const mobile_knowledge_resolver_1 = require("../mobile/mobile-knowledge-resolver");
function worst(a, b) {
    if (a === "fail" || b === "fail")
        return "fail";
    if (a === "warn" || b === "warn")
        return "warn";
    return "ok";
}
function controlsOf(item) {
    const raw = item.observedControls;
    if (!Array.isArray(raw))
        return [];
    return raw.filter((c) => typeof c === "object" && c !== null);
}
function analyzeKnowledgeHealth(items) {
    const itemsByKind = {};
    for (const item of items) {
        const kind = String(item.knowledgeKind ?? "(sin kind)");
        itemsByKind[kind] = (itemsByKind[kind] ?? 0) + 1;
    }
    const screenItems = items.filter((i) => mobile_knowledge_resolver_1.GENERATOR_READABLE_SCREEN_KINDS.includes(i.knowledgeKind));
    const readable = screenItems.filter((i) => (0, mobile_knowledge_resolver_1.isGeneratorReadableScreenItem)(i));
    const byScreenKey = new Map();
    for (const item of screenItems) {
        const key = String(item.screenKey ?? "(sin screenKey)");
        byScreenKey.set(key, (byScreenKey.get(key) ?? 0) + 1);
    }
    const screensWithMultipleStates = [...byScreenKey.values()].filter((n) => n > 1).length;
    const withGate = screenItems.filter((i) => controlsOf(i).some((c) => c.enabled === false));
    // A capture from before gate state was recorded has no `enabled` on any control at all.
    const missingEnabled = screenItems.filter((i) => {
        const controls = controlsOf(i);
        return controls.length > 0 && !controls.some((c) => "enabled" in c);
    });
    const findings = [];
    if (items.length === 0) {
        findings.push({
            id: "empty_knowledge",
            severity: "fail",
            title: "No hay conocimiento aprendido para esta app",
            detail: "El archivo está vacío o no existe.",
            action: "Ejecuta una corrida o dispara el aprendizaje de ruta (POST /api/mobile/route-learning).",
        });
    }
    if (screenItems.length === 0 && items.length > 0) {
        findings.push({
            id: "no_screen_items",
            severity: "fail",
            title: "Hay conocimiento, pero ninguna pantalla",
            detail: `Kinds presentes: ${Object.keys(itemsByKind).join(", ") || "ninguno"}. El generador solo lee ${mobile_knowledge_resolver_1.GENERATOR_READABLE_SCREEN_KINDS.join(" / ")}.`,
            action: "Revisa que persistMobileScreen se esté invocando al final de las corridas.",
        });
    }
    const unreadable = screenItems.length - readable.length;
    if (unreadable > 0) {
        findings.push({
            id: "screens_not_readable",
            severity: "warn",
            title: `${unreadable} de ${screenItems.length} pantallas no llegan al generador`,
            detail: "Están en el archivo pero no pasan el filtro: requieren trustedForReuse=true, validationStatus=\"validated\" y clickTargets.",
            action: "Una pantalla se valida al observarse en una corrida que pasa; repítela para promoverla.",
        });
    }
    if (readable.length > 0 && screensWithMultipleStates === 0) {
        findings.push({
            id: "no_multi_state_screens",
            severity: "warn",
            title: "Ninguna pantalla tiene más de un estado aprendido",
            detail: "Una pantalla con pasos condicionados (envío de código, aceptación, gates) atraviesa varios estados. " +
                "Que todas tengan uno solo suele indicar que se están fusionando al persistirse.",
            action: "Confirma que persistItem compare por id (firma) y no por screenKey.",
        });
    }
    if (missingEnabled.length > 0) {
        findings.push({
            id: "captures_without_gate_state",
            severity: "warn",
            title: `${missingEnabled.length} pantalla(s) sin información de habilitado/deshabilitado`,
            detail: "Fueron capturadas antes de que se registrara el estado `enabled` de los controles.",
            action: "Vuelve a recorrer esas pantallas para refrescarlas.",
        });
    }
    if (readable.length > 0 && withGate.length === 0) {
        findings.push({
            id: "no_gate_evidence",
            severity: "warn",
            title: "Ningún control aprendido aparece como deshabilitado",
            detail: "Sin esa evidencia el generador no puede saber que a una pantalla le faltan pasos previos, " +
                "y produce escenarios que intentan avanzar antes de tiempo.",
            action: "Recorre una pantalla con un botón bloqueado (por ejemplo, Continuar antes de validar).",
        });
    }
    if (findings.length === 0) {
        findings.push({
            id: "healthy",
            severity: "ok",
            title: "El conocimiento se ve sano",
            detail: `${readable.length} pantalla(s) legibles por el generador, ${screensWithMultipleStates} con varios estados, ${withGate.length} con evidencia de gate.`,
        });
    }
    return {
        totalItems: items.length,
        itemsByKind,
        screenItems: screenItems.length,
        readableByGenerator: readable.length,
        screensWithMultipleStates,
        itemsWithGateEvidence: withGate.length,
        itemsMissingEnabledCapture: missingEnabled.length,
        findings,
        severity: findings.reduce((acc, f) => worst(acc, f.severity), "ok"),
    };
}
