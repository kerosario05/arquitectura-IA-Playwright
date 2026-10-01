import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecordedEvent, RecordedScreen } from "./session-trace.types";
import { buildObservedScenarioTitle } from "./observed-scenario-title";

function screen(screenKey: string, title: string): RecordedScreen {
  return { screenKey, title, fingerprint: screenKey, firstSeenAt: 0, controls: [], texts: [] };
}

function tap(label: string, screenKey = "home", role?: string): RecordedEvent {
  return { seq: 0, t: 0, kind: "tap", screenKey, target: { label, locators: [], ...(role ? { role } : {}) } } as RecordedEvent;
}

const SCREENS = [screen("home", "¡Hola!"), screen("detail", "Más detalles del producto")];

test("names the flow after the start screen and the choices made", () => {
  const title = buildObservedScenarioTitle({ screens: SCREENS }, [
    tap("Explora nuestros productos"),
    tap("Préstamos", "detail"),
    tap("Préstamo Personal", "detail"),
  ]);
  assert.equal(title, "Desde ¡Hola!: Explora nuestros productos > Préstamos > Préstamo Personal");
});

test("keeps the first choice and the last three of a long path", () => {
  const title = buildObservedScenarioTitle({ screens: SCREENS }, [
    tap("Explora nuestros productos"),
    tap("Tarjetas"),
    tap("Tarjeta de Crédito"),
    tap("Tarjeta Crédito Visa Clásica"),
    tap("Solicitar"),
    tap("Generar Turno"),
  ]);
  assert.equal(title, "Desde ¡Hola!: Explora nuestros productos > … > Tarjeta Crédito Visa Clásica > Solicitar > Generar Turno");
});

test("ignores keypad digits, erasing, going back, field prompts and repeated taps", () => {
  const title = buildObservedScenarioTitle({ screens: SCREENS }, [
    tap("Estados de cuenta"),
    tap("Estados de cuenta"),
    tap("Ingrese el número"),
    tap("4"),
    tap("0"),
    tap("40229993734"),
    tap("← Borrar"),
    tap("Volver"),
    tap("Correo", "home", "textbox"),
    tap("T"),
    tap("Cancelar"),
  ]);
  assert.equal(title, "Desde ¡Hola!: Estados de cuenta > Cancelar");
});

test("a recording with several sessions is summarised by the choice that names each one", () => {
  const title = buildObservedScenarioTitle({ screens: SCREENS }, [
    tap("Explora nuestros productos"), tap("Tarjeta de Crédito Visa Platinum"), tap("Solicitar"), tap("Generar Turno"), tap("Cancelar"),
    tap("Finalizar sesión"),
    tap("Explora nuestros productos"), tap("Cuenta de Ahorros Personal en Euros"),
    tap("Finalizar sesión"),
  ]);
  assert.equal(title, "Desde ¡Hola!: 2 recorridos: Tarjeta de Crédito Visa Platinum, Cuenta de Ahorros Personal en Euros");
});

test("a closing 'Finalizar sesión' does not count as a second session", () => {
  const title = buildObservedScenarioTitle({ screens: SCREENS }, [tap("Estados de cuenta"), tap("Finalizar sesión")]);
  assert.equal(title, "Desde ¡Hola!: Estados de cuenta");
});

test("without choices, a new screen reached names the flow", () => {
  const events = [
    { seq: 0, t: 0, kind: "fill", screenKey: "home", target: { label: "Usuario", locators: [] } },
    { seq: 1, t: 1, kind: "screen_change", screenKey: "detail" },
  ] as RecordedEvent[];
  assert.equal(buildObservedScenarioTitle({ screens: SCREENS }, events), "Recorrido hasta Más detalles del producto");
});

test("returns null when nothing readable was recorded, so the typed goal is used", () => {
  assert.equal(buildObservedScenarioTitle({ screens: [] }, []), null);
  assert.equal(
    buildObservedScenarioTitle({ screens: [screen("home", "screen-a1b2c3d4")] }, [tap("7", "home")]),
    null,
  );
});
