import assert from "node:assert";
import { normalizeEvents, segmentTrace, summarizeTrace } from "./trace-normalizer";
import {
  buildAlternativePathScenarios,
  buildGateNegatives,
  buildHappyPathScenario,
  buildSegmentScenarios,
  capTitle,
} from "./trace-to-scenario";
import { parseNegatives } from "./trace-ai-enricher";
import { toPublishableScenario } from "./scenario-to-testrail";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

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

function ev(partial: Partial<RecordedEvent> & { kind: RecordedEvent["kind"]; t: number }): RecordedEvent {
  return {
    seq: 0,
    screenKey: "login",
    ...partial,
  } as RecordedEvent;
}

function target(label: string, value = label, extra: Record<string, unknown> = {}) {
  return { label, locators: [{ strategy: "accessibilityId", value, confidence: 0.95 }], ...extra };
}

const TRACE: SessionTrace = {
  recordingId: "aa11bb22-3333-4444-5555-666677778888",
  projectSlug: "banco-app",
  appSlug: "banco-app",
  platform: "android",
  appPackage: "com.bank.app",
  label: "Registro de usuario nuevo",
  startedAt: "2026-09-08T10:00:00.000Z",
  status: "stopped",
  events: [],
  screens: [
    { screenKey: "login", title: "Iniciar sesión", fingerprint: "f1", firstSeenAt: 0, controls: [], texts: ["Bienvenido"] },
    { screenKey: "otp", title: "Código de validación", fingerprint: "f2", firstSeenAt: 5000, controls: [], texts: ["Ingresa el código"] },
  ],
};

describe("normalizeEvents", () => {
  test("collapses a burst of per-character fills into the final value", () => {
    const out = normalizeEvents([
      ev({ kind: "fill", t: 100, target: target("Usuario"), value: "j" }),
      ev({ kind: "fill", t: 180, target: target("Usuario"), value: "ju" }),
      ev({ kind: "fill", t: 260, target: target("Usuario"), value: "juan" }),
    ]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].value, "juan");
  });

  test("keeps fills on different fields apart", () => {
    const out = normalizeEvents([
      ev({ kind: "fill", t: 100, target: target("Usuario"), value: "juan" }),
      ev({ kind: "fill", t: 200, target: target("Clave"), value: "1234" }),
    ]);
    assert.strictEqual(out.length, 2);
  });

  test("drops a digitizer double-report on the same control", () => {
    const out = normalizeEvents([
      ev({ kind: "tap", t: 1000, target: target("Ingresar") }),
      ev({ kind: "tap", t: 1120, target: target("Ingresar") }),
    ]);
    assert.strictEqual(out.length, 1);
  });

  test("keeps a deliberate second press outside the debounce window", () => {
    const out = normalizeEvents([
      ev({ kind: "tap", t: 1000, target: target("Ingresar") }),
      ev({ kind: "tap", t: 3000, target: target("Ingresar") }),
    ]);
    assert.strictEqual(out.length, 2);
  });

  test("discards a screen_change that did not change the screen", () => {
    const out = normalizeEvents([
      ev({ kind: "screen_change", t: 500, screenKey: "login", toScreenKey: "login" }),
      ev({ kind: "screen_change", t: 900, screenKey: "login", toScreenKey: "otp" }),
    ]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].toScreenKey, "otp");
  });

  test("demotes an unlocatable tap to a note instead of a step", () => {
    const out = normalizeEvents([
      ev({ kind: "tap", t: 100, target: { label: "Bienvenido", locators: [] } }),
    ]);
    assert.strictEqual(out[0].kind, "note");
    assert.match(out[0].note ?? "", /Bienvenido/);
  });

  test("renumbers the surviving events contiguously", () => {
    const out = normalizeEvents([
      ev({ kind: "tap", t: 1000, target: target("A") }),
      ev({ kind: "tap", t: 1100, target: target("A") }),
      ev({ kind: "tap", t: 5000, target: target("B") }),
    ]);
    assert.deepStrictEqual(out.map((e) => e.seq), [0, 1]);
  });
});

