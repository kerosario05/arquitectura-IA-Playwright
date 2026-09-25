import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerTechnicalEvidence, resolveCaptureOwner } from "./capture-engine-v2.action-owner-resolver";
import type { CaptureOwner, CaptureOwnerCandidate } from "./capture-engine-v2.types";

/**
 * `resolveCaptureOwner` is CaptureEngine V2's single "raw pointer target -> action owner"
 * resolver: pure, structural, disconnected from any DOM/Playwright handle and NOT wired into
 * `web-session-recorder.ts`. Every fixture below is a plain structural ancestor chain
 * (`CaptureOwnerCandidate[]`), built by hand -- never captured from a real page.
 */

function candidate(overrides: Partial<CaptureOwnerCandidate> & Pick<CaptureOwnerCandidate, "tag" | "pathDepth">): CaptureOwnerCandidate {
  return { editable: false, actionable: false, ...overrides };
}

test("1. input inside form/div -> input owner (editable wins over its container ancestors)", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "input", editable: true, pathDepth: 0 }),
      candidate({ tag: "div", pathDepth: 1 }),
      candidate({ tag: "form", pathDepth: 2 }),
    ],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" && result.owner.tag, "input");
  assert.equal(result.reason, "editable_in_composed_path");
});

test("2. textarea inside a clickable container -> textarea owner, never the container", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "textarea", editable: true, pathDepth: 0 }),
      candidate({ tag: "div", actionable: true, pathDepth: 1 }),
    ],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" && result.owner.tag, "textarea");
});

test("3. svg/path inside a button -> button owner, never the icon", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "path", pathDepth: 0 }),
      candidate({ tag: "svg", pathDepth: 1 }),
      candidate({ tag: "button", actionable: true, pathDepth: 2 }),
    ],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" && result.owner.tag, "button");
  assert.equal(result.reason, "actionable_in_composed_path");
});

test("4. button inside a large form -> button owner (closest genuine actionable identity wins)", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "button", actionable: true, pathDepth: 0 }),
      candidate({ tag: "form", actionable: true, pathDepth: 1 }),
    ],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" && result.owner.tag, "button");
});

test("5. plain div flagged actionable only by aggregated text/cursor-pointer -> unresolved", () => {
  const result = resolveCaptureOwner({
    composedPath: [candidate({ tag: "div", actionable: true, pathDepth: 0 })],
  });
  assert.equal(result.status, "unresolved");
  assert.equal(result.reason, "unresolved_no_actionable_semantics");
});

test("6. a form is never an owner on its own identity, even flagged actionable, with no editable/actionable/structural evidence in its path", () => {
  const result = resolveCaptureOwner({
    composedPath: [candidate({ tag: "form", actionable: true, pathDepth: 0 })],
  });
  assert.equal(result.status, "unresolved", "a bare <form> must never resolve as its own owner");
});

test("7. a custom control with role=button resolves, even though its tag is a generic div", () => {
  const result = resolveCaptureOwner({
    composedPath: [candidate({ tag: "div", role: "button", actionable: true, pathDepth: 0 })],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" && result.owner.role, "button");
});

test("8. editable inside a role=button wrapper -> editable wins", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "input", editable: true, pathDepth: 0 }),
      candidate({ tag: "div", role: "button", actionable: true, pathDepth: 1 }),
    ],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" && result.owner.tag, "input");
  assert.equal(result.reason, "editable_in_composed_path");
});

test("9. icon button with no accessible name but real associatedField evidence -> button owner, associatedField preserved, nothing inferred from the icon", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "path", pathDepth: 0 }),
      candidate({ tag: "svg", pathDepth: 1 }),
      candidate({ tag: "button", actionable: true, associatedField: "Número de cliente", pathDepth: 2 }),
    ],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" && result.owner.tag, "button");
  assert.equal(result.status === "resolved" && result.owner.associatedField, "Número de cliente");
});

test("10. no editable, no genuine actionable identity, no structural evidence anywhere -> unresolved", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "div", pathDepth: 0 }),
      candidate({ tag: "body", pathDepth: 1 }),
    ],
  });
  assert.equal(result.status, "unresolved");
});

