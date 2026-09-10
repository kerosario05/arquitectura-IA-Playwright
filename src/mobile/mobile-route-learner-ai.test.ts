import assert from "node:assert";
import { decideNextActionInterpreted, type InterpretiveContext } from "./mobile-route-learner-ai";
import { findActionableControls } from "./mobile-route-learner";
import { extractMobileScreenSnapshot, type MobileScreenSnapshot } from "./mobile-knowledge-extractor";
import type { AiProvider, AiCompletionRequest } from "../ai/ai-provider.types";

function test(label: string, fn: () => Promise<void>): void {
  promises.push(
    fn().then(
      () => console.log(`  PASS  ${label}`),
      (err) => {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      },
    ),
  );
}

const promises: Promise<void>[] = [];

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

const PKG = "com.appconversacionalbsc";

function node(attrs: Record<string, string>): string {
  const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
  return `<android.view.ViewGroup ${a} />`;
}

/**
 * The app's real welcome screen: a login form (user + password) plus the control that leaves
 * it towards registration. This is the screen the walk used to get stuck on.
 */
const BIENVENIDO_XML =
  `<?xml version="1.0" encoding="UTF-8"?><hierarchy>` +
  [
    `<android.widget.TextView package="${PKG}" class="android.widget.TextView" text="Bienvenido" displayed="true" clickable="false" />`,
    `<android.widget.EditText package="${PKG}" class="android.widget.EditText" text="example@gmail.com" displayed="true" clickable="true" />`,
    `<android.widget.EditText package="${PKG}" class="android.widget.EditText" text="Contraseña" displayed="true" clickable="true" />`,
    node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Acceso biométrico", clickable: "true", enabled: "true", displayed: "true" }),
    node({ package: PKG, class: "android.view.ViewGroup", "content-desc": ", ¿Primera vez aquí?, Crea tu cuenta en minutos, ", clickable: "true", enabled: "true", displayed: "true" }),
  ].join("") +
  `</hierarchy>`;

const snapshot = extractMobileScreenSnapshot(BIENVENIDO_XML);

/** The catalog index the layer will show the AI for a given control label. */
function indexOfControl(snap: MobileScreenSnapshot, labelPart: string): number {
  const i = findActionableControls(snap, PKG).findIndex((a) => a.label.includes(labelPart));
  assert.ok(i >= 0, `fixture must expose an actionable control matching "${labelPart}"`);
  return i;
}

/** Records what the layer asked, and answers with a canned JSON payload. */
function fakeAi(reply: Record<string, unknown>): { provider: AiProvider; seen: AiCompletionRequest[] } {
  const seen: AiCompletionRequest[] = [];
  return {
    seen,
    provider: {
      providerType: "openai" as AiProvider["providerType"],
      providerName: "fake",
      model: "fake-model",
      async completeJson(request: AiCompletionRequest) {
        seen.push(request);
        return {
          rawText: JSON.stringify(reply),
          parsedJson: reply,
          model: "fake-model",
          providerName: "fake",
          durationMs: 0,
        };
      },
    },
  };
}

const HU_REGISTRO: InterpretiveContext["huContext"] = {
  issueKey: "AA-93",
  summary: "Registro de nuevo cliente desde la app",
  intent: "El cliente sin cuenta se registra ingresando su cédula",
};