describe("segmentTrace", () => {
  const events = normalizeEvents([
    ev({ kind: "fill", t: 100, screenKey: "login", target: target("Usuario"), value: "juan" }),
    ev({ kind: "tap", t: 900, screenKey: "login", target: target("Ingresar") }),
    ev({ kind: "screen_change", t: 1500, screenKey: "login", toScreenKey: "otp" }),
    ev({ kind: "fill", t: 4000, screenKey: "otp", target: target("Código"), value: "123456" }),
  ]);

  test("groups events by the screen they happened on", () => {
    const segments = segmentTrace(events, TRACE);
    assert.strictEqual(segments.length, 2);
    assert.strictEqual(segments[0].screenKey, "login");
    assert.strictEqual(segments[0].events.length, 3);
    assert.strictEqual(segments[1].screenKey, "otp");
  });

  test("records where a segment exits to", () => {
    const segments = segmentTrace(events, TRACE);
    assert.strictEqual(segments[0].exitsTo, "otp");
  });

  test("resolves the human title of each screen", () => {
    const segments = segmentTrace(events, TRACE);
    assert.strictEqual(segments[0].title, "Iniciar sesión");
  });
});

describe("buildHappyPathScenario", () => {
  const events = normalizeEvents([
    ev({ kind: "fill", t: 100, screenKey: "login", target: target("Usuario"), value: "juan" }),
    ev({ kind: "tap", t: 900, screenKey: "login", target: target("Ingresar") }),
    ev({ kind: "screen_change", t: 1500, screenKey: "login", toScreenKey: "otp" }),
  ]);
  const scenario = buildHappyPathScenario(TRACE, events);

  test("opens the app before anything else", () => {
    assert.strictEqual(scenario.mobileSteps[0].action, "launchApp");
  });

  test("emits an executable step per real action, in order", () => {
    const actions = scenario.mobileSteps.map((s) => s.action);
    assert.deepStrictEqual(actions, ["launchApp", "fill", "click", "assertVisible"]);
  });

  test("carries the recorded locator into the step", () => {
    const fill = scenario.mobileSteps.find((s) => s.action === "fill");
    assert.deepStrictEqual(fill?.target, { strategy: "accessibilityId", value: "Usuario" });
    assert.strictEqual(fill?.value, "juan");
  });

  test("asserts the destination screen on every transition, not only at the end", () => {
    const assertion = scenario.mobileSteps.find((s) => s.action === "assertVisible");
    assert.match(assertion?.description ?? "", /Código de validación/);
  });

  test("exposes each typed field as editable required data", () => {
    assert.strictEqual(scenario.requiredData.length, 1);
    assert.strictEqual(scenario.requiredData[0].key, "usuario");
    assert.strictEqual(scenario.requiredData[0].exampleValue, "juan");
    assert.strictEqual(scenario.requiredData[0].sensitive, false);
  });

  test("never puts a redacted value in the TestRail step text", () => {
    const redacted = normalizeEvents([
      ev({ kind: "fill", t: 100, target: target("Clave"), redactedKey: "clave" }),
    ]);
    const s = buildHappyPathScenario(TRACE, redacted);
    const stepText = s.testRailSteps.map((x) => x.content).join(" ");
    assert.ok(!stepText.includes("undefined"));
    assert.match(stepText, /Ingresar clave en "Clave"/);
    assert.strictEqual(s.requiredData[0].sensitive, true);
    assert.strictEqual(s.requiredData[0].exampleValue, undefined);
  });

  test("uses the recording label as the scenario title", () => {
    assert.strictEqual(scenario.title, "Registro de usuario nuevo");
  });

  test("produces TestRail steps with an expectation for each action", () => {
    assert.ok(scenario.testRailSteps.length >= 4);
    assert.ok(scenario.testRailSteps.every((s) => s.expected.trim().length > 0));
  });

  test("builds web plan steps instead of mobile ones for a web recording", () => {
    const webTrace: SessionTrace = { ...TRACE, platform: "web", baseUrl: "https://app.test", appPackage: undefined };
    const s = buildHappyPathScenario(webTrace, events);
    assert.strictEqual(s.mobileSteps.length, 0);
    assert.strictEqual(s.webSteps[0].action, "navigate");
    assert.strictEqual(s.webSteps[0].value, "https://app.test");
  });
});

