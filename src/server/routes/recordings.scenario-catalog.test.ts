import assert from "node:assert/strict";
import test from "node:test";
import { toScenarioCatalogEntries } from "./recordings";
import type { RecordedScenario } from "../../recording/trace-to-scenario";

const scenarios = [
  { scenarioId: "REC-AAAAAAAA-01", title: "Desde ¡Hola!: Estados de cuenta", primary: true, provenance: "observed", promotedSpec: { specPath: "x.spec.ts" } },
  { scenarioId: "REC-AAAAAAAA-01-ALT-1", title: "Desde ¡Hola!: Canje de Puntos", provenance: "derived" },
] as unknown as RecordedScenario[];

test("a web scenario is executable unless the execute admission rejected it, with its reasons", () => {
  const entries = toScenarioCatalogEntries(
    { recordingId: "aaaaaaaa", label: "roque 98", startedAt: "2026-09-29T10:00:00Z", platform: "web" },
    scenarios,
    new Map([["REC-AAAAAAAA-01-ALT-1", ["missing_runtime_input:cedula"]]]),
    {},
  );
  assert.deepEqual(entries.map((entry) => [entry.scenarioId, entry.executable, entry.blockedReasons]), [
    ["REC-AAAAAAAA-01", true, []],
    ["REC-AAAAAAAA-01-ALT-1", false, ["missing_runtime_input:cedula"]],
  ]);
  assert.equal(entries[0].promoted, true);
  assert.equal(entries[0].primary, true);
  assert.equal(entries[1].promoted, false);
  assert.equal(entries[0].recordingLabel, "roque 98");
});

test("a mobile recording is listed but never offered for this replay", () => {
  const entries = toScenarioCatalogEntries(
    { recordingId: "bbbbbbbb", startedAt: "2026-09-29T10:00:00Z", platform: "android" },
    scenarios.slice(0, 1),
    new Map(),
    {},
  );
  assert.equal(entries[0].executable, false);
  assert.deepEqual(entries[0].blockedReasons, ["mobile_recording"]);
});
