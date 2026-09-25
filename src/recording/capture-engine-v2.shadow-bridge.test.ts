import assert from "node:assert/strict";
import test from "node:test";
import { CaptureEngineV2ShadowBridge, type ShadowBrowserMessage } from "./capture-engine-v2.shadow-bridge";
import type { CaptureOwnerCandidate } from "./capture-engine-v2.types";
import type { PlaywrightRecorderEvidence } from "./structural-owner-identity";

/**
 * `CaptureEngineV2ShadowBridge` is the Node-side SHADOW receiver: it wires the already-tested
 * `DocumentLifecycle`/`resolveCaptureOwner`/`EditingSessionManager`/`SelectionSessionManager`
 * together from normalized browser messages, purely for diagnostic/comparison purposes. It never
 * touches `adaptCaptureActionToRawInteraction`, `onInteraction`, `pushEvent`, or `SessionTrace`
 * -- these tests exercise the bridge entirely on its own, with synthetic messages, no browser
 * involved.
 *
 * `technicalActions` is the Playwright-like, replayable stream: every physical click/edit/submit,
 * preserved one-to-one. `functionalActions` is a SEPARATE, derived store (currently: selections)
 * that summarizes some technical actions for presentation, but never removes or replaces them.
 */

const doc = { captureInstanceId: "instance-1", documentId: "doc-A" };

function candidate(overrides: Partial<CaptureOwnerCandidate> & Pick<CaptureOwnerCandidate, "tag" | "pathDepth">): CaptureOwnerCandidate {
  return { editable: false, actionable: false, ...overrides };
}

test("1. document_ready makes the document active/ready: a click on it afterwards is accepted, not diagnosed as not-ready", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", actionable: true, pathDepth: 0 })],
  });

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.shadowDiagnostics.length, 0);
});

test("2. an event before document_ready produces no CaptureAction, only a diagnostic", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", actionable: true, pathDepth: 0 })],
  });

  assert.equal(bridge.technicalActions.length, 0);
  assert.equal(bridge.shadowDiagnostics.length, 1);
  assert.equal(bridge.shadowDiagnostics[0].reason, "event_document_not_ready");
});

test("3. editable focus + edit evidence + blur -> exactly one shadow edit action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "session-user",
    composedPath: [candidate({ tag: "input", editable: true, pathDepth: 0 })],
    identity: { label: "Usuario", tagName: "input", domId: "user" },
    initialValue: { present: false },
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "session-user", kind: "input", valueState: { present: true, literal: "qauser" } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "session-user" });

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.actionType, "edit");
  assert.equal(bridge.technicalActions[0].action.value?.literal, "qauser");
});

test("4. multiple input/change edit_evidence messages on the same session still coalesce into one action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "session-user",
    composedPath: [candidate({ tag: "input", editable: true, pathDepth: 0 })],
    identity: { label: "Usuario" },
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "session-user", kind: "beforeinput" });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "session-user", kind: "input", valueState: { present: true, literal: "qa" } });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "session-user", kind: "change", valueState: { present: true, literal: "qauser" } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "session-user" });

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.value?.literal, "qauser");
});

test("5. sensitive edit produces a shadow action, and no secret literal ever reaches it or the logs", () => {
  const fixtureSecret = "fixture-only-never-logged";
  const logLines: string[] = [];
  const bridge = new CaptureEngineV2ShadowBridge((line) => logLines.push(line));
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "session-pw",
    composedPath: [candidate({ tag: "input", editable: true, pathDepth: 0 })],
    identity: { label: "Contraseña", inputType: "password" },
    sensitive: true,
    initialValue: { present: false },
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "session-pw", kind: "input", valueState: { present: true, changed: true } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "session-pw" });

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.sensitive, true);
  assert.equal(bridge.technicalActions[0].action.value?.literal, undefined, "no secret literal is required or fabricated");
  assert.ok(!logLines.some((line) => line.includes(fixtureSecret)), "the fixture secret must never appear in any log line");
});

test("6. svg/path inside a button click -> owner resolves to the button, one click action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [
      candidate({ tag: "path", pathDepth: 0 }),
      candidate({ tag: "svg", pathDepth: 1 }),
      candidate({ tag: "button", actionable: true, pathDepth: 2 }),
    ],
  });

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.actionType, "click");
  assert.equal(bridge.technicalActions[0].action.owner?.tag, "button");
});

test("6a. a unique certified framework owner reaches the ordinary technical click pipeline", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [
      candidate({ tag: "img", pathDepth: 0 }),
      candidate({ tag: "div", pathDepth: 1, trustedClick: true, frameworkActionable: true, frameworkIdentitySufficient: true, visible: true }),
    ],
  });

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.actionType, "click");
  assert.equal(bridge.technicalActions[0].action.owner?.tag, "div");
  assert.equal(bridge.shadowDiagnostics.length, 0);
});

/**
 * FIRST_LOSS (confirmed and fixed): a fresh physical recording's persisted `interaction-12`
 * ("Solicitud multiproducto") carried `technicalTargetRefs: ["role:link|Solicitud multiproducto"]`
 * -- a bare role+name ref string -- and NO `technicalTargetCandidates`/`structuralContext`/
 * `landmarkAncestor` at all. `onClick` never attached `technicalEvidence` to a click's
 * `CaptureAction` at all -- it was only ever populated by the EDIT/EditingSessionManager path.
 * Landmark scoping (an earlier ticket) is architecturally correct but lives entirely downstream
 * of `technicalTargetCandidates`, which this test previously proved `onClick` never populated.
 *
 * Fixed: `onClick` now builds `technicalEvidence` from the resolved owner via the new, pure
 * `buildOwnerTechnicalEvidence` (capture-engine-v2.action-owner-resolver.ts), reusing the owner's
 * `technicalRefs`/`structuralIdentity` -- both already resolved before this point, never
 * re-derived from a display label or runtime clustering.
 */
test("14/producerFixed. a click with no owner technical evidence at all still produces no technicalEvidence -- never fabricated", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "a", role: "link", actionable: true, pathDepth: 0 })],
    identity: { label: "Solicitud multiproducto", tagName: "a", role: "link" },
  });

  assert.equal(bridge.technicalActions.length, 1);
  const action = bridge.technicalActions[0].action;
  assert.equal(action.actionType, "click");
  assert.equal(action.technicalEvidence, undefined, "no ref/structural evidence was ever provided on this owner -- nothing is fabricated");
});

test("1/namedLinkClick (bridge level). a click whose owner carries a technical ref AND structuralIdentity now reaches technicalEvidence.candidates", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [
      candidate({
        tag: "a",
        role: "link",
        actionable: true,
        pathDepth: 0,
        technicalRefs: ["id:solicitud-link"],
        structuralIdentity: {
          owner: { tag: "a", role: "link" },
          stableDirectAttributes: { href: "/requests/create/multiproduct" },
          stableDescendants: [],
          semanticShape: [],
          landmarkAncestor: { tag: "main" },
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
        },
      }),
    ],
    identity: { label: "Solicitud multiproducto", tagName: "a", role: "link" },
  });

  assert.equal(bridge.technicalActions.length, 1);
  const evidence = bridge.technicalActions[0].action.technicalEvidence;
  assert.ok(evidence, "the resolved owner's technical/structural evidence must reach CaptureAction.technicalEvidence");
  assert.equal(evidence!.candidates![0].locatorCandidates[0].value, "#solicitud-link");
  assert.equal(evidence!.candidates![0].structuralContext?.landmarkAncestor?.tag, "main");
});

