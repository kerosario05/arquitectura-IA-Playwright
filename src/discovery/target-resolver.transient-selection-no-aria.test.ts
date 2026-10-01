import assert from "node:assert/strict";
import test from "node:test";
import { isTransientSelectionOptionCausallyBound } from "./target-resolver";

const option = { strategy: "role", value: "option|Recorded option", confidence: 1 };
const authority = {
  runtimeExactOptionUnique: true,
  recordedSurfaceCompatible: true,
  applicationOwnershipMatched: true,
  appearedAfterOwnerAction: true,
};

test("recorded field lineage binds an exact option when the unique owner has no ARIA controls/owns IDs", async () => {
  let evaluateCalls = 0;
  const ownerLocator = {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    evaluate: async () => ({ controls: [], owns: [] }),
  };
  const page = {
    locator: () => ownerLocator,
    getByRole: () => ({ count: async () => 0, isVisible: async () => false, isEnabled: async () => true }),
    getByTestId: () => ({ count: async () => 0, isVisible: async () => false, isEnabled: async () => true }),
    url: () => "https://example.test/records/edit",
    evaluate: async (_fn: unknown, arg?: unknown) => {
      if (arg !== undefined) return [];
      evaluateCalls += 1;
      if (evaluateCalls === 1) {
        return {
          ids: [], activeHasControls: false, activeHasOwns: false,
          expandedOwnerCount: 0, expandedOwnersWithControls: 0, expandedOwnersWithOwns: 0,
        };
      }
      return {
        candidates: [{ tag: "button", role: "button", actionable: true, visible: true, disabled: false, stableDirectAttributes: { id: "owner-trigger" } }],
        diagnostics: {
          textAnchorMatchCount: 1, semanticLabelMatchCount: 1, ariaRelationMatchCount: 0, leafAnchorMatchCount: 1,
          anchorFound: true, anchorTag: "label", ancestorsInspected: 0, ancestorTrace: [], containerAccepted: true,
        },
      };
    },
  } as any;

  const result = await isTransientSelectionOptionCausallyBound(page, option, "Owner field", authority);
  assert.equal(result, true);
});
