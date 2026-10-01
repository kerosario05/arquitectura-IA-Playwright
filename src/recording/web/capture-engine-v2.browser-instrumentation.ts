/**
 * CaptureEngine V2 -- SHADOW browser instrumentation.
 *
 * Sends normalized, structural-only messages to the Node-side `CaptureEngineV2ShadowBridge` via
 * a SEPARATE exposed binding (`__qaRecordV2`), never the legacy `__qaRecord` binding. This
 * script never decides ownership (no editable-wins/container-rejected rules here -- that is
 * `resolveCaptureOwner`'s job in Node, per "no duplicar sus reglas en el browser script"); it
 * only reports the raw structural facts `CaptureOwnerCandidate` needs for each ancestor.
 *
 * Idempotent per document via its own guard (`window.__qaRecorderV2InstalledV1`), independent of
 * the legacy `window.__qaRecorderInstalledV1` guard -- installing/reinstalling this script can
 * never affect the legacy one or vice versa.
 *
 * `documentId` is generated here (never derived from `location.href`, which is unstable across
 * an SPA route change and would wrongly imply a new document every time it changes) and is
 * stable for the lifetime of this document; a full navigation/document replacement re-runs this
 * whole init script and produces a fresh one, which is exactly what `DocumentLifecycle` needs to
 * tell a same-document SPA change from a real navigation.
 */
import { DERIVE_NATIVE_ARIA_ROLE_SOURCE } from "../capture-engine-v2.native-owner-semantics";
import { CANDIDATE_STRUCTURAL_IDENTITY_SOURCE } from "../capture-engine-v2.structural-evidence";
import { STRUCTURAL_OWNER_IDENTITY_SOURCE } from "../structural-owner-identity";
import { ACTIONABILITY_CONTRACT_SOURCE } from "../actionability-contract";
import { CLASSIFY_NATIVE_ROLE_IDENTITY_SOURCE } from "../capture-engine-v2.native-role-identity";
import { GENERIC_UNRESOLVED_LABELS, isGenericUnresolvedLabel } from "../trace-normalizer";

