import type { MobileLocatorStrategy } from "./mobile-step-types";

export type MobileElementRole = "input" | "button" | "link" | "text" | "toggle" | "modal" | "other";

export type MobileElement = {
  label: string;
  role: MobileElementRole;
  /** Tappable target. Absent for elements that are guidance-only (e.g. a modal/overlay note). */
  locator?: { strategy: MobileLocatorStrategy; value: string };
  hasAccessibilityLabel?: boolean;
  notes?: string;
  /** Optional interaction hints (e.g. tap the checkbox on its left edge). Free-form. */
  interaction?: Record<string, unknown>;
  /** For role "modal": how the overlay is closed. */
  close?: { hint?: string; note?: string };
  /** True when the control is disabled until a gate is satisfied (e.g. a submit button). */
  gated?: boolean;
  /** Conditions that ENABLE a gated control. */
  enabledWhen?: string[];
  /** Conditions under which a gated control STAYS disabled (used by negative scenarios). */
  disabledWhen?: string[];
};

/**
 * A user-fillable data field a screen needs (document type, id number, amount...).
 * Declared per screen so it's surfaced independently of what the AI generated — any
 * scenario that reaches this screen exposes these fields for the user to edit.
 */
export type MobileScreenDataField = {
  key: string;
  label: string;
  kind: "text" | "select";
  /** For kind="select": the allowed options (discovered from the real dropdown). */
  options?: string[];
  /** For select: the option pre-selected by default. */
  defaultValue?: string;
  /** For text: the example value the field pre-fills with. */
  exampleValue?: string;
  sensitive: boolean;
  /** Locator that identifies the step in a generated scenario this field maps to
   * (text: the input; select: the dropdown toggle). Used to match/classify steps. */
  matchLocator: { strategy: MobileLocatorStrategy; value: string };
  /** For select: locator template with `{{value}}` to click the chosen option. */
  applyTargetTemplate?: { strategy: MobileLocatorStrategy; value: string };
  /** Optional key of another dataField this field depends on (e.g. a select that must be
   * picked before this input can be filled). Only honored when the dependent field is
   * actually used by a scenario's steps; it is NOT implied by sharing a screen. */
  dependsOn?: string;
};

export type MobileScreen = {
  screenId: string;
  title: string;
  isEntryScreen?: boolean;
  elements: MobileElement[];
  discoveredAt: string;
  discoverySource: "manual_exploration" | "automated_discovery";
  /** Data fields this screen needs (surfaced to the user for editing). */
  dataFields?: MobileScreenDataField[];
  /** Free-form flow guidance for the generator (ordering, pitfalls to avoid). */
  flowNotes?: string[];
};

export type MobileStepHint = {
  action: "launchApp" | "click" | "fill" | "assertVisible" | "waitFor" | "screenshot";
  description?: string;
  target?: { strategy: MobileLocatorStrategy; value: string };
  value?: string;
};

/**
 * A navigation "flow" describes an intent-driven path through the app (e.g. login vs.
 * new-user registration). The AI matches a Jira story to a flow by its trigger
 * keywords/intent, then prepends the flow's entrySteps so the scenario starts down the
 * right path. Mobile analog of the web routeProfile's entry/intent routing.
 */
export type MobileFlow = {
  description: string;
  /** Lowercased substrings; if the HU text contains any, the story matches this flow. */
  triggerKeywords: string[];
  /** Screen the flow starts from (usually the entry screen). */
  entryFromScreen?: string;
  /** Steps to reach this flow's starting screen from the app launch (excluding launchApp). */
  entrySteps: MobileStepHint[];
};

export type MobileRouteProfile = {
  appSlug: string;
  packageName: string;
  appName: string;
  platform: "android";
  mainActivity: string;
  framework?: string;
  updatedAt: string;
  screens: Record<string, MobileScreen>;
  /** Optional intent-driven navigation flows (login, registration, etc.). */
  flows?: Record<string, MobileFlow>;
  /** Optional execution classification hints for transition/failure interpretation. */
  executionSignals?: {
    successSignals?: string[];
    rejectionSignals?: string[];
    validationSignals?: string[];
    technicalErrorSignals?: string[];
    inductionActions?: string[];
  };
  /**
   * Functional data profiles: each profile binds semantic field keys to keys that already
   * exist in testData (APP_TEST_DATA_JSON). A scenario whose outcome depends on a
   * backend/business state declares `requiredDataProfile` and is only executable when that
   * profile exists AND every dataRef resolves in testData. Profile names are app-defined;
   * core never hardcodes them.
   */
  functionalDataProfiles?: Record<string, {
    dataRefs: Record<string, string>;
  }>;
};
