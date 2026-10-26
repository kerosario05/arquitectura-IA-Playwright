import { describe, expect, it } from "vitest";
import { TestRailApiError } from "../../clients/testrail.client";
import { isAmbiguousAddCaseFailure } from "./testrail-case-publisher";

describe("TestRail add_case ambiguous write failures", () => {
  it("treats a 502 gateway response as an ambiguous write", () => {
    expect(isAmbiguousAddCaseFailure(new TestRailApiError("Invalid JSON response from TestRail (HTTP 502) at add_case/4755.", 502))).toBe(true);
  });

  it("does not classify a definitive client error as ambiguous", () => {
    expect(isAmbiguousAddCaseFailure(new TestRailApiError("TestRail API error (HTTP 400) at add_case/4755: invalid case.", 400))).toBe(false);
  });

  it("treats a transport failure as ambiguous because the server may have committed", () => {
    expect(isAmbiguousAddCaseFailure(new Error("TestRail request failed: socket closed"))).toBe(true);
  });
});
