"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VirtualKeyboardComponent = void 0;
class VirtualKeyboardComponent {
    page;
    constructor(page) {
        this.page = page;
    }
    async getDigitButton(digit) {
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
            }
            catch {
                continue;
            }
        }
        return null;
    }
    async enterDigits(value, options) {
        const delay = options?.delayMs ?? 100;
        for (const char of value) {
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
    }
    async clear(options) {
        const clearName = options?.clearButtonName ?? 'clear';
        try {
            const clearButton = this.page.getByRole('button', { name: new RegExp(clearName, 'i') });
            if (await clearButton.isVisible({ timeout: 1000 })) {
                await clearButton.click();
                await this.page.waitForTimeout(100);
            }
        }
        catch {
            // Clear button not found, continue
        }
    }
    async backspace(options) {
        const backspaceName = options?.backspaceButtonName ?? 'backspace';
        try {
            const backspaceButton = this.page.getByRole('button', { name: new RegExp(backspaceName, 'i') });
            if (await backspaceButton.isVisible({ timeout: 1000 })) {
                await backspaceButton.click();
                await this.page.waitForTimeout(100);
            }
        }
        catch {
            // Backspace button not found, continue
        }
    }
    async isVisible() {
        try {
            const digitButton = await this.getDigitButton('0');
            return digitButton !== null;
        }
        catch {
            return false;
        }
    }
}
exports.VirtualKeyboardComponent = VirtualKeyboardComponent;
