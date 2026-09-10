import assert from "node:assert";
import { planOtpAutoContinue, planPostOtpSubmit } from "./mobile-step-executor";
import type { MobileStep } from "./mobile-step-types";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

const SEND = { strategy: "accessibilityId" as const, value: "Enviar código de validación" };
const CONT = { strategy: "accessibilityId" as const, value: "Continuar" };
const EDIT = { strategy: "androidUiAutomator" as const, value: 'new UiSelector().className("android.widget.EditText")' };

const send = (): MobileStep => ({ action: "click", description: "Enviar código", target: { ...SEND } });
const otpFill = (): MobileStep => ({ action: "fill", description: "Validar OTP", target: { ...EDIT }, otp: { required: true } });

/** Generation 37e27563: ten steps ending at the email OTP, with no phone cycle and no Continuar. */
const TEN_STEP: MobileStep[] = [
  { action: "launchApp", description: "Abrir" },
  { action: "click", description: "Crear cuenta", target: { ...CONT } },
  { action: "click", description: "Continuar", target: { ...CONT } },
  { action: "fill", description: "Documento", target: { ...EDIT } },
  { action: "click", description: "Continuar", target: { ...CONT } },
  { action: "click", description: "Continuar", target: { ...CONT } },
  { action: "assertVisible", description: "Correo visible", target: { ...EDIT } },
  { action: "assertVisible", description: "Teléfono visible", target: { ...EDIT } },
  send(),
  otpFill(),
];

/** The extended scenario: both cycles are explicit steps. */
const FOURTEEN_STEP: MobileStep[] = [
  ...TEN_STEP,
  send(),
  otpFill(),
  { action: "assertEnabled", description: "Continuar habilitado", target: { ...CONT } },
  { action: "click", description: "Continuar", target: { ...CONT } },
];

describe("planOtpAutoContinue", () => {
  test("drives the next cycle when the scenario stops at the first OTP", () => {
    const plan = planOtpAutoContinue(TEN_STEP, 9);
    assert.strictEqual(plan.proceed, true);
    assert.deepStrictEqual(plan.sendTarget, SEND);
    assert.strictEqual(plan.reason, "send_control_from_step_8");
  });

  test("stands down when a later step is itself an OTP step — no double send", () => {
    const plan = planOtpAutoContinue(FOURTEEN_STEP, 9);
    assert.strictEqual(plan.proceed, false);
    assert.strictEqual(plan.reason, "scenario_drives_next_cycle");
  });

  test("the scenario's own second OTP step still auto-continues past itself", () => {
    // At the last OTP step of the extended scenario there is no further OTP step, so the guard
    // lifts; the send control is the click that preceded it.
    const plan = planOtpAutoContinue(FOURTEEN_STEP, 11);
    assert.strictEqual(plan.proceed, true);
    assert.deepStrictEqual(plan.sendTarget, SEND);
  });

  test("takes the nearest preceding click, not the first one", () => {
    const plan = planOtpAutoContinue(TEN_STEP, 9);
    assert.strictEqual(plan.reason, "send_control_from_step_8");
  });

  test("declines when no click precedes the OTP step", () => {
    const plan = planOtpAutoContinue([otpFill()], 0);
    assert.strictEqual(plan.proceed, false);
    assert.strictEqual(plan.reason, "no_preceding_send_control");
  });

  test("declines when a preceding click carries no target", () => {
    const steps: MobileStep[] = [{ action: "click", description: "sin target" }, otpFill()];
    const plan = planOtpAutoContinue(steps, 1);
    assert.strictEqual(plan.proceed, false);
    assert.strictEqual(plan.reason, "no_preceding_send_control");
  });

  test("declines on an empty step list — the runner passed no context", () => {
    assert.strictEqual(planOtpAutoContinue([], 9).proceed, false);
  });
});

describe("planPostOtpSubmit", () => {
  test("presses Continuar when the scenario ends at the OTP fill", () => {
    const plan = planPostOtpSubmit(TEN_STEP, 9, SEND);
    assert.strictEqual(plan.proceed, true);
    assert.deepStrictEqual(plan.submitTarget, CONT);
    // Step 5 is the last submit-like click before the OTP that is not the send control.
    assert.strictEqual(plan.reason, "submit_control_from_step_5");
  });

  test("never mistakes the OTP send control for the submit control", () => {
    // "Enviar código de validación" is submit-like by wording; excluding it is what keeps this
    // from re-sending a code instead of advancing.
    const plan = planPostOtpSubmit(TEN_STEP, 9, SEND);
    assert.notDeepStrictEqual(plan.submitTarget, SEND);
  });

  test("stands down when the scenario has its own steps after the OTP", () => {
    const plan = planPostOtpSubmit(FOURTEEN_STEP, 9, SEND);
    assert.strictEqual(plan.proceed, false);
    assert.strictEqual(plan.reason, "scenario_has_later_steps");
  });

  test("declines when no submit-like click precedes the OTP", () => {
    const steps: MobileStep[] = [send(), otpFill()];
    const plan = planPostOtpSubmit(steps, 1, SEND);
    assert.strictEqual(plan.proceed, false);
    assert.strictEqual(plan.reason, "no_submit_control_in_scenario");
  });

  test("declines without step context rather than clicking blind", () => {
    assert.strictEqual(planPostOtpSubmit([], 9, SEND).proceed, false);
  });
});
