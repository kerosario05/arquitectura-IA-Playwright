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
    const startTime = Date.now();

    if (useVirtualKeyboard) {
      // Try native evaluate first — some pages have hidden native inputs behind the virtual keyboard
      const nativeFilled = await this.page.evaluate((val) => {
        const inputs = document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])');
        for (const input of inputs) {
          const ctx = input as HTMLInputElement;
          if (/identificaci[óo]n|cedula|cédula|document/i.test(ctx.name || ctx.id || ctx.placeholder || '')) {
            const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (proto?.set) {
              proto.set.call(ctx, val);
              ctx.dispatchEvent(new Event('input', { bubbles: true }));
              ctx.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            ctx.focus();
            document.execCommand('insertText', false, val);
            return true;
          }
        }
        return false;
      }, value);

      if (nativeFilled) {
        console.log(`[auth-input] fastFill method=native_evaluate durationMs=${Date.now() - startTime} valueLength=${value.length}`);
        await this.page.waitForTimeout(300);
      } else {
        await this.virtualKeyboard.enterDigits(value);
        console.log(`[auth-input] fastFill method=virtual_keys durationMs=${Date.now() - startTime} valueLength=${value.length}`);
      }
    } else {
      const input = this.page.getByRole('textbox', { name: /número de identificación|numero de identificación|numero de identificacion/i })
        .or(this.page.locator('input[name*="identification"], input[name*="identificacion"], input[name*="cedula"]'));
      await input.fill(value);
      console.log(`[auth-input] fastFill method=native durationMs=${Date.now() - startTime} valueLength=${value.length}`);
    }
  }

  async continue(): Promise<void> {
    await this.page.getByRole('button', { name: /continuar|continue/i }).click();
  }
}
