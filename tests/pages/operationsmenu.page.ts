import { Page, expect } from '@playwright/test';
import { waitForPromotedSpecStepReady } from '../../src/browser/promoted-spec-helpers';

export class OperationsMenuPage {
  constructor(private readonly page: Page) {}

  async expectLoaded(): Promise<void> {
    await expect(
      this.page.getByText(/transacciones y servicios|transacciones y services|menú de operaciones/i)
    ).toBeVisible();
  }

  async selectOperation(operationName: string): Promise<void> {
    const previousUrl = this.page.url();
    await this.page.getByRole('button', { name: new RegExp(operationName, 'i') }).click();
    await waitForPromotedSpecStepReady(this.page, { previousUrl, expectEntityList: false });
  }
}
