import assert from "node:assert";
import { decideNextAction, isSubmitLabel, findInputControls, findActionableControls, resolveScreenData } from "./mobile-route-learner";
import { extractMobileScreenSnapshot } from "./mobile-knowledge-extractor";

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

const PKG = "com.appconversacionalbsc";

function node(attrs: Record<string, string>): string {
  const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
  return `<android.view.ViewGroup ${a} />`;
}

function xml(children: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><hierarchy>${children}</hierarchy>`;
}

/** Real shape captured from the app's welcome screen during route learning. */
const BIENVENIDO_XML = xml(
  [
    `<android.widget.TextView package="${PKG}" class="android.widget.TextView" text="Bienvenido" displayed="true" clickable="false" />`,
    `<android.widget.EditText package="${PKG}" class="android.widget.EditText" text="example@gmail.com" displayed="true" clickable="true" />`,
    node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Iniciar sesión", clickable: "false", enabled: "false", displayed: "true" }),
    node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Acceso biométrico", clickable: "true", enabled: "true", displayed: "true" }),
    node({ package: PKG, class: "android.view.ViewGroup", "content-desc": ", ¿Primera vez aquí?, Crea tu cuenta en minutos, ", clickable: "true", enabled: "true", displayed: "true" }),
  ].join(""),
);

describe("isSubmitLabel", () => {
  test("recognizes commit controls", () => {
    for (const l of ["Registrarme", "Crear cuenta", "Finalizar", "Confirmar", "Enviar", "Transferir"]) {
      assert.ok(isSubmitLabel(l), `should be submit: ${l}`);
    }
  });
  test("does not treat advance controls as commits", () => {
    for (const l of ["Continuar", "Siguiente", "Entendido", "Volver"]) {
      assert.ok(!isSubmitLabel(l), `should NOT be submit: ${l}`);
    }
  });
});

describe("decideNextAction on the real welcome screen", () => {
  const snap = extractMobileScreenSnapshot(BIENVENIDO_XML);

  test("detects the email input and refuses to invent data", () => {
    const inputs = findInputControls(snap, PKG);
    assert.ok(inputs.length >= 1, "should see the EditText");
    const d = decideNextAction(snap, { appPackage: PKG });
    assert.strictEqual(d.kind, "stop");
    assert.strictEqual((d as any).reason, "needs_input");
  });
});

describe("decideNextAction policy", () => {
  test("advances a screen whose only action is Continuar", () => {
    const snap = extractMobileScreenSnapshot(
      xml(
        `<android.widget.TextView package="${PKG}" class="android.widget.TextView" text="Ya casi terminamos" displayed="true" clickable="false" />` +
          node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Continuar", clickable: "true", enabled: "true", displayed: "true" }),
      ),
    );
    const d = decideNextAction(snap, { appPackage: PKG });
    assert.strictEqual(d.kind, "advance");
    assert.deepStrictEqual((d as any).target, { strategy: "accessibilityId", value: "Continuar" });
  });

  test("never presses a commit control", () => {
    const snap = extractMobileScreenSnapshot(
      xml(node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Registrarme", clickable: "true", enabled: "true", displayed: "true" })),
    );
    const d = decideNextAction(snap, { appPackage: PKG });
    assert.strictEqual(d.kind, "stop");
    assert.strictEqual((d as any).reason, "submit_guard");
  });

  test("commit guard wins even when a Continuar is also present", () => {
    const snap = extractMobileScreenSnapshot(
      xml(
        node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Continuar", clickable: "true", enabled: "true", displayed: "true" }) +
          node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Confirmar", clickable: "true", enabled: "true", displayed: "true" }),
      ),
    );
    const d = decideNextAction(snap, { appPackage: PKG });
    assert.strictEqual((d as any).reason, "submit_guard");
  });

  test("stopBeforeSubmit=false lets the walk continue past a commit screen", () => {
    const snap = extractMobileScreenSnapshot(
      xml(
        node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Continuar", clickable: "true", enabled: "true", displayed: "true" }) +
          node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Confirmar", clickable: "true", enabled: "true", displayed: "true" }),
      ),
    );
    const d = decideNextAction(snap, { appPackage: PKG, stopBeforeSubmit: false });
    assert.strictEqual(d.kind, "advance");
    assert.strictEqual((d as any).label, "Continuar");
  });

  test("stops when the choice is ambiguous", () => {
    const snap = extractMobileScreenSnapshot(
      xml(
        node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Cuenta de ahorros", clickable: "true", enabled: "true", displayed: "true" }) +
          node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Cuenta corriente", clickable: "true", enabled: "true", displayed: "true" }),
      ),
    );
    const d = decideNextAction(snap, { appPackage: PKG });
    assert.strictEqual((d as any).reason, "ambiguous_choice");
  });

  test("detects a screen that did not change", () => {
    const snap = extractMobileScreenSnapshot(
      xml(node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Continuar", clickable: "true", enabled: "true", displayed: "true" })),
    );
    const d = decideNextAction(snap, { appPackage: PKG, visitedFingerprints: new Set([snap.fingerprint]) });
    assert.strictEqual((d as any).reason, "loop_detected");
  });

  test("preferLabels steers past an input the caller does not intend to fill", () => {
    // The welcome screen has an email field, but the registration branch is entered by
    // tapping "¿Primera vez aquí?" — the walk must not stop on a field it will not use.
    const snap = extractMobileScreenSnapshot(BIENVENIDO_XML);
    const plain = decideNextAction(snap, { appPackage: PKG });
    assert.strictEqual((plain as any).reason, "needs_input", "without steering it stops");

    const steered = decideNextAction(snap, { appPackage: PKG, preferLabels: ["primera vez"] });
    assert.strictEqual(steered.kind, "advance");
    // Composite description -> whitespace-tolerant selector on its longest segment.
    assert.strictEqual((steered as any).target.strategy, "androidUiAutomator");
    assert.strictEqual(
      (steered as any).target.value,
      'new UiSelector().descriptionContains("Crea tu cuenta en minutos")',
    );
  });

  test("simple labels keep exact accessibilityId matching", () => {
    const snap = extractMobileScreenSnapshot(
      xml(node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Continuar", clickable: "true", enabled: "true", displayed: "true" })),
    );
    const d = decideNextAction(snap, { appPackage: PKG });
    assert.deepStrictEqual((d as any).target, { strategy: "accessibilityId", value: "Continuar" });
  });

  test("preferLabels never overrides the commit guard", () => {
    const snap = extractMobileScreenSnapshot(
      xml(node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Registrarme", clickable: "true", enabled: "true", displayed: "true" })),
    );
    const d = decideNextAction(snap, { appPackage: PKG, preferLabels: ["registrarme"] });
    assert.strictEqual((d as any).reason, "submit_guard", "steering must not commit the flow");
  });

  test("preferLabels that match nothing fall back to normal policy", () => {
    const snap = extractMobileScreenSnapshot(BIENVENIDO_XML);
    const d = decideNextAction(snap, { appPackage: PKG, preferLabels: ["no existe este control"] });
    assert.strictEqual((d as any).reason, "needs_input");
  });

  test("ignores controls owned by another package (System UI)", () => {
    const snap = extractMobileScreenSnapshot(
      xml(
        node({ package: "com.android.systemui", class: "android.view.ViewGroup", "content-desc": "Continuar", clickable: "true", enabled: "true", displayed: "true" }),
      ),
    );
    const actionable = findActionableControls(snap, PKG);
    assert.strictEqual(actionable.length, 0, "external controls must not drive the walk");
  });
});

/** Real shape of the identification screen reached by the learner during the walk. */
const CEDULA_XML = xml(
  [
    `<android.widget.TextView package="${PKG}" class="android.widget.TextView" text="Identifícate" displayed="true" clickable="false" />`,
    node({ package: PKG, class: "android.view.ViewGroup", "content-desc": ", Cédula", clickable: "true", enabled: "true", displayed: "true" }),
    node({ package: PKG, class: "android.view.ViewGroup", "content-desc": ", Pasaporte", clickable: "true", enabled: "true", displayed: "true" }),
    `<android.widget.EditText package="${PKG}" class="android.widget.EditText" content-desc="402-12345678-9" displayed="true" clickable="true" />`,
    node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Continuar", clickable: "true", enabled: "true", displayed: "true" }),
  ].join(""),
);

describe("resolveScreenData", () => {
  const snap = extractMobileScreenSnapshot(CEDULA_XML);

  test("a screen with no inputs resolves to no fills", () => {
    const plain = extractMobileScreenSnapshot(
      xml(node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Continuar", clickable: "true", enabled: "true", displayed: "true" })),
    );
    const r = resolveScreenData(plain, undefined, PKG);
    assert.strictEqual(r.ok, true);
    assert.strictEqual((r as any).fills.length, 0);
  });

  test("reports what is missing instead of inventing a value", () => {
    const r = resolveScreenData(snap, [], PKG);
    assert.strictEqual(r.ok, false);
    assert.ok((r as any).missing.length >= 1, "should name the unmatched field");
  });

  test("matches the document field and carries the selection to make first", () => {
    const r = resolveScreenData(
      snap,
      [{ match: "402-", value: "40229993734", selectFirst: "Cédula" }],
      PKG,
    );
    assert.strictEqual(r.ok, true);
    const fills = (r as any).fills;
    assert.strictEqual(fills.length, 1);
    assert.strictEqual(fills[0].value, "40229993734");
    assert.strictEqual(fills[0].selectFirst, "Cédula");
    assert.ok(fills[0].target, "must carry a usable locator");
  });

  test("an OTP entry defers the value to runtime instead of typing it", () => {
    const otpSnap = extractMobileScreenSnapshot(
      xml(`<android.widget.EditText package="${PKG}" class="android.widget.EditText" content-desc="Código de verificación" displayed="true" clickable="true" />`),
    );
    const r = resolveScreenData(otpSnap, [{ match: "código de verificación", otp: true }], PKG);
    assert.strictEqual(r.ok, true);
    const fills = (r as any).fills;
    assert.strictEqual(fills[0].otp, true);
    assert.strictEqual(fills[0].value, undefined, "the code is never carried in the payload");
  });

  test("matching is accent- and case-insensitive", () => {
    const otpSnap = extractMobileScreenSnapshot(
      xml(`<android.widget.EditText package="${PKG}" class="android.widget.EditText" content-desc="Código de verificación" displayed="true" clickable="true" />`),
    );
    const r = resolveScreenData(otpSnap, [{ match: "CODIGO DE VERIFICACION", otp: true }], PKG);
    assert.strictEqual(r.ok, true, "accents must not prevent the match");
  });

  test("all-or-nothing: one unmatched field aborts the whole screen", () => {
    const twoFields = extractMobileScreenSnapshot(
      xml(
        `<android.widget.EditText package="${PKG}" class="android.widget.EditText" content-desc="Documento" displayed="true" clickable="true" />` +
          `<android.widget.EditText package="${PKG}" class="android.widget.EditText" content-desc="Teléfono" displayed="true" clickable="true" />`,
      ),
    );
    const r = resolveScreenData(twoFields, [{ match: "documento", value: "123" }], PKG);
    assert.strictEqual(r.ok, false, "a half-filled form would advance into an unknown state");
    assert.ok((r as any).missing.some((m: string) => /tel/i.test(m)));
  });
});

describe("controlToTarget fallbacks", () => {
  test("a text field without content-desc or id is located by class (stable while typing)", () => {
    // Real shape: this app's EditTexts expose only their placeholder text.
    const snap = extractMobileScreenSnapshot(
      xml(`<android.widget.EditText package="${PKG}" class="android.widget.EditText" text="402-12345678-9" displayed="true" clickable="true" />`),
    );
    const r = resolveScreenData(snap, [{ match: "402-", value: "40229993734" }], PKG);
    assert.strictEqual(r.ok, true, "must not report the field as unusable");
    const target = (r as any).fills[0].target;
    assert.strictEqual(target.strategy, "androidUiAutomator");
    assert.strictEqual(
      target.value,
      'new UiSelector().className("android.widget.EditText")',
    );
  });

  test("content-desc still wins over the text fallback", () => {
    const snap = extractMobileScreenSnapshot(
      xml(`<android.widget.EditText package="${PKG}" class="android.widget.EditText" content-desc="Documento" text="402-12345678-9" displayed="true" clickable="true" />`),
    );
    const r = resolveScreenData(snap, [{ match: "documento", value: "1" }], PKG);
    assert.deepStrictEqual((r as any).fills[0].target, { strategy: "accessibilityId", value: "Documento" });
  });
});

describe("tappable controls with no technical identity", () => {
  // Real shape from the registration screen: the document-type option is exposed twice — a
  // ViewGroup carrying the content-desc, and the TextView that renders the same label.
  const DOC_TYPE_XML = xml(
    [
      `<android.widget.TextView package="${PKG}" class="android.widget.TextView" text="Otro texto" displayed="true" clickable="true" />`,
      node({ package: PKG, class: "android.view.ViewGroup", "content-desc": ", Cédula", clickable: "true", enabled: "true", displayed: "true" }),
      `<android.widget.TextView package="${PKG}" class="android.widget.TextView" text="Cédula" displayed="true" clickable="true" />`,
    ].join(""),
  );

  test("a class-only locator is anchored on the visible text, not just the class", () => {
    const snap = extractMobileScreenSnapshot(
      xml(`<android.widget.TextView package="${PKG}" class="android.widget.TextView" text="Cédula" displayed="true" clickable="true" />`),
    );
    const found = findActionableControls(snap, PKG).find((a) => a.label.includes("Cédula"));
    assert.ok(found, "the option must be actionable");
    assert.ok(
      !/^new UiSelector\(\)\.className\("[^"]+"\)$/.test(found!.target.value),
      `a bare class locator taps the first element of that class: ${found!.target.value}`,
    );
    assert.ok(found!.target.value.includes('.text("Cédula")'), found!.target.value);
  });

  test("the same label is offered once, using the control that carries the identity", () => {
    const snap = extractMobileScreenSnapshot(DOC_TYPE_XML);
    const cedula = findActionableControls(snap, PKG).filter((a) => normalizeLabelForTest(a.label) === "cedula");
    assert.strictEqual(cedula.length, 1, `expected one "Cédula" entry, got ${cedula.length}`);
    assert.strictEqual(cedula[0].target.strategy, "accessibilityId", `content-desc must win: ${JSON.stringify(cedula[0].target)}`);
  });
});

function normalizeLabelForTest(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
