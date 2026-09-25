import { describe, expect, it } from "vitest";
import { PAGE_LOADING_STATE_PREDICATE } from "./loading-state-detector";

describe("pageHasNoVisibleLoadingIndicator", () => {
  it("uses visible loading signals instead of arbitrary body copy", () => {
    const source = PAGE_LOADING_STATE_PREDICATE;
    expect(source).toContain("aria-busy");
    expect(source).toContain("getBoundingClientRect");
    expect(source).not.toContain("document.body.textContent");
  });
});
