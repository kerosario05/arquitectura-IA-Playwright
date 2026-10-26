import { Page, expect } from '@playwright/test';
import { VirtualKeyboardComponent } from './virtual-keyboard.component';

export class OtpComponent {
  private virtualKeyboard: VirtualKeyboardComponent;

  constructor(private readonly page: Page) {
    this.virtualKeyboard = new VirtualKeyboardComponent(page);
  }

  async expectLoaded(): Promise<void> {
    await expect(
      this.page.getByText(/código otp|codigo otp|código de verificación|codigo de verificacion/i)
    ).toBeVisible();
  }

  async enterOtp(code: string): Promise<void> {
    const useVirtualKeyboard = await this.virtualKeyboard.isVisible();

    if (useVirtualKeyboard) {
      await this.virtualKeyboard.enterDigits(code);
    } else {
      const otpInputs = this.page.locator('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="codigo"], input[name*="código"]');
      const count = await otpInputs.count();

      if (count > 1) {
        for (let i = 0; i < Math.min(count, code.length); i++) {
          await otpInputs.nth(i).fill(code[i]);
        }
      } else if (count === 1) {
        await otpInputs.first().fill(code);
      } else {
        const fallback = this.page.locator('input[type="text"]').first();
        await fallback.fill(code);
      }
    }
  }

  async confirmCode(): Promise<void> {
    await this.page.getByRole('button', { name: /confirmar código|confirmar codigo|confirmar|verify/i }).click();
  }
}
