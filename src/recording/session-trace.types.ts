/**
 * Shared trace schema for recorded exploration sessions (web and Android).
 *
 * A recording captures what a human actually did in the app so scenarios can be derived
 * from a real walkthrough instead of a written story. Two streams feed it: the ACTIONS
 * (what was tapped/typed) and the SCREENS observed around each action. Frames are sampled
 * only to give the AI visual context during derivation and are deleted afterwards — the
 * trace and the distilled narrative are what persist, which is what makes a recording
 * re-derivable later without keeping a video of a banking app on disk.
 *
 * The schema is deliberately identical for both platforms: normalization, derivation and
 * scenario building are then one pure pipeline with no per-platform branches.
 */

export type RecordingPlatform = "web" | "android";

export type RecordingStatus =
  | "starting"
  | "recording"
  | "stopping"
  | "stopped"
  | "derived"
  | "failed";

/** A locator candidate for the element an event touched, strongest first. */
export type RecordedLocator = {
  strategy: string;
  value: string;
  /** 0..1 — how reliable this strategy is for re-finding the element. */
  confidence?: number;
  /**
   * The element's own identity did not single it out on the screen it was captured on, so
   * this locator is pinned to a position among its matches. Executable, but positional: it
   * breaks if the screen reorders, which is why it is surfaced to the reviewer.
   */
  ambiguous?: boolean;
  /** 0-based position among the elements the un-pinned identity matched. */
  matchIndex?: number;
};

export type RecordedBounds = { x: number; y: number; width: number; height: number };

export type RecordedTarget = {
  label: string;
  role?: string;
  /** Ranked locator candidates. The first entry is what a generated step uses. */
  locators: RecordedLocator[];
  bounds?: RecordedBounds;
  /** From the platform's `enabled` attribute — a disabled control that was tapped is a gate. */
  enabled?: boolean;
  /** True when the control holds data that must never leave the environment verbatim. */
  sensitive?: boolean;
};

export type RecordedEventKind =
  | "launch"
  | "tap"
  | "fill"
  | "navigate"
  | "back"
  | "swipe"
  | "screen_change"
  | "note";

export type RecordedEvent = {
  seq: number;
  /** Milliseconds since the recording started. */
  t: number;
  kind: RecordedEventKind;
  /** Screen the event happened ON (before any transition it caused). */
  screenKey: string;
  fingerprint?: string;
  target?: RecordedTarget;
  /** Typed text. Replaced by `redactedKey` when the field is sensitive. */
  value?: string;
  redactedKey?: string;
  /** Web only. */
  url?: string;
  /** For `screen_change`: where the app landed. */
  toScreenKey?: string;
  /** Ephemeral frame captured for this event. Cleared once derivation consumes it. */
  framePath?: string;
  note?: string;
};

export type RecordedControl = {
  label: string;
  role?: string;
  locators: RecordedLocator[];
  enabled?: boolean;
  bounds?: RecordedBounds;
};

export type RecordedScreen = {
  screenKey: string;
  title: string;
  fingerprint: string;
  url?: string;
  /** Milliseconds since recording start. */
  firstSeenAt: number;
  controls: RecordedControl[];
  /** Visible non-interactive text — the raw material for assertions. */
  texts: string[];
};

/** A contiguous run of events on one screen, after normalization. */
export type TraceSegment = {
  index: number;
  screenKey: string;
  title: string;
  events: RecordedEvent[];
  /** Screen the segment exits to, when it transitions. */
  exitsTo?: string;
};

export type SessionTrace = {
  recordingId: string;
  /** Project the recording belongs to — the app under test comes from its configuration. */
  projectSlug: string;
  appSlug: string;
  platform: RecordingPlatform;
  appPackage?: string;
  baseUrl?: string;
  label?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: RecordingStatus;
  events: RecordedEvent[];
  screens: RecordedScreen[];
  /** Step-by-step distilled from frames + events. Survives frame deletion. */
  narrative?: string;
  /** Set when the recording ended abnormally. */
  errorMessage?: string;
};

/** Summary shape returned by list/status endpoints — never carries the full event array. */
export type RecordingSummary = {
  recordingId: string;
  projectSlug: string;
  appSlug: string;
  platform: RecordingPlatform;
  label?: string;
  status: RecordingStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  eventCount: number;
  screenCount: number;
  actionCount: number;
  hasNarrative: boolean;
  scenarioCount: number;
  errorMessage?: string;
};
