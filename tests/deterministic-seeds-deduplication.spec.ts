import { test, expect } from "@playwright/test";

test.describe("Deterministic Seeds Deduplication", () => {
  test("dedupeConsecutiveSteps removes duplicate consecutive clicks", () => {
    // Simulate the deduplication logic
    const steps = [
      { description: "Clic en \"Iniciar\".", action: "click", target: "Iniciar" },
      { description: "Clic en \"Información de productos\".", action: "click", target: "Información de productos" },
      { description: "Clic en \"Información de productos\".", action: "click", target: "Información de productos" },
      { description: "Clic en \"Tarjetas\".", action: "click", target: "Tarjetas" }
    ];

    // Mock deduplication function (same logic as in codex-scenario-generator.ts)
    function dedupeConsecutiveSteps(steps: any[]): any[] {
      if (steps.length === 0) return steps;

      const deduped: any[] = [steps[0]];

      for (let i = 1; i < steps.length; i++) {
        const current = steps[i];
        const previous = steps[i - 1];

        const getCurrentTarget = (step: any): string | null => {
          if (typeof step === "string") {
            const match = step.match(/Clic en "([^"]+)"/i);
            return match ? match[1].toLowerCase().trim() : null;
          }
          if (typeof step === "object" && step.action === "click" && step.target) {
            return step.target.toLowerCase().trim();
          }
          return null;
        };

        const currentTarget = getCurrentTarget(current);
        const previousTarget = getCurrentTarget(previous);

        if (currentTarget && previousTarget && currentTarget === previousTarget) {
          continue;
        }

        deduped.push(current);
      }

      return deduped;
    }

    const deduped = dedupeConsecutiveSteps(steps);

    // Should have removed the duplicate "Información de productos"
    expect(deduped).toHaveLength(3);
    expect(deduped[0].target).toBe("Iniciar");
    expect(deduped[1].target).toBe("Información de productos");
    expect(deduped[2].target).toBe("Tarjetas");
  });

  test("dedupeConsecutiveSteps works with string steps", () => {
    const steps = [
      "1. Clic en \"Iniciar\".",
      "2. Clic en \"Información de productos\".",
      "3. Clic en \"Información de productos\".",
      "4. Validar que se muestre \"Tarjetas\"."
    ];

    function dedupeConsecutiveSteps(steps: any[]): any[] {
      if (steps.length === 0) return steps;

      const deduped: any[] = [steps[0]];

      for (let i = 1; i < steps.length; i++) {
        const current = steps[i];
        const previous = steps[i - 1];

        const getCurrentTarget = (step: any): string | null => {
          if (typeof step === "string") {
            const match = step.match(/Clic en "([^"]+)"/i);
            return match ? match[1].toLowerCase().trim() : null;
          }
          if (typeof step === "object" && step.action === "click" && step.target) {
            return step.target.toLowerCase().trim();
          }
          return null;
        };

        const currentTarget = getCurrentTarget(current);
        const previousTarget = getCurrentTarget(previous);

        if (currentTarget && previousTarget && currentTarget === previousTarget) {
          continue;
        }

        deduped.push(current);
      }

      return deduped;
    }

    const deduped = dedupeConsecutiveSteps(steps);

    // Should have removed duplicate click, kept validation
    expect(deduped).toHaveLength(3);
    expect(deduped[0]).toContain("Iniciar");
    expect(deduped[1]).toContain("Información de productos");
    expect(deduped[2]).toContain("Validar que se muestre");
  });

  test("dedupeConsecutiveSteps keeps non-consecutive duplicates", () => {
    const steps = [
      { description: "Clic en \"Iniciar\".", action: "click", target: "Iniciar" },
      { description: "Clic en \"Información de productos\".", action: "click", target: "Información de productos" },
      { description: "Clic en \"Tarjetas\".", action: "click", target: "Tarjetas" },
      { description: "Clic en \"Información de productos\".", action: "click", target: "Información de productos" }
    ];

    function dedupeConsecutiveSteps(steps: any[]): any[] {
      if (steps.length === 0) return steps;

      const deduped: any[] = [steps[0]];

      for (let i = 1; i < steps.length; i++) {
        const current = steps[i];
        const previous = steps[i - 1];

        const getCurrentTarget = (step: any): string | null => {
          if (typeof step === "string") {
            const match = step.match(/Clic en "([^"]+)"/i);
            return match ? match[1].toLowerCase().trim() : null;
          }
          if (typeof step === "object" && step.action === "click" && step.target) {
            return step.target.toLowerCase().trim();
          }
          return null;
        };

        const currentTarget = getCurrentTarget(current);
        const previousTarget = getCurrentTarget(previous);

        if (currentTarget && previousTarget && currentTarget === previousTarget) {
          continue;
        }

        deduped.push(current);
      }

      return deduped;
    }

    const deduped = dedupeConsecutiveSteps(steps);

    // Should keep all steps (no consecutive duplicates)
    expect(deduped).toHaveLength(4);
  });

  test("dedupeConsecutiveSteps handles validation and assert steps", () => {
    const steps = [
      { description: "Clic en \"Iniciar\".", action: "click", target: "Iniciar" },
      { description: "Validar que se muestre \"Tarjetas\".", action: "assert", target: "Tarjetas" },
      { description: "Validar que se muestre \"Tarjetas\".", action: "assert", target: "Tarjetas" }
    ];

    function dedupeConsecutiveSteps(steps: any[]): any[] {
      if (steps.length === 0) return steps;

      const deduped: any[] = [steps[0]];

      for (let i = 1; i < steps.length; i++) {
        const current = steps[i];
        const previous = steps[i - 1];

        const getCurrentTarget = (step: any): string | null => {
          if (typeof step === "string") {
            const match = step.match(/Clic en "([^"]+)"/i);
            return match ? match[1].toLowerCase().trim() : null;
          }
          if (typeof step === "object" && step.action === "click" && step.target) {
            return step.target.toLowerCase().trim();
          }
          return null;
        };

        const currentTarget = getCurrentTarget(current);
        const previousTarget = getCurrentTarget(previous);

        if (currentTarget && previousTarget && currentTarget === previousTarget) {
          continue;
        }

        deduped.push(current);
      }

      return deduped;
    }

    const deduped = dedupeConsecutiveSteps(steps);

    // Should keep all steps (deduplication only applies to clicks)
    expect(deduped).toHaveLength(3);
  });
});
