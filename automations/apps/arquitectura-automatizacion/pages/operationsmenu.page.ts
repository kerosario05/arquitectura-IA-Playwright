import { Page, expect } from '@playwright/test';
import { waitForPromotedSpecStepReady } from '../../../browser/promoted-spec-helpers';

export class OperationsMenuPage {
  constructor(private readonly page: Page) {}

  async expectLoaded(): Promise<void> {
    await expect(
      this.page.getByText(/transacciones y servicios|transacciones y services|menú de operaciones/i)
    ).toBeVisible();
  }

  async openModule(moduleName: string): Promise<void> {
    const previousUrl = this.page.url();
    
    // Wait for loading indicators to clear (signal-based, max 15s)
    // Runtime will handle stale loading overlay with safe force click if needed
    const loadingHeading = this.page.locator('h1, h2, h3').filter({ hasText: /cargando productos/i });
    const loadingText = this.page.getByText(/cargando productos|por favor espere/i);
    
    try {
      await Promise.race([
        loadingHeading.waitFor({ state: 'hidden', timeout: 15000 }),
        loadingText.waitFor({ state: 'hidden', timeout: 15000 })
      ]);
      // Brief stabilization after loading clears
      await this.page.waitForTimeout(200);
    } catch {
      // Loading may have cleared or not present - runtime will handle stale overlay
    }
    
    // Click target button - runtime will apply safe force click if loading overlay is stale
    const targetButton = this.page.getByRole('button', { name: new RegExp(moduleName, 'i') });
    await targetButton.click({ timeout: 5000 });
    
    await waitForPromotedSpecStepReady(this.page, { previousUrl, expectEntityList: false, timeoutMs: 10000 });
  }

  async selectOperation(operationName: string): Promise<void> {
    return this.openModule(operationName);
  }
}
