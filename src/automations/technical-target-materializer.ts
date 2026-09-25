import type { RecordedLocator, RecordedTechnicalTarget } from "../recording/session-trace.types";
import { normalizeMojibakeUtf8 } from "./spec-generation-hybrid";
import { normalizeStructuralOwnerIdentity } from "../recording/structural-owner-identity";

/**
 * The single CORE output type both Recording-sourced and Discovery-sourced technical evidence
 * materialize into. Structurally identical to `RecordedTechnicalTarget` on purpose: the
 * already-tested runtime consumption path (`resolveActionTarget({ recordedTechnicalTargets })`
 * via `promoted-spec-runtime.ts` / `src/discovery/target-resolver.ts`) accepts exactly this
 * shape, so a certified target can be handed straight to it — no second consumption path,
 * whichever source produced it.
 */
export type CertifiedTechnicalTarget = RecordedTechnicalTarget & {
  certifiedFrom: "recording" | "discovery";
  certificationTier: 1 | 2 | 3 | 4 | 5;
};

/**
 * Normalized input both adapters (Recording, Discovery) reduce their own evidence shape into.
 * Two source shapes are allowed; only one materializer is allowed to consume them.
 */
export type TechnicalTargetEvidenceInput = {
  source: "recording" | "discovery";
  operation?: string;
  /** Business/display text a human would recognize — never used as primary identity when a
   *  stronger technical authority is available below. */
  displayLabel?: string;
  role?: string;
  name?: string;
  stableDirectAttributes?: Record<string, string>;
  owner?: { tag: string; role?: string };
  stableDescendants?: Array<{
    relation: "descendant";
    tag: string;
    role?: string;
    stableAttributes: Record<string, string>;
  }>;
  semanticShape?: string[];
  /** The nearest HTML5/ARIA landmark region (nav/main/aside/header/footer, or an equivalent
   *  role) the owner sits inside -- same generic, never app-specific shape RecordedTechnicalTarget
   *  .structuralContext.landmarkAncestor and resolveRecordedStructuralOwner already use. Only
   *  ever propagated from upstream evidence, never inferred here. */
  landmarkAncestor?: { tag: string; role?: string };
  deterministicStructuralIdentity?: boolean;
  identityAmbiguous?: boolean;
  structuralIdentityMatchCount?: number;
  /** FIRST_LOSS fix (jobId 86706384-...): a recorded interaction can carry a proven topology
   *  tie-break (the SAME authority resolveRecordedStructuralOwner already accepts as an
   *  alternative to a stable attribute/descendant anchor -- see its own topologyAuthority check)
   *  even when it has neither. Without these two fields the materializer had no way to transport
   *  that proof at all, so a real topology-tiebroken owner (recorded with
   *  topologyTieBreakUnique=true, structuralIdentityMatchCount=1, a non-empty semanticShape) fell
   *  through every tier down to the bare "owner tag alone" Tier 4 shape, which
   *  resolveRecordedStructuralOwner then correctly rejects (no anchor, no topology data to prove
   *  the runtime disambiguation the original recording already established) -- confirmed live for
   *  a real Generar Turno button. */
  topologyTieBreakUnique?: boolean;
  topologySignature?: string;
  surfaceIdentity?: string;
  /** Legacy flattened "strategy:value" refs — lowest-priority corroboration only. */
  existingTechnicalRefs?: string[];
  confidence?: number;
  validatedByInteraction?: boolean;
};

/**
 * A "short unique semantic text" ceiling. Above this length a display label is presumed to be
 * concatenated panel/business text, not a single-element identity — the materializer must fail
 * closed (return undefined) rather than hand the spec generator a long getByText target.
 */
const SHORT_TEXT_MAX_LENGTH = 80;