test("7. a click that resolves to an editable owner (editable nested inside an actionable container) never becomes a click action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [
      candidate({ tag: "input", editable: true, pathDepth: 0 }),
      candidate({ tag: "div", actionable: true, pathDepth: 1 }),
    ],
  });

  assert.equal(bridge.technicalActions.length, 0, "no container click must be fabricated for an editable target");
  assert.equal(bridge.shadowDiagnostics.some((d) => d.reason === "click_target_is_editable_owner"), true);
});

test("8. an edit committed before a click keeps V2's own ordering: edit seq < click seq", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "session-user",
    composedPath: [candidate({ tag: "input", editable: true, pathDepth: 0 })],
    identity: { label: "Usuario" },
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "session-user", kind: "input", valueState: { present: true, literal: "qauser" } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "session-user" });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", actionable: true, pathDepth: 0 })],
  });

  assert.equal(bridge.technicalActions.length, 2);
  assert.equal(bridge.technicalActions[0].action.actionType, "edit");
  assert.equal(bridge.technicalActions[1].action.actionType, "click");
  assert.ok(bridge.technicalActions[0].seq < bridge.technicalActions[1].seq);
});

test("9. full navigation: doc A retires, doc B becomes ready, events stay separated between documents", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const docB = { captureInstanceId: "instance-1", documentId: "doc-B" };
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({ type: "document_ready", ...docB });

  bridge.handleMessage({ type: "click", ...docB, composedPath: [candidate({ tag: "button", actionable: true, pathDepth: 0 })] });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "button", actionable: true, pathDepth: 0 })] });

  assert.equal(bridge.technicalActions.length, 1, "only doc-B's click is accepted");
  assert.equal(bridge.technicalActions[0].action.documentContext?.documentId, "doc-B");
  assert.equal(bridge.shadowDiagnostics.some((d) => d.reason === "event_document_not_ready"), true);
});

test("10. an event from an already-retired document is ignored, not converted into an action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const docB = { captureInstanceId: "instance-1", documentId: "doc-B" };
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({ type: "document_ready", ...docB }); // implicitly retires doc-A

  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "button", actionable: true, pathDepth: 0 })] });
  assert.equal(bridge.technicalActions.length, 0);
});

test("10a. main and iframe documents are concurrently ready, while an iframe replacement leaves the main document accepted", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const main = { captureInstanceId: "instance-1", documentId: "main-A", frameId: "main" };
  const iframeB = { captureInstanceId: "instance-1", documentId: "iframe-B", frameId: "iframe" };
  const iframeD = { captureInstanceId: "instance-1", documentId: "iframe-D", frameId: "iframe" };
  const button = [candidate({ tag: "button", actionable: true, pathDepth: 0 })];

  bridge.handleMessage({ type: "document_ready", ...main });
  bridge.handleMessage({ type: "document_ready", ...iframeB });
  bridge.handleMessage({ type: "click", ...main, composedPath: button });
  bridge.handleMessage({ type: "click", ...iframeB, composedPath: button });
  bridge.handleMessage({ type: "document_ready", ...iframeD });
  bridge.handleMessage({ type: "click", ...iframeB, composedPath: button });
  bridge.handleMessage({ type: "click", ...main, composedPath: button });

  assert.equal(bridge.technicalActions.length, 3, "both initial frames and the still-live main document are accepted");
  assert.equal(bridge.shadowDiagnostics.filter((diagnostic) => diagnostic.reason === "event_document_not_ready").length, 1, "only the replaced iframe document is stale");
});

test("10b. an edit session is scoped to its document, while a shadow-root control shares its host document", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const main = { captureInstanceId: "instance-1", documentId: "main-A", frameId: "main" };
  const iframe = { captureInstanceId: "instance-1", documentId: "iframe-B", frameId: "iframe" };
  const editable = [candidate({ tag: "input", editable: true, pathDepth: 0 })];

  bridge.handleMessage({ type: "document_ready", ...main });
  bridge.handleMessage({ type: "document_ready", ...iframe });
  bridge.handleMessage({ type: "focus", ...main, sessionId: "main-edit", composedPath: editable });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "main-edit", kind: "input", valueState: { present: true, literal: "changed" } });
  bridge.handleMessage({ type: "blur", ...iframe, sessionId: "main-edit" });

  assert.equal(bridge.technicalActions.length, 0, "a cross-document blur cannot commit the main edit session");
  assert.equal(bridge.shadowDiagnostics.some((diagnostic) => diagnostic.reason === "commit_document_changed"), true);

  bridge.handleMessage({ type: "focus", ...main, sessionId: "shadow-host-edit", composedPath: editable });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "shadow-host-edit", kind: "input", valueState: { present: true, literal: "changed" } });
  bridge.handleMessage({ type: "blur", ...main, sessionId: "shadow-host-edit" });
  assert.equal(bridge.technicalActions.length, 1, "a shadow-root control keeps the host document identity");
});

test("11. a trusted unresolved click is preserved as an explicitly unresolved action, never a fabricated owner", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-unresolved-1",
    composedPath: [candidate({ tag: "div", actionable: true, pathDepth: 0 })], // container-only, no genuine role
  });

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.owner, undefined);
  assert.equal(bridge.technicalActions[0].action.interactionId, "pointer-unresolved-1");
  assert.equal(bridge.shadowDiagnostics.some((d) => d.reason === "click_owner_unresolved"), true);
});

test("11c. a trusted unresolved click transports scoped local structural evidence without certifying an owner", () => {
  const logs: string[] = [];
  const bridge = new CaptureEngineV2ShadowBridge((line) => logs.push(line));
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-scoped-1",
    composedPath: [candidate({
      tag: "div",
      actionable: true,
      pathDepth: 0,
      structuralIdentity: {
        owner: { tag: "div" },
        stableDirectAttributes: { "data-field": "custom-control" },
        stableDescendants: [],
        semanticShape: [],
        deterministicStructuralIdentity: true,
        structuralIdentityMatchCount: 1,
        scopeIdentity: { strategy: "id", value: "stable-scope" },
        targetFingerprint: "opaque-fingerprint",
        captureScopeUnique: true,
        captureTargetMatchCount: 1,
      },
    })],
  });

  const action = bridge.technicalActions[0]?.action;
  assert.ok(action);
  assert.equal(action.owner, undefined);
  assert.equal(action.technicalEvidence?.candidates?.[0]?.locatorCandidates.length, 0);
  assert.equal(action.technicalEvidence?.candidates?.[0]?.structuralContext?.scopeIdentity?.value, "stable-scope");
  assert.equal(action.technicalEvidence?.candidates?.[0]?.structuralContext?.targetFingerprint, "opaque-fingerprint");
  const attachment = logs.find((line) => line.includes("structural_runtime_evidence_attachment"));
  assert.ok(attachment);
  assert.match(attachment, /"scopeAvailable":true/);
  assert.match(attachment, /"fingerprintAvailable":true/);
});

