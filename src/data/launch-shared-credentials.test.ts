import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deleteSharedCredentials, fillMissingLaunchCredentials, publishLaunchCredentials, sharedCredentialsPath } from "./launch-shared-credentials";

const steps = [
  { label: "Usuario", actionType: "action_fill" },
  { label: "Contraseña", actionType: "action_fill" },
  { label: "Iniciar Sesion", actionType: "action_click" },
];
const creds = (u: string, p: string) => [{ key: "auth.username", value: u }, { key: "auth.password", value: p }];
const none: Array<{ key: string; value: string; source?: string }> = [];
const ctx = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shared-cred-")), "ctx.json");

test("a case without credentials reuses the ones another case of the launch published", () => {
  const c = ctx();
  publishLaunchCredentials(c, creds("u1", "p1"));
  const filled = fillMissingLaunchCredentials(c, none, steps)!;
  assert.deepEqual(filled.map((e) => [e.key, e.value]), [["auth.username", "u1"], ["auth.password", "p1"]]);
  assert.equal(filled[0].source, "user_provided_qa_credentials");
});

test("cases that disagree on a credential share nothing for it", () => {
  const c = ctx();
  publishLaunchCredentials(c, creds("u1", "p1"));
  publishLaunchCredentials(c, creds("u2", "p1"));
  const filled = fillMissingLaunchCredentials(c, none, steps)!;
  assert.deepEqual(filled.map((e) => e.key), ["auth.password"]);
});

test("own values win; no context file means no change", () => {
  const c = ctx();
  publishLaunchCredentials(c, creds("u1", "p1"));
  assert.equal(fillMissingLaunchCredentials(c, creds("mine", "mine"), steps)!.length, 2);
  assert.deepEqual(fillMissingLaunchCredentials(undefined, none, steps), []);
  assert.equal(fillMissingLaunchCredentials(ctx(), undefined, steps), undefined);
});

test("shared file is removed with the job", () => {
  const c = ctx();
  publishLaunchCredentials(c, creds("u1", "p1"));
  deleteSharedCredentials(c);
  assert.equal(fs.existsSync(sharedCredentialsPath(c)), false);
});
