import { test } from '@playwright/test';

import { HomePage } from '../../pages/home.page';
import { ProductListPage } from '../../pages/productlist.page';
import { ProductDetailPage } from '../../pages/productdetail.page';
import { AuthFlow, setAuthFlowTestData } from '../../flows/auth.flow';
import { resolvePromotedSpecAuthDataFromEnv } from '../../flows/auth.flow.helpers';

test('Generar carta de referencia con cuenta de ahorro', async ({ page }) => {

  const homePage = new HomePage(page);
  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);
    const authFlow = new AuthFlow(page);
  // WARNING: Missing page object methods:
  // - step=3 target="transacciones y servicio" derivedIntent="open_home" expectedOwner="ProductListPage" availableMethods=[selectProduct]
  // - step=6 target="Generar cartas" derivedIntent="open_home" expectedOwner="ProductListPage" availableMethods=[selectProduct]


  await homePage.start(); // [target: iniciar]
  
    setAuthFlowTestData(resolvePromotedSpecAuthDataFromEnv());
    await authFlow.ensureAuthenticated({
      alias: 'defaultClient',
      landing: 'transactions_menu',
    });
  
  await productListPage.selectProduct('Carta de referencia');
  await productListPage.selectProduct('cuenta de ahorros');
  await productDetailPage.clickPrimaryAction('continuar');
  await productListPage.selectProduct('A quien pueda interesar');
  await productDetailPage.clickPrimaryAction('continuar');
  // Fallthrough: execute remaining plan steps via executor
});