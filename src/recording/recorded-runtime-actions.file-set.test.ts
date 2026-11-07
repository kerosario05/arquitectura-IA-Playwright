import test from "node:test";
import assert from "node:assert/strict";
import { parseRecordedFileSet } from "./recorded-runtime-actions";

const ref = "11111111-1111-4111-8111-111111111111";

test("Recording file sets accept labelled project file references", () => {
  assert.deepEqual(parseRecordedFileSet(JSON.stringify({ "Formulario A": ref, "Anexo B": "22222222-2222-4222-8222-222222222222" })), [
    { label: "Formulario A", fileRef: ref },
    { label: "Anexo B", fileRef: "22222222-2222-4222-8222-222222222222" },
  ]);
});

test("Recording file sets reject empty, malformed, unlabelled, and oversized input", () => {
  for (const invalid of ["", "[]", "{}", "{", JSON.stringify({ "": ref }), JSON.stringify({ file: "not-a-ref" })]) {
    assert.throws(() => parseRecordedFileSet(invalid), /RECORDED_FILE_SET_INVALID/);
  }
  const oversized = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`file-${index}`, ref]));
  assert.throws(() => parseRecordedFileSet(JSON.stringify(oversized)), /RECORDED_FILE_SET_INVALID/);
});
