import { test } from '@playwright/test';

import { HomePage } from '../../pages/home.page.candidate';
import { ProductListPage } from '../../pages/productlist.page';
import { ProductDetailPage } from '../../pages/productdetail.page.candidate';
import { AuthFlow, setAuthFlowTestData } from '../../flows/auth.flow';
import { resolvePromotedSpecAuthDataFromEnv } from '../../flows/auth.flow.helpers';

test('Generar carta de referencia con certificado', async ({ page }) => {

  const homePage = new HomePage(page);
  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);
    const authFlow = new AuthFlow(page);

  await homePage.start(); // [target: iniciar]
  await productListPage.selectProduct('transacciones y servicio');
  
    setAuthFlowTestData(resolvePromotedSpecAuthDataFromEnv());
    await authFlow.ensureAuthenticated({
      alias: 'defaultClient',
      landing: 'transactions_menu',
    });
  
  await productListPage.selectProduct('Generar cartas');
  await productListPage.selectProduct('Carta de referencia');
  await productListPage.selectProduct('Depósito a plazo');
  await productListPage.selectProduct('cuenta de ahorros');
  await productDetailPage.clickPrimaryAction('continuar');
  await productListPage.selectProduct('A quien pueda interesar');
  await productDetailPage.clickPrimaryAction('continuar');
});