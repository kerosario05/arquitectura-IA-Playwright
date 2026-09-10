import assert from "node:assert";
import { upsertFlowFirst } from "./mobile-route-learning-runner";
import type { MobileFlow, MobileRouteProfile } from "../../mobile/mobile-route-profile.types";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

function profile(flows?: Record<string, MobileFlow>): MobileRouteProfile {
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

const registro: MobileFlow = {
  description: "Registro aprendido",
  triggerKeywords: ["registro"],
  entrySteps: [{ action: "click", target: { strategy: "accessibilityId", value: "Registrarme" } }],
};

const login: MobileFlow = {
  description: "Login",
  triggerKeywords: ["login"],
  entrySteps: [{ action: "click", target: { strategy: "accessibilityId", value: "Ingresar" } }],
};

describe("upsertFlowFirst", () => {
  test("writes the learned flow first on an empty profile", () => {
    const out = upsertFlowFirst(profile(), "registro", registro);
    assert.deepStrictEqual(Object.keys(out.flows ?? {}), ["registro"]);
  });

  test("puts registro ahead of existing flows", () => {
    const out = upsertFlowFirst(profile({ login }), "registro", registro);
    assert.deepStrictEqual(Object.keys(out.flows ?? {}), ["registro", "login"], "registro must lead the file");
  });

  test("replaces an existing flow of the same id without duplicating it", () => {
    const stale: MobileFlow = { ...registro, description: "viejo" };
    const out = upsertFlowFirst(profile({ registro: stale, login }), "registro", registro);
    assert.deepStrictEqual(Object.keys(out.flows ?? {}), ["registro", "login"]);
    assert.strictEqual(out.flows!.registro.description, "Registro aprendido");
  });

  test("preserves the rest of the profile and refreshes updatedAt", () => {
    const base = profile({ login });
    const out = upsertFlowFirst(base, "registro", registro);
    assert.strictEqual(out.packageName, base.packageName);
    assert.strictEqual(out.mainActivity, base.mainActivity);
    assert.notStrictEqual(out.updatedAt, base.updatedAt, "updatedAt should advance");
    assert.strictEqual(out.flows!.login.description, "Login", "other flows survive untouched");
  });
});
