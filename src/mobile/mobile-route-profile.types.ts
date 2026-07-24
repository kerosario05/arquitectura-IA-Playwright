import type { MobileLocatorStrategy } from "./mobile-step-types";

export type MobileElementRole = "input" | "button" | "link" | "text" | "toggle" | "other";

export type MobileElement = {
  label: string;
  role: MobileElementRole;
  locator: { strategy: MobileLocatorStrategy; value: string };
  hasAccessibilityLabel: boolean;
  notes?: string;
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
};
