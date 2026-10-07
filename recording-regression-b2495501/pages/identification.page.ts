import { Page, expect } from '@playwright/test';
import { VirtualKeyboardComponent } from '../components/virtual-keyboard.component';

export class IdentificationPage {
  private virtualKeyboard: VirtualKeyboardComponent;

  constructor(private readonly page: Page) {
    this.virtualKeyboard = new VirtualKeyboardComponent(page);
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByText(/identificación del cliente|identificacion del cliente|número de identificación|numero de identificación/i)).toBeVisible();
  }

  async selectIdentificationType(type: string): Promise<void> {
    const typeMap: Record<string, RegExp> = {
      cedula: /cédula de identidad dominicana|cedula de identidad dominicana/i,
      pasaporte: /pasaporte extranjero/i,
      carnet: /carnet/i
    };
    const selector = typeMap[type.toLowerCase()] || new RegExp(type, 'i');
    await this.page.getByRole('button', { name: selector }).click();
  }

  async enterIdentificationNumber(value: string): Promise<void> {
    const useVirtualKeyboard = await this.virtualKeyboard.isVisible();

    if (useVirtualKeyboard) {
      await this.virtualKeyboard.enterDigits(value);
    } else {
      const input = this.page.getByRole('textbox', { name: /número de identificación|numero de identificación|numero de identificacion/i })
        .or(this.page.locator('input[name*="identification"], input[name*="identificacion"], input[name*="cedula"]'));
      await input.fill(value);
    }
  }

  async continue(): Promise<void> {
    await this.page.getByRole('button', { name: /continuar|continue/i }).click();
  }
}
