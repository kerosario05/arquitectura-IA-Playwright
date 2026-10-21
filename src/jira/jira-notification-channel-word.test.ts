import assert from "node:assert/strict";
import test from "node:test";
import { stripJiraNotificationChannelWord } from "./jira-assertion-matching";

test("leading notification channel word is dropped, content kept", () => {
  assert.equal(stripJiraNotificationChannelWord("aviso 3 registros guardados"), "3 registros guardados");
  assert.equal(stripJiraNotificationChannelWord("Notificación: pago enviado"), "pago enviado");
  assert.equal(stripJiraNotificationChannelWord("toast - archivo exportado"), "archivo exportado");
});

test("channel word alone or mid-text is left untouched (fail closed)", () => {
  assert.equal(stripJiraNotificationChannelWord("aviso"), "aviso");
  assert.equal(stripJiraNotificationChannelWord("pago con aviso previo"), "pago con aviso previo");
  assert.equal(stripJiraNotificationChannelWord("avisos legales"), "avisos legales");
});
