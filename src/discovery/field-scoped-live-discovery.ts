import type { FieldContainerEvidence, FieldScopedOwnerCandidate } from "../automations/technical-target-materializer";

export type FieldScopeCompatibility = "editable" | "actionable";

/**
 * Minimal DOM surface this module depends on. Deliberately narrower than `Document`/`Element`
 * so the exact same logic can run against a real live page (via Playwright's `page.evaluate`,
 * where `document` already satisfies this shape) and against a hand-built fake in tests --
 * no jsdom, no CSS selector engine, only `parentElement`/`children`/`getAttribute` traversal.
 */
export type FieldScopedDomElement = {
  tagName: string;
  id: string;
  getAttribute(name: string): string | null;
  getAttributeNames(): string[];
  textContent: string | null;
  children: ArrayLike<FieldScopedDomElement>;
  parentElement: FieldScopedDomElement | null;
  disabled?: boolean;
  hidden?: boolean;
  /** Optional: present on real DOM elements; lets the accepted scope carry an ephemeral marker. */
  setAttribute?(name: string, value: string): void;
};

export type FieldScopedDomRoot = {
  body: FieldScopedDomElement;
  getElementById(id: string): FieldScopedDomElement | null;
};

/**
 * Safe, dataset-value-free trace of how the container search went -- ids/counts/tags only,
 * never DOM text/values. Logged Node-side by `tryFieldScopedStructuralFallback` so a physical
 * run can pinpoint exactly which stage failed without needing a live debugger.
 */
export type FieldScopeAncestorTrace = {
  depth: number;
  tag: string;
  hasStableAttribute: boolean;
  compatibleCandidateCount: number;
  disabledCompatibleCandidateCount: number;
  otherOwnerCandidateCount: number;
  scopeDecision: "continue" | "accepted" | "ambiguous";
};

export type FieldScopedDiagnostics = {
  textAnchorMatchCount: number;
  semanticLabelMatchCount: number;
  ariaRelationMatchCount: number;
  leafAnchorMatchCount: number;
  anchorFound: boolean;
  anchorTag?: string;
  ancestorsInspected: number;
  ancestorTrace: FieldScopeAncestorTrace[];
  containerAccepted: boolean;
  rejectReason?: "no_anchor_found" | "climb_exhausted" | "scope_ambiguous";
};

export type FieldScopedDomEvidence = {
  container?: FieldContainerEvidence;
  /**
   * The exact live scope node `findFieldScope` itself already accepted (unique compatible-
   * candidate count within THAT subtree) -- always populated alongside `container` whenever a
   * scope was found, even when `container` is a broader certification ancestor. `container`'s own
   * climb (`findCertificationAncestor`) may land on an ancestor BEYOND the accepted scope whose
   * "stable" attribute (id/name/data-*) is not actually page-unique (e.g. a framework's scoped-
   * style hash shared by every instance of a repeated component) -- that only surfaces later, as a
   * runtime match-count ambiguity, never here. `scopeContainer` preserves the narrower, already-
   * proven authority so a caller can retry against it once a broader container turns out ambiguous,
   * instead of that authority being silently lost. Always carries `fromAcceptedFieldScope: true`.
   */
  scopeContainer?: FieldContainerEvidence;
  candidates: FieldScopedOwnerCandidate[];
  diagnostics: FieldScopedDiagnostics;
};

/**
 * Bounded, evidence-only live field/container discovery. Never used as the primary resolver --
 * only as input to the shared `materializeFieldScopedTechnicalTarget` (which alone decides
 * certified/ambiguous/not_materializable). This function only OBSERVES:
 *
 * - the field container, via label[for]/wrapping-label/fieldset+legend/aria-labelledby, climbing
 *   a bounded number of ancestors to the first one carrying its own stable attribute (never an
 *   arbitrary nearest div, never a text-based ancestor match, never a positional/index pick);
 * - the owner pool strictly INSIDE that container.
 *
 * Self-contained on purpose (every helper is declared inside this function, nothing imported):
 * this function's own `.toString()` (see `FIELD_SCOPED_DOM_EVIDENCE_SOURCE`) is injected as a
 * standalone script into the live page via Playwright, where it must resolve with no closure
 * over anything outside itself.
 */
