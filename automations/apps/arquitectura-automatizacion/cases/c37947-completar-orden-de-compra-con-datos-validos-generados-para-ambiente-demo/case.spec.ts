import { test } from '@playwright/test';
import { config } from '../../../../../src/config/env';
import { buildDataContext } from '../../../../../src/data';
import { loadPromotedAppConfigSync, buildMergedConfig } from '../../../../../src/automations/app-profile';

import { CategoryPage } from '../../pages/category.page';
import { ProductListPage } from '../../pages/productlist.page';
import { ProductDetailPage } from '../../pages/productdetail.page';
import { FormPage } from '../../pages/form.page';

test('Completar orden de compra con datos válidos generados para ambiente demo', async ({ page }) => {

  const __appConfig = loadPromotedAppConfigSync({ appSlug: 'arquitectura-automatizacion', configPath: 'automations/apps/arquitectura-automatizacion/app.config.json' });
  const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;
  const dataContext = buildDataContext(__runtimeConfig);
  const requirePromotedData = (ctx: { entries: Array<{ key: string; value: string }> }, key: string): string => {
    const normalizedKey = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const directMatch = ctx.entries.find((entry) => entry.key === key) ?? ctx.entries.find((entry) => entry.key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() === normalizedKey);
    const aliasKey = normalizedKey.includes('usuario') || normalizedKey.includes('username') || normalizedKey.includes('user')
      ? 'APP_USERNAME'
      : normalizedKey.includes('contrasena') || normalizedKey.includes('password') || normalizedKey.includes('pass')
        ? 'APP_PASSWORD'
        : undefined;
    const aliasMatch = aliasKey ? ctx.entries.find((entry) => entry.key === aliasKey) : undefined;
    const match = directMatch ?? aliasMatch;
    if (!match || !match.value) throw new Error(`Missing required promoted data key '${key}'.`);
    return match.value;
  };

  const categoryPage = new CategoryPage(page);
  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);
  const formPage = new FormPage(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const orden_nombre = requirePromotedData(dataContext, 'orden_nombre');
  const orden_pais = requirePromotedData(dataContext, 'orden_pais');
  const orden_ciudad = requirePromotedData(dataContext, 'orden_ciudad');
  const orden_tarjeta = requirePromotedData(dataContext, 'orden_tarjeta');
  const orden_mes = requirePromotedData(dataContext, 'orden_mes');
  const orden_anio = requirePromotedData(dataContext, 'orden_anio');

  await categoryPage.selectCategory('Phones');
  await productListPage.selectProduct('la primera tarjeta visible del listado de productos');
  await productDetailPage.clickPrimaryAction('Add to cart'); // candidate method
  // [candidate] click Add to cart
  await productListPage.selectProduct('Cart');
  await productDetailPage.clickPrimaryAction('Place Order'); // candidate method
  // [candidate] click Place Order
  await formPage.fillField('Name', 'Name');
  await formPage.fillField('Country', 'Country');
  await formPage.fillField('City', 'City');
  await formPage.fillField('Credit card', 'Credit card');
  await formPage.fillField('Month', 'Month');
  await formPage.fillField('Year', 'Year');
  await productDetailPage.clickPrimaryAction('Purchase'); // candidate method
  // [candidate] click Purchase
  await productDetailPage.expectLoaded(); // [target: Amount]
});