test("11c1. unresolved click pairs an ancestor scope with the original target fingerprint", () => {
  const logs: string[] = [];
  const bridge = new CaptureEngineV2ShadowBridge((line) => logs.push(line));
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-scoped-ancestor-1",
    composedPath: [
      candidate({
        tag: "div",
        actionable: true,
        pathDepth: 0,
        structuralIdentity: {
          owner: { tag: "div" },
          stableDirectAttributes: { "data-field": "custom-control" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          targetFingerprint: "opaque-local-target-fingerprint",
          captureTargetMatchCount: 1,
        },
      }),
      candidate({
        tag: "form",
        actionable: false,
        pathDepth: 1,
        structuralIdentity: {
          owner: { tag: "form" },
          stableDirectAttributes: { id: "stable-scope" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          scopeIdentity: { strategy: "id", value: "stable-scope" },
          targetFingerprint: "ancestor-fingerprint",
          captureScopeUnique: true,
          captureTargetMatchCount: 1,
        },
      }),
    ],
  });

  const action = bridge.technicalActions[0]?.action;
  assert.ok(action);
  assert.equal(action.owner, undefined);
  assert.equal(action.technicalEvidence?.candidates?.[0]?.structuralContext?.scopeIdentity?.value, "stable-scope");
  assert.equal(action.technicalEvidence?.candidates?.[0]?.structuralContext?.targetFingerprint, "opaque-local-target-fingerprint");
  assert.equal(action.technicalEvidence?.candidates?.[0]?.locatorCandidates.length, 0);
  const attachment = logs.find((line) => line.includes("structural_runtime_evidence_attachment"));
  assert.ok(attachment);
  assert.match(attachment, /"scopeAttachedToClick":true/);
  assert.match(attachment, /"fingerprintAttachedToClick":true/);
  assert.match(attachment, /"runtimeEvidenceEligibleAtBrowser":true/);
});

/**
 * DIAGNOSE-ONLY (physical contradiction investigation, recordingId=842325b2-...): a real click
 * produced scopeAvailable=true, fingerprintAvailable=true, but
 * scopeAttachedToClick=fingerprintAttachedToClick=runtimeEvidenceEligibleAtBrowser=false. This
 * reproduces it: the raw clicked target's OWN identity is NOT globally unique
 * (captureTargetMatchCount=3, unlike every other fixture above which uses 1) even though a
 * genuinely unique ANCESTOR scope was found -- `pairedIdentity.deterministicStructuralIdentity`
 * is computed from the RAW target's own (unscoped, page-wide) match counts, never re-derived
 * relative to the scope boundary, so `buildScopedStructuralRuntimeEvidence`'s own
 * `deterministicStructuralIdentity !== true` gate correctly (per its own contract) rejects it --
 * CASE C: the builder receives both scope and fingerprint but returns undefined via a different,
 * legitimate gate. This is DIAGNOSE-only: no behavior/gate change, only the new redacted fields.
 */
test("11c2/physicalContradiction. scope+fingerprint both present but the raw target's own (unscoped) match count is not 1 -- attachment correctly stays false, and the new diagnostic fields report exactly why", () => {
  const logs: string[] = [];
  const bridge = new CaptureEngineV2ShadowBridge((line) => logs.push(line));
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-physical-shape-1",
    composedPath: [
      candidate({
        tag: "span",
        actionable: false,
        pathDepth: 0,
        structuralIdentity: {
          owner: { tag: "span" },
          stableDirectAttributes: {},
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: false,
          structuralIdentityMatchCount: 3,
          targetFingerprint: "opaque-unscoped-target-fingerprint",
          captureTargetMatchCount: 3,
        },
      }),
      candidate({
        tag: "form",
        actionable: false,
        pathDepth: 6,
        structuralIdentity: {
          owner: { tag: "form" },
          stableDirectAttributes: { id: "stable-scope" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          scopeIdentity: { strategy: "id", value: "stable-scope" },
          targetFingerprint: "ancestor-fingerprint",
          captureScopeUnique: true,
          captureTargetMatchCount: 1,
        },
      }),
    ],
  });

  const action = bridge.technicalActions[0]?.action;
  assert.ok(action, "the unresolved click is still preserved as a raw technical action");
  assert.equal(action.technicalEvidence, undefined, "no scoped structural evidence is attached -- the raw target's own match count is not 1");
  const attachment = logs.find((line) => line.includes("structural_runtime_evidence_attachment"));
  assert.ok(attachment);
  assert.match(attachment!, /"scopeAvailable":true/);
  assert.match(attachment!, /"fingerprintAvailable":true/);
  assert.match(attachment!, /"scopeAttachedToClick":false/);
  assert.match(attachment!, /"fingerprintAttachedToClick":false/);
  assert.match(attachment!, /"runtimeEvidenceEligibleAtBrowser":false/);
  assert.match(attachment!, /"selectedScopePresent":true/);
  assert.match(attachment!, /"selectedFingerprintPresent":true/);
  assert.match(attachment!, /"builderCalled":true/);
  assert.match(attachment!, /"builderReturnedEvidence":false/);
  assert.match(attachment!, /"rawClickStructuralEvidencePresent":true/);
  assert.match(attachment!, /"bridgeRevision":"scoped-attachment-v1"/);
  // DIAGNOSE-ONLY (recordingId=9db2d5ff-...): no candidate here carries scopeBoundOriginalTargetIdentity
  // at all -- CASE D shape (zero scope-bound candidates), so the pre-correlated path never runs and
  // the bridge falls back to the raw-target inference, which itself returns no evidence.
  assert.match(attachment!, /"scopeBoundCandidateCount":0/);
  assert.match(attachment!, /"scopeBoundBuilderAcceptedCount":0/);
  assert.match(attachment!, /"selectionCardinality":"zero"/);
  assert.match(attachment!, /"fallbackAttempted":true/);
  assert.match(attachment!, /"fallbackReturnedEvidence":false/);
  assert.match(attachment!, /"finalScopedEvidencePresent":false/);
});

/**
 * MICROFIX (recordingId=842325b2-...): PAGE-WIDE target uniqueness -> SCOPE-RELATIVE target
 * uniqueness. `rawIdentity`'s own scope-relative counts are only trustworthy when (a) it
 * self-verified its OWN scope as unique, or (b) it found no scope at all, meaning its count is
 * the GLOBAL one -- and a globally-unique target (count===1) is trivially unique within ANY
 * subset of the page. Never pair a count computed relative to one (non-self-verified) scope with
 * a DIFFERENT scope's identity.
 */
test("11e/scopeRelativeUniqueness. raw target self-verifies its OWN scope as unique -- deterministicStructuralIdentity uses that LOCAL authority, never the raw target's page-wide count", () => {
  const logs: string[] = [];
  const bridge = new CaptureEngineV2ShadowBridge((line) => logs.push(line));
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-local-unique-1",
    composedPath: [candidate({
      tag: "span",
      actionable: false,
      pathDepth: 0,
      structuralIdentity: {
        owner: { tag: "span" },
        stableDirectAttributes: { "data-field": "custom-control" },
        stableDescendants: [],
        semanticShape: [],
        deterministicStructuralIdentity: true,
        structuralIdentityMatchCount: 1,
        scopeIdentity: { strategy: "id", value: "self-scope" },
        targetFingerprint: "opaque-self-scoped-fingerprint",
        captureScopeUnique: true,
        captureTargetMatchCount: 1,
      },
    })],
  });

  const action = bridge.technicalActions[0]?.action;
  assert.ok(action);
  assert.equal(action.technicalEvidence?.candidates?.[0]?.structuralContext?.scopeIdentity?.value, "self-scope");
  assert.equal(action.technicalEvidence?.candidates?.[0]?.structuralContext?.targetFingerprint, "opaque-self-scoped-fingerprint");
  const attachment = logs.find((line) => line.includes("structural_runtime_evidence_attachment"));
  assert.match(attachment!, /"runtimeEvidenceEligibleAtBrowser":true/);
});

