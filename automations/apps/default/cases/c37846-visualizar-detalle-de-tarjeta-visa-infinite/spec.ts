import { test } from '@playwright/test';

import { HomePage } from '../../pages/home.page';
import { ProductInformationPage } from '../../pages/productinformation.page';
import { CategoryPage } from '../../pages/category.page';
import { ProductListPage } from '../../pages/productlist.page';

test('Visualizar detalle de Tarjeta Visa Infinite', async ({ page }) => {

  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);
  const categoryPage = new CategoryPage(page);
  const productListPage = new ProductListPage(page);

  await homePage.start();
  await productInformationPage.openProductInformation();
  await categoryPage.selectCategory('tarjetas');
  await productListPage.selectProduct('tarjeta de credito visa infinite');
});