/**
 * scenarioStepIndex=4 (recording d8dbd8f9-b353-4175-b365-e5f8957bae36) proved this boundary
 * matters, though the specific corruption it hit turned out reversible: a captured attribute
 * value can reach here byte-level mojibake-corrupted (e.g. "CrÃ©dito" — a double UTF-8 encoding
 * of "Crédito"). Trace-fidelity text comparisons already tolerate this via normalizeMojibakeUtf8
 * (semantic matching), but a materialized CSS attribute selector is a literal, browser-native
 * `[attr="value"]` match against the live DOM — there is no fuzzy matching at that layer. An
 * uncorrected value can never match the real (correctly-encoded) attribute, so a
 * faithfully-generated candidate locator built from it resolves to zero elements and hangs until
 * the action's own timeout.
 *
 * Not every corruption is reversible, though: U+FFFD (the Unicode replacement character) means
 * the original byte sequence was already lost before it ever reached this codebase — no
 * byte-reinterpretation can recover it, unlike the reversible mojibake normalizeMojibakeUtf8
 * handles. An attribute value that still contains U+FFFD after normalization is discarded
 * entirely from the exact-match selector — never embedded as a literal `[attr="…�…"]`, which
 * would be exactly as unmatchable as the uncorrected mojibake case, silently. Discarding one
 * unsafe attribute preserves any other, still-safe stable attributes: buildCssFromAttributes is
 * called per attribute set (Tier 1's stableDirectAttributes, Tier 3's stable descendant anchor),
 * so if discarding leaves nothing, that tier naturally yields no locator and the caller falls
 * through to the next, weaker (but honest) tier — see materializeTechnicalTarget's Tier 3
 * fallback for why a bare tag-name pair is never fabricated as if it were still tier 3 evidence.
 */
function sanitizeAttributeValue(value: string): string | undefined {
  const normalized = normalizeMojibakeUtf8(value);
  if (normalized.includes("�")) return undefined;
  return normalized;
}

/**
 * Same sanitization as the CSS-building path, applied to the structuralContext metadata the
 * certified target exposes alongside its locator. That metadata is still locator-authoritative
 * evidence — it is part of the same contract payload the spec generator reads (see
 * spec-execution-contract.ts) — so an unsafe value left in there would let it leak back into a
 * generated candidate through some other path even though the primary locator itself is clean.
 * Business/display text (displayLabel) is untouched: it is presentation-only and never becomes
 * an exact-match selector attribute.
 */
function sanitizeAttributeMap(attrs: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const safe = sanitizeAttributeValue(value);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

export function buildCssFromAttributes(attrs: Record<string, string>): string {
  const safeAttrs = sanitizeAttributeMap(attrs);
  return Object.entries(safeAttrs).map(([key, value]) => `[${key}="${value.replace(/"/g, '\\"')}"]`).join("");
}

function isUsableShortText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= SHORT_TEXT_MAX_LENGTH;
}

/**
 * Priority order (never positional, never a full concatenated panel text):
 *   1. stable direct attributes on the target element itself
 *   2. role + accessible name (bounded length)
 *   3. stable descendant anchor + structural owner
 *   4. structural owner alone
 *   5. short, unique semantic text
 * Returns undefined when none of these can be established — the caller must not invent a
 * `.first()/.last()/.nth()` or DOM-index fallback; that is a resolution-time, not
 * materialization-time, concern (see `resolveRecordedStructuralOwner`'s own fail-closed gate).
 */