test("11f/globalAmbiguousLocalUnique. raw target has zero global stable evidence of its own but a DIFFERENT, self-verified-unique ancestor scope exists, and the raw target's own count is exactly 1 GLOBALLY -- pairing is accepted (monotonicity: globally unique implies locally unique)", () => {
  const logs: string[] = [];
  const bridge = new CaptureEngineV2ShadowBridge((line) => logs.push(line));
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-global-unique-1",
    composedPath: [
      candidate({
        tag: "div",
        actionable: false,
        pathDepth: 0,
        structuralIdentity: {
          owner: { tag: "div" },
          stableDirectAttributes: { "data-field": "custom-control" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          targetFingerprint: "opaque-global-unique-fingerprint",
          captureTargetMatchCount: 1,
        },
      }),
      candidate({
        tag: "form",
        actionable: false,
        pathDepth: 3,
        structuralIdentity: {
          owner: { tag: "form" },
          stableDirectAttributes: { id: "distinct-scope" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          scopeIdentity: { strategy: "id", value: "distinct-scope" },
          targetFingerprint: "ancestor-only-fingerprint",
          captureScopeUnique: true,
          captureTargetMatchCount: 1,
        },
      }),
    ],
  });

  const action = bridge.technicalActions[0]?.action;
  assert.ok(action);
  assert.equal(action.technicalEvidence?.candidates?.[0]?.structuralContext?.scopeIdentity?.value, "distinct-scope");
  assert.equal(action.technicalEvidence?.candidates?.[0]?.structuralContext?.targetFingerprint, "opaque-global-unique-fingerprint", "the ORIGINAL clicked target's own fingerprint is preserved -- the ancestor is used only as scope, never as target");
});

test("11g/localAmbiguousRejected. raw target self-verifies a scope but its OWN local match count within that scope is > 1 -- fail closed, never forced to 1", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-local-ambiguous-1",
    composedPath: [candidate({
      tag: "span",
      actionable: false,
      pathDepth: 0,
      structuralIdentity: {
        owner: { tag: "span" },
        stableDirectAttributes: { "data-field": "custom-control" },
        stableDescendants: [],
        semanticShape: [],
        deterministicStructuralIdentity: false,
        structuralIdentityMatchCount: 2,
        scopeIdentity: { strategy: "id", value: "self-scope" },
        targetFingerprint: "opaque-fingerprint",
        captureScopeUnique: true,
        captureTargetMatchCount: 2,
      },
    })],
  });
  assert.equal(bridge.technicalActions[0]?.action.technicalEvidence, undefined, "a local match count of 2 must never be forced to 1");
});

test("11h/scopeAmbiguousRejected. raw target self-reports a scope but that scope is NOT itself page-wide unique -- fail closed, never paired with an unrelated ancestor's counts", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-scope-ambiguous-1",
    composedPath: [candidate({
      tag: "span",
      actionable: false,
      pathDepth: 0,
      structuralIdentity: {
        owner: { tag: "span" },
        stableDirectAttributes: {},
        stableDescendants: [],
        semanticShape: [],
        deterministicStructuralIdentity: false,
        structuralIdentityMatchCount: 1,
        scopeIdentity: { strategy: "id", value: "duplicated-scope-id" },
        targetFingerprint: "opaque-fingerprint",
        captureScopeUnique: false,
        captureTargetMatchCount: 1,
      },
    })],
  });
  assert.equal(bridge.technicalActions[0]?.action.technicalEvidence, undefined, "an unverified (non-unique) self-reported scope must never be trusted");
});

test("11i/missingFingerprintRejected. scope self-verified but no targetFingerprint present -- fail closed", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-missing-fingerprint-1",
    composedPath: [candidate({
      tag: "span",
      actionable: false,
      pathDepth: 0,
      structuralIdentity: {
        owner: { tag: "span" },
        stableDirectAttributes: { "data-field": "custom-control" },
        stableDescendants: [],
        semanticShape: [],
        deterministicStructuralIdentity: true,
        structuralIdentityMatchCount: 1,
        scopeIdentity: { strategy: "id", value: "self-scope" },
        captureScopeUnique: true,
        captureTargetMatchCount: 1,
      },
    })],
  });
  assert.equal(bridge.technicalActions[0]?.action.technicalEvidence, undefined);
});

test("11j/noCountsForcedToOne. neither the raw target's own counts nor the paired scope's counts are ever hardcoded to 1 -- verified via source text", () => {
  const source = CaptureEngineV2ShadowBridge.toString();
  assert.doesNotMatch(source, /captureTargetMatchCount:\s*1[,}]/, "captureTargetMatchCount must never be hardcoded to 1");
  assert.doesNotMatch(source, /structuralIdentityMatchCount:\s*1[,}]/, "structuralIdentityMatchCount must never be hardcoded to 1");
});

/**
 * MICROFIX (recordingId=f0ff8562-...): the browser now computes, per ancestor candidate that
 * itself carries a durable id/data-testid, the ORIGINAL clicked target's OWN structural identity
 * evaluated with THAT candidate as scope root (`scopeBoundOriginalTargetIdentity`) -- scope and
 * target proof therefore always come from the exact same boundary, never combined post-hoc from
 * two independently-scoped candidates. This is the exact physical shape 11c2 reproduces (raw
 * target globally ambiguous, no self-verified scope of its own) but now resolved: the ancestor's
 * pre-correlated evidence is used directly instead of falling back to the raw-target inference.
 */
test("11k/scopeBoundPhysicalFix. raw target is globally ambiguous with no self-verified scope, but an ancestor's pre-correlated scopeBoundOriginalTargetIdentity proves it unique within that exact scope -- evidence attaches", () => {
  const logs: string[] = [];
  const bridge = new CaptureEngineV2ShadowBridge((line) => logs.push(line));
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-scope-bound-1",
    composedPath: [
      candidate({
        tag: "span",
        actionable: false,
        pathDepth: 0,
        structuralIdentity: {
          owner: { tag: "span" },
          stableDirectAttributes: {},
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: false,
          structuralIdentityMatchCount: 3,
          targetFingerprint: "opaque-unscoped-target-fingerprint",
          captureTargetMatchCount: 3,
        },
      }),
      candidate({
        tag: "form",
        actionable: false,
        pathDepth: 6,
        structuralIdentity: {
          owner: { tag: "form" },
          stableDirectAttributes: { id: "stable-scope" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          scopeIdentity: { strategy: "id", value: "stable-scope" },
          targetFingerprint: "ancestor-fingerprint",
          captureScopeUnique: true,
          captureTargetMatchCount: 1,
        },
        scopeBoundOriginalTargetIdentity: {
          owner: { tag: "span" },
          stableDirectAttributes: { "data-field": "custom-control" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          scopeIdentity: { strategy: "id", value: "stable-scope" },
          targetFingerprint: "opaque-scope-bound-target-fingerprint",
          captureScopeUnique: true,
          captureTargetMatchCount: 1,
        },
      }),
    ],
  });

  const action = bridge.technicalActions[0]?.action;
  assert.ok(action);
  assert.equal(action.technicalEvidence?.candidates?.[0]?.structuralContext?.scopeIdentity?.value, "stable-scope");
  assert.equal(
    action.technicalEvidence?.candidates?.[0]?.structuralContext?.targetFingerprint,
    "opaque-scope-bound-target-fingerprint",
    "the attached fingerprint must describe the ORIGINAL target, never the ancestor's own fingerprint",
  );
  const attachment = logs.find((line) => line.includes("structural_runtime_evidence_attachment"));
  assert.ok(attachment);
  assert.match(attachment!, /"runtimeEvidenceEligibleAtBrowser":true/);
  // DIAGNOSE-ONLY (recordingId=9db2d5ff-...): pipeline-stage counts prove the cardinality that
  // produced this attachment, without introducing a new authority/channel.
  assert.match(attachment!, /"scopeBoundCandidateCount":1/);
  assert.match(attachment!, /"scopeBoundBuilderAcceptedCount":1/);
  assert.match(attachment!, /"scopeBoundBuilderRejectedCount":0/);
  assert.match(attachment!, /"selectionCardinality":"one"/);
  assert.match(attachment!, /"fallbackAttempted":false/);
  assert.match(attachment!, /"finalScopedEvidencePresent":true/);
});

