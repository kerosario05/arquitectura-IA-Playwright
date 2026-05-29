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
    await this.page.getByRole('button', { name: new RegExp(moduleName, 'i') }).click();
    await waitForPromotedSpecStepReady(this.page, { previousUrl, expectEntityList: false });
  }

  async selectOperation(operationName: string): Promise<void> {
    return this.openModule(operationName);
  }
}