export function materializeTechnicalTarget(input: TechnicalTargetEvidenceInput): CertifiedTechnicalTarget | undefined {
  const confidence = typeof input.confidence === "number" ? input.confidence : undefined;
  const validatedByInteraction = input.validatedByInteraction === true;
  const base = {
    interactionEvidence: [] as string[],
    validatedByInteraction,
    certifiedFrom: input.source,
  };

  // Tier 1: stable direct attributes.
  if (input.stableDirectAttributes && Object.keys(input.stableDirectAttributes).length > 0) {
    const cssValue = buildCssFromAttributes(input.stableDirectAttributes);
    if (cssValue) {
      const locator: RecordedLocator = { strategy: "css", value: cssValue, confidence: confidence ?? 0.95 };
      // FIRST_LOSS fix (jobId 938b796f-a927-49cf-95bd-3ed66d3e49c0 follow-up): Tier 1 previously
      // discarded any composite structural identity (owner/stableDescendants/semanticShape/
      // ambiguity) already present on `input`, even when a real owner was recorded -- the exact
      // same identity Discovery's own structural-match already certified as unique (or not).
      // Reuses normalizeStructuralOwnerIdentity (the shared owner/attribute/descendant/
      // semanticShape sanitizer Recording/Discovery both already use) purely for sanitization --
      // never for its own ambiguity/determinism derivation, which would re-INFER those from
      // shape alone; identityAmbiguous/structuralIdentityMatchCount/deterministicStructuralIdentity
      // are instead passed through verbatim from input, exactly as Tiers 3/4 already do, so the
      // downstream ambiguity gate (resolveCertifiedStructuralAuthority /
      // resolveActionTargetAuthority) sees identical semantics regardless of which tier produced
      // the certification. Without a real owner, Tier 1 keeps its existing minimal shape
      // unchanged (legacy) -- never fabricates one.
      const structuralContext = input.owner?.tag
        ? (() => {
            const sanitized = normalizeStructuralOwnerIdentity({
              ownerTag: input.owner!.tag,
              ownerRole: input.owner!.role,
              stableDirectAttributes: input.stableDirectAttributes,
              stableDescendants: input.stableDescendants,
              semanticShape: input.semanticShape,
              landmarkAncestor: input.landmarkAncestor,
            });
            return {
              owner: sanitized.owner,
              stableDirectAttributes: sanitized.stableDirectAttributes,
              stableDescendants: sanitized.stableDescendants,
              semanticShape: sanitized.semanticShape,
              ...(sanitized.landmarkAncestor ? { landmarkAncestor: sanitized.landmarkAncestor } : {}),
              deterministicStructuralIdentity: input.deterministicStructuralIdentity,
              identityAmbiguous: input.identityAmbiguous,
              structuralIdentityMatchCount: input.structuralIdentityMatchCount,
            };
          })()
        : { stableDirectAttributes: sanitizeAttributeMap(input.stableDirectAttributes) };
      return {
        ...base,
        targetType: "structural",
        locatorCandidates: [locator],
        structuralContext,
        confidence: confidence ?? 0.95,
        certificationTier: 1,
      };
    }
  }

  // Tier 2: role + accessible name (bounded — a long name is business text, not an identity).
  if (input.role && isUsableShortText(input.name)) {
    const locator: RecordedLocator = { strategy: "role", value: `${input.role}|${input.name}`, confidence: confidence ?? 0.85 };
    return {
      ...base,
      targetType: "structural",
      locatorCandidates: [locator],
      structuralContext: undefined,
      confidence: confidence ?? 0.85,
      certificationTier: 2,
    };
  }

  // Tier 3: stable descendant anchor + structural owner. The anchor's own stable attributes are
  // what make this tier a real, distinguishing identity (owner tag + descendant tag alone, e.g.
  // "div|img", matches every div containing any img — not materializable as a unique
  // identity). If every one of the anchor's attributes was discarded as unsafe (see
  // buildCssFromAttributes/sanitizeAttributeValue) or none existed to begin with, this tier
  // fails closed rather than fabricating a bare tag-name pair as if it were still tier-3
  // evidence — falling through to Tier 4, which already exists precisely for "owner alone, no
  // stronger evidence" and labels itself accordingly (lower confidence, certificationTier 4).
  if (input.owner?.tag && input.stableDescendants && input.stableDescendants.length > 0) {
    const anchor = input.stableDescendants[0];
    const anchorValue = buildCssFromAttributes(anchor.stableAttributes);
    if (anchorValue) {
      const locator: RecordedLocator = {
        strategy: "role",
        value: `${input.owner.tag}|${anchorValue}`,
        confidence: confidence ?? 0.8,
      };
      return {
        ...base,
        targetType: "structural",
        locatorCandidates: [locator],
        structuralContext: {
          owner: input.owner,
          stableDescendants: input.stableDescendants.map((descendant) => ({
            ...descendant,
            stableAttributes: sanitizeAttributeMap(descendant.stableAttributes),
          })),
          semanticShape: input.semanticShape,
          ...(input.landmarkAncestor ? { landmarkAncestor: input.landmarkAncestor } : {}),
          deterministicStructuralIdentity: input.deterministicStructuralIdentity,
          identityAmbiguous: input.identityAmbiguous,
          structuralIdentityMatchCount: input.structuralIdentityMatchCount,
        },
        confidence: confidence ?? 0.8,
        certificationTier: 3,
      };
    }
  }

  // Tier 4: structural owner alone (no stable descendant). Ambiguity is a resolution-time
  // concern handled fail-closed by resolveRecordedStructuralOwner at runtime — not here.
  if (input.owner?.tag) {
    const locator: RecordedLocator = { strategy: "role", value: `${input.owner.tag}`, confidence: confidence ?? 0.6 };
    return {
      ...base,
      targetType: "structural",
      locatorCandidates: [locator],
      structuralContext: {
        owner: input.owner,
        semanticShape: input.semanticShape,
        ...(input.landmarkAncestor ? { landmarkAncestor: input.landmarkAncestor } : {}),
        deterministicStructuralIdentity: input.deterministicStructuralIdentity,
        identityAmbiguous: input.identityAmbiguous,
        structuralIdentityMatchCount: input.structuralIdentityMatchCount,
        // FIRST_LOSS fix (jobId 86706384-...): a real recorded topology tie-break is the SAME
        // alternative authority resolveRecordedStructuralOwner already accepts in place of a
        // stable attribute/descendant anchor -- transported here now that
        // TechnicalTargetEvidenceInput/normalizeRecordingEvidence carry it, instead of being
        // silently dropped and leaving this owner-alone shape with no anchor at all.
        ...(input.topologyTieBreakUnique !== undefined ? { topologyTieBreakUnique: input.topologyTieBreakUnique } : {}),
        ...(input.topologySignature !== undefined ? { topologySignature: input.topologySignature } : {}),
      },
      confidence: confidence ?? 0.6,
      certificationTier: 4,
    };
  }

  // Tier 5: short, unique semantic text — never a long concatenated panel label.
  if (isUsableShortText(input.displayLabel)) {
    const locator: RecordedLocator = { strategy: "text", value: input.displayLabel, confidence: confidence ?? 0.5 };
    return {
      ...base,
      targetType: "display",
      locatorCandidates: [locator],
      confidence: confidence ?? 0.5,
      certificationTier: 5,
    };
  }

  return undefined;
}

