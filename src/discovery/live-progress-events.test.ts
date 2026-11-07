import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscoveryLiveCaseFinishedEvent, buildDiscoveryLiveCaseStartedEvent } from "./live-progress-events";

test("Discovery live lifecycle carries ordered steps and redacts entered literals", () => {
  assert.deepEqual(buildDiscoveryLiveCaseStartedEvent({
    caseId: 57345,
    title: "Transferencia",
    index: 2,
    total: 3,
    steps: ['Ingresar "654321" en "Código"', 'Presionar "SMS"'],
  }), {
    type: "case_started",
    caseId: "C57345",
    title: "Transferencia",
    index: 2,
    total: 3,
    steps: ['Ingresar "[REDACTED]" en "Código"', 'Presionar "SMS"'],
  });
});

test("Discovery live completion preserves a failed step for the panel", () => {
  assert.deepEqual(buildDiscoveryLiveCaseFinishedEvent({
    caseId: 57345,
    title: "Transferencia",
    passed: false,
    failedAtStep: 8,
  }), {
    type: "case_finished",
    caseId: "C57345",
    title: "Transferencia",
    status: "failed",
    failedAtStep: 8,
  });
});
