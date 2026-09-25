"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const mobile_route_learning_runner_1 = require("./mobile-route-learning-runner");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
function profile(flows) {
    return {
        appSlug: "app-conversacional",
        packageName: "com.appconversacionalbsc",
        appName: "App Conversacional",
        platform: "android",
        mainActivity: "com.appconversacionalbsc.MainActivity",
        updatedAt: "2026-01-01T00:00:00.000Z",
        screens: {},
        ...(flows ? { flows } : {}),
    };
}
const registro = {
    description: "Registro aprendido",
    triggerKeywords: ["registro"],
    entrySteps: [{ action: "click", target: { strategy: "accessibilityId", value: "Registrarme" } }],
};
const login = {
    description: "Login",
    triggerKeywords: ["login"],
    entrySteps: [{ action: "click", target: { strategy: "accessibilityId", value: "Ingresar" } }],
};
describe("upsertFlowFirst", () => {
    test("writes the learned flow first on an empty profile", () => {
        const out = (0, mobile_route_learning_runner_1.upsertFlowFirst)(profile(), "registro", registro);
        node_assert_1.default.deepStrictEqual(Object.keys(out.flows ?? {}), ["registro"]);
    });
    test("puts registro ahead of existing flows", () => {
        const out = (0, mobile_route_learning_runner_1.upsertFlowFirst)(profile({ login }), "registro", registro);
        node_assert_1.default.deepStrictEqual(Object.keys(out.flows ?? {}), ["registro", "login"], "registro must lead the file");
    });
    test("replaces an existing flow of the same id without duplicating it", () => {
        const stale = { ...registro, description: "viejo" };
        const out = (0, mobile_route_learning_runner_1.upsertFlowFirst)(profile({ registro: stale, login }), "registro", registro);
        node_assert_1.default.deepStrictEqual(Object.keys(out.flows ?? {}), ["registro", "login"]);
        node_assert_1.default.strictEqual(out.flows.registro.description, "Registro aprendido");
    });
    test("preserves the rest of the profile and refreshes updatedAt", () => {
        const base = profile({ login });
        const out = (0, mobile_route_learning_runner_1.upsertFlowFirst)(base, "registro", registro);
        node_assert_1.default.strictEqual(out.packageName, base.packageName);
        node_assert_1.default.strictEqual(out.mainActivity, base.mainActivity);
        node_assert_1.default.notStrictEqual(out.updatedAt, base.updatedAt, "updatedAt should advance");
        node_assert_1.default.strictEqual(out.flows.login.description, "Login", "other flows survive untouched");
    });
});