/**
 * Recording adapter: reduces one `RecordedTechnicalTarget` candidate (as already captured by
 * canonical-recording-contract.ts / semantic-recording.ts) into the CORE normalized input.
 */
export function normalizeRecordingEvidence(
  candidate: RecordedTechnicalTarget | Record<string, unknown> | undefined,
  opts: { displayLabel?: string; operation?: string } = {},
): TechnicalTargetEvidenceInput | undefined {
  if (!candidate) return undefined;
  const rec = candidate as Partial<RecordedTechnicalTarget> & Record<string, unknown>;
  const structuralContext = rec.structuralContext as RecordedTechnicalTarget["structuralContext"] | undefined;
  const bestLocator = Array.isArray(rec.locatorCandidates) ? rec.locatorCandidates[0] : undefined;
  return {
    source: "recording",
    operation: opts.operation,
    displayLabel: opts.displayLabel,
    role: bestLocator?.strategy === "role" ? bestLocator.value?.split("|")[0] : undefined,
    name: bestLocator?.strategy === "role" ? bestLocator.value?.split("|").slice(1).join("|") : undefined,
    stableDirectAttributes: structuralContext?.stableDirectAttributes,
    owner: structuralContext?.owner,
    stableDescendants: structuralContext?.stableDescendants,
    semanticShape: structuralContext?.semanticShape,
    landmarkAncestor: structuralContext?.landmarkAncestor,
    deterministicStructuralIdentity: structuralContext?.deterministicStructuralIdentity,
    identityAmbiguous: structuralContext?.identityAmbiguous,
    structuralIdentityMatchCount: structuralContext?.structuralIdentityMatchCount,
    topologyTieBreakUnique: structuralContext?.topologyTieBreakUnique,
    topologySignature: structuralContext?.topologySignature,
    existingTechnicalRefs: Array.isArray(rec.locatorCandidates)
      ? (rec.locatorCandidates as RecordedLocator[]).map((l) => `${l.strategy}:${l.value}`)
      : undefined,
    confidence: typeof rec.confidence === "number" ? rec.confidence : undefined,
    validatedByInteraction: rec.validatedByInteraction === true,
  };
}

/**
 * One owner candidate structurally associated with the SAME field container -- never a raw DOM
 * node, never chosen by position. `editable`/`actionable`/`visible`/`disabled` mirror the exact
 * semantics `resolveCaptureOwner`/`isActionableNode`/`isEditableNode` already use elsewhere in
 * this codebase; this type does not redefine them, it only carries their already-computed values.
 */
export type FieldScopedOwnerCandidate = {
  tag: string;
  role?: string;
  editable?: boolean;
  actionable?: boolean;
  visible?: boolean;
  disabled?: boolean;
  stableDirectAttributes?: Record<string, string>;
};

export type FieldScopedResolution =
  | { status: "unique"; candidate: FieldScopedOwnerCandidate }
  | { status: "ambiguous"; matchCount: number }
  | { status: "not_materializable" };

/**
 * Given every candidate owner structurally associated with the SAME field container, narrows to
 * the ones actually usable for the requested action kind -- visible, not disabled, and
 * role-compatible (`editable` for a fill target, `actionable` for a click target). Certifies only
 * when EXACTLY ONE survives: zero is `"not_materializable"`, more than one is `"ambiguous"` --
 * both fail closed, never a `nth()`/`first()`/DOM-index guess among the survivors.
 */
