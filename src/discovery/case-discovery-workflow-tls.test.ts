import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscoveryBrowserContextOptions } from "./case-discovery-workflow";

test("uses only the project TLS setting for the discovery context", () => {
  assert.deepEqual(
    buildDiscoveryBrowserContextOptions({ app: { ignoreHTTPSErrors: true } }),
    { ignoreHTTPSErrors: true },
  );
  assert.deepEqual(
    buildDiscoveryBrowserContextOptions({ app: { ignoreHTTPSErrors: false } }),
    { ignoreHTTPSErrors: false },
  );
  assert.deepEqual(
    buildDiscoveryBrowserContextOptions({ app: {} }),
    { ignoreHTTPSErrors: false },
  );
});