export function buildCaptureScriptV2Content(captureInstanceId: string): string {
  return String.raw`
(function () {
  if (window.__qaRecorderV2InstalledV1) return;
  window.__qaRecorderV2InstalledV1 = true;

  var captureInstanceId = ${JSON.stringify(captureInstanceId)};
  var documentId = "doc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  var sessionCounter = 0;
  var currentSessionId = null;
  // The editable element the open session belongs to, and whether a TRUSTED user interaction
  // (keyboard or pointer on that exact editable) has been observed inside it. Used only to prove
  // user causality for a value-delta commit -- never to turn focus/click alone into an edit.
  var currentSessionEl = null;
  var currentSessionTrusted = false;
  var currentSessionRawValue = "";
  var pendingRawInput = null;
  var pointerInteractionCounter = 0;
  var pendingPointerInteractionId = null;
  // Keep browser-to-Node binding calls observable until their exposed-binding promises settle.
  // Stop asks every recorder-owned frame to flush this set before closing the context.
  var pendingBindingCalls = new Set();
  // Read-only accessor for the legacy CAPTURE_SCRIPT's own MutationObserver-driven post_action
  // observation (a separate, always-installed script -- see web-session-recorder.ts) to correlate
  // its diagnostic mutation evidence to the V2 interaction that actually caused it, without a
  // second interactionId system: this exposes the SAME id V2's own pointerdown/click messages
  // already carry, never a new identity. Same exposure pattern as
  // window.__qaStructuralIdentityDiagnostic below.
  window.__qaRecorderV2ActiveInteractionId = function () {
    return pendingPointerInteractionId;
  };
  // Diagnostic-only bridge used by the legacy post_action observer. It reuses the
  // already-registered V2 channel and carries only redacted booleans/counts.
  window.__qaRecorderV2Diagnostic = function (stage, diagnostic) {
    send({ type: "capture_trace", stage: stage, diagnostic: diagnostic || {} });
  };

  function send(message) {
    if (!window.__qaRecordV2) return;
    message.captureInstanceId = captureInstanceId;
    message.documentId = documentId;
    var pending;
    try {
      pending = Promise.resolve(window.__qaRecordV2(message));
    } catch (e) {
      return;
    }
    pendingBindingCalls.add(pending);
    pending.catch(function () {}).then(function () { pendingBindingCalls.delete(pending); });
  }

  window.__qaRecorderV2Flush = async function () {
    while (pendingBindingCalls.size > 0) {
      await Promise.allSettled(Array.from(pendingBindingCalls));
    }
  };

  function isVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isEditableNode(el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      return ["button", "submit", "checkbox", "radio", "reset", "image", "file"].indexOf(type) === -1;
    }
    if (el.isContentEditable) return true;
    var role = (el.getAttribute("role") || "").toLowerCase();
    return role === "textbox";
  }

  // Recorder-only evidence for homogeneous segmented controls (OTP/PIN-like, but generic).
  // It is emitted only when one stable scope contains an exact, visible, editable group whose
  // controls share the same basic DOM contract; it is never a positional locator.
  function segmentedInputEvidence(el, scopeIdentity, scopeElement) {
    if (!el || !scopeIdentity || !scopeElement || !isEditableNode(el)) return undefined;
    var controls = Array.prototype.slice.call(scopeElement.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]'))
      .filter(function (candidate) { return isEditableNode(candidate) && isVisible(candidate) && !(candidate.disabled === true); });
    if (controls.length < 2) return undefined;
    var tag = (el.tagName || "").toLowerCase();
    var type = tag === "input" ? ((el.getAttribute("type") || "text").toLowerCase()) : tag;
    var homogeneous = controls.every(function (candidate) {
      var candidateTag = (candidate.tagName || "").toLowerCase();
      var candidateType = candidateTag === "input" ? ((candidate.getAttribute("type") || "text").toLowerCase()) : candidateTag;
      var maxLength = Number(candidate.getAttribute && candidate.getAttribute("maxlength"));
      return candidateTag === tag && candidateType === type && maxLength === 1;
    });
    if (!homogeneous) return undefined;
    return {
      kind: "segmented_input",
      targetTag: tag,
      scopeIdentity: scopeIdentity,
      captureMatchCount: 1,
      runtimeResolutionRequired: true,
      segmentCount: controls.length,
      inputMode: el.getAttribute && (el.getAttribute("inputmode") || undefined),
    };
  }

  function isActionableNode(el) {
    var tag = (el.tagName || "").toLowerCase();
    if (["button", "a", "option", "menuitem", "summary"].indexOf(tag) !== -1) return true;
    if (tag === "input") {
      var type = (el.getAttribute("type") || "").toLowerCase();
      return ["button", "submit", "checkbox", "radio", "reset"].indexOf(type) !== -1;
    }
    return Boolean(el.getAttribute && el.getAttribute("role"));
  }

  var classifyActionability = ${ACTIONABILITY_CONTRACT_SOURCE};
  var classifyNativeRoleIdentity = ${CLASSIFY_NATIVE_ROLE_IDENTITY_SOURCE};

  // The identical mapping is defined/tested in Node (capture-engine-v2.native-owner-semantics.ts)
  // and interpolated here so browser and Node can never drift apart.
  var deriveNativeAriaRole = ${DERIVE_NATIVE_ARIA_ROLE_SOURCE};

  // Same reuse principle for structural-owner identity (stable attributes/descendants/semantic
  // shape/landmark ancestor/cross-page match count): defined and unit-tested once in Node
  // (structural-owner-identity.ts / capture-engine-v2.structural-evidence.ts), interpolated here
  // so the SAME concept computed for a legacy-recorded owner and a V2-recorded owner can never
  // drift apart. buildCandidateStructuralIdentity depends on normalizeStructuralOwnerIdentity
  // already being declared, in exactly this order.
  var normalizeStructuralOwnerIdentity = ${STRUCTURAL_OWNER_IDENTITY_SOURCE};
  var buildCandidateStructuralIdentity = ${CANDIDATE_STRUCTURAL_IDENTITY_SOURCE};
  // Serialize the same generic-label contract used by Node-side admission so a placeholder
  // button caption cannot suppress a stronger grid/header relation during browser capture.
  var GENERIC_UNRESOLVED_LABELS = new Set(${JSON.stringify(Array.from(GENERIC_UNRESOLVED_LABELS))});
  var isGenericUnresolvedLabel = ${isGenericUnresolvedLabel.toString()};
  window.__qaStructuralIdentityDiagnostic = function (kind, payload) {
    send({ type: "structural_identity_diagnostic", diagnosticKind: kind, payload: payload });
  };

  function nativeRole(el) {
    var tag = (el.tagName || "").toLowerCase();
    return deriveNativeAriaRole({
      tag: tag,
      type: tag === "input" ? (el.getAttribute("type") || undefined) : undefined,
      hasHref: tag === "a" ? Boolean(el.hasAttribute && el.hasAttribute("href")) : undefined,
      multiple: tag === "select" ? Boolean(el.multiple) : undefined,
      size: tag === "select" ? el.size : undefined,
    });
  }

  // STRONG accessible-name sources only (aria-label -> aria-labelledby -> associated <label> ->
  // own text for a handful of text-bearing native controls). Deliberately excludes
  // placeholder/title: those are format/instructional HINTS, not identity, and must never
  // outrank a real associatedField/grid-column relation (a grid editor's placeholder like
  // "Indicar..." or a phone-format mask "000-000-0000" is never who the field IS). Never a full
  // container textContent dump -- only bounded, standard accessible-name sources.
  function explicitAccessibleName(el) {
    var ariaLabel = el.getAttribute && el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
    var labelledBy = el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledBy) {
      var labelledByEl = document.getElementById(labelledBy);
      if (labelledByEl && labelledByEl.textContent && labelledByEl.textContent.trim()) return labelledByEl.textContent.trim();
    }
    if (el.labels && el.labels.length > 0 && el.labels[0].textContent && el.labels[0].textContent.trim()) {
      return el.labels[0].textContent.trim();
    }
    // FIRST_LOSS fix: alt is a native, explicit accessible-name source per the HTML/ARIA
    // accessible-name computation (img, area, input type=image) -- as authoritative as
    // aria-label, never inferred from tag. Without this, a trusted click on such an element
    // (e.g. a clickable product-card image with no wrapping labelled control) had no explicit
    // name to classify, fell through to the no-textContent "none" branch below, and was never
    // captured as a semantic role+name identifier -- confirmed physically: Capture V2 showed it
    // only as an unlabeled structural "control" while a role-based img locator using that alt
    // text resolved it correctly and uniquely at runtime.
    var altText = el.getAttribute && el.getAttribute("alt");
    if (altText && altText.trim()) return altText.trim();
    // FIRST_LOSS fix: input type=submit/button/reset is a void element -- it can never have
    // textContent -- and per the standard HTML accessible-name computation, its value attribute
    // IS the control's real name (e.g. input type=submit value=Continuar), not a
    // placeholder/format hint. Without this, every such button fell through to the generic
    // sentinel label regardless of its real, visible text -- confirmed against a real recording
    // whose Continuar button used exactly this markup.
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input") {
      var inputType = (el.getAttribute && el.getAttribute("type") || "").toLowerCase();
      if ((inputType === "submit" || inputType === "button" || inputType === "reset") && el.value && String(el.value).trim()) {
        return String(el.value).trim();
      }
    }
    return "";
  }

  function semanticTextFragments(el) {
    var semanticNodes = Array.prototype.slice.call(el.querySelectorAll ? el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,[role="heading"],[role="paragraph"]') : []);
    return semanticNodes.filter(isVisible).map(function (node) { return (node.textContent || "").trim(); }).filter(Boolean);
  }

  function semanticHeadingFragments(el) {
    var headingNodes = Array.prototype.slice.call(el.querySelectorAll ? el.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]') : []);
    return headingNodes.filter(isVisible).map(function (node) { return (node.textContent || "").trim(); }).filter(Boolean);
  }

  // WEAK fallback only -- placeholder/title. Used only when nothing stronger (a real name OR a
  // structural field relation) identifies the owner at all.
  function computeWeakAccessibleName(el) {
    var placeholder = el.getAttribute && el.getAttribute("placeholder");
    if (placeholder && placeholder.trim()) return placeholder.trim();
    var title = el.getAttribute && el.getAttribute("title");
    if (title && title.trim()) return title.trim();
    return "";
  }

  // Certified grid column identity: a cell's column is its INDEX within its own row, aligned
  // against the SAME index in the table's header row -- the standard, non-positional-as-locator
  // way HTML tables associate a data cell with its column header (this is semantic labeling
  // evidence, never a technical locator strategy). Bounded to one table/row/header lookup, never
  // a full-document scan, never picks a header by proximity/nearest-text guessing.
  var GRID_CELL_SELECTOR = 'td, th, [role="gridcell"], [role="cell"]';
  var GRID_HEADER_SELECTOR = 'thead th, thead td, [role="columnheader"], [data-header], [data-column-header]';

  function gridHeaderContext(el) {
    var cell = el.closest && el.closest(GRID_CELL_SELECTOR);
    if (!cell) return undefined;
    var table = el.closest && el.closest('table, [role="grid"], [data-grid], [data-testid*="grid"], [data-testid*="table"]');
    if (!table) return undefined;
    var row = el.closest && el.closest('tr, [role="row"]');
    var explicit = cell.getAttribute && cell.getAttribute("aria-colindex");
    var headers = Array.prototype.slice.call(table.querySelectorAll(GRID_HEADER_SELECTOR));
    var header;
    if (explicit) {
      header = headers.filter(function (candidate) { return candidate.getAttribute("aria-colindex") === explicit; })[0];
    } else if (row) {
      var cells = Array.prototype.slice.call(row.querySelectorAll(GRID_CELL_SELECTOR));
      var cellIndex = cells.indexOf(cell);
      header = cellIndex >= 0 ? headers[cellIndex] : undefined;
    }
    var text = header && header.textContent ? header.textContent.trim() : "";
    return text ? text.slice(0, 80) : undefined;
  }

  var INTERACTIVE_SELECTOR = "input,textarea,select,button,a,[role]";

  // Generic, structural field-container association: for a control with no direct accessible
  // name (a bare icon button, an unlabelled custom combobox), walk a BOUNDED number of ancestors
  // looking for a container whose only non-interactive child is a short, visible label-like text
  // -- and whose interactive descendant count stays small enough that the label is unambiguously
  // about THIS control, never a large panel's aggregated heading. Never reads a huge ancestor's
  // full textContent, never picks by DOM position among several candidates.
  var MAX_FIELD_CONTAINER_DEPTH = 4;
  // FIRST_LOSS fix: a real product-card grid ancestor (a handful of sibling cards, each with its
  // own button/link) routinely has more than 4 interactive descendants without being some huge,
  // page-wide container -- this guard exists to reject genuinely oversized containers (e.g. a
  // whole page body/nav), never a normal multi-card grid a few levels up. Raised from 4 to 16,
  // still a bounded sanity check, not unlimited.
  var MAX_FIELD_CONTAINER_INTERACTIVE_DESCENDANTS = 16;
  var MAX_FIELD_LABEL_LENGTH = 60;

  function shortLabelChildOf(container, excludeEl) {
    var children = container.children ? Array.prototype.slice.call(container.children) : [];
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child === excludeEl || (excludeEl && child.contains && child.contains(excludeEl))) continue;
      var tag = (child.tagName || "").toLowerCase();
      if (["input", "textarea", "select", "button", "a", "svg", "path"].indexOf(tag) !== -1) continue;
      var text = child.textContent ? child.textContent.trim() : "";
      if (text && text.length > 0 && text.length <= MAX_FIELD_LABEL_LENGTH && isVisible(child)) return text;
    }
    return undefined;
  }

  function computeAssociatedField(el) {
    var node = el;
    var levelDiagnostics = [];
    for (var depth = 0; depth < MAX_FIELD_CONTAINER_DEPTH && node && node.parentElement; depth++) {
      node = node.parentElement;
      var interactiveCount = node.querySelectorAll ? node.querySelectorAll(INTERACTIVE_SELECTOR).length : 0;
      var skippedForInteractiveCount = interactiveCount > MAX_FIELD_CONTAINER_INTERACTIVE_DESCENDANTS;
      levelDiagnostics.push({ ancestorDepth: depth, interactiveCount: interactiveCount, childCount: node.children ? node.children.length : 0, skippedForInteractiveCount: skippedForInteractiveCount });
      if (skippedForInteractiveCount) continue;
      var label = shortLabelChildOf(node, el);
      if (label) {
        try { send({ type: "capture_trace", stage: "associated_field_depth_diagnostic", trusted: true, diagnostic: { found: true, foundAtDepth: depth, levels: levelDiagnostics } }); } catch (e) { /* never blocks capture */ }
        return label;
      }
    }
    try { send({ type: "capture_trace", stage: "associated_field_depth_diagnostic", trusted: true, diagnostic: { found: false, levels: levelDiagnostics } }); } catch (e) { /* never blocks capture */ }
    return undefined;
  }

  // Shared, single computation for "this target's own structural evidence, scoped to this exact
  // scopeRoot element" -- reused for BOTH (a) a candidate's own identity scoped to whatever
  // ancestor IT independently found, and (b) the ORIGINAL clicked event target's own identity
  // scoped to a DIFFERENT candidate acting as scope root. Scope and target proof therefore
  // always come from calling buildCandidateStructuralIdentity ONCE with a single, consistent
  // (targetEl, scopeRootEl) pair -- never combined post-hoc from two independently-scoped
  // candidates. targetFingerprint always describes targetEl, never scopeRootEl.
  function computeScopeBoundEvidence(targetEl, scopeIdentityRef, scopeRootEl, actionableOwner) {
    var scopeMatchCount = 0;
    try {
      var scopeSelector = scopeIdentityRef.strategy === "id"
          ? "[id=\"" + scopeIdentityRef.value.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\"]"
          : "[data-testid=\"" + scopeIdentityRef.value.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\"]";
      scopeMatchCount = document.querySelectorAll(scopeSelector).length;
    } catch (e) { scopeMatchCount = 0; }
    var identity = buildCandidateStructuralIdentity(targetEl, actionableOwner, scopeRootEl);
    identity.scopeIdentity = scopeIdentityRef;
    identity.captureScopeUnique = scopeMatchCount === 1;
    identity.captureTargetMatchCount = identity.structuralIdentityMatchCount;
    var fingerprintAttributeNames = ["id", "data-testid", "data-test-id", "name", "href", "role", "data-field", "data-column", "src"];
    var fingerprintAttributes = {};
    Object.keys(identity.stableDirectAttributes || {}).forEach(function (name) {
      if (fingerprintAttributeNames.indexOf(name) >= 0) fingerprintAttributes[name] = identity.stableDirectAttributes[name];
    });
    var fingerprintDescendants = (identity.stableDescendants || []).map(function (descendant) {
      var stableAttributes = {};
      Object.keys(descendant.stableAttributes || {}).forEach(function (name) {
        if (fingerprintAttributeNames.indexOf(name) >= 0) stableAttributes[name] = descendant.stableAttributes[name];
      });
      return { relation: descendant.relation, tag: descendant.tag, role: descendant.role, stableAttributes: stableAttributes };
    }).filter(function (descendant) { return Object.keys(descendant.stableAttributes).length > 0; });
    identity.targetFingerprint = JSON.stringify({
      owner: identity.owner,
      stableDirectAttributes: fingerprintAttributes,
      stableDescendants: fingerprintDescendants,
      semanticShape: identity.semanticShape,
      topologySignature: identity.topologySignature || "",
    });
    return identity;
  }

  // DIAGNOSE-ONLY (recordingId=bbb29e0a-...): does the ORIGINAL clicked target, or a node in its
  // lineage up to a given selected scope, carry an EXPLICIT, non-positional HTML/ARIA relation
  // (id-reference or native label association) to exactly one durable, actionable/editable
  // control inside that same scope. Reuses isEditableNode/isActionableNode and the existing
  // id/data-testid technical-ref notion -- never a new classification. Never feeds owner
  // resolution, structural evidence, readiness, or the runtime resolver -- diagnostic only.
  var EXPLICIT_RELATION_ATTRIBUTES = ["aria-controls", "aria-owns", "aria-labelledby", "aria-describedby"];

  function hasTechnicalRef(node) {
    if (!node) return false;
    if (node.id) return true;
    return Boolean(node.getAttribute && node.getAttribute("data-testid"));
  }

  function explicitRelationTargetsOf(node) {
    var kinds = [];
    var targets = [];
    for (var i = 0; i < EXPLICIT_RELATION_ATTRIBUTES.length; i++) {
      var attrName = EXPLICIT_RELATION_ATTRIBUTES[i];
      var attrValue = node.getAttribute && node.getAttribute(attrName);
      if (!attrValue) continue;
      kinds.push(attrName);
      var ids = attrValue.split(/\s+/).filter(Boolean);
      for (var idIndex = 0; idIndex < ids.length; idIndex++) {
        var referenced = document.getElementById(ids[idIndex]);
        if (referenced) targets.push(referenced);
      }
    }
    if ((node.tagName || "").toLowerCase() === "label" && node.control) {
      kinds.push(node.getAttribute && node.getAttribute("for") ? "label-for" : "label-wrap");
      targets.push(node.control);
    }
    return { kinds: kinds, targets: targets };
  }

  function classCountOf(n) { return n === 0 ? "zero" : n === 1 ? "one" : "many"; }

  function diagnoseExplicitRelatedControl(originalTarget, scopeRootEl) {
    var lineage = [originalTarget];
    var node = originalTarget.parentElement;
    for (var depth = 0; node && depth < 12; depth++, node = node.parentElement) {
      lineage.push(node);
      if (node === scopeRootEl) break;
    }
    var relationSourceKind = "none";
    var relationSourceDurableIdentityPresent = false;
    var explicitRelationKinds = [];
    var referencedElements = [];
    for (var i = 0; i < lineage.length; i++) {
      var lineageNode = lineage[i];
      var relation = explicitRelationTargetsOf(lineageNode);
      if (relation.targets.length === 0) continue;
      for (var k = 0; k < relation.kinds.length; k++) {
        if (explicitRelationKinds.indexOf(relation.kinds[k]) < 0) explicitRelationKinds.push(relation.kinds[k]);
      }
      for (var t = 0; t < relation.targets.length; t++) {
        if (referencedElements.indexOf(relation.targets[t]) < 0) referencedElements.push(relation.targets[t]);
      }
      if (relationSourceKind === "none") {
        relationSourceKind = lineageNode === originalTarget ? "original_target" : (hasTechnicalRef(lineageNode) ? "durable_ancestor" : "anonymous_ancestor");
      }
      if (hasTechnicalRef(lineageNode)) relationSourceDurableIdentityPresent = true;
    }
    var sameScopeReferencedElements = referencedElements.filter(function (referenced) {
      return Boolean(scopeRootEl && scopeRootEl.contains && scopeRootEl.contains(referenced));
    });
    var referencedTechnicalControls = sameScopeReferencedElements.filter(hasTechnicalRef);
    var referencedActionableOrEditable = referencedTechnicalControls.some(function (referenced) {
      return isEditableNode(referenced) || isActionableNode(referenced);
    });
    var relatedControlCandidateViable = (relationSourceKind === "original_target" || relationSourceKind === "durable_ancestor")
      && sameScopeReferencedElements.length === 1
      && referencedTechnicalControls.length === 1
      && referencedActionableOrEditable === true;
    return {
      relationSourceKind: relationSourceKind,
      explicitRelationKinds: explicitRelationKinds,
      relationSourceDurableIdentityPresent: relationSourceDurableIdentityPresent,
      referencedElementCountClass: classCountOf(referencedElements.length),
      sameScopeReferencedElementCountClass: classCountOf(sameScopeReferencedElements.length),
      referencedTechnicalControlCountClass: classCountOf(referencedTechnicalControls.length),
      referencedTechnicalRefPresent: referencedTechnicalControls.length > 0,
      referencedActionableOrEditable: referencedActionableOrEditable,
      relatedControlCandidateViable: relatedControlCandidateViable,
    };
  }

  // LAST-RESORT, EXECUTION-ONLY fallback for a click whose owner/structural/related-control
  // authorities all fail: the captured, DYNAMIC accessible name/visible text of the ORIGINAL
  // clicked target, proven unique within one or more already-discovered stable technical scopes.
  // Never a hardcode -- the value is read from the live DOM at capture time, exactly once, and
  // is compared against the SAME live DOM at runtime. Never becomes a certified owner or a
  // technicalTarget; consumed only by SemanticRuntimeEvidence transport.
  // FIRST_LOSS fix (recordingId=175c4bd6-...): plain el.textContent concatenates the raw text of
  // ANY descendant, including <style>/<script> -- a click near a component that injects an inline
  // <style> tag into the same subtree (e.g. a toaster library) produced a "display text" that was
  // actually hundreds of characters of CSS. Never a hardcode: strips only non-visual tag kinds,
  // still reads the live DOM at capture time.
  function ownVisibleText(el) {
    if (!el.textContent) return "";
    if (!el.querySelectorAll) return el.textContent.trim();
    var nonVisual = el.querySelectorAll("style,script");
    if (nonVisual.length === 0) return el.textContent.trim();
    var clone = el.cloneNode(true);
    var toStrip = clone.querySelectorAll ? clone.querySelectorAll("style,script") : [];
    for (var i = 0; i < toStrip.length; i++) toStrip[i].remove();
    return (clone.textContent || "").trim();
  }

  function semanticDisplayValueOf(el) {
    var nativeRoleIdentity = classifyNativeRoleIdentity({
      tag: (el.tagName || "").toLowerCase(),
      explicitName: explicitAccessibleName(el),
      textContent: ownVisibleText(el),
      semanticFragments: semanticTextFragments(el),
      headingFragments: semanticHeadingFragments(el),
    });
    var strong = nativeRoleIdentity.displayName || "";
    if (strong) return { value: strong, source: "accessible_name" };
    var weak = computeWeakAccessibleName(el);
    if (weak) return { value: weak, source: "accessible_name" };
    var ownText = ownVisibleText(el);
    return { value: ownText, source: "visible_text" };
  }

  function normalizeSemanticValue(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  var SENSITIVE_INPUT_TYPES = ["password", "email", "tel", "number"];

  function computeSemanticRuntimeAlternative(originalTarget, scopeIdentityRef, scopeRootEl) {
    // Click-target presentation/name only -- never a value field. Editable/sensitive nodes never
    // reach this path via the unresolved-click branch anyway (Priority 1 always wins them), but
    // this stays a defensive, explicit reject per contract.
    if (isEditableNode(originalTarget)) return undefined;
    var tag = (originalTarget.tagName || "").toLowerCase();
    if (tag === "input") {
      var typeAttr = (originalTarget.getAttribute && originalTarget.getAttribute("type") || "").toLowerCase();
      if (SENSITIVE_INPUT_TYPES.indexOf(typeAttr) !== -1) return undefined;
    }
    var targetValue = semanticDisplayValueOf(originalTarget);
    var normalized = normalizeSemanticValue(targetValue.value);
    if (!normalized) return undefined;
    var scanned = scopeRootEl.querySelectorAll ? scopeRootEl.querySelectorAll("*") : [];
    var matches = [];
    for (var i = 0; i < scanned.length && matches.length < 3; i++) {
      var candidateEl = scanned[i];
      if ((candidateEl.tagName || "").toLowerCase() !== tag) continue;
      if (!isVisible(candidateEl)) continue;
      if (normalizeSemanticValue(semanticDisplayValueOf(candidateEl).value) !== normalized) continue;
      matches.push(candidateEl);
    }
    if (matches.length !== 1) return undefined;
    if (matches[0] !== originalTarget) return undefined;
    return { scopeIdentity: scopeIdentityRef, captureMatchCount: 1, source: targetValue.source, normalizedValue: normalized, targetTag: tag };
  }

  // GATE #3 fix: when the click's raw target IS the candidate itself (originalTarget === el,
  // never an ancestor case -- that is Gate #1 above) and el carries no strong role/name of its
  // own, a unique semantic descendant already inside el (found via the SAME structural-evidence
  // scan, never a new pipeline) may lend its role+name as el's OWN semantic identity. Never
  // rewrites el.role/el.accessibleName -- functionalOwner stays el, only semanticRuntimeAlternative
  // is attached. Fail-closed: exactly one visible descendant with a strong native role identity,
  // else undefined. Never positional (no nth/first/last/index).
  function computeOwnOnlySemanticRuntimeAlternative(el, scopeIdentityRef) {
    if (!el.querySelectorAll) return undefined;
    var descendants = el.querySelectorAll("*");
    var found;
    var foundCount = 0;
    for (var i = 0; i < descendants.length && foundCount < 2; i++) {
      var d = descendants[i];
      if (!isVisible(d)) continue;
      var nativeIdentity = classifyNativeRoleIdentity({
        tag: (d.tagName || "").toLowerCase(),
        explicitName: explicitAccessibleName(d),
        textContent: ownVisibleText(d),
        semanticFragments: semanticTextFragments(d),
        headingFragments: semanticHeadingFragments(d),
      });
      if (!nativeIdentity.roleTechnicalIdentityEligible || !nativeIdentity.displayName) continue;
      foundCount++;
      found = d;
    }
    // DIAGNOSE-ONLY (gate #3 rollout): shape only -- attribute NAMES present, never values;
    // never business text.
    try {
      send({
        type: "capture_trace",
        stage: "gate3_found_descendant_shape_diagnostic",
        trusted: true,
        diagnostic: {
          foundCount: foundCount,
          foundTag: found ? (found.tagName || "").toLowerCase() : "none",
          foundAttributeNames: found && found.attributes ? Array.prototype.map.call(found.attributes, function (a) { return a.name; }) : [],
        },
      });
    } catch (e) { /* never blocks capture */ }
    if (foundCount !== 1 || !found) {
      try { send({ type: "capture_trace", stage: "gate3_descendant_scan_diagnostic", trusted: true, diagnostic: { foundCount: foundCount, rejectedReason: foundCount === 0 ? "no_qualifying_descendant" : "ambiguous_descendants" } }); } catch (e) { /* never blocks capture */ }
      return undefined;
    }
    var displayValue = semanticDisplayValueOf(found);
    var normalized = normalizeSemanticValue(displayValue.value);
    if (!normalized) {
      try { send({ type: "capture_trace", stage: "gate3_descendant_scan_diagnostic", trusted: true, diagnostic: { foundCount: foundCount, rejectedReason: "empty_normalized_value" } }); } catch (e) { /* never blocks capture */ }
      return undefined;
    }
    var foundRole = nativeRole(found);
    return {
      scopeIdentity: scopeIdentityRef,
      captureMatchCount: 1,
      source: displayValue.source,
      normalizedValue: normalized,
      targetTag: (found.tagName || "").toLowerCase(),
      // The descendant's own role, never el's (el has none -- that is why this path ran at
      // all). A webStep target needs a truthy role to be emitted; el's own empty role must never
      // suppress the borrowed identity's role.
      role: foundRole || undefined,
      // The physical click landed on el itself (the scope element), never on the matched
      // descendant -- replay must click the scope element, not the descendant used only to
      // prove identity.
      clickScopeElement: true,
    };
  }

  // Shared by Gate #1 (ancestor scope for a distinct originalTarget) and Gate #3 (el's own
  // identity when el === originalTarget): id/data-testid first, else a non-positional css
  // :has() built from el's own already-computed stable descendant evidence, verified unique via
  // an innermost-match filter. Never a new identity kind, never a new pipeline.
  function buildOwnScopeIdentity(el, structuralIdentity) {
    if (el.id) return { strategy: "id", value: el.id };
    var ownTestId = el.getAttribute && el.getAttribute("data-testid");
    if (ownTestId) return { strategy: "data-testid", value: ownTestId };
    if (!structuralIdentity || (structuralIdentity.stableDescendants || []).length === 0) return undefined;
    var ownTag = (el.tagName || "").toLowerCase();
    for (var sdIdx = 0; sdIdx < structuralIdentity.stableDescendants.length; sdIdx++) {
      var descendantForScope = structuralIdentity.stableDescendants[sdIdx];
      var descAttrNames = Object.keys(descendantForScope.stableAttributes || {});
      for (var anIdx = 0; anIdx < descAttrNames.length; anIdx++) {
        var descAttrName = descAttrNames[anIdx];
        var descAttrValue = descendantForScope.stableAttributes[descAttrName];
        if (!descAttrValue) continue;
        var cssScopeCandidate = ownTag + ":has(" + descendantForScope.tag + "[" + descAttrName + "=\"" +
          String(descAttrValue).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"])";
        try {
          var scopeMatches = document.querySelectorAll(cssScopeCandidate);
          var innermostMatches = [];
          for (var smIdx = 0; smIdx < scopeMatches.length; smIdx++) {
            var isAncestorOfAnotherMatch = false;
            for (var smIdx2 = 0; smIdx2 < scopeMatches.length; smIdx2++) {
              if (smIdx === smIdx2) continue;
              if (scopeMatches[smIdx].contains(scopeMatches[smIdx2])) { isAncestorOfAnotherMatch = true; break; }
            }
            if (!isAncestorOfAnotherMatch) innermostMatches.push(scopeMatches[smIdx]);
          }
          if (innermostMatches.length === 1 && innermostMatches[0] === el) return { strategy: "css", value: cssScopeCandidate };
        } catch (e) { /* unsupported/invalid selector shape -- try the next stable attribute */ }
      }
    }
    return undefined;
  }

  // Bounded, structural-only candidate -- never a full textContent dump of a container.
  // originalTarget is the RAW clicked event target (composedPath[0]), threaded through so an
  // ANCESTOR candidate (el !== originalTarget) that itself carries a durable id/data-testid can
  // ALSO produce scope-bound evidence for the ORIGINAL target specifically -- see
  // scopeBoundOriginalTargetIdentity below.
  function toCandidate(el, depth, trustedInteraction, originalTarget) {
    var nativeRoleIdentity = classifyNativeRoleIdentity({
      tag: (el.tagName || "").toLowerCase(),
      explicitName: explicitAccessibleName(el),
      textContent: ownVisibleText(el),
      semanticFragments: semanticTextFragments(el),
      headingFragments: semanticHeadingFragments(el),
    });
    var strongName = nativeRoleIdentity.displayName || "";
    var explicitRole = (el.getAttribute && el.getAttribute("role") || "").toLowerCase();
    var nativeTag = (el.tagName || "").toLowerCase();
    // A generic caption on a button (for example an empty-cell prompt) is not a durable
    // accessible identity. Let the existing structural header/field logic scope it; the real
    // observed click remains in the trace, while runtime uniqueness is still checked later.
    if ((nativeTag === "button" || explicitRole === "button")
      && explicitRole !== "checkbox"
      && isGenericUnresolvedLabel(strongName)) strongName = "";
    var technicalRefs = [];
    if (el.id) technicalRefs.push("id:" + el.id);
    if (el.getAttribute && el.getAttribute("data-testid")) technicalRefs.push("testid:" + el.getAttribute("data-testid"));
    // associatedField is a structural FALLBACK relation, never computed at all for an owner that
    // already has a real, STRONG accessible name of its own -- a named button/combobox/option is
    // self-sufficient and must never carry a nearby, unrelated label's text as metadata (real
    // regression: "Iniciar sesión" carrying associatedField="Usuario", "Depurar" carrying
    // associatedField="SalirCancelar", both from a merely nearby field). Only an owner with NO
    // strong own name ever attempts, in order: a certified grid column relation, the
    // data-field-owner hint, or the generic structural ancestor walk -- a grid header always
    // outranks the generic walk since it is certified by column-index alignment, not proximity.
    var associatedField = strongName
      ? undefined
      : (gridHeaderContext(el) || (el.getAttribute && el.getAttribute("data-field-owner")) || computeAssociatedField(el) || undefined);
    // placeholder/title are real identity ONLY when nothing stronger applies at all -- a grid
    // editor's placeholder ("Indicar...", a phone-format mask) must never win over its own
    // certified column identity, which is already captured above as associatedField.
    var weakName = (!strongName && !associatedField) ? computeWeakAccessibleName(el) : "";
    // A structural/container node must never transport an unbounded descendant dump as its
    // human label. Keep short names (including a unique semantic heading) but demote aggregate
    // content to structural/runtime evidence so a click cannot become a whole-screen sentence.
    var accessibleName = strongName || weakName;
    if (accessibleName && accessibleName.length > 120) accessibleName = "";
    // DIAGNOSE-ONLY (gate #1/#3 boundary rollout): booleans/counts only, bounded to shallow
    // composedPath depths so a deep DOM never turns one click into a log flood.
    if (trustedInteraction === true && depth < 4) {
      try {
        send({
          type: "capture_trace",
          stage: "candidate_gate_boundary_diagnostic",
          trusted: true,
          diagnostic: {
            candidateOrdinalDiagnostic: depth,
            elEqualsOriginalTarget: Boolean(originalTarget) && el === originalTarget,
            accessibleNamePresent: Boolean(accessibleName),
            associatedFieldPresent: Boolean(associatedField),
          },
        });
      } catch (e) { /* diagnostic must never break capture */ }
    }
    var editable = isEditableNode(el);
    var actionable = isActionableNode(el);
    var style;
    try { style = window.getComputedStyle ? window.getComputedStyle(el) : undefined; } catch (e) { style = undefined; }
    var hasInlineClickHandler = typeof el.onclick === "function" || Boolean(el.getAttribute && el.getAttribute("onclick"));
    var isFocusable = typeof el.tabIndex === "number" && el.tabIndex >= 0;
    var frameworkActionabilityObserved = classifyActionability({
      tagName: (el.tagName || "").toLowerCase(),
      role: (el.getAttribute && el.getAttribute("role")) || undefined,
      onclick: hasInlineClickHandler,
      tabIndex: isFocusable ? el.tabIndex : undefined,
      cursor: style && style.cursor,
      pointerEvents: style && style.pointerEvents,
      trustedInteraction: trustedInteraction === true,
      stableTechnicalIdentity: technicalRefs.length > 0,
    }) === "FRAMEWORK_ACTIONABLE";
    // Capture V2 may report the shared contract's observation, but does not treat pointer
    // styling alone as candidate authority. A future owner admission must have trusted click
    // provenance plus direct, same-node handler/focus/technical identity evidence.
    var frameworkActionable = frameworkActionabilityObserved
      && trustedInteraction === true
      && (hasInlineClickHandler || isFocusable || technicalRefs.length > 0);
    // FIRST_LOSS fix: only an editable/actionable candidate can ever be picked as owner by
    // resolveCaptureOwner (Priority 1/2) -- the expensive cross-page match-count scan inside
    // buildCandidateStructuralIdentity is bounded to exactly those, never every ancestor in the
    // composed path, so a deep DOM never turns one click into many full-page scans.
    // Trusted pointer targets may be non-actionable custom containers. Compute structural
    // evidence for them only when a stable technical scope exists; the identity remains
    // runtime-resolution evidence and never certifies the raw pointer target.
    var scopeIdentity;
    var scopeElement;
    var scopeCandidatePresent = false;
    var scopeNode = el.parentElement;
    for (var scopeDepth = 0; scopeNode && scopeDepth < 12; scopeDepth++, scopeNode = scopeNode.parentElement) {
      scopeCandidatePresent = true;
      if (scopeNode.id) { scopeIdentity = { strategy: "id", value: scopeNode.id }; scopeElement = scopeNode; break; }
      var scopeTestId = scopeNode.getAttribute && scopeNode.getAttribute("data-testid");
      if (scopeTestId) { scopeIdentity = { strategy: "data-testid", value: scopeTestId }; scopeElement = scopeNode; break; }
    }
    // GATE #3 fix: a real click's raw target (originalTarget === el) with NO strong name of its
    // own is EXACTLY the shape gate #3 exists to rescue -- a plain, nameless React/Tailwind card
    // div with no onclick attribute/tabIndex/id/data-testid (a synthetic React click handler
    // never sets el.onclick or an "onclick" attribute, so frameworkActionable above is false
    // for this shape by construction). Without this, structuralIdentity (and its
    // stableDescendants) is never computed for exactly the owners gate #3 targets, so its own
    // buildOwnScopeIdentity css-fallback has nothing to work with and always fails closed.
    var isGate3Candidate = trustedInteraction === true && originalTarget && originalTarget === el && !accessibleName;
    var shouldCaptureStructuralEvidence = editable || actionable || frameworkActionable || isGate3Candidate || (trustedInteraction === true && Boolean(scopeIdentity));
    var segmentedEvidence = segmentedInputEvidence(el, scopeIdentity, scopeElement);
    var structuralIdentity;
    if (shouldCaptureStructuralEvidence) {
      structuralIdentity = scopeIdentity
        ? computeScopeBoundEvidence(el, scopeIdentity, scopeElement, actionable || frameworkActionable)
        : buildCandidateStructuralIdentity(el, actionable || frameworkActionable, scopeElement);
    }
    // The ORIGINAL clicked target evaluated against THIS candidate's OWN identity as scope root
    // -- never this candidate's own fingerprint, never a mix of two different boundaries. Only
    // meaningful for an ANCESTOR (el !== originalTarget) that itself carries a durable id/
    // data-testid; the original target's own case is already covered by structuralIdentity
    // above when el IS the original target.
    var scopeBoundOriginalTargetIdentity;
    var semanticRuntimeAlternative;
    if (trustedInteraction === true && originalTarget && originalTarget !== el) {
      // FIRST_LOSS fix: a framework-actionable owner with a real handler but no id/data-testid
      // (the common React/Tailwind div-with-onClick shape) previously never got ANY scope
      // identity here, so the semantic-runtime-alternative search below never even ran -- the
      // original target's own semantic role+name (e.g. a clickable card's img) was silently
      // dropped even when it was the sole semantic descendant. Reuses the EXISTING "css" scope
      // strategy (already fully supported end-to-end at replay, target-resolver.ts).
      var ownScopeIdentity = buildOwnScopeIdentity(el, structuralIdentity);
      if (ownScopeIdentity) {
        scopeBoundOriginalTargetIdentity = computeScopeBoundEvidence(originalTarget, ownScopeIdentity, el, false);
        try { semanticRuntimeAlternative = computeSemanticRuntimeAlternative(originalTarget, ownScopeIdentity, el); } catch (e) { /* transient DOM */ }
        // DIAGNOSE-ONLY (recordingId=bbb29e0a-...): never consumed by scopeBoundOriginalTargetIdentity,
        // owner resolution, or the runtime resolver -- observability only, same capture_trace channel.
        try {
          var relatedControlDiagnostic = diagnoseExplicitRelatedControl(originalTarget, el);
          send({
            type: "capture_trace",
            stage: "scope_bound_related_control_diagnostic",
            trusted: trustedInteraction === true,
            diagnostic: Object.assign({ candidateOrdinalDiagnostic: depth }, relatedControlDiagnostic),
          });
        } catch (e) { /* transient DOM -- never blocks capture */ }
      }
    } else if (trustedInteraction === true && originalTarget && originalTarget === el && !accessibleName) {
      // GATE #3: the click landed directly on el itself (not a descendant), and el has no
      // strong role/name of its own. If el contains EXACTLY ONE visible descendant with a
      // strong native role identity, that descendant's role+name becomes el's OWN semantic
      // identity (never el's role/accessibleName reassigned -- functionalOwner stays el).
      var selfScopeIdentity = buildOwnScopeIdentity(el, structuralIdentity);
      // DIAGNOSE-ONLY: run the descendant scan regardless of scope success, so the diagnostic
      // inside it fires even when selfScopeIdentity is undefined (never affects real behavior --
      // the result is only KEPT when selfScopeIdentity is truthy, exactly as before).
      try {
        var gate3ScanResult = computeOwnOnlySemanticRuntimeAlternative(el, selfScopeIdentity);
        if (selfScopeIdentity) semanticRuntimeAlternative = gate3ScanResult;
      } catch (e) { /* transient DOM */ }
      // DIAGNOSE-ONLY (gate #3 rollout): booleans/counts only, never text/attributes/DOM paths.
      try {
        send({
          type: "capture_trace",
          stage: "gate3_self_semantic_diagnostic",
          trusted: true,
          diagnostic: {
            candidateOrdinalDiagnostic: depth,
            selfScopeIdentityFound: Boolean(selfScopeIdentity),
            selfScopeIdentityStrategy: selfScopeIdentity ? selfScopeIdentity.strategy : "none",
            semanticAlternativeCreated: Boolean(semanticRuntimeAlternative),
            structuralIdentityPresent: Boolean(structuralIdentity),
            stableDescendantCount: structuralIdentity ? (structuralIdentity.stableDescendants || []).length : -1,
            elId: Boolean(el.id),
            elTestId: Boolean(el.getAttribute && el.getAttribute("data-testid")),
          },
        });
      } catch (e) { /* diagnostic must never break capture */ }
      // DIAGNOSE-ONLY: test the sibling-relation hypothesis -- if el's own descendants have no
      // qualifying identity, does a SIBLING (same parent, different child) have one? Shape/count
      // only, never text/attribute values.
      try {
        var parentForSiblingScan = el.parentElement;
        var siblingFoundCount = 0;
        var siblingFoundTag = "none";
        if (parentForSiblingScan && parentForSiblingScan.children) {
          for (var sibIdx = 0; sibIdx < parentForSiblingScan.children.length && siblingFoundCount < 2; sibIdx++) {
            var sib = parentForSiblingScan.children[sibIdx];
            if (sib === el || !isVisible(sib)) continue;
            var sibIdentity = classifyNativeRoleIdentity({
              tag: (sib.tagName || "").toLowerCase(),
              explicitName: explicitAccessibleName(sib),
              textContent: ownVisibleText(sib),
              semanticFragments: semanticTextFragments(sib),
              headingFragments: semanticHeadingFragments(sib),
            });
            if (!sibIdentity.roleTechnicalIdentityEligible || !sibIdentity.displayName) continue;
            siblingFoundCount++;
            siblingFoundTag = (sib.tagName || "").toLowerCase();
          }
        }
        send({
          type: "capture_trace",
          stage: "gate3_sibling_hypothesis_diagnostic",
          trusted: true,
          diagnostic: {
            parentPresent: Boolean(parentForSiblingScan),
            siblingChildCount: parentForSiblingScan ? parentForSiblingScan.children.length : -1,
            siblingFoundCount: siblingFoundCount,
            siblingFoundTag: siblingFoundTag,
          },
        });
      } catch (e) { /* diagnostic must never break capture */ }
    }
    // Diagnostic-only census for unresolved physical controls.  It deliberately carries
    // booleans/enums/counts only: no identity values, text, attributes, DOM paths, or secrets.
    try {
      var scopeStableAttributesPresent = Boolean(scopeIdentity && scopeIdentity.strategy);
      var scopeIdentitySufficient = Boolean(scopeIdentity && structuralIdentity
        && structuralIdentity.deterministicStructuralIdentity === true
        && structuralIdentity.identityAmbiguous !== true);
      var scopeRejectedReason = scopeIdentitySufficient
        ? "none"
        : !scopeCandidatePresent ? "no_candidate"
        : !scopeIdentity ? "no_technical_identity"
        : !structuralIdentity ? "insufficient_stable_evidence"
        : "ambiguous_scope_shape";
      send({ type: "capture_trace", stage: "structural_scope_diagnostic", trusted: trustedInteraction === true, diagnostic: {
        candidateOrdinalDiagnostic: depth,
        sameEventTarget: depth === 0,
        scopeCandidatePresent: scopeCandidatePresent,
        scopeTechnicalRefPresent: Boolean(scopeIdentity),
        scopeTechnicalRefKind: scopeIdentity ? scopeIdentity.strategy : "none",
        scopeStableAttributesPresent: scopeStableAttributesPresent,
        scopeStableDescendantsPresent: Boolean(structuralIdentity && (structuralIdentity.stableDescendants || []).length),
        scopeSemanticShapePresent: Boolean(structuralIdentity && (structuralIdentity.semanticShape || []).length),
        scopeTopologyPresent: Boolean(structuralIdentity && structuralIdentity.topologySignature),
        scopeLandmarkPresent: Boolean(structuralIdentity && structuralIdentity.landmarkAncestor),
        scopeIdentitySufficient: scopeIdentitySufficient,
        scopeRejectedReason: scopeRejectedReason,
      }});
      var targetMatchCount = structuralIdentity && typeof structuralIdentity.structuralIdentityMatchCount === "number"
        ? structuralIdentity.structuralIdentityMatchCount : undefined;
      var targetMatchClass = targetMatchCount === undefined ? "unknown" : targetMatchCount === 0 ? "zero" : targetMatchCount === 1 ? "one" : "many";
      var fingerprintRejectedReason = structuralIdentity && structuralIdentity.deterministicStructuralIdentity === true
        ? (structuralIdentity.targetFingerprint ? "none" : "unsupported_target_shape")
        : !structuralIdentity ? "no_structural_evidence" : "non_deterministic";
      send({ type: "capture_trace", stage: "structural_target_fingerprint_diagnostic", trusted: trustedInteraction === true, diagnostic: {
        candidateOrdinalDiagnostic: depth,
        sameEventTarget: depth === 0,
        targetTag: (el.tagName || "").toLowerCase(),
        stableDirectAttributeCount: structuralIdentity ? Object.keys(structuralIdentity.stableDirectAttributes || {}).length : 0,
        stableDescendantCount: structuralIdentity ? (structuralIdentity.stableDescendants || []).length : 0,
        semanticShapePresent: Boolean(structuralIdentity && (structuralIdentity.semanticShape || []).length),
        topologySignaturePresent: Boolean(structuralIdentity && structuralIdentity.topologySignature),
        frameworkStructuralEvidencePresent: Boolean(frameworkActionable || (structuralIdentity && structuralIdentity.deterministicStructuralIdentity)),
        technicalRefPresent: technicalRefs.length > 0,
        associatedFieldPresent: Boolean(associatedField),
        deterministicStructuralIdentity: Boolean(structuralIdentity && structuralIdentity.deterministicStructuralIdentity === true),
        captureStructuralMatchCountClass: targetMatchClass,
        fingerprintCandidateCreated: Boolean(structuralIdentity && structuralIdentity.targetFingerprint),
        fingerprintRejectedReason: fingerprintRejectedReason,
      }});
    } catch (e) { /* diagnostic must never break capture */ }
    var frameworkIdentitySufficient = frameworkActionable === true && (
      technicalRefs.length > 0
      || (structuralIdentity && structuralIdentity.deterministicStructuralIdentity === true && structuralIdentity.identityAmbiguous !== true)
    );
    var resolvedRole = (el.getAttribute && el.getAttribute("role")) || nativeRole(el) || undefined;
    // TEMPORARY DIAGNOSTIC (DOM-authority ticket only): read-only presence check, never added to
    // the candidate object below and never used as a locator -- exists solely to answer "does a
    // combobox owner carry a durable DOM relation (aria-controls/aria-owns/...) that Capture V2
    // currently never checks", for a human to read from real recording server logs. No attribute
    // VALUE is logged, only presence booleans and non-identifying structural tags/roles.
    if (resolvedRole === "combobox") {
      try {
        var getAttr = function (name) { return el.getAttribute ? Boolean(el.getAttribute(name)) : false; };
        console.log("[capture-v2-dom-authority]", JSON.stringify({
          tag: (el.tagName || "").toLowerCase(),
          role: resolvedRole,
          idPresent: Boolean(el.id),
          namePresent: getAttr("name"),
          ariaLabelPresent: getAttr("aria-label"),
          ariaLabelledByPresent: getAttr("aria-labelledby"),
          ariaControlsPresent: getAttr("aria-controls"),
          ariaOwnsPresent: getAttr("aria-owns"),
          ariaActiveDescendantPresent: getAttr("aria-activedescendant"),
          ariaDescribedByPresent: getAttr("aria-describedby"),
          dataTestIdPresent: getAttr("data-testid"),
          dataFieldPresent: getAttr("data-field"),
          dataColumnPresent: getAttr("data-column"),
          labelRelationPresent: Boolean(associatedField) || Boolean(accessibleName),
          parentTag: el.parentElement ? (el.parentElement.tagName || "").toLowerCase() : undefined,
          parentRole: (el.parentElement && el.parentElement.getAttribute) ? (el.parentElement.getAttribute("role") || undefined) : undefined,
        }));
      } catch (e) { /* diagnostic must never break capture */ }
    }
    // TEMPORARY DIAGNOSTIC (physical-owner-loss investigation only): per-candidate interaction
    // signals, never authority -- resolveCaptureOwner's acceptance priorities are completely
    // unchanged by this. Sent through the SAME existing capture_trace channel every other
    // "[capture-v2] trace stage=..." line already uses (never a new pipeline/console.log that
    // never reaches the Node-side, physically observable log). Exists solely to let a human
    // compare, from a real recording's server logs, exactly which durable signals a genuinely
    // custom-but-uncaptured control carries versus the "distant technical ref, not framework
    // actionable" layout-root shape that must stay rejected. No id/data-testid/accessibleName/
    // textContent/className/coordinate value is ever included -- only presence booleans, counts,
    // and generic tag/attribute-name strings. candidateOrdinalDiagnostic is diagnostic-only,
    // never authority -- resolveCaptureOwner never receives or reads this message at all.
    try {
      var NATIVE_ACTIONABLE_TAGS = ["button", "a", "input", "select", "textarea", "option", "summary", "label"];
      var ariaDisabledAttr = el.getAttribute && el.getAttribute("aria-disabled");
      var stableAttributeNames = [];
      if (el.id) stableAttributeNames.push("id");
      if (el.getAttribute && el.getAttribute("data-testid")) stableAttributeNames.push("data-testid");
      var tabIndexValueClass = "absent";
      if (typeof el.tabIndex === "number") {
        tabIndexValueClass = el.tabIndex < 0 ? "negative" : el.tabIndex === 0 ? "zero" : "positive";
      }
      send({
        type: "capture_trace",
        stage: "owner_candidate_diagnostic",
        trusted: trustedInteraction === true,
        diagnostic: {
          candidateOrdinalDiagnostic: depth,
          sameEventTarget: depth === 0,
          tag: (el.tagName || "").toLowerCase(),
          explicitRolePresent: Boolean(el.getAttribute && el.getAttribute("role")),
          nativeActionableTag: NATIVE_ACTIONABLE_TAGS.indexOf((el.tagName || "").toLowerCase()) !== -1,
          technicalRefPresent: technicalRefs.length > 0,
          technicalRefKind: el.id ? "id" : (el.getAttribute && el.getAttribute("data-testid")) ? "testid" : "none",
          stableAttributeNames: stableAttributeNames,
          tabIndexPresent: typeof el.tabIndex === "number",
          tabIndexValueClass: tabIndexValueClass,
          onclickAttributePresent: Boolean(el.getAttribute && el.getAttribute("onclick")),
          onclickPropertyPresent: typeof el.onclick === "function",
          cursorPointer: Boolean(style && style.cursor === "pointer"),
          pointerEventsEnabled: Boolean(!style || style.pointerEvents !== "none"),
          contentEditable: Boolean(el.isContentEditable),
          disabled: Boolean(el.disabled),
          ariaDisabled: ariaDisabledAttr === "true",
          keyboardFocusable: isFocusable,
          focusableByNativeSemantics: NATIVE_ACTIONABLE_TAGS.indexOf((el.tagName || "").toLowerCase()) !== -1 || isFocusable,
          frameworkActionable: frameworkActionable,
          frameworkIdentitySufficient: frameworkIdentitySufficient,
          associatedFieldPresent: Boolean(associatedField),
          structuralIdentityPresent: Boolean(structuralIdentity),
        },
      });
    } catch (e) { /* diagnostic must never break capture */ }

    return {
      tag: (el.tagName || "").toLowerCase(),
      role: resolvedRole,
      editable: editable,
      actionable: actionable,
      disabled: Boolean(el.disabled),
      visible: isVisible(el),
      technicalRefs: technicalRefs.length > 0 ? technicalRefs : undefined,
      accessibleName: accessibleName ? accessibleName.slice(0, 80) : undefined,
      technicalRoleName: nativeRoleIdentity.technicalRoleName ? nativeRoleIdentity.technicalRoleName.slice(0, 80) : undefined,
      roleTechnicalIdentityEligible: nativeRoleIdentity.roleTechnicalIdentityEligible,
      associatedField: associatedField,
      trustedClick: trustedInteraction === true,
      frameworkActionable: frameworkActionable,
      frameworkIdentitySufficient: frameworkIdentitySufficient,
      structuralIdentity: structuralIdentity,
      playwrightRecorderEvidence: segmentedEvidence,
      scopeBoundOriginalTargetIdentity: scopeBoundOriginalTargetIdentity,
      semanticRuntimeAlternative: semanticRuntimeAlternative,
      pathDepth: depth,
    };
  }

  // Bounded to a handful of ancestors -- an app's DOM depth never needs more to find a real owner.
  var MAX_COMPOSED_PATH_DEPTH = 12;

  function buildComposedPath(event) {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [];
    var candidates = [];
    var originalTarget = null;
    for (var i = 0; i < path.length && i < MAX_COMPOSED_PATH_DEPTH; i++) {
      var node = path[i];
      if (!node || node.nodeType !== 1) continue;
      if (!originalTarget) originalTarget = node;
      candidates.push(toCandidate(node, candidates.length, event.isTrusted === true, originalTarget));
    }
    // LAST-RESORT, EXECUTION-ONLY authority: aggregate each candidate's own
    // semanticRuntimeAlternative (each already independently proved the ORIGINAL target's exact
    // semantic value uniquely matches it within THAT candidate's own scope) into one
    // SemanticRuntimeEvidence on the original target's own candidate record. Never selects one
    // scope over another -- every valid alternative is kept; a scope whose unique match was a
    // DIFFERENT element was already dropped inside computeSemanticRuntimeAlternative itself.
    try {
      var semanticScopeAlternatives = [];
      var semanticSharedSource;
      var semanticSharedNormalizedValue;
      var semanticSharedTargetTag;
      var semanticSharedClickScopeElement;
      var semanticSharedBorrowedRole;
      for (var sIdx = 0; sIdx < candidates.length; sIdx++) {
        var alternative = candidates[sIdx].semanticRuntimeAlternative;
        delete candidates[sIdx].semanticRuntimeAlternative;
        if (!alternative) continue;
        semanticScopeAlternatives.push({ scopeIdentity: alternative.scopeIdentity, captureMatchCount: 1 });
        semanticSharedSource = alternative.source;
        semanticSharedNormalizedValue = alternative.normalizedValue;
        semanticSharedTargetTag = alternative.targetTag;
        if (alternative.clickScopeElement === true) semanticSharedClickScopeElement = true;
        if (alternative.role) semanticSharedBorrowedRole = alternative.role;
      }
      var semanticHash = 0;
      if (semanticSharedNormalizedValue) {
        for (var hIdx = 0; hIdx < semanticSharedNormalizedValue.length; hIdx++) {
          semanticHash = (semanticHash * 31 + semanticSharedNormalizedValue.charCodeAt(hIdx)) % 1000003;
        }
      }
      // DIAGNOSE-ONLY (recordingId=dbbf2ab8-...): disambiguates "the original target's own
      // semantic value was never computable at all" from "a value existed but no scope produced a
      // unique, matching-target result" -- both previously looked identical from the outside
      // (semanticRuntimeEvidencePresent=false, semanticScopeAlternativeCount=0).
      var semanticValueComputedForOriginalTarget = originalTarget
        ? Boolean(normalizeSemanticValue(semanticDisplayValueOf(originalTarget).value))
        : false;
      if (candidates.length > 0 && semanticScopeAlternatives.length > 0) {
        candidates[0].semanticRuntimeEvidence = {
          source: semanticSharedSource,
          normalizedValue: semanticSharedNormalizedValue,
          role: candidates[0].role || semanticSharedBorrowedRole,
          targetTag: semanticSharedTargetTag,
          scopeAlternatives: semanticScopeAlternatives,
          captureUniqueTarget: true,
          ...(semanticSharedClickScopeElement === true ? { clickScopeElement: true } : {}),
        };
        var semanticEffectiveRole = candidates[0].role || semanticSharedBorrowedRole;
        candidates[0].playwrightRecorderEvidence = {
          kind: semanticSharedSource === "accessible_name" && semanticEffectiveRole ? "role" : "text",
      ...(semanticEffectiveRole ? { role: semanticEffectiveRole } : {}),
          normalizedName: semanticSharedNormalizedValue,
          targetTag: semanticSharedTargetTag,
          scopeIdentity: semanticScopeAlternatives[0].scopeIdentity,
          captureMatchCount: 1,
          runtimeResolutionRequired: true,
        };
      }
      // Recorder intent is a capture candidate, not a capture-time certificate. When the
      // unresolved original target has a stable semantic value but no unique scope alternative,
      // preserve that observed intent for the existing runtime resolver anyway. The live resolver
      // will re-check exact uniqueness (including the global/body scope when no durable scope was
      // observed) and fail closed for zero or multiple matches. This branch deliberately does
      // not create semanticRuntimeEvidence, a technical target, or an owner certification.
      if (candidates.length > 0 && !candidates[0].playwrightRecorderEvidence && originalTarget) {
        var recorderSemanticValue = semanticDisplayValueOf(originalTarget);
        var recorderNormalizedValue = normalizeSemanticValue(recorderSemanticValue.value);
        if (recorderNormalizedValue && !isEditableNode(originalTarget)) {
          var recorderStructuralScope = candidates[0].structuralIdentity && candidates[0].structuralIdentity.scopeIdentity;
          candidates[0].playwrightRecorderEvidence = {
            kind: recorderSemanticValue.source === "accessible_name" && candidates[0].role ? "role" : "text",
            ...(candidates[0].role ? { role: candidates[0].role } : {}),
            normalizedName: recorderNormalizedValue,
            targetTag: (originalTarget.tagName || "").toLowerCase(),
            ...(recorderStructuralScope ? { scopeIdentity: recorderStructuralScope } : {}),
            runtimeResolutionRequired: true,
          };
        }
      }
      send({
        type: "capture_trace",
        stage: "semantic_runtime_evidence_diagnostic",
        trusted: event.isTrusted === true,
        diagnostic: {
          semanticRuntimeEvidencePresent: semanticScopeAlternatives.length > 0,
          semanticCaptureMatchCountClass: semanticScopeAlternatives.length === 0 ? "zero" : semanticScopeAlternatives.length === 1 ? "one" : "many",
          semanticScopeAlternativeCount: semanticScopeAlternatives.length,
          semanticValueHash: semanticHash,
          semanticValueComputedForOriginalTarget: semanticValueComputedForOriginalTarget,
        },
      });
    } catch (e) { /* transient DOM -- never blocks capture */ }
    // TEMPORARY DIAGNOSTIC (physical-owner-loss investigation only): "nearest" is reported for a
    // human to read from logs, never consulted by resolveCaptureOwner or any acceptance rule --
    // depth/position stays purely diagnostic, exactly as the per-candidate log above.
    try {
      var nearestTechnicalDepth = -1;
      var nearestInteractiveDepth = -1;
      for (var j = 0; j < candidates.length; j++) {
        var candidate = candidates[j];
        if (nearestTechnicalDepth === -1 && candidate.technicalRefs && candidate.technicalRefs.length > 0) nearestTechnicalDepth = candidate.pathDepth;
        var hasInteractiveSignal = candidate.editable || candidate.actionable || candidate.frameworkActionable;
        if (nearestInteractiveDepth === -1 && hasInteractiveSignal) nearestInteractiveDepth = candidate.pathDepth;
      }
      for (var k = 0; k < candidates.length; k++) {
        send({
          type: "capture_trace",
          stage: "owner_candidate_nearest_diagnostic",
          diagnostic: {
            candidateOrdinalDiagnostic: candidates[k].pathDepth,
            nearestTechnicalCandidate: candidates[k].pathDepth === nearestTechnicalDepth,
            nearestInteractiveSignalCandidate: candidates[k].pathDepth === nearestInteractiveDepth,
          },
        });
      }
    } catch (e) { /* diagnostic must never break capture */ }
    return candidates;
  }

  function readValueState(el) {
    var value = typeof el.value === "string" ? el.value : (el.isContentEditable ? el.textContent || "" : "");
    return { present: value.length > 0, literal: value };
  }

  // Segmented verification/PIN-like controls are sensitive even when their HTML input type is
  // plain text.  Detect them only from the same stable-scope, homogeneous-group evidence used by
  // segmentedInputEvidence; this is redaction metadata, never a locator or readiness authority.
  function isSegmentedValueNode(el) {
    if (!el || !isEditableNode(el)) return false;
    var tag = (el.tagName || "").toLowerCase();
    var type = tag === "input" ? ((el.getAttribute("type") || "text").toLowerCase()) : tag;
    var scopeNode = el.parentElement;
    for (var depth = 0; scopeNode && depth < 12; depth++, scopeNode = scopeNode.parentElement) {
      var hasStableScope = Boolean(scopeNode.id) || Boolean(scopeNode.getAttribute && scopeNode.getAttribute("data-testid"));
      if (!hasStableScope) continue;
      var controls = Array.prototype.slice.call(scopeNode.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]'))
        .filter(function (candidate) { return isEditableNode(candidate) && isVisible(candidate) && !(candidate.disabled === true); });
      if (controls.length < 2) continue;
      var homogeneous = controls.every(function (candidate) {
        var candidateTag = (candidate.tagName || "").toLowerCase();
        var candidateType = candidateTag === "input" ? ((candidate.getAttribute("type") || "text").toLowerCase()) : candidateTag;
        var maxLength = Number(candidate.getAttribute && candidate.getAttribute("maxlength"));
        return candidateTag === tag && candidateType === type && maxLength === 1;
      });
      if (homogeneous) return true;
    }
    return false;
  }

  function isSensitiveNode(el) {
    return (el.getAttribute && (el.getAttribute("type") || "").toLowerCase() === "password") || isSegmentedValueNode(el);
  }

  // Reconstruct the logical text from trusted beforeinput edits. Reading only the DOM after
  // input loses keystrokes when a mask/currency component has already reformatted the value.
  // Selection offsets and inputType keep insertions/deletions generic; no punctuation is stripped.
  function predictedRawInputValue(el, event) {
    if (!el || typeof el.selectionStart !== "number" || typeof el.selectionEnd !== "number") return undefined;
    var value = currentSessionRawValue;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    var type = event.inputType || "";
    if (type === "deleteContentBackward" && start === end && start > 0) start -= 1;
    else if (type === "deleteContentForward" && start === end && end < value.length) end += 1;
    if (type.indexOf("delete") === 0) return value.slice(0, start) + value.slice(end);
    if (type.indexOf("insert") === 0 && event.data != null) {
      var inserted = String(event.data);
      return value.slice(0, start) + inserted + value.slice(end);
    }
    return undefined;
  }

  document.addEventListener("focusin", function (event) {
    var el = event.target;
    if (!el || !isEditableNode(el)) return;
    sessionCounter += 1;
    currentSessionId = "v2-session-" + sessionCounter;
    currentSessionEl = el;
    currentSessionTrusted = false;
    currentSessionRawValue = String(readValueState(el).literal || "");
    pendingRawInput = null;
    var sensitive = isSensitiveNode(el);
    send({
      type: "focus",
      sessionId: currentSessionId,
      composedPath: buildComposedPath(event),
      identity: { tagName: (el.tagName || "").toLowerCase(), inputType: el.getAttribute ? el.getAttribute("type") || undefined : undefined, domId: el.id || undefined },
      initialValue: sensitive ? { present: readValueState(el).present } : readValueState(el),
      sensitive: sensitive,
    });
  }, true);

  function onEditEvidence(kind) {
    return function (event) {
      if (!currentSessionId) return;
      var el = event.target;
      if (!el || !isEditableNode(el)) return;
      var sensitive = isSensitiveNode(el);
      var valueState = sensitive ? { present: readValueState(el).present, changed: true } : readValueState(el);
      if (!sensitive && event.isTrusted === true && kind === "beforeinput") {
        pendingRawInput = predictedRawInputValue(el, event);
      } else if (!sensitive && event.isTrusted === true && kind === "input") {
        if (pendingRawInput !== null && pendingRawInput !== undefined) currentSessionRawValue = pendingRawInput;
        pendingRawInput = null;
      }
      if (!sensitive && kind !== "beforeinput") valueState.rawTypedValue = currentSessionRawValue;
      send({ type: "edit_evidence", sessionId: currentSessionId, kind: kind, valueState: valueState });
    };
  }

  // The value state a trusted-interaction commit compares against the session's initial snapshot.
  // Sensitive owners never expose their literal -- only presence + an explicit changed flag.
  function commitValueState(el) {
    if (!el) return undefined;
    var sensitive = isSensitiveNode(el);
    return sensitive
      ? { present: readValueState(el).present, changed: true }
      : { ...readValueState(el), rawTypedValue: currentSessionRawValue };
  }

  // A TRUSTED keyboard/pointer interaction on the session's own editable proves user causality
  // even when the framework mutates .value without a native input/change event (custom
  // role=spinbutton widgets). It records evidence only -- the value-delta decision happens at
  // commit, so focus/click with no change still produces nothing.
  function recordTrustedEditableInteraction(el, kind) {
    if (!currentSessionId || !currentSessionEl) return;
    if (el !== currentSessionEl) return;
    currentSessionTrusted = true;
    send({ type: "edit_evidence", sessionId: currentSessionId, kind: kind, valueState: commitValueState(el) });
  }

  document.addEventListener("beforeinput", onEditEvidence("beforeinput"), true);
  document.addEventListener("input", onEditEvidence("input"), true);
  document.addEventListener("change", onEditEvidence("change"), true);
  document.addEventListener("paste", onEditEvidence("paste"), true);

  document.addEventListener("focusout", function () {
    if (!currentSessionId) return;
    // Only a session with real trusted user causality may commit on a value delta: capture the
    // final value now, so a framework-applied value that landed after the last keystroke is
    // compared correctly. A session with no trusted interaction never gets this evidence and
    // still commits as no_user_edit_evidence.
    if (currentSessionTrusted && currentSessionEl) {
      send({ type: "edit_evidence", sessionId: currentSessionId, kind: "explicit_value_transition", valueState: commitValueState(currentSessionEl) });
    }
    send({ type: "blur", sessionId: currentSessionId });
    currentSessionId = null;
    currentSessionEl = null;
    currentSessionTrusted = false;
    currentSessionRawValue = "";
    pendingRawInput = null;
  }, true);

  document.addEventListener("submit", function () {
    if (!currentSessionId) return;
    send({ type: "submit", sessionId: currentSessionId });
    currentSessionId = null;
  }, true);

  // Discrete, non-textual command keys only -- ordinary typing stays entirely
  // EditingSessionManager's job (one edit per session, never one action per character). Enter is
  // the physically-observed fixture (a form's Enter-triggered submit); Escape is the other
  // generic, non-app-specific discrete command with real replay meaning.
  var KEY_ACTION_KEYS = { Enter: true, Escape: true };

  document.addEventListener("keydown", function (event) {
    var el = event.target;
    if (el && el.nodeType === 1 && event.isTrusted === true && isEditableNode(el)) {
      recordTrustedEditableInteraction(el, "keyboard_edit_intent");
    }
    if (!KEY_ACTION_KEYS[event.key]) return;
    if (!el || el.nodeType !== 1) return;
    send({ type: "keypress", key: event.key, composedPath: buildComposedPath(event) });
  }, true);

  document.addEventListener("click", function (event) {
    // MouseEvent.detail === 0 is the browser's own, spec-defined signal that this click had no
    // genuine pointer provenance (keyboard-activated or a programmatic .click() call) -- never a
    // timing heuristic. Node correlates this with a just-recorded keypress to decide whether the
    // click is that key's own synthetic side effect.
    send({ type: "capture_trace", stage: "click_handler_entered", trusted: event.isTrusted === true });
    if (event.isTrusted === true && isEditableNode(event.target)) {
      recordTrustedEditableInteraction(event.target, "trusted_editable_interaction");
    }
    var interactionId = pendingPointerInteractionId;
    pendingPointerInteractionId = null;
    send({ type: "click", composedPath: buildComposedPath(event), interactionId: interactionId || undefined, syntheticProvenance: event.detail === 0 });
  }, true);

  // Read-only lifecycle trace: pointer reception distinguishes a document that never receives
  // the user's interaction from one where the application suppresses the subsequent click.
  // It never creates a CaptureAction and carries no target, text, or value.
  document.addEventListener("pointerdown", function (event) {
    var interactionId = event.isTrusted === true ? "pointer-" + (++pointerInteractionCounter) : undefined;
    pendingPointerInteractionId = interactionId;
    send({ type: "capture_trace", stage: "pointer_observed", trusted: event.isTrusted === true, diagnostic: { interactionIdCreated: Boolean(interactionId), interactionIdPresent: Boolean(interactionId) } });
    send({ type: "pointer", composedPath: buildComposedPath(event), interactionId: interactionId, trusted: event.isTrusted === true });
  }, true);

  send({ type: "capture_trace", stage: "instrumentation_revision", diagnostic: {
    instrumentationRevision: "capture-v2-structural-provenance-v1",
    recorderEvidenceRevision: "runtime-recorder-candidate-v2",
  }});
  send({ type: "capture_trace", stage: "listener_installed" });
  send({ type: "document_ready" });
})();
`;
}