test("11l/scopeBoundCountsNeverForced. an ancestor's scopeBoundOriginalTargetIdentity with a target match count above 1 within that scope is rejected, never forced to 1", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-scope-bound-rejected",
    composedPath: [
      candidate({ tag: "span", actionable: false, pathDepth: 0 }),
      candidate({
        tag: "form",
        actionable: false,
        pathDepth: 6,
        structuralIdentity: {
          owner: { tag: "form" },
          stableDirectAttributes: { id: "stable-scope" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          scopeIdentity: { strategy: "id", value: "stable-scope" },
          targetFingerprint: "ancestor-fingerprint",
          captureScopeUnique: true,
          captureTargetMatchCount: 1,
        },
        scopeBoundOriginalTargetIdentity: {
          owner: { tag: "span" },
          stableDirectAttributes: { "data-field": "custom-control" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: false,
          structuralIdentityMatchCount: 2,
          scopeIdentity: { strategy: "id", value: "stable-scope" },
          targetFingerprint: "opaque-scope-bound-target-fingerprint",
          captureScopeUnique: true,
          captureTargetMatchCount: 2,
        },
      }),
    ],
  });

  assert.equal(bridge.technicalActions[0]?.action.technicalEvidence, undefined);
});

test("11m/scopeBoundAmbiguousFailsClosed. more than one candidate offers valid scope-bound evidence -- no ordinal authority, fail closed rather than guessing which scope wins", () => {
  const validScopeBoundIdentity = (scopeValue: string) => ({
    owner: { tag: "span" },
    stableDirectAttributes: { "data-field": "custom-control" },
    stableDescendants: [],
    semanticShape: [],
    deterministicStructuralIdentity: true,
    structuralIdentityMatchCount: 1,
    scopeIdentity: { strategy: "id" as const, value: scopeValue },
    targetFingerprint: "opaque-scope-bound-target-fingerprint",
    captureScopeUnique: true,
    captureTargetMatchCount: 1,
  });
  const logs: string[] = [];
  const bridge = new CaptureEngineV2ShadowBridge((line) => logs.push(line));
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-scope-bound-ambiguous",
    composedPath: [
      candidate({ tag: "span", actionable: false, pathDepth: 0 }),
      candidate({
        tag: "section",
        actionable: false,
        pathDepth: 3,
        structuralIdentity: {
          owner: { tag: "section" },
          stableDirectAttributes: { id: "scope-near" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          scopeIdentity: { strategy: "id", value: "scope-near" },
          targetFingerprint: "near-ancestor-fingerprint",
          captureScopeUnique: true,
          captureTargetMatchCount: 1,
        },
        scopeBoundOriginalTargetIdentity: validScopeBoundIdentity("scope-near"),
      }),
      candidate({
        tag: "form",
        actionable: false,
        pathDepth: 6,
        structuralIdentity: {
          owner: { tag: "form" },
          stableDirectAttributes: { id: "scope-far" },
          stableDescendants: [],
          semanticShape: [],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          scopeIdentity: { strategy: "id", value: "scope-far" },
          targetFingerprint: "far-ancestor-fingerprint",
          captureScopeUnique: true,
          captureTargetMatchCount: 1,
        },
        scopeBoundOriginalTargetIdentity: validScopeBoundIdentity("scope-far"),
      }),
    ],
  });

  assert.equal(bridge.technicalActions[0]?.action.technicalEvidence, undefined);
  const attachment = logs.find((line) => line.includes("structural_runtime_evidence_attachment"));
  assert.ok(attachment);
  assert.match(attachment!, /"scopeBoundCandidateCount":2/);
  assert.match(attachment!, /"scopeBoundBuilderAcceptedCount":2/);
  assert.match(attachment!, /"selectionCardinality":"multiple"/);
  assert.match(attachment!, /"fallbackAttempted":false/);
  assert.match(attachment!, /"finalScopedEvidencePresent":false/);
});

test("11d. text-only scoped identity remains fail-closed", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-text-only",
    composedPath: [candidate({
      tag: "div",
      actionable: true,
      pathDepth: 0,
      structuralIdentity: {
        owner: { tag: "div" },
        stableDirectAttributes: { "aria-label": "visible text" },
        stableDescendants: [],
        semanticShape: [],
        deterministicStructuralIdentity: true,
        structuralIdentityMatchCount: 1,
        scopeIdentity: { strategy: "id", value: "stable-scope" },
        targetFingerprint: "label-only",
        captureScopeUnique: true,
        captureTargetMatchCount: 1,
      },
    })],
  });
  assert.equal(bridge.technicalActions[0]?.action.technicalEvidence, undefined);
});

/**
 * DEFINITIVE FIX (recordingId=5514cd5b-...): a click whose owner classification succeeded
 * (Priority 4/stable_associated_control_evidence here) but whose OWN structural identity never
 * qualified for `buildOwnerTechnicalEvidence` (no technicalRefs, no structuralIdentity computed
 * at all -- role=null, technicalTargetCount=0 in the physical log) previously had NO fallback:
 * semantic runtime evidence was architecturally walled off behind resolveCaptureOwner's
 * unresolved branch only. Fixed: the RESOLVED branch now also reads the ORIGINAL target's own
 * `semanticRuntimeEvidence` (which the browser computes unconditionally) when technicalEvidence
 * is absent. Owner/technicalEvidence stay exactly as resolveCaptureOwner produced them -- this is
 * purely additive.
 */
test("11n/resolvedOwnerSemanticFallback. a resolved-but-technically-weak owner (stable_associated_control_evidence, no locator, no structuralIdentity) now also carries semantic runtime evidence, never fabricating a certified target", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-resolved-weak-1",
    composedPath: [candidate({
      tag: "div",
      pathDepth: 0,
      associatedField: "SMS",
      groupEvidence: "tab-group",
      semanticRuntimeEvidence: {
        source: "visible_text",
        normalizedValue: "SMS",
        targetTag: "div",
        scopeAlternatives: [{ scopeIdentity: { strategy: "id", value: "stable-scope" }, captureMatchCount: 1 }],
        captureUniqueTarget: true,
      },
    })],
  });

  const action = bridge.technicalActions[0]?.action;
  assert.ok(action, "the click resolves via stable_associated_control_evidence, same as before");
  assert.equal(action.technicalEvidence, undefined, "no certified technical evidence exists for this owner -- unchanged");
  assert.ok(action.owner, "owner resolution itself is completely unchanged");
  assert.ok(action.semanticRuntimeEvidence, "semantic runtime evidence now reaches a RESOLVED-but-technically-weak owner too");
  assert.equal(action.semanticRuntimeEvidence?.normalizedValue, "SMS");
  assert.ok(action.playwrightRecorderEvidence, "the recorder-candidate adapter runs for this path too");
});

