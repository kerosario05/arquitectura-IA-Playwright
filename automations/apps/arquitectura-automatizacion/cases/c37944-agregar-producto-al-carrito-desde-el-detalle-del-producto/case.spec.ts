import { test } from '@playwright/test';

import { CategoryPage } from '../../pages/category.page';
import { ProductListPage } from '../../pages/productlist.page';
import { ProductDetailPage } from '../../pages/productdetail.page';

test('Agregar producto al carrito desde el detalle del producto', async ({ page }) => {

  const categoryPage = new CategoryPage(page);
  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await categoryPage.selectCategory('Phones');
  await productListPage.selectProduct('la primera tarjeta visible del listado de productos');
  await productDetailPage.clickPrimaryAction('Add to cart'); // candidate method
  // [candidate] click Add to cart
});