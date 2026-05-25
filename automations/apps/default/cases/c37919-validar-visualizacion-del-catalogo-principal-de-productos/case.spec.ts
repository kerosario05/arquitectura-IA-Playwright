import { test } from '@playwright/test';

import { ProductDetailPage } from '../../pages/productdetail.page';

test('Validar visualización del catálogo principal de productos', async ({ page }) => {

  const productDetailPage = new ProductDetailPage(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await productDetailPage.expectLoaded(); // candidate method
  // [candidate] assertText Phones
  await productDetailPage.expectLoaded(); // candidate method
  // [candidate] assertText Laptops
  await productDetailPage.expectLoaded(); // candidate method
  // [candidate] assertText Monitors
});