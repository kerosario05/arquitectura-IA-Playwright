import { test } from "node:test";
import assert from "node:assert/strict";
import { compactRecordedEvents } from "./compact-recorded-events";
import type { RecordedEvent, RecordedScreen } from "../session-trace.types";

const screen = (screenKey: string, title: string): RecordedScreen =>
  ({ screenKey, title, fingerprint: screenKey, firstSeenAt: 0, controls: [], texts: [] }) as unknown as RecordedScreen;
const code = { label: "Código de 6 dígitos", role: "input", locators: [{ strategy: "accessibilityId", value: "Código de 6 dígitos", confidence: 0.95 }] };
let seq = 0;
const ev = (partial: Partial<RecordedEvent>): RecordedEvent => ({ seq: seq++, t: seq, screenKey: "a", ...partial }) as RecordedEvent;

const screens = [screen("a", "Código"), screen("b", "Código"), screen("c", "Código"), screen("u", "unknown"), screen("z", "Usuario")];

test("una pantalla que cambia sola y una escritura leída a trozos quedan en un solo paso", () => {
  const out = compactRecordedEvents([
    ev({ kind: "launch" }),
    ev({ kind: "screen_change", screenKey: "a", toScreenKey: "b" }),
    ev({ kind: "fill", screenKey: "b", target: code as never, value: "79" }),
    ev({ kind: "screen_change", screenKey: "b", toScreenKey: "c" }),
    ev({ kind: "fill", screenKey: "c", target: code as never, value: "7968" }),
    ev({ kind: "tap", screenKey: "c", target: code as never }),
    ev({ kind: "fill", screenKey: "c", target: code as never, value: "796883" }),
    ev({ kind: "screen_change", screenKey: "c", toScreenKey: "u" }),
    ev({ kind: "screen_change", screenKey: "u", toScreenKey: "z" }),
  ], screens);
  assert.deepEqual(out.map((e) => [e.kind, e.value ?? e.toScreenKey ?? ""]), [
    ["launch", ""],
    ["fill", "796883"],
    ["screen_change", "z"],
  ]);
});

test("toques en botones, campos distintos y pantallas distintas no se tocan", () => {
  const doc = { label: "Número de documento", role: "input", locators: [{ strategy: "accessibilityId", value: "Número de documento", confidence: 0.95 }] };
  const button = { label: "Continuar", role: "button", locators: [] };
  const out = compactRecordedEvents([
    ev({ kind: "fill", target: doc as never, value: "402" }),
    ev({ kind: "fill", target: code as never, value: "1" }),
    ev({ kind: "tap", target: button as never }),
    ev({ kind: "screen_change", screenKey: "a", toScreenKey: "z" }),
  ], screens);
  assert.equal(out.length, 4);
});
