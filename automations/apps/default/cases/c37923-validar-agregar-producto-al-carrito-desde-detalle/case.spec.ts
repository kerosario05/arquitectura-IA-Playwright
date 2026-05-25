import { test } from '@playwright/test';

import { CategoryPage } from '../../pages/category.page';
import { ProductDetailPage } from '../../pages/productdetail.page';
import { ProductListPage } from '../../pages/productlist.page';

test('Validar agregar producto al carrito desde detalle', async ({ page }) => {

  const categoryPage = new CategoryPage(page);
  const productDetailPage = new ProductDetailPage(page);
  const productListPage = new ProductListPage(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await categoryPage.selectCategory('Phones');
  await productDetailPage.expectLoaded(); // candidate method
  // [candidate] click la primera tarjeta visible del listado de productos
  await productListPage.selectProduct('Add to cart');
});