"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const case_discovery_1 = require("../src/discovery/case-discovery");
const case_discovery_2 = require("../src/discovery/case-discovery");
(0, test_1.test)("parseScenarioStepsForDiscovery preserves structured requiredContext", () => {
    const structuredContext = {
        destinationIdentity: "screen-alpha",
        routeRole: "role-alpha",
        destinationRole: "role-beta",
    };
    const parsed = (0, case_discovery_2.parseScenarioStepsForDiscovery)({
        title: "Structured assertion",
        steps: [{
                action: 'Validar que se muestre "Arbitrary Alpha"',
                index: 0,
                requiredContext: structuredContext,
            }],
    });
    (0, test_1.expect)(parsed.assertionTargets[0].requiredContext).toEqual(structuredContext);
    const textOnly = (0, case_discovery_2.parseScenarioStepsForDiscovery)({
        title: "Text only",
        steps: [{ action: 'Validar que se muestre "Arbitrary Beta"', index: 0 }],
    });
    (0, test_1.expect)(textOnly.assertionTargets[0].requiredContext).toBeUndefined();
    const legacy = (0, case_discovery_2.parseScenarioStepsForDiscovery)({
        title: "Legacy",
        steps: [{ action: 'Validar que se muestre "Arbitrary Gamma"', index: 0 }],
    });
    (0, test_1.expect)(legacy.assertionTargets[0]).toBeDefined();
    (0, test_1.expect)(legacy.assertionTargets[0].requiredContext).toBeUndefined();
});
function makeScenario(overrides = {}) {
    return {
        title: overrides.title ?? "Transferencia privada",
        steps: overrides.steps ?? [],
        preconditions: overrides.preconditions ?? "",
        raw: overrides.raw ?? {},
        authIntent: overrides.authIntent,
        ...overrides,
    };
}
test_1.test.describe("auth contract business setup", () => {
    (0, test_1.test)("auth-test decision skips proactive auth recovery while business flows preserve it", () => {
        (0, test_1.expect)((0, case_discovery_1.shouldInvokeAuthGateRecovery)(true)).toBe(false);
        (0, test_1.expect)((0, case_discovery_1.shouldInvokeAuthGateRecovery)(false)).toBe(true);
        // gate_observation remains a separate contract and is not reclassified here.
    });
    (0, test_1.test)("CASE A: negative login with authIntent full + subject authentication_test + credenciales inválidas => no preAuth", () => {
        const scenario = makeScenario({
            title: "Ingresar credenciales incorrectas",
            authIntent: "full_authentication",
            type: "authentication_test",
            automationType: "authentication_test",
            steps: [
                { action: 'Clic en "Iniciar sesion".', index: 0 },
                { action: 'Validar que se muestre "Credenciales inválidas".', index: 1 },
            ],
        });
        const parsed = {
            actionTargets: [{ target: "Iniciar sesion", index: 0 }],
            assertionTargets: [{ target: "Credenciales inválidas" }],
        };
        // Authoritative subject signals should dominate over heuristic (assertion not login label but auth-related)
        (0, test_1.expect)((0, case_discovery_1.isAuthenticationTestScenario)(scenario, parsed)).toBe(true);
        (0, test_1.expect)((0, case_discovery_1.shouldPerformBusinessFlowAuthSetup)(scenario, parsed)).toBe(false);
    });
    (0, test_1.test)("CASE B: business_flow with login + Transferencias => preAuth true, login consumed", () => {
        const scenario = makeScenario({
            title: "Transferencia a cuenta propia",
            authIntent: "full_authentication",
            type: "transactional",
            functionalBranch: { actionIntent: "transfer", branchId: "transferencias" },
            steps: [
                { action: 'Clic en "Iniciar sesion".', index: 0 },
                { action: 'Clic en "Transferencias".', index: 1 },
                { action: 'Clic en "Cuentas Propias".', index: 2 },
            ],
        });
        const parsed = {
            actionTargets: [
                { target: "Iniciar sesion", index: 0, actionIntent: "authentication", targetRole: "authentication" },
                { target: "Transferencias", index: 1 },
                { target: "Cuentas Propias", index: 2 },
            ],
            assertionTargets: [{ target: "Transferencias" }],
        };
        (0, test_1.expect)((0, case_discovery_1.isAuthenticationTestScenario)(scenario, parsed)).toBe(false);
        (0, test_1.expect)((0, case_discovery_1.shouldPerformBusinessFlowAuthSetup)(scenario, parsed)).toBe(true);
        const consumed = (0, case_discovery_1.getLoginStepsToConsume)(parsed);
        (0, test_1.expect)(consumed.has(0)).toBe(true);
        (0, test_1.expect)(consumed.has(1)).toBe(false);
    });
    (0, test_1.test)("CASE C: gate_observation preserved", () => {
        const scenario = makeScenario({
            title: "Observar gate de autenticación",
            authIntent: "gate_observation",
            steps: [{ action: 'Validar que se muestre "Iniciar sesion".', index: 0 }],
        });
        const parsed = { actionTargets: [], assertionTargets: [{ target: "Iniciar sesion" }] };
        (0, test_1.expect)((0, case_discovery_1.shouldPerformBusinessFlowAuthSetup)(scenario, parsed)).toBe(false);
        (0, test_1.expect)((0, case_discovery_1.isAuthenticationTestScenario)(scenario, parsed)).toBe(false);
    });
    (0, test_1.test)("CASE D: no structured metadata does not classify authentication test", () => {
        const scenario = makeScenario({
            title: "Titulo generico sin metadata",
            authIntent: "full_authentication",
            steps: [{ action: 'Clic en "Iniciar sesion".', index: 0 }],
        });
        const parsed = {
            actionTargets: [{ target: "Iniciar sesion", index: 0 }],
            assertionTargets: [],
        };
        (0, test_1.expect)((0, case_discovery_1.isAuthenticationTestScenario)(scenario, parsed)).toBe(false);
        (0, test_1.expect)((0, case_discovery_1.shouldPerformBusinessFlowAuthSetup)(scenario, parsed)).toBe(true);
    });
    (0, test_1.test)("TEST4: project isolation variant A vs B", () => {
        const slugA = "auth-variant-a-test";
        const slugB = "auth-variant-b-test";
        const dirA = node_path_1.default.join(process.cwd(), "automations", "apps", slugA);
        const dirB = node_path_1.default.join(process.cwd(), "automations", "apps", slugB);
        node_fs_1.default.mkdirSync(dirA, { recursive: true });
        node_fs_1.default.mkdirSync(dirB, { recursive: true });
        const cfgA = {
            name: "A",
            baseUrl: "https://a.example/",
            authProfiles: { custom: { variant: "variant-a", loginMode: "password" } },
            authProfile: "custom",
        };
        const cfgB = {
            name: "B",
            baseUrl: "https://b.example/",
            authProfiles: { custom: { variant: "variant-b", accountType: "business" } },
            authProfile: "custom",
        };
        node_fs_1.default.writeFileSync(node_path_1.default.join(dirA, "app.config.json"), JSON.stringify(cfgA, null, 2));
        node_fs_1.default.writeFileSync(node_path_1.default.join(dirB, "app.config.json"), JSON.stringify(cfgB, null, 2));
        try {
            const resA = (0, case_discovery_1.loadProjectAuthProfile)(slugA);
            const resB = (0, case_discovery_1.loadProjectAuthProfile)(slugB);
            (0, test_1.expect)(resA.source).toBe("app_config");
            (0, test_1.expect)(resB.source).toBe("app_config");
            (0, test_1.expect)(resA.profile.variant).toBe("variant-a");
            (0, test_1.expect)(resB.profile.variant).toBe("variant-b");
            (0, test_1.expect)(resA.profile.variant).not.toBe(resB.profile.variant);
        }
        finally {
            node_fs_1.default.rmSync(dirA, { recursive: true, force: true });
            node_fs_1.default.rmSync(dirB, { recursive: true, force: true });
        }
    });
});
