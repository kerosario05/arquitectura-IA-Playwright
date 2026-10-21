import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTrace } from "./session-trace.types";
import { buildHappyPathScenario } from "./trace-to-scenario";

/**
 * FIRST_LOSS (display layer): `buildHappyPathScenario`'s raw testRailSteps builder has a
 * `if (!target.locators?.length) { ... }` branch that only ever handled the selection-compound
 * and fill event shapes -- a plain click (`event.kind === "tap"`, never a selection, never a
 * fill) whose target had zero locators (e.g. a genuinely icon-only button CaptureEngine V2 could
 * not turn into a reliable locator) fell through both branches and silently produced NO
 * testRailStep at all, truncating the visible scenario right after whatever preceded it -- even
 * though `buildCanonicalInteractions` (a separate function, unaffected by this gap) still
 * produced a real `CanonicalInteraction` for it.
 *
 * Fixed by adding the missing branch: a plain click always becomes a step now, using a REAL
 * accessible name when one exists, the certified field-relation wording when it does not, or the
 * pre-existing honest neutral fallback ("Presionar el control indicado") when neither exists.
 * RAW TECHNICAL ACTION != DISPLAY LABEL: the field relation is only ever referenced as an
 * association ("Presionar botón asociado a…"), never fabricated as the button's own name.
 */

function target(label: string, value = label, extra: Record<string, unknown> = {}) {
  return { label, role: "button", locators: [{ strategy: "role", value, confidence: 0.95 }], ...extra };
}

function fixture(overrides: Partial<SessionTrace> = {}): SessionTrace {
  return {
    recordingId: "unnamed-button-display-fixture",
    projectSlug: "unnamed-button-display-fixture",
    appSlug: "unnamed-button-display-fixture",
    platform: "web",
    baseUrl: "https://app.test/login",
    label: "Registrar cliente",
    recordingGoal: { declaredGoal: "Registrar cliente", normalizedGoal: "registrar cliente", provenance: "USER_DECLARED", needsReview: false },
    recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: false },
    startedAt: "2026-09-14T10:00:00.000Z",
    status: "stopped",
    events: [],
    screens: [
      { screenKey: "login", title: "Login", fingerprint: "login", firstSeenAt: 0, controls: [], texts: ["Login"] },
      { screenKey: "home", title: "Cliente creado", fingerprint: "home", firstSeenAt: 300, controls: [], texts: ["Cliente creado"] },
    ],
    ...overrides,
  } as SessionTrace;
}

test("2/canonical + 3/contract precondition: the fill+unnamed-icon-button-click fixture produces TWO testRailSteps, not one", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "fill", screenKey: "login", target: { label: "Número de identificación", associatedField: "Número de identificación", role: "textbox", locators: [{ strategy: "data-testid", value: "doc-input" }] }, value: "12345" },
      { seq: 2, t: 200, kind: "tap", screenKey: "login", target: { label: "", role: "button", locators: [], associatedField: "Número de identificación" } },
    ] as SessionTrace["events"],
  });
  const scenario = buildHappyPathScenario(trace, trace.events);
  // `buildHappyPathScenario` prepends its own fixed setup row ("Abrir la aplicación..."), so
  // the two recorded events add two MORE steps on top of it.
  assert.equal(scenario.testRailSteps.length, 3, "the click must survive as its own visible step");
});

test("7/unnamedButton. no accessible name, real field relation -> neutral field-associated wording, never a fabricated accessible name", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "fill", screenKey: "login", target: { label: "Número de identificación", associatedField: "Número de identificación", role: "textbox", locators: [{ strategy: "data-testid", value: "doc-input" }] }, value: "12345" },
      { seq: 2, t: 200, kind: "tap", screenKey: "login", target: { label: "", role: "button", locators: [], associatedField: "Número de identificación" } },
    ] as SessionTrace["events"],
  });
  const scenario = buildHappyPathScenario(trace, trace.events);
  const clickStep = scenario.testRailSteps.at(-1)!;
  assert.equal(clickStep.content, 'Presionar botón asociado a "Número de identificación"');
});