describe("buildGateNegatives", () => {
  const events = normalizeEvents([
    ev({ kind: "tap", t: 100, screenKey: "login", target: target("Usuario") }),
    ev({ kind: "tap", t: 900, screenKey: "login", target: target("Continuar", "Continuar", { enabled: false }) }),
  ]);
  const happy = buildHappyPathScenario(TRACE, events);
  const negatives = buildGateNegatives(TRACE, segmentTrace(events, TRACE), happy);

  test("derives one negative per control observed disabled", () => {
    assert.strictEqual(negatives.length, 1);
    assert.match(negatives[0].title, /Continuar/);
    assert.strictEqual(negatives[0].kind, "negative");
  });

  test("expects the gate to hold rather than the flow to advance", () => {
    const last = negatives[0].testRailSteps[negatives[0].testRailSteps.length - 1];
    assert.match(last.expected, /permanece deshabilitado/);
  });

  test("invents nothing when the recording saw no gate", () => {
    const clean = normalizeEvents([ev({ kind: "tap", t: 100, target: target("Ingresar") })]);
    const h = buildHappyPathScenario(TRACE, clean);
    assert.deepStrictEqual(buildGateNegatives(TRACE, segmentTrace(clean, TRACE), h), []);
  });
});

describe("summarizeTrace", () => {
  test("counts actions, transitions and unusable taps separately", () => {
    const events = normalizeEvents([
      ev({ kind: "fill", t: 100, target: target("Usuario"), value: "juan" }),
      ev({ kind: "tap", t: 900, target: target("Ingresar") }),
      ev({ kind: "screen_change", t: 1500, screenKey: "login", toScreenKey: "otp" }),
      ev({ kind: "tap", t: 2000, target: { label: "", locators: [] } }),
    ]);
    const stats = summarizeTrace(events, TRACE);
    assert.strictEqual(stats.actions, 2);
    assert.strictEqual(stats.transitions, 1);
    assert.strictEqual(stats.unidentified, 1);
    assert.strictEqual(stats.screens, 2);
  });
});

// A two-screen walkthrough: the user identifies themselves, the app moves to the OTP screen,
// and they submit the code there.
const MULTI_SCREEN_EVENTS = normalizeEvents([
  ev({ kind: "fill", t: 100, screenKey: "login", target: target("Usuario"), value: "juan" }),
  ev({ kind: "tap", t: 900, screenKey: "login", target: target("Ingresar") }),
  ev({ kind: "screen_change", t: 1500, screenKey: "login", toScreenKey: "otp" }),
  ev({ kind: "fill", t: 6000, screenKey: "otp", target: target("Código"), value: "123456", redactedKey: "codigo" }),
  ev({ kind: "tap", t: 7000, screenKey: "otp", target: target("Validar") }),
]);

