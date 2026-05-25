import { test } from '@playwright/test';

import { CategoryPage } from '../../pages/category.page';
import { ProductListPage } from '../../pages/productlist.page';

test('Visualizar detalle de producto desde listado filtrado', async ({ page }) => {

  const categoryPage = new CategoryPage(page);
  const productListPage = new ProductListPage(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await categoryPage.selectCategory('Phones');
  await productListPage.selectProduct('la primera tarjeta visible del listado de productos');
});