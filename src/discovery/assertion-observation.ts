import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type AssertionObservationPage = {
  url(): string;
  evaluate<T>(pageFunction: () => T): Promise<T>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type ObservationControlState = {
  identity: string;
  tagName: string;
  inputType?: string;
  name?: string;
  id?: string;
  ariaControls?: string;
  role?: string;
  ariaInvalid?: string;
  ariaDescribedBy?: string;
  ariaErrorMessage?: string;
  disabled: boolean;
  required: boolean;
  focused: boolean;
  /** Redacted value identity used only to detect same-control mutations; never the value itself. */
  valueFingerprint?: string;
  validity?: { valid: boolean; valueMissing: boolean; typeMismatch: boolean; patternMismatch: boolean };
  validationMessagePresent?: boolean;
  patternPresent?: boolean;
  minLength?: number;
  maxLength?: number;
  customValidityPresent?: boolean;
  stateAttributes?: Record<string, string>;
  accessibleDescriptionPresent?: boolean;
  validationContext?: {
    ancestorTag: string;
    nodeCount: number;
    textLength: number;
    structure: string;
  };
  siblingIdentities?: string[];
  validationNodeIds: string[];
};

export type AssertionObservationSnapshot = {
  urlPath: string;
  focusedIdentity?: string;
  controls: ObservationControlState[];
  validationNodes: Array<{ identity: string; role?: string; ariaLive?: string; id?: string }>;
  forms: Array<{ identity: string; valid: boolean }>;
  requiredControls?: { total: number; invalid: number; empty: number };
  /**
   * DIAGNOSTIC ONLY (redacted, never a value). A structured fingerprint of elements that can carry
   * functional state through a channel the `controls` selector does not cover (ARIA value/state,
   * contenteditable, a data display attribute). Captured so a physical run can NAME the exact node
   * kind and property that changed WITHOUT ever serializing the value. It never participates in
   * `diffAssertionObservation` nor in the snapshot `fingerprint`, so it cannot change completion
   * behavior.
   */
  stateCandidates?: ObservationStateCandidate[];
  fingerprint: string;
};

export type ObservationStateCandidate = {
  tag: string;
  role?: string;
  inputType?: string;
  contentEditable: boolean;
  /** Stable redacted structural identity used to pair the same node across before/after snapshots. */
  identity?: string;
  /** Local structural owner used only to group related text carriers from the same field region. */
  scopeIdentity?: string;
  /** Stable nearest-ancestor signatures; used only when adjacent text carriers split across nodes. */
  scopeIdentities?: string[];
  propertyFingerprints: Record<string, string>;
};

export type StateCandidateMutation = {
  tag: string;
  role?: string;
  inputType?: string;
  contentEditable: boolean;
  identity?: string;
  scopeIdentity?: string;
  scopeIdentities?: string[];
  changedProperties: string[];
  fingerprintBefore: string;
  fingerprintAfter: string;
};

export type AssertionObservationDiff = {
  changed: boolean;
  changedPaths: string[];
  validationMutation: boolean;
  accessibilityMutation: boolean;
  navigationMutation: boolean;
  formStateChanged: boolean;
  /**
   * Causal structured-state mutation: exactly ONE state candidate that existed before the action
   * changed one of its observed properties (text/ARIA value/state) between the before and after
   * snapshots. This is the signal for a same-surface action that mutates a related display/control
   * without navigation/network/a newly-visible next target. Fail-closed: more than one changed
   * candidate, or a node that only appeared after the action, does not satisfy it.
   */
  stateMutation: boolean;
  stateMutationProperties: string[];
  networkActivityDetected: boolean;
};

export type AssertionObservationArtifact = {
  version: "1.0";
  scenarioId?: string;
  caseId?: number;
  requirementId?: string;
  requirementRefs?: string[];
  polarity?: "positive" | "negative";
  triggerActionIdentity: { action: string; stepIndex?: number; target?: string };
  before: AssertionObservationSnapshot;
  after: AssertionObservationSnapshot;
  mutation: AssertionObservationDiff;
  network: { eventCount: number; classification: "lookup" | "validation" | "submit" | "navigation" | "unknown" };
  candidate?: { oracleType: string; targetIdentity?: string; confidence: number; source: string };
  createdAt: string;
  runId?: string;
};

export type SafeNetworkObservationEvent = {
  method?: string;
  resourceType?: string;
  state?: string;
  status?: number;
};

export type NetworkObservationClassification = AssertionObservationArtifact["network"]["classification"];

/**
 * Classifies only when transport metadata is sufficient. It deliberately does
 * not inspect URLs, request bodies, response bodies, or application labels.
 */
export function classifyNetworkActivity(
  events: SafeNetworkObservationEvent[],
  beforePath?: string,
  afterPath?: string,
): NetworkObservationClassification {
  if (events.length === 0) return "unknown";
  const normalized = events.map((event) => ({
    method: (event.method ?? "GET").toUpperCase(),
    resourceType: (event.resourceType ?? "").toLowerCase(),
    state: (event.state ?? "").toLowerCase(),
    status: event.status,
  }));
  if (beforePath && afterPath && beforePath !== afterPath && normalized.some((event) => event.resourceType === "document")) {
    return "navigation";
  }
  const applicationEvents = normalized.filter((event) => event.resourceType === "fetch" || event.resourceType === "xhr");
  if (applicationEvents.length === 0) return "unknown";
  if (applicationEvents.every((event) => ["GET", "HEAD"].includes(event.method))) return "lookup";
  if (applicationEvents.some((event) => ["POST", "PUT", "PATCH", "DELETE"].includes(event.method))) {
    const completed = applicationEvents.filter((event) => event.state === "completed");
    if (completed.length === applicationEvents.length && applicationEvents.some((event) => event.status !== undefined && event.status >= 400 && event.status < 500)) {
      return "validation";
    }
    if (completed.length === applicationEvents.length) return "submit";
  }
  return "unknown";
}

type RawObservationSnapshot = Omit<AssertionObservationSnapshot, "fingerprint">;

function safePath(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname || "/";
  } catch {
    return "/";
  }
}

