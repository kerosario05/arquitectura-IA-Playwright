import type { MobileStep, MobileStepTarget, MobileLocatorStrategy } from "../mobile/mobile-step-types";
import type {
  RecordedLocator,
  RecordedEvent,
  RecordedScreen,
  SessionTrace,
  TraceSegment,
} from "./session-trace.types";

/**
 * Builds executable scenarios from a recorded walkthrough — deterministically.
 *
 * This runs BEFORE any AI pass and produces a scenario on its own. That ordering is the
 * point: the happy path is not something to infer, it is literally what the human did, so it
 * must never depend on a model being reachable or on a prompt behaving. The AI layer that
 * runs afterwards only adds what genuinely requires judgement — the story the flow tells,
 * better wording, and the negative variants.
 */

/** A step in the web execution plan (`plan.json`), which the promoter turns into a spec. */
export type RecordedWebStep = {
  action: "navigate" | "click" | "fill" | "assert" | "wait";
  target?: { strategy: string; value: string };
  value?: string;
  description: string;
};

export type RecordedScenarioStep = { content: string; expected: string };

/**
 * The identifier each executable step will act on, flattened for review.
 *
 * The step types belong to the executors and carry only `{strategy, value}`, which is all a
 * runner needs but not enough for a person deciding whether to trust the script: a locator
 * pinned to a position looks exactly like a solid one until you know it was pinned. This is
 * the recorder's own view of the same steps, so the reviewer sees what will be automated
 * before it is.
 */
export type RecordedStepTarget = {
  /** Position of the step within the scenario's executable steps. */
  stepIndex: number;
  description: string;
  strategy: string;
  value: string;
  /** The element's identity did not single it out; this locator rests on its position. */
  ambiguous?: boolean;
};

export type RecordedDataField = {
  key: string;
  label: string;
  /** Index of the step in this scenario the value feeds. */
  stepIndex: number;
  exampleValue?: string;
  sensitive: boolean;
};

export type RecordedScenario = {
  scenarioId: string;
  title: string;
  /** The user story the walkthrough implies, reconstructed rather than read from Jira. */
  description: string;
  preconditions: string[];
  kind: "happy_path" | "negative";
  /**
   * Whether the walkthrough actually performed these steps.
   *
   * `observed` means every step was executed by the person being recorded, so the scenario
   * can be run back as-is. `derived` means the recording justifies the case but never walked
   * it — a control seen but not pressed, a gate seen but not forced — so its expected result
   * is a proposal a reviewer has to confirm before it is executed.
   */
  provenance: "observed" | "derived";
  /** `segment` scenarios cover the flow up to the end of one screen block, not the whole run. */
  scope?: "end_to_end" | "segment";
  /** Android execution steps. Empty for web recordings. */
  mobileSteps: MobileStep[];
  /** Web plan steps. Empty for Android recordings. */
  webSteps: RecordedWebStep[];
  /** Human-readable steps for TestRail (`custom_steps_separated`). */
  testRailSteps: RecordedScenarioStep[];
  requiredData: RecordedDataField[];
  /** The locator behind each executable step, for review before automating. */
  stepTargets: RecordedStepTarget[];
  /** Where each step came from, so a reviewer can trust or challenge it. */
  sourceRecordingId: string;
  /** True when at least one step rests on a fallback hit-test rather than a real locator. */
  hasUncertainSteps: boolean;
};

const MOBILE_STRATEGIES = new Set<MobileLocatorStrategy>([
  "accessibilityId",
  "id",
  "xpath",
  "androidUiAutomator",
  "className",
]);

function toMobileTarget(event: RecordedEvent): MobileStepTarget | undefined {
  const locator = event.target?.locators?.[0];
  if (!locator) return undefined;
  if (!MOBILE_STRATEGIES.has(locator.strategy as MobileLocatorStrategy)) return undefined;
  return { strategy: locator.strategy as MobileLocatorStrategy, value: locator.value };
}

function slugifyKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "campo";
}

/**
 * The text that proves the app landed where the walkthrough went next.
 *
 * A screen's title is the strongest single assertion available, but a title that is only the
 * screen's internal key proves nothing to a reader, so a real visible text is preferred when
 * the title is not one.
 */
