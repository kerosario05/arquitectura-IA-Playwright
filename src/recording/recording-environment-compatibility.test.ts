import assert from "node:assert/strict";
import test from "node:test";
import { classifyRecordingEnvironmentCompatibility } from "./recording-environment-compatibility";

const base = {
  recordedProjectSlug: "portalempresarial",
  recordedOrigin: "https://recorded.example.test",
  recordedEntryPath: "/login",
  currentProjectSlug: "portalempresarial",
  currentConfiguredBaseUrl: "https://recorded.example.test/login",
  currentConfiguredEntryPath: "/login",
  runtimeBaseUrl: "https://recorded.example.test/login",
  sqlBaseUrl: "https://recorded.example.test/login",
  materializedBaseUrl: "https://recorded.example.test/login",
};

test("same project and origin are compatible with the current environment", () => {
  const result = classifyRecordingEnvironmentCompatibility(base);
  assert.equal(result.classification, "COMPATIBLE_CURRENT_ENV");
  assert.equal(result.portableAcrossCurrentConfig, true);
  assert.equal(result.sqlMaterializedConsistent, true);
  assert.equal(result.runtimeMatchesMaterializedConfig, true);
  assert.equal(result.runtimeAuthority, "current_project_configuration");
});

test("a changed recording origin is stale historical evidence, not a runtime instruction", () => {
  const result = classifyRecordingEnvironmentCompatibility({
    ...base,
    recordedOrigin: "https://old-environment.example.test",
  });
  assert.equal(result.classification, "STALE_ABSOLUTE_RECORDING_URL");
  assert.equal(result.portableAcrossCurrentConfig, true);
  assert.equal(result.historicalAbsoluteUrlIsEvidence, true);
});

test("SQL and materialized runtime disagreement is a project configuration mismatch", () => {
  const result = classifyRecordingEnvironmentCompatibility({
    ...base,
    materializedBaseUrl: "https://different-materialized.example.test/login",
  });
  assert.equal(result.classification, "PROJECT_CONFIGURATION_MISMATCH");
  assert.equal(result.sqlMaterializedConsistent, false);
  assert.equal(result.portableAcrossCurrentConfig, false);
});

test("a different project slug is an app identity mismatch", () => {
  const result = classifyRecordingEnvironmentCompatibility({
    ...base,
    currentProjectSlug: "otro-proyecto",
  });
  assert.equal(result.classification, "APP_IDENTITY_MISMATCH");
  assert.equal(result.portableAcrossCurrentConfig, false);
});

test("a runtime origin that differs from materialized configuration is not silently repaired", () => {
  const result = classifyRecordingEnvironmentCompatibility({
    ...base,
    runtimeOrigin: "https://runtime-drift.example.test",
    runtimeBaseUrl: undefined,
  });
  assert.equal(result.classification, "PROJECT_CONFIGURATION_MISMATCH");
  assert.equal(result.runtimeMatchesMaterializedConfig, false);
});
