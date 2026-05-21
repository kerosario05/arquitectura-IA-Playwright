import { test } from '@playwright/test';

import { VisualizarDetalleDeTarjetaVisaGoldPage } from '../../../../../pages/visualizardetalledetarjetavisagold.page';

test('Visualizar detalle de Tarjeta Visa Platinum', async ({ page }) => {

  const visualizarDetalleDeTarjetaVisaGoldPage = new VisualizarDetalleDeTarjetaVisaGoldPage(page);
  // WARNING: Missing page object methods:
  // - navigate: navigate APP_BASE_URL
  // - login: login


  await visualizarDetalleDeTarjetaVisaGoldPage.clickIniciar(); // candidate method
  // [candidate] click Iniciar
  // Fallthrough: execute remaining plan steps via executor
});