function assertionTextFor(screen: RecordedScreen | undefined): string | undefined {
  if (!screen) return undefined;
  const title = screen.title?.trim();
  if (title && title !== screen.screenKey && title.length > 2) return title;
  return screen.texts.find((t) => t.trim().length > 3)?.trim();
}

function describeTap(event: RecordedEvent): string {
  const label = event.target?.label?.trim();
  return label ? `Presionar "${label}"` : "Presionar el control indicado";
}

function describeFill(event: RecordedEvent): string {
  const label = event.target?.label?.trim() || "el campo";
  return event.redactedKey
    ? `Ingresar ${event.redactedKey} en "${label}"`
    : `Ingresar "${event.value ?? ""}" en "${label}"`;
}

export type BuildScenarioOptions = {
  /** Title for the derived happy path. Defaults to the recording label or the last screen. */
  title?: string;
  scenarioIdPrefix?: string;
};

/**
 * Converts the normalized walkthrough into one happy-path scenario.
 *
 * Assertions are inserted at every screen transition rather than only at the end: a recording
 * of a five-screen flow that only asserts the final screen passes even when the app took a
 * completely different route to get there, which is exactly the failure a recorded test is
 * supposed to catch.
 */
export function buildHappyPathScenario(
  trace: SessionTrace,
  events: readonly RecordedEvent[],
  options: BuildScenarioOptions = {},
): RecordedScenario {
  const screenById = new Map(trace.screens.map((s) => [s.screenKey, s]));
  const mobileSteps: MobileStep[] = [];
  const webSteps: RecordedWebStep[] = [];
  const testRailSteps: RecordedScenarioStep[] = [];
  const requiredData: RecordedDataField[] = [];
  const stepTargets: RecordedStepTarget[] = [];
  let hasUncertainSteps = false;

  const isMobile = trace.platform === "android";

  if (isMobile) {
    mobileSteps.push({
      action: "launchApp",
      description: `Abrir la aplicación ${trace.appPackage ?? trace.appSlug}`,
    });
  } else if (trace.baseUrl) {
    webSteps.push({
      action: "navigate",
      value: trace.baseUrl,
      description: `Navegar a ${trace.baseUrl}`,
    });
  }
  testRailSteps.push({
    content: isMobile
      ? `Abrir la aplicación ${trace.appSlug}`
      : `Navegar a ${trace.baseUrl ?? "la aplicación"}`,
    expected: "La aplicación carga su pantalla inicial",
  });

  for (const event of events) {
    if (event.kind === "note" || event.kind === "launch") continue;

    if (event.kind === "screen_change") {
      const destination = screenById.get(event.toScreenKey ?? "");
      const text = assertionTextFor(destination);
      if (!text) continue;
      if (isMobile) {
        mobileSteps.push({
          action: "assertVisible",
          target: { strategy: "androidUiAutomator", value: `new UiSelector().textContains("${text.replace(/"/g, '\\"')}")` },
          description: `Verificar que se muestra "${text}"`,
        });
      } else {
        webSteps.push({
          action: "assert",
          target: { strategy: "text", value: text },
          description: `Verificar que se muestra "${text}"`,
        });
      }
      testRailSteps.push({
        content: `El sistema navega a "${destination?.title ?? text}"`,
        expected: `Se muestra "${text}"`,
      });
      continue;
    }

    const target = event.target;
    if (!target?.locators?.length) continue;
    // Ambiguous is checked on its own and not left to the confidence it carries: a locator
    // pinned to a position is executable but positional, and a reviewer has to see that even
    // if the confidence scale is ever retuned.
    const best = target.locators[0];
    if (best.ambiguous || (best.confidence !== undefined && best.confidence < 0.7)) {
      hasUncertainSteps = true;
    }

    if (event.kind === "tap") {
      const description = describeTap(event);
      if (isMobile) {
        const t = toMobileTarget(event);
        if (!t) continue;
        mobileSteps.push({ action: "click", target: t, description });
        stepTargets.push({ stepIndex: mobileSteps.length - 1, description, ...t, ambiguous: best.ambiguous });
      } else {
        webSteps.push({
          action: "click",
          target: { strategy: best.strategy, value: best.value },
          description,
        });
        stepTargets.push({
          stepIndex: webSteps.length - 1,
          description,
          strategy: best.strategy,
          value: best.value,
          ambiguous: best.ambiguous,
        });
      }
      testRailSteps.push({
        content: description,
        expected: target.enabled === false
          ? "El control permanece deshabilitado hasta cumplir su condición"
          : "La acción se registra y la pantalla responde",
      });
      continue;
    }

    if (event.kind === "fill") {
      const description = describeFill(event);
      const label = target.label?.trim() || "campo";
      const stepIndex = isMobile ? mobileSteps.length : webSteps.length;
      requiredData.push({
        key: slugifyKey(label),
        label,
        stepIndex,
        exampleValue: event.redactedKey ? undefined : event.value,
        sensitive: Boolean(event.redactedKey || target.sensitive),
      });
      if (isMobile) {
        const t = toMobileTarget(event);
        if (!t) continue;
        mobileSteps.push({ action: "fill", target: t, value: event.value ?? "", description });
        stepTargets.push({ stepIndex: mobileSteps.length - 1, description, ...t, ambiguous: best.ambiguous });
      } else {
        webSteps.push({
          action: "fill",
          target: { strategy: best.strategy, value: best.value },
          value: event.value ?? "",
          description,
        });
        stepTargets.push({
          stepIndex: webSteps.length - 1,
          description,
          strategy: best.strategy,
          value: best.value,
          ambiguous: best.ambiguous,
        });
      }
      testRailSteps.push({ content: description, expected: "El campo acepta el valor ingresado" });
      continue;
    }

    if (event.kind === "navigate" && !isMobile && event.url) {
      webSteps.push({ action: "navigate", value: event.url, description: `Navegar a ${event.url}` });
      testRailSteps.push({ content: `Navegar a ${event.url}`, expected: "La página carga correctamente" });
    }
  }

  const lastScreen = trace.screens[trace.screens.length - 1];
  const title =
    options.title?.trim() ||
    trace.label?.trim() ||
    (lastScreen ? `Flujo grabado hasta ${lastScreen.title}` : "Flujo grabado");

  return {
    scenarioId: `${options.scenarioIdPrefix ?? "REC"}-${trace.recordingId.slice(0, 8).toUpperCase()}-01`,
    title: capTitle(title),
    description: buildFallbackStory(trace, events),
    preconditions: buildPreconditions(trace),
    kind: "happy_path",
    provenance: "observed",
    scope: "end_to_end",
    mobileSteps,
    webSteps,
    testRailSteps,
    requiredData,
    stepTargets,
    sourceRecordingId: trace.recordingId,
    hasUncertainSteps,
  };
}

