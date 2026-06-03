"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OtpComponent = void 0;
const test_1 = require("@playwright/test");
const virtual_keyboard_component_1 = require("./virtual-keyboard.component");
class OtpComponent {
    page;
    virtualKeyboard;
    constructor(page) {
        this.page = page;
        this.virtualKeyboard = new virtual_keyboard_component_1.VirtualKeyboardComponent(page);
    }
    async expectLoaded() {
        await (0, test_1.expect)(this.page.getByText(/código otp|codigo otp|código de verificación|codigo de verificacion/i)).toBeVisible();
    }
    async enterOtp(code) {
        const useVirtualKeyboard = await this.virtualKeyboard.isVisible();
        if (useVirtualKeyboard) {
            await this.virtualKeyboard.enterDigits(code);
        }
        else {
            const otpInputs = this.page.locator('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="codigo"], input[name*="código"]');
            const count = await otpInputs.count();
            if (count > 1) {
                for (let i = 0; i < Math.min(count, code.length); i++) {
                    await otpInputs.nth(i).fill(code[i]);
                }
            }
            else if (count === 1) {
                await otpInputs.first().fill(code);
            }
            else {
                const fallback = this.page.locator('input[type="text"]').first();
                await fallback.fill(code);
            }
        }
    }
    async confirmCode() {
        await this.page.getByRole('button', { name: /confirmar código|confirmar codigo|confirmar|verify/i }).click();
    }
}
exports.OtpComponent = OtpComponent;