export function extractFieldScopedDomEvidence(
  root: FieldScopedDomRoot,
  associatedField: string,
  requiredCompatibility: FieldScopeCompatibility = "editable",
): FieldScopedDomEvidence | undefined {
  // FIRST_LOSS fix (this ticket, confirmed against real physical diagnostics): the ancestor
  // climb accepted the FIRST ancestor carrying a stable attribute (id/name/data-*) as the field
  // scope, regardless of how many unrelated editable/actionable controls that ancestor also
  // contained. Physically, the anchor's true field wrapper (a narrow div with exactly ONE real
  // input, no stable attribute of its own) sat several levels below the nearest stable ancestor
  // (a page-level section with 6+ unrelated inputs) -- the climb walked straight past the real
  // scope and landed on that broad section, which the materializer correctly refused to certify
  // as unique (`ambiguous`, matchCount growing as the page kept loading more of its own fields).
  //
  // FIELD SCOPE is now selected independently of certification identity: climbing from the
  // anchor, the FIRST ancestor whose subtree contains EXACTLY ONE candidate compatible with the
  // requested action intent (editable for fill, actionable for click -- a sibling icon button
  // never competes with a fill target) is the scope, whatever its own attributes are. Only
  // AFTERWARD does a separate, bounded climb look for the nearest STABLE ancestor to use for
  // certification (`FieldContainerEvidence` reused as before) -- which may be the scope itself,
  // or something broader; when broader, `textAnchor` (the field's own known, recorded name) rides
  // along so the materializer can safely disambiguate a stable-but-broad container's CSS from
  // unrelated sibling fields it also contains, never a positional/index guess.
  const MAX_CONTAINER_CLIMB = 12;
  const OWNER_TAGS = new Set(["input", "textarea", "select", "button"]);
  const ACTIONABLE_ROLES = new Set(["button"]);
  const EDITABLE_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);
  const NON_EDITABLE_INPUT_TYPES = new Set(["button", "submit", "checkbox", "radio", "hidden", "file", "image", "reset"]);

  function normalizeFieldText(value: string | null | undefined): string {
    return (value ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // "Stable" is deliberately generic (id/name/any data-* attribute), never a fixed list of
  // project-specific attribute names -- CORE MULTIPROYECTO: no app owns a reserved attribute.
  function isStableAttributeName(name: string): boolean {
    return name === "id" || name === "name" || name.indexOf("data-") === 0;
  }

  function collectStableAttributes(el: FieldScopedDomElement): Record<string, string> | undefined {
    const attrs: Record<string, string> = {};
    for (const name of el.getAttributeNames()) {
      if (!isStableAttributeName(name)) continue;
      const value = el.getAttribute(name);
      if (value && value.trim()) attrs[name] = value.trim();
    }
    return Object.keys(attrs).length > 0 ? attrs : undefined;
  }

  function walkAll(
    node: FieldScopedDomElement,
    predicate: (el: FieldScopedDomElement) => boolean,
    out: FieldScopedDomElement[] = [],
  ): FieldScopedDomElement[] {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (predicate(child)) out.push(child);
      walkAll(child, predicate, out);
    }
    return out;
  }

  // A non-native disclosure/listbox trigger (a UI-library dropdown/combobox wrapper rendered as a
  // plain <div>/<span>, e.g. PrimeVue/MUI-style widgets) declares itself via standard ARIA
  // disclosure attributes even when it carries neither a recognized tag nor an ARIA role. This is
  // the SAME generic ARIA-attribute signal already used elsewhere in this codebase (grid editor
  // rematerialization) to recognize an equivalent non-native selectable owner -- never a
  // library-specific class name, never "any clickable div".
  function isAriaDisclosureOwner(el: FieldScopedDomElement): boolean {
    return Boolean(el.getAttribute("aria-haspopup")) || el.getAttribute("aria-expanded") !== null || Boolean(el.getAttribute("aria-controls"));
  }

  function isOwnerCandidate(el: FieldScopedDomElement): boolean {
    const tag = el.tagName.toLowerCase();
    if (OWNER_TAGS.has(tag)) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role && (ACTIONABLE_ROLES.has(role) || EDITABLE_ROLES.has(role))) return true;
    if (el.getAttribute("contenteditable") === "true") return true;
    if (isAriaDisclosureOwner(el)) return true;
    return false;
  }

  function deriveOwnerRole(el: FieldScopedDomElement): string | undefined {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }
    if (el.getAttribute("contenteditable") === "true") return "textbox";
    return undefined;
  }

  function isOwnerEditable(el: FieldScopedDomElement, role: string | undefined): boolean {
    if (el.getAttribute("readonly") != null) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input") return !NON_EDITABLE_INPUT_TYPES.has((el.getAttribute("type") || "text").toLowerCase());
    if (el.getAttribute("contenteditable") === "true") return true;
    return role ? EDITABLE_ROLES.has(role) : false;
  }

  function isOwnerActionable(el: FieldScopedDomElement, role: string | undefined): boolean {
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return true;
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") return true;
    }
    if (role === "button") return true;
    return isAriaDisclosureOwner(el);
  }

  function isOwnerVisible(el: FieldScopedDomElement): boolean {
    if (el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if ((el.getAttribute("type") || "").toLowerCase() === "hidden") return false;
    return true;
  }

  function isOwnerDisabled(el: FieldScopedDomElement): boolean {
    if (el.disabled === true) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    return false;
  }

  function isCompatibleForIntent(el: FieldScopedDomElement, role: string | undefined): boolean {
    return requiredCompatibility === "editable" ? isOwnerEditable(el, role) : isOwnerActionable(el, role);
  }

  // Structural compatibility only -- disabled/visible state never changes WHICH scope is
  // selected (a disabled input is still the field's own, unique control), only whether the
  // eventual target is executable RIGHT NOW (decided later, downstream, unchanged).
  //
  // A scope node can itself be the actionable owner: the unique anchor's direct containing
  // element (e.g. a `<button>` wrapping the field's `<h3>`). `walkAll` only ever visits
  // DESCENDANTS, so the scope node itself was previously invisible -- the climb found 0
  // candidates on that button and ascended to a broader parent where several sibling owners
  // appeared (ambiguous). This local helper includes the scope node itself under the exact same
  // owner/compatibility predicates, WITHOUT changing `walkAll`'s semantics for any other caller.
  function collectOwnerCandidatesIncludingSelf(node: FieldScopedDomElement): FieldScopedDomElement[] {
    const descendants = walkAll(node, isOwnerCandidate);
    return isOwnerCandidate(node) ? [node, ...descendants] : descendants;
  }

  function scopeCandidateStats(node: FieldScopedDomElement): {
    compatibleCount: number;
    disabledCompatibleCount: number;
    otherCount: number;
  } {
    let compatibleCount = 0;
    let disabledCompatibleCount = 0;
    let otherCount = 0;
    for (const el of collectOwnerCandidatesIncludingSelf(node)) {
      const role = deriveOwnerRole(el);
      if (isCompatibleForIntent(el, role)) {
        compatibleCount += 1;
        if (isOwnerDisabled(el)) disabledCompatibleCount += 1;
      } else {
        otherCount += 1;
      }
    }
    return { compatibleCount, disabledCompatibleCount, otherCount };
  }

  // A native/ARIA field-grouping boundary -- never a project/app-specific attribute or class,
  // exactly the same "generic, never a fixed list of app-owned names" principle already applied
  // to `isStableAttributeName` above.
  function isFieldGroupingBoundary(el: FieldScopedDomElement): boolean {
    if (el.tagName.toLowerCase() === "fieldset") return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    return role === "group" || role === "radiogroup";
  }

  /**
   * FIELD SCOPE selection: climbs from the anchor's starting point, accepting the FIRST
   * (narrowest) ancestor whose subtree contains EXACTLY ONE candidate compatible with the
   * requested action intent. An ancestor with ZERO compatible candidates is too narrow --
   * continue climbing. An ancestor with MORE THAN ONE is already too broad -- stop immediately
   * (climbing further can only ever ADD more candidates, never remove the ambiguity, since every
   * wider ancestor's subtree is a superset of a narrower one's). Never requires a stable
   * attribute: that is a SEPARATE, later concern (`findCertificationAncestor`), never a
   * precondition for recognizing a real, unique structural scope.
   *
   * FIRST_LOSS fix (confirmed against real physical diagnostics, job c210b7a0): climbing past a
   * `fieldset`/`role="group"`/`role="radiogroup"` boundary with zero compatible candidates found
   * INSIDE it let the search land on an unrelated, much broader container (a page-level
   * `<section>`) that happened to contain exactly one actionable control belonging to a
   * DIFFERENT, unrelated feature ("Añadir relacionado"), which was then wrongly certified as the
   * field's owner and physically clicked. A native/ARIA field-grouping boundary already
   * demarcates the field's true structural limit; if the real owner cannot be found within it,
   * the search must fail closed there rather than manufacture a relation to something outside it.
   */
  function findFieldScope(
    anchor: FieldScopedDomElement,
    trace?: FieldScopeAncestorTrace[],
  ): { scope: FieldScopedDomElement | null; ambiguous: boolean } {
    let node: FieldScopedDomElement | null = anchor;
    for (let depth = 0; depth < MAX_CONTAINER_CLIMB && node; depth++) {
      const stats = scopeCandidateStats(node);
      const hasStableAttribute = node.tagName.toLowerCase() !== "label" && Boolean(collectStableAttributes(node));
      const scopeDecision: FieldScopeAncestorTrace["scopeDecision"] =
        stats.compatibleCount === 0 ? "continue" : stats.compatibleCount === 1 ? "accepted" : "ambiguous";
      if (trace) {
        trace.push({
          depth,
          tag: node.tagName.toLowerCase(),
          hasStableAttribute,
          compatibleCandidateCount: stats.compatibleCount,
          disabledCompatibleCandidateCount: stats.disabledCompatibleCount,
          otherOwnerCandidateCount: stats.otherCount,
          scopeDecision,
        });
      }
      if (scopeDecision === "accepted") return { scope: node, ambiguous: false };
      if (scopeDecision === "ambiguous") return { scope: null, ambiguous: true };
      if (isFieldGroupingBoundary(node)) return { scope: null, ambiguous: false };
      node = node.parentElement;
    }
    return { scope: null, ambiguous: false };
  }

  /**
   * Certification identity is a SEPARATE concern from field-scope selection: once a unique
   * structural scope is proven, a further (still bounded, still non-positional) climb from that
   * SAME scope looks for the nearest ancestor carrying a real stable attribute, to use for
   * `FieldContainerEvidence`. This may be the scope itself, or something broader -- broader is
   * fine precisely because `textAnchor` (attached separately, see the caller) lets the
   * materializer disambiguate a stable-but-broad container from unrelated sibling fields it also
   * contains.
   */
  function findCertificationAncestor(scope: FieldScopedDomElement): FieldScopedDomElement | null {
    let node: FieldScopedDomElement | null = scope;
    for (let depth = 0; depth < MAX_CONTAINER_CLIMB && node; depth++) {
      if (node.tagName.toLowerCase() !== "label" && collectStableAttributes(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  const target = normalizeFieldText(associatedField);
  if (!target) return undefined;

  // Diagnostics accumulated across every mechanism -- ids/counts/tags only, never DOM text or
  // dataset values. `ancestorTrace` is captured once, for the FIRST anchor any mechanism
  // actually attempts to climb from, so a physical run can see exactly where the climb stopped.
  let anchorFound = false;
  let anchorTag: string | undefined;
  let scopeAmbiguous = false;
  const ancestorTrace: FieldScopeAncestorTrace[] = [];
  // `displayAnchor` is the element that actually MATCHED (the label/legend/aria-owner/leaf text
  // node itself) -- reported in diagnostics as `anchorTag`. `climbStart` is where the ancestor
  // walk begins (typically `displayAnchor.parentElement`, since the anchor's own ancestors are
  // what can carry the container's stable identity, never the anchor itself unless it already
  // qualifies, which is checked separately before this is ever called).
  const climbFromFirstAnchor = (
    displayAnchor: FieldScopedDomElement,
    climbStart: FieldScopedDomElement,
  ): FieldScopedDomElement | null => {
    const capture = !anchorFound;
    if (capture) {
      anchorFound = true;
      anchorTag = displayAnchor.tagName.toLowerCase();
    }
    const result = findFieldScope(climbStart, capture ? ancestorTrace : undefined);
    if (result.ambiguous) scopeAmbiguous = true;
    return result.scope;
  };

  const labelsAndLegends = walkAll(root.body, (el) => {
    const tag = el.tagName.toLowerCase();
    return tag === "label" || tag === "legend";
  });
  const semanticLabelMatchCount = labelsAndLegends.filter((el) => normalizeFieldText(el.textContent) === target).length;

  let scope: FieldScopedDomElement | null = null;
  // Set only by the two "the label/fieldset itself already has a stable attribute" shortcuts
  // below, which bypass field-scope climbing entirely (pre-existing, unchanged behavior) --
  // every other path derives certification from `scope` via `findCertificationAncestor`.
  let certificationAncestorOverride: FieldScopedDomElement | null = null;

  for (const labelEl of labelsAndLegends) {
    if (normalizeFieldText(labelEl.textContent) !== target) continue;
    const tag = labelEl.tagName.toLowerCase();

    if (tag === "legend") {
      const fieldset = labelEl.parentElement;
      if (fieldset && fieldset.tagName.toLowerCase() === "fieldset") {
        if (collectStableAttributes(fieldset)) {
          scope = fieldset;
          certificationAncestorOverride = fieldset;
        } else {
          scope = climbFromFirstAnchor(labelEl, fieldset.parentElement ?? fieldset);
        }
      }
      if (scope) break;
      continue;
    }

    // The label itself is a valid scope+container whenever it carries its own stable attribute
    // -- independent of whether it currently anchors a live owner (a `for` target can be broken
    // or absent; the owner pool step below is what legitimately decides "zero owners here").
    if (collectStableAttributes(labelEl)) {
      scope = labelEl;
      certificationAncestorOverride = labelEl;
      break;
    }

    const forId = labelEl.getAttribute("for");
    let anchor: FieldScopedDomElement | null = forId ? root.getElementById(forId) : null;
    if (!anchor) anchor = walkAll(labelEl, isOwnerCandidate)[0] ?? null;
    if (!anchor) continue;

    scope = climbFromFirstAnchor(labelEl, anchor.parentElement ?? anchor);
    if (scope) break;
  }

  let ariaRelationMatchCount = 0;
  if (!scope) {
    const ariaOwners = walkAll(root.body, isOwnerCandidate).filter((el) => {
      const labelledBy = el.getAttribute("aria-labelledby");
      if (!labelledBy) return false;
      const labelNode = root.getElementById(labelledBy);
      return labelNode ? normalizeFieldText(labelNode.textContent) === target : false;
    });
    ariaRelationMatchCount = ariaOwners.length;
    for (const owner of ariaOwners) {
      scope = climbFromFirstAnchor(owner, owner.parentElement ?? owner);
      if (scope) break;
    }
  }

  // Generic text-anchor relation: many UI libraries render a field's visible name as a plain
  // text node (a <span>/<div>/<p>, never a semantic <label>) with no `for`/`aria-labelledby`
  // wiring at all -- the relation is pure DOM adjacency (the real control is a nearby sibling
  // inside a shared field wrapper). Confirmed against a real physical page: the field's name
  // rendered as a bare <span>, immediately followed by the actual editable input as its sibling,
  // both inside one wrapper carrying its own stable id -- neither <label>/<legend> nor
  // aria-labelledby existed anywhere in that DOM. Matched purely by exact normalized text
  // equality (the SAME comparison already used for label/legend above) on an element that is
  // itself NOT an owner (never an input/button matching its own field's name), so this can
  // never compete with or substitute a real semantic label when one exists -- it only runs when
  // both prior mechanisms found nothing.
  // Broad match count (before leaf filtering) surfaces whether the text was found AT ALL, even
  // if leaf-filtering later rejects every match -- distinguishing "no such text anywhere"
  // (a normalization/whitespace/encoding problem) from "found, but never as a leaf" (a nested
  // wrapper problem).
  const textMatchingNonOwners = walkAll(root.body, (el) => !isOwnerCandidate(el) && normalizeFieldText(el.textContent) === target);
  const textAnchorMatchCount = textMatchingNonOwners.length;
  const leafTextAnchors = textMatchingNonOwners.filter((el) => el.children.length === 0);
  const leafAnchorMatchCount = leafTextAnchors.length;

  // Generic text-anchor relation: many UI libraries render a field's visible name as a plain
  // text node (a <span>/<div>/<p>, never a semantic <label>) with no `for`/`aria-labelledby`
  // wiring at all -- the relation is pure DOM adjacency (the real control is a nearby sibling
  // inside a shared field wrapper). Confirmed against a real physical page: the field's name
  // rendered as a bare <span>, immediately followed by the actual editable input as its sibling,
  // both inside one wrapper carrying its own stable id -- neither <label>/<legend> nor
  // aria-labelledby existed anywhere in that DOM. Matched purely by exact normalized text
  // equality (the SAME comparison already used for label/legend above) on an element that is
  // itself NOT an owner (never an input/button matching its own field's name), so this can
  // never compete with or substitute a real semantic label when one exists -- it only runs when
  // both prior mechanisms found nothing.
  //
  // Leaf-only (`children.length === 0`): a wrapper whose AGGREGATE text happens to equal the
  // target purely because its only text-bearing descendant is the real label leaf must never be
  // picked as the anchor itself -- climbing must always start from the actual leaf text node,
  // exactly like the label/legend text-node case above.
  if (!scope) {
    for (const anchor of leafTextAnchors) {
      scope = climbFromFirstAnchor(anchor, anchor.parentElement ?? anchor);
      if (scope) break;
    }
  }

  const ancestorsInspected = ancestorTrace.length;
  if (!scope) {
    return {
      candidates: [],
      diagnostics: {
        textAnchorMatchCount,
        semanticLabelMatchCount,
        ariaRelationMatchCount,
        leafAnchorMatchCount,
        anchorFound,
        anchorTag,
        ancestorsInspected,
        ancestorTrace,
        containerAccepted: false,
        rejectReason: scopeAmbiguous ? "scope_ambiguous" : anchorFound ? "climb_exhausted" : "no_anchor_found",
      },
    };
  }

  // Certification identity is derived SEPARATELY from the accepted scope -- the scope itself
  // may have no stable attribute at all (that is precisely the real physical shape this ticket
  // fixes), so a further, still-bounded climb looks for the nearest ancestor that does. When
  // that ancestor differs from the scope, `textAnchor` rides along so the CSS built from it can
  // be safely narrowed to only this field, never every field the broader ancestor also contains.
  const certificationAncestor = certificationAncestorOverride ?? findCertificationAncestor(scope);
  const role = certificationAncestor?.getAttribute("role") ?? undefined;
  // FIRST_LOSS fix: when NO ancestor within the climb carries a stable attribute at all (the real
  // physical shape confirmed for this field -- fieldset/wrapper chain with no id/data-*), there
  // was no fallback at all -- `containerEvidence` stayed undefined and the field-scoped-fallback's
  // own Tier-1 runtime-ambiguity recovery (see target-resolver.ts) could never even attempt a
  // scoped retry, despite the SCOPE itself (already field-relation-proven, never a guess) being a
  // real, bounded structural node. Falls back to that SCOPE as the container -- tag + the field's
  // own known, recorded name as `textAnchor` (never a stable attribute claim, since it has none) --
  // so the materializer can still build a scoped, text-anchored CSS instead of nothing at all.
  // Ephemeral runtime identity for the EXACT node `findFieldScope` accepted. The accepted scope's
  // physical identity was previously discarded (only tag/role/textAnchor survived), so the
  // materializer had to re-expand a broader `:has-text():has():not(:has())` CSS that could match
  // several equivalent containers at runtime. Marking the accepted node here lets the retry recover
  // the SAME node by an exact, position-free locator. The marker is runtime-only: never persisted as
  // a promotable locator, removed by the caller once the attempt finishes.
  const ACCEPTED_SCOPE_MARKER_ATTRIBUTE = "data-codex-accepted-field-scope";
  let acceptedScopeRuntimeMarker: string | undefined;
  if (typeof scope.setAttribute === "function") {
    acceptedScopeRuntimeMarker = "codex-accepted-scope-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    scope.setAttribute(ACCEPTED_SCOPE_MARKER_ATTRIBUTE, acceptedScopeRuntimeMarker);
  }
  // The accepted scope may itself be the actionable owner (the unique anchor's direct containing
  // element). That is the exact runtime target -- a self-owner, never a container+descendant pair.
  const selfOwnerAccepted = isOwnerCandidate(scope) && isCompatibleForIntent(scope, deriveOwnerRole(scope));

  const containerEvidence: FieldContainerEvidence | undefined = certificationAncestor
    ? {
        tag: certificationAncestor.tagName.toLowerCase(),
        ...(role ? { role } : {}),
        stableDirectAttributes: collectStableAttributes(certificationAncestor),
        ...(certificationAncestor !== scope ? { textAnchor: associatedField.trim() } : {}),
      }
    // No stable ancestor exists anywhere within the climb -- fall back to the SCOPE itself, which
    // `findFieldScope` already proved unique/compatible/anchor-related on its own structural
    // merit, regardless of its tag. `fromAcceptedFieldScope` transports exactly that authority to
    // the materializer -- never re-derived from the tag name there, never "any div".
    : {
        tag: scope.tagName.toLowerCase(),
        ...(scope.getAttribute("role") ? { role: scope.getAttribute("role")! } : {}),
        textAnchor: associatedField.trim(),
        fromAcceptedFieldScope: true,
        ...(acceptedScopeRuntimeMarker ? { acceptedScopeRuntimeMarker } : {}),
        ...(selfOwnerAccepted ? { selfOwner: true } : {}),
      };

  // Always the scope's own identity, independent of whatever `certificationAncestor` found --
  // see the `scopeContainer` doc comment on `FieldScopedDomEvidence` for why this must survive
  // even when a broader, unverified-unique container is also returned as `container`.
  const scopeContainer: FieldContainerEvidence = {
    tag: scope.tagName.toLowerCase(),
    ...(scope.getAttribute("role") ? { role: scope.getAttribute("role")! } : {}),
    textAnchor: associatedField.trim(),
    fromAcceptedFieldScope: true,
    ...(acceptedScopeRuntimeMarker ? { acceptedScopeRuntimeMarker } : {}),
    ...(selfOwnerAccepted ? { selfOwner: true } : {}),
  };

  const candidates: FieldScopedOwnerCandidate[] = collectOwnerCandidatesIncludingSelf(scope).map((el) => {
    const ownerRole = deriveOwnerRole(el);
    const stableDirectAttributes = collectStableAttributes(el);
    return {
      tag: el.tagName.toLowerCase(),
      ...(ownerRole ? { role: ownerRole } : {}),
      visible: isOwnerVisible(el),
      disabled: isOwnerDisabled(el),
      editable: isOwnerEditable(el, ownerRole),
      actionable: isOwnerActionable(el, ownerRole),
      ...(stableDirectAttributes ? { stableDirectAttributes } : {}),
    };
  });

  return {
    container: containerEvidence,
    scopeContainer,
    candidates,
    diagnostics: {
      textAnchorMatchCount,
      semanticLabelMatchCount,
      ariaRelationMatchCount,
      leafAnchorMatchCount,
      anchorFound,
      anchorTag,
      ancestorsInspected,
      ancestorTrace,
      containerAccepted: true,
    },
  };
}

/**
 * Injected verbatim into the live page via `page.evaluate` -- see the doc comment above.
 *
 * FIRST_LOSS fix: `.toString()` on a function compiled by this project's TypeScript/esbuild
 * toolchain (tsx) captures only the function's own literal text -- never the surrounding module
 * scope. That toolchain rewrites every named inner function/arrow declaration into a call to a
 * `__name(fn, "fnName")` helper (for `.name` preservation across bundling/minification), and
 * those `__name(...)` calls live INSIDE the function body, so `.toString()` faithfully includes
 * them -- but the helper itself is defined once in the surrounding MODULE scope, which never
 * travels with a `.toString()` snippet. Evaluating the raw snippet directly in this SAME Node
 * process can still happen to succeed (the toolchain's own helper is reachable via closures the
 * snippet never actually needed to resolve `__name` against), but the exact same snippet
 * injected into a live browser page throws `ReferenceError: __name is not defined` immediately --
 * confirmed physically (recording 52849d4b-bfa5-4842-850a-a43e6460dcaf): the extractor never ran
 * at all, and `field_container_not_resolved` was actually an unreported thrown exception.
 *
 * Fixed by making the injected source GENUINELY self-contained: wrapped in its own IIFE that
 * first defines `__name` as a trivial, LOCAL (never `window`/`globalThis`) identity pass-through
 * -- inert to the extractor's real behavior (it only ever existed for debugging `.name`
 * metadata) -- before returning the extractor function itself. This is deterministic and
 * portable as an independent unit: it depends on nothing the toolchain would otherwise need to
 * supply implicitly, and needs no per-app/per-field exception.
 */
export const FIELD_SCOPED_DOM_EVIDENCE_SOURCE = `(function(){var __name=function(fn){return fn};return(${extractFieldScopedDomEvidence.toString()});})()`;
