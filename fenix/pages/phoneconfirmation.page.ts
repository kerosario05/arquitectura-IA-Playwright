import { Page, expect } from '@playwright/test';

export class PhoneConfirmationPage {
  constructor(private readonly page: Page) {}

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByText(/confirmar número de teléfono|confirmar numero de teléfono|confirmar numero de telefono/i)).toBeVisible();
  }

  async expectPhoneLast4(last4: string): Promise<void> {
    await expect(this.page.getByText(last4)).toBeVisible();
  }

  async confirmPhone(): Promise<void> {
    await this.page.getByRole('button', { name: /confirmar|confirm/i }).click();
  }
}
