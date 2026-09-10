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
  fingerprint: string;
};

export type AssertionObservationDiff = {
  changed: boolean;
  changedPaths: string[];
  validationMutation: boolean;
  accessibilityMutation: boolean;
  navigationMutation: boolean;
  formStateChanged: boolean;
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

function fingerprint(snapshot: RawObservationSnapshot): string {
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
      validationNodes,
      forms,
      requiredControls: { total: requiredTotal, invalid: requiredInvalid, empty: requiredEmpty },
    };
  };
  const raw = await page.evaluate<RawObservationSnapshot>(rawEvaluator);
  return { ...raw, fingerprint: fingerprint(raw) };
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
  return {
    changed: changedPaths.length > 0,
    changedPaths,
    validationMutation,
    accessibilityMutation,
    navigationMutation: before.urlPath !== after.urlPath,
    formStateChanged,
    networkActivityDetected,
  };
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
