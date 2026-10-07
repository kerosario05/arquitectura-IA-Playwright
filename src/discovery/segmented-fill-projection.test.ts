import assert from "node:assert/strict";
import test from "node:test";
import { isCompatibleSegmentValue, isMaskedSegmentValue, isProjectableFirstSegment, isSingleSegmentOrMask } from "./segmented-fill-projection";

test("accepts a redacted segmented-field mask as a projection token", () => {
  assert.equal(isMaskedSegmentValue("••••••"), true);
  assert.equal(isSingleSegmentOrMask("••••••"), true);
  assert.equal(isSingleSegmentOrMask("4"), true);
  assert.equal(isCompatibleSegmentValue("••••••", "••••••"), true);
  assert.equal(isCompatibleSegmentValue("••••••", "•••••"), false);
  assert.equal(isCompatibleSegmentValue("•••••", "••••••"), false);
  assert.equal(isProjectableFirstSegment("••••••", "test_data"), true);
  assert.equal(isProjectableFirstSegment("123456", "test_data"), false);
});

test("does not treat ordinary multi-character values as one segmented token", () => {
  assert.equal(isMaskedSegmentValue("123456"), false);
  assert.equal(isSingleSegmentOrMask("123456"), false);
  assert.equal(isSingleSegmentOrMask(""), false);
  assert.equal(isCompatibleSegmentValue("5", "4"), true);
  assert.equal(isCompatibleSegmentValue("12", "4"), false);
  assert.equal(isProjectableFirstSegment("4", "literal"), true);
  assert.equal(isProjectableFirstSegment("4", "test_data"), false);
});
