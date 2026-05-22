import { test } from '@playwright/test';

import { HomePage } from '../../pages/home.page';
import { ProductDetailPage } from '../../pages/productdetail.page';

test('Generar carta de referencia con cuenta de ahorro', async ({ page }) => {

  const homePage = new HomePage(page);
  const productDetailPage = new ProductDetailPage(page);

  await homePage.start();
  await homePage.start();
  await productDetailPage.clickPrimaryAction('Cédula de identidad dominicana');
  await productDetailPage.clickPrimaryAction('continuar');
  await homePage.start();
  await homePage.start();
  await homePage.start();
  await homePage.start();
  await homePage.start();
  await homePage.start();
});