export function resolveFieldScopedOwner(
  candidates: readonly FieldScopedOwnerCandidate[],
  requiredCompatibility: "editable" | "actionable",
): FieldScopedResolution {
  const compatible = candidates.filter((candidate) => {
    if (candidate.visible === false) return false;
    if (candidate.disabled === true) return false;
    return requiredCompatibility === "editable" ? candidate.editable === true : candidate.actionable === true;
  });
  if (compatible.length === 0) return { status: "not_materializable" };
  if (compatible.length > 1) return { status: "ambiguous", matchCount: compatible.length };
  return { status: "unique", candidate: compatible[0] };
}

/**
 * Structural evidence about the field's OWN container -- not yet live-DOM-discovered (that is a
 * separate, later ticket); this is the shape a future live-discovery caller will supply once it
 * exists. Reuses the exact same `owner`-shaped evidence `materializeTechnicalTarget`'s Tier 3/4
 * already understand -- no parallel container-identity model.
 */
export type FieldContainerEvidence = {
  tag: string;
  role?: string;
  stableDirectAttributes?: Record<string, string>;
  /**
   * The field's own known, recorded name (`associatedField`) -- never invented, always the exact
   * text already used to find this container in the first place. Present when the CONTAINER
   * carrying `stableDirectAttributes` is broader than the narrow scope that actually proved the
   * candidate unique (e.g. a page-level `<section data-stable>` wrapping several unrelated
   * fields), so a CSS locator built from the container's attributes alone would match every
   * field inside it, not just this one. Used ONLY to disambiguate an otherwise-too-broad
   * container's CSS -- never as a replacement for real structural evidence, never a fabricated
   * accessible name for the target itself.
   */
  textAnchor?: string;
  /**
   * True ONLY when this container IS the exact scope `findFieldScope` itself already accepted as
   * the field's unique, compatible, anchor-related owner container (field-scoped-live-
   * discovery.ts) -- never set by a caller constructing evidence by hand. This is the real
   * authority for a tag+textAnchor fallback with no stable attribute: `findFieldScope`'s own
   * acceptance rule (exactly one compatible descendant in that specific subtree), never the
   * container's tag name. A container supplied WITHOUT this flag and without
   * `stableDirectAttributes` is never certified from `textAnchor` alone (see
   * `4/textAnchorNeverAlone`) -- textAnchor is a disambiguator, not a standalone identity.
   */
  fromAcceptedFieldScope?: boolean;
  /**
   * Ephemeral runtime marker value set on the EXACT node `findFieldScope` accepted, alongside
   * `fromAcceptedFieldScope`. Used only to re-resolve that same physical node at runtime; never
   * serialized into the certified target, never a promotable locator.
   */
  acceptedScopeRuntimeMarker?: string;
  /**
   * Set only when the accepted scope node IS itself the compatible owner (the unique anchor's
   * direct containing element, e.g. a `<button>` wrapping the field's `<h3>`). The runtime target
   * is then that exact node, never a descendant of it.
   */
  selfOwner?: boolean;
};

export type FieldScopedMaterializationInput = {
  /** Structural relation only -- scopes the candidate pool, never copied into the certified identity. */
  associatedField: string;
  candidates: readonly FieldScopedOwnerCandidate[];
  requiredCompatibility: "editable" | "actionable";
  /**
   * Required to certify a scoped target when the winning candidate carries no strong evidence of
   * its own (see `materializeFieldScopedTechnicalTarget`'s own doc comment for why). Absent for
   * now in every real caller (live field-container discovery does not exist yet) -- tests supply
   * it to exercise the scoped path ahead of that wiring.
   */
  fieldContainerEvidence?: FieldContainerEvidence;
  confidence?: number;
};

export type FieldScopedMaterializationResult =
  | {
      status: "certified";
      target: CertifiedTechnicalTarget;
      /**
       * Runtime-only scope split (set only when `fieldContainerEvidence.fromAcceptedFieldScope`
       * is true): the container and descendant halves of `target`'s combined CSS, kept SEPARATE
       * so a caller can re-resolve the container as its own live `Locator` at runtime and search
       * the descendant RELATIVE to it, instead of re-evaluating the combined selector page-wide
       * (which collapses a locally-unique scope back into a global match count). Never part of
       * `target` itself -- never serialized/persisted as certified identity.
       */
      scopeContainerLocator?: RecordedLocator;
      scopedDescendantLocator?: RecordedLocator;
      /** The accepted scope node is itself the owner: the exact node is the runtime target. */
      selfOwner?: boolean;
    }
  | { status: "ambiguous"; matchCount: number }
  | { status: "not_materializable" };

