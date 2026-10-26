import assert from "node:assert/strict";
import test from "node:test";
import { safeRouteIdentity } from "./case-discovery";

test("hash-router destination counts as a route change when pathname stays the same", () => {
  assert.notEqual(
    safeRouteIdentity("https://app.test/#/"),
    safeRouteIdentity("https://app.test/#/solicitudes"),
  );
});

test("hashbang routes are included in route identity", () => {
  assert.notEqual(
    safeRouteIdentity("https://app.test/#!/login"),
    safeRouteIdentity("https://app.test/#!/solicitudes"),
  );
});

test("plain fragment anchors do not count as route changes", () => {
  assert.equal(
    safeRouteIdentity("https://app.test/solicitudes#filtros"),
    safeRouteIdentity("https://app.test/solicitudes#resultados"),
  );
});

test("pathname routes remain part of route identity", () => {
  assert.notEqual(
    safeRouteIdentity("https://app.test/login"),
    safeRouteIdentity("https://app.test/solicitudes"),
  );
});
