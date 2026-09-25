import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerTechnicalEvidence } from "./capture-engine-v2.action-owner-resolver";
import { adaptCaptureActionToRawInteraction } from "./capture-engine-v2.raw-interaction-adapter";
import { classifyNativeRoleIdentity } from "./capture-engine-v2.native-role-identity";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";
import { buildHappyPathScenario } from "./trace-to-scenario";
import { buildWebLocators } from "./web/web-session-recorder";

test("simple native text remains a certified exact role identity", () => {
  const identity = classifyNativeRoleIdentity({ tag: "button", textContent: "Continue" });
  assert.equal(identity.contentKind, "simple_native_text");
  assert.equal(identity.technicalRoleName, "Continue");
  assert.equal(identity.roleTechnicalIdentityEligible, true);
});

test("explicit accessibility identity remains the role authority", () => {
  const identity = classifyNativeRoleIdentity({
    tag: "button",
    explicitName: "Accessible action",
    textContent: "Nested display content",
    semanticFragments: ["Nested display content", "Supporting description"],
  });
  assert.equal(identity.contentKind, "explicit_accessibility_name");
  assert.equal(identity.technicalRoleName, "Accessible action");
  assert.equal(identity.displayName, "Accessible action");
});

test("compound native content preserves a unique heading only as display identity", () => {
  const identity = classifyNativeRoleIdentity({
    tag: "button",
    textContent: "Primary actionSupporting description",
    semanticFragments: ["Primary action", "Supporting description"],
    headingFragments: ["Primary action"],
  });
  assert.equal(identity.contentKind, "compound_native_content");
  assert.equal(identity.displayName, "Primary action");
  assert.equal(identity.technicalRoleName, undefined);
  assert.equal(identity.roleTechnicalIdentityEligible, false);
});

test("compound structural owner uses one semantic heading for display only, never a technical role name", () => {
  const identity = classifyNativeRoleIdentity({
    tag: "div",
    textContent: "Primary cardSupporting description",
    semanticFragments: ["Primary card", "Supporting description"],
    headingFragments: ["Primary card"],
  });
  assert.equal(identity.contentKind, "compound_structural_content");
  assert.equal(identity.displayName, "Primary card");
  assert.equal(identity.technicalRoleName, undefined);
  assert.equal(identity.roleTechnicalIdentityEligible, false);
});

test("structural owner retains its unique heading as display when supporting copy is not a semantic fragment", () => {
  const identity = classifyNativeRoleIdentity({
    tag: "div",
    textContent: "Primary cardSupporting copy in a generic wrapper",
    semanticFragments: ["Primary card"],
    headingFragments: ["Primary card"],
  });
  assert.equal(identity.contentKind, "compound_structural_content");
  assert.equal(identity.displayName, "Primary card");
  assert.equal(identity.technicalRoleName, undefined);
  assert.equal(identity.roleTechnicalIdentityEligible, false);
});

test("multiple structural headings remain conservative; no primary heading is chosen by position", () => {
  const identity = classifyNativeRoleIdentity({
    tag: "div",
    textContent: "First headingSecond headingSupporting description",
    semanticFragments: ["First heading", "Second heading", "Supporting description"],
    headingFragments: ["First heading", "Second heading"],
  });
  assert.equal(identity.displayName, "First headingSecond headingSupporting description");
  assert.equal(identity.technicalRoleName, undefined);
  assert.equal(identity.roleTechnicalIdentityEligible, undefined);
});

test("paragraph-only structural content keeps the existing display fallback", () => {
  const identity = classifyNativeRoleIdentity({
    tag: "div",
    textContent: "Supporting description only",
    semanticFragments: ["Supporting description only"],
    headingFragments: [],
  });
  assert.equal(identity.displayName, "Supporting description only");
  assert.equal(identity.technicalRoleName, undefined);
  assert.equal(identity.roleTechnicalIdentityEligible, undefined);
});