describe("decideNextActionInterpreted on a form screen (needs_input)", () => {
  test("asks the AI instead of blindly filling the form", async () => {
    const { provider, seen } = fakeAi({ action: "tap", controlIndex: 0 });
    await decideNextActionInterpreted(snapshot, { appPackage: PKG }, { ai: provider, huContext: HU_REGISTRO });
    assert.strictEqual(seen.length, 1, "the AI must be consulted on a needs_input stop");
    const prompt = seen[0].messages.map((m) => m.content).join("\n");
    assert.ok(prompt.includes("Registro de nuevo cliente"), "the HU objective must reach the prompt");
    assert.ok(prompt.includes("Crea tu cuenta en minutos"), "the way out of the form must be offered");
    assert.ok(prompt.includes('"fill"'), "fill must be offered as an answer on a form screen");
  });

  test("a registration story leaves the login screen instead of typing credentials", async () => {
    const { provider } = fakeAi({ action: "tap", controlIndex: indexOfControl(snapshot, "Crea tu cuenta en minutos") });
    const d = await decideNextActionInterpreted(snapshot, { appPackage: PKG }, { ai: provider, huContext: HU_REGISTRO });
    assert.strictEqual(d.kind, "advance");
    assert.ok(
      d.kind === "advance" && d.target.value.includes("Crea tu cuenta en minutos"),
      `expected the sign-up control, got ${d.kind === "advance" ? d.target.value : "(stop)"}`,
    );
  });

  test("when the form IS the objective, the fill path is handed back untouched", async () => {
    const { provider } = fakeAi({ action: "fill", reason: "el formulario pertenece al objetivo" });
    const d = await decideNextActionInterpreted(snapshot, { appPackage: PKG }, { ai: provider, huContext: HU_REGISTRO });
    assert.strictEqual(d.kind, "stop");
    assert.strictEqual(d.kind === "stop" && d.reason, "needs_input", "the runner's fill path must still run");
  });

  test("an AI stop on a form falls back to filling rather than ending the walk", async () => {
    const { provider } = fakeAi({ action: "stop", reason: "nada acerca al objetivo" });
    const d = await decideNextActionInterpreted(snapshot, { appPackage: PKG }, { ai: provider, huContext: HU_REGISTRO });
    assert.strictEqual(d.kind === "stop" && d.reason, "needs_input");
  });

  test("never presses a control that commits the flow", async () => {
    const commitXml =
      `<?xml version="1.0" encoding="UTF-8"?><hierarchy>` +
      `<android.widget.EditText package="${PKG}" class="android.widget.EditText" text="Cédula" displayed="true" clickable="true" />` +
      node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Registrarme", clickable: "true", enabled: "true", displayed: "true" }) +
      `</hierarchy>`;
    const commitSnap = extractMobileScreenSnapshot(commitXml);
    const { provider } = fakeAi({ action: "tap", controlIndex: indexOfControl(commitSnap, "Registrarme") });
    const d = await decideNextActionInterpreted(commitSnap, { appPackage: PKG }, { ai: provider, huContext: HU_REGISTRO });
    assert.notStrictEqual(d.kind, "advance", "the submit guard must outrank the AI's choice");
  });

  test("without an AI provider the rule-based decision is unchanged", async () => {
    const d = await decideNextActionInterpreted(snapshot, { appPackage: PKG }, {} as InterpretiveContext);
    assert.strictEqual(d.kind === "stop" && d.reason, "needs_input");
  });
});

// No top-level await: this file is transpiled to CJS.
void Promise.all(promises).then(() => {
  console.log(`\n${promises.length} checks, ${process.exitCode ? "FAILED" : "all passed"}`);
});

// ── deriveTriggerKeywords ────────────────────────────────────────────────────
import { deriveTriggerKeywords } from "../server/jobs/mobile-route-learning-runner";

