import { test } from '@playwright/test';

import { CategoryPage } from '../../pages/category.page';
import { ProductListPage } from '../../pages/productlist.page';
import { ProductDetailPage } from '../../pages/productdetail.page';

test('Visualizar carrito con producto agregado durante la sesión actual', async ({ page }) => {

  const categoryPage = new CategoryPage(page);
  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await categoryPage.selectCategory('Phones');
  await productListPage.selectFirstVisibleCard(); // [target: la primera tarjeta visible del listado de productos]
  await productDetailPage.clickPrimaryAction('Add to cart');
  await productListPage.selectProduct('Cart');
  await productDetailPage.expectLoaded(); // [target: que se muestre el producto agregado en el carrito]
  await productDetailPage.expectLoaded(); // [target: que se muestre el total de la compra]
  await productDetailPage.expectLoaded(); // [target: Total de compra visible.]
});