import assert from "node:assert/strict";
import test from "node:test";
import { recordingTraceReadinessError } from "./recordings";

test("a missing recording is reported separately from a trace that is still active", () => {
  assert.deepEqual(recordingTraceReadinessError(null, "recording-missing"), {
    status: 404,
    code: "RECORDING_NOT_FOUND",
    message: "No se encontró la grabación recording-missing",
  });
  assert.deepEqual(recordingTraceReadinessError({ status: "recording" }, "recording-active"), {
    status: 409,
    code: "TRACE_NOT_READY",
    message: "La grabación recording-active todavía no tiene un trace detenido",
  });
});

test("stopped and derived traces remain eligible for the execution route", () => {
  assert.equal(recordingTraceReadinessError({ status: "stopped" }, "recording-stopped"), null);
  assert.equal(recordingTraceReadinessError({ status: "derived" }, "recording-derived"), null);
  assert.equal(recordingTraceReadinessError({ status: "failed" }, "recording-failed")?.code, "TRACE_NOT_READY");
});