function syncTest(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

describe("deriveTriggerKeywords", () => {
  syncTest("an issue key alone is replaced by the story's own words", () => {
    const kws = deriveTriggerKeywords(["AA-93"], HU_REGISTRO, "aa-93");
    assert.ok(!kws.includes("AA-93"), "the Jira key can never appear in scenario text");
    assert.ok(kws.includes("registro"), `expected "registro" among ${JSON.stringify(kws)}`);
  });

  syncTest("real keywords from the caller are kept as given", () => {
    const kws = deriveTriggerKeywords(["registro", "crea tu cuenta"], HU_REGISTRO, "aa-93");
    assert.deepStrictEqual(kws, ["registro", "crea tu cuenta"]);
  });

  syncTest("generic words are dropped so unrelated stories are not hijacked", () => {
    const kws = deriveTriggerKeywords(["AA-93"], HU_REGISTRO, "aa-93");
    assert.ok(!kws.includes("cliente"), `"cliente" is too generic: ${JSON.stringify(kws)}`);
  });

  syncTest("an issue-key flowId is never used as a last-resort keyword", () => {
    assert.deepStrictEqual(deriveTriggerKeywords([], undefined, "AA-93"), []);
  });

  syncTest("a meaningful flowId still serves as the last resort", () => {
    assert.deepStrictEqual(deriveTriggerKeywords(undefined, undefined, "registro"), ["registro"]);
  });
});

// ── buildLearnedScreens ──────────────────────────────────────────────────────
import { buildLearnedScreens } from "../server/jobs/mobile-route-learning-runner";

describe("buildLearnedScreens", () => {
  const docXml =
    `<?xml version="1.0" encoding="UTF-8"?><hierarchy>` +
    node({ package: PKG, class: "android.view.ViewGroup", "content-desc": ", Cédula", clickable: "true", enabled: "true", displayed: "true" }) +
    `<android.widget.EditText package="${PKG}" class="android.widget.EditText" text="402-12345678-9" displayed="true" clickable="true" />` +
    `</hierarchy>`;

  syncTest("publishes the locator the learner derived, not the bare label", () => {
    const screens = buildLearnedScreens([extractMobileScreenSnapshot(docXml)], PKG, "2026-01-01T00:00:00Z");
    const els = Object.values(screens).flatMap((s) => s.elements);
    const cedula = els.find((e) => e.label.includes("Cédula"));
    assert.ok(cedula, `no se publicó el control Cédula: ${JSON.stringify(els.map((e) => e.label))}`);
    assert.notStrictEqual(cedula!.locator?.value, "Cédula", "publicar la etiqueta pelada es justo lo que la IA inventaba");
    assert.ok(
      cedula!.locator?.value.includes("Cédula"),
      `el locator debe anclar en la identidad observada: ${JSON.stringify(cedula!.locator)}`,
    );
  });

  syncTest("publishes inputs with their positional locator", () => {
    const screens = buildLearnedScreens([extractMobileScreenSnapshot(docXml)], PKG, "2026-01-01T00:00:00Z");
    const input = Object.values(screens).flatMap((s) => s.elements).find((e) => e.role === "input");
    assert.ok(input, "el campo de documento debe publicarse");
    assert.ok(input!.locator?.value.includes("EditText"), JSON.stringify(input!.locator));
  });

  syncTest("distinct screens sharing a screenKey do not overwrite each other", () => {
    const otherXml =
      `<?xml version="1.0" encoding="UTF-8"?><hierarchy>` +
      node({ package: PKG, class: "android.view.ViewGroup", "content-desc": "Continuar", clickable: "true", enabled: "true", displayed: "true" }) +
      `</hierarchy>`;
    const screens = buildLearnedScreens(
      [extractMobileScreenSnapshot(docXml), extractMobileScreenSnapshot(otherXml)],
      PKG,
      "2026-01-01T00:00:00Z",
    );
    assert.strictEqual(Object.keys(screens).length, 2, `se colapsaron: ${JSON.stringify(Object.keys(screens))}`);
  });

  syncTest("the same screen seen twice is captured once", () => {
    const screens = buildLearnedScreens(
      [extractMobileScreenSnapshot(docXml), extractMobileScreenSnapshot(docXml)],
      PKG,
      "2026-01-01T00:00:00Z",
    );
    assert.strictEqual(Object.keys(screens).length, 1, JSON.stringify(Object.keys(screens)));
  });
});

// ── fieldAlreadyHolds ────────────────────────────────────────────────────────
import { fieldAlreadyHolds } from "../server/jobs/mobile-route-learning-runner";

describe("fieldAlreadyHolds", () => {
  syncTest("a masked rendering of the typed value counts as already present", () => {
    // The app displays "40229993734" back as "402-2999373-4"; retyping it duplicated the step.
    assert.strictEqual(fieldAlreadyHolds({ label: "402-2999373-4", value: "40229993734" }), true);
    assert.strictEqual(fieldAlreadyHolds({ label: "402-2999373-4", value: "402-2999373-4" }), true);
  });

  syncTest("a different value is still typed", () => {
    assert.strictEqual(fieldAlreadyHolds({ label: "402-2999373-4", value: "12345678901" }), false);
  });

  syncTest("a placeholder is not mistaken for content", () => {
    assert.strictEqual(fieldAlreadyHolds({ label: "402-12345678-9", value: "40229993734" }), false);
  });

  syncTest("an OTP is never considered already present", () => {
    assert.strictEqual(fieldAlreadyHolds({ label: "123456", value: "123456", otp: true }), false);
  });

  syncTest("an empty intended value is never skipped", () => {
    assert.strictEqual(fieldAlreadyHolds({ label: "", value: "" }), false);
  });
});

// ── allowSubmitLabels ────────────────────────────────────────────────────────
import { isBlockedSubmitLabel, isAllowedSubmit } from "./mobile-route-learner";

describe("allowSubmitLabels", () => {
  syncTest("a submit stays blocked when nothing was allowed", () => {
    assert.strictEqual(isBlockedSubmitLabel("Enviar código de validación"), true);
    assert.strictEqual(isBlockedSubmitLabel("Registrarme"), true);
  });

  syncTest("only the named control is unblocked", () => {
    const allow = ["Enviar código de validación"];
    assert.strictEqual(isBlockedSubmitLabel("Enviar código de validación", allow), false);
    assert.strictEqual(isBlockedSubmitLabel("Registrarme", allow), true, "el resto del guard sigue en pie");
  });

  syncTest("matching ignores accents and case", () => {
    assert.strictEqual(isAllowedSubmit("ENVIAR CODIGO DE VALIDACION", ["Enviar código de validación"]), true);
  });

  syncTest("a non-submit label is never reported as blocked", () => {
    assert.strictEqual(isBlockedSubmitLabel("Continuar", ["Enviar código de validación"]), false);
  });
});