/**
 * FIRST_LOSS (confirmed against a real recording's persisted trace): `target.label` is NEVER
 * actually empty for a real capture -- every capture path (CaptureEngine V2's adapter, the
 * legacy recorder) defaults it to the literal sentinel "control" when no real accessible name
 * exists (`label: action.identity.label ?? action.identity.name ?? action.identity.text ??
 * "control"`). The prior fixture above used an unrealistic empty string ("") for "no accessible
 * name", which never exercises this path -- a REAL icon-only button's captured label is
 * literally the string "control", and checking its mere truthiness took the "real name" branch
 * and rendered the sentinel itself ('Presionar "control"') as if it were the button's own name.
 */
test("7b/realCaptureShape. a REAL capture's generic label sentinel (\"control\", never empty) still falls through to the field-associated wording, never rendered as a fake accessible name", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "fill", screenKey: "login", target: { label: "control", associatedField: "Número de identificación", role: "input", locators: [] }, value: "12345" },
      { seq: 2, t: 200, kind: "tap", screenKey: "login", target: { label: "control", role: "button", locators: [], associatedField: "Número de identificación" } },
    ] as SessionTrace["events"],
  });
  const scenario = buildHappyPathScenario(trace, trace.events);
  const clickStep = scenario.testRailSteps.at(-1)!;
  assert.equal(clickStep.content, 'Presionar botón asociado a "Número de identificación"');
  assert.notEqual(clickStep.content, 'Presionar "control"', "the generic sentinel must never be rendered as if it were a real button name");
});

test("6/namedButton. a real aria-label wins over the field relation -- display uses the real name", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "fill", screenKey: "login", target: { label: "Buscador", associatedField: "Buscador", role: "textbox", locators: [{ strategy: "data-testid", value: "search-input" }] }, value: "abc" },
      { seq: 2, t: 200, kind: "tap", screenKey: "login", target: { label: "Buscar", role: "button", locators: [], associatedField: "Buscador" } },
    ] as SessionTrace["events"],
  });
  const scenario = buildHappyPathScenario(trace, trace.events);
  const clickStep = scenario.testRailSteps.at(-1)!;
  assert.equal(clickStep.content, 'Presionar "Buscar"');
});

test("no accessible name AND no field relation -> the pre-existing honest neutral fallback, never invented text", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "tap", screenKey: "login", target: { label: "", role: "button", locators: [] } },
    ] as SessionTrace["events"],
  });
  const scenario = buildHappyPathScenario(trace, trace.events);
  assert.equal(scenario.testRailSteps.at(-1)?.content, "Presionar el control indicado");
});

test("dynamic person labels render as a generic action and retain only the stable locator", () => {
  const trace = fixture({
    events: [{
      seq: 1,
      t: 100,
      kind: "tap",
      screenKey: "home",
      target: {
        label: "Ana Maria Perez",
        associatedField: "Ana Maria Perez",
        role: "div",
        tag: "div",
        attributes: { id: "profile-name" },
        locators: [
          { strategy: "text", value: "Ana Maria Perez", confidence: 0.55 },
          { strategy: "id", value: "profile-name", confidence: 0.8 },
        ],
        interactionType: "click",
        actionability: "NATIVE_ACTIONABLE",
        actionOwner: true,
        playwrightRecorderEvidence: { kind: "text", normalizedName: "ana maria perez", runtimeResolutionRequired: true },
      },
    }] as SessionTrace["events"],
  });

  const scenario = buildHappyPathScenario(trace, trace.events);
  const clickStep = scenario.testRailSteps.at(-1)!;
  const webStep = scenario.webSteps.at(-1)!;
  assert.equal(clickStep.content, "Presionar el control grabado");
  assert.deepEqual(webStep.target, { strategy: "id", value: "profile-name" });
  assert.equal(webStep.valueKey, undefined);
  assert.equal(scenario.canonicalInteractions?.at(-1)?.semanticField, undefined);
});