function fingerprint(snapshot: Omit<RawObservationSnapshot, "stateCandidates">): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 16);
}

export async function captureAssertionObservationSnapshot(
  page: AssertionObservationPage,
): Promise<AssertionObservationSnapshot> {
  const rawEvaluator = function captureRawObservation() {
    const validationSelector = "[role=alert], [aria-live], [aria-errormessage], [data-validation], .error, .invalid";
    const validationIds = new Set<string>();
    for (const node of Array.from(document.querySelectorAll("[role=alert], [aria-live], [aria-errormessage], [data-validation], .error, .invalid"))) {
      const id = node.getAttribute("id");
      if (id) validationIds.add(id);
    }
    const controls: ObservationControlState[] = [];
    // Use named object methods instead of const-bound functions here: tsx/esbuild's
    // keepNames transform injects its module-local `__name` helper into closures, but
    // Playwright serializes this evaluator into the page where that helper does not exist.
    const fingerprintValue = {
      hash(value: string) {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
          hash ^= value.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
        return `${value.length}:${hash >>> 0}`;
      },
    }.hash;
    // Playwright's semantic locators can resolve controls inside open shadow roots, while
    // document.querySelectorAll cannot. Walk those roots for observation too, so a state change
    // visible to the resolver is not invisible to the shared post-action observer.
    const queryAllOpenShadowRoots = {
      query(selector: string): Element[] {
        const matches: Element[] = [];
        const roots: Array<Document | ShadowRoot> = [document];
        for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
          const root = roots[rootIndex];
          matches.push(...Array.from(root.querySelectorAll(selector)));
          for (const host of Array.from(root.querySelectorAll("*"))) {
            const shadowRoot = (host as HTMLElement).shadowRoot;
            if (shadowRoot) roots.push(shadowRoot);
          }
        }
        return matches;
      },
    }.query;
    for (const element of Array.from(document.querySelectorAll("input, select, textarea, button, [role=button], [role=combobox], [role=checkbox], [role=radio]")).slice(0, 120)) {
        const tag = element.tagName.toLowerCase();
        const elementId = element.getAttribute("id");
        const testId = element.getAttribute("data-testid");
        const name = element.getAttribute("name");
        const role = element.getAttribute("role");
        const elementIdentity = [tag, elementId ? `id=${elementId}` : "", testId ? `testid=${testId}` : "", name ? `name=${name}` : "", role ? `role=${role}` : ""]
          .filter(Boolean)
          .join("|") || tag;
        const html = element as HTMLElement & { validity?: ValidityState; disabled?: boolean; required?: boolean };
        const inputLike = element as HTMLInputElement;
        const observedValue = "value" in element
          ? String(inputLike.value ?? "")
          : element.getAttribute("contenteditable") === "true"
            ? element.textContent ?? ""
            : "";
        const describedBy = element.getAttribute("aria-describedby") ?? "";
        const describedValidationIds: string[] = [];
        for (const id of describedBy.split(/\s+/)) {
          if (validationIds.has(id)) describedValidationIds.push(id);
        }
        const validity = html.validity;
        const stateAttributes: Record<string, string> = {};
        for (const attribute of ["data-state", "data-invalid", "data-validation-state", "aria-busy", "aria-disabled"]) {
          const value = element.getAttribute(attribute);
          if (value !== null) stateAttributes[attribute] = value;
        }
        const siblingIdentities: string[] = [];
        const parent = element.parentElement;
        if (parent) {
          for (const sibling of Array.from(parent.children).slice(0, 20)) {
            const siblingTag = sibling.tagName.toLowerCase();
            const siblingId = sibling.getAttribute("id");
            const siblingTestId = sibling.getAttribute("data-testid");
            const siblingName = sibling.getAttribute("name");
            const siblingRole = sibling.getAttribute("role");
            const siblingType = sibling.getAttribute("type");
            siblingIdentities.push([
              siblingTag,
              siblingId ? `id=${siblingId}` : "",
              siblingTestId ? `testid=${siblingTestId}` : "",
              siblingName ? `name=${siblingName}` : "",
              siblingRole ? `role=${siblingRole}` : "",
              siblingType ? `type=${siblingType}` : "",
            ].filter(Boolean).join("|") || siblingTag);
          }
        }
        let validationContext: ObservationControlState["validationContext"];
        let validationAncestor = element.parentElement;
        for (let depth = 0; validationAncestor && depth < 8; depth++, validationAncestor = validationAncestor.parentElement) {
          const validationContextNodes = Array.from(validationAncestor.querySelectorAll(validationSelector));
          if (validationContextNodes.length === 0) continue;
          const structure = validationContextNodes.map((node) => [
            node.tagName.toLowerCase(),
            node.getAttribute("role") ?? "",
            node.getAttribute("aria-live") ?? "",
            node.getAttribute("id") ?? "",
            node.children.length,
            (node.textContent ?? "").trim().length,
          ].join(":"))
            .join("|");
          validationContext = {
            ancestorTag: validationAncestor.tagName.toLowerCase(),
            nodeCount: validationContextNodes.length,
            textLength: validationContextNodes.reduce((total, node) => total + (node.textContent ?? "").trim().length, 0),
            structure,
          };
          break;
        }
        controls.push({
          identity: [elementIdentity, element.getAttribute("type") ? `type=${element.getAttribute("type")}` : ""]
            .filter(Boolean)
            .join("|"),
          tagName: element.tagName.toLowerCase(),
          ...(element.getAttribute("type") ? { inputType: element.getAttribute("type")! } : {}),
          ...(name ? { name } : {}),
          ...(elementId ? { id: elementId } : {}),
          ...(element.getAttribute("aria-controls") ? { ariaControls: element.getAttribute("aria-controls")! } : {}),
          ...(element.getAttribute("role") ? { role: element.getAttribute("role")! } : {}),
          ...(element.getAttribute("aria-invalid") ? { ariaInvalid: element.getAttribute("aria-invalid")! } : {}),
          ...(describedBy ? { ariaDescribedBy: describedBy } : {}),
          ...(element.getAttribute("aria-errormessage") ? { ariaErrorMessage: element.getAttribute("aria-errormessage")! } : {}),
          disabled: html.disabled === true || element.getAttribute("aria-disabled") === "true",
          required: html.required === true || element.getAttribute("aria-required") === "true",
          focused: document.activeElement === element,
          valueFingerprint: fingerprintValue(observedValue),
          ...(validity ? { validity: { valid: validity.valid, valueMissing: validity.valueMissing, typeMismatch: validity.typeMismatch, patternMismatch: validity.patternMismatch } } : {}),
          ...(typeof inputLike.validationMessage === "string" ? { validationMessagePresent: inputLike.validationMessage.length > 0 } : {}),
          ...(element.getAttribute("pattern") !== null ? { patternPresent: true } : {}),
          ...(typeof inputLike.minLength === "number" && inputLike.minLength >= 0 ? { minLength: inputLike.minLength } : {}),
          ...(typeof inputLike.maxLength === "number" && inputLike.maxLength >= 0 ? { maxLength: inputLike.maxLength } : {}),
          ...(typeof inputLike.validationMessage === "string" ? { customValidityPresent: inputLike.validationMessage.length > 0 && Boolean(validity) && !validity!.valueMissing && !validity!.typeMismatch && !validity!.patternMismatch } : {}),
          ...(Object.keys(stateAttributes).length > 0 ? { stateAttributes } : {}),
          ...(describedBy || element.getAttribute("aria-errormessage") ? { accessibleDescriptionPresent: true } : {}),
          ...(validationContext ? { validationContext } : {}),
          ...(siblingIdentities.length > 0 ? { siblingIdentities } : {}),
          validationNodeIds: describedValidationIds,
        });
    }
    // DIAGNOSTIC ONLY (never the value): bounded, redacted fingerprints of structured state
    // carriers OUTSIDE the `controls` selector, so a physical run can name which node kind/property
    // actually changed without serializing anything. Excluded from the snapshot fingerprint.
    const stateCandidates: ObservationStateCandidate[] = [];
    // Include native form controls even when their implicit accessibility role is not reflected
    // by a `role` attribute. Their values are fingerprinted below and never serialized.
    const stateCandidateSelector = "input, select, textarea, [role=textbox], [role=spinbutton], [role=slider], [role=progressbar], [contenteditable=''], [contenteditable=true], [aria-valuetext], [aria-valuenow], [data-display-value], output";
    const statePropertyReaders: Array<[string, (element: Element) => string | null]> = [
      ["value", (element) => ("value" in element ? String((element as HTMLInputElement).value ?? "") : null)],
      ["textContent", (element) => (element.textContent ?? "").trim() || null],
      ["ariaValueText", (element) => element.getAttribute("aria-valuetext")],
      ["ariaValueNow", (element) => element.getAttribute("aria-valuenow")],
      ["ariaLabel", (element) => element.getAttribute("aria-label")],
      ["dataDisplayValue", (element) => element.getAttribute("data-display-value")],
      ["ariaDisabled", (element) => element.getAttribute("aria-disabled")],
      ["ariaSelected", (element) => element.getAttribute("aria-selected")],
      ["ariaChecked", (element) => element.getAttribute("aria-checked")],
      ["ariaPressed", (element) => element.getAttribute("aria-pressed")],
      ["ariaExpanded", (element) => element.getAttribute("aria-expanded")],
    ];
    for (const element of queryAllOpenShadowRoots(stateCandidateSelector).slice(0, 40)) {
      const propertyFingerprints: Record<string, string> = {};
      for (const [propertyName, read] of statePropertyReaders) {
        let observed: string | null = null;
        try { observed = read(element); } catch { observed = null; }
        if (observed === null) continue;
        propertyFingerprints[propertyName] = fingerprintValue(observed);
      }
      stateCandidates.push({
        tag: element.tagName.toLowerCase(),
        ...(element.getAttribute("role") ? { role: element.getAttribute("role")! } : {}),
        ...(element.getAttribute("type") ? { inputType: element.getAttribute("type")! } : {}),
        contentEditable: (element as HTMLElement).isContentEditable === true
          || element.getAttribute("contenteditable") === "true" || element.getAttribute("contenteditable") === "",
        identity: [
          element.tagName.toLowerCase(),
          element.getAttribute("id") ? `id=${element.getAttribute("id")}` : "",
          element.getAttribute("data-testid") ? `testid=${element.getAttribute("data-testid")}` : "",
          element.getAttribute("role") ? `role=${element.getAttribute("role")}` : "",
          element.getAttribute("type") ? `type=${element.getAttribute("type")}` : "",
        ].filter(Boolean).join("|"),
        scopeIdentity: [
          element.tagName.toLowerCase(),
          element.getAttribute("id") ? `id=${element.getAttribute("id")}` : "",
          element.getAttribute("data-testid") ? `testid=${element.getAttribute("data-testid")}` : "",
          element.getAttribute("role") ? `role=${element.getAttribute("role")}` : "",
        ].filter(Boolean).join("|"),
        propertyFingerprints,
      });
    }
    // Bounded, redacted text-state carriers: non-interactive elements whose visible text is the
    // functional state a same-surface action mutates (a display, a masked amount, a counter). Not a
    // global page hash -- each node is fingerprinted individually and keyed by its own structural
    // identity; the value is never serialized. These never join the `controls`/validation diff and
    // never participate in the snapshot fingerprint (only in `stateMutation`/`diffStateCandidates`).
    const textCarrierSelector = "div, span, p, b, strong, em, i, small, h1, h2, h3, h4, h5, h6, td, th, output, [data-testid], [id]";
    const interactiveSelector = "input, select, textarea, button, [role=button], [role=combobox], [role=checkbox], [role=radio], [role=link], a, [contenteditable=''], [contenteditable=true]";
    const isInteractiveInComposedTree = {
      check(element: Element): boolean {
        let current: Element | null = element;
        while (current) {
          if (current.matches(interactiveSelector)) return true;
          const root = current.getRootNode() as ShadowRoot;
          current = current.parentElement ?? root.host ?? null;
        }
        return false;
      },
    }.check;
    let textCarrierCandidateCount = 0;
    for (const element of queryAllOpenShadowRoots(textCarrierSelector)) {
      if (textCarrierCandidateCount >= 80 || stateCandidates.length >= 120) break;
      // Observe a non-interactive display nested inside an interactive composite (for example, a
      // button-based keypad with a separate text readout). The display itself is not the clicked
      // control; its redacted leaf-state change remains subject to the single-candidate diff gate.
      if (element.matches(interactiveSelector)) continue;
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      // Parent containers duplicate a descendant display's textContent and would turn one real
      // value change into several apparent mutations. Keep the deepest text-bearing carrier.
      const hasTextBearingChild = Array.from(element.children).some((child) =>
        (child.textContent ?? "").replace(/\s+/g, " ").trim().length > 0,
      );
      if (hasTextBearingChild) continue;
      // Stable identity deliberately EXCLUDES className (a class toggle is an irrelevant style
      // change and must never break the before/after pairing of the same state node).
      const parent = element.parentElement;
      const parentIdentity = parent
        ? [
            parent.tagName.toLowerCase(),
            parent.getAttribute("id") ? `id=${parent.getAttribute("id")}` : "",
            parent.getAttribute("data-testid") ? `testid=${parent.getAttribute("data-testid")}` : "",
            parent.getAttribute("role") ? `role=${parent.getAttribute("role")}` : "",
          ].filter(Boolean).join("|")
        : "";
      const siblingTextContext = parent
        ? Array.from(parent.children)
            .filter((sibling) => sibling !== element && !isInteractiveInComposedTree(sibling))
            .map((sibling) => (sibling.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .map((siblingText) => fingerprintValue(siblingText))
            .sort()
            .join(".")
        : "";
      const identity = [
        element.tagName.toLowerCase(),
        element.getAttribute("id") ? `id=${element.getAttribute("id")}` : "",
        element.getAttribute("data-testid") ? `testid=${element.getAttribute("data-testid")}` : "",
        element.getAttribute("role") ? `role=${element.getAttribute("role")}` : "",
        parentIdentity ? `parent=${parentIdentity}` : "",
        siblingTextContext ? `siblings=${siblingTextContext}` : "",
      ].filter(Boolean).join("|");
      const scopeIdentities: string[] = [];
      let scopeNode = parent;
      for (let depth = 0; scopeNode && depth < 8; depth++, scopeNode = scopeNode.parentElement) {
        const childStructure = Array.from(scopeNode.children).map((child) => [
          child.tagName.toLowerCase(),
          child.getAttribute("id") ? `id=${child.getAttribute("id")}` : "",
          child.getAttribute("data-testid") ? `testid=${child.getAttribute("data-testid")}` : "",
          child.getAttribute("role") ? `role=${child.getAttribute("role")}` : "",
        ].filter(Boolean).join("|")).sort().join(",");
        scopeIdentities.push([
          scopeNode.tagName.toLowerCase(),
          scopeNode.getAttribute("id") ? `id=${scopeNode.getAttribute("id")}` : "",
          scopeNode.getAttribute("data-testid") ? `testid=${scopeNode.getAttribute("data-testid")}` : "",
          scopeNode.getAttribute("role") ? `role=${scopeNode.getAttribute("role")}` : "",
          `children=${childStructure}`,
        ].filter(Boolean).join("|"));
      }
      textCarrierCandidateCount++;
      const textCarrierProperties: Record<string, string> = { textContent: fingerprintValue(text) };
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel !== null) textCarrierProperties.ariaLabel = fingerprintValue(ariaLabel);
      stateCandidates.push({
        tag: element.tagName.toLowerCase(),
        ...(element.getAttribute("role") ? { role: element.getAttribute("role")! } : {}),
        contentEditable: false,
        identity,
        scopeIdentity: parentIdentity || identity,
        ...(scopeIdentities.length > 0 ? { scopeIdentities } : {}),
        propertyFingerprints: textCarrierProperties,
      });
    }
    const validationNodes: AssertionObservationSnapshot["validationNodes"] = [];
    for (const node of Array.from(document.querySelectorAll("[role=alert], [aria-live], [aria-errormessage], [data-validation], .error, .invalid")).slice(0, 80)) {
      const tag = node.tagName.toLowerCase();
      const nodeId = node.getAttribute("id");
      const nodeTestId = node.getAttribute("data-testid");
      const nodeName = node.getAttribute("name");
      const nodeRole = node.getAttribute("role");
      validationNodes.push({
        identity: [tag, nodeId ? `id=${nodeId}` : "", nodeTestId ? `testid=${nodeTestId}` : "", nodeName ? `name=${nodeName}` : "", nodeRole ? `role=${nodeRole}` : ""]
          .filter(Boolean)
          .join("|") || tag,
        ...(node.getAttribute("role") ? { role: node.getAttribute("role")! } : {}),
        ...(node.getAttribute("aria-live") ? { ariaLive: node.getAttribute("aria-live")! } : {}),
        ...(node.getAttribute("id") ? { id: node.getAttribute("id")! } : {}),
      });
    }
    const forms: AssertionObservationSnapshot["forms"] = [];
    for (const form of Array.from(document.querySelectorAll("form")).slice(0, 40)) {
      const tag = form.tagName.toLowerCase();
      const formId = form.getAttribute("id");
      const formTestId = form.getAttribute("data-testid");
      const formName = form.getAttribute("name");
      const formRole = form.getAttribute("role");
      forms.push({
        identity: [tag, formId ? `id=${formId}` : "", formTestId ? `testid=${formTestId}` : "", formName ? `name=${formName}` : "", formRole ? `role=${formRole}` : ""]
          .filter(Boolean)
          .join("|") || tag,
        valid: (form as HTMLFormElement).checkValidity(),
      });
    }
    let requiredTotal = 0;
    let requiredInvalid = 0;
    let requiredEmpty = 0;
    for (const control of controls) {
      if (!control.required) continue;
      requiredTotal++;
      if (control.validity && !control.validity.valid || control.ariaInvalid === "true") requiredInvalid++;
      if (control.validity?.valueMissing) requiredEmpty++;
    }
    let focused: string | undefined;
    if (document.activeElement && document.activeElement !== document.body) {
      const element = document.activeElement;
      const tag = element.tagName.toLowerCase();
      const elementId = element.getAttribute("id");
      const testId = element.getAttribute("data-testid");
      const name = element.getAttribute("name");
      const role = element.getAttribute("role");
      focused = [tag, elementId ? `id=${elementId}` : "", testId ? `testid=${testId}` : "", name ? `name=${name}` : "", role ? `role=${role}` : ""]
        .filter(Boolean)
        .join("|") || tag;
    }
    return {
      urlPath: location.pathname || "/",
      ...(focused ? { focusedIdentity: focused } : {}),
      controls,
      ...(stateCandidates.length > 0 ? { stateCandidates } : {}),
      validationNodes,
      forms,
      requiredControls: { total: requiredTotal, invalid: requiredInvalid, empty: requiredEmpty },
    };
  };
  const raw = await page.evaluate<RawObservationSnapshot>(rawEvaluator);
  // `stateCandidates` is diagnostic-only: it is deliberately excluded from the snapshot
  // fingerprint so its presence can never alter a completion/identity decision.
  const { stateCandidates, ...fingerprintInput } = raw;
  return { ...raw, fingerprint: fingerprint(fingerprintInput) };
}

