import { test, expect } from "@playwright/test";
import { disambiguateStructuredTargetCandidates } from "../src/discovery/target-resolver";

const base = {
  visible: true,
  enabled: true,
  clickable: true,
  technicalIdentity: "role:button|Guardar",
  surfaceIdentity: "form:employee",
};

test.describe("structured target disambiguation", () => {
  test("rejects same text when candidates belong to different surfaces", () => {
    const result = disambiguateStructuredTargetCandidates([
      { id: "main", ...base, surfaceIdentity: "form:employee" },
      { id: "dialog", ...base, surfaceIdentity: "dialog:confirmation" },
    ], { technicalIdentity: base.technicalIdentity, surfaceIdentity: "form:employee" });

    expect(result.status).toBe("resolved");
    expect(result.candidate?.id).toBe("main");
  });

  test("ignores hidden and disabled candidates", () => {
    const result = disambiguateStructuredTargetCandidates([
      { id: "hidden", ...base, visible: false },
      { id: "disabled", ...base, enabled: false },
      { id: "visible", ...base },
    ], { technicalIdentity: base.technicalIdentity, surfaceIdentity: base.surfaceIdentity });

    expect(result.status).toBe("resolved");
    expect(result.candidate?.id).toBe("visible");
  });

  test("does not choose between equivalent visible candidates", () => {
    const result = disambiguateStructuredTargetCandidates([
      { id: "one", ...base },
      { id: "two", ...base },
    ], { technicalIdentity: base.technicalIdentity, surfaceIdentity: base.surfaceIdentity });

    expect(result.status).toBe("ambiguous");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["one", "two"]);
  });

  test("returns not_found when the recorded target is not on the current surface", () => {
    const result = disambiguateStructuredTargetCandidates([
      { id: "other-surface", ...base, surfaceIdentity: "route:other" },
    ], { technicalIdentity: base.technicalIdentity, surfaceIdentity: base.surfaceIdentity });

    expect(result.status).toBe("not_found");
  });

  test("resolves an exact recorded technical identity after rediscovery", () => {
    const result = disambiguateStructuredTargetCandidates([
      { id: "rediscovered", ...base, technicalIdentity: "role:button|Guardar" },
    ], { technicalIdentity: "role:button|Guardar", surfaceIdentity: "form:employee" });

    expect(result.status).toBe("resolved");
    expect(result.candidate?.id).toBe("rediscovered");
  });
});