test("dynamic numeric labels are not emitted as text selectors", () => {
  const trace = fixture({
    events: [{
      seq: 1,
      t: 100,
      kind: "tap",
      screenKey: "home",
      target: {
        label: "4111 1111 1111 1111",
        role: "button",
        tag: "button",
        locators: [{ strategy: "text", value: "4111 1111 1111 1111", confidence: 0.55 }],
        interactionType: "click",
        actionability: "NATIVE_ACTIONABLE",
        actionOwner: true,
      },
    }] as SessionTrace["events"],
  });

  const scenario = buildHappyPathScenario(trace, trace.events);
  const clickStep = scenario.testRailSteps.at(-1)!;
  const webStep = scenario.webSteps.at(-1)!;
  assert.equal(clickStep.content, "Presionar el control indicado");
  assert.equal(webStep.target, undefined);
  assert.equal(scenario.canonicalInteractions?.at(-1)?.admissionReason, "dynamic_label_without_stable_target");
});

test("a static structural click keeps its accessible name so recording actions remain distinguishable", () => {
  const trace = fixture({
    events: [{
      seq: 1,
      t: 100,
      kind: "tap",
      screenKey: "login",
      target: {
        label: "Empresarial",
        role: "link",
        tag: "a",
        locators: [{ strategy: "role", value: "link|Empresarial", confidence: 0.85 }],
        interactionType: "click",
        actionability: "NATIVE_ACTIONABLE",
        actionOwner: true,
        technicalTargetCandidates: [{
          targetType: "structural",
          locatorCandidates: [{ strategy: "role", value: "link|Empresarial", confidence: 0.85 }],
          structuralContext: {
            owner: { tag: "a" },
            stableDirectAttributes: { href: "#empresarial" },
            deterministicStructuralIdentity: true,
            identityAmbiguous: false,
          },
          interactionEvidence: ["v2_click_owner"],
          confidence: 0.85,
          validatedByInteraction: true,
        }],
      },
    }] as SessionTrace["events"],
  });

  const scenario = buildHappyPathScenario(trace, trace.events);
  assert.equal(scenario.testRailSteps.at(-1)?.content, 'Presionar "Empresarial"');
  assert.deepEqual(scenario.webSteps.at(-1)?.target, { strategy: "role", value: "link|Empresarial" });
});

test("5/noFakeName. a generic-shaped associatedField ('control') is never used as the field-associated wording either", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "tap", screenKey: "login", target: { label: "", role: "button", locators: [], associatedField: "control" } },
    ] as SessionTrace["events"],
  });
  const scenario = buildHappyPathScenario(trace, trace.events);
  assert.equal(scenario.testRailSteps.at(-1)?.content, "Presionar el control indicado");
});

test("10/clickRegression. a normally-locatable click (has its own locator) is unaffected -- still goes through the existing tap branch, not this new fallback", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "tap", screenKey: "login", target: target("Continuar", "continuar") },
    ] as SessionTrace["events"],
  });
  const scenario = buildHappyPathScenario(trace, trace.events);
  assert.equal(scenario.testRailSteps.at(-1)?.content, 'Presionar "Continuar"');
});

test("14/generic. no app/project/field hardcode -- an arbitrary associatedField renders the same neutral template", () => {
  for (const field of ["Cualquier campo", "Otro campo distinto"]) {
    const trace = fixture({
      events: [{ seq: 1, t: 100, kind: "tap", screenKey: "login", target: { label: "", role: "button", locators: [], associatedField: field } }] as SessionTrace["events"],
    });
    const scenario = buildHappyPathScenario(trace, trace.events);
    assert.equal(scenario.testRailSteps.at(-1)?.content, `Presionar botón asociado a "${field}"`);
  }
});

/**
 * FIRST_LOSS fix (fresh run d3fa4d58-06b3-4053-bebb-2a8d31d7c951, interaction-15 "Tarjeta
 * Crédito Visa Clásica"): this branch already produced a testRailStep for a locator-less plain
 * click, but never a webStep/stepTarget -- so the step silently had no plan.json/spec
 * representation and vanished from every consumer reading `webSteps`, even though
 * `buildCanonicalInteractions` still tracked it as a real, execution-authoritative interaction.
 */