test("11o/resolvedOwnerWithTechnicalEvidenceUnaffected. a resolved owner that DOES have real technicalEvidence never gets a semantic fallback attached -- priority order preserved", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-resolved-strong-1",
    composedPath: [candidate({
      tag: "button",
      actionable: true,
      role: "button",
      pathDepth: 0,
      technicalRefs: ["id:submit-btn"],
      semanticRuntimeEvidence: {
        source: "visible_text",
        normalizedValue: "SMS",
        targetTag: "button",
        scopeAlternatives: [{ scopeIdentity: { strategy: "id", value: "stable-scope" }, captureMatchCount: 1 }],
        captureUniqueTarget: true,
      },
    })],
  });

  const action = bridge.technicalActions[0]?.action;
  assert.ok(action);
  assert.ok(action.technicalEvidence, "a real technical ref produces real technicalEvidence");
  assert.equal(action.semanticRuntimeEvidence, undefined, "semantic fallback never attaches when stronger technical evidence already exists");
  assert.equal(action.playwrightRecorderEvidence, undefined);
});

/**
 * FIRST-LOSS FIX (recordingId=b9981890-...): a fully unresolved click (no owner, no
 * structuralIdentity, no semanticRuntimeEvidence -- the browser found a stable semantic value
 * but no unique scope alternative) previously dropped the browser's own last-resort
 * `playwrightRecorderEvidence` fallback entirely, because the unresolved branch only ever
 * consulted `rawTarget.semanticRuntimeEvidence`. It must now pass that browser-computed object
 * through as-is.
 */
test("11p/unresolvedOwnerRecorderFallback. an unresolved click with browser-computed playwrightRecorderEvidence but no semanticRuntimeEvidence still reaches CaptureAction, unmutated", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  const recorderEvidence: PlaywrightRecorderEvidence = {
    kind: "text",
    normalizedName: "SMS",
    targetTag: "div",
    runtimeResolutionRequired: true,
  };
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-unresolved-recorder-1",
    composedPath: [candidate({
      tag: "div",
      actionable: true,
      pathDepth: 0,
      playwrightRecorderEvidence: recorderEvidence,
    })],
  });

  const action = bridge.technicalActions[0]?.action;
  assert.ok(action, "the unresolved click is still preserved as a raw technical action");
  assert.equal(action.owner, undefined, "no owner is fabricated");
  assert.equal(action.technicalEvidence, undefined, "no technical evidence is fabricated");
  assert.equal(action.semanticRuntimeEvidence, undefined, "no semanticRuntimeEvidence is fabricated from the recorder fallback");
  assert.deepEqual(action.playwrightRecorderEvidence, recorderEvidence, "the browser-computed recorder evidence survives unmutated");
});

test("11q/unresolvedOwnerRecorderPrecedence. when semanticRuntimeEvidence-derived recorder evidence already exists, the browser recorder fallback never overrides or doubles it", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    interactionId: "pointer-unresolved-precedence-1",
    composedPath: [candidate({
      tag: "div",
      actionable: true,
      pathDepth: 0,
      semanticRuntimeEvidence: {
        source: "visible_text",
        normalizedValue: "SMS",
        targetTag: "div",
        scopeAlternatives: [{ scopeIdentity: { strategy: "id", value: "stable-scope" }, captureMatchCount: 1 }],
        captureUniqueTarget: true,
      },
      // A conflicting fallback that must never surface: precedence must stay with the
      // semanticRuntimeEvidence-derived evidence, never merged/doubled with this one.
      playwrightRecorderEvidence: {
        kind: "text",
        normalizedName: "SHOULD-NOT-BE-USED",
        targetTag: "div",
        runtimeResolutionRequired: true,
      } satisfies PlaywrightRecorderEvidence,
    })],
  });

  const action = bridge.technicalActions[0]?.action;
  assert.ok(action);
  assert.ok(action.playwrightRecorderEvidence, "recorder evidence is present");
  assert.notEqual(action.playwrightRecorderEvidence?.normalizedName, "SHOULD-NOT-BE-USED", "the browser fallback never overrides the semanticRuntimeEvidence-derived evidence");
});

test("11b. an unresolved click without pointer identity remains fail-closed and is not preserved", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "div", actionable: true, pathDepth: 0 })] });
  assert.equal(bridge.technicalActions.length, 0);
  assert.equal(bridge.shadowDiagnostics.some((d) => d.reason === "click_owner_unresolved"), true);
});

test("14. a V2 internal failure never throws out of handleMessage, and the bridge keeps working for later, valid messages", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });

  assert.doesNotThrow(() => {
    bridge.handleMessage({ type: "click", ...doc, composedPath: null as unknown as CaptureOwnerCandidate[] });
  });
  assert.ok(bridge.shadowDiagnostics.some((d) => d.reason.startsWith("v2_internal_error")));

  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", actionable: true, pathDepth: 0 })],
  });
  assert.equal(bridge.technicalActions.length, 1, "a later, valid message is still processed normally");
});

test("every ShadowBrowserMessage type in this test file is a plain data literal -- no live DOM/Playwright object involved", () => {
  const sample: ShadowBrowserMessage = { type: "document_retire", ...doc };
  assert.equal(sample.type, "document_retire");
});

/**
 * Observability ticket: a real "LOGIN V2" recording produced zero `[capture-v2]` lines in
 * backend stdout, even though the bridge itself was working. Root cause: every diagnostic here
 * previously went ONLY through the optional `log` callback, which `web-session-recorder.ts`
 * wires to `this.log` -> `options.onLog` -- a channel the caller (`session-recording-runner.ts`)
 * routes to the job store's SSE log stream for the UI, never to the Node process's own stdout.
 * `emit()` now also calls `console.log` directly, matching the pre-existing pattern already used
 * elsewhere in this file for other diagnostic-only lines (`console.log(describeFieldOwnerUnresolved(...))`).
 * These tests capture real `console.log` output (never just the injected `log` callback) to
 * verify the fix at the boundary that was actually broken.
 */
function captureConsoleLog<T>(fn: () => T): { result: T; lines: string[] } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return { result: fn(), lines };
  } finally {
    console.log = original;
  }
}

test("1/2. document_ready produces both a generic message log and a document_ready log, on real console.log", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const { lines } = captureConsoleLog(() => bridge.handleMessage({ type: "document_ready", ...doc }));

  assert.ok(lines.some((l) => l.startsWith("[capture-v2] message type=document_ready")));
  assert.ok(lines.some((l) => /^\[capture-v2\] document_ready document=doc-A generation=\d+/.test(l)));
});

test("3. a committed CaptureAction is logged on real console.log without ever including its value", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const { lines } = captureConsoleLog(() => {
    bridge.handleMessage({ type: "document_ready", ...doc });
    bridge.handleMessage({
      type: "focus",
      ...doc,
      sessionId: "session-user",
      composedPath: [candidate({ tag: "input", editable: true, pathDepth: 0 })],
      identity: { label: "Usuario" },
    });
    bridge.handleMessage({ type: "edit_evidence", sessionId: "session-user", kind: "input", valueState: { present: true, literal: "qauser" } });
    bridge.handleMessage({ type: "blur", ...doc, sessionId: "session-user" });
  });

  const actionLine = lines.find((l) => l.startsWith("[capture-v2] action seq="));
  assert.ok(actionLine);
  assert.match(actionLine!, /type=edit ownerTag=input ownerRole=/);
  assert.ok(!lines.some((l) => l.includes("qauser")), "no field value ever reaches a log line");
});