function buildPreconditions(trace: SessionTrace): string[] {
  const preconditions: string[] = [];
  if (trace.platform === "android") {
    preconditions.push(`Aplicación ${trace.appPackage ?? trace.appSlug} instalada en el dispositivo`);
  } else if (trace.baseUrl) {
    preconditions.push(`Acceso a ${trace.baseUrl}`);
  }
  preconditions.push("Datos de prueba válidos disponibles para el proyecto");
  return preconditions;
}

/**
 * The story a recording tells, written without a model.
 *
 * Deliberately plain: it names the screens crossed and the actions taken so a reviewer can
 * tell what was recorded even when the AI pass never ran or was rejected.
 */
function buildFallbackStory(trace: SessionTrace, events: readonly RecordedEvent[]): string {
  const screens = trace.screens.map((s) => s.title).filter(Boolean);
  const actions = events.filter((e) => e.kind === "tap" || e.kind === "fill").length;
  const path = screens.length > 0 ? screens.join(" → ") : "la aplicación";
  return (
    `Recorrido observado sobre ${path}. ` +
    `Se registraron ${actions} acciones del usuario en ${screens.length} pantallas. ` +
    `Escenario derivado de la grabación ${trace.recordingId}.`
  );
}

/**
 * Derives negative scenarios from what the recording proved about the app's gates.
 *
 * A control observed DISABLED during the walkthrough is direct evidence of a precondition
 * the app enforces, so a scenario that reaches it without satisfying that precondition is a
 * real test — not an invented one. Nothing is generated for gates the recording never saw.
 */
