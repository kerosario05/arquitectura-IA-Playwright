import assert from "node:assert";
import { extractMobileScreenSnapshot } from "./mobile-knowledge-extractor";
import { selectRelevantMobileKnowledge } from "./mobile-knowledge-resolver";

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

function node(cls: string, attrs: Record<string, string>): string {
  const all = { package: PKG, class: cls, displayed: "true", ...attrs };
  return `<${cls} ${Object.entries(all).map(([k, v]) => `${k}="${v}"`).join(" ")} />`;
}

function screen(opts: { continuarEnabled: boolean; extra?: string[] }): string {
  return [
    "<hierarchy>",
    node("android.widget.TextView", { text: "Hola Nr2rc, necesitamos que indiques y valides tus datos de contacto.", clickable: "false", heading: "true" }),
    node("android.view.ViewGroup", { "content-desc": "Enviar código de validación", clickable: "true", enabled: "true" }),
    node("android.view.ViewGroup", { "content-desc": "Continuar", clickable: "true", enabled: opts.continuarEnabled ? "true" : "false" }),
    node("android.view.ViewGroup", { "content-desc": "Salir", clickable: "true", enabled: "true" }),
    ...(opts.extra ?? []),
    "</hierarchy>",
  ].join("\n");
}

/** The contact screen before any code is sent: Continuar gated. */
const GATED = screen({ continuarEnabled: false });
/** The same screen once both codes validated: Continuar open — the observable proof of success. */
const OPEN = screen({ continuarEnabled: true });
/** The intermediate state: code sent, boxes on screen, Continuar still gated. */
const CODE_SENT = screen({
  continuarEnabled: false,
  extra: [node("android.widget.TextView", { text: "Indica el código recibido en el correo", clickable: "false" })],
});

describe("enabled state is captured", () => {
  test("records a gated submit control as disabled", () => {
    const snap = extractMobileScreenSnapshot(GATED);
    const cont = snap.observedControls.find((c) => c.label === "Continuar");
    assert.strictEqual(cont?.enabled, false);
  });

  test("records the same control as enabled once the gate opens", () => {
    const cont = extractMobileScreenSnapshot(OPEN).observedControls.find((c) => c.label === "Continuar");
    assert.strictEqual(cont?.enabled, true);
  });

  test("does not annotate plain text with an enabled flag", () => {
    const heading = extractMobileScreenSnapshot(GATED).observedControls.find((c) => c.label.startsWith("Hola"));
    assert.strictEqual(heading?.enabled, undefined);
  });
});

describe("gate state makes the two states distinguishable", () => {
  test("same screen, different gate state, different fingerprint", () => {
    assert.notStrictEqual(extractMobileScreenSnapshot(GATED).fingerprint, extractMobileScreenSnapshot(OPEN).fingerprint);
  });

  test("but the screenKey stays the same — which is exactly why keying by it lost states", () => {
    assert.strictEqual(extractMobileScreenSnapshot(GATED).screenKey, extractMobileScreenSnapshot(OPEN).screenKey);
  });

  test("a new element also yields a new state", () => {
    assert.notStrictEqual(extractMobileScreenSnapshot(GATED).fingerprint, extractMobileScreenSnapshot(CODE_SENT).fingerprint);
  });

  test("the three states of the flow are three distinct fingerprints", () => {
    const prints = new Set([GATED, CODE_SENT, OPEN].map((x) => extractMobileScreenSnapshot(x).fingerprint));
    assert.strictEqual(prints.size, 3);
  });

  test("an identical capture stays one state — no duplicates", () => {
    assert.strictEqual(extractMobileScreenSnapshot(GATED).fingerprint, extractMobileScreenSnapshot(GATED).fingerprint);
  });
});

describe("the learning file reaches the generator", () => {
  const item = (over: Record<string, unknown>) => ({
    knowledgeKind: "route_menu_snapshot",
    trustedForReuse: true,
    validationStatus: "validated",
    screenKey: "screen",
    clickTargets: ["Enviar código de validación", "Continuar", "Salir"],
    assertionTargets: ["Indica el código recibido en el correo"],
    runCount: 3,
    ...over,
  });

  test("reads the kind the persister actually writes", () => {
    const screens = selectRelevantMobileKnowledge({ items: [item({})] } as never, "código de validación correo", 5);
    assert.strictEqual(screens.length, 1);
  });

  test("items under the old name still resolve", () => {
    const screens = selectRelevantMobileKnowledge({ items: [item({ knowledgeKind: "screen_observed" })] } as never, "código de validación correo", 5);
    assert.strictEqual(screens.length, 1);
  });

  test("surfaces which controls were gated", () => {
    const screens = selectRelevantMobileKnowledge(
      {
        items: [
          item({
            observedControls: [
              { label: "Continuar", enabled: false },
              { label: "Salir", enabled: true },
            ],
          }),
        ],
      } as never,
      "código de validación correo",
      5,
    );
    assert.deepStrictEqual(screens[0].disabledTargets, ["Continuar"]);
  });

  test("no gated controls yields an empty list, not undefined", () => {
    const screens = selectRelevantMobileKnowledge({ items: [item({})] } as never, "código de validación correo", 5);
    assert.deepStrictEqual(screens[0].disabledTargets, []);
  });
});

describe("a gated control that the app renders as non-clickable", () => {
  // How this app actually paints a blocked button: enabled="false" AND clickable="false".
  // Recording `enabled` only for clickables skipped exactly this node, which is why every
  // capture came back with zero gate evidence.
  const GATED_NON_CLICKABLE = [
    "<hierarchy>",
    node("android.widget.TextView", { text: "Hola Nr2rc, valida tus datos", clickable: "false", heading: "true" }),
    node("android.view.ViewGroup", { "content-desc": "Enviar código de validación", clickable: "true", enabled: "true" }),
    node("android.view.ViewGroup", { "content-desc": "Continuar", clickable: "false", enabled: "false" }),
    "</hierarchy>",
  ].join("\n");

  const OPEN_CLICKABLE = GATED_NON_CLICKABLE
    .replace('content-desc="Continuar" clickable="false" enabled="false"', 'content-desc="Continuar" clickable="true" enabled="true"');

  test("records the disabled state even though the node is not clickable", () => {
    const cont = extractMobileScreenSnapshot(GATED_NON_CLICKABLE).observedControls.find((c) => c.label === "Continuar");
    assert.strictEqual(cont?.enabled, false);
  });

  test("that gate makes the state distinguishable from the open one", () => {
    assert.notStrictEqual(
      extractMobileScreenSnapshot(GATED_NON_CLICKABLE).fingerprint,
      extractMobileScreenSnapshot(OPEN_CLICKABLE).fingerprint,
    );
  });

  test("plain text keeps its enabled flag when the source states it", () => {
    const heading = extractMobileScreenSnapshot(GATED_NON_CLICKABLE).observedControls.find((c) => c.label.startsWith("Hola"));
    assert.strictEqual(heading?.enabled, undefined);
  });
});