test("11. a disabled control still resolves as owner; the disabled flag is preserved, never used to block resolution", () => {
  const result = resolveCaptureOwner({
    composedPath: [candidate({ tag: "button", actionable: true, disabled: true, pathDepth: 0 })],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" && result.owner.disabled, true);
});

test("12. resolution depends only on structural fields (pathDepth/editable/actionable/role/tag), never on array input order or an app-specific string", () => {
  const forward: CaptureOwnerCandidate[] = [
    candidate({ tag: "path", pathDepth: 0 }),
    candidate({ tag: "svg", pathDepth: 1 }),
    candidate({ tag: "button", actionable: true, pathDepth: 2 }),
  ];
  const reversed = [...forward].reverse();
  const a = resolveCaptureOwner({ composedPath: forward });
  const b = resolveCaptureOwner({ composedPath: reversed });
  assert.deepEqual(a, b, "shuffling the input array must not change which candidate is chosen");
});

test("priority 3: no editable/actionable candidate anywhere, but one carries stable associatedField + technicalRefs evidence -> resolved via structural evidence", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "span", pathDepth: 0 }),
      candidate({ tag: "div", associatedField: "Monto", technicalRefs: ["cell:row-3:col-amount"], pathDepth: 1 }),
    ],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.reason, "stable_associated_control_evidence");
  assert.equal(result.status === "resolved" && result.owner.associatedField, "Monto");
});

test("priority 3 is never granted from associatedField alone, without groupEvidence or technicalRefs backing it", () => {
  const result = resolveCaptureOwner({
    composedPath: [candidate({ tag: "div", associatedField: "Monto", pathDepth: 0 })],
  });
  assert.equal(result.status, "unresolved", "a bare label-ish hint with no structural backing is not stable evidence");
});

test("certified framework owner: a trusted, visible, unique framework candidate resolves without promoting its img descendant", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "img", pathDepth: 0 }),
      candidate({ tag: "div", pathDepth: 1, trustedClick: true, frameworkActionable: true, frameworkIdentitySufficient: true, visible: true }),
    ],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" && result.owner.tag, "div");
  assert.equal(result.status === "resolved" && result.owner.classification, "actionable");
  assert.equal(result.status === "resolved" && result.reason, "certified_framework_actionable_in_composed_path");
});

for (const [label, owner] of [
  ["missing durable identity", candidate({ tag: "div", pathDepth: 1, trustedClick: true, frameworkActionable: true, frameworkIdentitySufficient: false, visible: true })],
  ["not framework actionable", candidate({ tag: "div", pathDepth: 1, trustedClick: true, frameworkActionable: false, frameworkIdentitySufficient: true, visible: true })],
  ["untrusted click", candidate({ tag: "div", pathDepth: 1, trustedClick: false, frameworkActionable: true, frameworkIdentitySufficient: true, visible: true })],
] as const) {
  test(`certified framework owner fails closed when ${label}`, () => {
    const result = resolveCaptureOwner({ composedPath: [candidate({ tag: "img", pathDepth: 0 }), owner] });
    assert.equal(result.status, "unresolved");
  });
}

test("multiple certified framework candidates fail closed rather than using path depth", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "div", pathDepth: 1, trustedClick: true, frameworkActionable: true, frameworkIdentitySufficient: true, visible: true }),
      candidate({ tag: "div", pathDepth: 7, trustedClick: true, frameworkActionable: true, frameworkIdentitySufficient: true, visible: true }),
    ],
  });
  assert.equal(result.status, "unresolved");
});

test("a distant technical ref without framework actionability cannot certify a decorative image", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({ tag: "img", pathDepth: 0 }),
      candidate({ tag: "div", pathDepth: 8, technicalRefs: ["id:layout-root"], trustedClick: true, frameworkActionable: false, frameworkIdentitySufficient: true, visible: true }),
    ],
  });
  assert.equal(result.status, "unresolved");
});

