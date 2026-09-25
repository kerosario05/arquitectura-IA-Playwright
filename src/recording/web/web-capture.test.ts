import assert from "node:assert";
import { buildWebLocators, isSensitiveField, preserveCapturedTechnicalTargetLocators } from "./web-session-recorder";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

describe("buildWebLocators", () => {
  test("keeps a structural candidate for an unlabeled editable compound child", () => {
    const locators = buildWebLocators({
      kind: "input",
      label: "",
      compoundRole: "amount_or_text",
      gridRef: "grid:runtime",
      rowRef: "row:runtime",
      cellRef: "cell:runtime",
      headerRef: "header:measure",
      technicalTargetCandidates: [{
        targetType: "editable",
        semanticRole: "amount_or_text",
        locatorCandidates: [{ strategy: "structural", value: "grid=grid:runtime|row=row:runtime|cell=cell:runtime|header=header:measure|role=amount_or_text", confidence: 0.72 }],
        interactionEvidence: ["input"],
        confidence: 0.9,
        validatedByInteraction: true,
      }],
    } as never);
    assert.equal(locators.some((locator) => locator.strategy === "structural"), true);
    assert.equal(locators.some((locator) => /nth|first|coordinate/i.test(locator.value)), false);
  });

  test("keeps the strongest identity when the page says it is unique", () => {
    const locators = buildWebLocators({
      kind: "click",
      label: "Continuar",
      testId: "continue-btn",
      text: "Continuar",
      ranks: { testId: { count: 1, index: 0 }, text: { count: 1, index: 0 } },
    } as never);
    assert.deepStrictEqual(locators[0], { strategy: "data-testid", value: "continue-btn", confidence: 0.98 });
  });

  // Measured in a real browser: two buttons carrying the same aria-label, where only the
  // visible text tells them apart. The shared identity must not win.
  test("demotes an identity shared with other elements below a unique one", () => {
    const locators = buildWebLocators({
      kind: "click",
      label: "Enviar código de validación",
      ariaLabel: "Enviar código de validación",
      text: "Teléfono",
      ranks: { ariaLabel: { count: 2, index: 1 }, text: { count: 1, index: 0 } },
    } as never);
    assert.strictEqual(locators[0].strategy, "text");
    assert.strictEqual(locators[0].value, "Teléfono");
    const shared = locators.find((l) => l.strategy === "aria-label");
    assert.strictEqual(shared?.ambiguous, true);
    assert.strictEqual(shared?.matchIndex, 1);
  });

  test("marks the step uncertain when every identity is shared", () => {
    const locators = buildWebLocators({
      kind: "click",
      label: "Ver",
      ariaLabel: "Ver",
      text: "Ver",
      ranks: { ariaLabel: { count: 4, index: 2 }, text: { count: 4, index: 2 } },
    } as never);
    assert.ok(locators.every((l) => l.ambiguous === true));
    // Below the 0.7 the scenario builder uses to flag a step as uncertain.
    assert.ok((locators[0].confidence ?? 1) < 0.7);
  });

  test("falls back to the plain ranking when the page reported no measurements", () => {
    const locators = buildWebLocators({
      kind: "click",
      label: "Salir",
      ariaLabel: "Salir",
      text: "Salir",
    } as never);
    assert.strictEqual(locators[0].strategy, "aria-label");
    assert.strictEqual(locators[0].confidence, 0.9);
    assert.ok(locators.every((l) => l.ambiguous === undefined));
  });
});

describe("isSensitiveField", () => {
  test("a password input is sensitive regardless of its label", () => {
    assert.strictEqual(isSensitiveField({ kind: "input", label: "", inputType: "password" } as never), true);
  });

  test("an OTP field is caught by its label", () => {
    assert.strictEqual(isSensitiveField({ kind: "input", label: "Código OTP" } as never), true);
  });

  test("an ordinary field is not", () => {
    assert.strictEqual(isSensitiveField({ kind: "input", label: "Usuario" } as never), false);
  });
});

describe("preserveCapturedTechnicalTargetLocators", () => {
  const target = {
    targetType: "display" as const,
    semanticRole: "display" as never,
    locatorCandidates: [],
    structuralContext: { headerRef: "header:control" },
    stableAttributes: {},
    interactionEvidence: ["click"],
    confidence: 0.45,
    validatedByInteraction: true,
  };
  const captured = [{ strategy: "role", value: "button|control", confidence: 0.85 }];

  test("transports captured locator identity into the sole technical target", () => {
    const [hydrated] = preserveCapturedTechnicalTargetLocators([target], captured) ?? [];
    assert.deepEqual(hydrated?.locatorCandidates, captured);
  });

  test("does not overwrite an existing technical locator candidate", () => {
    const existing = { ...target, locatorCandidates: [{ strategy: "data-testid", value: "control", confidence: 0.98 }] };
    const [preserved] = preserveCapturedTechnicalTargetLocators([existing], captured) ?? [];
    assert.deepEqual(preserved?.locatorCandidates, existing.locatorCandidates);
  });

  test("does not attach one locator identity to multiple technical targets", () => {
    const result = preserveCapturedTechnicalTargetLocators([target, { ...target }], captured);
    assert.deepEqual(result?.map((candidate) => candidate.locatorCandidates), [[], []]);
  });
});
