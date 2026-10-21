import assert from "node:assert/strict";
import test from "node:test";
import { completeObservedOtpStage } from "./jira-observed-otp";

// Fake page: selectors map to lists of visible control labels; records fill/click.
function fakePage(inputs: number, actions: string[]) {
  const log: string[] = [];
  const page = {
    locator(selector: string) {
      if (selector.startsWith("input:visible")) return { count: async () => inputs, first: () => ({ fill: async (v: string) => { log.push(`fill:${v}`); } }) };
      return { evaluateAll: async () => actions, nth: (i: number) => ({ click: async () => { log.push(`click:${actions[i]}`); } }) };
    },
  };
  return { page: page as any, log };
}

test("fills the unique code input and clicks the unique continue action", async () => {
  const { page, log } = fakePage(1, ["Cancelar", "Continuar"]);
  const result = await completeObservedOtpStage(page, "123456", async () => undefined);
  assert.deepEqual(result, { success: true });
  assert.deepEqual(log, ["fill:123456", "click:Continuar"]);
});
test("reports failure when the otp stage is still shown after submit", async () => {
  const { page } = fakePage(1, ["Verificar"]);
  assert.deepEqual(await completeObservedOtpStage(page, "123456", async () => "otp"), { success: false });
});
test("fails closed without touching the page when code, input or action is not unique", async () => {
  const cases: Array<[string | undefined, number, string[], RegExp]> = [
    [undefined, 1, ["Continuar"], /JIRA_OTP_CODE_MISSING/],
    ["123456", 0, ["Continuar"], /JIRA_OTP_INPUT_NOT_UNIQUE/],
    ["123456", 2, ["Continuar"], /JIRA_OTP_INPUT_NOT_UNIQUE/],
    ["123456", 1, ["Cancelar"], /JIRA_OTP_ACTION_NOT_UNIQUE/],
    ["123456", 1, ["Continuar", "Verificar"], /JIRA_OTP_ACTION_NOT_UNIQUE/],
  ];
  for (const [code, inputs, actions, expected] of cases) {
    const { page, log } = fakePage(inputs, actions);
    await assert.rejects(completeObservedOtpStage(page, code, async () => undefined), (e: Error) => expected.test(e.message) && !e.message.includes("123456"));
    assert.deepEqual(log, []);
  }
});
