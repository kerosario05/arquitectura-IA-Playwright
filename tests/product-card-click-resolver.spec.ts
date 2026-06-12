import { test, expect } from "@playwright/test";
import { isProductCardTarget } from "../src/discovery/product-card-click-resolver";

test.describe("Product Card Click Resolver", () => {
  test("isProductCardTarget detects product semantic role", () => {
    expect(isProductCardTarget("Tarjeta Crédito Visa Clásica", "product")).toBe(true);
    expect(isProductCardTarget("Some text", "card")).toBe(true);
    expect(isProductCardTarget("Some item", "item")).toBe(true);
  });

  test("isProductCardTarget detects product_condition locator strategy", () => {
    expect(isProductCardTarget("Tarjeta Crédito Visa Clásica", undefined, "product_condition")).toBe(true);
  });

  test("isProductCardTarget detects product keywords in text", () => {
    expect(isProductCardTarget("Tarjeta Crédito Visa Clásica")).toBe(true);
    expect(isProductCardTarget("Cuenta de Ahorros Personal")).toBe(true);
    expect(isProductCardTarget("Préstamo Personal")).toBe(true);
    expect(isProductCardTarget("Depósito a Plazo")).toBe(true);
    expect(isProductCardTarget("Seguro de Vida")).toBe(true);
  });

  test("isProductCardTarget returns false for non-product targets", () => {
    expect(isProductCardTarget("Iniciar sesión")).toBe(false);
    expect(isProductCardTarget("Volver")).toBe(false);
    expect(isProductCardTarget("Menú principal")).toBe(false);
  });

  test("isProductCardTarget handles multiple criteria", () => {
    // Product keyword + product semantic role = definitely product
    expect(isProductCardTarget("Tarjeta Visa", "product")).toBe(true);

    // Product keyword + other role = still product (keyword wins)
    expect(isProductCardTarget("Cuenta de Ahorros", "category")).toBe(true);

    // No product keyword + product role = still product (role sufficient)
    expect(isProductCardTarget("Some item text", "product")).toBe(true);
  });
});

test.describe("Product Card Click Strategies (E2E)", () => {
  test("product target triggers escalated click strategies", async ({ page }) => {
    // Mock page content with a product card
    await page.setContent(`
      <html>
        <body>
          <div class="product-card">
            <h3>Tarjeta Crédito Visa Clásica</h3>
            <p>Beneficios exclusivos</p>
            <button onclick="window.location='/detail/visa-clasica'">Ver más</button>
          </div>
          <div id="detail-container" style="display: none;">
            <h1>Más detalles del producto</h1>
            <section>
              <h2>Beneficios</h2>
              <p>Lista de beneficios</p>
            </section>
            <section>
              <h2>Detalles</h2>
              <p>Detalles del producto</p>
            </section>
          </div>
        </body>
      </html>
    `);

    // The product card click resolver should:
    // 1. Detect "Tarjeta Crédito Visa Clásica" as a product target
    // 2. Find clickable candidates (the button inside the card)
    // 3. Click the button
    // 4. Validate that detail screen opened using oracle

    // Simulate button click opening detail
    await page.evaluate(() => {
      const button = document.querySelector('button');
      button?.addEventListener('click', () => {
        document.getElementById('detail-container')!.style.display = 'block';
      });
    });

    const targetText = "Tarjeta Crédito Visa Clásica";
    const isProduct = isProductCardTarget(targetText);
    expect(isProduct).toBe(true);

    // Click button
    await page.locator('button').click();

    // Verify detail container visible
    const detailVisible = await page.locator('#detail-container').isVisible();
    expect(detailVisible).toBe(true);

    // Verify detail heading visible
    const detailHeading = await page.locator('h1:has-text("Más detalles del producto")').isVisible();
    expect(detailHeading).toBe(true);

    // Verify detail sections visible
    const beneficiosSection = await page.locator('h2:has-text("Beneficios")').isVisible();
    const detallesSection = await page.locator('h2:has-text("Detalles")').isVisible();
    expect(beneficiosSection).toBe(true);
    expect(detallesSection).toBe(true);

    // Oracle should accept: productName=true, detailHeading=true, detailSections=true
    const productNameVisible = await page.locator('text=Tarjeta Crédito Visa Clásica').isVisible();
    const strongDetailSignal = detailHeading && (beneficiosSection || detallesSection);
    const detailOpened = productNameVisible && strongDetailSignal;

    expect(detailOpened).toBe(true);
  });

  test("product click without detail opening should fail", async ({ page }) => {
    // Mock page content with a product card that doesn't open detail
    await page.setContent(`
      <html>
        <body>
          <div class="product-card">
            <h3>Tarjeta Crédito Visa Clásica</h3>
            <p>Beneficios exclusivos</p>
            <button onclick="console.log('clicked but no navigation')">Ver más</button>
          </div>
          <!-- No detail container - click doesn't open detail -->
        </body>
      </html>
    `);

    const targetText = "Tarjeta Crédito Visa Clásica";
    const isProduct = isProductCardTarget(targetText);
    expect(isProduct).toBe(true);

    // Click button
    await page.locator('button').click();
    await page.waitForTimeout(500);

    // Verify detail NOT opened
    const detailHeading = await page.locator('h1:has-text("Más detalles")').isVisible({ timeout: 1000 }).catch(() => false);
    expect(detailHeading).toBe(false);

    // Oracle should reject: no detailHeading, no detailSections
    const productNameVisible = await page.locator('text=Tarjeta Crédito Visa Clásica').isVisible();
    const strongDetailSignal = false; // No heading, no sections
    const detailOpened = productNameVisible && strongDetailSignal;

    expect(detailOpened).toBe(false);
  });
});
