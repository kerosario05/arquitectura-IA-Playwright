import { test } from '@playwright/test';

import { ProductDetailPage } from '../../pages/productdetail.page';

test('Visualizar catálogo principal de productos disponibles', async ({ page }) => {

  const productDetailPage = new ProductDetailPage(page);

  await productDetailPage.expectLoaded(); // candidate method
  // [candidate] assertText Phones
  await productDetailPage.expectLoaded(); // candidate method
  // [candidate] assertText Laptops
  await productDetailPage.expectLoaded(); // candidate method
  // [candidate] assertText Monitors
  await productDetailPage.expectLoaded(); // candidate method
  // [candidate] assertText Categorías visibles: Phones, Laptops y Monitors.
});