test("structural compound display is transported without changing structural runtime authority", () => {
  const identity = classifyNativeRoleIdentity({
    tag: "div",
    textContent: "Primary cardSupporting description",
    semanticFragments: ["Primary card", "Supporting description"],
    headingFragments: ["Primary card"],
  });
  const structuralIdentity = {
    owner: { tag: "div" },
    stableDirectAttributes: {},
    stableDescendants: [{ relation: "descendant" as const, tag: "img", stableAttributes: { alt: "stable-image-identity" } }],
    semanticShape: ["div", "h3"],
    deterministicStructuralIdentity: true,
    structuralIdentityMatchCount: 1,
  };
  const technicalEvidence = buildOwnerTechnicalEvidence({
    tag: "div",
    accessibleName: identity.displayName,
    roleTechnicalIdentityEligible: identity.roleTechnicalIdentityEligible,
    structuralIdentity,
  });
  const raw = adaptCaptureActionToRawInteraction({
    actionType: "click",
    identity: { label: identity.displayName, tagName: "div" },
    owner: { tag: "div", accessibleName: identity.displayName, roleTechnicalIdentityEligible: identity.roleTechnicalIdentityEligible },
    technicalEvidence,
  });
  assert.equal(raw.label, "Primary card");
  assert.equal(raw.technicalRoleName, undefined);
  assert.deepEqual(raw.technicalTargetCandidates?.[0].structuralContext, structuralIdentity);
});

test("unique structural heading stays display-only through canonical and scenario projection", () => {
  const identity = classifyNativeRoleIdentity({
    tag: "div",
    textContent: "Primary cardSupporting copy in a generic wrapper",
    semanticFragments: ["Primary card"],
    headingFragments: ["Primary card"],
  });
  const structuralIdentity = {
    owner: { tag: "div" },
    stableDirectAttributes: {},
    stableDescendants: [{ relation: "descendant" as const, tag: "img", stableAttributes: { alt: "Primary card" } }],
    semanticShape: ["div", "h3"],
    deterministicStructuralIdentity: true,
    structuralIdentityMatchCount: 1,
  };
  const technicalEvidence = buildOwnerTechnicalEvidence({ tag: "div", accessibleName: identity.displayName, structuralIdentity }, "certified_framework_actionable_in_composed_path");
  const raw = adaptCaptureActionToRawInteraction({
    actionType: "click",
    identity: { label: identity.displayName, tagName: "div" },
    owner: { tag: "div", accessibleName: identity.displayName, structuralIdentity },
    technicalEvidence,
  });
  const event = { seq: 0, t: 1, kind: "tap", screenKey: "screen", url: "https://fixture.test", target: {
    label: raw.label, tag: raw.tagName, locators: [], technicalTargetCandidates: raw.technicalTargetCandidates,
  } } as RecordedEvent;
  const trace = { recordingId: "recording", projectSlug: "project", appSlug: "app", platform: "web", baseUrl: "https://fixture.test", startedAt: new Date().toISOString(), status: "completed", events: [event], screens: [{ screenKey: "screen", url: "https://fixture.test" }] } as SessionTrace;

  assert.equal(buildCanonicalInteractions([event])[0].semanticField, "Primary card");
  assert.ok(buildHappyPathScenario(trace, [event]).testRailSteps.some((step) => step.content === 'Presionar "Primary card"'));
  assert.deepEqual(event.target?.technicalTargetCandidates, raw.technicalTargetCandidates);
});

test("compound Capture V2 action does not fabricate a role ref and retains structural evidence", () => {
  const identity = classifyNativeRoleIdentity({
    tag: "button",
    textContent: "Primary actionSupporting description",
    semanticFragments: ["Primary action", "Supporting description"],
    headingFragments: ["Primary action"],
  });
  const technicalEvidence = buildOwnerTechnicalEvidence({
    tag: "button",
    role: "button",
    accessibleName: identity.displayName,
    roleTechnicalIdentityEligible: identity.roleTechnicalIdentityEligible,
    structuralIdentity: {
      owner: { tag: "button" },
      stableDirectAttributes: { "data-testid": "action-owner" },
      stableDescendants: [],
      semanticShape: ["h3", "p"],
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
    },
  });
  assert.ok(technicalEvidence?.candidates[0].structuralContext);

  const raw = adaptCaptureActionToRawInteraction({
    actionType: "click",
    identity: { label: identity.displayName, role: "button", tagName: "button" },
    owner: {
      tag: "button",
      role: "button",
      accessibleName: identity.displayName,
      roleTechnicalIdentityEligible: identity.roleTechnicalIdentityEligible,
    },
    technicalEvidence,
  });
  const locators = buildWebLocators(raw as any);
  assert.equal(locators.some((locator) => locator.strategy === "role"), false);
  assert.equal(raw.technicalTargetCandidates?.[0].structuralContext?.deterministicStructuralIdentity, true);
});

test("nested icon plus one text identity stays simple", () => {
  const identity = classifyNativeRoleIdentity({ tag: "button", textContent: "Save", semanticFragments: [] });
  assert.equal(identity.contentKind, "simple_native_text");
  assert.equal(identity.technicalRoleName, "Save");
});