export function buildGateNegatives(
  trace: SessionTrace,
  segments: readonly TraceSegment[],
  happyPath: RecordedScenario,
): RecordedScenario[] {
  const seen = new Set<string>();
  const negatives: RecordedScenario[] = [];

  for (const segment of segments) {
    for (const event of segment.events) {
      const target = event.target;
      if (!target || target.enabled !== false) continue;
      const label = target.label?.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);

      const upToGate = happyPath.testRailSteps.slice(
        0,
        Math.max(1, happyPath.testRailSteps.findIndex((s) => s.content.includes(label))),
      );

      negatives.push({
        scenarioId: `${happyPath.scenarioId}-NEG-${negatives.length + 1}`,
        title: capTitle(`${segment.title}: "${label}" permanece deshabilitado sin cumplir su condición`),
        description:
          `Durante la grabación el control "${label}" se observó deshabilitado en la pantalla ` +
          `"${segment.title}". Este escenario verifica que la aplicación mantiene ese bloqueo.`,
        preconditions: buildPreconditions(trace),
        kind: "negative",
        // The steps up to the gate were walked, but forcing the gate was not: nobody tried.
        provenance: "derived",
        mobileSteps: [],
        webSteps: [],
        testRailSteps: [
          ...upToGate,
          {
            content: `Intentar continuar sin completar los requisitos de "${label}"`,
            expected: `El control "${label}" permanece deshabilitado y el flujo no avanza`,
          },
        ],
        requiredData: [],
        stepTargets: [],
        sourceRecordingId: trace.recordingId,
        hasUncertainSteps: false,
      });
    }
  }

  return negatives;
}

/**
 * The longest title TestRail accepts on a case.
 *
 * Enforced here rather than at publish time because a title this long is unreadable in the
 * panel too — and because the alternative is what actually happened: a case rejected with
 * `:title es demasiado largo` after the other eleven had already been created.
 */
const MAX_TITLE_LENGTH = 250;

/**
 * Caps a scenario title at what TestRail accepts.
 *
 * The overflow comes from control labels: Android concatenates a container's children into
 * one `content-desc`, so a single "label" can be a whole screen's worth of text, and every
 * title that interpolates one is unbounded.
 */
