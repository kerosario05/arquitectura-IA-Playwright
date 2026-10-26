import assert from "node:assert/strict";
import test from "node:test";
import { hasJiraAuthGateData, mapJiraAuthTestData, resolveJiraAuthFlow } from "./jira-auth-flow-wiring";

const flow = async () => ({ success: true });
const base = { hasPasswordCredentials: true, load: async () => flow };
const failing = async () => { throw new Error("JIRA_AUTH_FLOW_UNAVAILABLE"); };

test("implicit password-login scenario (no authIntent) gets the profile AuthFlow", async () => {
  assert.equal(await resolveJiraAuthFlow({ ...base, loginMode: "password" }), flow);
});

test("explicit full_authentication still gets the AuthFlow", async () => {
  assert.equal(await resolveJiraAuthFlow({ ...base, authIntent: "full_authentication", loginMode: "password" }), flow);
});

test("authored credential entry tolerates a missing project AuthFlow when the profile has no gate data", async () => {
  let loads = 0;
  const resolved = await resolveJiraAuthFlow({ authIntent: "full_authentication", loginMode: "no_login",
    hasPasswordCredentials: false, hasAuthoredCredentialEntry: true,
    load: async () => { loads++; throw new Error("JIRA_AUTH_FLOW_UNAVAILABLE"); } });
  assert.equal(resolved, undefined);
  assert.equal(loads, 1);
});

test("authored credential entry keeps the configured AuthFlow available when gate data exists", async () => {
  let loads = 0;
  const resolved = await resolveJiraAuthFlow({ ...base, authIntent: "full_authentication", loginMode: "no_login",
    hasAuthoredCredentialEntry: true, hasAuthGateData: true,
    load: async () => { loads++; return flow; } });
  assert.equal(resolved, flow);
  assert.equal(loads, 1);
});

test("no_login, manual, missing mode and gate_observation never load the AuthFlow", async () => {
  let loads = 0;
  const load = async () => { loads++; return flow; };
  for (const input of [{ loginMode: "no_login" }, { loginMode: "manual" }, {},
    { loginMode: "password", authIntent: "gate_observation" }]) {
    assert.equal(await resolveJiraAuthFlow({ hasPasswordCredentials: true, load, ...input }), undefined);
  }
  assert.equal(loads, 0);
});

test("implicit scenario without an auth.flow degrades to no flow instead of failing", async () => {
  assert.equal(await resolveJiraAuthFlow({ ...base, loginMode: "password", load: failing }), undefined);
});

test("configured auth gate data: implicit flow load failure is not swallowed", async () => {
  await assert.rejects(resolveJiraAuthFlow({ ...base, loginMode: "password", hasAuthGateData: true, load: failing }),
    /JIRA_AUTH_FLOW_UNAVAILABLE/);
});

test("flat and auth-nested profile data map into clients.defaultClient", () => {
  const flat = mapJiraAuthTestData({ identificationNumber: "id1", otp: "o1", other: "x" });
  assert.deepEqual((flat.clients as any).defaultClient, { identificationNumber: "id1", otp: "o1" });
  assert.equal(flat.other, "x");
  const nested = mapJiraAuthTestData({ auth: { identificationType: "cedula", identificationNumber: "id2", otp: "o2" } });
  assert.deepEqual((nested.clients as any).defaultClient, { identificationType: "cedula", identificationNumber: "id2", otp: "o2" });
  assert.equal(hasJiraAuthGateData(nested), true);
});

test("existing structured clients are preserved; no auth data maps to nothing", () => {
  const structured = { clients: { defaultClient: { identificationNumber: "keep", otp: "keep" } }, otp: "flat" };
  assert.deepEqual(mapJiraAuthTestData(structured), structured);
  assert.equal(hasJiraAuthGateData(mapJiraAuthTestData({ username: "u" })), false);
  assert.equal(hasJiraAuthGateData(mapJiraAuthTestData(undefined)), false);
});

test("profile-style dotted aliases map to defaultClient; security token is not OTP", () => {
  const mapped = mapJiraAuthTestData({
    "auth.company_identifier": "131", "auth.username": "ana", "auth.password": "pw",
    "auth.access_code": "123456", "auth.security_token": "tok", other: "x",
  });
  assert.deepEqual((mapped.clients as any).defaultClient,
    { identificationNumber: "131", identificationType: "rnc", username: "ana", password: "pw", otp: "123456" });
  assert.equal(mapped.other, "x");
  assert.equal(hasJiraAuthGateData(mapped), true);
  const spanish = mapJiraAuthTestData({ auth: { rnc: "9", usuario: "u", contrasena: "p", codigo: "7" } });
  assert.deepEqual((spanish.clients as any).defaultClient,
    { identificationNumber: "9", identificationType: "rnc", username: "u", password: "p", otp: "7" });
  const tokenOnly = mapJiraAuthTestData({ "auth.security_token": "tok", token: "t", username: "u" });
  assert.equal(hasJiraAuthGateData(tokenOnly), false);
  const ambiguous = mapJiraAuthTestData({ identification_number: "5", verification_code: "1" });
  assert.deepEqual((ambiguous.clients as any).defaultClient, { identificationNumber: "5", otp: "1" });
  const cedula = mapJiraAuthTestData({ cedula: "4" });
  assert.deepEqual((cedula.clients as any).defaultClient, { identificationNumber: "4", identificationType: "cedula" });
});

test("structured defaultClient wins over dotted aliases", () => {
  const structured = { clients: { defaultClient: { identificationNumber: "keep" } }, "auth.access_code": "x" };
  assert.deepEqual(mapJiraAuthTestData(structured), structured);
});

test("explicit full_authentication without flow and without password credentials still fails", async () => {
  await assert.rejects(resolveJiraAuthFlow({ authIntent: "full_authentication", loginMode: "manual",
    hasPasswordCredentials: false, load: failing }), /JIRA_AUTH_FLOW_UNAVAILABLE/);
});