describe("buildSegmentScenarios", () => {
  const segments = segmentTrace(MULTI_SCREEN_EVENTS, TRACE);
  const happyPath = buildHappyPathScenario(TRACE, MULTI_SCREEN_EVENTS);
  const scenarios = buildSegmentScenarios(TRACE, MULTI_SCREEN_EVENTS, segments, happyPath);

  test("emits one scenario per block, excluding the last (that is the end-to-end run)", () => {
    assert.strictEqual(scenarios.length, 1);
    assert.strictEqual(scenarios[0].scope, "segment");
  });

  test("a block scenario is executable on its own: it keeps the steps that reach it", () => {
    const actions = scenarios[0].mobileSteps.map((s) => s.action);
    assert.deepStrictEqual(actions, ["launchApp", "fill", "click", "assertVisible"]);
  });

  test("every step of a block scenario was actually walked", () => {
    assert.strictEqual(scenarios[0].provenance, "observed");
  });

  test("stops short of the full flow, so it is not the end-to-end case renamed", () => {
    assert.ok(scenarios[0].testRailSteps.length < happyPath.testRailSteps.length);
  });

  test("a single-screen recording produces no block scenarios", () => {
    const single = normalizeEvents([ev({ kind: "tap", t: 100, screenKey: "login", target: target("Ingresar") })]);
    const path = buildHappyPathScenario(TRACE, single);
    assert.deepStrictEqual(buildSegmentScenarios(TRACE, single, segmentTrace(single, TRACE), path), []);
  });
});

describe("buildAlternativePathScenarios", () => {
  // The login screen offered three controls; the walkthrough only pressed "Ingresar".
  const TRACE_WITH_CONTROLS: SessionTrace = {
    ...TRACE,
    screens: [
      {
        ...TRACE.screens[0],
        controls: [
          { label: "Ingresar", role: "button", locators: [{ strategy: "accessibilityId", value: "Ingresar" }] },
          { label: "Crear cuenta", role: "button", locators: [{ strategy: "accessibilityId", value: "Crear cuenta" }] },
          { label: "Olvidé mi clave", role: "button", locators: [{ strategy: "accessibilityId", value: "Olvidé mi clave" }] },
          { label: "Continuar", role: "button", enabled: false, locators: [{ strategy: "accessibilityId", value: "Continuar" }] },
        ],
      },
      TRACE.screens[1],
    ],
  };
  const happyPath = buildHappyPathScenario(TRACE_WITH_CONTROLS, MULTI_SCREEN_EVENTS);
  const scenarios = buildAlternativePathScenarios(TRACE_WITH_CONTROLS, MULTI_SCREEN_EVENTS, happyPath);

  test("proposes the controls the walkthrough saw but never pressed", () => {
    assert.deepStrictEqual(
      scenarios.map((s) => s.title),
      ["Desde Iniciar sesión: Crear cuenta", "Desde Iniciar sesión: Olvidé mi clave"],
    );
  });

  test("skips a disabled control — that is a gate, not an alternative path", () => {
    assert.ok(!scenarios.some((s) => s.title.includes("Continuar")));
  });

  test("ends on the untaken control, reached by the steps that were walked", () => {
    const steps = scenarios[0].mobileSteps;
    assert.strictEqual(steps[0].action, "launchApp");
    assert.strictEqual(steps[steps.length - 1].action, "click");
    assert.deepStrictEqual(steps[steps.length - 1].target, {
      strategy: "accessibilityId",
      value: "Crear cuenta",
    });
  });

  test("is marked derived and leaves its expected result open", () => {
    assert.strictEqual(scenarios[0].provenance, "derived");
    assert.strictEqual(scenarios[0].hasUncertainSteps, true);
    assert.match(scenarios[0].testRailSteps[scenarios[0].testRailSteps.length - 1].expected, /Por confirmar/);
  });
});

describe("parseNegatives", () => {
  const transcript = 'Pantalla 1: Iniciar sesión\n  - El usuario presionó "Enviar código de validación"\n  Textos visibles: Continuar';

  test("keeps a negative anchored on something the recording saw", () => {
    const kept = parseNegatives(
      [{ title: "Código incorrecto", basedOn: "Enviar código de validación", steps: [{ content: "x", expected: "y" }] }],
      transcript,
    );
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(kept[0].basedOn, "Enviar código de validación");
  });

  test("matches the anchor regardless of case and accents", () => {
    const kept = parseNegatives(
      [{ title: "n", basedOn: "ENVIAR CODIGO DE VALIDACION", steps: [{ content: "x", expected: "y" }] }],
      transcript,
    );
    assert.strictEqual(kept.length, 1);
  });

  test("discards a case invented around a control that is not there", () => {
    const kept = parseNegatives(
      [{ title: "Reenviar", basedOn: "Reenviar código", steps: [{ content: "x", expected: "y" }] }],
      transcript,
    );
    assert.deepStrictEqual(kept, []);
  });

  test("discards a negative with no anchor at all", () => {
    const kept = parseNegatives([{ title: "n", steps: [{ content: "x", expected: "y" }] }], transcript);
    assert.deepStrictEqual(kept, []);
  });
});

