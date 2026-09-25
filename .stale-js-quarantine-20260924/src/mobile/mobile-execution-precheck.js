"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMobileExecutionSignals = resolveMobileExecutionSignals;
exports.evaluateScenarioPrecheck = evaluateScenarioPrecheck;
exports.resolveFunctionalDataProfile = resolveFunctionalDataProfile;
const mobile_route_profile_1 = require("./mobile-route-profile");
function normalizeSignalToken(value) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}
function resolveMobileExecutionSignals(appSlug) {
    const defaults = {
        successSignals: ["otp", "codigo de verificacion", "codigo de validacion"],
        rejectionSignals: ["no fue posible validar", "portal de ventas", "no se permite continuar"],
        validationSignals: ["datos de contacto", "correo electronico", "numero de telefono"],
        technicalErrorSignals: ["inconveniente tecnico", "ocurrio un inconveniente tecnico", "reintentar"],
        inductionActions: ["simular desconexion", "forzar error tecnico", "inducir error tecnico", "deshabilitar red"],
    };
    if (!appSlug)
        return defaults;
    const profile = (0, mobile_route_profile_1.loadMobileRouteProfile)(appSlug);
    const signals = profile?.executionSignals;
    if (!signals)
        return defaults;
    return {
        successSignals: signals.successSignals?.length ? signals.successSignals : defaults.successSignals,
        rejectionSignals: signals.rejectionSignals?.length ? signals.rejectionSignals : defaults.rejectionSignals,
        validationSignals: signals.validationSignals?.length ? signals.validationSignals : defaults.validationSignals,
        technicalErrorSignals: signals.technicalErrorSignals?.length ? signals.technicalErrorSignals : defaults.technicalErrorSignals,
        inductionActions: signals.inductionActions?.length ? signals.inductionActions : defaults.inductionActions,
    };
}
function scenarioRequiresTechnicalErrorInduction(steps, signals, contextText) {
    const context = contextText ? normalizeSignalToken(contextText) : "";
    return steps.some((step) => {
        const haystack = normalizeSignalToken(`${step.description ?? ""} ${step.target?.value ?? ""} ${context}`);
        return signals.technicalErrorSignals.some((signal) => haystack.includes(normalizeSignalToken(signal)));
    });
}
function scenarioHasTechnicalInductionAction(steps, signals) {
    return steps.some((step) => {
        const haystack = normalizeSignalToken(`${step.description ?? ""} ${step.target?.value ?? ""} ${step.value ?? ""}`);
        return signals.inductionActions.some((signal) => haystack.includes(normalizeSignalToken(signal)));
    });
}
function evaluateScenarioPrecheck(steps, appSlug, contextText, requiredDataProfile) {
    const executionSignals = resolveMobileExecutionSignals(appSlug);
    if (scenarioRequiresTechnicalErrorInduction(steps, executionSignals, contextText) && !scenarioHasTechnicalInductionAction(steps, executionSignals)) {
        return {
            blocked: true,
            reasonCode: "non_executable_precondition",
            detail: "technical_error_not_inducible",
        };
    }
    if (requiredDataProfile) {
        return { blocked: false, functionalData: evaluateFunctionalDataProfile(appSlug, requiredDataProfile) };
    }
    return { blocked: false };
}
function resolveFunctionalDataProfile(appSlug, profileName) {
    if (!appSlug)
        return null;
    const profile = (0, mobile_route_profile_1.loadMobileRouteProfile)(appSlug);
    const profiles = profile?.functionalDataProfiles;
    if (!profiles)
        return null;
    return profiles[profileName] ?? null;
}
function loadTestData() {
    const raw = process.env.APP_TEST_DATA_JSON;
    if (!raw || !raw.trim())
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            return parsed;
    }
    catch {
        // env not configured / malformed — every dataRef will resolve as unresolved
    }
    return {};
}
function resolveTestDataRef(dataRef, testData) {
    const trimmed = dataRef.trim();
    if (!trimmed)
        return undefined;
    const segments = trimmed.split(".");
    let current = testData;
    for (const segment of segments) {
        if (current && typeof current === "object" && !Array.isArray(current)) {
            current = current[segment];
        }
        else {
            current = undefined;
            break;
        }
    }
    if (current === undefined || current === null)
        return undefined;
    if (typeof current === "object")
        return undefined;
    return String(current);
}
function evaluateFunctionalDataProfile(appSlug, profileName) {
    const profile = resolveFunctionalDataProfile(appSlug, profileName);
    if (!profile) {
        return { status: "manual_data_required", reasonCode: "missing_functional_data_profile", detail: profileName };
    }
    const testData = loadTestData();
    const unresolved = Object.values(profile.dataRefs).filter((dataRef) => resolveTestDataRef(dataRef, testData) === undefined);
    if (unresolved.length > 0) {
        return { status: "manual_data_required", reasonCode: "unresolved_functional_test_data", detail: unresolved.join(",") };
    }
    return { status: "resolved" };
}
