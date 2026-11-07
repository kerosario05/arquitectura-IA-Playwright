import assert from "node:assert/strict";
import test from "node:test";
import { samePageSurface, shouldClearActiveContainer } from "./active-container-surface";

test("retains a form scope across query-only changes on the same page", () => {
  assert.equal(
    samePageSurface("https://qa.example.test/Transfer/Form?tab=one", "https://qa.example.test/Transfer/Form?tab=two"),
    true,
  );
});

test("invalidates a form scope when navigation changes the page surface", () => {
  assert.equal(
    samePageSurface("https://qa.example.test/onlinebanking/IdentifyUser", "https://qa.example.test/onlinebanking/QueryBank/Summary"),
    false,
  );
  assert.equal(
    samePageSurface("https://qa.example.test/Transfer/Form", "https://other.example.test/Transfer/Form"),
    false,
  );
  assert.equal(
    samePageSurface("https://qa.example.test/Transfer/Form#origin", "https://qa.example.test/Transfer/Form#destination"),
    false,
  );
});

test("clears the stale active form before resolving the next page's field", () => {
  assert.equal(
    shouldClearActiveContainer("https://qa.example.test/onlinebanking/IdentifyUser", "https://qa.example.test/onlinebanking/QueryBank/Summary"),
    true,
  );
  assert.equal(
    shouldClearActiveContainer("https://qa.example.test/Transfer/Form", "https://qa.example.test/Transfer/Form?step=amount"),
    false,
  );
  assert.equal(shouldClearActiveContainer(undefined, "https://qa.example.test/Transfer/Form"), false);
});