describe("stepTargets", () => {
  const events = normalizeEvents([
    ev({ kind: "fill", t: 100, screenKey: "login", target: target("Usuario"), value: "juan" }),
    ev({
      kind: "tap",
      t: 900,
      screenKey: "login",
      target: {
        label: "Enviar código de validación",
        locators: [
          {
            strategy: "androidUiAutomator",
            value: 'new UiSelector().description("Enviar código de validación").instance(1)',
            confidence: 0.5,
            ambiguous: true,
            matchIndex: 1,
          },
        ],
      },
    }),
  ]);
  const scenario = buildHappyPathScenario(TRACE, events);

  test("exposes the locator behind each executable step", () => {
    assert.deepStrictEqual(
      scenario.stepTargets.map((t) => [t.description, t.strategy]),
      [['Ingresar "juan" en "Usuario"', "accessibilityId"], ['Presionar "Enviar código de validación"', "androidUiAutomator"]],
    );
  });

  test("points at the step it belongs to", () => {
    const tap = scenario.stepTargets[1];
    assert.strictEqual(scenario.mobileSteps[tap.stepIndex].action, "click");
    assert.strictEqual(scenario.mobileSteps[tap.stepIndex].target?.value, tap.value);
  });

  test("carries the ambiguity forward so a reviewer sees it", () => {
    assert.strictEqual(scenario.stepTargets[1].ambiguous, true);
    assert.strictEqual(scenario.hasUncertainSteps, true);
  });
});

describe("capTitle", () => {
  test("deja intacto un título normal", () => {
    assert.strictEqual(capTitle("Validar datos de contacto"), "Validar datos de contacto");
  });

  // Lo que rechazó TestRail: ":title es demasiado largo (250 caracteres como máximo)".
  test("recorta al límite que acepta TestRail", () => {
    const long = `Desde Pantalla: ${"etiqueta muy larga ".repeat(30)}`;
    const capped = capTitle(long);
    assert.ok(capped.length <= 250);
    assert.ok(capped.endsWith("…"));
  });

  test("colapsa espacios para que el recorte no corte en un hueco", () => {
    assert.strictEqual(capTitle("  Dos   espacios  "), "Dos espacios");
  });
});

describe("toPublishableScenario", () => {
  const scenario = buildHappyPathScenario(TRACE, MULTI_SCREEN_EVENTS);
  const publishable = toPublishableScenario(scenario, "banco-app", "aaccdbc7-1111-2222-3333-444455556666");

  test("conserva el resultado esperado de cada paso dentro del texto", () => {
    assert.ok(publishable.steps[0].includes("Esperado: La aplicación carga su pantalla inicial"));
  });

  test("usa la última expectativa como resultado global del caso", () => {
    const last = scenario.testRailSteps[scenario.testRailSteps.length - 1].expected;
    assert.strictEqual(publishable.expectedResult, last);
  });

  test("enlaza el caso con la grabación que lo originó", () => {
    assert.strictEqual(publishable.sourceIssueKey, "REC-AACCDBC7");
    assert.strictEqual(publishable.appSlug, "banco-app");
  });

  test("un escenario derivado no se marca como ejecutable", () => {
    const derived = { ...scenario, provenance: "derived" as const };
    assert.strictEqual(toPublishableScenario(derived, "banco-app", "aaccdbc7").mcpExecutable, false);
    assert.strictEqual(publishable.mcpExecutable, true);
  });
});
