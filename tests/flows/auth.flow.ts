import { Page } from '@playwright/test';
import { IdentificationPage } from '../pages/identification.page';
import { PhoneConfirmationPage } from '../pages/phoneconfirmation.page';
import { OtpComponent } from '../components/otp.component';
import { OperationsMenuPage } from '../pages/operationsmenu.page';
import type { AuthFlowOptions, AuthFlowResult, AuthFlowStage, AuthClientProfile } from '../../src/types/auth-flow.types';
import { detectAuthGate } from '../../src/discovery/auth-gate-detector';
import type { PageSnapshot } from '../../src/types/page-snapshot.types';
import { scanCurrentPage } from '../../src/explorer/page-scanner';

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

  private async captureSnapshot(): Promise<PageSnapshot> {
    return await scanCurrentPage(this.page);
  }

  /**
   * Detect current auth flow stage with comprehensive state awareness
   * Returns the specific stage we're currently on
   */
  private async detectCurrentStage(): Promise<AuthFlowStage> {
    const snapshot = await this.captureSnapshot();
    const detection = detectAuthGate(snapshot);
    const currentUrl = snapshot.url;

    // Check for authenticated/operations menu state first (highest priority)
    if (await this.isOperationsMenuVisible()) {
      console.log(`[auth-flow] Detected stage: authenticated (operations menu visible)`);
      return 'authenticated';
    }

    // Check for authentication success page (URL-based detection)
    if (/authentication-success|auth-success|login-success|authenticated|welcome|bienvenido|operaciones|operations-menu/i.test(currentUrl)) {
      console.log(`[auth-flow] Detected stage: authenticated (success page: ${currentUrl})`);
      return 'authenticated';
    }

    // Check for AuthGate stages
    if (detection.detected) {
      console.log(`[auth-flow] Detected AuthGate: ${detection.gateType} at stage: ${detection.stage}`);
      switch (detection.stage) {
        case 'identification_type_selection':
        case 'identification_input':
          console.log(`[auth-flow] currentStage=identification`);
          return 'identification';
        case 'phone_confirmation':
          console.log(`[auth-flow] currentStage=phone_confirmation`);
          return 'phone_confirmation';
        case 'otp':
          console.log(`[auth-flow] currentStage=otp`);
          return 'otp';
        case 'authenticated_landing':
          console.log(`[auth-flow] currentStage=authenticated`);
          return 'authenticated';
      }
    }

    // Check for home page with "Iniciar" button
    if (await this.isIniciarVisible()) {
      console.log(`[auth-flow] Detected stage: home (Iniciar visible)`);
      return 'home';
    }

    // Check for protected entry point visible (e.g., "Transacciones y servicios")
    if (await this.isTransactionsEntryVisible()) {
      console.log(`[auth-flow] Detected stage: protected_entry (transactions entry visible)`);
      return 'protected_entry';
    }

    console.log(`[auth-flow] Detected stage: not_started (url=${currentUrl})`);
    return 'not_started';
  }

  private async isOperationsMenuVisible(): Promise<boolean> {
    try {
      await this.operationsMenuPage.expectLoaded();
      return true;
    } catch {
      return false;
    }
  }

  private async isIniciarVisible(): Promise<boolean> {
    try {
      const iniciarBtn = this.page.getByRole('button', { name: /^iniciar$/i });
      return await iniciarBtn.isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  private async isTransactionsEntryVisible(): Promise<boolean> {
    try {
      const txBtn = this.page.getByRole('button', { name: /transacciones y servicios|transacciones y services/i });
      return await txBtn.isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  /**
   * Wait for page transition using URL change or selector stability
   * More reliable than fixed timeouts
   */
  private async waitForPageTransition(previousUrl: string, timeoutMs: number = 5000): Promise<void> {
    try {
      await this.page.waitForFunction(
        (prevUrl) => window.location.href !== prevUrl,
        previousUrl,
        { timeout: timeoutMs }
      );
      console.log(`[auth-flow] Page transition detected (URL changed)`);
    } catch {
      // URL didn't change, wait for DOM stability
      console.log(`[auth-flow] Waiting for DOM stability...`);
      await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 });
    }
  }

  /**
   * Main authentication flow - state-aware and idempotent
   * Can be called from any state: home, protected entry, auth gate stages, or already authenticated
   */
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

    // Detect current stage - this is the key to idempotency
    let currentStage = await this.detectCurrentStage();
    console.log(`[auth-flow] ensureAuthenticated called, starting from stage: ${currentStage}`);

    // If already authenticated, return immediately
    if (currentStage === 'authenticated') {
      console.log(`[auth-flow] Already authenticated, returning fast`);
      return {
        success: true,
        stagesCompleted: ['authenticated'],
        clientAlias: alias,
        landingDetected: landing
      };
    }

    // If on home page, click "Iniciar" to start auth flow
    if (currentStage === 'home') {
      console.log(`[auth-flow] On home page, clicking Iniciar...`);
      const previousUrl = this.page.url();
      await this.page.getByRole('button', { name: /^iniciar$/i }).click();
      await this.waitForPageTransition(previousUrl);
      currentStage = await this.detectCurrentStage();
    }

    // If on protected entry (e.g., transactions menu entry), click it to trigger AuthGate
    if (currentStage === 'protected_entry') {
      console.log(`[auth-flow] On protected entry page, clicking entry to trigger AuthGate...`);
      const previousUrl = this.page.url();
      await this.page.getByRole('button', { name: /transacciones y servicios|transacciones y services/i }).click();
      await this.waitForPageTransition(previousUrl);
      currentStage = await this.detectCurrentStage();
    }

    // If still not_started after navigation, try going to home and starting fresh
    if (currentStage === 'not_started') {
      console.log(`[auth-flow] Not started, navigating to home...`);
      const previousUrl = this.page.url();
      await this.page.goto('/');
      await this.waitForPageTransition(previousUrl);
      currentStage = await this.detectCurrentStage();

      if (currentStage === 'authenticated') {
        console.log(`[auth-flow] Already authenticated after navigation`);
        return {
          success: true,
          stagesCompleted: ['authenticated'],
          clientAlias: alias,
          landingDetected: landing
        };
      }

      if (await this.isIniciarVisible()) {
        console.log(`[auth-flow] Clicking Iniciar from home...`);
        const previousUrl2 = this.page.url();
        await this.page.getByRole('button', { name: /^iniciar$/i }).click();
        await this.waitForPageTransition(previousUrl2);
        currentStage = await this.detectCurrentStage();
      }
    }

    // Now process through auth stages based on where we are
    // The key: we may already be partway through the flow

    // Stage 1: Identification
    if (currentStage === 'identification' || currentStage === 'not_started' || currentStage === 'home') {
      console.log(`[auth-flow] Processing identification stage...`);
      await this.completeIdentification(client, stagesCompleted);
      currentStage = await this.detectCurrentStage();
    }

    // Stage 2: Phone Confirmation (if applicable)
    if (currentStage === 'phone_confirmation') {
      console.log(`[auth-flow] Processing phone confirmation stage...`);
      await this.completePhoneConfirmation(client, stagesCompleted);
      currentStage = await this.detectCurrentStage();
    }

    // Stage 3: OTP
    if (currentStage === 'otp' || currentStage === 'phone_confirmation') {
      console.log(`[auth-flow] Processing OTP stage...`);
      await this.completeOtp(client, stagesCompleted);
      currentStage = await this.detectCurrentStage();
    }

    // Finalize
    return this.finalizeAuth(stagesCompleted, alias, landing);
  }

  private async completeIdentification(client: AuthClientProfile, stagesCompleted: AuthFlowStage[]): Promise<void> {
    console.log(`[auth-flow] action=completeIdentification`);
    
    // Wait for identification page to be ready
    try {
      await this.identificationPage.expectLoaded();
      console.log(`[auth-flow] Identification page loaded`);
    } catch {
      console.log(`[auth-flow] Waiting for identification page...`);
      await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 });
    }

    try {
      await this.identificationPage.selectIdentificationType(client.identificationType);
      console.log(`[auth-flow] Selected identification type: ${client.identificationType}`);
      
      await this.identificationPage.enterIdentificationNumber(client.identificationNumber);
      console.log(`[auth-flow] Entered identification number`);
      
      await this.identificationPage.continue();
      console.log(`[auth-flow] Clicked continue`);
      
      stagesCompleted.push('identification');
      console.log(`[auth-flow] completed stage=identification`);
      
      // Wait for transition
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    } catch (error) {
      console.log(`[auth-flow] Identification step skipped or already completed: ${error instanceof Error ? error.message : String(error)}`);
      // Identification may already be done or not visible
    }
  }

  private async completePhoneConfirmation(client: AuthClientProfile, stagesCompleted: AuthFlowStage[]): Promise<void> {
    console.log(`[auth-flow] action=completePhoneConfirmation`);
    
    try {
      await this.phoneConfirmationPage.expectLoaded();
      console.log(`[auth-flow] Phone confirmation page loaded`);
      
      if (client.expectedPhoneLast4) {
        await this.phoneConfirmationPage.expectPhoneLast4(client.expectedPhoneLast4);
        console.log(`[auth-flow] Verified phone last 4: ${client.expectedPhoneLast4}`);
      }
      
      await this.phoneConfirmationPage.confirmPhone();
      console.log(`[auth-flow] Confirmed phone`);
      
      stagesCompleted.push('phone_confirmation');
      console.log(`[auth-flow] completed stage=phone_confirmation`);
      
      // Wait for transition
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    } catch (error) {
      console.log(`[auth-flow] Phone confirmation skipped: ${error instanceof Error ? error.message : String(error)}`);
      // Phone confirmation may be skipped
    }
  }

  private async completeOtp(client: AuthClientProfile, stagesCompleted: AuthFlowStage[]): Promise<void> {
    console.log(`[auth-flow] action=completeOtp`);
    
    // Wait for OTP input to be ready
    try {
      await this.page.waitForSelector('input[type="text"][maxlength="6"], input[placeholder*="OTP"], input[placeholder*="código"], input[placeholder*="codigo"]', { timeout: 5000 });
      console.log(`[auth-flow] OTP input found`);
    } catch {
      console.log(`[auth-flow] OTP input not found, continuing...`);
    }

    try {
      await this.otpComponent.enterOtp(client.otp);
      console.log(`[auth-flow] Entered OTP`);
      
      await this.otpComponent.confirmCode();
      console.log(`[auth-flow] Confirmed OTP code`);
      
      stagesCompleted.push('otp');
      console.log(`[auth-flow] completed stage=otp`);
      
      // Wait for authentication to complete
      await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    } catch (error) {
      console.log(`[auth-flow] OTP entry failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async finalizeAuth(stagesCompleted: AuthFlowStage[], alias: string, landing: string): Promise<AuthFlowResult> {
    console.log(`[auth-flow] action=finalizeAuth`);
    
    // Wait for final page to stabilize
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    
    const finalStage = await this.detectCurrentStage();
    const isMenuVisible = await this.isOperationsMenuVisible();

    console.log(`[auth-flow] Final stage: ${finalStage}, menu visible: ${isMenuVisible}`);

    if (finalStage === 'authenticated' || isMenuVisible) {
      stagesCompleted.push('authenticated');
      console.log(`[auth-flow] Authentication completed successfully`);
      return {
        success: true,
        stagesCompleted,
        clientAlias: alias,
        landingDetected: landing
      };
    }

    // Get diagnostic info for error
    const snapshot = await this.captureSnapshot();
    const error = `Authentication did not reach expected landing. Final stage: ${finalStage}, menu visible: ${isMenuVisible}, currentUrl: ${snapshot.url}`;
    console.log(`[auth-flow] ${error}`);
    
    return {
      success: false,
      stagesCompleted,
      clientAlias: alias,
      landingDetected: undefined,
      error
    };
  }
}

export function setAuthFlowTestData(data: Record<string, unknown>): void {
  const globalWithTestData = globalThis as typeof globalThis & { __authFlowTestData?: Record<string, unknown> };
  globalWithTestData.__authFlowTestData = data;
}