test("4. a sensitive CaptureAction's log line never contains the fixture secret", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const fixtureSecret = "fixture-only-never-logged";
  const { lines } = captureConsoleLog(() => {
    bridge.handleMessage({ type: "document_ready", ...doc });
    bridge.handleMessage({
      type: "focus",
      ...doc,
      sessionId: "session-pw",
      composedPath: [candidate({ tag: "input", editable: true, pathDepth: 0 })],
      identity: { label: "Contraseña", inputType: "password" },
      sensitive: true,
    });
    bridge.handleMessage({ type: "edit_evidence", sessionId: "session-pw", kind: "input", valueState: { present: true, changed: true } });
    bridge.handleMessage({ type: "blur", ...doc, sessionId: "session-pw" });
  });

  assert.ok(!lines.some((l) => l.includes(fixtureSecret)));
  assert.ok(lines.some((l) => l.startsWith("[capture-v2] action seq=") && l.includes("type=edit")));
});

test("5. an unresolved owner emits bounded structural resolution evidence before the fail-closed reason", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const { lines } = captureConsoleLog(() => {
    bridge.handleMessage({ type: "document_ready", ...doc });
    bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "div", actionable: true, pathDepth: 0, accessibleName: "fixture owner label", technicalRefs: ["id:fixture"], trustedClick: true, frameworkActionable: true, frameworkIdentitySufficient: true })] });
  });

  const evidence = lines.find((line) => line.startsWith("[capture-v2-owner-resolution]"));
  assert.ok(evidence);
  assert.match(evidence!, /status=unresolved rule=unresolved_no_actionable_semantics/);
  assert.match(evidence!, /"tag":"div"/);
  assert.match(evidence!, /"actionable":true/);
  assert.match(evidence!, /"hasTechnicalRef":true/);
  assert.match(evidence!, /"hasAccessibleName":true/);
  assert.match(evidence!, /"trustedClick":true/);
  assert.match(evidence!, /"frameworkActionable":true/);
  assert.match(evidence!, /"frameworkIdentitySufficient":true/);
  assert.ok(!evidence!.includes("fixture owner label"), "the diagnostic carries label presence, never label text");
  assert.ok(lines.indexOf(evidence!) < lines.indexOf("[capture-v2] unresolved reason=click_owner_unresolved"));
  assert.ok(lines.some((l) => l === "[capture-v2] unresolved reason=click_owner_unresolved"));
});

test("6. getShadowSummary reports bounded counts for BOTH technical and functional actions, matching what actually happened", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "session-user",
    composedPath: [candidate({ tag: "input", editable: true, pathDepth: 0 })],
    identity: { label: "Usuario" },
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "session-user", kind: "input", valueState: { present: true, literal: "qauser" } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "session-user" });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "button", actionable: true, pathDepth: 0 })] });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "div", actionable: true, pathDepth: 0 })] }); // unresolved

  const summary = bridge.getShadowSummary();
  assert.equal(summary.messages, 6);
  assert.equal(summary.actions, 2, "actions stays the technical count, for the existing stop()-time summary log");
  assert.equal(summary.technicalActions, 2);
  assert.equal(summary.functionalActions, 0);
  assert.equal(summary.diagnostics, 1);
  assert.equal(summary.documents, 1);
  assert.deepEqual(summary.actionTypeCounts, { edit: 1, click: 1 });
  assert.deepEqual(summary.functionalActionTypeCounts, {});
});

test("7. a bridge that never received any message reports messages=0 explicitly, distinguishing 'never observed' from 'observed but silent'", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const summary = bridge.getShadowSummary();
  assert.equal(summary.messages, 0);
  assert.equal(summary.actions, 0);
  assert.equal(summary.technicalActions, 0);
  assert.equal(summary.functionalActions, 0);
  assert.equal(summary.diagnostics, 0);
  assert.equal(summary.documents, 0);
  assert.deepEqual(summary.actionTypeCounts, {});
});

/**
 * Architecture correction: an earlier version of this bridge COLLAPSED a combobox click + an
 * option click into one technical action, silently dropping a physical, replayable click. That
 * broke Playwright/MCP-style replay. The corrected behavior: BOTH clicks always land in
 * `technicalActions`, unconditionally; `SelectionSessionManager` only OBSERVES them afterward to
 * additionally produce a SEPARATE, derived entry in `functionalActions` -- never a replacement.
 */

test("1/2/3. a combobox click AND its option click both remain as separate technical click actions -- never collapsed", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "span", role: "combobox", actionable: true, associatedField: "Tipo de documento", pathDepth: 0 })],
  });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "li", role: "option", actionable: true, accessibleName: "Cédula de ciudadanía", pathDepth: 0 })],
  });

  assert.equal(bridge.technicalActions.length, 2, "the combobox click and the option click must BOTH remain in technicalActions");
  assert.equal(bridge.technicalActions[0].action.actionType, "click");
  assert.equal(bridge.technicalActions[0].action.owner?.role, "combobox");
  assert.equal(bridge.technicalActions[1].action.actionType, "click");
  assert.equal(bridge.technicalActions[1].action.owner?.role, "option");
});

test("4/6/7. the same combobox+option pair ALSO produces exactly one functional select projection, owned by the combobox, with option evidence kept separate", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "span", role: "combobox", actionable: true, associatedField: "Tipo de documento", pathDepth: 0 })],
  });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "li", role: "option", actionable: true, accessibleName: "Cédula de ciudadanía", pathDepth: 0 })],
  });

  assert.equal(bridge.functionalActions.length, 1, "exactly one functional projection for the pair");
  const projection = bridge.functionalActions[0].action;
  assert.equal(projection.functionalActionType, "select");
  assert.equal(projection.owner?.role, "combobox", "the functional projection's owner must be the combobox, never the option");
  assert.equal(projection.owner?.associatedField, "Tipo de documento");
  assert.equal(projection.selectionEvidence.optionOwner?.role, "option", "the option's own evidence is kept separately, not merged into owner");
});

test("5. the functional select projection's sourceTechnicalActionSeqs trace back to the exact two technical click seqs", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "span", role: "combobox", actionable: true, pathDepth: 0 })] });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "li", role: "option", actionable: true, pathDepth: 0 })] });

  const technicalSeqs = bridge.technicalActions.map((r) => r.seq);
  assert.deepEqual(bridge.functionalActions[0].action.sourceTechnicalActionSeqs, technicalSeqs);
});

test("9. an unresolved click between combobox and option leaves the technical stream unaffected and the pending semantic session survives", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "span", role: "combobox", actionable: true, pathDepth: 0 })],
  });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "div", actionable: true, pathDepth: 0 })], // overlay/backdrop -- unresolved (container-only, no role)
  });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "li", role: "option", actionable: true, pathDepth: 0 })],
  });

  assert.equal(bridge.technicalActions.length, 2, "the unresolved click never reaches technicalActions -- only the combobox and option clicks do");
  assert.equal(bridge.functionalActions.length, 1, "the semantic session survived the unresolved intermediate and still projected");
});

