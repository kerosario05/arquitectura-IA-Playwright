import { Page, Locator } from '@playwright/test';

export class VirtualKeyboardComponent {
  constructor(private readonly page: Page) {}

  private async getDigitButton(digit: string): Promise<Locator | null> {
    const strategies = [
      () => this.page.getByRole('button', { name: digit, exact: true }),
      () => this.page.getByRole('button', { name: new RegExp(`^${digit}$`) }),
      () => this.page.locator(`button:has-text("${digit}")`),
      () => this.page.getByText(digit, { exact: true }),
      () => this.page.locator(`[data-key="${digit}"]`),
      () => this.page.locator(`[value="${digit}"]`),
      () => this.page.locator(`.key-${digit}`),
      () => this.page.locator(`.keypad-key-${digit}`)
    ];

    for (const strategy of strategies) {
      try {
        const locator = strategy();
        if (await locator.isVisible({ timeout: 1000 })) {
          return locator;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  async enterDigits(value: string, options?: { delayMs?: number }): Promise<void> {
    const delay = options?.delayMs ?? 50;
    const startTime = Date.now();
    const chars = value.split('');

    for (const char of chars) {
      if (!/^[0-9]$/.test(char)) {
        throw new Error(`VirtualKeyboardComponent: Invalid digit "${char}". Expected 0-9.`);
      }
      const button = await this.getDigitButton(char);
      if (!button) {
        throw new Error(`VirtualKeyboardComponent: Could not find button for digit "${char}".`);
      }
      await button.click();
      if (delay > 0) {
        await this.page.waitForTimeout(delay);
      }
    }
    console.log(`[auth-input] fastFill method=virtual_keys durationMs=${Date.now() - startTime} valueLength=${value.length}`);
  }

  async clear(options?: { clearButtonName?: string }): Promise<void> {
    const clearName = options?.clearButtonName ?? 'clear';
    try {
      const clearButton = this.page.getByRole('button', { name: new RegExp(clearName, 'i') });
      if (await clearButton.isVisible({ timeout: 1000 })) {
        await clearButton.click();
        await this.page.waitForTimeout(100);
      }
    } catch {
      // Clear button not found, continue
    }
  }

  async backspace(options?: { backspaceButtonName?: string }): Promise<void> {
    const backspaceName = options?.backspaceButtonName ?? 'backspace';
    try {
      const backspaceButton = this.page.getByRole('button', { name: new RegExp(backspaceName, 'i') });
      if (await backspaceButton.isVisible({ timeout: 1000 })) {
        await backspaceButton.click();
        await this.page.waitForTimeout(100);
      }
    } catch {
      // Backspace button not found, continue
    }
  }

  async isVisible(): Promise<boolean> {
    try {
      const digitButton = await this.getDigitButton('0');
      return digitButton !== null;
    } catch {
      return false;
    }
  }
}
