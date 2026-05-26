/**
 * AI Repair - Resolver selección con typo hacia producto existente
 * 
 * Case ID: C38041
 * Purpose: Validate that AI Repair selection_resolution can resolve typos in product selection
 * 
 * Flow:
 * 1. Navigate to Laptops category
 * 2. Select product with typo: "Macbook aire" (should resolve to "MacBook Air")
 * 3. Validate product detail page loads
 * 
 * Expected Behavior (NEW - Selection Semantic Safety):
 * - If local semantic confidence < 0.85, AI selection_resolution is invoked
 * - AI receives enriched context with cardText, nearbyText, priceText
 * - AI selects correct candidate (MacBook Air, not Sony Vaio)
 * - Post-click semantic verification confirms "MacBook" or "Air" tokens in result
 * - If AI returns no_safe_action, case fails controladamente (no low-confidence fallback)
 * 
 * Technical Validation (post-discovery):
 * - Review evidence/ai-repair-summary.json for selection_resolution diagnostics
 * - Check semanticMatchDiagnostics in step artifact
 * - Verify post-click tokens match target (MacBook, Air)
 * 
 * Usage:
 *   npx playwright test automations/apps/arquitectura-automatizacion/cases/c38041-ai-repair-resolver-seleccion-con-typo-hacia-producto-existente/case.spec.ts
 */

import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../src/automations/runtime/promoted-spec-runtime';

import { ProductListPage } from '../../pages/productlist.page';
import { ProductDetailPage } from '../../pages/productdetail.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('AI Repair - Resolver selección con typo hacia producto existente', async ({ page }) => {

  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Laptops', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productListPage.selectProduct('Laptops'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Macbook aire', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productDetailPage.clickPrimaryAction('Macbook aire'); } });
  await promotedRuntime.expectPromotedVisible({ stepIndex: 5, target: 'EXITO', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: EXITO]
});