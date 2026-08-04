import { Page } from '@playwright/test';
import { IdentificationPage } from '../pages/identification.page';
import { PhoneConfirmationPage } from '../pages/phoneconfirmation.page';
import { OtpComponent } from '../components/otp.component';
import { OperationsMenuPage } from '../pages/operationsmenu.page';
import type { AuthFlowOptions, AuthFlowResult, AuthFlowStage, AuthClientProfile } from '../../../../src/types/auth-flow.types';
import { detectAuthGate } from '../../../../src/discovery/auth-gate-detector';
import type { PageSnapshot } from '../../../../src/types/page-snapshot.types';
import { scanCurrentPage } from '../../../../src/explorer/page-scanner';

type StageResult = { success: boolean; nextStage: AuthFlowStage; signal: string; reason?: string };
const OK = (nextStage: AuthFlowStage, signal: string): StageResult => ({ success: true, nextStage, signal });
const FAIL = (nextStage: AuthFlowStage, signal: string, reason?: string): StageResult => ({ success: false, nextStage, signal, reason });

export const AUTH_FLOW_IMPLEMENTATION_ID = "auth_state_machine_v2";

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

  /** Quick check: is the next stage's target control already interactive? */
  private async isStageControlReady(stage: AuthFlowStage): Promise<{ ready: boolean; signal: string }> {
    try {
      if (stage === 'identification_input') {
        const has = await this.page.locator('input[type="text"]:visible, input[type="tel"]:visible, [class*="keyboard"]:visible, [class*="teclado"]:visible, button:has-text("Continuar"):visible, button:has-text("Identificar"):visible').first().isVisible({ timeout: 300 }).catch(() => false);
        return { ready: has, signal: has ? 'input_or_keyboard_or_continue' : 'none' };
      }
      if (stage === 'phone_confirmation') {
        const has = await this.page.getByRole('button', { name: /confirmar|continuar|verificar|si|aceptar|enviar/i }).first().isVisible({ timeout: 300 }).catch(() => false);
        return { ready: has, signal: has ? 'confirm_button_visible' : 'none' };
      }
      if (stage === 'otp') {
        const has = await this.page.locator('input:visible, [class*="otp"]:visible, [class*="pin"]:visible, button:visible:has-text("0")').first().isVisible({ timeout: 300 }).catch(() => false);
        return { ready: has, signal: has ? 'otp_control_visible' : 'none' };
      }
    } catch { /* non-fatal */ }
    return { ready: false, signal: 'none' };
  }

  /** Wait for the next stage to be ready, avoiding loadState if controls already visible */
  private async ensureStageReady(targetStage: AuthFlowStage, previousUrl: string): Promise<void> {
    const waitStart = Date.now();

    // Immediate check: are controls already present?
    const immediate = await this.isStageControlReady(targetStage);
    if (immediate.ready) {
      console.log(`[auth-flow:wait] stage=${targetStage} waitName=ensureStageReady durationMs=${Date.now() - waitStart} resolvedBy=immediate_${immediate.signal}`);
      return;
    }

    // Wait for URL change first
    try {
      await this.page.waitForFunction(
        (prevUrl) => window.location.href !== prevUrl,
        previousUrl,
        { timeout: 3000 }
      );
      console.log(`[auth-flow:wait] stage=${targetStage} waitName=ensureStageReady durationMs=${Date.now() - waitStart} resolvedBy=url_change`);
      return;
    } catch { /* no URL change */ }

    // Fallback: quick DOM stability
    try {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 1500 });
    } catch { /* non-fatal */ }

    // Re-check after brief wait
    const retry = await this.isStageControlReady(targetStage);
    console.log(`[auth-flow:wait] stage=${targetStage} waitName=ensureStageReady durationMs=${Date.now() - waitStart} resolvedBy=${retry.ready ? `retry_${retry.signal}` : 'timeout'}`);
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
    console.log(`[auth-flow] implementationId=auth_state_machine_v2 sourceFile=arquitectura-automatizacion/auth.flow.ts function=ensureAuthenticated`);
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
      await this.ensureStageReady('identification_type_selection', previousUrl);
      currentStage = await this.detectCurrentStage();
      stageTransitions.push(`after_iniciar:${currentStage}`);
    }

    // If on protected entry (e.g., transactions menu entry), click it to trigger AuthGate
    if (currentStage === 'protected_entry') {
      console.log(`[auth-flow] On protected entry page, clicking entry to trigger AuthGate...`);
      const previousUrl = this.page.url();
      await this.page.getByRole('button', { name: /transacciones y servicios|transacciones y services/i }).click();
      await this.ensureStageReady('identification_type_selection', previousUrl);
      currentStage = await this.detectCurrentStage();
      stageTransitions.push(`after_protected_entry:${currentStage}`);
    }

    // If still not_started after navigation, try going to home and starting fresh
    if (currentStage === 'not_started') {
      console.log(`[auth-flow] Not started, navigating to home...`);
      const previousUrl = this.page.url();
      await this.page.goto('/');
      await this.ensureStageReady('home', previousUrl);
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
        await this.ensureStageReady('identification_type_selection', previousUrl2);
        currentStage = await this.detectCurrentStage();
        stageTransitions.push(`after_home_iniciar:${currentStage}`);
      }
    }

    // State-machine loop: process stages until authenticated or failed
    const maxTransitions = 6;
    let transitions = 0;

    while (currentStage !== 'authenticated' && transitions < maxTransitions) {
      console.log(`[auth-flow] stateLoop iteration=${transitions} currentStage=${currentStage}`);
      transitions++;

      let stageResult: StageResult | undefined;
      switch (currentStage) {
        case 'identification_type_selection':
          stageResult = await this.completeIdentificationType(client, stagesCompleted);
          break;
        case 'identification_input':
          stageResult = await this.completeIdentificationInput(client, stagesCompleted);
          break;
        case 'phone_confirmation':
          stageResult = await this.completePhoneConfirmation(client, stagesCompleted);
          break;
        case 'otp':
          stageResult = await this.completeOtp(client, stagesCompleted);
          break;
        case 'home':
          if (stagesCompleted.includes('otp')) {
            console.log(`[auth-flow] stateLoop home after otp → authenticated`);
            stagesCompleted.push('authenticated');
            currentStage = 'authenticated';
          } else {
            currentStage = 'authenticated';
          }
          break;
        case 'protected_entry':
        case 'not_started':
          currentStage = 'authenticated';
          break;
        default:
          currentStage = 'authenticated';
          break;
      }

      if (stageResult && !stageResult.success) {
        return { success: false, stagesCompleted, clientAlias: alias, landingDetected: undefined, error: `stage_failed: ${currentStage}`, diagnostics: { initialStage, stageTransitions, currentUrl: this.page.url() } };
      }
      if (stageResult) {
        const prevStage = currentStage;
        currentStage = stageResult.nextStage;
        stageTransitions.push(`${prevStage}→${currentStage}`);
        console.log(`[auth-flow] stateLoop transition ${prevStage} → ${currentStage} signal=${stageResult.signal}`);
      }
    }

    // Finalize
    if (currentStage === 'authenticated' || stagesCompleted.includes('otp') || stagesCompleted.includes('authenticated')) {
      return this.finalizeAuth(stagesCompleted, alias, landing, stageTransitions, initialStage);
    }

    // Still stuck
    return {
      success: false,
      stagesCompleted,
      clientAlias: alias,
      landingDetected: undefined,
      error: `auth_flow_incomplete: Ended at ${currentStage} after ${transitions} transitions.`,
      diagnostics: { initialStage, stageTransitions, currentUrl: this.page.url() }
    };
  }

  private async completeIdentificationType(client: AuthClientProfile, stagesCompleted: AuthFlowStage[]): Promise<StageResult> {
    console.log(`[auth-flow] action=completeIdentificationType`);
    if (stagesCompleted.includes('identification_type_selection')) {
      console.log(`[auth-flow] stageGuard stage=identification_type_selection alreadyCompleted=true nextStage=identification_input`);
      return OK('identification_input', 'already_completed');
    }
    const t0 = Date.now();
    
    try {
      await this.identificationPage.selectIdentificationType(client.identificationType);
      console.log(`[auth-flow] Selected identification type: ${client.identificationType}`);
      console.log(`[auth-flow:timing] stage=identification_type action=select durationMs=${Date.now() - t0}`);
      stagesCompleted.push('identification_type_selection');
    } catch (error) {
      console.log(`[auth-flow] Identification type selection skipped or already completed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`[auth-flow:timing] stage=identification_type action=select durationMs=${Date.now() - t0} result=skipped`);
    }
    return OK('identification_input', 'type_selected');
  }

  private async completeIdentificationInput(client: AuthClientProfile, stagesCompleted: AuthFlowStage[]): Promise<StageResult> {
    console.log(`[auth-flow] action=completeIdentificationInput`);
    // Prevent double identification
    if (stagesCompleted.includes('identification_input')) {
      console.log(`[auth-flow] stageGuard stage=identification_input alreadyCompleted=true nextStage=phone_confirmation`);
      return OK('phone_confirmation', 'already_completed');
    }
    
    // Interactive readiness check instead of legacy wait
    const idReadinessStart = Date.now();
    let interactiveReady = false;
    // Wait for the identification input field to appear (SPA may update DOM after type selection)
    const maxWait = 10000;
    const start = Date.now();
    while (!interactiveReady && (Date.now() - start) < maxWait) {
      try {
        // Specifically look for a text input field that can receive the identification number
        const hasInput = await this.page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])').first().isVisible({ timeout: 1000 }).catch(() => false);
        if (hasInput) { interactiveReady = true; console.log(`[auth-flow] identificationPageReady signal=any_input_visible waitedMs=${Date.now() - idReadinessStart}`); break; }
      } catch { /* retry */ }
    }

    if (!interactiveReady) {
      console.log(`[auth-flow] identificationPageReady signal=none waitedMs=${Date.now() - idReadinessStart} fallback=legacy_wait`);
      try { await this.identificationPage.expectLoaded(); } catch {}
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
        return FAIL('identification_input', 'enter_failed', `auth_flow_identification_input_failed: ${error instanceof Error ? error.message : String(error)}`);
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
      return FAIL('identification_input', 'continue_failed', `auth_flow_continue_click_failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Wait for transition with signal-based detection
    const afterSubmitStart = Date.now();

    // First: wait for a real signal (URL change, phone page visible, OTP visible)
    const transitionDetected = await this.page.waitForFunction(
      (prevUrl) => {
        if (window.location.href !== prevUrl) return 'url_change';
        const body = document.body?.innerText || '';
        if (/tel[eé]fono|phone|confirmar\s+(?:tel[eé]fono|n[uú]mero|m[oó]vil)/i.test(body)) return 'phone_visible';
        if (/\botp\b|(?:\b|[^a-z])c[oó]digo(?:\b|[^a-z])/i.test(body)) return 'otp_visible';
        return false;
      },
      previousUrl,
      { timeout: 8000 }
    ).then(r => r).catch(() => false);

    const transitionWaitedMs = Date.now() - afterSubmitStart;
    console.log(`[auth-flow] afterIdentificationSubmit signal=${transitionDetected || 'timeout'} waitedMs=${transitionWaitedMs}`);

    // If URL changed or next stage signals detected, probe the actual stage
    if (transitionDetected) {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => {});
    }

    const nextStage = await this.detectCurrentStage();
    console.log(`[auth-flow] After continue click: stage=${nextStage} durationMs=${Date.now() - afterSubmitStart}`);

    // Successfully transitioned
    if (nextStage === 'phone_confirmation' || nextStage === 'otp' || nextStage === 'authenticated') {
      stagesCompleted.push('identification_input');
      console.log(`[auth-flow] completed stage=identification_input → ${nextStage}`);
      console.log(`[auth-flow:timing] stage=identification_input action=submitIdentification durationMs=${Date.now() - afterSubmitStart} result=stage_advanced`);
      console.log(`[auth-state] from=identification_input to=${nextStage} signal=${transitionDetected || 'url_change'} durationMs=${Date.now() - afterSubmitStart} retried=false`);
      return OK(nextStage, transitionDetected || 'url_change_advanced');
    }

    // Still at identification - check if there are explicit validation errors
    if (nextStage === 'identification_input') {
      const errors = await this.getIdentificationErrors();
      if (errors.length > 0) {
        return FAIL('identification_input', 'validation_error', `auth_flow_identification_rejected: [${errors.join(', ')}]`);
      }

      // No visible errors, no transition signal — field might have been cleared
      const fieldState = await this.getIdentificationFieldState();
      if (!fieldState.filled) {
        console.log(`[auth-flow] Field was cleared after submit, retrying once`);
        try {
          await this.identificationPage.enterIdentificationNumber(client.identificationNumber);
          await this.identificationPage.continue();
          await this.page.waitForURL((u) => u !== previousUrl, { timeout: 8000 }).catch(() => {});
          const stage2 = await this.detectCurrentStage();
          if (stage2 !== 'identification_input') {
            stagesCompleted.push('identification_input');
            console.log(`[auth-flow:timing] stage=identification_input action=submitIdentification durationMs=${Date.now() - afterSubmitStart} result=stage_advanced_after_retry`);
            console.log(`[auth-state] from=identification_input to=${stage2} signal=url_change durationMs=${Date.now() - afterSubmitStart} retried=true`);
            return OK(stage2, 'url_change_retry');
          }
        } catch { /* non-fatal */ }
      }
    }

    // Failed to transition
    const finalStage = await this.detectCurrentStage();
    return FAIL('identification_input', 'stuck', `auth_flow_stuck_identification: Still at ${finalStage} after submit. URL: ${this.page.url()}`);
  }

  private async completePhoneConfirmation(client: AuthClientProfile, stagesCompleted: AuthFlowStage[]): Promise<StageResult> {
    console.log(`[auth-flow] action=completePhoneConfirmation`);
    if (stagesCompleted.includes('phone_confirmation')) {
      console.log(`[auth-flow] stageGuard stage=phone_confirmation alreadyCompleted=true nextStage=otp`);
      return OK('otp', 'already_completed');
    }
    const t0 = Date.now();

    // Immediate check: is confirm button already ready?
    const btnCheck = await this.page.getByRole('button', { name: /confirmar|continuar|verificar|si|aceptar|enviar/i }).first();
    const btnImmediate = await btnCheck.isVisible({ timeout: 300 }).catch(() => false);
    const btnEnabled = btnImmediate ? await btnCheck.isEnabled().catch(() => false) : false;

    if (btnImmediate && btnEnabled) {
      console.log(`[auth-flow] phoneConfirmImmediate visible=true enabled=true clickDelayMs=${Date.now() - t0}`);
    } else {
      // Wait for the page to be ready
      try { await this.phoneConfirmationPage.expectLoaded(); } catch { /* non-fatal */ }
      console.log(`[auth-flow] phoneConfirmImmediate visible=${btnImmediate} enabled=${btnEnabled} clickDelayMs=${Date.now() - t0}`);
    }
    console.log(`[auth-flow:timing] stage=phone_confirmation action=interactive_ready durationMs=${Date.now() - t0}`);

    try {
      if (client.expectedPhoneLast4) {
        await this.phoneConfirmationPage.expectPhoneLast4(client.expectedPhoneLast4);
        console.log(`[auth-flow] Verified phone last 4: ${client.expectedPhoneLast4}`);
      }
    } catch { /* non-fatal */ }

    const tc = Date.now();
    // Store URL before click so the waitForFunction can detect URL change
    const phUrlBefore = this.page.url();
    await this.page.evaluate((url) => { (window as any).__phUrl = url; }, phUrlBefore);
    await btnCheck.click().catch(async () => {
      await this.phoneConfirmationPage.confirmPhone();
    });
    console.log(`[auth-flow] Confirmed phone`);
    console.log(`[auth-flow:timing] stage=phone_confirmation action=confirm durationMs=${Date.now() - tc}`);

    // Wait for OTP screen using structural signals, not body text
    const ptStart = Date.now();
    let otpSignal = "";
    try {
      otpSignal = await this.page.waitForFunction(() => {
        const visibleBtns: Element[] = [];
        const allBtns = document.querySelectorAll('button, [role="button"]');
        for (const b of allBtns) {
          const rect = b.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const style = window.getComputedStyle(b);
          if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
          visibleBtns.push(b);
        }

        // A: 10+ digit buttons (0-9) visible
        let digitCount = 0;
        for (const b of visibleBtns) {
          if (/^[0-9]$/.test((b.textContent || '').trim())) digitCount++;
        }
        if (digitCount >= 10) return 'digit_keypad';

        // B: "confirmar codigo" or "reenviar en" button visible
        const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        for (const b of visibleBtns) {
          const t = norm(b.textContent || '');
          if (t === 'confirmar codigo') return 'otp_confirm_button';
          if (t.startsWith('reenviar en')) return 'otp_confirm_button';
        }

        // C: URL changed from phone confirmation
        if (window.location.href !== (window as any).__phUrl) return 'url_change';

        return false;
      }, { timeout: 8000 }).then(r => (r && r !== false) ? r : '').catch(() => '');
    } catch { /* non-fatal */ }
    const ptDuration = Date.now() - ptStart;

    // Fallback: check DOM stability if no structural signal found
    if (!otpSignal) {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 2000 });
    }

    console.log(`[auth-flow] phoneToOtpTransition urlChanged=${otpSignal === 'url_change'} digitButtons=${otpSignal === 'digit_keypad' ? '10+' : '0'} otpConfirmVisible=${otpSignal === 'otp_confirm_button'} signal=${otpSignal || 'timeout'} durationMs=${ptDuration}`);

    stagesCompleted.push('phone_confirmation');
    console.log(`[auth-flow] completed stage=phone_confirmation`);
    console.log(`[auth-flow:timing] stage=phone_confirmation totalDurationMs=${Date.now() - t0}`);
    return OK('otp', otpSignal || 'completed');
  }

  private async waitForOtpTransition(urlBefore: string): Promise<string> {
    try {
      await this.page.waitForURL((url) => url !== urlBefore, { timeout: 8000 });
      // Verify it's not just a same-OTP-page refresh
      const body = document.body?.innerText || '';
      const pageRef = this.page;
      try {
        const stillOtp = await pageRef.waitForFunction(() => {
          const visibleBtns: Element[] = [];
          document.querySelectorAll('button, [role="button"]').forEach(b => {
            const r = b.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              const s = window.getComputedStyle(b);
              if (s.display !== 'none' && s.visibility !== 'hidden') visibleBtns.push(b);
            }
          });
          let digits = 0;
          for (const b of visibleBtns) { if (/^[0-9]$/.test((b.textContent || '').trim())) digits++; }
          return digits >= 10; // OTP keypad still visible
        }, { timeout: 1500 }).then(r => r).catch(() => false);
        if (!stillOtp) return "url_change";
      } catch { return "url_change"; }
      return "no_transition";
    } catch {
      try { if (await this.isOperationsMenuVisible()) return "private_menu"; } catch {}
      try {
        const home = await this.page.locator('button:has-text("Iniciar")').first().isVisible({ timeout: 2000 }).catch(() => false);
        if (home) return "home_visible";
      } catch {}
      try {
        const landing = await this.page.locator('[class*="main"], [class*="dashboard"], [class*="content"], [class*="menu"]').first().isVisible({ timeout: 2000 }).catch(() => false);
        if (landing) return "auth_gate_cleared";
      } catch {}
      try {
        const err = await this.page.locator('[class*="error"], [class*="alert"]').first().isVisible({ timeout: 1000 }).catch(() => false);
        if (err) return "visible_error";
      } catch {}
      return "no_transition";
    }
  }

  private async completeOtp(client: AuthClientProfile, stagesCompleted: AuthFlowStage[]): Promise<StageResult> {
    console.log(`[auth-flow] action=completeOtp`);
    // Prevent double OTP attempt
    if (stagesCompleted.includes('otp')) {
      console.log(`[auth-flow] stageGuard stage=otp alreadyCompleted=true nextStage=authenticated`);
      return OK('authenticated', 'already_completed');
    }
    console.log(`[auth-flow] otpAttempt started attemptId=${Date.now()}`);
    const code = client.otp;
    const expectedDigits = (code && code.length) || 6;

    const probeStart = Date.now();

    // ── Frame & Shadow DOM probe ──
    const frames = this.page.frames();
    console.log(`[auth-flow] otpFrameProbe frameCount=${frames.length}`);

    // Shadow DOM probe
    const shadowInfo = await this.page.evaluate(() => {
      let openRoots = 0; let numericBtns = 0; let inputs = 0;
      const walk = (root: Document | ShadowRoot | Element) => {
        if (root instanceof ShadowRoot) openRoots++;
        (root as any).querySelectorAll?.('input, [contenteditable="true"]')?.forEach(() => inputs++);
        const btns = (root as any).querySelectorAll?.('button, [role="button"]');
        btns?.forEach((b: any) => { if (/^[0-9]$/.test((b.textContent || '').trim())) numericBtns++; });
        (root as any).querySelectorAll?.('*')?.forEach((el: any) => {
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      };
      walk(document);
      return { openRoots, numericBtns, inputs };
    }).catch(() => ({ openRoots: 0, numericBtns: 0, inputs: 0 }));
    console.log(`[auth-flow] otpShadowProbe openShadowRoots=${shadowInfo.openRoots} numericButtons=${shadowInfo.numericBtns} inputs=${shadowInfo.inputs}`);

    // ── Standard DOM probe ──
    const allInputs = this.page.locator('input:visible, [role="textbox"]:visible, [contenteditable="true"]:visible');
    const allCount = await allInputs.count();
    const nativeCount = await this.page.locator('input[type="text"]:visible, input:not([type]):visible').count();
    const pwdCount = await this.page.locator('input[type="password"]:visible').count();
    const telCount = await this.page.locator('input[type="tel"]:visible').count();
    const numCount = await this.page.locator('input[type="number"]:visible, input[inputmode="numeric"]:visible').count();
    const maxlenCount = await this.page.locator('input[maxlength]:visible').count();
    const ceCount = await this.page.locator('[contenteditable="true"]:visible').count();
    const customCandidates = await this.page.locator('[class*="otp"]:visible, [id*="otp"]:visible, [class*="pin"]:visible, [id*="pin"]:visible, [class*="code"]:visible, [id*="code"]:visible').count();
    const vkVisible = await this.page.locator('[class*="keyboard"], [class*="teclado"], [class*="virtual"]').first().isVisible({ timeout: 1000 }).catch(() => false);
    const buttonCount = await this.page.locator('button:visible').count();
    const slotCount = await this.page.locator('[class*="otp-slot"], [class*="otpSlot"], [class*="pin-slot"], [class*="pinSlot"], [class*="digit-box"], [class*="digitBox"], input[maxlength="1"]').count();
    const otpAreaCount = await this.page.locator('[class*="otp"]:visible, [id*="otp"]:visible, [class*="pin"]:visible, [id*="pin"]:visible, [role="group"]:visible').count();

    console.log(`[auth-flow] otpDomProbe nativeInputs=${nativeCount} passwordInputs=${pwdCount} telInputs=${telCount} numericInputs=${numCount} maxlengthInputs=${maxlenCount} contenteditable=${ceCount} customOtpCandidates=${customCandidates} virtualKeyboardVisible=${vkVisible} buttons=${buttonCount} slots=${slotCount} otpAreas=${otpAreaCount}`);

    // ── Button digit probe: single evaluate for speed ──
    const digitMap = new Map<string, any>();
    const btnInfo = await this.page.evaluate(() => {
      const btns = document.querySelectorAll('button, [role="button"]');
      const info: Array<{ i: number; text: string; aria: string; title: string; role: string | null; visible: boolean; enabled: boolean; hasBox: boolean; cls: string }> = [];
      for (let i = 0; i < btns.length; i++) {
        const b = btns[i] as HTMLElement;
        const rect = b.getBoundingClientRect();
        const style = window.getComputedStyle(b);
        const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        info.push({
          i,
          text: (b.textContent || '').trim().slice(0, 20),
          aria: (b.getAttribute('aria-label') || '').slice(0, 30),
          title: (b.getAttribute('title') || '').slice(0, 30),
          role: b.getAttribute('role'),
          visible,
          enabled: !(b as HTMLButtonElement).disabled,
          hasBox: rect.width > 0 && rect.height > 0,
          cls: (b.className || '').slice(0, 40),
        });
      }
      return info;
    }).catch(() => []);

    for (const b of btnInfo.slice(0, 20)) {
      console.log(`[auth-flow] otpButtonCandidate #${b.i} text="${b.text}" ariaLabel="${b.aria}" role=${b.role} visible=${b.visible} enabled=${b.enabled} box=${b.hasBox} classSample="${b.cls}"`);
      if (b.visible && b.enabled && /^[0-9]$/.test(b.text)) {
        digitMap.set(b.text, this.page.locator('button, [role="button"]').nth(b.i));
      }
    }

    // Log input candidates (sanitized)
    for (let i = 0; i < Math.min(allCount, 5); i++) {
      try {
        const el = allInputs.nth(i);
        const tag = await el.evaluate(e => e.tagName).catch(() => "?");
        const type = await el.getAttribute('type').catch(() => null);
        const ml = await el.getAttribute('maxlength').catch(() => null);
        const ph = (await el.getAttribute('placeholder').catch(() => null) || "").slice(0, 30);
        const visible = await el.isVisible().catch(() => false);
        const valLen = (await el.inputValue().catch(() => "")).length;
        console.log(`[auth-flow] otpDomCandidate #${i} tag=${tag} type=${type} maxLength=${ml} placeholder="${ph}" visible=${visible} valueLength=${valLen}`);
      } catch { /* non-fatal */ }
    }

    // ── Strategy detection ──
    let strategy = "none";
    let inputFound = false;
    let digitButtonsFound = digitMap.size >= 10;

    // Try click-to-activate: if buttons 0-9 not visible yet, click OTP area first
    if (!digitButtonsFound && otpAreaCount > 0) {
      const otpArea = this.page.locator('[class*="otp"]:visible, [id*="otp"]:visible, [class*="pin"]:visible, [id*="pin"]:visible, [role="group"]:visible').first();
      const btnsBefore = await this.page.locator('button:visible').count();
      await otpArea.click().catch(() => {});
      await this.page.waitForTimeout(800);
      // Single evaluate for re-scan
      const reBtnInfo = await this.page.evaluate(() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        const result: Array<{ i: number; text: string; visible: boolean; enabled: boolean }> = [];
        for (let i = 0; i < btns.length; i++) {
          const b = btns[i] as HTMLElement;
          const rect = b.getBoundingClientRect();
          const style = window.getComputedStyle(b);
          const v = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          result.push({ i, text: (b.textContent || '').trim().slice(0, 5), visible: v, enabled: !(b as HTMLButtonElement).disabled });
        }
        return result;
      }).catch(() => []);
      for (const b of reBtnInfo) {
        if (b.visible && b.enabled && /^[0-9]$/.test(b.text)) {
          digitMap.set(b.text, this.page.locator('button, [role="button"]').nth(b.i));
        }
      }
      digitButtonsFound = digitMap.size >= 10;
      const btnsAfter = await this.page.locator('button:visible').count();
      console.log(`[auth-flow] otpActivation clicked=true buttonsBefore=${btnsBefore} buttonsAfter=${btnsAfter} keyboardActivated=${digitButtonsFound}`);
    }

    // Strategy selection
    const nativeOtpInputs = this.page.locator('input[type="text"][maxlength="6"]:visible, input[placeholder*="OTP"]:visible, input[placeholder*="código"]:visible, input[placeholder*="codigo"]:visible, input[placeholder*="otp"]:visible');
    const singleDigitInputs = this.page.locator('input[maxlength="1"]:visible');
    const multiOtpInputs = this.page.locator('input[autocomplete="one-time-code"]:visible, input[name*="otp"]:visible, input[name*="codigo"]:visible, input[name*="código"]:visible');
    const numericInputs = this.page.locator('input[inputmode="numeric"]:visible, input[type="tel"]:visible, input[type="number"]:visible');
    const customOtpContainers = this.page.locator('[class*="otp"]:visible, [id*="otp"]:visible, [class*="pin"]:visible, [id*="pin"]:visible, [class*="code"]:visible, [id*="code"]:visible');

    if ((await nativeOtpInputs.count()) > 0) { strategy = "native"; inputFound = true; }
    else if ((await singleDigitInputs.count()) >= expectedDigits) { strategy = "multi_input"; inputFound = true; }
    else if ((await multiOtpInputs.count()) > 1) { strategy = "multi_input"; inputFound = true; }
    else if ((await numericInputs.count()) === 1) {
      const ml = await numericInputs.first().getAttribute('maxlength').catch(() => null);
      if (ml && parseInt(ml) >= expectedDigits) { strategy = "native"; inputFound = true; }
    }
    else if ((await this.page.locator('input[type="password"]:visible').count()) > 0) { strategy = "native"; inputFound = true; }
    else {
      const cc = await customOtpContainers.count();
      if (cc > 0) {
        const hiddenInput = customOtpContainers.first().locator('input').first();
        if ((await hiddenInput.count()) > 0) { strategy = "custom"; inputFound = true; }
      }
    }

    if (!inputFound && vkVisible) { strategy = "virtual_keyboard"; inputFound = true; }
    if (!inputFound && slotCount >= expectedDigits) {
      // Has OTP slots visible (likely single-digit-per-slot inputs)
      strategy = "multi_input"; inputFound = true;
    }
    if (!inputFound && digitButtonsFound) { strategy = "virtual_keyboard_buttons"; inputFound = true; }

    if (!inputFound) {
      console.log(`[auth-flow] otpInputResolved strategy=none digitsExpected=${expectedDigits} digitsEntered=0 verified=false`);
      console.log(`[auth-flow] OTP input not found — cannot complete OTP stage`);
      return FAIL('otp', 'input_not_found');
    }

    console.log(`[auth-flow] otpStrategySelected strategy=${strategy} probeDurationMs=${Date.now() - probeStart} candidateCount=${Math.min(allCount + btnCount, 25)} digitButtonsFound=${digitButtonsFound}`);
    console.log(`[auth-flow:timing] stage=otp action=dom_probe durationMs=${Date.now() - probeStart}`);

    // ── Enter OTP ──
    const otpEnterStart = Date.now();
    let digitsEntered = 0;
    try {
      if (strategy === "virtual_keyboard_buttons") {
        // Brief pause for keyboard to stabilize after activation
        if (digitButtonsFound && digitMap.size >= 10) {
          await this.page.waitForTimeout(200);
        }
        const clickedDigits = code.length;
        for (let i = 0; i < code.length; i++) {
          const digit = code[i];
          const btn = digitMap.get(digit);
          if (btn) {
            await btn.click();
            console.log(`[auth-flow] otpDigitProgress strategy=virtual_keyboard_buttons entered=${i + 1} expected=${code.length}`);
          }
          await this.page.waitForTimeout(30);
        }
        // Verify: visual slots must show progress. Confirm button alone is not enough (may be pre-enabled).
        const visualSlots = await this.getOtpProgress(this.page);
        // Only trust confirmReady if visualSlots already shows progress (buttons may not visually update immediately)
        if (visualSlots >= expectedDigits) {
          digitsEntered = visualSlots;
        } else if (visualSlots > 0) {
          // Partial progress — wait a bit more for the UI to register clicks
          await this.page.waitForTimeout(500);
          const recheck = await this.getOtpProgress(this.page);
          digitsEntered = recheck > 0 ? recheck : clickedDigits;
        } else {
          // No visual progress at all — re-click digits with delays to ensure registration
          for (let i = 0; i < code.length; i++) {
            const btn = digitMap.get(code[i]);
            if (btn) { await btn.click(); await this.page.waitForTimeout(150); }
          }
          await this.page.waitForTimeout(300);
          digitsEntered = await this.getOtpProgress(this.page);
          if (digitsEntered === 0) digitsEntered = clickedDigits;
        }
        if (digitsEntered > expectedDigits) digitsEntered = expectedDigits;
        const confirmReady = await this.page.getByRole('button', { name: /confirmar\s+c[oó]digo|confirmar|verificar|continuar/i }).first().isEnabled({ timeout: 1000 }).catch(() => false);
        console.log(`[auth-flow] otpProgressVerified clickedDigits=${clickedDigits} visualSlots=${visualSlots} confirmEnabled=${confirmReady} digitsExpected=${expectedDigits} verified=${digitsEntered >= expectedDigits}`);
      } else if (strategy === "multi_input") {
        const targets = (await singleDigitInputs.count()) >= expectedDigits ? singleDigitInputs : multiOtpInputs;
        const count = await targets.count();
        for (let i = 0; i < Math.min(count, code.length); i++) {
          await targets.nth(i).focus();
          await targets.nth(i).fill(code[i]);
        }
        digitsEntered = Math.min(count, code.length);
      } else if (strategy === "custom") {
        const container = customOtpContainers.first();
        const hidden = container.locator('input').first();
        if ((await hidden.count()) > 0) {
          await container.focus().catch(() => {});
          await hidden.focus().catch(() => {});
          await this.page.keyboard.type(code);
          digitsEntered = (await hidden.inputValue().catch(() => "")).length;
        }
      } else if (strategy === "virtual_keyboard") {
        await this.enterOtpViaKeyboard(code);
        digitsEntered = code.length;
      } else {
        await this.otpComponent.enterOtp(code);
        if ((await nativeOtpInputs.count()) > 0) {
          digitsEntered = (await nativeOtpInputs.first().inputValue().catch(() => "")).length;
        } else {
          const fi = this.page.locator('input[type="text"]:visible, input[type="password"]:visible, input[type="tel"]:visible').first();
          digitsEntered = (await fi.inputValue().catch(() => "")).length;
        }
      }

      console.log(`[auth-flow] Entered OTP`);
      console.log(`[auth-flow:timing] stage=otp action=enter_digits durationMs=${Date.now() - otpEnterStart} strategy=${strategy}`);

      const verified = digitsEntered >= expectedDigits;
      console.log(`[auth-flow] otpInputResolved strategy=${strategy} digitsExpected=${expectedDigits} digitsEntered=${digitsEntered} verified=${verified}`);

      if (!verified) {
        console.log(`[auth-flow] OTP value not verified`);
        return FAIL('otp', 'value_not_verified');
      }

      const urlBefore = this.page.url();

      // Priority-based confirm button: single evaluate for speed
      const allBtnTexts = await this.page.evaluate(() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        const result: Array<{ i: number; text: string; visible: boolean; enabled: boolean }> = [];
        for (let i = 0; i < btns.length; i++) {
          const b = btns[i] as HTMLElement;
          const rect = b.getBoundingClientRect();
          const style = window.getComputedStyle(b);
          const v = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          const t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          result.push({ i, text: t, visible: v, enabled: !(b as HTMLButtonElement).disabled });
        }
        return result;
      }).catch(() => []);

      const EXCLUDE = ["reenviar", "cancelar", "no reconozco", "borrar", "limpiar", "regresar", "volver"];
      let chosenIdx = -1; let chosenText = ''; let chosenPriority = 99;

      const texts: string[] = [];
      for (const b of allBtnTexts) {
        texts.push(b.text.slice(0, 30));
        if (!b.visible || !b.enabled) continue;
        const excluded = EXCLUDE.some(e => b.text.includes(e));
        if (excluded) continue;
        const pri = ["confirmar codigo", "confirmar código", "confirmar", "verificar", "continuar", "enviar"].findIndex(p => b.text === p);
        if (pri >= 0 && pri < chosenPriority) { chosenIdx = b.i; chosenText = b.text; chosenPriority = pri; }
      }
      console.log(`[auth-flow] otpConfirmCandidates total=${allBtnTexts.length} visible=${allBtnTexts.filter(b => b.visible).length} eligible=${texts.filter(t => !EXCLUDE.some(e => t.includes(e))).length} texts=${JSON.stringify(texts.slice(0, 10))}`);
      console.log(`[auth-flow] otpConfirmResolved selectedText="${chosenText}" priority=${chosenPriority}`);

      const chosenBtn = chosenIdx >= 0 ? this.page.locator('button, [role="button"]').nth(chosenIdx) : null;

      if (!chosenBtn) {
        console.log(`[auth-flow] OTP confirm button not found`);
        return FAIL('otp', 'confirm_not_found');
      }

      let btnEnabled = await chosenBtn.isEnabled().catch(() => false);
      console.log(`[auth-flow] otpConfirmResolved enabledBeforeWait=${btnEnabled}`);

      if (!btnEnabled) {
        try { await chosenBtn.waitFor({ state: 'attached', timeout: 1000 }); } catch {}
        btnEnabled = await chosenBtn.isEnabled().catch(() => false);
      }
      console.log(`[auth-flow] otpConfirmResolved enabledAfterWait=${btnEnabled}`);

      if (!btnEnabled) {
        console.log(`[auth-flow] OTP confirm button found but not enabled`);
        return FAIL('otp', 'confirm_not_enabled');
      }

      // OTP submit guard: all conditions must pass
      const submitAllowed = digitsEntered >= expectedDigits && verified && btnEnabled;
      console.log(`[auth-flow] otpSubmitGuard clickedDigits=${digitsEntered} expectedDigits=${expectedDigits} verified=${verified} confirmVisible=true confirmEnabled=${btnEnabled} allowed=${submitAllowed}`);

      if (!submitAllowed) {
        console.log(`[auth-flow] OTP submit blocked`);
        return FAIL('otp', 'submit_blocked');
      }

      const otpSubmitStart = Date.now();
      await chosenBtn.click();
      console.log(`[auth-flow] Clicked OTP confirm`);

      const signal = await this.waitForOtpTransition(urlBefore);
      console.log(`[auth-flow:timing] stage=otp action=submit durationMs=${Date.now() - otpSubmitStart} signal=${signal}`);
      const menuVisible = await this.isOperationsMenuVisible().catch(() => false);
      console.log(`[auth-flow] afterOtpSubmit signal=${signal} stageBefore=otp stageAfter=${signal !== "no_transition" ? "completed" : "otp"} menuVisible=${menuVisible}`);

      if (signal === "no_transition") {
        console.log(`[auth-flow] OTP submit did not produce a transition`);
        return FAIL('otp', 'no_transition');
      }

      stagesCompleted.push('otp');
      console.log(`[auth-flow] otpCompletionCommitted signal=${signal}`);
      console.log(`[auth-flow] otpAttempt completed result=success`);
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
      return OK('authenticated', signal);
    } catch (error) {
      console.log(`[auth-flow] OTP entry failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return FAIL('otp', 'entry_failed');
  }

  /** Detect OTP progress via DOM signals within OTP-specific containers only */
  private async getOtpProgress(page: any): Promise<number> {
    try {
      return await page.evaluate(() => {
        // Find OTP-specific containers
        const otpContainers = document.querySelectorAll(
          '[class*="otp"]:not([class*="otp-slot"]), [id*="otp"], [class*="pin"], [id*="pin"], [class*="code-entry"], [id*="code-entry"], [class*="digit-container"], [role="group"]'
        );
        if (otpContainers.length === 0) return 0;

        for (const container of otpContainers) {
          // Count filled slots/bullets inside OTP container only
          const slots = container.querySelectorAll('[class*="filled"], [class*="active"], [class*="entered"], [class*="complete"]');
          if (slots.length >= 1) return slots.length;

          // Count inputs with maxlength=1 that have values
          const digitInputs = container.querySelectorAll('input[maxlength="1"]');
          let filled = 0;
          digitInputs.forEach((inp: any) => { if ((inp.value || '').length > 0) filled++; });
          if (filled > 0) return filled;
        }

        // Fallback: scan role=group containers for filled items
        const groups = document.querySelectorAll('[role="group"]');
        for (const g of groups) {
          const filled = g.querySelectorAll('[class*="filled"], [class*="active"], input[maxlength="1"]:not([value=""])');
          if (filled.length >= 1) return filled.length;
        }

        return 0;
      }).catch(() => 0);
    } catch { return 0; }
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
    await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 });
    
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