export function capTitle(title: string): string {
  const clean = title.trim().replace(/\s+/g, " ");
  if (clean.length <= MAX_TITLE_LENGTH) return clean;
  return `${clean.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/** Shortens a screen title so it reads as a scenario name rather than a paragraph. */
function shortTitle(title: string, max = 48): string {
  const clean = title.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function isAction(event: RecordedEvent): boolean {
  return event.kind === "tap" || event.kind === "fill";
}

/**
 * One scenario per block of the walkthrough, on top of the end-to-end one.
 *
 * A single recording usually covers several things a QA would file separately — reaching the
 * contact-data screen is one case, completing it is another — and a suite made of one long
 * case can only ever fail as a whole. Each scenario is the run TRUNCATED at the end of a
 * block, not the block in isolation, because the steps that got there are what make it
 * executable; every step in it was still performed by the person recorded.
 *
 * The last block is skipped: truncating there reproduces the end-to-end scenario exactly.
 */
export function buildSegmentScenarios(
  trace: SessionTrace,
  events: readonly RecordedEvent[],
  segments: readonly TraceSegment[],
  happyPath: RecordedScenario,
): RecordedScenario[] {
  if (segments.length < 2) return [];

  const scenarios: RecordedScenario[] = [];
  let consumed = 0;

  segments.forEach((segment, index) => {
    consumed += segment.events.length;
    if (index === segments.length - 1) return;
    if (!segment.events.some(isAction)) return;

    const upToHere = events.slice(0, consumed);
    const scenario = buildHappyPathScenario(trace, upToHere, {
      title: `Recorrido hasta ${shortTitle(segment.title)}`,
    });
    // A truncation that kept every step is the end-to-end scenario under another name.
    if (scenario.testRailSteps.length >= happyPath.testRailSteps.length) return;

    scenarios.push({
      ...scenario,
      scenarioId: `${happyPath.scenarioId}-SEG-${scenarios.length + 1}`,
      description:
        `Bloque del recorrido que termina en "${shortTitle(segment.title, 80)}". ` +
        `Cubre ${scenario.testRailSteps.length} de los ${happyPath.testRailSteps.length} pasos del flujo completo.`,
      scope: "segment",
      provenance: "observed",
    });
  });

  return scenarios;
}

/** Labels the walkthrough actually pressed, per screen. */
function tappedLabelsByScreen(events: readonly RecordedEvent[]): Map<string, Set<string>> {
  const byScreen = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.kind !== "tap") continue;
    const label = event.target?.label?.trim();
    if (!label) continue;
    const set = byScreen.get(event.screenKey) ?? new Set<string>();
    set.add(label);
    byScreen.set(event.screenKey, set);
  }
  return byScreen;
}

function toStepTarget(locators: readonly RecordedLocator[]): MobileStepTarget | undefined {
  const locator = locators[0];
  if (!locator || !MOBILE_STRATEGIES.has(locator.strategy as MobileLocatorStrategy)) return undefined;
  return { strategy: locator.strategy as MobileLocatorStrategy, value: locator.value };
}

/** How many alternative paths one screen may contribute, and the whole recording. */
const MAX_ALTERNATIVES_PER_SCREEN = 3;
const MAX_ALTERNATIVES_TOTAL = 6;

/**
 * Scenarios for the controls the recording SAW but the person never pressed.
 *
 * A walkthrough is one path through a screen that offered several. The other options are
 * real — they were captured with their own locators, on a screen the recording actually
 * reached — and they are the cases a QA writes next. What the recording cannot supply is
 * what they DO, so the expected result is left explicitly open and the scenario is marked
 * `derived`: it must not be run automatically as if it had been observed.
 */
export function buildAlternativePathScenarios(
  trace: SessionTrace,
  events: readonly RecordedEvent[],
  happyPath: RecordedScenario,
): RecordedScenario[] {
  const tapped = tappedLabelsByScreen(events);
  const isMobile = trace.platform === "android";
  const scenarios: RecordedScenario[] = [];

  for (const screen of trace.screens) {
    if (scenarios.length >= MAX_ALTERNATIVES_TOTAL) break;

    const firstIndex = events.findIndex((e) => e.screenKey === screen.screenKey);
    if (firstIndex < 0) continue;

    const exercised = tapped.get(screen.screenKey) ?? new Set<string>();
    const untouched = screen.controls
      .filter((c) => c.enabled !== false)
      .filter((c) => c.label.trim().length > 2 && !exercised.has(c.label.trim()))
      .slice(0, MAX_ALTERNATIVES_PER_SCREEN);

    for (const control of untouched) {
      if (scenarios.length >= MAX_ALTERNATIVES_TOTAL) break;

      // Everything the person did before arriving here is what makes the case reachable.
      const preamble = buildHappyPathScenario(trace, events.slice(0, firstIndex), {
        title: control.label,
      });
      const target = toStepTarget(control.locators);
      const locator = control.locators[0];
      const description = `Seleccionar "${control.label}"`;

      const mobileSteps = [...preamble.mobileSteps];
      const webSteps = [...preamble.webSteps];
      if (isMobile && target) {
        mobileSteps.push({ action: "click", target, description });
      } else if (!isMobile && locator) {
        webSteps.push({
          action: "click",
          target: { strategy: locator.strategy, value: locator.value },
          description,
        });
      }

      scenarios.push({
        scenarioId: `${happyPath.scenarioId}-ALT-${scenarios.length + 1}`,
        title: capTitle(`Desde ${shortTitle(screen.title)}: ${control.label}`),
        description:
          `La pantalla "${shortTitle(screen.title, 80)}" ofrece "${control.label}", que el recorrido grabado ` +
          `no ejercitó. El resultado esperado debe confirmarse antes de automatizar este caso.`,
        preconditions: preamble.preconditions,
        kind: "happy_path",
        provenance: "derived",
        mobileSteps,
        webSteps,
        testRailSteps: [
          ...preamble.testRailSteps,
          { content: description, expected: "Por confirmar: la grabación no recorrió esta opción" },
        ],
        requiredData: preamble.requiredData,
        stepTargets: locator
          ? [
              ...preamble.stepTargets,
              {
                stepIndex: (isMobile ? mobileSteps.length : webSteps.length) - 1,
                description,
                strategy: locator.strategy,
                value: locator.value,
                ambiguous: locator.ambiguous,
              },
            ]
          : preamble.stepTargets,
        sourceRecordingId: trace.recordingId,
        hasUncertainSteps: true,
      });
    }
  }

  return scenarios;
}
