"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLikelyAuthGate = isLikelyAuthGate;
exports.buildAuthFlowSpecImport = buildAuthFlowSpecImport;
exports.buildAuthFlowInstantiation = buildAuthFlowInstantiation;
exports.buildSetTestDataCallFromEnv = buildSetTestDataCallFromEnv;
exports.buildAuthFlowCall = buildAuthFlowCall;
exports.buildSetTestDataCall = buildSetTestDataCall;
const AUTH_GATE_KEYWORDS = [
    "identificación del cliente",
    "identificacion del cliente",
    "código otp",
    "codigo otp",
    "confirmar número de teléfono",
    "confirmar numero de teléfono",
    "código de verificación",
    "codigo de verificacion"
];
function isLikelyAuthGate(text) {
    const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return AUTH_GATE_KEYWORDS.some((keyword) => {
        const normalizedKeyword = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return normalized.includes(normalizedKeyword);
    });
}
function buildAuthFlowSpecImport(appSlug) {
    const relativePath = appSlug === "default" ? "../../flows/auth.flow" : `../../flows/auth.flow`;
    return `import { AuthFlow, setAuthFlowTestData } from '${relativePath}';`;
}
function buildAuthFlowInstantiation() {
    return "  const authFlow = new AuthFlow(page);";
}
function buildSetTestDataCallFromEnv() {
    return `  setAuthFlowTestData(resolvePromotedSpecAuthDataFromEnv());`;
}
function buildAuthFlowCall(options) {
    const parts = [];
    parts.push("  await authFlow.ensureAuthenticated({");
    if (options.alias) {
        parts.push(`    alias: '${options.alias}',`);
    }
    if (options.landing) {
        parts.push(`    landing: '${options.landing}',`);
    }
    if (options.contractBinding) {
        parts.push(`    contractBinding: ${JSON.stringify(options.contractBinding)},`);
    }
    parts.push("  });");
    return parts.join("\n");
}
function buildSetTestDataCall(testDataJson) {
    return `  setAuthFlowTestData(${testDataJson});`;
}
