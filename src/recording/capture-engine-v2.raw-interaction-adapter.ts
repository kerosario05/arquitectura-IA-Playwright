import type { FieldOwnerDiagnostic, RecordedTechnicalTarget } from "./session-trace.types";
import type { CaptureAction } from "./capture-engine-v2.types";
import type { PlaywrightRecorderEvidence, SemanticRuntimeEvidence } from "./structural-owner-identity";

/**
 * Structural mirror of the PRIVATE `RawInteraction` type declared in
 * `web-session-recorder.ts` (not exported there -- it is an internal payload shape for
 * `context.exposeBinding("__qaRecord", ...)`). Only the fields this adapter can populate are
 * mirrored; every one of them uses the exact name/type the real `RawInteraction` uses today, so
 * a value produced here is structurally assignable to it.
 *
 * `capture-engine-v2.raw-interaction-adapter.test.ts` guards this mirror against drift by
 * asserting these field names still appear, verbatim, in `web-session-recorder.ts`'s own
 * `RawInteraction` declaration.
 */
export type RawInteractionLike = {
  kind: "click" | "input" | "submit" | "observation" | "press";
  interactionId?: string;
  observationType?: "pointer";
  /** Only present for kind="press". */
  key?: string;
  label: string;
  role?: string;
  tagName?: string;
  inputType?: string;
  value?: string;
  testId?: string;
  domId?: string;
  name?: string;
  ariaLabel?: string;
  text?: string;
  placeholder?: string;
  containerContext?: string;
  headerContext?: string;
  rowContext?: string;
  associatedField?: string;
  technicalRoleName?: string;
  roleTechnicalIdentityEligible?: boolean;
  valueSource?: "user" | "application";
  technicalTargetCandidates?: RecordedTechnicalTarget[];
  /** LAST-RESORT, EXECUTION-ONLY authority; never a technicalTarget/certified owner. See its own doc. */
  semanticRuntimeEvidence?: SemanticRuntimeEvidence;
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
  fieldOwnerDiagnostic?: FieldOwnerDiagnostic;
  eventTargetRef?: string;
  currentTargetRef?: string;
  composedPathRefs?: string[];
  deepestEditableTargetRef?: string;
  /** `window.location.href` captured synchronously at click time. See CaptureAction.pageUrlAtClick. */
  pageUrlAtClick?: string;
};

const FUNCTIONAL_KIND_BY_ACTION_TYPE: Partial<Record<CaptureAction["actionType"], RawInteractionLike["kind"]>> = {
  edit: "input",
  click: "click",
  submit: "submit",
  press: "press",
};

/**
 * FIRST_LOSS fix: `CaptureOwner.technicalRefs` (structural evidence the browser instrumentation
 * attaches to the OWNER, e.g. `"id:doc-type-combo"`/`"testid:submit-btn"`) had no path onto
 * `RawInteractionLike` at all -- only `action.identity.domId`/`testId` were ever read. Any
 * technical action whose identity relies on the owner's refs rather than a duplicated
 * `identity.domId`/`testId` lost its only locator basis crossing into `RawInteraction`, which
 * then starves `buildWebLocators`/`buildCanonicalInteractions` of `technicalTargetRefs` and can
 * push the interaction into `generic_label_without_technical_identity` rejection. `identity`
 * stays authoritative when present; this is purely a fallback.
 */
function ownerRefFallback(technicalRefs: string[] | undefined, prefix: "id:" | "testid:"): string | undefined {
  const match = technicalRefs?.find((ref) => ref.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

/**
 * Adapts a CaptureEngine V2 `CaptureAction` DOWN into the current, locked `RawInteraction`
 * shape, so it can be handed to the UNCHANGED `onInteraction`/trace/canonical pipeline.
 *
 * Deliberately one-directional and lossy in one specific way: `"observation"` and
 * `"diagnostic"` action types both map to `kind: "observation"` and NEVER to a functional kind
 * (`click`/`input`/`submit`), even if their identity/owner fields happen to look
 * click-or-edit-shaped -- a diagnostic/control message must never be silently promoted into a
 * functional action.
 *
 * `technicalEvidence.candidates` and `value.literal` are passed through only when present;
 * `undefined` in means `undefined` out (never coerced to `[]` or `""`), matching the current
 * contract's existing "evidence absent -> undefined, never an empty collection" semantics.
 */
export function adaptCaptureActionToRawInteraction(action: CaptureAction): RawInteractionLike {
  const kind = FUNCTIONAL_KIND_BY_ACTION_TYPE[action.actionType] ?? "observation";

  const raw: RawInteractionLike = {
    kind,
    interactionId: action.interactionId,
    observationType: action.observationType,
    label: action.identity.label ?? action.identity.name ?? action.identity.text ?? "control",
    role: action.identity.role,
    tagName: action.identity.tagName,
    inputType: action.identity.inputType,
    testId: action.identity.testId ?? ownerRefFallback(action.owner?.technicalRefs, "testid:"),
    domId: action.identity.domId ?? ownerRefFallback(action.owner?.technicalRefs, "id:"),
    name: action.identity.name,
    ariaLabel: action.identity.ariaLabel,
    text: action.identity.text,
    placeholder: action.identity.placeholder,
    containerContext: action.contextEvidence?.containerContext,
    headerContext: action.contextEvidence?.headerContext,
    rowContext: action.contextEvidence?.rowContext,
    associatedField: action.owner?.associatedField,
    technicalRoleName: action.owner?.technicalRoleName,
    roleTechnicalIdentityEligible: action.owner?.roleTechnicalIdentityEligible,
    technicalTargetCandidates: action.technicalEvidence?.candidates,
    semanticRuntimeEvidence: action.semanticRuntimeEvidence,
    playwrightRecorderEvidence: action.playwrightRecorderEvidence ?? action.owner?.playwrightRecorderEvidence,
    fieldOwnerDiagnostic: action.semanticEvidence?.fieldOwnerDiagnostic,
    eventTargetRef: action.sourceRefs?.eventTargetRef,
    currentTargetRef: action.sourceRefs?.currentTargetRef,
    composedPathRefs: action.sourceRefs?.composedPathRefs,
    deepestEditableTargetRef: action.sourceRefs?.deepestEditableTargetRef,
    pageUrlAtClick: action.pageUrlAtClick,
  };

  if (kind === "input") {
    raw.value = action.value?.literal;
    raw.valueSource = "user";
  }

  if (kind === "press") {
    raw.key = action.key;
  }

  return raw;
}
