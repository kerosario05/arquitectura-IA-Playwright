import type {
  RecordedEvent,
  RecordedScreen,
  RecordingDataPolicy,
  RecordingGoal,
  RecordedTarget,
  SessionTrace,
} from "./session-trace.types";
import { normalizeEvents } from "./trace-normalizer";

export type SemanticProvenance = "OBSERVED" | "DERIVED" | "AI_PROPOSED" | "RECORDED_CONFIRMED";
export type RecordedValueRole =
  | "action_input"
  | "secure_input"
  | "expected_oracle"
  | "runtime_derived_oracle"
  | "constraint"
  | "system_generated";

export type SemanticScreenClassification =
  | "ROUTE_NAVIGATION"
  | "SCREEN_TRANSITION"
  | "MODAL_STATE"
  | "DYNAMIC_COMPONENT_STATE"
  | "SAME_SCREEN_MUTATION";

export type TechnicalObservationStatus = "OBSERVED" | "VALIDATED";

export type RecordedRuntimeValue = {
  valueKey: string;
  semanticField: string;
  valueRole: RecordedValueRole;
  value?: string;
  source: "RECORDED_CONFIRMED" | "secure" | "OBSERVED";
  verified: boolean;
  sensitive: boolean;
  generated: false;
  dependsOn?: string[];
  dependencyConfidence?: number;
  recordingId: string;
};

export type TechnicalObservation = {
  observationId: string;
  status: TechnicalObservationStatus;
  screenIdentity: string;
  componentType: string;
  label?: string;
  role?: string;
  tag?: string;
  enabled?: boolean;
  bounds?: RecordedTarget["bounds"];
  locatorCandidates: RecordedTarget["locators"];
  technicalTargetRef: string;
  containerIdentity?: string;
  rowIdentity?: string;
  associatedField?: string;
  selectable?: boolean;
  editable?: boolean;
  editorLifecycle?: "dynamic";
  stateTransitions?: string[];
  observedOptions?: string[];
};

export type SemanticEvent = {
  eventRef: string;
  action: "launch" | "activate" | "click" | "fill" | "navigate" | "assert" | "observe";
  screenIdentity: string;
  componentType?: string;
  field?: string;
  associatedField?: string;
  controlAffordance?: string;
  valueKey?: string;
  valueRole?: RecordedValueRole;
  beforeState?: string;
  afterState?: string;
  technicalTargetRef?: string;
  provenance: SemanticProvenance;
  confidence: number;
};

export type SemanticComponent = {
  componentId: string;
  componentType: string;
  screenIdentity: string;
  label?: string;
  entityScope?: string;
  rowIdentity?: string;
  associatedField?: string;
  compoundField?: boolean;
  children?: Array<{ semanticRole: string; affordance: string; technicalTargetRef: string }>;
  observationRefs: string[];
};

export type SemanticScreen = {
  screenIdentity: string;
  title?: string;
  url?: string;
  classification: SemanticScreenClassification;
  sourceScreenKey: string;
};

export type ScenarioSuggestion = {
  suggestionId: string;
  title: string;
  provenance: "OBSERVED_HAPPY_PATH" | "DERIVED_ALTERNATIVE" | "DERIVED_VALIDATION" | "AI_PROPOSED";
  confidence: number;
  goalRelevanceScore: number;
  goalRelevanceReasons: string[];
  needsReview: boolean;
  rationale: string;
  sourceEventRefs: string[];
  steps: string[];
  expectedResultCandidate?: string;
  oracleAuthority: "observed_only" | "review_required";
  dataRequirements: string[];
  technicalObservationRefs: string[];
};

