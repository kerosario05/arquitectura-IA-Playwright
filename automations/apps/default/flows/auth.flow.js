"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthFlow = void 0;
exports.setAuthFlowTestData = setAuthFlowTestData;
const identification_page_1 = require("../pages/identification.page");
const phoneconfirmation_page_1 = require("../pages/phoneconfirmation.page");
const otp_component_1 = require("../components/otp.component");
const operationsmenu_page_1 = require("../pages/operationsmenu.page");
const auth_gate_detector_1 = require("../../../../src/discovery/auth-gate-detector");
const page_scanner_1 = require("../../../../src/explorer/page-scanner");
class AuthFlow {
    page;
    identificationPage;
    phoneConfirmationPage;
    otpComponent;
    operationsMenuPage;
    constructor(page) {
        this.page = page;
        this.identificationPage = new identification_page_1.IdentificationPage(page);
        this.phoneConfirmationPage = new phoneconfirmation_page_1.PhoneConfirmationPage(page);
        this.otpComponent = new otp_component_1.OtpComponent(page);
        this.operationsMenuPage = new operationsmenu_page_1.OperationsMenuPage(page);
    }
    resolveClient(alias, testData) {
        const authData = testData;
        const clients = authData?.clients;
        const defaults = authData?.defaults;
        const resolvedAlias = alias || defaults?.client || 'defaultClient';
        if (!clients || !clients[resolvedAlias]) {
            throw new Error(`Auth client '${resolvedAlias}' not found in APP_TEST_DATA_JSON. Available clients: ${clients ? Object.keys(clients).join(', ') : 'none'}`);
        }
        const client = clients[resolvedAlias];
        if (!client.identificationNumber) {
            throw new Error(`Auth client '${resolvedAlias}' is missing 'identificationNumber'.`);
        }
        if (!client.otp) {
            throw new Error(`Auth client '${resolvedAlias}' is missing 'otp'.`);
        }
        return client;
    }
    async detectCurrentStage() {
        const snapshot = await this.captureSnapshot();
        const detection = (0, auth_gate_detector_1.detectAuthGate)(snapshot);
        if (!detection.detected) {
            return 'not_started';
        }
        switch (detection.stage) {
            case 'identification_type_selection':
            case 'identification_input':
            case 'identification':
                return 'identification';
            case 'phone_confirmation':
                return 'phone_confirmation';
            case 'otp':
                return 'otp';
            case 'authenticated_landing':
                return 'authenticated';
            default:
                return 'not_started';
        }
    }
    async captureSnapshot() {
        return await (0, page_scanner_1.scanCurrentPage)(this.page);
    }
    async isOperationsMenuVisible() {
        try {
            await this.operationsMenuPage.expectLoaded();
            return true;
        }
        catch {
            return false;
        }
    }
    async ensureAuthenticated(options = {}) {
        const { alias = 'defaultClient', landing = 'transactions_menu' } = options;
        const stagesCompleted = [];
        const globalWithTestData = globalThis;
        const testData = globalWithTestData.__authFlowTestData || {};
        let client;
        try {
            client = this.resolveClient(alias, testData);
        }
        catch (error) {
            return {
                success: false,
                stagesCompleted,
                clientAlias: alias,
                landingDetected: undefined,
                error: error instanceof Error ? error.message : String(error)
            };
        }
        const currentStage = await this.detectCurrentStage();
        if (currentStage === 'authenticated') {
            return {
                success: true,
                stagesCompleted: ['authenticated'],
                clientAlias: alias,
                landingDetected: landing
            };
        }
        if (currentStage === 'not_started') {
            const isMenuVisible = await this.isOperationsMenuVisible();
            if (isMenuVisible) {
                return {
                    success: true,
                    stagesCompleted: ['authenticated'],
                    clientAlias: alias,
                    landingDetected: landing
                };
            }
            await this.page.goto('/');
            await this.page.waitForTimeout(2000);
            const afterNav = await this.detectCurrentStage();
            if (afterNav === 'not_started') {
                const menuVisible = await this.isOperationsMenuVisible();
                if (menuVisible) {
                    return {
                        success: true,
                        stagesCompleted: ['authenticated'],
                        clientAlias: alias,
                        landingDetected: landing
                    };
                }
                await this.page.getByRole('button', { name: /transacciones y servicios|transacciones y services/i }).click();
                await this.page.waitForTimeout(2000);
            }
        }
        const stageAfterNav = await this.detectCurrentStage();
        if (stageAfterNav === 'identification' || stageAfterNav === 'not_started') {
            try {
                await this.identificationPage.expectLoaded();
            }
            catch {
                await this.page.waitForTimeout(3000);
            }
            try {
                await this.identificationPage.expectLoaded();
                await this.identificationPage.selectIdentificationType(client.identificationType);
                await this.identificationPage.enterIdentificationNumber(client.identificationNumber);
                await this.identificationPage.continue();
                stagesCompleted.push('identification');
                await this.page.waitForTimeout(2000);
            }
            catch {
                // Identification may already be done or not visible
            }
        }
        const afterIdentification = await this.detectCurrentStage();
        if (afterIdentification === 'phone_confirmation') {
            try {
                await this.phoneConfirmationPage.expectLoaded();
                if (client.expectedPhoneLast4) {
                    await this.phoneConfirmationPage.expectPhoneLast4(client.expectedPhoneLast4);
                }
                await this.phoneConfirmationPage.confirmPhone();
                stagesCompleted.push('phone_confirmation');
                await this.page.waitForTimeout(2000);
            }
            catch {
                // Phone confirmation may be skipped
            }
        }
        const afterPhone = await this.detectCurrentStage();
        if (afterPhone === 'otp' || afterPhone === 'phone_confirmation') {
            await this.page.waitForTimeout(2000);
            try {
                await this.otpComponent.enterOtp(client.otp);
                await this.page.waitForTimeout(1000);
                await this.otpComponent.confirmCode();
                stagesCompleted.push('otp');
                await this.page.waitForTimeout(3000);
            }
            catch (error) {
                console.log(`[auth-flow] OTP entry failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        await this.page.waitForTimeout(2000);
        const finalStage = await this.detectCurrentStage();
        const isMenuVisible = await this.isOperationsMenuVisible();
        if (finalStage === 'authenticated' || isMenuVisible) {
            stagesCompleted.push('authenticated');
            return {
                success: true,
                stagesCompleted,
                clientAlias: alias,
                landingDetected: landing
            };
        }
        return {
            success: false,
            stagesCompleted,
            clientAlias: alias,
            landingDetected: undefined,
            error: `Authentication did not reach expected landing. Final stage: ${finalStage}, menu visible: ${isMenuVisible}`
        };
    }
}
exports.AuthFlow = AuthFlow;
function setAuthFlowTestData(data) {
    const globalWithTestData = globalThis;
    globalWithTestData.__authFlowTestData = data;
}
