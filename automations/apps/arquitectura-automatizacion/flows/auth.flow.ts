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
   * Check if identification number field is filled
   */
  private async getIdentificationFieldState(): Promise<{ filled: boolean; value: string }> {
    try {
      const input = this.page.getByRole('textbox', { name: /número de identificación|numero de identificación/i }).first();
      const value = await input.inputValue().catch(() => '');
      return { filled: value.length > 0, value };
    } catch {
      return { filled: false, value: '' };
    }
  }

  /**
   * Check for visible error messages on identification page
   */
  private async getIdentificationErrors(): Promise<string[]> {
    const errors: string[] = [];
    try {
      const errorPatterns = [
        /número inválido|numero inválido|invalid number/i,
        /campo requerido|required field/i,
        /error/i,
        /no válido|no valido/i
      ];
      const texts = await this.page.getByText(/error|inválido|invalid|required/i).all();
      for (const text of texts.slice(0, 5)) {
        const content = await text.textContent().catch(() => '');
        if (content && errorPatterns.some(p => p.test(content))) {
          errors.push(content.trim());
        }
      }
    } catch {
      // No errors found
    }
    return errors;
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
          console.log(`[auth-flow] currentStage=identification_type_selection`);
          return 'identification_type_selection';
        case 'identification_input':
          console.log(`[auth-flow] currentStage=identification_input`);
          return 'identification_input';
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

  /**
   * Main authentication flow - state-aware and idempotent
   * Can be called from any state: home, protected entry, auth gate stages, or already authenticated
   */
  async ensureAuthenticated(options: AuthFlowOptions = {}): Promise<AuthFlowResult> {
    const { alias = 'defaultClient', landing = 'transactions_menu' } = options;

    const stagesCompleted: AuthFlowStage[] = [];
    const stageTransitions: string[] = [];
    const initialStage = await this.detectCurrentStage();

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
    let currentStage = initialStage;
    console.log(`[auth-flow] ensureAuthenticated called, starting from stage: ${currentStage}`);
    stageTransitions.push(`initial:${currentStage}`);

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
      stageTransitions.push(`after_iniciar:${currentStage}`);
    }

    // If on protected entry (e.g., transactions menu entry), click it to trigger AuthGate
    if (currentStage === 'protected_entry') {
      console.log(`[auth-flow] On protected entry page, clicking entry to trigger AuthGate...`);
      const previousUrl = this.page.url();
      await this.page.getByRole('button', { name: /transacciones y servicios|transacciones y services/i }).click();
      await this.waitForPageTransition(previousUrl);
      currentStage = await this.detectCurrentStage();
      stageTransitions.push(`after_protected_entry:${currentStage}`);
    }

    // If still not_started after navigation, try going to home and starting fresh
    if (currentStage === 'not_started') {
      console.log(`[auth-flow] Not started, navigating to home...`);
      const previousUrl = this.page.url();
      await this.page.goto('/');
      await this.waitForPageTransition(previousUrl);
      currentStage = await this.detectCurrentStage();
      stageTransitions.push(`after_home_nav:${currentStage}`);

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
        stageTransitions.push(`after_home_iniciar:${currentStage}`);
      }
    }

    // Now process through auth stages based on where we are
    // The key: we may already be partway through the flow

    // Stage 1: Identification type selection
    if (currentStage === 'identification_type_selection') {
      console.log(`[auth-flow] Processing identification_type_selection stage...`);
      await this.completeIdentificationType(client, stagesCompleted);
      currentStage = await this.detectCurrentStage();
      stageTransitions.push(`after_type_selection:${currentStage}`);
    }

    // Stage 2: Identification input
    if (currentStage === 'identification_input') {
      console.log(`[auth-flow] Processing identification_input stage...`);
      const identificationResult = await this.completeIdentificationInput(client, stagesCompleted);
      
      if (!identificationResult.success) {
        // Failed to complete identification - return specific error
        return {
          success: false,
          stagesCompleted,
          clientAlias: alias,
          landingDetected: undefined,
          error: identificationResult.error,
          diagnostics: {
            initialStage,
            stageTransitions,
            currentUrl: this.page.url(),
            stuckReason: identificationResult.error
          }
        };
      }
      
      currentStage = await this.detectCurrentStage();
      stageTransitions.push(`after_identification_input:${currentStage}`);
    }

    // Stage 3: Phone Confirmation (if applicable)
    if (currentStage === 'phone_confirmation') {
      console.log(`[auth-flow] Processing phone confirmation stage...`);
      await this.completePhoneConfirmation(client, stagesCompleted);
      currentStage = await this.detectCurrentStage();
      stageTransitions.push(`after_phone_confirmation:${currentStage}`);
    }

    // Stage 4: OTP
    if (currentStage === 'otp') {
      console.log(`[auth-flow] Processing OTP stage...`);
      await this.completeOtp(client, stagesCompleted);
      currentStage = await this.detectCurrentStage();
      stageTransitions.push(`after_otp:${currentStage}`);
    }

    // Finalize - only if we've progressed beyond identification
    if (currentStage === 'identification' || currentStage === 'identification_type_selection' || currentStage === 'identification_input') {
      // Still stuck at identification - should not happen if completeIdentificationInput succeeded
      return {
        success: false,
        stagesCompleted,
        clientAlias: alias,
        landingDetected: undefined,
        error: `auth_flow_stuck_identification: AuthFlow remained at ${currentStage} after identification attempt.`,
        diagnostics: {
          initialStage,
          stageTransitions,
          currentUrl: this.page.url(),
          stuckReason: 'identification_not_completed'
        }
      };
    }

    return this.finalizeAuth(stagesCompleted, alias, landing, stageTransitions, initialStage);
  }

  private async completeIdentificationType(client: AuthClientProfile, stagesCompleted: AuthFlowStage[]): Promise<void> {
    console.log(`[auth-flow] action=completeIdentificationType`);
    
    try {
      await this.identificationPage.selectIdentificationType(client.identificationType);
      console.log(`[auth-flow] Selected identification type: ${client.identificationType}`);
      stagesCompleted.push('identification_type_selection');
    } catch (error) {
      console.log(`[auth-flow] Identification type selection skipped or already completed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async completeIdentificationInput(client: AuthClientProfile, stagesCompleted: AuthFlowStage[]): Promise<{ success: boolean; error?: string }> {
    console.log(`[auth-flow] action=completeIdentificationInput`);
    console.log(`[auth-flow] completeIdentificationInput implementation=active_v3 file=arquitectura-automatizacion/auth.flow.ts`);
    
    // Interactive readiness check instead of legacy wait
    const idReadinessStart = Date.now();
    let interactiveReady = false;
    try {
      const signal = await this.page.waitForFunction(() => {
        const inputs = document.querySelectorAll('input[type="text"], input[type="tel"], input:not([type])');
        for (const inp of inputs) {
          const ctx = inp as HTMLInputElement;
          if (/identificaci[óo]n|cedula|cédula|n[úu]mero|numero/i.test(ctx.name || ctx.id || ctx.placeholder || '')) {
            return 'native_input';
          }
        }
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          if (/continuar|continue|cedula|cédula|identificaci[óo]n/i.test(btn.textContent || '')) {
            return 'continue_button';
          }
        }
        let digitCount = 0;
        for (const db of document.querySelectorAll('button')) {
          if (/^[0-9]$/.test(db.textContent?.trim() || '')) digitCount++;
          if (digitCount >= 8) return 'virtual_keyboard';
        }
        return false;
      }, { timeout: 1500 }).then(r => r).catch(() => false);
      if (signal && typeof signal === 'string') {
        interactiveReady = true;
        console.log(`[auth-flow] identificationPageReady signal=${signal} waitedMs=${Date.now() - idReadinessStart}`);
        console.log(`[auth-flow] skippedLegacyIdentificationWait reason=interactive_ready`);
      }
    } catch { /* fallback */ }
    
    if (!interactiveReady) {
      console.log(`[auth-flow] identificationPageReady signal=none waitedMs=${Date.now() - idReadinessStart} fallback=legacy_wait`);
      try {
        await this.identificationPage.expectLoaded();
      } catch {
        console.log(`[auth-flow] Waiting for identification page legacy fallback...`);
        await this.page.waitForLoadState('domcontentloaded', { timeout: 2000 });
      }
    }
    console.log(`[auth-flow:timing] stage=identification_input action=waitIdentificationPage durationMs=${Date.now() - idReadinessStart} result=${interactiveReady ? 'interactive_ready' : 'legacy_wait'}`);

    // Check current field state
    const fieldState = await this.getIdentificationFieldState();
    console.log(`[auth-flow] Identification field state: filled=${fieldState.filled}, valueLength=${fieldState.value.length}`);

    // Enter identification number if not already filled or different
    if (!fieldState.filled || fieldState.value !== client.identificationNumber) {
      try {
        await this.identificationPage.enterIdentificationNumber(client.identificationNumber);
        console.log(`[auth-flow] Entered identification number`);
      } catch (error) {
        return {
          success: false,
          error: `auth_flow_identification_input_failed: Could not enter identification number. ${error instanceof Error ? error.message : String(error)}`
        };
      }
    } else {
      console.log(`[auth-flow] Identification number already filled`);
    }

    // Click continue
    const previousUrl = this.page.url();
    try {
      await this.identificationPage.continue();
      console.log(`[auth-flow] Clicked continue`);
    } catch (error) {
      return {
        success: false,
        error: `auth_flow_continue_click_failed: Could not click continue button. ${error instanceof Error ? error.message : String(error)}`
      };
    }

    // Wait for transition with signal-based detection instead of fixed timeout
    const afterSubmitStart = Date.now();
    const maxRetries = 1;
    let retries = 0;
    
    while (retries <= maxRetries) {
      // Signal-based wait: poll for stage change or URL change
      const transitionDetected = await this.page.waitForFunction(
        (prevUrl) => {
          if (window.location.href !== prevUrl) return 'url_change';
          const body = document.body?.innerText || '';
          if (/tel[eé]fono|phone|otp|c[oó]digo|confirmaci[óo]n|identificaci[óo]n|cedula|cédula/i.test(body)) return 'stage_text';
          return false;
        },
        previousUrl,
        { timeout: 5000 }
      ).then(r => r).catch(() => false);

      const waitedMs = Date.now() - afterSubmitStart;
      if (transitionDetected) {
        console.log(`[auth-flow] afterIdentificationSubmit signal=${transitionDetected} waitedMs=${waitedMs}`);
      } else {
        console.log(`[auth-flow] afterIdentificationSubmit signal=timeout waitedMs=${waitedMs}`);
        await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
      }
      
      const nextStage = await this.detectCurrentStage();
      console.log(`[auth-flow] After continue click (attempt ${retries + 1}): stage=${nextStage}`);
      
      // Successfully transitioned to next stage
      if (nextStage === 'phone_confirmation' || nextStage === 'otp' || nextStage === 'authenticated') {
        stagesCompleted.push('identification_input');
        console.log(`[auth-flow] completed stage=identification_input, transitioned to=${nextStage}`);
        console.log(`[auth-flow:timing] stage=identification_input action=submitIdentification durationMs=${Date.now() - afterSubmitStart} result=stage_advanced`);
        return { success: true };
      }
      
      // Still at identification_input - check for errors
      if (nextStage === 'identification_input') {
        const errors = await this.getIdentificationErrors();
        if (errors.length > 0) {
          return {
            success: false,
            error: `auth_flow_identification_validation_error: Identification rejected. Errors: [${errors.join(', ')}]`
          };
        }
        
        // No errors visible - check if field was cleared (needs retry)
        const newFieldState = await this.getIdentificationFieldState();
        if (!newFieldState.filled && retries < maxRetries) {
          console.log(`[auth-flow] Field was cleared, retrying identification input`);
          retries++;
          continue;
        }
        
        // Field still filled but no transition - might be a UI issue
        if (retries < maxRetries) {
          console.log(`[auth-flow] No transition, retrying continue click`);
          retries++;
          try {
            await this.identificationPage.continue();
          } catch {
            // Continue to next iteration
          }
          continue;
        }
      }
      
      // Unknown stage - break and let caller handle
      break;
    }
    
    // Max retries exceeded - still stuck
    const finalStage = await this.detectCurrentStage();
    const errors = await this.getIdentificationErrors();
    return {
      success: false,
      error: `auth_flow_stuck_identification_input: AuthFlow stuck at identification_input after ${maxRetries + 1} attempts. Final stage: ${finalStage}, Errors: [${errors.join(', ')}], URL: ${this.page.url()}`
    };
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

  private async finalizeAuth(
    stagesCompleted: AuthFlowStage[],
    alias: string,
    landing: string,
    stageTransitions: string[],
    initialStage: AuthFlowStage
  ): Promise<AuthFlowResult> {
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
        landingDetected: landing,
        diagnostics: {
          initialStage,
          stageTransitions,
          finalStage,
          currentUrl: this.page.url()
        }
      };
    }

    // Get diagnostic info for error
    const snapshot = await this.captureSnapshot();
    const errors = await this.getIdentificationErrors();
    const error = `auth_flow_final_stage_error: Authentication did not reach expected landing. ` +
      `Initial stage: ${initialStage}, Final stage: ${finalStage}, menu visible: ${isMenuVisible}, ` +
      `currentUrl: ${snapshot.url}, stageTransitions: [${stageTransitions.join(', ')}], ` +
      `visibleErrors: [${errors.join(', ')}]`;
    console.log(`[auth-flow] ${error}`);
    
    return {
      success: false,
      stagesCompleted,
      clientAlias: alias,
      landingDetected: undefined,
      error,
      diagnostics: {
        initialStage,
        stageTransitions,
        finalStage,
        currentUrl: this.page.url(),
        visibleErrors: errors
      }
    };
  }
}

export function setAuthFlowTestData(data: Record<string, unknown>): void {
  const globalWithTestData = globalThis as typeof globalThis & { __authFlowTestData?: Record<string, unknown> };
  globalWithTestData.__authFlowTestData = data;
}
