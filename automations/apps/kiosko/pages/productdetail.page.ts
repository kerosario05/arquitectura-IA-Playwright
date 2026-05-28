import { Page, expect } from '@playwright/test';

// Page Object: ProductDetailPage
// Screen signature: screen:kiosko-product_detail
// Status: active

export class ProductDetailPage {
  constructor(private readonly page: Page) {}

  async expectLoaded(): Promise<void> {
    await expect(this.page.locator('body')).toBeVisible();
  }

  async backToList(): Promise<void> {
    const backKeywords = /volver|regresar|atr|back|return|cancel|listado/i;
    const backButton = this.page.getByRole('button', { name: backKeywords }).first();
    const backLink = this.page.getByRole('link', { name: backKeywords }).first();
    const backLocator = backButton.or(backLink);
    await backLocator.waitFor({ state: 'visible', timeout: 10000 });
    await backLocator.click({ timeout: 10000 });
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  async clickPrimaryAction(actionName: string): Promise<void> {
    const button = this.page.getByRole('button', { name: new RegExp(actionName, 'i') });
    const link = this.page.getByRole('link', { name: new RegExp(actionName, 'i') });
    const buttonOrLink = button.or(link).first();
    await buttonOrLink.waitFor({ state: 'visible', timeout: 10000 });
    const isEnabled = await buttonOrLink.isEnabled({ timeout: 15000 }).catch(() => true);
    if (!isEnabled) {
      const buttonText = await buttonOrLink.textContent().catch(() => '(unknown)');
      throw new Error('Cannot click primary action "' + actionName + '": button is not enabled. Text: "' + buttonText + '". This usually means required selections or form fields have not been completed.');
    }
    await buttonOrLink.click({ timeout: 10000 });
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(1000);
  }

  async expectPrimaryActionVisible(actionName: string): Promise<void> {
    const actionKeywords = new RegExp(actionName, 'i');
    const button = this.page.getByRole('button', { name: actionKeywords }).first();
    const link = this.page.getByRole('link', { name: actionKeywords }).first();
    const locator = button.or(link);
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    await expect(locator).toBeVisible();
  }

  async expectPrimaryActionEnabled(actionName: string): Promise<void> {
    const actionKeywords = new RegExp(actionName, 'i');
    const button = this.page.getByRole('button', { name: actionKeywords }).first();
    const link = this.page.getByRole('link', { name: actionKeywords }).first();
    const locator = button.or(link);
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    await expect(locator).toBeEnabled();
  }

  async expectPrimaryActionDisabled(actionName: string): Promise<void> {
    const actionKeywords = new RegExp(actionName, 'i');
    const button = this.page.getByRole('button', { name: actionKeywords }).first();
    const link = this.page.getByRole('link', { name: actionKeywords }).first();
    const locator = button.or(link);
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    await expect(locator).toBeDisabled();
  }
}
