import type { Page } from "@playwright/test";
import { captureAssertionObservationSnapshot, type AssertionObservationSnapshot, type SafeNetworkObservationEvent } from "./assertion-observation";
import type { AssertionPolarity, CanonicalAssertionIntent } from "../scenarios/canonical-scenario";
export type { CanonicalAssertionIntent } from "../scenarios/canonical-scenario";
import { buildRuntimeControlIdentity, matchControlIdentity, type ControlIdentity } from "../types/control-identity";

export type AdvanceControlObservation = {
  identity: string;
  tagName: string;
  role?: string;
  type?: string;
  visible: boolean;
  disabled: boolean;
  formAssociated: boolean;
  submitSemantics: boolean;
  actionPriority?: "primary" | "secondary";
  accessibleName?: string;
  selector?: string;
};

export type AdvanceCandidate = AdvanceControlObservation & {
  resolutionSource: "structured_submit_semantics" | "form_submit_control" | "semantic_action_metadata";
};

export type AdvanceControlResolutionState = "not_found" | "found_enabled" | "found_disabled" | "found_ambiguous";
export type AdvanceCausality = "causal" | "ambiguous" | "not_observed";

export type ControlledAdvanceProbeResult = {
  intent: CanonicalAssertionIntent[];
  candidateFound: boolean;
  candidateEnabled: boolean;
  attemptPossible: boolean;
  resolutionState: AdvanceControlResolutionState;
  candidateResolutionSource?: AdvanceCandidate["resolutionSource"];
  advanceActionIdentity?: string;
  attemptObserved: boolean;
  beforeCaptured: boolean;
  afterCaptured: boolean;
  before?: AssertionObservationSnapshot;
  after?: AssertionObservationSnapshot;
  networkEvents: SafeNetworkObservationEvent[];
  validationMutation: boolean;
  transitionOccurred: boolean;
  blockedObserved: boolean;
  validationObserved: boolean;
  subjectFound: boolean;
  subjectIdentity?: string;
  subjectValidationMutation: boolean;
  subjectInputApplied: boolean;
  advanceEnabledBefore?: boolean;
  advanceEnabledAfter?: boolean;
  advanceCausality: AdvanceCausality;
  otherInvalidRequiredControls: number;
  otherEmptyRequiredControls: number;
  functionalDefectAssertion13: boolean;
  evidence: string[];
};

export type ControlledAdvanceSnapshotComparison = {
  validationMutation: boolean;
  validationObserved: boolean;
  transitionOccurred: boolean;
  blockedObserved: boolean;
  subjectFound: boolean;
  subjectValidationMutation: boolean;
  advanceEnabledBefore?: boolean;
  advanceEnabledAfter?: boolean;
  advanceCausality: AdvanceCausality;
  otherInvalidRequiredControls: number;
  otherEmptyRequiredControls: number;
  functionalDefectAssertion13: boolean;
  evidence: string[];
};

