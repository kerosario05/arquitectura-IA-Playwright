"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentificationPage = void 0;
const test_1 = require("@playwright/test");
const virtual_keyboard_component_1 = require("../components/virtual-keyboard.component");
class IdentificationPage {
    page;
    virtualKeyboard;
    constructor(page) {
        this.page = page;
        this.virtualKeyboard = new virtual_keyboard_component_1.VirtualKeyboardComponent(page);
    }
    async expectLoaded() {
        await (0, test_1.expect)(this.page.getByText(/identificación del cliente|identificacion del cliente|número de identificación|numero de identificación/i)).toBeVisible();
    }
    async selectIdentificationType(type) {
        const typeMap = {
            cedula: /cédula de identidad dominicana|cedula de identidad dominicana/i,
            pasaporte: /pasaporte extranjero/i,
            carnet: /carnet/i
        };
        const selector = typeMap[type.toLowerCase()] || new RegExp(type, 'i');
        await this.page.getByRole('button', { name: selector }).click();
    }
    async enterIdentificationNumber(value) {
        const useVirtualKeyboard = await this.virtualKeyboard.isVisible();
        if (useVirtualKeyboard) {
            await this.virtualKeyboard.enterDigits(value);
        }
        else {
            const input = this.page.getByRole('textbox', { name: /número de identificación|numero de identificación|numero de identificacion/i })
                .or(this.page.locator('input[name*="identification"], input[name*="identificacion"], input[name*="cedula"]'));
            await input.fill(value);
        }
    }
    async continue() {
        await this.page.getByRole('button', { name: /continuar|continue/i }).click();
    }
}
exports.IdentificationPage = IdentificationPage;
