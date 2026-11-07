import assert from "node:assert/strict";
import test from "node:test";
import { isBureauDependentFailureMessage, isToleratedQaRejection } from "./promoted-spec-runtime";

test("only the Bizagi duplicate-case 406 is a tolerated QA-environment rejection", () => {
  assert.equal(isToleratedQaRejection("POST /api/proxy/api/Procesos/MDW/ConsultarCasosBizagiSQL 406"), true);
  assert.equal(isToleratedQaRejection("POST /api/proxy/api/Procesos/MDW/ConsultarCasosBizagiSQL 500"), false);
  assert.equal(isToleratedQaRejection("POST /api/proxy/api/Requests/CustomData 406"), false);
});

test("only the rates toast is treated as a consequence of the bureau failure", () => {
  assert.equal(isBureauDependentFailureMessage("Error al cargar los datosNo se pudo obtener las tasas relacionadas al producto."), true);
  assert.equal(isBureauDependentFailureMessage("Error al guardar la solicitud"), false);
});
