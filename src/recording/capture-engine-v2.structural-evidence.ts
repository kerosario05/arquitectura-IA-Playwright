/**
 * Shared browser-side source for computing a `StructuralOwnerIdentity` (see
 * `structural-owner-identity.ts`) for an arbitrary element -- embedded via `.toString()` into
 * BOTH `web-session-recorder.ts`'s legacy instrumentation and
 * `capture-engine-v2.browser-instrumentation.ts`'s V2 script, so the exact same structural-owner
 * concept (stable attributes/descendants/semantic shape/landmark ancestor/cross-page match
 * count) is computed identically regardless of which capture authority is active, without either
 * script re-deriving or duplicating the algorithm.
 *
 * Depends on `normalizeStructuralOwnerIdentity` (`structural-owner-identity.ts`) already being
 * declared as a free variable named `normalizeStructuralOwnerIdentity` in the embedding script's
 * scope -- both existing embedders already declare it first, in that exact order, before
 * embedding this source. `document` is the page's own global, exactly as every other embedded
 * source in this codebase (`web-session-recorder.ts`'s own `structuralOwnerIdentityFor`) assumes.
 *
 * The cross-page match-count scan is bounded to elements sharing the candidate's own tag name --
 * two owners with different tags can never share a structural identity anyway (the identity's
 * `owner.tag` is always part of the comparable fingerprint), so this never changes which
 * elements count as a match, only how many elements the scan has to visit.
 *
 * Every helper below is created as an ARRAY ELEMENT, never a direct `function foo(){}`/`var foo =
 * () => {}` binding: esbuild/tsx's dev transform infers a `.name` for any directly-named function
 * binding and wraps it in a `__name(fn, "foo")` call -- a helper this embedded source's actual
 * browser-page execution never has, which would throw `__name is not defined`. An array element
 * has no name-inferring context, so the functions stay anonymous; the `var foo = fns[i]` lines
 * right after are plain reference copies, never re-wrapped. Matches the existing embedded
 * sources' own simpler style (`STRUCTURAL_OWNER_IDENTITY_SOURCE`/`DERIVE_NATIVE_ARIA_ROLE_SOURCE`,
 * both single functions with no nested named helpers at all) for the same underlying reason.
 */
declare const normalizeStructuralOwnerIdentity: (input: unknown) => {
  owner: { tag: string; role?: string };
  stableDirectAttributes: Record<string, string>;
  stableDescendants: unknown[];
  semanticShape: string[];
  landmarkAncestor?: { tag: string; role?: string };
  deterministicStructuralIdentity: boolean;
  topologyTieBreakUnique?: true;
  identityAmbiguous?: boolean;
  structuralIdentityMatchCount?: number;
};

