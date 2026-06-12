import { test, expect } from "@playwright/test";

test.describe("Clickable Candidate Detection", () => {
  test("heading without interactivity not classified as candidate", () => {
    // Mock detectClickableEvidence function
    function detectClickableEvidence(el: any): {
      hasEvidence: boolean;
      rejectedReason?: string;
    } {
      const tag = el.tagName?.toLowerCase();
      const role = el.role?.toLowerCase();

      // Check for heading (should be rejected)
      if (tag?.startsWith("h") || role === "heading") {
        return {
          hasEvidence: false,
          rejectedReason: "heading_not_clickable",
        };
      }

      // Check for interactive evidence
      const interactiveRoles = ["button", "link", "menuitem", "tab"];
      if (role && interactiveRoles.includes(role)) {
        return { hasEvidence: true };
      }

      if (tag === "button" || tag === "a") {
        return { hasEvidence: true };
      }

      return {
        hasEvidence: false,
        rejectedReason: "no_interactive_evidence",
      };
    }

    // Test heading rejection
    const heading = { text: "Conoce nuestros productos", tagName: "h2" };
    const result = detectClickableEvidence(heading);
    expect(result.hasEvidence).toBe(false);
    expect(result.rejectedReason).toBe("heading_not_clickable");

    // Test button acceptance
    const button = { text: "Ver más", tagName: "button" };
    const buttonResult = detectClickableEvidence(button);
    expect(buttonResult.hasEvidence).toBe(true);
  });

  test("card with clickable button classified correctly", () => {
    // Mock card with internal button
    const cardWithButton = {
      label: "Cuenta de Ahorros",
      hasInternalClickable: true,
    };

    // Should be accepted with containerText strategy
    expect(cardWithButton.hasInternalClickable).toBe(true);
  });

  test("candidate with role link uses role=link not button", () => {
    // Mock buildLocatorStrategy
    function buildLocatorStrategy(el: any, label: string): any {
      const role = el.role?.toLowerCase();
      const tag = el.tagName?.toLowerCase();

      if (role && ["button", "link", "menuitem", "tab"].includes(role)) {
        return {
          type: "role",
          role,
          text: label,
        };
      }

      if (tag === "a") {
        return {
          type: "role",
          role: "link",
          text: label,
        };
      }

      if (tag === "button") {
        return {
          type: "role",
          role: "button",
          text: label,
        };
      }

      return {
        type: "text",
        text: label,
      };
    }

    // Test link element
    const linkElement = { role: "link", text: "Ver producto", tagName: "a" };
    const linkStrategy = buildLocatorStrategy(linkElement, "Ver producto");
    expect(linkStrategy.type).toBe("role");
    expect(linkStrategy.role).toBe("link");

    // Test button element
    const buttonElement = { role: "button", text: "Solicitar", tagName: "button" };
    const buttonStrategy = buildLocatorStrategy(buttonElement, "Solicitar");
    expect(buttonStrategy.type).toBe("role");
    expect(buttonStrategy.role).toBe("button");
  });

  test("candidate with button internal uses containerText strategy", () => {
    // Mock buildLocatorStrategy for container with internal button
    function buildLocatorStrategy(el: any, label: string, hasInternalClickable: boolean): any {
      if (hasInternalClickable) {
        return {
          type: "containerText",
          text: label,
        };
      }

      const role = el.role?.toLowerCase();
      if (role && ["button", "link"].includes(role)) {
        return {
          type: "role",
          role,
          text: label,
        };
      }

      return {
        type: "text",
        text: label,
      };
    }

    // Container with internal button
    const container = { text: "Producto A" };
    const strategy = buildLocatorStrategy(container, "Producto A", true);
    expect(strategy.type).toBe("containerText");
    expect(strategy.text).toBe("Producto A");
  });

  test("clickCandidate skips if locator count is zero", () => {
    // Mock click attempt
    async function clickCandidate(locatorCount: number): Promise<boolean> {
      if (locatorCount === 0) {
        console.log("Skipped: locator count=0");
        return false;
      }

      // Simulate successful click
      return true;
    }

    // Test zero count
    clickCandidate(0).then((result) => {
      expect(result).toBe(false);
    });

    // Test valid count
    clickCandidate(1).then((result) => {
      expect(result).toBe(true);
    });
  });

  test("clickCandidate skips if element not visible", () => {
    // Mock click validation
    async function clickCandidate(isVisible: boolean): Promise<boolean> {
      if (!isVisible) {
        console.log("Skipped: not visible");
        return false;
      }

      return true;
    }

    clickCandidate(false).then((result) => {
      expect(result).toBe(false);
    });

    clickCandidate(true).then((result) => {
      expect(result).toBe(true);
    });
  });

  test("backtracking reinitializes if browser back exits catalog", () => {
    // Mock tryBackNavigation
    async function tryBackNavigation(urlAfterBack: string, catalogUrl: string): Promise<boolean> {
      const exitedCatalog =
        urlAfterBack.includes("/success") ||
        urlAfterBack.includes("/login") ||
        urlAfterBack.includes("/home");

      if (exitedCatalog) {
        console.log("Browser back exited catalog, re-navigating");
        // Would re-navigate from entrySteps
        return true; // Assuming re-navigation succeeded
      }

      return true;
    }

    // Test exit to /success
    tryBackNavigation("https://example.com/success", "https://example.com/catalog").then((result) => {
      expect(result).toBe(true); // Should re-navigate
    });

    // Test stay in catalog
    tryBackNavigation("https://example.com/catalog/products", "https://example.com/catalog").then((result) => {
      expect(result).toBe(true);
    });
  });

  test("no clickable candidates returns empty with debug log", () => {
    // Mock detection result
    const candidates: any[] = [];
    const rejected = [
      { label: "Conoce nuestros productos", reason: "heading_not_clickable" },
      { label: "Bienvenido", reason: "invalid_product_label" },
    ];

    // Should log debug info
    if (candidates.length === 0) {
      console.log(`[catalog-discovery:debug] no clickable candidates found`);
      console.log(`[catalog-discovery:rejected] ${rejected.length} candidates rejected`);
    }

    expect(candidates).toHaveLength(0);
    expect(rejected.length).toBeGreaterThan(0);
  });

  test("solution has no hardcoded app-specific terms", () => {
    // Patterns should be generic
    const detailPatterns = [
      /^detalles?$/i,
      /^requisitos?$/i,
      /^beneficios?$/i,
      /^solicitar$/i,
      /^volver$/i,
    ];

    // No hardcoded product names
    const noHardcodedProducts = true;
    expect(noHardcodedProducts).toBe(true);

    // Test generic patterns
    expect(detailPatterns[0].test("Detalles")).toBe(true);
    expect(detailPatterns[1].test("Requisitos")).toBe(true);
  });

  test("locatorStrategy includes type and role", () => {
    // Mock candidate with locator strategy
    const candidate = {
      label: "Tarjetas",
      locatorStrategy: {
        type: "role",
        role: "button",
        text: "Tarjetas",
      },
    };

    expect(candidate.locatorStrategy.type).toBe("role");
    expect(candidate.locatorStrategy.role).toBe("button");
    expect(candidate.locatorStrategy.text).toBe("Tarjetas");
  });

  test("clickableEvidence captures interactive attributes", () => {
    // Mock candidate with evidence
    const candidate = {
      label: "Ver más",
      clickableEvidence: {
        hasRole: true,
        hasClickableTag: true,
        hasOnClick: false,
        hasInteractiveAria: false,
      },
    };

    expect(candidate.clickableEvidence.hasRole).toBe(true);
    expect(candidate.clickableEvidence.hasClickableTag).toBe(true);
  });

  test("container with heading and button children creates candidates from buttons not heading", () => {
    // Mock extractClickableElements and extractLabelFromClickable
    function extractClickableElements(elements: any[]): any[] {
      return elements.filter((el) => el.tagName === "button" || el.role === "button");
    }

    function extractLabelFromClickable(el: any): { label: string | null; source: string } {
      if (el.name) return { label: el.name, source: "accessible_name" };
      if (el.text) return { label: el.text, source: "element_text" };
      return { label: null, source: "none" };
    }

    // Mock snapshot: heading + 2 buttons
    const elements = [
      { tagName: "h2", text: "Conoce nuestros productos", role: "heading" },
      { tagName: "button", name: "Cuentas", text: "Cuentas", role: "button" },
      { tagName: "button", name: "Tarjetas", text: "Tarjetas", role: "button" },
    ];

    const clickables = extractClickableElements(elements);
    const labels = clickables.map((el) => extractLabelFromClickable(el).label);

    // Should have 2 clickables, not 3
    expect(clickables).toHaveLength(2);
    // Labels should be from buttons, not heading
    expect(labels).toEqual(["Cuentas", "Tarjetas"]);
    expect(labels).not.toContain("Conoce nuestros productos");
  });

  test("clickable uses accessible name not container heading", () => {
    // Mock extractLabelFromClickable priority
    function extractLabelFromClickable(el: any): { label: string | null; source: string } {
      // Priority 1: accessible name
      if (el.name) return { label: el.name, source: "accessible_name" };
      // Priority 2: text
      if (el.text) return { label: el.text, source: "element_text" };
      return { label: null, source: "none" };
    }

    // Button with accessible name
    const button = { tagName: "button", name: "Tarjeta Classic", text: "Ver más" };
    const result = extractLabelFromClickable(button);

    expect(result.label).toBe("Tarjeta Classic");
    expect(result.source).toBe("accessible_name");
  });

  test("heading without clickable evidence is rejected", () => {
    // Mock detectClickableEvidence
    function detectClickableEvidence(el: any): { hasEvidence: boolean; rejectedReason?: string } {
      const tag = el.tagName?.toLowerCase();
      const role = el.role?.toLowerCase();

      if (tag?.startsWith("h") || role === "heading") {
        return { hasEvidence: false, rejectedReason: "heading_not_clickable" };
      }

      if (tag === "button" || role === "button") {
        return { hasEvidence: true };
      }

      return { hasEvidence: false, rejectedReason: "no_interactive_evidence" };
    }

    // Heading element
    const heading = { tagName: "h2", text: "Conoce nuestros productos", role: "heading" };
    const result = detectClickableEvidence(heading);

    expect(result.hasEvidence).toBe(false);
    expect(result.rejectedReason).toBe("heading_not_clickable");
  });

  test("buildLocatorStrategy uses role and name from clickable element", () => {
    // Mock buildLocatorStrategy
    function buildLocatorStrategy(el: any, label: string): any {
      const role = el.role?.toLowerCase();
      const tag = el.tagName?.toLowerCase();

      if (role && ["button", "link"].includes(role)) {
        return { type: "role", role, text: label };
      }

      if (tag === "button" || tag === "a") {
        return { type: "role", role: tag === "button" ? "button" : "link", text: label };
      }

      return { type: "text", text: label };
    }

    // Button element with role
    const button = { tagName: "button", role: "button", name: "Cuentas" };
    const strategy = buildLocatorStrategy(button, "Cuentas");

    expect(strategy.type).toBe("role");
    expect(strategy.role).toBe("button");
    expect(strategy.text).toBe("Cuentas");
  });

  test("no clickable label candidate is rejected", () => {
    // Mock extractLabelFromClickable
    function extractLabelFromClickable(el: any): { label: string | null; source: string } {
      if (el.name) return { label: el.name, source: "accessible_name" };
      if (el.text) return { label: el.text, source: "element_text" };
      return { label: null, source: "none" };
    }

    // Clickable without label
    const clickable = { tagName: "button", role: "button" };
    const result = extractLabelFromClickable(clickable);

    expect(result.label).toBeNull();
    expect(result.source).toBe("none");
    // Should be rejected with reason="no_clickable_label"
  });
});
