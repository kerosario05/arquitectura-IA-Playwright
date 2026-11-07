import assert from "node:assert/strict";
import test from "node:test";
import { clickRetryBudget, isRetryableLookupClick } from "./lookup-click-retry";

const click = (target: string) => ({ recordingActionType: "click", target });

test("lookup and validation buttons are retried", () => {
  for (const target of ["Depurar", "Buscar", "Validar", "Consultar cliente", "Precalificar", "Actualizar"]) {
    assert.equal(isRetryableLookupClick(click(target)), true, target);
  }
});

test("buttons that create, send, pay or delete are never retried", () => {
  for (const target of ["Crear Crédito", "Finalizar", "Guardar", "Enviar", "Eliminar", "Cancelar", "Cargar", "Aceptar", "Continuar", "Añadir dirección"]) {
    assert.equal(isRetryableLookupClick(click(target)), false, target);
  }
});

test("only clicks qualify", () => {
  assert.equal(isRetryableLookupClick({ recordingActionType: "fill", target: "Depurar" }), false);
  assert.equal(isRetryableLookupClick({ recordingActionType: "click", target: "" }), false);
});

test("the retry budget defaults to 3 and can be disabled or tuned", () => {
  assert.equal(clickRetryBudget({} as any), 3);
  assert.equal(clickRetryBudget({ DISCOVERY_CLICK_RETRY: "false" } as any), 0);
  assert.equal(clickRetryBudget({ DISCOVERY_CLICK_RETRIES: "2" } as any), 2);
  assert.equal(clickRetryBudget({ DISCOVERY_CLICK_RETRIES: "99" } as any), 3);
});