/**
 * Materializes a `CertifiedTechnicalTarget` for an owner that has a valid structural field
 * association (`associatedField`) but no direct technical locator of its own -- the exact gap
 * physically observed: `role=textbox`/`role=button`, `associatedField="<field>"`,
 * `candidateTargets=[]`. `associatedField` is used ONLY to scope the candidate pool to the right
 * field container; it is NEVER copied into the certified target's accessible name or a
 * `role|associatedField` locator -- that would fabricate an identity the owner never actually
 * had.
 *
 * CERTIFICATION SCOPE MUST BE >= EXECUTION SCOPE: `resolveFieldScopedOwner` proving a candidate
 * unique WITHIN one field's container is not license to certify it as if it were globally unique
 * on the page. `materializeTechnicalTarget`'s Tier 4 ("owner alone", e.g. locator value `"button"`)
 * is exactly that unsafe widening -- it matches every `<button>` anywhere, not just the one
 * proven unique in this scope -- so it is NEVER accepted as a certified result here, however
 * `materializeTechnicalTarget` itself (called on its own, outside this field-scoped path) still
 * legitimately uses it as a last-resort fallback elsewhere.
 *
 * Two paths certify successfully:
 *   - the winning candidate already carries strong evidence of its own (real stable
 *     attributes, e.g. a real `id`/`data-testid`) -- that evidence is presumed page-scoped
 *     identity on its own merit, independent of the field it happens to sit in (Tier 1).
 *   - `fieldContainerEvidence` (the field's own container, with real stable attributes) is
 *     supplied -- combined with the candidate's own tag/role as a genuine container+descendant
 *     locator (Tier 3), which IS scoped to that specific container, never a bare page-wide tag.
 * Anything else (no candidate evidence, no container evidence, or a combination too weak to
 * reach Tier 3) fails closed as `"not_materializable"` -- never a weaker, unscoped target.
 */
