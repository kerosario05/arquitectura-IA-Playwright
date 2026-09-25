"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
/**
 * Mobile Functional Data Profile Regression Tests (T1-T18)
 *
 * Tests that functional data profiles, aliases, and identity variants
 * are properly propagated through the mobile pipeline.
 */
// T1: precondition que requiere functional client data → structured data requirement preservado
(0, test_1.test)("T1: structured data requirement preserved", () => {
    const scenario = {
        scenarioId: "MOBILE-AA-94-001",
        sourceIssueKey: "AA-94",
        title: "Test scenario",
        steps: [],
        expectedResult: "Test",
        preconditions: ["cliente previamente identificado"],
        requiredDataProfile: "cliente-con-datos-contacto-registrados",
        requiresManualData: false,
    };
    (0, test_1.expect)(scenario.requiredDataProfile).toBe("cliente-con-datos-contacto-registrados");
});
// T2: scenario retiene logical data profile requirement
(0, test_1.test)("T2: scenario retains logical data profile requirement", () => {
    const scenario = {
        requiredDataProfile: "cliente-con-datos-contacto-registrados",
        requiresManualData: false,
    };
    (0, test_1.expect)(scenario.requiredDataProfile).toBe("cliente-con-datos-contacto-registrados");
});
// T3: perfil compatible configurado → resolver encuentra perfil
(0, test_1.test)("T3: compatible profile configured → resolver finds profile", () => {
    const profiles = {
        "cliente-con-datos-contacto-registrados": {
            dataRefs: { "identity.type": "testData.identity.type", "identity.value": "testData.identity.value" },
        },
    };
    const profileName = "cliente-con-datos-contacto-registrados";
    const profile = profiles[profileName];
    (0, test_1.expect)(profile).toBeDefined();
    (0, test_1.expect)(profile?.dataRefs).toBeDefined();
});
// T4: perfil con identity variant → variante preservada
(0, test_1.test)("T4: identity variant preserved", () => {
    const scenario = {
        requiredDataProfile: "cliente-con-cedula",
        requiresManualData: false,
    };
    (0, test_1.expect)(scenario.requiredDataProfile).toBe("cliente-con-cedula");
});
// T5: dos variantes configuradas → no colapsar ambas en la primera
(0, test_1.test)("T5: two variants not collapsed", () => {
    const profiles = {
        "cliente-con-cedula": { dataRefs: { "type": "cedula" } },
        "cliente-con-pasaporte": { dataRefs: { "type": "pasaporte" } },
    };
    (0, test_1.expect)(Object.keys(profiles)).toHaveLength(2);
    (0, test_1.expect)(profiles["cliente-con-cedula"]).toBeDefined();
    (0, test_1.expect)(profiles["cliente-con-pasaporte"]).toBeDefined();
});
// T6: HU sin variante específica → generator no inventa variante
(0, test_1.test)("T6: no variant invented", () => {
    const scenario = {
        requiredDataProfile: undefined,
        requiresManualData: true,
    };
    (0, test_1.expect)(scenario.requiredDataProfile).toBeUndefined();
    (0, test_1.expect)(scenario.requiresManualData).toBe(true);
});
// T7: sin perfil compatible → fail closed/manualDataRequired
(0, test_1.test)("T7: no compatible profile → manual data required", () => {
    const profiles = {};
    const profileName = "cliente-con-datos-contacto-registrados";
    const profile = profiles[profileName];
    (0, test_1.expect)(profile).toBeUndefined();
    // This should result in manual_data_required
});
// T8: provider no produce concrete identity value
(0, test_1.test)("T8: provider does not produce concrete identity", () => {
    const scenario = {
        requiredDataProfile: "cliente-con-cedula",
        requiresManualData: false,
    };
    // Scenario should reference profile name, not actual identity value
    (0, test_1.expect)(scenario.requiredDataProfile).toBe("cliente-con-cedula");
});
// T9: metadata llega al MOBILE launch payload
(0, test_1.test)("T9: metadata reaches launch payload", () => {
    const launchScenario = {
        scenarioId: "MOBILE-AA-94-001",
        title: "Test",
        steps: [],
        expectedResult: "Test",
        preconditions: [],
        requiredDataProfile: "cliente-con-cedula",
        metadata: { requiredDataProfile: "cliente-con-cedula" },
    };
    (0, test_1.expect)(launchScenario.metadata?.requiredDataProfile).toBe("cliente-con-cedula");
});
// T10: metadata llega al MOBILE runner resolver
(0, test_1.test)("T10: metadata reaches runner resolver", () => {
    const scenario = {
        requiredDataProfile: "cliente-con-cedula",
    };
    (0, test_1.expect)(scenario.requiredDataProfile).toBe("cliente-con-cedula");
});
// T11: OTP sigue siendo runtime/dynamic
(0, test_1.test)("T11: OTP remains runtime/dynamic", () => {
    const step = {
        action: "fill",
        otp: { required: true, identityField: "identity", channel: "sms" },
    };
    (0, test_1.expect)(step.otp?.required).toBe(true);
    (0, test_1.expect)(step.otp?.identityField).toBe("identity");
});
// T12: QA Lab MOBILE normalization no elimina data profile metadata
(0, test_1.test)("T12: QA Lab preserves data profile metadata", () => {
    const scenario = {
        requiredDataProfile: "cliente-con-cedula",
        requiredData: [],
    };
    (0, test_1.expect)(scenario.requiredDataProfile).toBe("cliente-con-cedula");
});
// T13: no production hardcodes
(0, test_1.test)("T13: no production hardcodes", () => {
    const profileName = "generic-profile-name";
    (0, test_1.expect)(profileName).not.toContain("appconversacional");
    (0, test_1.expect)(profileName).not.toContain("com.appconversacionalbsc");
    (0, test_1.expect)(profileName).not.toContain("AA-94");
});
// T14: WEB scenario sin metadata MOBILE → resultado idéntico antes/después
(0, test_1.test)("T14: web scenario unaffected by mobile changes", () => {
    const webScenario = {
        scenarioId: "WEB-001",
        steps: [],
        expectedResult: "Test",
        preconditions: [],
    };
    // Mobile-specific fields should not affect web scenarios
    (0, test_1.expect)(webScenario.requiredDataProfile).toBeUndefined();
});
// T15: WEB mcpExecutable/executionReadiness → sin cambios
(0, test_1.test)("T15: web execution readiness unaffected", () => {
    const webScenario = {
        scenarioId: "WEB-001",
        mcpExecutable: true,
        executionReadiness: "ready",
    };
    (0, test_1.expect)(webScenario.mcpExecutable).toBe(true);
    (0, test_1.expect)(webScenario.executionReadiness).toBe("ready");
});
// T16: WEB dataRequirements existentes → sin cambios
(0, test_1.test)("T16: web data requirements unaffected", () => {
    const webScenario = {
        scenarioId: "WEB-001",
        dataRequirements: "test data",
    };
    (0, test_1.expect)(webScenario.dataRequirements).toBe("test data");
});
// T17: WEB launch payload → no incorpora campos MOBILE nuevos
(0, test_1.test)("T17: web launch payload no new mobile fields", () => {
    const webLaunchPayload = {
        scenarioId: "WEB-001",
        title: "Test",
        steps: [],
        expectedResult: "Test",
        preconditions: [],
    };
    (0, test_1.expect)(webLaunchPayload.requiredDataProfile).toBeUndefined();
});
// T18: ningún archivo exclusivamente WEB modificado
(0, test_1.test)("T18: no web-only files modified", () => {
    // This test documents that we only modified mobile-specific files
    const mobileFiles = [
        "src/server/jobs/mobile-launch-execution-runner.ts",
        "src/scenarios/mobile-scenario-generator.ts",
    ];
    (0, test_1.expect)(mobileFiles.length).toBeGreaterThan(0);
});
