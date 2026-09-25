"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyStepIntent = classifyStepIntent;
function normalizeText(value) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function hasAny(text, keywords) {
    return keywords.some((keyword) => text.includes(keyword));
}
function classifyStepIntent(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
        return "unknown";
    }
    if (hasAny(normalized, ["login", "iniciar sesion", "autenticar", "sign in"])) {
        return "login";
    }
    if (hasAny(normalized, ["navegar", "abrir", "ir a", "acceder a url", "go to", "navigate"])) {
        return "navigate";
    }
    if (hasAny(normalized, ["esperar", "wait"])) {
        return "wait";
    }
    if (hasAny(normalized, [
        "ingresar",
        "digitar",
        "escribir",
        "completar",
        "llenar",
        "capture",
        "input",
        "enter",
        "type"
    ])) {
        return "fill";
    }
    if (hasAny(normalized, [
        "click",
        "clicar",
        "presionar",
        "pulsar",
        "seleccionar boton",
        "acceder",
        "continuar",
        "consultar",
        "buscar"
    ])) {
        return "click";
    }
    if (hasAny(normalized, ["validar", "verificar", "debe mostrar", "se muestra", "visualizar", "confirmar", "resultado", "aparece"])) {
        return "assert";
    }
    return "unknown";
}
