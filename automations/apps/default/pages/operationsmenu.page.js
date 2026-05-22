"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationsMenuPage = void 0;
const test_1 = require("@playwright/test");
class OperationsMenuPage {
    page;
    constructor(page) {
        this.page = page;
    }
    async expectLoaded() {
        await (0, test_1.expect)(this.page.getByText(/transacciones y servicios|transacciones y services|menú de operaciones/i)).toBeVisible();
    }
    async selectOperation(operationName) {
        await this.page.getByRole('button', { name: new RegExp(operationName, 'i') }).click();
    }
}
exports.OperationsMenuPage = OperationsMenuPage;