function normalizeRole(value?: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function isStructurallyEligibleAdvance(control: AdvanceControlObservation): boolean {
  if (!control.visible) return false;
  const submitType = normalizeRole(control.type) === "submit";
  const submitRole = normalizeRole(control.role) === "button" && control.formAssociated;
  return control.submitSemantics || submitType || submitRole;
}

function eligibleAdvanceControls(controls: AdvanceControlObservation[]): AdvanceControlObservation[] {
  const semantic = controls.filter(isStructurallyEligibleAdvance);
  if (semantic.length > 0) return semantic;
  return controls.filter((control) =>
    control.visible
      && control.tagName === "button"
      && control.actionPriority === "primary"
      && normalizeRole(control.role) !== "checkbox"
      && normalizeRole(control.role) !== "radio",
  );
}

/**
 * Resolve only controls with structural submit authority. A visible label is
 * diagnostic context, never sufficient authority on its own.
 */
export function resolveAdvanceCandidate(
  controls: AdvanceControlObservation[],
  preferredAction?: string,
): AdvanceCandidate | undefined {
  const allEligible = eligibleAdvanceControls(controls);
  const normalizedPreferredAction = preferredAction?.trim().toLowerCase();
  const preferred = normalizedPreferredAction
    ? allEligible.filter((control) => control.accessibleName?.trim().toLowerCase() === normalizedPreferredAction)
    : [];
  const eligible = preferred.length > 0 ? preferred : allEligible;
  if (eligible.length !== 1) return undefined;
  const candidate = eligible[0];
  return {
    ...candidate,
    resolutionSource: normalizeRole(candidate.type) === "submit"
      ? "structured_submit_semantics"
      : candidate.formAssociated
        ? "form_submit_control"
        : "semantic_action_metadata",
  };
}

export function resolveAdvanceControl(
  controls: AdvanceControlObservation[],
  preferredAction?: string,
): {
  state: AdvanceControlResolutionState;
  candidate?: AdvanceCandidate;
} {
  const allEligible = eligibleAdvanceControls(controls);
  const normalizedPreferredAction = preferredAction?.trim().toLowerCase();
  const preferred = normalizedPreferredAction
    ? allEligible.filter((control) => control.accessibleName?.trim().toLowerCase() === normalizedPreferredAction)
    : [];
  const eligible = preferred.length > 0 ? preferred : allEligible;
  if (eligible.length === 0) return { state: "not_found" };
  if (eligible.length !== 1) return { state: "found_ambiguous" };
  const candidate = resolveAdvanceCandidate(eligible, preferredAction);
  if (!candidate) return { state: "found_ambiguous" };
  return { state: candidate.disabled ? "found_disabled" : "found_enabled", candidate };
}

function controlForIdentity(snapshot: AssertionObservationSnapshot, identity?: string) {
  if (!identity) return undefined;
  const matches = snapshot.controls.filter((control) => control.identity === identity);
  return matches.length === 1 ? matches[0] : undefined;
}

function observationControlIdentity(control: AssertionObservationSnapshot["controls"][number]): ControlIdentity | null {
  return buildRuntimeControlIdentity({
    tagName: control.tagName,
    inputType: control.inputType,
    role: control.role,
    name: control.name,
    id: control.id,
    ariaControls: control.ariaControls,
  });
}

function subjectControl(
  snapshot: AssertionObservationSnapshot,
  identities: string[] | undefined,
  structuredIdentities: ControlIdentity[] | undefined,
) {
  const normalized = new Set((identities ?? []).filter((identity) => identity.trim()));
  const exactMatches = normalized.size > 0
    ? snapshot.controls.filter((control) => normalized.has(control.identity))
    : [];
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return undefined;
  const structural = (structuredIdentities ?? []).filter(Boolean);
  if (structural.length === 0) return undefined;
  const matches = snapshot.controls.filter((control) => {
    const candidate = observationControlIdentity(control);
    return structural.some((identity) => matchControlIdentity(identity, candidate) === "match");
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function countOtherRequiredControls(snapshot: AssertionObservationSnapshot, subject: ReturnType<typeof subjectControl>) {
  let invalid = 0;
  let empty = 0;
  for (const control of snapshot.controls) {
    if (!control.required || control.identity === subject?.identity) continue;
    if (control.validity && !control.validity.valid || control.ariaInvalid === "true") invalid++;
    if (control.validity?.valueMissing) empty++;
  }
  return { invalid, empty };
}

function observeSubjectMutation(
  before: AssertionObservationSnapshot,
  after: AssertionObservationSnapshot,
  identities: string[] | undefined,
  structuredIdentities: ControlIdentity[] | undefined,
) {
  const beforeSubject = subjectControl(before, identities, structuredIdentities);
  const afterSubject = subjectControl(after, identities, structuredIdentities);
  if (!beforeSubject || !afterSubject) return { found: false, changed: false, invalidAfter: false, identity: undefined as string | undefined };
  const changed = beforeSubject.ariaInvalid !== afterSubject.ariaInvalid
    || beforeSubject.validationNodeIds.join(" ") !== afterSubject.validationNodeIds.join(" ")
    || beforeSubject.validity?.valid !== afterSubject.validity?.valid
    || beforeSubject.validationMessagePresent !== afterSubject.validationMessagePresent
    || beforeSubject.accessibleDescriptionPresent !== afterSubject.accessibleDescriptionPresent
    || JSON.stringify(beforeSubject.validationContext) !== JSON.stringify(afterSubject.validationContext)
    || JSON.stringify(beforeSubject.stateAttributes) !== JSON.stringify(afterSubject.stateAttributes);
  const invalidAfter = afterSubject.ariaInvalid === "true"
    || afterSubject.validity?.valid === false
    || afterSubject.validationMessagePresent === true;
  return { found: true, changed, invalidAfter, identity: afterSubject.identity };
}

export function compareControlledAdvanceSnapshots(input: {
  before: AssertionObservationSnapshot;
  after: AssertionObservationSnapshot;
  networkEvents: SafeNetworkObservationEvent[];
  attemptObserved: boolean;
  subjectIdentities?: string[];
  subjectControlIdentities?: ControlIdentity[];
  advanceActionIdentity?: string;
  triggerObservation?: { before: AssertionObservationSnapshot; after: AssertionObservationSnapshot };
  subjectInputApplied?: boolean;
}): ControlledAdvanceSnapshotComparison {
  const observedBefore = input.triggerObservation?.before ?? input.before;
  const observedAfter = input.triggerObservation?.after ?? input.after;
  const subject = observeSubjectMutation(observedBefore, observedAfter, input.subjectIdentities, input.subjectControlIdentities);
  const validationMutation = subject.changed;

  const applicationEvents = input.networkEvents.filter((event) =>
    ["fetch", "xhr"].includes(String(event.resourceType ?? "").toLowerCase()),
  );
  const validationTransport = applicationEvents.some((event) =>
    String(event.method ?? "").toUpperCase() !== "GET"
      && event.status !== undefined
      && event.status >= 400
      && event.status < 500,
  );
  const validationObserved = subject.found && (validationMutation || (validationTransport && subject.invalidAfter));

  // URL alone is not enough to prove a blocked transition. The probe requires
  // an observed attempt, a preserved form/invalid state, and validation evidence.
  const transitionOccurred = observedBefore.urlPath !== observedAfter.urlPath
    || (observedBefore.forms.length > 0 && observedAfter.forms.length === 0);
  const formPreserved = observedBefore.forms.length > 0 && observedAfter.forms.length > 0;
  const beforeAdvance = controlForIdentity(observedBefore, input.advanceActionIdentity);
  const afterAdvance = controlForIdentity(observedAfter, input.advanceActionIdentity);
  const advanceEnabledBefore = beforeAdvance ? !beforeAdvance.disabled : undefined;
  const advanceEnabledAfter = afterAdvance ? !afterAdvance.disabled : undefined;
  const other = countOtherRequiredControls(observedAfter, subjectControl(observedAfter, input.subjectIdentities, input.subjectControlIdentities));
  const advanceCausality: AdvanceCausality = subject.found && subject.changed
    && advanceEnabledBefore === true && advanceEnabledAfter === false && other.invalid === 0
    ? "causal"
    : subject.found && subject.changed
      ? "ambiguous"
      : "not_observed";
  const blockedObserved = input.attemptObserved
    && advanceCausality === "causal"
    && !transitionOccurred
    && formPreserved
    && validationObserved;
  const functionalDefectAssertion13 = Boolean(
    input.subjectInputApplied
      && input.triggerObservation
      && subject.found
      && !subject.changed
      && !subject.invalidAfter,
  );
  const evidence = [
    `attempt_observed:${input.attemptObserved}`,
    `validation_mutation:${validationMutation}`,
    `validation_transport:${validationTransport}`,
    `forbidden_transition_reached:${transitionOccurred}`,
    `form_state_preserved:${formPreserved}`,
    `subject_found:${subject.found}`,
    `subject_validation_mutation:${subject.changed}`,
    `advance_enabled_before:${advanceEnabledBefore ?? "unknown"}`,
    `advance_enabled_after:${advanceEnabledAfter ?? "unknown"}`,
    `advance_causality:${advanceCausality}`,
    `other_invalid_required_controls:${other.invalid}`,
    `other_empty_required_controls:${other.empty}`,
  ];
  return {
    validationMutation,
    validationObserved,
    transitionOccurred,
    blockedObserved,
    subjectFound: subject.found,
    subjectValidationMutation: subject.changed,
    advanceEnabledBefore,
    advanceEnabledAfter,
    advanceCausality,
    otherInvalidRequiredControls: other.invalid,
    otherEmptyRequiredControls: other.empty,
    functionalDefectAssertion13,
    evidence,
  };
}

type RuntimeAdvancePage = Pick<Page, "evaluate" | "locator" | "getByRole" | "waitForLoadState" | "waitForTimeout" | "url" | "on" | "off">;

function selectorForControl(control: AdvanceControlObservation): string | undefined {
  return typeof control.selector === "string" && control.selector.trim() ? control.selector.trim() : undefined;
}

async function clickAdvanceCandidate(page: RuntimeAdvancePage, candidate: AdvanceCandidate): Promise<void> {
  const selector = selectorForControl(candidate);
  if (selector) {
    await page.locator(selector).click({ timeout: 3000 });
    return;
  }
  if (candidate.accessibleName) {
    await page.getByRole("button", { name: candidate.accessibleName, exact: true }).click({ timeout: 3000 });
    return;
  }
  throw new Error("advance_candidate_not_clickable");
}

/**
 * Executes one bounded, structurally-authorized advance attempt. This helper
 * never searches for a business label and never clicks by ordinal position.
 */
export async function runControlledAdvanceProbe(input: {
  page: RuntimeAdvancePage;
  intent: CanonicalAssertionIntent[];
  advanceAction?: string;
  subjectIdentities?: string[];
  subjectControlIdentities?: ControlIdentity[];
  subjectInputApplied?: boolean;
  triggerObservation?: { before: AssertionObservationSnapshot; after: AssertionObservationSnapshot };
}): Promise<ControlledAdvanceProbeResult> {
  const empty = {
    intent: input.intent,
    candidateFound: false,
    candidateEnabled: false,
    attemptPossible: false,
    resolutionState: "not_found",
    attemptObserved: false,
    beforeCaptured: false,
    afterCaptured: false,
    networkEvents: [] as SafeNetworkObservationEvent[],
    validationMutation: false,
    transitionOccurred: false,
    blockedObserved: false,
    validationObserved: false,
    subjectFound: false,
    subjectValidationMutation: false,
    subjectInputApplied: Boolean(input.subjectInputApplied),
    advanceCausality: "not_observed",
    otherInvalidRequiredControls: 0,
    otherEmptyRequiredControls: 0,
    functionalDefectAssertion13: false,
    evidence: [],
  } satisfies ControlledAdvanceProbeResult;
  if (input.intent.length === 0) return empty;

  const controls = await input.page.evaluate(function collectAdvanceControls() {
    const controls: AdvanceControlObservation[] = [];
    for (const element of Array.from(document.querySelectorAll("button, input, [role=button]"))) {
      const html = element as HTMLButtonElement & HTMLInputElement;
      const tagName = element.tagName.toLowerCase();
      const style = window.getComputedStyle(element as HTMLElement);
      const rect = element.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || rect.width <= 0 || rect.height <= 0) continue;
      const role = element.getAttribute("role") ?? undefined;
      const type = element.getAttribute("type") ?? undefined;
      const form = (element as HTMLButtonElement).form ?? element.closest("form");
      const formAssociated = Boolean(form);
      const submitSemantics = type === "submit"
        || (formAssociated && (tagName === "button" || role === "button"));
      const backgroundColor = style.backgroundColor.toLowerCase().replace(/\s+/g, "");
      const opaqueBackground = backgroundColor !== "transparent"
        && backgroundColor !== "rgba(0,0,0,0)"
        && !backgroundColor.endsWith(",0)")
        && !backgroundColor.includes("255,255,255");
      const actionPriority = opaqueBackground ? "primary" as const : "secondary" as const;
      const id = element.getAttribute("id");
      const testId = element.getAttribute("data-testid");
      const name = element.getAttribute("name");
      const selector = id
        ? `#${CSS.escape(id)}`
        : testId
          ? `[data-testid="${CSS.escape(testId)}"]`
          : name
            ? `${tagName}[name="${CSS.escape(name)}"]`
            : type === "submit"
              ? `${tagName}[type="submit"]`
              : undefined;
      controls.push({
        identity: [tagName, id ? `id=${id}` : "", testId ? `testid=${testId}` : "", name ? `name=${name}` : "", role ? `role=${role}` : "", type ? `type=${type}` : ""]
          .filter(Boolean)
          .join("|"),
        tagName,
        ...(role ? { role } : {}),
        ...(type ? { type } : {}),
        visible: true,
        disabled: (html.disabled === true) || element.getAttribute("aria-disabled") === "true",
        formAssociated,
        submitSemantics,
        actionPriority,
        ...(element.getAttribute("aria-label") || element.textContent?.trim()
          ? { accessibleName: element.getAttribute("aria-label") ?? element.textContent?.trim() }
          : {}),
        ...(selector ? { selector } : {}),
      });
    }
    return controls;
  });
  const resolution = resolveAdvanceControl(controls, input.advanceAction);
  if (!resolution.candidate) return { ...empty, resolutionState: resolution.state, evidence: [`advance_candidate_${resolution.state}`] };
  const candidate = resolution.candidate;
  const candidateEnabled = !candidate.disabled;

  const before = await captureAssertionObservationSnapshot(input.page).catch(() => undefined);
  if (!before) return { ...empty, candidateFound: true, candidateEnabled, attemptPossible: candidateEnabled, resolutionState: resolution.state, candidateResolutionSource: candidate.resolutionSource, advanceActionIdentity: candidate.identity, evidence: ["before_snapshot_unavailable"] };

  if (!candidateEnabled) {
    const comparison = compareControlledAdvanceSnapshots({
      before,
      after: before,
      networkEvents: [],
      attemptObserved: false,
      subjectIdentities: input.subjectIdentities,
      subjectControlIdentities: input.subjectControlIdentities,
      advanceActionIdentity: candidate.identity,
      triggerObservation: input.triggerObservation,
      subjectInputApplied: input.subjectInputApplied,
    });
    return {
      ...empty,
      candidateFound: true,
      candidateEnabled: false,
      attemptPossible: false,
      resolutionState: resolution.state,
      candidateResolutionSource: candidate.resolutionSource,
      advanceActionIdentity: candidate.identity,
      attemptObserved: false,
      beforeCaptured: true,
      afterCaptured: true,
      before: input.triggerObservation?.before ?? before,
      after: input.triggerObservation?.after ?? before,
      validationMutation: comparison.validationMutation,
      transitionOccurred: comparison.transitionOccurred,
      blockedObserved: false,
      validationObserved: comparison.validationObserved,
      subjectFound: comparison.subjectFound,
      subjectIdentity: input.subjectIdentities?.length === 1 ? input.subjectIdentities[0] : undefined,
      subjectValidationMutation: comparison.subjectValidationMutation,
      advanceEnabledBefore: comparison.advanceEnabledBefore,
      advanceEnabledAfter: comparison.advanceEnabledAfter,
      advanceCausality: comparison.advanceCausality,
      otherInvalidRequiredControls: comparison.otherInvalidRequiredControls,
      otherEmptyRequiredControls: comparison.otherEmptyRequiredControls,
      functionalDefectAssertion13: comparison.functionalDefectAssertion13,
      evidence: ["advance_control_found_disabled", "advance_attempt_not_possible", ...comparison.evidence],
    };
  }

  const events = new Map<object, SafeNetworkObservationEvent>();
  const onRequest = (request: any) => {
    events.set(request, { method: request.method(), resourceType: request.resourceType(), state: "pending" });
  };
  const onResponse = (response: any) => {
    const event = events.get(response.request());
    if (event) {
      event.state = "completed";
      event.status = response.status();
    }
  };
  const onRequestFailed = (request: any) => {
    const event = events.get(request);
    if (event) event.state = "failed";
  };
  input.page.on("request", onRequest);
  input.page.on("response", onResponse);
  input.page.on("requestfailed", onRequestFailed);

  let attemptObserved = false;
  try {
    await clickAdvanceCandidate(input.page, candidate);
    attemptObserved = true;
    await input.page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => undefined);
    await input.page.waitForTimeout(500);
  } catch {
    attemptObserved = false;
  } finally {
    input.page.off("request", onRequest);
    input.page.off("response", onResponse);
    input.page.off("requestfailed", onRequestFailed);
  }

  const after = await captureAssertionObservationSnapshot(input.page).catch(() => undefined);
  const networkEvents = [...events.values()];
  if (!after) {
    return {
      ...empty,
      candidateFound: true,
      candidateEnabled: true,
      attemptPossible: true,
      resolutionState: resolution.state,
      candidateResolutionSource: candidate.resolutionSource,
      advanceActionIdentity: candidate.identity,
      attemptObserved,
      beforeCaptured: true,
      evidence: ["after_snapshot_unavailable"],
      networkEvents,
      subjectInputApplied: Boolean(input.subjectInputApplied),
    };
  }
  const comparison = compareControlledAdvanceSnapshots({
    before,
    after,
    networkEvents,
    attemptObserved,
    subjectIdentities: input.subjectIdentities,
    subjectControlIdentities: input.subjectControlIdentities,
    advanceActionIdentity: candidate.identity,
    subjectInputApplied: input.subjectInputApplied,
  });
  return {
    ...empty,
    candidateFound: true,
    candidateEnabled: true,
    attemptPossible: true,
    resolutionState: resolution.state,
    candidateResolutionSource: candidate.resolutionSource,
    advanceActionIdentity: candidate.identity,
    attemptObserved,
    beforeCaptured: true,
    afterCaptured: true,
    before,
    after,
    networkEvents,
    validationMutation: comparison.validationMutation,
    transitionOccurred: comparison.transitionOccurred,
    blockedObserved: comparison.blockedObserved,
    validationObserved: comparison.validationObserved,
    subjectFound: comparison.subjectFound,
    subjectIdentity: input.subjectIdentities?.length === 1 ? input.subjectIdentities[0] : undefined,
    subjectValidationMutation: comparison.subjectValidationMutation,
    advanceEnabledBefore: comparison.advanceEnabledBefore,
    advanceEnabledAfter: comparison.advanceEnabledAfter,
    advanceCausality: comparison.advanceCausality,
    otherInvalidRequiredControls: comparison.otherInvalidRequiredControls,
    otherEmptyRequiredControls: comparison.otherEmptyRequiredControls,
    functionalDefectAssertion13: comparison.functionalDefectAssertion13,
    evidence: comparison.evidence,
  };
}

export function buildControlledAdvanceProbeOracles(input: {
  result: ControlledAdvanceProbeResult;
  assertions: Array<{ index: number; requirement: string; requirementRefs?: string[]; intent: CanonicalAssertionIntent; polarity?: AssertionPolarity }>;
}) {
  const { result } = input;
  return input.assertions.map((assertion) => {
    const validationIntent = assertion.intent === "validation_present";
    return {
      id: `controlled-advance-${assertion.intent}-${assertion.index}`,
      requirement: assertion.requirement,
      type: "runtime_state" as const,
      backed: validationIntent ? result.validationObserved : result.blockedObserved,
      source: "discovery" as const,
      stepIndex: assertion.index,
      requirementRefs: assertion.requirementRefs,
      ...(assertion.polarity ? { polarity: assertion.polarity } : {}),
      evidence: validationIntent
        ? (result.validationObserved
          ? ["controlled_advance_probe", "validation_present", ...result.evidence]
          : ["controlled_advance_probe", "validation_not_observed", ...result.evidence])
        : (result.blockedObserved
          ? ["controlled_advance_probe", "transition_blocked", ...result.evidence]
          : ["controlled_advance_probe", "transition_blocked_not_observed", ...result.evidence]),
      details: {
        stateKind: validationIntent ? "controlled_advance_validation" : "controlled_advance_transition",
        candidateFound: result.candidateFound,
        candidateEnabled: result.candidateEnabled,
        attemptPossible: result.attemptPossible,
        resolutionState: result.resolutionState,
        attemptObserved: result.attemptObserved,
        subjectFound: result.subjectFound,
        subjectValidationMutation: result.subjectValidationMutation,
        validationMutation: result.validationMutation,
        transitionOccurred: result.transitionOccurred,
        blockedObserved: result.blockedObserved,
        advanceCausality: result.advanceCausality,
        otherInvalidRequiredControls: result.otherInvalidRequiredControls,
        otherEmptyRequiredControls: result.otherEmptyRequiredControls,
      },
    };
  });
}