export function buildCandidateStructuralIdentity(el: Element, actionableOwner = false, scopeRoot?: Element): unknown {
  var LANDMARK_SELECTOR = 'nav, main, aside, header, footer, [role="navigation"], [role="main"], [role="complementary"], [role="banner"], [role="contentinfo"], [role="search"], [role="form"]';
  var STABLE_ATTRIBUTE_NAMES = ["id", "data-testid", "data-test-id", "name", "href", "aria-label", "aria-labelledby", "role", "data-field", "data-column", "alt", "src"];

  var helpers: any[] = [
    (node: any, name: string): string | null => (node && node.getAttribute ? node.getAttribute(name) : null),
    (node: any): Record<string, string> => {
      var result: Record<string, string> = {};
      for (var i = 0; i < STABLE_ATTRIBUTE_NAMES.length; i++) {
        var value = attrOf(node, STABLE_ATTRIBUTE_NAMES[i]);
        if (value) result[STABLE_ATTRIBUTE_NAMES[i]] = value;
      }
      return result;
    },
    (node: any): Array<{ relation: "descendant"; tag: string; role?: string; stableAttributes: Record<string, string> }> => {
      var descendants: Array<{ relation: "descendant"; tag: string; role?: string; stableAttributes: Record<string, string> }> = [];
      if (!node.querySelectorAll) return descendants;
      var all = node.querySelectorAll("*");
      for (var i = 0; i < all.length && descendants.length < 32; i++) {
        var candidate = all[i];
        var attributes = stableAttributesFor(candidate);
        if (Object.keys(attributes).length === 0) continue;
        descendants.push({
          relation: "descendant",
          tag: (candidate.tagName || "").toLowerCase(),
          role: attrOf(candidate, "role") || undefined,
          stableAttributes: attributes,
        });
      }
      return descendants;
    },
    (node: any): string[] => {
      var shape: string[] = [];
      if (!node.children) return shape;
      for (var i = 0; i < node.children.length; i++) {
        var child = node.children[i];
        var tag = (child.tagName || "").toLowerCase();
        var role = attrOf(child, "role");
        shape.push(role ? tag + ":" + role : tag);
      }
      return shape;
    },
    (node: any): { tag: string; role?: string } | undefined => {
      var landmark = node.closest ? node.closest(LANDMARK_SELECTOR) : null;
      if (!landmark) return undefined;
      return { tag: (landmark.tagName || "").toLowerCase(), role: attrOf(landmark, "role") || undefined };
    },
    (node: any): string => {
      var normalized = normalizeStructuralOwnerIdentity({
        ownerTag: (node.tagName || "").toLowerCase(),
        ownerRole: attrOf(node, "role") || undefined,
        stableDirectAttributes: stableAttributesFor(node),
        stableDescendants: stableDescendantsFor(node),
        semanticShape: semanticShapeFor(node),
        landmarkAncestor: landmarkAncestorFor(node),
      });
      return JSON.stringify({
        owner: normalized.owner,
        stableDirectAttributes: normalized.stableDirectAttributes,
        stableDescendants: normalized.stableDescendants,
        semanticShape: normalized.semanticShape,
        landmarkAncestor: normalized.landmarkAncestor || null,
      });
    },
    // FIRST_LOSS fix: `document.getElementsByTagName(...)` counted every same-tag node in the
    // WHOLE document with zero eligibility filtering -- a hidden overlay, a disconnected/removed
    // node, or an inert (aria-hidden/inert) duplicate sharing the same generic fingerprint could
    // inflate `structuralIdentityMatchCount` past 1 even when only ONE node is actually a live,
    // competing structural candidate. This reuses the SAME generic visibility idiom already
    // established elsewhere in this codebase's browser-context evaluation code (hidden/
    // aria-hidden/computed-style display-visibility-opacity/offsetWidth-offsetHeight-
    // getClientRects) -- never a new "active surface" system, never text/position/index.
    (node: any): boolean => {
      if (!node || node.isConnected === false) return false;
      if (node.hidden) return false;
      if (typeof node.closest === "function" && node.closest('[aria-hidden="true"], [inert]')) return false;
      var style = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(node) : null;
      if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0)) return false;
      return Boolean(node.offsetWidth || node.offsetHeight || (node.getClientRects && node.getClientRects().length));
    },
    // A bounded, content-blind topology signature used only after the existing structural
    // fingerprint has already collided. Counts are sorted before serialization, so DOM order
    // cannot affect it. It is evidence of runtime uniqueness, never a locator.
    (node: any): { signature: string; populated: boolean; childTagCounts: Record<string, number>; descendantTagCounts: Record<string, number> } => {
      var childTagCounts: Record<string, number> = {};
      var directChildren = node && node.children ? node.children : [];
      for (var i = 0; i < directChildren.length; i++) {
        var childTag = (directChildren[i].tagName || "").toLowerCase();
        if (childTag) childTagCounts[childTag] = (childTagCounts[childTag] || 0) + 1;
      }
      var descendantTagCounts: Record<string, number> = {};
      var descendants = node && node.querySelectorAll ? node.querySelectorAll("*") : [];
      for (var i = 0; i < descendants.length && i < 64; i++) {
        var descendantTag = (descendants[i].tagName || "").toLowerCase();
        if (descendantTag) descendantTagCounts[descendantTag] = (descendantTagCounts[descendantTag] || 0) + 1;
      }
      var childEntries: Array<[string, number]> = [];
      var childTags = Object.keys(childTagCounts).sort();
      for (var i = 0; i < childTags.length; i++) childEntries.push([childTags[i], childTagCounts[childTags[i]]]);
      var descendantEntries: Array<[string, number]> = [];
      var descendantTags = Object.keys(descendantTagCounts).sort();
      for (var i = 0; i < descendantTags.length; i++) descendantEntries.push([descendantTags[i], descendantTagCounts[descendantTags[i]]]);
      var populated = childEntries.length > 0 || descendantEntries.length > 0;
      return { signature: populated ? JSON.stringify({ childEntries, descendantEntries }) : "", populated, childTagCounts, descendantTagCounts };
    },
  ];
  var attrOf = helpers[0];
  var stableAttributesFor = helpers[1];
  var stableDescendantsFor = helpers[2];
  var semanticShapeFor = helpers[3];
  var landmarkAncestorFor = helpers[4];
  var fingerprintFor = helpers[5];
  var isEligibleStructuralCompetitor = helpers[6];
  var topologyFor = helpers[7];

  var base = normalizeStructuralOwnerIdentity({
    ownerTag: ((el as any).tagName || "").toLowerCase(),
    ownerRole: attrOf(el, "role") || undefined,
    stableDirectAttributes: stableAttributesFor(el),
    stableDescendants: stableDescendantsFor(el),
    semanticShape: semanticShapeFor(el),
    landmarkAncestor: landmarkAncestorFor(el),
  });
  var comparable = fingerprintFor(el);
  var count = 0;
  var eligibleFingerprintCandidates: any[] = [];
  var fingerprintMatchCountBeforeEligibility = 0;
  var diagnosticCandidateOrdinal = 0;
  var diagnosticCandidateLimit = 32;
  var diagnosticCandidatesTruncated = false;
  try {
    var sameTagNodes = scopeRoot && typeof scopeRoot.querySelectorAll === "function"
      ? scopeRoot.querySelectorAll(base.owner.tag)
      : document.getElementsByTagName(base.owner.tag);
    for (var i = 0; i < sameTagNodes.length; i++) {
      var candidate = sameTagNodes[i];
      if (fingerprintFor(candidate) !== comparable) continue;
      fingerprintMatchCountBeforeEligibility += 1;
      // The clicked owner itself always counts as match 1 -- it was just interacted with, so
      // its own eligibility is never in question. Any OTHER same-fingerprint node must clear
      // the same generic eligibility bar before it can inflate ambiguity.
      var sameClickedOwner = candidate === el;
      var eligible = sameClickedOwner || isEligibleStructuralCompetitor(candidate);
      if (eligible) {
        count += 1;
        eligibleFingerprintCandidates.push(candidate);
      }

      // Diagnostics are bounded to same-fingerprint candidates only and contain structural
      // metadata/counts, never text, HTML, attribute values, coordinates, or DOM authority.
      if (diagnosticCandidateOrdinal < diagnosticCandidateLimit) {
        diagnosticCandidateOrdinal += 1;
        var candidateStyle = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(candidate) : null;
        var candidateRects = candidate.getClientRects ? candidate.getClientRects() : [];
        var candidateStableAttributes = stableAttributesFor(candidate);
        var candidateStableDescendants = stableDescendantsFor(candidate);
        var candidateLandmark = landmarkAncestorFor(candidate);
        var ancestorLandmarkTags: string[] = [];
        // Read-only diagnostic topology: tag/role/attribute *names* and bounded counts only.
        // This deliberately excludes attribute values, text, DOM position, and coordinates.
        var nearestAncestorTags: string[] = [];
        var nearestAncestorRoles: string[] = [];
        var nearestStableAncestorAttributeNames: string[] = [];
        var formOrSectionOwnership = "";
        var ancestorNode: any = candidate.parentElement;
        var ancestorDepth = 0;
        while (ancestorNode && ancestorDepth < 12) {
          var ancestorTag = (ancestorNode.tagName || "").toLowerCase();
          var ancestorRole = attrOf(ancestorNode, "role") || "";
          if (ancestorTag) nearestAncestorTags.push(ancestorTag);
          if (ancestorRole) nearestAncestorRoles.push(ancestorRole);
          var ancestorStableAttributes = stableAttributesFor(ancestorNode);
          var ancestorAttributeNames = Object.keys(ancestorStableAttributes);
          for (var ancestorAttributeIndex = 0; ancestorAttributeIndex < ancestorAttributeNames.length; ancestorAttributeIndex++) {
            var ancestorAttributeName = ancestorAttributeNames[ancestorAttributeIndex];
            if (nearestStableAncestorAttributeNames.indexOf(ancestorAttributeName) < 0) nearestStableAncestorAttributeNames.push(ancestorAttributeName);
          }
          if (!formOrSectionOwnership && (ancestorTag === "form" || ancestorTag === "section" || ancestorRole === "form" || ancestorRole === "region")) {
            formOrSectionOwnership = ancestorTag || "role:" + ancestorRole;
          }
          if (ancestorTag === "nav" || ancestorTag === "main" || ancestorTag === "aside" || ancestorTag === "header" || ancestorTag === "footer"
            || ancestorRole === "navigation" || ancestorRole === "main" || ancestorRole === "complementary" || ancestorRole === "banner" || ancestorRole === "contentinfo" || ancestorRole === "search" || ancestorRole === "form") {
            var landmarkTag = ancestorTag || "role:" + ancestorRole;
            if (ancestorLandmarkTags.indexOf(landmarkTag) < 0) ancestorLandmarkTags.push(landmarkTag);
          }
          ancestorNode = ancestorNode.parentElement;
          ancestorDepth += 1;
        }
        var candidateTopology = topologyFor(candidate);
        var childTagCounts = candidateTopology.childTagCounts;
        var descendantTagCounts = candidateTopology.descendantTagCounts;
        var candidateDiagnostic = {
            candidateOrdinal: diagnosticCandidateOrdinal,
            sameClickedOwner,
            tag: (candidate.tagName || "").toLowerCase(),
            role: attrOf(candidate, "role") || "",
            connected: candidate.isConnected !== false,
            hidden: Boolean(candidate.hidden),
            ariaHiddenOrInert: Boolean(typeof candidate.closest === "function" && candidate.closest('[aria-hidden="true"], [inert]')),
            display: candidateStyle?.display || "",
            visibility: candidateStyle?.visibility || "",
            opacity: candidateStyle?.opacity || "",
            widthPositive: Boolean(candidate.offsetWidth),
            heightPositive: Boolean(candidate.offsetHeight),
            rectCount: candidateRects ? candidateRects.length : 0,
            eligible,
            fingerprintMatch: true,
            semanticShape: semanticShapeFor(candidate),
            landmarkAncestorTag: candidateLandmark?.tag || "",
            stableDirectAttributeNames: Object.keys(candidateStableAttributes).sort(),
            stableDirectAttributeCount: Object.keys(candidateStableAttributes).length,
            stableDescendantCount: candidateStableDescendants.length,
            ancestorLandmarkTags,
            nearestAncestorTags,
            nearestAncestorRoles,
            nearestStableAncestorAttributeNames: nearestStableAncestorAttributeNames.sort(),
            childTagCounts,
            descendantTagCounts,
            surfaceIdentityKind: candidateLandmark?.tag || "",
            formOrSectionOwnership,
          };
        var reporter = typeof window !== "undefined" ? (window as any).__qaStructuralIdentityDiagnostic : null;
        if (typeof reporter === "function") reporter("candidate", candidateDiagnostic);
        else if (typeof console !== "undefined" && console.info) console.info("[structural-identity-candidate]", candidateDiagnostic);
      } else {
        diagnosticCandidatesTruncated = true;
      }
    }
  } catch (e) {
    /* transient DOM -- never blocks capture */
  }
  var eligibleFingerprintMatchCount = count;
  var topologyTieBreakApplied = false;
  var topologyTieBreakMatchCount = eligibleFingerprintMatchCount;
  var ownerTopology = topologyFor(el);
  if (actionableOwner === true && eligibleFingerprintMatchCount > 1 && ownerTopology.populated) {
    var matchingTopologyCandidates = 0;
    for (var topologyCandidateIndex = 0; topologyCandidateIndex < eligibleFingerprintCandidates.length; topologyCandidateIndex++) {
      if (topologyFor(eligibleFingerprintCandidates[topologyCandidateIndex]).signature === ownerTopology.signature) matchingTopologyCandidates += 1;
    }
    topologyTieBreakMatchCount = matchingTopologyCandidates;
    if (matchingTopologyCandidates === 1) {
      count = 1;
      topologyTieBreakApplied = true;
    }
  }
  var structuralIdentity = normalizeStructuralOwnerIdentity({
    ownerTag: base.owner.tag,
    ownerRole: base.owner.role,
    stableDirectAttributes: base.stableDirectAttributes,
    stableDescendants: base.stableDescendants,
    semanticShape: base.semanticShape,
    landmarkAncestor: base.landmarkAncestor,
    structuralIdentityMatchCount: count,
    topologyTieBreakUnique: topologyTieBreakApplied,
    // Persist the exact bounded, content-blind topology signature the tie-break matched, so the
    // runtime matcher can compare each live candidate against the recorded owner instead of
    // trusting the boolean alone (which only certifies capture-time uniqueness).
    topologySignature: ownerTopology.signature,
  });
  var summaryDiagnostic = {
      ownerTag: base.owner.tag,
      ownerRole: base.owner.role || "",
      sameTagCandidateCount: typeof sameTagNodes !== "undefined" ? sameTagNodes.length : 0,
      fingerprintMatchCountBeforeEligibility,
      eligibleFingerprintMatchCount,
      topologyTieBreakMatchCount,
      topologyTieBreakApplied,
      clickedOwnerIncluded: true,
      deterministicStructuralIdentity: structuralIdentity.deterministicStructuralIdentity,
      identityAmbiguous: structuralIdentity.identityAmbiguous === true,
      diagnosticCandidateCount: diagnosticCandidateOrdinal,
      diagnosticCandidatesTruncated,
    };
  var summaryReporter = typeof window !== "undefined" ? (window as any).__qaStructuralIdentityDiagnostic : null;
  if (typeof summaryReporter === "function") summaryReporter("summary", summaryDiagnostic);
  else if (typeof console !== "undefined" && console.info) console.info("[structural-identity-candidates]", summaryDiagnostic);
  return structuralIdentity;
}

export const CANDIDATE_STRUCTURAL_IDENTITY_SOURCE = `(${buildCandidateStructuralIdentity.toString()})`;