test("15/webStepParity. a locator-less plain click still produces a webStep (target-less, bound by interactionId) alongside its testRailStep", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "tap", screenKey: "login", target: { label: "", role: "button", locators: [], associatedField: "Tarjeta Crédito Visa Clásica" } },
    ] as SessionTrace["events"],
  });
  const scenario = buildHappyPathScenario(trace, trace.events);
  const clickWebStep = scenario.webSteps.at(-1);
  assert.ok(clickWebStep, "a webStep must exist for this click");
  assert.equal(clickWebStep!.action, "click");
  assert.equal(clickWebStep!.target, undefined, "no locator was ever captured -- never fabricate one");
  assert.equal(clickWebStep!.interactionId, "interaction-1");
  assert.equal(clickWebStep!.description, 'Presionar botón asociado a "Tarjeta Crédito Visa Clásica"');
});

test("16/mobileUnaffected. the same locator-less click on a mobile trace still produces no webStep (mobile uses its own mobileSteps list)", () => {
  const trace = fixture({
    platform: "android",
    events: [
      { seq: 1, t: 100, kind: "tap", screenKey: "login", target: { label: "", role: "button", locators: [], associatedField: "Campo móvil" } },
    ] as SessionTrace["events"],
  });
  const scenario = buildHappyPathScenario(trace, trace.events);
  assert.equal(scenario.webSteps.length, 0);
});

test("17/reusableStructuralClick. stable structural owners hide captured personal labels", () => {
  const dynamicLabel = "Person 123@example.test";
  const trace = fixture({
    events: [{
      seq: 1, t: 100, kind: "tap", screenKey: "login",
      target: {
        label: dynamicLabel, tag: "div", locators: [],
        technicalTargetCandidates: [{
          targetType: "structural", locatorCandidates: [],
          structuralContext: {
            owner: { tag: "div" }, stableDirectAttributes: { id: "profile-menu" },
            stableDescendants: [], semanticShape: ["div"],
            deterministicStructuralIdentity: true, structuralIdentityMatchCount: 1,
          },
          interactionEvidence: ["v2_click_owner"], confidence: 0.6, validatedByInteraction: true,
        }],
      },
    }] as SessionTrace["events"],
  });
  const scenario = buildHappyPathScenario(trace, trace.events);
  const step = scenario.testRailSteps.at(-1)!;
  const webStep = scenario.webSteps.at(-1)!;
  assert.equal(step.content, "Presionar el control grabado");
  assert.equal(webStep.description, "Presionar el control grabado");
  assert.equal(webStep.target, undefined);
  assert.equal(webStep.interactionId, "interaction-1");
  assert.ok(!step.content.includes(dynamicLabel));
});

