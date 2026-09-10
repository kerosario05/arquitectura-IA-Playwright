import assert from "node:assert";
import {
  isContinueLabel,
  isPassthroughScreen,
  buildPassthroughStep,
  withPassthroughSteps,
  normalizeLabel,
} from "./mobile-passthrough-screen";
import type { MobileElement, MobileScreen, MobileStepHint } from "./mobile-route-profile.types";

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

function el(partial: Partial<MobileElement> & { label: string; role: MobileElement["role"] }): MobileElement {
  return {
    locator: { strategy: "accessibilityId", value: partial.label },
    ...partial,
  } as MobileElement;
}

function screen(title: string, elements: MobileElement[]): MobileScreen {
  return {
    screenId: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    elements,
    discoveredAt: "2026-09-02T00:00:00.000Z",
    discoverySource: "automated_discovery",
  };
}

describe("normalizeLabel / isContinueLabel", () => {
  test("strips accents and case", () => {
    assert.strictEqual(normalizeLabel("Continúa!"), "continua");
    assert.strictEqual(normalizeLabel("  SIGUIENTE  "), "siguiente");
  });

  test("recognizes accented and cased continue labels", () => {
    for (const label of ["Continuar", "continúa", "SIGUIENTE", "Entendido", "Comenzar", "Next"]) {
      assert.ok(isContinueLabel(label), `should match: ${label}`);
    }
  });

  test("does not match unrelated labels", () => {
    for (const label of ["Cancelar", "Volver", "Cerrar sesión", "Reintentar", ""]) {
      assert.ok(!isContinueLabel(label), `should not match: ${label}`);
    }
  });

  test("does not match a label that merely contains the word inside another", () => {
    assert.ok(!isContinueLabel("discontinuar servicio"));
  });
});

describe("isPassthroughScreen", () => {
  test("single Continuar button qualifies", () => {
    const s = screen("Bienvenido", [
      el({ label: "Te damos la bienvenida", role: "text", locator: undefined }),
      el({ label: "Continuar", role: "button" }),
    ]);
    assert.ok(isPassthroughScreen(s));
  });

  test("a screen with an input does NOT qualify", () => {
    const s = screen("Identificación", [
      el({ label: "Número de documento", role: "input" }),
      el({ label: "Continuar", role: "button" }),
    ]);
    assert.ok(!isPassthroughScreen(s), "an input means a real decision");
  });

  test("a screen with a toggle does NOT qualify", () => {
    const s = screen("Términos", [
      el({ label: "Acepto los términos", role: "toggle" }),
      el({ label: "Continuar", role: "button" }),
    ]);
    assert.ok(!isPassthroughScreen(s), "a consent toggle must be handled explicitly");
  });

  test("two actionable buttons do NOT qualify", () => {
    const s = screen("Confirmación", [
      el({ label: "Continuar", role: "button" }),
      el({ label: "Cancelar", role: "button" }),
    ]);
    assert.ok(!isPassthroughScreen(s), "two options mean the user chooses");
  });

  test("a gated Continuar does NOT qualify", () => {
    const s = screen("Resumen", [
      el({ label: "Continuar", role: "button", gated: true, enabledWhen: ["scroll al final"] }),
    ]);
    assert.ok(!isPassthroughScreen(s), "gated control needs its gate satisfied first");
  });

  test("a single non-continue button does NOT qualify", () => {
    const s = screen("Error", [el({ label: "Reintentar", role: "button" })]);
    assert.ok(!isPassthroughScreen(s));
  });

  test("text-only screen (no actionable control) does NOT qualify", () => {
    const s = screen("Cargando", [el({ label: "Espere", role: "text", locator: undefined })]);
    assert.ok(!isPassthroughScreen(s));
  });
});

describe("buildPassthroughStep", () => {
  test("builds the click on the advance control", () => {
    const s = screen("Casi listo", [
      el({ label: "Ya casi terminamos", role: "text", locator: undefined }),
      el({ label: "Continuar", role: "button", locator: { strategy: "accessibilityId", value: "btn-continuar" } }),
    ]);
    const step = buildPassthroughStep(s);
    assert.ok(step);
    assert.strictEqual(step!.action, "click");
    assert.deepStrictEqual(step!.target, { strategy: "accessibilityId", value: "btn-continuar" });
    assert.match(step!.description ?? "", /Casi listo/);
  });

  test("returns null for a non-passthrough screen", () => {
    const s = screen("Login", [el({ label: "Usuario", role: "input" }), el({ label: "Continuar", role: "button" })]);
    assert.strictEqual(buildPassthroughStep(s), null);
  });
});

describe("withPassthroughSteps", () => {
  test("appends the advance for each passthrough screen crossed", () => {
    const entry: MobileStepHint[] = [
      { action: "click", target: { strategy: "accessibilityId", value: "Registrarme" } },
    ];
    const screens = [
      screen("Bienvenida", [el({ label: "Continuar", role: "button", locator: { strategy: "accessibilityId", value: "c1" } })]),
      screen("Aviso legal", [el({ label: "Entendido", role: "button", locator: { strategy: "accessibilityId", value: "c2" } })]),
    ];
    const out = withPassthroughSteps(entry, screens);
    assert.strictEqual(out.length, 3);
    assert.deepStrictEqual(out.map((s) => s.target?.value), ["Registrarme", "c1", "c2"]);
  });

  test("does not duplicate a control the flow already handles explicitly", () => {
    const entry: MobileStepHint[] = [
      { action: "click", target: { strategy: "accessibilityId", value: "c1" } },
    ];
    const screens = [
      screen("Bienvenida", [el({ label: "Continuar", role: "button", locator: { strategy: "accessibilityId", value: "c1" } })]),
    ];
    const out = withPassthroughSteps(entry, screens);
    assert.strictEqual(out.length, 1, "explicit step wins over the inferred advance");
  });

  test("ignores screens that are not passthrough", () => {
    const entry: MobileStepHint[] = [];
    const screens = [screen("Identificación", [el({ label: "Documento", role: "input" }), el({ label: "Continuar", role: "button" })])];
    assert.strictEqual(withPassthroughSteps(entry, screens).length, 0);
  });
});

describe("consent rows are not advance controls", () => {
  test("a long consent sentence is never treated as Continuar", () => {
    // Regression: "acepto" used to be an advance label matched by prefix, so a walk tapped
    // the terms checkbox row instead of the real button and never left the screen.
    const consent = ", Acepto los Términos y condiciones y la Política de datos personales";
    assert.ok(!isContinueLabel(consent), "consent row must not read as an advance control");
  });

  test("punctuation around a real advance label is still tolerated", () => {
    assert.ok(isContinueLabel(", Continuar"));
    assert.ok(isContinueLabel("Continuar "));
  });

  test("a sentence merely starting with an advance verb is not a button", () => {
    assert.ok(!isContinueLabel("Continuar significa que aceptas el contrato"));
  });
});