export type SemanticRecordingModel = {
  version: "1.0";
  recordingId: string;
  projectSlug: string;
  appSlug: string;
  platform: SessionTrace["platform"];
  recordingGoal?: RecordingGoal;
  recordingDataPolicy: RecordingDataPolicy;
  primaryScenario?: {
    scenarioId: string;
    title: string;
    provenance: "OBSERVED";
    sourceEventRefs: string[];
    traceBacked: true;
    containsUnexecutedActions: false;
    needsReview: boolean;
  };
  semanticScreens: SemanticScreen[];
  semanticComponents: SemanticComponent[];
  semanticEvents: SemanticEvent[];
  datasets: RecordedRuntimeValue[];
  technicalObservations: TechnicalObservation[];
  scenarioSuggestions: ScenarioSuggestion[];
  source: "SessionTrace";
};

export const DEFAULT_RECORDING_DATA_POLICY: RecordingDataPolicy = {
  persistRecordedValues: true,
  persistQaCredentials: false,
  includeQaCredentialsInTestRail: false,
};

export function normalizeRecordingDataPolicy(
  policy?: Partial<RecordingDataPolicy>,
): RecordingDataPolicy {
  const persistQaCredentials = policy?.persistQaCredentials === true;
  return {
    persistRecordedValues: policy?.persistRecordedValues !== false,
    persistQaCredentials,
    includeQaCredentialsInTestRail: persistQaCredentials && policy?.includeQaCredentialsInTestRail === true,
  };
}