export function materializeFieldScopedTechnicalTarget(
  input: FieldScopedMaterializationInput,
  // FIRST_LOSS fix: a Tier-1 own-evidence locator (candidate.stableDirectAttributes alone) is
  // presumed page-globally unique on the candidate's own merit -- true for a real id/data-testid,
  // but a shared/generic stable attribute (e.g. an icon-only button reusing the same attribute
  // across several identical controls) can still collide page-wide, only discoverable at runtime
  // revalidation. `requireContainerScope` lets the caller retry with the field container folded
  // in (Tier 3) after that happens, without changing the default priority for every already-
  // certifying case (own evidence first, when it is not known to be ambiguous).
  options?: { requireContainerScope?: boolean },
): FieldScopedMaterializationResult {
  const resolution = resolveFieldScopedOwner(input.candidates, input.requiredCompatibility);
  if (resolution.status !== "unique") return resolution;
  const candidate = resolution.candidate;

  const hasStrongOwnEvidence = !options?.requireContainerScope && Boolean(
    candidate.stableDirectAttributes && Object.keys(candidate.stableDirectAttributes).length > 0,
  );
  if (hasStrongOwnEvidence) {
    const target = materializeTechnicalTarget({
      source: "recording",
      stableDirectAttributes: candidate.stableDirectAttributes,
      owner: { tag: candidate.tag, role: candidate.role },
      confidence: input.confidence,
    });
    if (target?.certificationTier !== 1) return { status: "not_materializable" };
    return { status: "certified", target };
  }

  const container = input.fieldContainerEvidence;
  const stableAttributeCss = container?.stableDirectAttributes ? buildCssFromAttributes(container.stableDirectAttributes) : "";
  // FIRST_LOSS fix: the real authority for a tag+textAnchor fallback with no stable attribute is
  // NOT the container's tag name (a plain <div> is exactly as legitimate a field scope as a
  // <fieldset> once `findFieldScope` has already proven it uniquely compatible) -- it is whether
  // this container IS the exact scope `findFieldScope` itself accepted (`fromAcceptedFieldScope`,
  // set ONLY by field-scoped-live-discovery.ts, never by a caller constructing evidence by hand).
  // A container supplied WITHOUT that flag is never trusted from textAnchor alone (preserves
  // `4/textAnchorNeverAlone`: "any <section> containing this text" is still too broad a claim).
  // The boundary tag, combined with `textAnchor` (the field's own known, recorded name -- never
  // invented, never used alone), is weaker than a real stable attribute but still genuinely
  // bounded and structural -- never "any element", never positional.
  const containerCss = stableAttributeCss
    || (container?.textAnchor && container.fromAcceptedFieldScope ? container.tag : "");
  const isWeakContainerIdentity = !stableAttributeCss && Boolean(containerCss);
  if (container && containerCss) {
    // A genuine CSS descendant-combinator: the container's own real, distinguishing attributes
    // uniquely identify ONE container on the page; `resolveFieldScopedOwner` already proved
    // there is exactly ONE role-compatible descendant of that specific container. Combining them
    // is what materializeTechnicalTarget's own Tier 3 does too, but that tier separately requires
    // the DESCENDANT to also carry its own stable attribute -- a requirement that exists for
    // Tier 3's general-purpose case (an owner tag with many page-wide instances), not this one,
    // where the container itself is already the uniquely-identifying anchor. When the candidate
    // DOES have its own stable attributes, they are still folded in below for the strongest
    // possible combined identity.
    //
    // `container.textAnchor` disambiguates when the stable-attribute-bearing container is
    // BROADER than the scope that actually proved uniqueness (e.g. a page-level section wrapping
    // several unrelated fields): Playwright's `:has-text()` pseudo-class scopes the descendant
    // combinator to only the sub-tree whose text contains the field's own known, recorded name --
    // never an invented locator, never positional, and never the field's ONLY identity (it is
    // added on top of the container's own real stable attributes, never used alone).
    const textAnchorSegment = container.textAnchor
      ? ` :has-text("${container.textAnchor.replace(/["\\]/g, "\\$&")}")`
      : "";
    const descendantCss = candidate.stableDirectAttributes ? buildCssFromAttributes(candidate.stableDirectAttributes) : "";
    const descendantSelector = `${candidate.tag}${descendantCss}`;
    // FIRST_LOSS fix (jobId 92d7c68d-106d-4800-8c53-59addc072f9e): a WEAK container (no stable
    // attribute of its own -- `isWeakContainerIdentity`) identified only by `tag` + `:has-text()`
    // is not actually narrow: `:has-text()` matches every ANCESTOR whose subtree contains the
    // text too, not just the accepted node, so a bare `div:has-text(...)` can re-expand from the
    // one live node `findFieldScope` accepted back out to dozens of page-wide matches. The real
    // authority `findFieldScope` proved is structural, not textual: "the narrowest ancestor whose
    // subtree contains exactly one compatible candidate" -- the exact same relation
    // `resolveRecordedStructuralOwner` already expresses generically as `owner:has(descendant)`,
    // narrowed to the NEAREST such owner via `:not(:has(owner:has(descendant)))` (an owner
    // containing another qualifying owner is never the accepted one; `findFieldScope` always
    // stops at the first/narrowest ancestor). Reusing that same idiom here (not a new resolver,
    // not positional, not text-only) recovers a selector bounded by the SAME anchor-to-candidate
    // structural relation the accepted scope was actually proven by, instead of a bare tag name.
    // FIRST_LOSS fix (jobId f1e6f577-110d-491e-bbdf-3a64ca129e19): `textAnchorSegment` is a
    // DESCENDANT COMBINATOR (leading space) by design for the STABLE-attribute case above --
    // "a sub-tree, inside the stable container, whose own inner wrapper carries this text" (see
    // `1/textAnchorDisambiguation`). For a WEAK (bare-tag) container that shape is wrong: `div
    // :has-text(...)` reads as "any element that is a descendant of SOME div and itself has this
    // text", which matches almost anything nested under any div, not the specific accepted `div`.
    // The weak base must instead say "a div that ITSELF has this text and has this descendant" --
    // `:has-text()`/`:has()` chained directly on the tag, no combinator -- which is what actually
    // dropped the physical match count from 21 (job dfbecfc8) to a much smaller, correctly-shaped
    // candidate set; the residual ambiguity this ticket investigates is a separate, later concern.
    const weakTextAnchorPseudoClass = container.textAnchor
      ? `:has-text("${container.textAnchor.replace(/["\\]/g, "\\$&")}")`
      : "";
    const weakNearestOwnerBase = `${containerCss}${weakTextAnchorPseudoClass}:has(${descendantSelector})`;
    const scopeContainerSelector = isWeakContainerIdentity
      ? `${weakNearestOwnerBase}:not(:has(${weakNearestOwnerBase}))`
      : `${containerCss}${textAnchorSegment}`;
    const cssValue = `${scopeContainerSelector} ${descendantSelector}`;
    // A tag+textAnchor container (no stable attribute) is durable enough for THIS run's execution
    // but weaker than a real container identity -- confidence is lowered so any existing
    // downstream promotion/certification threshold naturally treats it as execution-only,
    // without introducing a new tier or a parallel readiness concept.
    const targetConfidence = isWeakContainerIdentity ? Math.min(input.confidence ?? 0.75, 0.55) : (input.confidence ?? 0.75);
    const locator: RecordedLocator = { strategy: "css", value: cssValue, confidence: targetConfidence };
    const target: CertifiedTechnicalTarget = {
      interactionEvidence: [],
      validatedByInteraction: false,
      certifiedFrom: "recording",
      targetType: "structural",
      locatorCandidates: [locator],
      structuralContext: {
        owner: { tag: container.tag, role: container.role },
        stableDescendants: [{
          relation: "descendant",
          tag: candidate.tag,
          ...(candidate.role ? { role: candidate.role } : {}),
          stableAttributes: candidate.stableDirectAttributes ?? {},
        }],
      },
      confidence: targetConfidence,
      certificationTier: 3,
    };
    if (!container.fromAcceptedFieldScope) return { status: "certified", target };
    const markerLocator: RecordedLocator | undefined = container.acceptedScopeRuntimeMarker
      ? { strategy: "css", value: `[data-codex-accepted-field-scope="${container.acceptedScopeRuntimeMarker}"]`, confidence: targetConfidence }
      : undefined;
    // Self-owner scope: the accepted node IS the owner. The runtime target is that exact node,
    // never a descendant of itself -- both halves point at the same ephemeral marker, so the
    // retry resolves it page-globally (unique by construction) instead of searching inside it.
    if (container.selfOwner && markerLocator) {
      return { status: "certified", target, selfOwner: true, scopeContainerLocator: markerLocator, scopedDescendantLocator: markerLocator };
    }
    return {
      status: "certified",
      target,
      // Prefer the EXACT accepted node's ephemeral marker when present: it recovers the SAME
      // physical node the scope climb proved unique, instead of re-expanding the broader
      // text+structure CSS above (which can match several equivalent containers page-wide).
      // Runtime-only -- never part of `target`.
      scopeContainerLocator: markerLocator ?? { strategy: "css", value: scopeContainerSelector, confidence: targetConfidence },
      scopedDescendantLocator: { strategy: "css", value: descendantSelector, confidence: targetConfidence },
    };
  }

  // Neither the candidate nor its field container carries evidence strong enough to build a
  // genuinely scoped locator -- certifying anyway would mean falling through to
  // materializeTechnicalTarget's Tier 4 (bare tag alone), silently widening execution scope
  // beyond what was actually proven unique. Fail closed instead.
  return { status: "not_materializable" };
}