test("checkbox owner and backing input from one captured gesture produce one named, idempotent scenario action", () => {
  const checkboxScope = { strategy: "id", value: "consent-owner" };
  const candidate = (tag: string, id: string) => ({
    targetType: "structural",
    locatorCandidates: [{ strategy: "css", value: `#${id}`, confidence: 0.8 }],
    structuralContext: {
      owner: { tag, ...(tag === "span" ? { role: "checkbox" } : {}) },
      stableDirectAttributes: { id },
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
      scopeIdentity: checkboxScope,
      captureTargetMatchCount: 1,
    },
    interactionEvidence: ["v2_click_owner"],
    confidence: 0.85,
    validatedByInteraction: true,
  });
  const events = [
    {
      seq: 10,
      t: 100,
      kind: "tap",
      screenKey: "consent",
      url: "/accounts",
      target: {
        label: "control",
        role: "checkbox",
        stateDelta: { checked: true },
        afterState: { selected: true },
        locators: [{ strategy: "role", value: "checkbox|Acepto los términos" }, { strategy: "css", value: "#base-ui-checkbox" }],
        technicalTargetCandidates: [candidate("span", "base-ui-checkbox")],
        playwrightRecorderEvidence: {
          kind: "role",
          role: "checkbox",
          normalizedName: "Acepto los términos y condiciones de la aplicación",
          targetTag: "span",
          scopeIdentity: checkboxScope,
          runtimeResolutionRequired: true,
        },
      },
    },
    {
      seq: 11,
      t: 110,
      kind: "tap",
      screenKey: "consent",
      url: "/accounts",
      target: {
        label: "AtrásContinuar",
        associatedField: "AtrásContinuar",
        role: "checkbox",
        stateDelta: { checked: true },
        afterState: { selected: true },
        locators: [{ strategy: "css", value: "#x_AcceptTermsAndConditions" }],
        technicalTargetCandidates: [candidate("input", "x_AcceptTermsAndConditions")],
      },
    },
  ] as SessionTrace["events"];
  const recording = fixture({ events });
  const scenario = buildHappyPathScenario(recording, events);
  const checkboxSteps = scenario.testRailSteps.filter((step) => /^(?:Marcar|Desmarcar) /.test(step.content));
  const replayActions = scenario.webSteps.filter((step) => step.interactionId);

  assert.equal(checkboxSteps.length, 1, "the visual checkbox owner and hidden input must not create two human steps");
  assert.match(checkboxSteps[0].content, /Acepto los términos y condiciones/);
  assert.equal(replayActions.length, 1, "one recorded checkbox gesture must replay once, not toggle back off");
  assert.deepEqual(scenario.canonicalInteractions?.find((item) => item.action === "check")?.sourceEventRefs, ["event-1", "event-2"]);

  const differentScopeEvents = structuredClone(events);
  differentScopeEvents[1].target!.technicalTargetCandidates![0].structuralContext!.scopeIdentity = {
    strategy: "id",
    value: "different-checkbox-owner",
  };
  const differentScopeScenario = buildHappyPathScenario(fixture({ events: differentScopeEvents }), differentScopeEvents);
  assert.equal(differentScopeScenario.canonicalInteractions?.filter((item) => item.action === "check").length, 2,
    "checkboxes in different captured scopes must stay separate");

  const checkThenUncheckEvents = structuredClone(events);
  checkThenUncheckEvents[1].target!.stateDelta = { checked: false };
  checkThenUncheckEvents[1].target!.afterState = { selected: false };
  const checkThenUncheckScenario = buildHappyPathScenario(fixture({ events: checkThenUncheckEvents }), checkThenUncheckEvents);
  assert.deepEqual(checkThenUncheckScenario.canonicalInteractions?.map((item) => item.action), ["check", "uncheck"],
    "a real resulting-state change must not be collapsed");
});

test("long checkbox names produce concise human steps while exact replay identity and source remain intact", () => {
  for (const label of [
    `Acepto los Términos y Condiciones de la Aplicación Móvil. ${"Texto legal asociado a esta casilla. ".repeat(25)}`,
    `Enable notifications for this workspace. ${"Detailed notification policy for the selected control. ".repeat(20)}`,
  ]) {
    const event = {seq: 1, t: 100, kind: "tap", screenKey: "login", target: {
      label: "control", role: "checkbox", stateDelta: {checked: true}, afterState: {selected: true},
      locators: [{strategy: "role", value: `checkbox|${label}`, confidence: 0.95}],
      playwrightRecorderEvidence: {kind: "role", role: "checkbox", normalizedName: label, targetTag: "input", runtimeResolutionRequired: true},
    }} as SessionTrace["events"][number];
    const trace = fixture({events: [event]});
    const before = JSON.stringify(trace);
    const scenario = buildHappyPathScenario(trace, trace.events);
    const content = scenario.testRailSteps.at(-1)!.content;
    assert.ok(content.length <= 106);
    assert.equal(content, label.startsWith("Acepto") ? 'Marcar "Acepto los Términos y Condiciones"' : 'Marcar "Enable notifications"');
    assert.equal(scenario.webSteps.at(-1)!.description, content);
    assert.equal((scenario.webSteps.at(-1)!.target as {value: string}).value, `checkbox|${label}`);
    assert.equal(scenario.stepTargets.at(-1)!.value, `checkbox|${label}`);
    assert.equal(scenario.canonicalInteractions?.find(item => item.action === "check")?.playwrightRecorderEvidence?.normalizedName, label);
    assert.equal(JSON.stringify(trace), before);
  }
});