export function normalizeRecordingGoal(declaredGoal?: string): RecordingGoal | undefined {
  const declared = declaredGoal?.trim().replace(/\s+/g, " ");
  if (!declared) return undefined;
  const normalizedGoal = declared
    .replace(/^(?:quiero|vamos a|necesito)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  return {
    declaredGoal: declared,
    normalizedGoal: normalizedGoal || declared,
    provenance: "USER_DECLARED",
    needsReview: normalizedGoal.length < declared.length * 0.5,
  };
}

/** Conservative, platform-neutral classification for credentials captured by older traces. */
export function isSensitiveRecordedEvent(event: RecordedEvent): boolean {
  if (event.redactedKey || event.target?.sensitive) return true;
  const label = [event.target?.label, event.target?.role, event.target?.locators?.[0]?.value]
    .filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /(?:password|contrasena|clave|usuario|username|identificacion|empresa|company|\brnc\b)/i.test(label);
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "campo";
}

function componentType(target?: RecordedTarget): string {
  const role = target?.role?.toLowerCase();
  const locator = target?.locators?.[0]?.strategy;
  if (role === "dialog" || role === "alertdialog") return "dialog";
  if (role === "grid" || role === "table") return "grid";
  if (role === "row") return "row";
  if (role === "gridcell" || role === "cell") return "cell";
  if (role === "combobox" || locator === "select") return "select/combobox";
  if (role === "checkbox") return "checkbox";
  if (role === "textbox" || role === "input") return "textbox";
  if (role === "button") return "button";
  if (role === "navigation") return "navigation";
  return target?.role || "control";
}

function affordance(target?: RecordedTarget): string {
  const role = target?.role?.toLowerCase();
  if (role === "combobox" || role === "listbox" || role === "option") return "selectable";
  if (role === "textbox" || role === "input") return "editable";
  if (role === "button") return "clickable";
  return "observable_control";
}

function cleanTitle(screen: RecordedScreen | undefined): string | undefined {
  const title = screen?.title?.trim();
  if (!title || title === screen?.screenKey) return undefined;
  if (/hash|fingerprint|^[a-f0-9]{8,}$/i.test(title)) return undefined;
  return title;
}

function classifyScreen(event: RecordedEvent, previous?: RecordedEvent): SemanticScreenClassification {
  if (event.url && previous?.url && new URL(event.url, "http://recording.invalid").pathname !== new URL(previous.url, "http://recording.invalid").pathname) {
    return "ROUTE_NAVIGATION";
  }
  if (event.kind === "screen_change") return event.url === previous?.url ? "DYNAMIC_COMPONENT_STATE" : "SCREEN_TRANSITION";
  return "SAME_SCREEN_MUTATION";
}

export function buildSemanticRecordingModel(
  trace: SessionTrace,
  inputEvents: readonly RecordedEvent[] = normalizeEvents(trace.events),
): SemanticRecordingModel {
  const events = [...inputEvents];
  const recordingDataPolicy = normalizeRecordingDataPolicy(trace.recordingDataPolicy);
  const screens = trace.screens.map((screen) => ({
    screenIdentity: screen.screenKey,
    title: cleanTitle(screen),
    url: screen.url,
    classification: "SCREEN_TRANSITION" as SemanticScreenClassification,
    sourceScreenKey: screen.screenKey,
  }));
  const screenByKey = new Map(screens.map((screen) => [screen.sourceScreenKey, screen]));
  const observations: TechnicalObservation[] = [];
  const components = new Map<string, SemanticComponent>();
  const datasets = new Map<string, RecordedRuntimeValue>();
  const semanticEvents: SemanticEvent[] = [];

  for (const [index, event] of events.entries()) {
    const target = event.target;
    const field = target?.label?.trim() ? slugify(target.label) : undefined;
    const observationId = `obs-${index + 1}`;
    const technicalTargetRef = target ? `${event.screenKey}:${target.locators[0]?.strategy ?? "unidentified"}:${target.locators[0]?.value ?? target.label}` : `${event.screenKey}:event-${index + 1}`;
    if (target) {
      const type = componentType(target);
      observations.push({
        observationId,
        status: event.kind === "tap" || event.kind === "fill" ? "VALIDATED" : "OBSERVED",
        screenIdentity: event.screenKey,
        componentType: type,
        label: target.label,
        role: target.role,
        enabled: target.enabled,
        bounds: target.bounds,
        locatorCandidates: target.locators,
        technicalTargetRef,
        selectable: affordance(target) === "selectable",
        editable: affordance(target) === "editable",
      });
      const componentId = `${event.screenKey}:${field ?? type}`;
      const component = components.get(componentId) ?? {
        componentId,
        componentType: type,
        screenIdentity: event.screenKey,
        label: target.label,
        observationRefs: [],
      };
      component.observationRefs.push(observationId);
      components.set(componentId, component);
    }

    const role = target?.role?.toLowerCase();
    const valueKey = field;
    if (event.kind === "fill" && valueKey) {
      const sensitive = isSensitiveRecordedEvent(event);
      const applicationDerived = event.valueSource === "application";
      const dependency = event.dependsOnEventRef
        ? semanticEvents.find((candidate) => candidate.eventRef === event.dependsOnEventRef)?.valueKey
        : undefined;
      datasets.set(valueKey, {
        valueKey: slugify(event.redactedKey ?? valueKey),
        semanticField: valueKey,
        valueRole: applicationDerived ? "runtime_derived_oracle" : sensitive ? "secure_input" : "action_input",
        value: sensitive && !recordingDataPolicy.persistQaCredentials ? undefined : event.value,
        source: applicationDerived ? "OBSERVED" : sensitive ? "secure" : "RECORDED_CONFIRMED",
        verified: true,
        sensitive,
        generated: false,
        ...(dependency ? { dependsOn: [dependency], dependencyConfidence: 0.9 } : {}),
        recordingId: trace.recordingId,
      });
    }
    semanticEvents.push({
      eventRef: `event-${index + 1}`,
      action: event.kind === "tap" ? (role === "button" ? "click" : "activate") : event.kind === "fill" ? "fill" : event.kind === "navigate" ? "navigate" : "observe",
      screenIdentity: event.screenKey,
      componentType: target ? componentType(target) : undefined,
      field,
      controlAffordance: target ? affordance(target) : undefined,
      valueKey: event.kind === "fill" && valueKey ? slugify(event.redactedKey ?? valueKey) : valueKey,
      valueRole: event.kind === "fill"
        ? event.valueSource === "application"
          ? "runtime_derived_oracle"
          : isSensitiveRecordedEvent(event) ? "secure_input" : "action_input"
        : undefined,
      technicalTargetRef: target ? technicalTargetRef : undefined,
      provenance: "OBSERVED",
      confidence: target?.locators?.length ? 0.9 : 0.4,
    });
  }

  for (let i = 1; i < semanticEvents.length; i += 1) {
    const previous = semanticEvents[i - 1];
    const current = semanticEvents[i];
    if (previous.field && previous.field === current.field && previous.technicalTargetRef !== current.technicalTargetRef) {
      const observation = observations[i];
      if (observation) {
        observation.editorLifecycle = "dynamic";
        observation.stateTransitions = ["control_identity_changed"];
      }
    }
  }

  const previousByScreen = new Map<string, RecordedEvent>();
  for (const event of events) {
    const screen = screenByKey.get(event.screenKey);
    if (screen) screen.classification = classifyScreen(event, previousByScreen.get(event.screenKey));
    previousByScreen.set(event.screenKey, event);
  }

  // Screen controls are evidence too, even when the person never activated them. Keeping
  // them separate from events lets the reviewer distinguish an observed control from an
  // executed action and gives the model enough structure to recognize grids and compounds.
  for (const screen of trace.screens) {
    const screenControls = screen.controls ?? [];
    const roleSet = new Set(screenControls.map((control) => control.role?.toLowerCase()).filter(Boolean));
    const gridEvidence = roleSet.has("combobox") && roleSet.has("checkbox") && screenControls.length >= 4;
    if (gridEvidence) {
      const componentId = `${screen.screenKey}:editable-grid`;
      components.set(componentId, {
        componentId,
        componentType: "editable_grid",
        screenIdentity: screen.screenKey,
        observationRefs: [],
      });
    }
    for (const [index, control] of screenControls.entries()) {
      const observationId = `screen-${screen.screenKey}-control-${index + 1}`;
      const type = componentType(control as RecordedTarget);
      const observation: TechnicalObservation = {
        observationId,
        status: "OBSERVED",
        screenIdentity: screen.screenKey,
        componentType: type,
        label: control.label,
        role: control.role,
        enabled: control.enabled,
        bounds: control.bounds,
        locatorCandidates: control.locators,
        technicalTargetRef: `${screen.screenKey}:control:${index + 1}`,
        selectable: affordance(control as RecordedTarget) === "selectable",
        editable: affordance(control as RecordedTarget) === "editable",
      };
      observations.push(observation);
      if (gridEvidence) components.get(`${screen.screenKey}:editable-grid`)?.observationRefs.push(observationId);
    }
  }

  // A compound is only emitted when the same semantic label has both selectable and editable
  // evidence on the same screen. It is never inferred from column position or ordinal.
  for (const [componentId, component] of components) {
    const related = observations.filter((observation) =>
      observation.screenIdentity === component.screenIdentity &&
      slugify(observation.label ?? "") === slugify(component.label ?? ""),
    );
    const selectable = related.find((observation) => observation.selectable || observation.componentType === "button");
    const editable = related.find((observation) => observation.editable);
    if (selectable && editable && selectable.observationId !== editable.observationId) {
      component.compoundField = true;
      component.componentType = "compound_field";
      component.children = [
        { semanticRole: "selection", affordance: "selectable", technicalTargetRef: selectable.technicalTargetRef },
        { semanticRole: "amount_or_text", affordance: "editable", technicalTargetRef: editable.technicalTargetRef },
      ];
    }
  }

  return {
    version: "1.0",
    recordingId: trace.recordingId,
    projectSlug: trace.projectSlug,
    appSlug: trace.appSlug,
    platform: trace.platform,
    recordingGoal: trace.recordingGoal,
    recordingDataPolicy,
    semanticScreens: screens,
    semanticComponents: [...components.values()],
    semanticEvents,
    datasets: [...datasets.values()],
    technicalObservations: observations,
    scenarioSuggestions: [],
    source: "SessionTrace",
  };
}

export function attachScenarioSuggestions(
  model: SemanticRecordingModel,
  suggestions: readonly ScenarioSuggestion[],
): SemanticRecordingModel {
  return { ...model, scenarioSuggestions: [...suggestions] };
}
