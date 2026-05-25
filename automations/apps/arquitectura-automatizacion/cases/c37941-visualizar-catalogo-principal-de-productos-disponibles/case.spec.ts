import { test } from '@playwright/test';

import { ProductDetailPage } from '../../pages/productdetail.page';
import { CategoryPage } from '../../pages/category.page';

test('Visualizar catálogo principal de productos disponibles', async ({ page }) => {

  const productDetailPage = new ProductDetailPage(page);
  const categoryPage = new CategoryPage(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await productDetailPage.expectLoaded(); // [target: Phones]
  await productDetailPage.expectLoaded(); // [target: Laptops]
  await productDetailPage.expectLoaded(); // [target: Monitors]
  await categoryPage.selectCategory('Categoría "Phones" visible.');
  await categoryPage.selectCategory('Categoría "Laptops" visible.');
  await categoryPage.selectCategory('Categoría "Monitors" visible.');
});