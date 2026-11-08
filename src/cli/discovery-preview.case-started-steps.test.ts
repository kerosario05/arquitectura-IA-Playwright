import assert from "node:assert/strict";
import test from "node:test";
import { maskCaseStartedSteps } from "./discovery-preview";

// Job 94dd9ce5: case_started carried no steps, so a live panel opened without the launch queue
// stayed on "Esperando el siguiente paso". The steps now travel in the event, values masked.
test("case_started steps keep every step and hide every typed value", () => {
  const steps = [
    "Abrir la aplicación configurada del proyecto",
    'Ingresar "402-2999373-4" en "Número de identificación"',
    'Ingresar "4" en "Please enter verification code. Digit 1"',
    'Presionar "Continuar"',
  ];
  assert.deepEqual(maskCaseStartedSteps(steps), [
    "Abrir la aplicación configurada del proyecto",
    'Ingresar "••••••" en "Número de identificación"',
    'Ingresar "••••••" en "Please enter verification code. Digit 1"',
    'Presionar "Continuar"',
  ]);
});
