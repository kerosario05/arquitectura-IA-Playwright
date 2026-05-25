import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../src/automations/runtime/promoted-spec-runtime';
import { resolve } from 'node:path';
import { config } from '../../../../../src/config/env';
import { buildDataContext } from '../../../../../src/data';
import { loadPromotedAppConfigSync, buildMergedConfig } from '../../../../../src/automations/app-profile';
import { loadPromotedDataManifestSync, buildPromotedDataContext, requirePromotedData } from '../../../../../src/data/promoted-data';

import { CategoryPage } from '../../pages/category.page';
import { ProductListPage } from '../../pages/productlist.page';
import { ProductDetailPage } from '../../pages/productdetail.page';
import { FormPage } from '../../pages/form.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Cerrar confirmación de compra exitosa con la opción OK', async ({ page }) => {

  const __appConfig = loadPromotedAppConfigSync({ appSlug: 'arquitectura-automatizacion', configPath: 'automations/apps/arquitectura-automatizacion/app.config.json' });
  const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;
  const __baseDataContext = buildDataContext(__runtimeConfig);
  const __promotedManifest = loadPromotedDataManifestSync(resolve(process.cwd(), 'automations/apps/arquitectura-automatizacion/cases/c37948-cerrar-confirmacion-de-compra-exitosa-con-la-opcion-ok/promoted-data.json'));
  const dataContext = buildPromotedDataContext({
    baseDataContext: __baseDataContext,
    manifest: __promotedManifest,
    testDataProfile: __runtimeConfig.app.testDataProfile,
    autoGenerateTestData: __runtimeConfig.app.autoGenerateTestData,
    autoGenerateSensitiveData: __runtimeConfig.app.autoGenerateSensitiveData
  });

  const categoryPage = new CategoryPage(page);
  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);
  const formPage = new FormPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const ordenNombre = requirePromotedData(dataContext, 'orden_nombre', { fieldName: 'Name', stepIndex: 8 });
  const ordenPais = requirePromotedData(dataContext, 'orden_pais', { fieldName: 'Country', stepIndex: 9 });
  const ordenCiudad = requirePromotedData(dataContext, 'orden_ciudad', { fieldName: 'City', stepIndex: 10 });
  const ordenTarjeta = requirePromotedData(dataContext, 'orden_tarjeta', { fieldName: 'Credit card', stepIndex: 11 });
  const ordenMes = requirePromotedData(dataContext, 'orden_mes', { fieldName: 'Month', stepIndex: 12 });
  const ordenAnio = requirePromotedData(dataContext, 'orden_anio', { fieldName: 'Year', stepIndex: 13 });

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Phones', actionIntent: 'select_category', expectedEffect: 'ui_change', sensitive: false, action: async () => { await categoryPage.selectCategory('Phones'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'la primera tarjeta visible del listado de productos', actionIntent: 'select_first_visible_card', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productListPage.selectFirstVisibleCard(); } }); // [target: la primera tarjeta visible del listado de productos]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Add to cart', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productDetailPage.clickPrimaryAction('Add to cart'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Cart', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productListPage.selectProduct('Cart'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 7, target: 'Place Order', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productDetailPage.clickPrimaryAction('Place Order'); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 8, field: 'Name', value: String(ordenNombre), sensitive: false, fill: async () => { await formPage.fillField('Name', ordenNombre); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 9, field: 'Country', value: String(ordenPais), sensitive: false, fill: async () => { await formPage.fillField('Country', ordenPais); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 10, field: 'City', value: String(ordenCiudad), sensitive: false, fill: async () => { await formPage.fillField('City', ordenCiudad); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 11, field: 'Credit card', value: String(ordenTarjeta), sensitive: false, fill: async () => { await formPage.fillField('Credit card', ordenTarjeta); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 12, field: 'Month', value: String(ordenMes), sensitive: false, fill: async () => { await formPage.fillField('Month', ordenMes); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 13, field: 'Year', value: String(ordenAnio), sensitive: false, fill: async () => { await formPage.fillField('Year', ordenAnio); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 14, target: 'Purchase', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productDetailPage.clickPrimaryAction('Purchase'); } });
  await promotedRuntime.expectPromotedVisible({ stepIndex: 15, target: 'Amount', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Amount]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 16, target: 'OK', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productListPage.selectProduct('OK'); } });
  await promotedRuntime.expectPromotedVisible({ stepIndex: 17, target: 'Confirmación de compra cerrada.', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Confirmación de compra cerrada.]
});