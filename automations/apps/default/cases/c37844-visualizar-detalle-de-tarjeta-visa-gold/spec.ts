import { test } from '@playwright/test';

import { VisualizarDetalleDeTarjetaVisaGoldPage } from '../../../../../pages/visualizardetalledetarjetavisagold.page';

test('Visualizar detalle de Tarjeta Visa Gold', async ({ page }) => {

  const visualizarDetalleDeTarjetaVisaGoldPage = new VisualizarDetalleDeTarjetaVisaGoldPage(page);

  await visualizarDetalleDeTarjetaVisaGoldPage.navigatenavigateAPPBASEURL(); // candidate method
  // [candidate] navigate APP_BASE_URL
  await visualizarDetalleDeTarjetaVisaGoldPage.loginlogin(); // candidate method
  // [candidate] login
  await visualizarDetalleDeTarjetaVisaGoldPage.clickIniciar(); // candidate method
  // [candidate] click Iniciar
  await visualizarDetalleDeTarjetaVisaGoldPage.clickIniciar(); // candidate method
  // [candidate] click Información de productos
  await visualizarDetalleDeTarjetaVisaGoldPage.clickIniciar(); // candidate method
  // [candidate] click tarjetas
  await visualizarDetalleDeTarjetaVisaGoldPage.clickIniciar(); // candidate method
  // [candidate] click tarjeta de credito visa gold
});