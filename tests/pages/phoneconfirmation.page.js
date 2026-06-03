"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneConfirmationPage = void 0;
const test_1 = require("@playwright/test");
class PhoneConfirmationPage {
    page;
    constructor(page) {
        this.page = page;
    }
    async expectLoaded() {
        await (0, test_1.expect)(this.page.getByText(/confirmar número de teléfono|confirmar numero de teléfono|confirmar numero de telefono/i)).toBeVisible();
    }
    async expectPhoneLast4(last4) {
        await (0, test_1.expect)(this.page.getByText(last4)).toBeVisible();
    }
    async confirmPhone() {
        await this.page.getByRole('button', { name: /confirmar|confirm/i }).click();
    }
}
exports.PhoneConfirmationPage = PhoneConfirmationPage;
