import { test } from '@playwright/test';

import { HomePage } from '../../pages/home.page';
import { ProductListPage } from '../../pages/productlist.page';
import { ProductDetailPage } from '../../pages/productdetail.page';
import { AuthFlow, setAuthFlowTestData } from '../../flows/auth.flow';

test('Generar carta de referencia con cuenta de ahorro', async ({ page }) => {

  const homePage = new HomePage(page);
  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);
    const authFlow = new AuthFlow(page);

  await homePage.start(); // [target: iniciar]
  await homePage.open('transacciones y servicio');
  
    await authFlow.ensureAuthenticated({
      alias: 'defaultClient',
      landing: 'transactions_menu',
    });
  
  await homePage.open('Generar cartas');
  await productListPage.selectProduct('Carta de referencia');
  await productListPage.selectProduct('cuenta de ahorros');
  await productDetailPage.clickPrimaryAction('continuar');
  await productDetailPage.clickPrimaryAction('A quien pueda interesar');
  await productDetailPage.clickPrimaryAction('continuar');
});