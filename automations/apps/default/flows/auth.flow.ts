import { Page } from '@playwright/test';
import { IdentificationPage } from '../pages/identification.page';
import { PhoneConfirmationPage } from '../pages/phoneconfirmation.page';
import { OtpComponent } from '../components/otp.component';
import { OperationsMenuPage } from '../pages/operationsmenu.page';
import type { AuthFlowOptions, AuthFlowResult, AuthFlowStage, AuthClientProfile } from '../../../../src/types/auth-flow.types';
import { detectAuthGate } from '../../../../src/discovery/auth-gate-detector';
import type { PageSnapshot } from '../../../../src/types/page-snapshot.types';
import { scanCurrentPage } from '../../../../src/explorer/page-scanner';

export class AuthFlow {
  private identificationPage: IdentificationPage;
  private phoneConfirmationPage: PhoneConfirmationPage;
  private otpComponent: OtpComponent;
  private operationsMenuPage: OperationsMenuPage;

  constructor(private readonly page: Page) {
    this.identificationPage = new IdentificationPage(page);
    this.phoneConfirmationPage = new PhoneConfirmationPage(page);
    this.otpComponent = new OtpComponent(page);
    this.operationsMenuPage = new OperationsMenuPage(page);
  }

  private resolveClient(alias: string, testData: Record<string, unknown>): AuthClientProfile {
    const authData = testData as { clients?: Record<string, AuthClientProfile>; defaults?: { client?: string } };
    const clients = authData?.clients;
    const defaults = authData?.defaults;

    const resolvedAlias = alias || defaults?.client || 'defaultClient';

    if (!clients || !clients[resolvedAlias]) {
      const fallbackClient: AuthClientProfile = {
        identificationType: 'cedula',
        identificationNumber: process.env.Identity_Provider || '',
        otp: process.env.OTP_SECRET || '',
      };

      if (process.env.APP_USERNAME) {
        (fallbackClient as any).username = process.env.APP_USERNAME;
      }
      if (process.env.APP_PASSWORD) {
        (fallbackClient as any).password = process.env.APP_PASSWORD;
      }
      if (process.env.APP_EXTRA_LOGIN_FIELDS_JSON) {
        try {
          (fallbackClient as any).extraLoginFields = JSON.parse(process.env.APP_EXTRA_LOGIN_FIELDS_JSON);
        } catch { /* ignore */ }
      }

      if (!fallbackClient.identificationNumber) {
        throw new Error(`Auth client '${resolvedAlias}' not found in APP_TEST_DATA_JSON and Identity_Provider env var is not set. Available clients: ${clients ? Object.keys(clients).join(', ') : 'none'}`);
      }
      if (!fallbackClient.otp) {
        throw new Error(`Auth client '${resolvedAlias}' is missing 'otp'. Set APP_TEST_DATA_JSON.clients[${resolvedAlias}].otp or OTP_SECRET env var.`);
      }

      return fallbackClient;
    }

    const client = { ...clients[resolvedAlias] };

    if (!client.identificationNumber && typeof process.env.Identity_Provider === "string" && process.env.Identity_Provider) {
      client.identificationNumber = process.env.Identity_Provider;
    }
    if (!client.otp && typeof process.env.OTP_SECRET === "string" && process.env.OTP_SECRET) {
      client.otp = process.env.OTP_SECRET;
    }
    if (!client.identificationType) {
      client.identificationType = 'cedula';
    }
    if (!(client as any).username && typeof process.env.APP_USERNAME === "string" && process.env.APP_USERNAME) {
      (client as any).username = process.env.APP_USERNAME;
    }
    if (!(client as any).password && typeof process.env.APP_PASSWORD === "string" && process.env.APP_PASSWORD) {
      (client as any).password = process.env.APP_PASSWORD;
    }

    if (!client.identificationNumber) {
      throw new Error(`Auth client '${resolvedAlias}' is missing 'identificationNumber'. Set APP_TEST_DATA_JSON.clients[${resolvedAlias}].identificationNumber or Identity_Provider env var.`);
    }
    if (!client.otp) {
      throw new Error(`Auth client '${resolvedAlias}' is missing 'otp'. Set APP_TEST_DATA_JSON.clients[${resolvedAlias}].otp or OTP_SECRET env var.`);
    }

    return client;
  }

  private async detectCurrentStage(): Promise<AuthFlowStage> {
    const snapshot = await this.captureSnapshot();
    const detection = detectAuthGate(snapshot);

    if (!detection.detected) {
      return 'not_started';
    }

    switch (detection.stage) {
      case 'identification_type_selection':
      case 'identification_input':
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

  private async captureSnapshot(): Promise<PageSnapshot> {
    return await scanCurrentPage(this.page);
  }

  private async isOperationsMenuVisible(): Promise<boolean> {
    try {
      await this.operationsMenuPage.expectLoaded();
      return true;
    } catch {
      return false;
    }
  }

  async ensureAuthenticated(options: AuthFlowOptions = {}): Promise<AuthFlowResult> {
    const { alias = 'defaultClient', landing = 'transactions_menu' } = options;

    const stagesCompleted: AuthFlowStage[] = [];

    const globalWithTestData = globalThis as typeof globalThis & { __authFlowTestData?: Record<string, unknown> };
    const testData = globalWithTestData.__authFlowTestData || {};

    let client: AuthClientProfile;
    try {
      client = this.resolveClient(alias, testData);
    } catch (error) {
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
      } catch {
        await this.page.waitForTimeout(3000);
      }

      try {
        await this.identificationPage.expectLoaded();
        await this.identificationPage.selectIdentificationType(client.identificationType);
        await this.identificationPage.enterIdentificationNumber(client.identificationNumber);
        await this.identificationPage.continue();
        stagesCompleted.push('identification');
        await this.page.waitForTimeout(2000);
      } catch {
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
      } catch {
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
      } catch (error) {
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

export function setAuthFlowTestData(data: Record<string, unknown>): void {
  const globalWithTestData = globalThis as typeof globalThis & { __authFlowTestData?: Record<string, unknown> };
  globalWithTestData.__authFlowTestData = data;
}
