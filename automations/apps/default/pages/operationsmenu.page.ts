import { Page, expect } from '@playwright/test';

export class OperationsMenuPage {
  constructor(private readonly page: Page) {}

  async expectLoaded(): Promise<void> {
    await expect(
      this.page.getByText(/transacciones y servicios|transacciones y services|menú de operaciones/i)
    ).toBeVisible();
  }

  async selectOperation(operationName: string): Promise<void> {
    await this.page.getByRole('button', { name: new RegExp(operationName, 'i') }).click();
  }
}
