import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_VERSION, isOlderAgentVersion } from "./version";

test("isOlderAgentVersion compara por números, no como texto", () => {
  assert.equal(isOlderAgentVersion("0.2.0", "0.3.0"), true);
  assert.equal(isOlderAgentVersion("0.3.0", "0.3.0"), false);
  assert.equal(isOlderAgentVersion("0.10.0", "0.9.1"), false);
  assert.equal(isOlderAgentVersion("0.3", "0.3.1"), true);
  assert.equal(isOlderAgentVersion("0.4.0", "0.3.0"), false, "un agente más nuevo que el servidor no se baja de versión");
  assert.equal(isOlderAgentVersion("dev", "0.3.0"), false);
  assert.equal(isOlderAgentVersion("0.0.1"), true, "sin segundo argumento compara con la versión de este agente");
  assert.equal(isOlderAgentVersion(AGENT_VERSION), false);
});
