/**
 * Business context a reviewer adds to a recording or to one of its scenarios.
 *
 * A recording only knows what was clicked and seen: not why, which rules apply, what the business
 * expects at the end, or which data the case needs. Without that, generated cases read as click
 * lists and the AI proposes variants blind (recording 2920301b). The reviewer's context is stored
 * on the trace -- recording-wide plus per scenario id, both stable across regenerations -- and
 * flows into TestRail preconditions and into the AI prompt.
 *
 * It is never execution authority: an expected outcome written here is a statement for people, not
 * an assertion the replay or the spec checks (only what the recording observed is asserted).
 */

export type ReviewerContext = {
  /** Why the case exists: the business purpose. */
  purpose?: string;
  /** What the business expects at the end. Declared, never verified automatically. */
  expectedOutcome?: string;
  businessRules?: string;
  /** Which data the case needs. Never credentials: TestRail is not a secret store. */
  testData?: string;
  preconditions?: string[];
};

export type RecordingReviewerContext = {
  recording?: ReviewerContext;
  scenarios?: Record<string, ReviewerContext>;
};

const MAX_TEXT = 600;
const MAX_PRECONDITIONS = 8;
const MAX_PRECONDITION = 200;

function cleanText(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\r\n/g, "\n").trim().slice(0, max).trim();
  return text.length > 0 ? text : undefined;
}

/** Trims, bounds and drops empty fields; undefined when nothing is left. */
export function normalizeReviewerContext(input: unknown): ReviewerContext | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const preconditions = (Array.isArray(raw.preconditions) ? raw.preconditions : [])
    .map((entry) => cleanText(entry, MAX_PRECONDITION))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, MAX_PRECONDITIONS);
  const context: ReviewerContext = {
    ...(cleanText(raw.purpose) ? { purpose: cleanText(raw.purpose) } : {}),
    ...(cleanText(raw.expectedOutcome) ? { expectedOutcome: cleanText(raw.expectedOutcome) } : {}),
    ...(cleanText(raw.businessRules) ? { businessRules: cleanText(raw.businessRules) } : {}),
    ...(cleanText(raw.testData) ? { testData: cleanText(raw.testData) } : {}),
    ...(preconditions.length > 0 ? { preconditions } : {}),
  };
  return Object.keys(context).length > 0 ? context : undefined;
}

/** Stores one scope ("recording" or a scenario id); an empty context removes that scope. */
export function withReviewerContext(
  current: RecordingReviewerContext | undefined,
  scope: string,
  context: ReviewerContext | undefined,
): RecordingReviewerContext | undefined {
  const next: RecordingReviewerContext = { ...(current?.recording ? { recording: current.recording } : {}), scenarios: { ...(current?.scenarios ?? {}) } };
  if (scope === "recording") {
    if (context) next.recording = context;
    else delete next.recording;
  } else if (context) {
    next.scenarios![scope] = context;
  } else {
    delete next.scenarios![scope];
  }
  if (Object.keys(next.scenarios!).length === 0) delete next.scenarios;
  return next.recording || next.scenarios ? next : undefined;
}

/** The context that applies to one scenario: its own fields win, preconditions add up. */
export function reviewerContextFor(all: RecordingReviewerContext | undefined, scenarioId: string): ReviewerContext | undefined {
  const recording = all?.recording;
  const own = all?.scenarios?.[scenarioId];
  if (!recording && !own) return undefined;
  const preconditions = [...new Set([...(recording?.preconditions ?? []), ...(own?.preconditions ?? [])])];
  return normalizeReviewerContext({ ...recording, ...own, preconditions });
}

/** Generic placeholders the recording writes when it knows nothing better. */
const GENERIC_DATA_PRECONDITION = /^datos de prueba v[aá]lidos disponibles/i;

/**
 * TestRail preconditions with the reviewer's context first, as labelled lines a tester reads
 * before the steps. The generic "valid test data" placeholder gives way to the stated data.
 */
export function preconditionsWithReviewerContext(preconditions: readonly string[], context: ReviewerContext | undefined): string[] {
  if (!context) return [...preconditions];
  const labelled = [
    context.purpose ? `Propósito: ${context.purpose}` : undefined,
    context.businessRules ? `Reglas de negocio: ${context.businessRules}` : undefined,
    context.expectedOutcome ? `Resultado esperado de negocio (declarado por QA, no verificado automáticamente): ${context.expectedOutcome}` : undefined,
    context.testData ? `Datos de prueba: ${context.testData}` : undefined,
  ].filter((line): line is string => Boolean(line));
  const recorded = preconditions.filter((entry) => !(context.testData && GENERIC_DATA_PRECONDITION.test(entry)));
  return [...new Set([...labelled, ...(context.preconditions ?? []), ...recorded])];
}

/**
 * What the AI gets: purpose, rules and expected outcome, recording-wide and per scenario. Test
 * data stays out of the prompt -- it may name real customers.
 */
export function reviewerContextForAi(all: RecordingReviewerContext | undefined): Record<string, unknown> | null {
  const strip = (context: ReviewerContext | undefined) => context
    ? Object.fromEntries(Object.entries({ purpose: context.purpose, businessRules: context.businessRules, expectedOutcome: context.expectedOutcome, preconditions: context.preconditions }).filter(([, value]) => value !== undefined))
    : undefined;
  const recording = strip(all?.recording);
  const scenarios = Object.fromEntries(Object.entries(all?.scenarios ?? {}).map(([id, context]) => [id, strip(context)]).filter(([, value]) => value && Object.keys(value).length > 0));
  if ((!recording || Object.keys(recording).length === 0) && Object.keys(scenarios).length === 0) return null;
  return { ...(recording && Object.keys(recording).length > 0 ? { recording } : {}), ...(Object.keys(scenarios).length > 0 ? { scenarios } : {}) };
}