export function diffAssertionObservation(
  before: AssertionObservationSnapshot,
  after: AssertionObservationSnapshot,
  networkActivityDetected = false,
): AssertionObservationDiff {
  const changedPaths: string[] = [];
  if (before.urlPath !== after.urlPath) changedPaths.push("urlPath");
  if (before.focusedIdentity !== after.focusedIdentity) changedPaths.push("focusedIdentity");
  if (JSON.stringify(before.controls) !== JSON.stringify(after.controls)) changedPaths.push("controls");
  if (JSON.stringify(before.validationNodes) !== JSON.stringify(after.validationNodes)) changedPaths.push("validationNodes");
  if (JSON.stringify(before.forms) !== JSON.stringify(after.forms)) changedPaths.push("forms");
  const validationMutation = before.controls.some((control) => {
    const counterpart = after.controls.find((candidate) => candidate.identity === control.identity);
    return counterpart?.ariaInvalid !== control.ariaInvalid
      || counterpart?.validationNodeIds.join(" ") !== control.validationNodeIds.join(" ")
      || counterpart?.validity?.valid !== control.validity?.valid
      || counterpart?.validationMessagePresent !== control.validationMessagePresent
      || counterpart?.accessibleDescriptionPresent !== control.accessibleDescriptionPresent
      || JSON.stringify(counterpart?.validationContext) !== JSON.stringify(control.validationContext)
      || JSON.stringify(counterpart?.stateAttributes) !== JSON.stringify(control.stateAttributes);
  }) || before.validationNodes.length !== after.validationNodes.length;
  const accessibilityMutation = before.focusedIdentity !== after.focusedIdentity
    || before.controls.some((control) => after.controls.find((candidate) => candidate.identity === control.identity)?.ariaDescribedBy !== control.ariaDescribedBy)
    || before.validationNodes.length !== after.validationNodes.length;
  const formStateChanged = before.forms.some((form) => after.forms.find((candidate) => candidate.identity === form.identity)?.valid !== form.valid);
  // Causal structured-state mutation: state candidates that existed BEFORE the action and changed
  // after it. Multiple text carriers may represent one local display region (for example, a value
  // and its helper text); accept them only when they share the same captured structural owner.
  // Changes across independent owners and candidates that only appeared after the action fail closed.
  const causalStateMutations = diffStateCandidates(before, after).filter((mutation) => mutation.fingerprintBefore !== "");
  const fallbackScopes = new Set(causalStateMutations.map((mutation) => mutation.scopeIdentity ?? mutation.identity ?? `${mutation.tag}|${mutation.role ?? ""}|${mutation.inputType ?? ""}|${mutation.fingerprintBefore}`));
  const hasSharedLocalScope = causalStateMutations.length > 1 && causalStateMutations.some((mutation) =>
    (mutation.scopeIdentities ?? []).slice(0, 6).some((scope) => causalStateMutations.every((candidate) =>
      (candidate.scopeIdentities ?? []).slice(0, 6).includes(scope),
    )),
  );
  const stateMutation = causalStateMutations.length === 1 || fallbackScopes.size === 1 || hasSharedLocalScope;
  const stateMutationProperties = causalStateMutations.flatMap((mutation) => mutation.changedProperties);
  return {
    changed: changedPaths.length > 0,
    changedPaths,
    validationMutation,
    accessibilityMutation,
    navigationMutation: before.urlPath !== after.urlPath,
    formStateChanged,
    stateMutation,
    stateMutationProperties,
    networkActivityDetected,
  };
}