test("10. an unrelated action after a pending combobox is preserved technically, and the pending semantic selection is cancelled", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "span", role: "combobox", actionable: true, pathDepth: 0 })] });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "button", actionable: true, accessibleName: "Iniciar sesión", pathDepth: 0 })] });

  assert.equal(bridge.technicalActions.length, 2, "both the combobox click and the unrelated button click remain technical actions");
  assert.equal(bridge.technicalActions[1].action.owner?.accessibleName, "Iniciar sesión");
  assert.equal(bridge.functionalActions.length, 0, "no selection was ever completed, so no functional projection exists");
  assert.equal(bridge.shadowDiagnostics.some((d) => d.reason === "selection_cancelled_unrelated_owner"), true);
});

test("8. two selections produce four technical clicks and two functional select projections", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  function selection() {
    bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "span", role: "combobox", actionable: true, pathDepth: 0 })] });
    bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "li", role: "option", actionable: true, pathDepth: 0 })] });
  }
  selection();
  selection();

  assert.equal(bridge.technicalActions.length, 4);
  assert.equal(bridge.functionalActions.length, 2);
});

test("11/12. existing edit and normal-click behavior are unaffected by this change", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "session-user",
    composedPath: [candidate({ tag: "input", editable: true, pathDepth: 0 })],
    identity: { label: "Usuario" },
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "session-user", kind: "input", valueState: { present: true, literal: "qauser" } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "session-user" });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "button", actionable: true, accessibleName: "Depurar", pathDepth: 0 })] });

  assert.equal(bridge.technicalActions.length, 2);
  assert.equal(bridge.technicalActions[0].action.actionType, "edit");
  assert.equal(bridge.technicalActions[1].action.actionType, "click");
  assert.equal(bridge.functionalActions.length, 0);
});

test("13. ordering: edit, edit, click, combo+option x2, edit, click, click -- technicalActions keep the exact physical shape and order (10 technical actions for the fixture's physical evidence)", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });

  function edit(sessionId: string, label: string) {
    bridge.handleMessage({ type: "focus", ...doc, sessionId, composedPath: [candidate({ tag: "input", editable: true, pathDepth: 0 })], identity: { label } });
    bridge.handleMessage({ type: "edit_evidence", sessionId, kind: "input", valueState: { present: true, literal: "x" } });
    bridge.handleMessage({ type: "blur", ...doc, sessionId });
  }
  function selection() {
    bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "span", role: "combobox", actionable: true, pathDepth: 0 })] });
    bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "li", role: "option", actionable: true, pathDepth: 0 })] });
  }
  function click(label: string) {
    bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "button", actionable: true, accessibleName: label, pathDepth: 0 })] });
  }

  edit("s1", "Usuario");
  edit("s2", "Contraseña");
  click("Iniciar sesión");
  selection();
  selection();
  edit("s3", "Número de identificación");
  click("botón asociado");
  click("Depurar");

  const types = bridge.technicalActions.map((r) => r.action.actionType);
  assert.deepEqual(types, ["edit", "edit", "click", "click", "click", "click", "click", "edit", "click", "click"], "10 technical actions -- the two combobox+option pairs are NOT collapsed");
  assert.equal(bridge.functionalActions.length, 2, "exactly two functional select projections, one per pair");
  for (let i = 1; i < bridge.technicalActions.length; i++) {
    assert.ok(bridge.technicalActions[i - 1].seq < bridge.technicalActions[i].seq);
  }
});

test("14. functional projections cannot mutate or remove technicalActions: the combobox's technical entry is byte-for-byte unchanged after the projection is produced", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "span", role: "combobox", actionable: true, pathDepth: 0 })] });
  const before = structuredClone(bridge.technicalActions);

  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "li", role: "option", actionable: true, pathDepth: 0 })] });

  assert.deepEqual(bridge.technicalActions[0], before[0], "the combobox's technical action is byte-for-byte unchanged after the projection is produced");
  assert.equal(bridge.technicalActions.length, 2, "the option's own click was appended, never substituted for anything");
});

test("15. a select projection's log line never includes selectedDisplay/selectedValue -- only type/ownerTag/ownerRole/sourceTechnicalSeqs", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    bridge.handleMessage({ type: "document_ready", ...doc });
    bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "span", role: "combobox", actionable: true, pathDepth: 0 })] });
    bridge.handleMessage({
      type: "click",
      ...doc,
      composedPath: [candidate({ tag: "li", role: "option", actionable: true, accessibleName: "fixture-only-selected-text", pathDepth: 0 })],
    });
  } finally {
    console.log = original;
  }

  const functionalLine = lines.find((l) => l.startsWith("[capture-v2] functional seq="));
  assert.ok(functionalLine);
  assert.match(functionalLine!, /type=select ownerTag=span ownerRole=combobox sourceTechnicalSeqs=\d+,\d+/);
  assert.ok(!functionalLine!.includes("fixture-only-selected-text"), "the selected option's display text must never appear in the log line");
});

test("16. selection wiring stays shadow-only: no reference to onInteraction/pushEvent anywhere in the bridge", () => {
  assert.doesNotMatch(CaptureEngineV2ShadowBridge.toString(), /onInteraction|pushEvent/);
});

test("17. onTechnicalAction fires exactly once per technical action, in push order, and NEVER for a functional projection", () => {
  const notified: number[] = [];
  const bridge = new CaptureEngineV2ShadowBridge(undefined, (record) => notified.push(record.seq));
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "span", role: "combobox", actionable: true, pathDepth: 0 })] });
  bridge.handleMessage({ type: "click", ...doc, composedPath: [candidate({ tag: "li", role: "option", actionable: true, pathDepth: 0 })] });

  assert.equal(bridge.functionalActions.length, 1, "a functional select projection was produced");
  assert.deepEqual(notified, bridge.technicalActions.map((r) => r.seq), "onTechnicalAction must fire once per technical action, in order, and only for technical actions");
});

test("18/diagnosticTransport. bootstrap revision and candidate diagnostics reach the observable trace channel", () => {
  const lines: string[] = [];
  const bridge = new CaptureEngineV2ShadowBridge((line) => lines.push(line));
  bridge.handleMessage({
    type: "capture_trace",
    ...doc,
    stage: "instrumentation_revision",
    diagnostic: { instrumentationRevision: "capture-v2-structural-provenance-v1" },
  } as ShadowBrowserMessage);
  bridge.handleMessage({
    type: "capture_trace",
    ...doc,
    stage: "owner_candidate_diagnostic",
    trusted: true,
    diagnostic: { candidateOrdinalDiagnostic: 0, technicalRefPresent: true, frameworkActionable: false },
  } as ShadowBrowserMessage);
  bridge.handleMessage({
    type: "capture_trace",
    ...doc,
    stage: "owner_candidate_nearest_diagnostic",
    diagnostic: { candidateOrdinalDiagnostic: 0, nearestTechnicalCandidate: true, nearestInteractiveSignalCandidate: false },
  } as ShadowBrowserMessage);

  const diagLine = lines.find((l) => l.startsWith("[capture-v2] trace stage=owner_candidate_diagnostic"));
  const nearestLine = lines.find((l) => l.startsWith("[capture-v2] trace stage=owner_candidate_nearest_diagnostic"));
  const revisionLine = lines.find((l) => l.startsWith("[capture-v2] trace stage=instrumentation_revision"));
  assert.ok(revisionLine, "instrumentation_revision must reach the observable trace log");
  assert.match(revisionLine!, /capture-v2-structural-provenance-v1/);
  assert.ok(diagLine, "owner_candidate_diagnostic must reach the observable trace log");
  assert.ok(nearestLine, "owner_candidate_nearest_diagnostic must reach the observable trace log");
  assert.match(diagLine!, /diagnostic=\{.*"technicalRefPresent":true.*\}/);
});
