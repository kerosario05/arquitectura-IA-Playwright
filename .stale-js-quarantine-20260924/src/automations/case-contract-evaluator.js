"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractCaseContractMetadata = extractCaseContractMetadata;
exports.buildMcpScenarioContractFromTestRailCase = buildMcpScenarioContractFromTestRailCase;
exports.buildVirtualCaseFromContract = buildVirtualCaseFromContract;
exports.evaluateCaseContractSufficiency = evaluateCaseContractSufficiency;
const scenario_automatability_classifier_1 = require("../scenarios/scenario-automatability-classifier");
const scenario_preview_types_1 = require("../types/scenario-preview.types");
function nonEmpty(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function readStringField(rawCase, keys) {
    for (const key of keys) {
        const value = rawCase[key];
        if (typeof value !== "string")
            continue;
        const normalized = nonEmpty(value);
        if (normalized)
            return normalized;
    }
    return undefined;
}
function readBooleanField(rawCase, keys) {
    for (const key of keys) {
        const value = rawCase[key];
        if (typeof value === "boolean")
            return value;
        if (typeof value !== "string")
            continue;
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "si", "sí"].includes(normalized))
            return true;
        if (["false", "0", "no"].includes(normalized))
            return false;
    }
    return undefined;
}
function normalizeStepText(value) {
    return value.replace(/^\d+[\.)]\s*/, "").trim();
}
function ensureTerminalDot(value) {
    return /[.!?]$/.test(value) ? value : `${value}.`;
}
function buildExecutableSteps(scenario) {
    const executable = [];
    for (const step of scenario.steps) {
        const action = normalizeStepText(step.action);
        if (!action)
            continue;
        const expected = nonEmpty(step.expected);
        if (!expected) {
            executable.push(action);
            continue;
        }
        if (/^(validar|verificar|comprobar|esperar|assert)\b/i.test(action)) {
            executable.push(action);
            continue;
        }
        executable.push(`${ensureTerminalDot(action)} Validar que ${expected}.`);
    }
    return executable;
}
function buildExpectedResult(scenario) {
    const fromRaw = nonEmpty(scenario.raw?.custom_expected);
    if (fromRaw)
        return fromRaw;
    const fromSteps = scenario.steps
        .map((step) => nonEmpty(step.expected))
        .filter((value) => Boolean(value));
    if (fromSteps.length > 0) {
        return fromSteps.join(" | ");
    }
    return "Completar el flujo funcional sin errores.";
}
function buildDataRequirements(scenario, metadata) {
    const hints = new Set();
    const fromMetadata = nonEmpty(metadata.dataRequirements);
    if (fromMetadata)
        hints.add(fromMetadata);
    for (const step of scenario.steps) {
        for (const hint of step.dataHints ?? []) {
            const normalized = nonEmpty(hint);
            if (normalized)
                hints.add(normalized);
        }
    }
    return Array.from(hints).join(", ");
}
function extractCaseContractMetadata(rawCase) {
    return {
        routeProfileName: readStringField(rawCase, [
            "custom_route_profile",
            "custom_route_profile_name",
            "routeProfile",
            "route_profile",
        ]),
        navigationPrefix: readStringField(rawCase, [
            "custom_navigation_prefix",
            "navigationPrefix",
            "navigation_prefix",
        ]),
        routeEvidence: readStringField(rawCase, [
            "custom_route_evidence",
            "routeEvidence",
            "route_evidence",
            "custom_cache_key",
            "custom_source",
        ]),
        dataRequirements: readStringField(rawCase, [
            "custom_data_requirements",
            "dataRequirements",
            "data_requirements",
        ]),
        manualOnly: readBooleanField(rawCase, [
            "custom_manual_only",
            "manualOnly",
            "manual_only",
            "custom_non_automatable_manual",
        ]),
    };
}
function buildMcpScenarioContractFromTestRailCase(input) {
    const sourceIssueKey = `TR-C${input.scenario.caseId}`;
    return {
        sourceIssueKey,
        scenarioId: sourceIssueKey,
        caseId: input.scenario.caseId,
        title: input.scenario.title,
        steps: buildExecutableSteps(input.scenario),
        preconditions: nonEmpty(input.scenario.preconditions)
            ? [input.scenario.preconditions]
            : [],
        expectedResult: buildExpectedResult(input.scenario),
        caseOracle: typeof input.scenario.raw?.custom_case_oracle === "string"
            ? input.scenario.raw.custom_case_oracle
            : undefined,
        type: "Functional",
        database: "QA",
        isConverted: 0,
        automationType: "ui_with_auth_gate",
        setupStrategy: "auth_gate",
        appSlug: input.appSlug,
        targetAppSlug: input.appSlug,
        routeProfile: input.metadata.routeProfileName ?? "",
        dataRequirements: buildDataRequirements(input.scenario, input.metadata),
        nonExecutableCriteria: "",
        mcpExecutable: true,
        ...(input.metadata.manualOnly !== undefined ? { manualOnly: input.metadata.manualOnly } : {}),
    };
}
function buildVirtualCaseFromContract(input) {
    const vc = (0, scenario_preview_types_1.toVirtualCase)(input.scenario, input.index, input.sectionSlug, input.sectionName, input.sectionId);
    if (typeof input.testRailCaseId === "number" && Number.isInteger(input.testRailCaseId) && input.testRailCaseId > 0) {
        vc.testRailCaseId = input.testRailCaseId;
    }
    const navigationPrefix = nonEmpty(input.metadata?.navigationPrefix);
    if (navigationPrefix) {
        vc.navigationPrefix = navigationPrefix;
    }
    const routeEvidence = nonEmpty(input.metadata?.routeEvidence);
    if (routeEvidence) {
        vc.routeEvidence = routeEvidence;
    }
    return vc;
}
function extractTarget(step) {
    const quoted = step.match(/"([^"]+)"/);
    if (quoted?.[1])
        return quoted[1].trim();
    const prefixed = step.match(/(?:clic en|seleccionar|presionar|tap en|ingresar en|completar en|navegar a|ir a)\s+([^.,;]+)/i);
    return prefixed?.[1]?.trim();
}
function isOperationalStep(step) {
    return /^(?:\d+[\.)]\s*)?(clic en|seleccionar|presionar|tap en|ingresar|completar|escribir|digitar|navegar|ir a|validar|verificar|comprobar|esperar)\b/i.test(step);
}
function isNavigationStep(step) {
    return /^(?:\d+[\.)]\s*)?(clic en|seleccionar|presionar|tap en|navegar|ir a)\b/i.test(step);
}
function isAssertionStep(step) {
    return /^(?:\d+[\.)]\s*)?(validar|verificar|comprobar|esperar)\b/i.test(step);
}
function isDataInputStep(step) {
    return /^(?:\d+[\.)]\s*)?(ingresar|completar|escribir|digitar|introducir)\b/i.test(step);
}
function isGenericTarget(target) {
    return /^(boton|bot[oó]n|opcion|opci[oó]n|campo|elemento|item|seccion|secci[oó]n|pantalla|modulo|m[oó]dulo)$/i.test(target.trim());
}
function dedupeGaps(gaps) {
    const seen = new Set();
    const unique = [];
    for (const gap of gaps) {
        const key = `${gap.type}|${gap.stepNumber ?? 0}|${gap.target ?? ""}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        unique.push(gap);
    }
    return unique;
}
function evaluateCaseContractSufficiency(input) {
    const gaps = [];
    const steps = (input.scenario.steps ?? []).map(normalizeStepText).filter(Boolean);
    const hasRouteEvidence = Boolean(nonEmpty(input.metadata.routeProfileName)
        || nonEmpty(input.metadata.navigationPrefix)
        || nonEmpty(input.metadata.routeEvidence)
        || input.hasRouteProfileConfig);
    if (!nonEmpty(input.appSlug) || !nonEmpty(input.sectionSlug)) {
        gaps.push({ type: "missing_route_evidence" });
    }
    if (!hasRouteEvidence) {
        gaps.push({ type: "missing_route_evidence" });
    }
    if (steps.length === 0) {
        gaps.push({ type: "missing_transition" });
    }
    let operationalCount = 0;
    for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        if (!isOperationalStep(step))
            continue;
        operationalCount += 1;
        const target = extractTarget(step);
        if (!target) {
            gaps.push({ type: "missing_target", stepNumber: index + 1 });
            continue;
        }
        if (isGenericTarget(target)) {
            gaps.push({ type: "missing_locator", stepNumber: index + 1, target });
        }
    }
    if (operationalCount === 0) {
        gaps.push({ type: "missing_transition" });
    }
    const hasTransitionEvidence = steps.some(isNavigationStep)
        && (steps.some(isAssertionStep) || Boolean(nonEmpty(input.scenario.expectedResult)));
    if (!hasTransitionEvidence) {
        gaps.push({ type: "missing_transition" });
    }
    const requiresInputData = steps.some(isDataInputStep);
    const hasDataRequirements = Boolean(nonEmpty(input.scenario.dataRequirements))
        || (input.scenario.preconditions ?? []).some((entry) => /\b(usuario|cliente|cuenta|identificacion|identificaci[oó]n|otp|pin|token|clave|password|dato)\b/i.test(entry));
    if (requiresInputData && !hasDataRequirements) {
        gaps.push({ type: "missing_test_data" });
    }
    const automatability = (0, scenario_automatability_classifier_1.classifyScenarioAutomatability)(input.scenario);
    if (!automatability.isAutomatable) {
        const gapType = automatability.classification === "non_automatable_manual"
            ? "manual_step"
            : "non_ui_step";
        gaps.push({ type: gapType });
    }
    const uniqueGaps = dedupeGaps(gaps);
    const gapTypes = new Set(uniqueGaps.map((gap) => gap.type));
    if (gapTypes.has("manual_step") || gapTypes.has("non_ui_step")) {
        return {
            sufficient: false,
            gaps: uniqueGaps,
            recommendedRoute: "blocked",
            reasonCode: automatability.reasonCode ?? "non_automatable_contract",
        };
    }
    if (gapTypes.has("missing_test_data")) {
        return {
            sufficient: false,
            gaps: uniqueGaps,
            recommendedRoute: "blocked",
            reasonCode: "missing_test_data",
        };
    }
    if (uniqueGaps.length === 0) {
        return {
            sufficient: true,
            gaps: uniqueGaps,
            recommendedRoute: "automation_from_case_contract",
            reasonCode: "contract_sufficient",
        };
    }
    const targetedGapTypes = new Set([
        "missing_target",
        "missing_locator",
        "missing_transition",
    ]);
    const hasOnlyTargetedGaps = uniqueGaps.every((gap) => targetedGapTypes.has(gap.type));
    if (hasOnlyTargetedGaps && hasRouteEvidence) {
        return {
            sufficient: false,
            gaps: uniqueGaps,
            recommendedRoute: "targeted_discovery",
            reasonCode: "targeted_gap_resolution_required",
        };
    }
    return {
        sufficient: false,
        gaps: uniqueGaps,
        recommendedRoute: "full_discovery",
        reasonCode: gapTypes.has("missing_route_evidence")
            ? "missing_route_evidence"
            : "contract_insufficient_for_fast_path",
    };
}
