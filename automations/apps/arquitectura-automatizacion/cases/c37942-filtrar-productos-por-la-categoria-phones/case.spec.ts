import { test } from '@playwright/test';

import { CategoryPage } from '../../pages/category.page';

test('Filtrar productos por la categoría Phones', async ({ page }) => {

  const categoryPage = new CategoryPage(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await categoryPage.selectCategory('Phones');
});