function stateCandidateKey(candidate: ObservationStateCandidate): string {
  return candidate.identity
    ?? [candidate.tag, candidate.role ?? "", candidate.inputType ?? "", candidate.contentEditable ? "ce" : ""].join("|");
}

function stateCandidateFingerprint(candidate: ObservationStateCandidate): string {
  return Object.keys(candidate.propertyFingerprints).sort()
    .map((name) => `${name}:${candidate.propertyFingerprints[name]}`)
    .join(",");
}

/**
 * DIAGNOSTIC ONLY. Compares the redacted structured-state candidates of two snapshots and reports
 * WHICH node kind changed and WHICH property names changed -- never a value (only opaque
 * fingerprints). Returns [] when no candidate changed. It never feeds a completion decision; it
 * exists so a physical run can name the exact channel a same-surface action mutated when the
 * `controls` diff stayed empty.
 */
export function diffStateCandidates(
  before: AssertionObservationSnapshot | undefined,
  after: AssertionObservationSnapshot | undefined,
): StateCandidateMutation[] {
  if (!before || !after) return [];
  const beforeByKey = new Map<string, ObservationStateCandidate>();
  for (const candidate of before.stateCandidates ?? []) beforeByKey.set(stateCandidateKey(candidate), candidate);
  const mutations: StateCandidateMutation[] = [];
  for (const candidate of after.stateCandidates ?? []) {
    const previous = beforeByKey.get(stateCandidateKey(candidate));
    const changedProperties: string[] = [];
    const propertyNames = new Set([
      ...Object.keys(candidate.propertyFingerprints),
      ...Object.keys(previous?.propertyFingerprints ?? {}),
    ]);
    for (const propertyName of propertyNames) {
      if (candidate.propertyFingerprints[propertyName] !== previous?.propertyFingerprints[propertyName]) {
        changedProperties.push(propertyName);
      }
    }
    if (changedProperties.length === 0) continue;
    mutations.push({
      tag: candidate.tag,
      ...(candidate.role ? { role: candidate.role } : {}),
      ...(candidate.inputType ? { inputType: candidate.inputType } : {}),
      contentEditable: candidate.contentEditable,
      ...(candidate.identity ? { identity: candidate.identity } : {}),
      ...(candidate.scopeIdentity ? { scopeIdentity: candidate.scopeIdentity } : {}),
      ...(candidate.scopeIdentities ? { scopeIdentities: candidate.scopeIdentities } : {}),
      changedProperties: changedProperties.sort(),
      fingerprintBefore: previous ? stateCandidateFingerprint(previous) : "",
      fingerprintAfter: stateCandidateFingerprint(candidate),
    });
  }
  return mutations;
}

export async function writeAssertionObservationArtifact(
  evidenceDir: string,
  artifact: AssertionObservationArtifact,
): Promise<string> {
  await mkdir(evidenceDir, { recursive: true });
  const requirementSuffix = artifact.requirementId?.replace(/[^a-zA-Z0-9_-]/g, "_") || "pending";
  const stepSuffix = typeof artifact.triggerActionIdentity.stepIndex === "number"
    ? `-step-${artifact.triggerActionIdentity.stepIndex}`
    : "";
  const suffix = `${requirementSuffix}${stepSuffix}`;
  const artifactPath = path.join(evidenceDir, `assertion-observation-${suffix}.json`);
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  return artifactPath;
}