/** Minimal shape of Discovery's own plan-target evidence (see `PlanTarget` in execution-plan.types.ts). */
export type DiscoveryPlanTargetLike = {
  strategy?: string;
  value?: string;
  role?: string;
  name?: string;
};

/**
 * Discovery adapter: Discovery does not (yet) capture stable-attribute/structural-owner
 * evidence the way Recording does — it only resolves a single live locator strategy during the
 * walk. That is not a reason to skip the shared materializer: map whatever Discovery has into
 * the same normalized input, and let the materializer pick the best available tier from it.
 */
export function normalizeDiscoveryEvidence(
  target: DiscoveryPlanTargetLike | undefined,
  opts: { displayLabel?: string; operation?: string } = {},
): TechnicalTargetEvidenceInput | undefined {
  if (!target) return undefined;
  const strategy = target.strategy?.toLowerCase();
  const attributeName = strategy === "testid" || strategy === "data-testid" ? "data-testid" : strategy === "id" ? "id" : undefined;
  return {
    source: "discovery",
    operation: opts.operation,
    displayLabel: opts.displayLabel ?? target.value,
    role: strategy === "role" ? target.role ?? target.value : target.role,
    name: strategy === "role" ? target.name ?? target.value : target.name,
    stableDirectAttributes: attributeName && target.value ? { [attributeName]: target.value } : undefined,
    existingTechnicalRefs: target.strategy && target.value ? [`${target.strategy}:${target.value}`] : undefined,
  };
}
