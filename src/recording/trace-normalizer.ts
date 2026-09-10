import type { RecordedEvent, SessionTrace, TraceSegment } from "./session-trace.types";

/**
 * Turns a raw capture into the sequence a human would describe.
 *
 * A recorder observing a real person produces far more events than the walkthrough
 * contained: the digitizer double-reports a press, a keystroke lands as one `fill` per
 * character, the source poller re-reads a screen that never changed. Feeding that stream to
 * a generator produces a scenario with fifty steps for a five-step flow.
 *
 * Everything here is pure over the trace so the policy can be reasoned about — and changed —
 * without re-recording a session.
 */

export type NormalizeOptions = {
  /** Two taps on the same target closer than this are one press. Default 400ms. */
  tapDebounceMs?: number;
  /** Drop taps whose target could not be identified at all. Default true. */
  dropUnidentifiedTaps?: boolean;
};

/** Identity of the control an event addressed, for comparing consecutive events. */
function targetKey(event: RecordedEvent): string {
  const first = event.target?.locators?.[0];
  if (first) return `${first.strategy}:${first.value}`;
  return event.target?.label ?? "";
}

/**
 * Collapses the capture noise.
 *
 * The order of the passes matters: consecutive fills are merged before the debounce runs, so
 * a burst of per-character events does not look like a burst of distinct actions that the
 * debounce would then keep.
 */
export function normalizeEvents(
  events: readonly RecordedEvent[],
  options: NormalizeOptions = {},
): RecordedEvent[] {
  const debounce = options.tapDebounceMs ?? 400;
  const dropUnidentified = options.dropUnidentifiedTaps !== false;

  // Pass 1 — a screen_change that did not change the screen is a poller artifact.
  const realTransitions = events.filter(
    (e) => e.kind !== "screen_change" || (e.toScreenKey && e.toScreenKey !== e.screenKey),
  );

  // Pass 2 — a field is typed character by character; only its final content is a step.
  const merged: RecordedEvent[] = [];
  for (const event of realTransitions) {
    const prev = merged[merged.length - 1];
    if (
      event.kind === "fill" &&
      prev?.kind === "fill" &&
      targetKey(prev) === targetKey(event) &&
      targetKey(event) !== ""
    ) {
      merged[merged.length - 1] = { ...prev, value: event.value, redactedKey: event.redactedKey, t: event.t };
      continue;
    }
    merged.push(event);
  }

  // Pass 3 — the same control pressed twice within the debounce is one press.
  const deduped: RecordedEvent[] = [];
  for (const event of merged) {
    const prev = deduped[deduped.length - 1];
    if (
      event.kind === "tap" &&
      prev?.kind === "tap" &&
      targetKey(prev) === targetKey(event) &&
      targetKey(event) !== "" &&
      event.t - prev.t < debounce
    ) {
      continue;
    }
    deduped.push(event);
  }

  // Pass 4 — a tap nobody can locate is not reproducible; keep it as a note so the
  // narrative still shows the human did something there, but never as a step.
  const cleaned = deduped.map((event) => {
    if (!dropUnidentified) return event;
    if (event.kind !== "tap") return event;
    if ((event.target?.locators?.length ?? 0) > 0) return event;
    return {
      ...event,
      kind: "note" as const,
      note: event.target?.label
        ? `Toque sin locator utilizable sobre "${event.target.label}"`
        : "Toque en una zona sin elemento identificable",
    };
  });

  return cleaned.map((event, index) => ({ ...event, seq: index }));
}

/**
 * Splits the walkthrough into one segment per screen visited.
 *
 * Segments are what make a long recording readable and what a flow is built from: each one
 * is "on this screen, the user did X, Y, then left for Z".
 */
export function segmentTrace(events: readonly RecordedEvent[], trace: SessionTrace): TraceSegment[] {
  const titleOf = new Map(trace.screens.map((s) => [s.screenKey, s.title]));
  const segments: TraceSegment[] = [];

  for (const event of events) {
    const current = segments[segments.length - 1];
    if (!current || current.screenKey !== event.screenKey) {
      segments.push({
        index: segments.length,
        screenKey: event.screenKey,
        title: titleOf.get(event.screenKey) ?? event.screenKey,
        events: [event],
      });
    } else {
      current.events.push(event);
    }
    if (event.kind === "screen_change" && event.toScreenKey) {
      const seg = segments[segments.length - 1];
      seg.exitsTo = event.toScreenKey;
    }
  }

  return segments;
}

export type TraceStats = {
  actions: number;
  taps: number;
  fills: number;
  transitions: number;
  screens: number;
  unidentified: number;
  durationMs: number;
};

/** Headline numbers for the recording panel — cheap enough to recompute on every poll. */
export function summarizeTrace(events: readonly RecordedEvent[], trace: SessionTrace): TraceStats {
  const taps = events.filter((e) => e.kind === "tap").length;
  const fills = events.filter((e) => e.kind === "fill").length;
  const transitions = events.filter((e) => e.kind === "screen_change").length;
  const unidentified = events.filter((e) => e.kind === "note").length;
  const last = events[events.length - 1];
  return {
    actions: taps + fills,
    taps,
    fills,
    transitions,
    screens: trace.screens.length,
    unidentified,
    durationMs: trace.durationMs ?? (last ? last.t : 0),
  };
}