test("13/rawInteraction. resolveCaptureOwner carries structuralIdentity through onto the resolved owner, untouched", () => {
  const result = resolveCaptureOwner({
    composedPath: [
      candidate({
        tag: "a",
        role: "link",
        actionable: true,
        pathDepth: 0,
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
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" && result.owner.structuralIdentity?.landmarkAncestor?.tag, "main");
});

/**
 * FIRST_LOSS fix (producer-side): `buildOwnerTechnicalEvidence` is the pure function `onClick`
 * (capture-engine-v2.shadow-bridge.ts) now calls to build `CaptureAction.technicalEvidence` from
 * a resolved owner -- reusing the SAME `RecordedTechnicalTarget`/`RecordedLocator` shape the rest
 * of the pipeline (adapter, canonical-recording-contract, target-resolver) already consumes.
 */
function owner(overrides: Partial<CaptureOwner> = {}): CaptureOwner {
  return { tag: "a", role: "link", ...overrides };
}

test("buildOwnerTechnicalEvidence: an owner with no technicalRefs and no structuralIdentity produces no evidence at all -- never a fabricated empty candidate", () => {
  assert.equal(buildOwnerTechnicalEvidence(owner()), undefined);
});

test("buildOwnerTechnicalEvidence: an owner's id: ref becomes an executable css locator (#value), mirroring the existing domId convention", () => {
  const evidence = buildOwnerTechnicalEvidence(owner({ technicalRefs: ["id:solicitud-link"] }));
  assert.ok(evidence);
  assert.deepEqual(evidence!.candidates![0].locatorCandidates, [{ strategy: "css", value: "#solicitud-link", confidence: 0.8 }]);
});

test("buildOwnerTechnicalEvidence: an owner's testid: ref becomes a data-testid locator", () => {
  const evidence = buildOwnerTechnicalEvidence(owner({ technicalRefs: ["testid:submit-btn"] }));
  assert.ok(evidence);
  assert.deepEqual(evidence!.candidates![0].locatorCandidates, [{ strategy: "data-testid", value: "submit-btn", confidence: 0.98 }]);
});

test("buildOwnerTechnicalEvidence: structuralIdentity is carried into structuralContext verbatim, including landmarkAncestor", () => {
  const evidence = buildOwnerTechnicalEvidence(owner({
    structuralIdentity: {
      owner: { tag: "a", role: "link" },
      stableDirectAttributes: { href: "/requests/create/multiproduct" },
      stableDescendants: [],
      semanticShape: [],
      landmarkAncestor: { tag: "main" },
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
    },
  }));
  assert.ok(evidence);
  const structuralContext = evidence!.candidates![0].structuralContext!;
  assert.equal(structuralContext.landmarkAncestor?.tag, "main");
  assert.equal(structuralContext.deterministicStructuralIdentity, true);
  assert.equal(structuralContext.identityAmbiguous, undefined, "never fabricated true when the identity itself never set it");
});

test("buildOwnerTechnicalEvidence: a certified framework owner carries its provenance marker without changing structural authority", () => {
  const evidence = buildOwnerTechnicalEvidence(owner({
    tag: "div",
    structuralIdentity: {
      owner: { tag: "div" }, stableDirectAttributes: {}, stableDescendants: [], semanticShape: [],
      deterministicStructuralIdentity: true, structuralIdentityMatchCount: 1,
    },
  }), "certified_framework_actionable_in_composed_path");
  assert.deepEqual(evidence!.candidates![0].interactionEvidence, ["v2_click_owner", "v2_framework_actionable_owner"]);
  assert.deepEqual(evidence!.candidates![0].structuralContext!.owner, { tag: "div" });
  assert.deepEqual(evidence!.candidates![0].locatorCandidates, []);
});

test("buildOwnerTechnicalEvidence: an ambiguous structuralIdentity is preserved as identityAmbiguous=true -- never silently dropped", () => {
  const evidence = buildOwnerTechnicalEvidence(owner({
    structuralIdentity: {
      owner: { tag: "a", role: "link" },
      stableDirectAttributes: { href: "/same" },
      stableDescendants: [],
      semanticShape: [],
      deterministicStructuralIdentity: false,
      identityAmbiguous: true,
      structuralIdentityMatchCount: 2,
    },
  }));
  assert.ok(evidence);
  assert.equal(evidence!.candidates![0].structuralContext!.identityAmbiguous, true);
  assert.equal(evidence!.candidates![0].structuralContext!.structuralIdentityMatchCount, 2);
});

test("buildOwnerTechnicalEvidence: an unsupported ref strategy is passed through unchanged, never dropped or guessed", () => {
  const evidence = buildOwnerTechnicalEvidence(owner({ technicalRefs: ["role:link|Depurar"] }));
  assert.ok(evidence);
  assert.deepEqual(evidence!.candidates![0].locatorCandidates, [{ strategy: "role", value: "link|Depurar", confidence: 0.7 }]);
});
