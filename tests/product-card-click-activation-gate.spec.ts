import { test, expect } from "@playwright/test";

test.describe("Product Card Click Resolver - Activation Gate", () => {
  test("should not activate for intermediate navigation step", () => {
    // Simulate case discovery context
    const actionTarget = { target: "Información de productos", index: 2 };
    const detailTarget = "Tarjeta Crédito Visa Clásica";
    const finalProductClickStepIndex = 4;

    const isFinalProductClick = detailTarget && finalProductClickStepIndex === actionTarget.index;
    expect(isFinalProductClick).toBe(false);

    // Product card click should NOT activate because:
    // - isFinalProductClick=false (index 2 !== 4)
    const shouldUseProductCardClick = isFinalProductClick;
    expect(shouldUseProductCardClick).toBe(false);
  });

  test("should not activate for category step", () => {
    // Simulate case discovery context
    const actionTarget = { target: "Tarjetas", index: 3 };
    const detailTarget = "Tarjeta Crédito Visa Clásica";
    const finalProductClickStepIndex = 4;

    const isFinalProductClick = detailTarget && finalProductClickStepIndex === actionTarget.index;
    expect(isFinalProductClick).toBe(false);

    // Product card click should NOT activate
    const shouldUseProductCardClick = isFinalProductClick;
    expect(shouldUseProductCardClick).toBe(false);
  });

  test("should activate for final product click when target matches", () => {
    // Simulate case discovery context
    const actionTarget = { target: "Tarjeta Crédito Visa Clásica", index: 4 };
    const detailTarget = "Tarjeta Crédito Visa Clásica";
    const finalProductClickStepIndex = 4;

    const isFinalProductClick = detailTarget && finalProductClickStepIndex === actionTarget.index;
    expect(isFinalProductClick).toBe(true);

    // Normalize for comparison
    const normalizeForComparison = (s: string) =>
      s.toLowerCase().trim().replace(/[^a-z0-9áéíóúñü]/g, "");

    const targetMatchesDetail = detailTarget && (
      normalizeForComparison(actionTarget.target).includes(normalizeForComparison(detailTarget)) ||
      normalizeForComparison(detailTarget).includes(normalizeForComparison(actionTarget.target))
    );
    expect(targetMatchesDetail).toBe(true);

    // Product card click SHOULD activate
    const shouldUseProductCardClick = isFinalProductClick && targetMatchesDetail;
    expect(shouldUseProductCardClick).toBe(true);
  });

  test("should activate for ordinal selection bound to detail target", () => {
    // Simulate ordinal selection at final step
    const actionTarget = { target: "Seleccionar el primer elemento visible", index: 4 };
    const detailTarget = "Tarjeta Crédito Visa Clásica";
    const finalProductClickStepIndex = 4;
    const locatorStrategy = "ordinal_selection";

    const isFinalProductClick = detailTarget && finalProductClickStepIndex === actionTarget.index;
    expect(isFinalProductClick).toBe(true);

    const isOrdinalBoundToDetail = isFinalProductClick && locatorStrategy === "ordinal_selection";
    expect(isOrdinalBoundToDetail).toBe(true);

    // Product card click SHOULD activate (ordinal at final step)
    const shouldUseProductCardClick = isFinalProductClick && isOrdinalBoundToDetail;
    expect(shouldUseProductCardClick).toBe(true);
  });

  test("should handle exact target match (normalized)", () => {
    // Simulate exact match with different casing/spacing
    const actionTarget = { target: "TARJETA  CRÉDITO   VISA CLÁSICA", index: 4 };
    const detailTarget = "Tarjeta Crédito Visa Clásica";
    const finalProductClickStepIndex = 4;

    const isFinalProductClick = detailTarget && finalProductClickStepIndex === actionTarget.index;
    expect(isFinalProductClick).toBe(true);

    const normalizeForComparison = (s: string) =>
      s.toLowerCase().trim().replace(/[^a-z0-9áéíóúñü]/g, "");

    const targetMatchesDetail = detailTarget && (
      normalizeForComparison(actionTarget.target).includes(normalizeForComparison(detailTarget)) ||
      normalizeForComparison(detailTarget).includes(normalizeForComparison(actionTarget.target))
    );

    // Should match: both normalize to "tarjetacreditovisaclasica"
    expect(targetMatchesDetail).toBe(true);

    const shouldUseProductCardClick = isFinalProductClick && targetMatchesDetail;
    expect(shouldUseProductCardClick).toBe(true);
  });

  test("should not activate when target doesn't match and not ordinal", () => {
    // Wrong target at final step (should not happen, but defensive)
    const actionTarget = { target: "Cuenta de Ahorros", index: 4 };
    const detailTarget = "Tarjeta Crédito Visa Clásica";
    const finalProductClickStepIndex = 4;

    const isFinalProductClick = detailTarget && finalProductClickStepIndex === actionTarget.index;
    expect(isFinalProductClick).toBe(true);

    const normalizeForComparison = (s: string) =>
      s.toLowerCase().trim().replace(/[^a-z0-9áéíóúñü]/g, "");

    const targetMatchesDetail = detailTarget && (
      normalizeForComparison(actionTarget.target).includes(normalizeForComparison(detailTarget)) ||
      normalizeForComparison(detailTarget).includes(normalizeForComparison(actionTarget.target))
    );
    expect(targetMatchesDetail).toBe(false);

    const isOrdinalBoundToDetail = false; // Not ordinal

    // Product card click should NOT activate (wrong target)
    const shouldUseProductCardClick = isFinalProductClick && (targetMatchesDetail || isOrdinalBoundToDetail);
    expect(shouldUseProductCardClick).toBe(false);
  });

  test("flow simulation: steps 1-3 skip, step 4 activates", () => {
    const detailTarget = "Tarjeta Crédito Visa Clásica";
    const finalProductClickStepIndex = 4;

    const steps = [
      { target: "Iniciar", index: 1 },
      { target: "Información de productos", index: 2 },
      { target: "Tarjetas", index: 3 },
      { target: "Tarjeta Crédito Visa Clásica", index: 4 }
    ];

    const normalizeForComparison = (s: string) =>
      s.toLowerCase().trim().replace(/[^a-z0-9áéíóúñü]/g, "");

    steps.forEach((step) => {
      const isFinalProductClick = detailTarget && finalProductClickStepIndex === step.index;

      const targetMatchesDetail = detailTarget && (
        normalizeForComparison(step.target).includes(normalizeForComparison(detailTarget)) ||
        normalizeForComparison(detailTarget).includes(normalizeForComparison(step.target))
      );

      const shouldActivate = isFinalProductClick && targetMatchesDetail;

      if (step.index === 4) {
        expect(shouldActivate).toBe(true); // Only step 4 activates
      } else {
        expect(shouldActivate).toBe(false); // Steps 1-3 don't activate
      }
    });
  });
});
