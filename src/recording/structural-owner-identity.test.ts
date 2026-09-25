import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeStructuralOwnerIdentity } from "./structural-owner-identity";

describe("structural owner identity", () => {
  it("uses direct stable attributes without depending on visible text or utility classes", () => {
    const identity = normalizeStructuralOwnerIdentity({
      ownerTag: "DIV",
      stableDirectAttributes: { class: "cursor-pointer", "data-testid": "card-a" },
      semanticShape: ["SPAN", "IMG"],
    });

    assert.deepEqual(identity.stableDirectAttributes, { "data-testid": "card-a" });
    assert.equal(identity.deterministicStructuralIdentity, true);
    assert.deepEqual(identity.owner, { tag: "div" });
  });

  it("captures a stable descendant as structural evidence", () => {
    const identity = normalizeStructuralOwnerIdentity({
      ownerTag: "div",
      stableDescendants: [{
        relation: "descendant",
        tag: "img",
        stableAttributes: { alt: "product-a", src: "/assets/a.svg" },
      }],
      semanticShape: ["img", "span"],
      structuralIdentityMatchCount: 1,
    });

    assert.equal(identity.deterministicStructuralIdentity, true);
    assert.equal(identity.stableDescendants[0]?.tag, "img");
    assert.equal(identity.structuralIdentityMatchCount, 1);
  });

  it("marks repeated structural identities ambiguous", () => {
    const identity = normalizeStructuralOwnerIdentity({
      ownerTag: "div",
      stableDescendants: [{ relation: "descendant", tag: "img", stableAttributes: { alt: "same" } }],
      structuralIdentityMatchCount: 2,
    });

    assert.equal(identity.deterministicStructuralIdentity, false);
    assert.equal(identity.identityAmbiguous, true);
  });

  it("does not promote text-only or class-only evidence", () => {
    const identity = normalizeStructuralOwnerIdentity({
      ownerTag: "div",
      semanticShape: ["span"],
    });

    assert.deepEqual(identity.stableDirectAttributes, {});
    assert.deepEqual(identity.stableDescendants, []);
    assert.equal(identity.deterministicStructuralIdentity, false);
  });

  it("normalizes attribute and descendant ordering deterministically", () => {
    const left = normalizeStructuralOwnerIdentity({
      ownerTag: "DIV",
      stableDirectAttributes: { name: "item", id: "item-a" },
      stableDescendants: [
        { relation: "descendant", tag: "SPAN", stableAttributes: { "data-field": "amount" } },
        { relation: "descendant", tag: "IMG", stableAttributes: { alt: "item" } },
      ],
      semanticShape: ["span", "img"],
    });
    const right = normalizeStructuralOwnerIdentity({
      ownerTag: "div",
      stableDirectAttributes: { id: "item-a", name: "item" },
      stableDescendants: [
        { relation: "descendant", tag: "img", stableAttributes: { alt: "item" } },
        { relation: "descendant", tag: "span", stableAttributes: { "data-field": "amount" } },
      ],
      semanticShape: ["img", "span"],
    });

    assert.deepEqual(left, right);
  });

  /**
   * FIRST_LOSS: two owners can be structurally identical at the OWNER level (same tag, same
   * stable attributes, same descendants -- e.g. a sidebar link and a content-card link sharing
   * the same accessible name and href) while living in different, individually stable PARTS of
   * the page (nav vs main). Without a landmark discriminator, both get the same identity and
   * therefore the same match count, marking BOTH ambiguous even though each is individually a
   * perfectly stable, uniquely-locatable owner within its own landmark.
   */
  it("2/cardVsSidebar + 3/sidebarVsCard. normalizes a landmark ancestor, lowercased, as part of the identity", () => {
    const card = normalizeStructuralOwnerIdentity({
      ownerTag: "a",
      stableDirectAttributes: { href: "/requests/create/multiproduct" },
      landmarkAncestor: { tag: "MAIN" },
    });
    const sidebar = normalizeStructuralOwnerIdentity({
      ownerTag: "a",
      stableDirectAttributes: { href: "/requests/create/multiproduct" },
      landmarkAncestor: { tag: "NAV" },
    });
    assert.deepEqual(card.landmarkAncestor, { tag: "main" });
    assert.deepEqual(sidebar.landmarkAncestor, { tag: "nav" });
    assert.notDeepEqual(card, sidebar, "identical owner + different landmark must never normalize to the same identity");
  });

  it("1/exactOwner. an owner with no landmark ancestor at all is unaffected -- resolves exactly as before", () => {
    const identity = normalizeStructuralOwnerIdentity({
      ownerTag: "button",
      stableDirectAttributes: { "data-testid": "submit" },
    });
    assert.equal(identity.landmarkAncestor, undefined);
  });

  it("4/sameNameSameHrefAmbiguous precondition: the SAME landmark for both owners still marks them ambiguous when the match count says so -- landmark alone never fabricates uniqueness", () => {
    const identity = normalizeStructuralOwnerIdentity({
      ownerTag: "a",
      stableDirectAttributes: { href: "/same" },
      landmarkAncestor: { tag: "main" },
      structuralIdentityMatchCount: 2,
    });
    assert.equal(identity.identityAmbiguous, true);
    assert.equal(identity.deterministicStructuralIdentity, false);
  });

  it("15/multiproject. landmark role is preserved and normalized alongside tag, for any generic landmark shape", () => {
    const identity = normalizeStructuralOwnerIdentity({
      ownerTag: "div",
      stableDirectAttributes: { "data-testid": "x" },
      landmarkAncestor: { tag: "DIV", role: "NAVIGATION" },
    });
    assert.deepEqual(identity.landmarkAncestor, { tag: "div", role: "navigation" });
  });
});
