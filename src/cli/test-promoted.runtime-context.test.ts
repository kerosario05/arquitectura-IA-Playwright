import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  preparePromotedRuntimeInputs,
  resolvePromotedRuntimeInputKeys,
} from "./test-promoted";
import { buildPromotedDataContext, buildPromotedDataManifest } from "../data/promoted-data";

const requiredKeys = [
  "auth.company_identifier",
  "auth.username",
  "auth.password",
];

async function withContext(entries: Array<{ key: string; value: string }>, run: (contextPath: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "promoted-runtime-context-"));
  const contextPath = path.join(directory, "context.json");
  await fs.writeFile(contextPath, JSON.stringify({ "44757": entries }), "utf8");
  try {
    await run(contextPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("runtime context overrides inherited values without mutating process.env", async () => {
  await withContext(requiredKeys.map((key) => ({ key, value: `fixture-${key}` })), async (contextPath) => {
    const inherited = {
      APP_COMPANY_IDENTIFIER: "inherited-company",
      APP_USERNAME: "inherited-user",
      APP_PASSWORD: "inherited-password",
      DISCOVERY_RUNTIME_CONTEXT: contextPath,
    };
    const result = await preparePromotedRuntimeInputs({
      contextPath,
      caseId: 44757,
      baseEnv: inherited,
      requiredKeys,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.resolvedKeys, requiredKeys);
    assert.equal(result.env.APP_COMPANY_IDENTIFIER, "fixture-auth.company_identifier");
    assert.equal(result.env.APP_USERNAME, "fixture-auth.username");
    assert.equal(result.env.APP_PASSWORD, "fixture-auth.password");
    assert.equal(result.env.DISCOVERY_RUNTIME_CONTEXT, contextPath);
    assert.equal(inherited.APP_USERNAME, "inherited-user");
  });
});

test("explicit runtime inputs take precedence over a case context and inherited environment", async () => {
  await withContext(requiredKeys.map((key) => ({ key, value: `stale-${key}` })), async (contextPath) => {
    const result = await preparePromotedRuntimeInputs({
      contextPath,
      caseId: 44757,
      baseEnv: {
        APP_COMPANY_IDENTIFIER: "configured-company",
        APP_USERNAME: "configured-user",
        APP_PASSWORD: "configured-password",
        PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON: JSON.stringify(Object.fromEntries(
          requiredKeys.map((key) => [key, `explicit-${key}`])
        )),
      },
      requiredKeys,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.resolvedSources, Object.fromEntries(
      requiredKeys.map((key) => [key, "user_provided_qa_credentials"])
    ));
    assert.equal(result.env.APP_USERNAME, "explicit-auth.username");
    assert.equal(result.env.APP_PASSWORD, "explicit-auth.password");
  });
});

test("missing runtime keys fail closed and do not fall back to inherited env", async () => {
  for (const missingKey of requiredKeys) {
    const entries = requiredKeys
      .filter((key) => key !== missingKey)
      .map((key) => ({ key, value: `fixture-${key}` }));
    await withContext(entries, async (contextPath) => {
      const result = await preparePromotedRuntimeInputs({
        contextPath,
        caseId: 44757,
        baseEnv: {
          APP_COMPANY_IDENTIFIER: "inherited-company",
          APP_USERNAME: "inherited-user",
          APP_PASSWORD: "inherited-password",
        },
        requiredKeys,
      });
      assert.equal(result.ok, false);
      assert.equal(result.missingKey, missingKey);
      assert.deepEqual(result.resolvedKeys, []);
    });
  }
});

test("empty runtime values are rejected and absent context cannot use inherited values", async () => {
  await withContext(requiredKeys.map((key) => ({ key, value: key.endsWith("password") ? "" : `fixture-${key}` })), async (contextPath) => {
    const result = await preparePromotedRuntimeInputs({
      contextPath,
      caseId: 44757,
      baseEnv: { APP_PASSWORD: "inherited-password" },
      requiredKeys,
    });
    assert.equal(result.ok, false);
    assert.equal(result.missingKey, "auth.password");
  });

  const absent = await preparePromotedRuntimeInputs({
    contextPath: undefined,
    caseId: 44757,
    baseEnv: { APP_USERNAME: "inherited-user" },
    requiredKeys,
  });
  assert.equal(absent.ok, false);
  assert.equal(absent.missingKey, "auth.company_identifier");
});

test("required keys are derived from the physical spec's env references", () => {
  const source = [
    "process.env.APP_COMPANY_IDENTIFIER",
    "process.env.APP_USERNAME",
    "process.env.APP_PASSWORD",
  ].join(" ");
  assert.deepEqual(resolvePromotedRuntimeInputKeys(source), requiredKeys);
});

test("declared functional data keys are admitted to the runtime input gate", () => {
  const source = `const value = requirePromotedData(dataContext, "employee.invalid_document", { fieldName: "field" });`;
  assert.deepEqual(resolvePromotedRuntimeInputKeys(source), ["employee.invalid_document"]);
});

test("explicit functional runtime input overrides stale context and reaches child data overrides", async () => {
  await withContext([{ key: "employee.invalid_document", value: "stale-value" }], async (contextPath) => {
    const result = await preparePromotedRuntimeInputs({
      contextPath,
      caseId: 44757,
      baseEnv: {
        PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON: JSON.stringify({ "employee.invalid_document": "explicit-value" }),
      },
      requiredKeys: ["employee.invalid_document"],
    });

    assert.equal(result.ok, true);
    assert.equal(result.resolvedSources["employee.invalid_document"], "explicit_runtime_input");
    assert.equal(result.env.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON, undefined);

    const previous = process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON;
    try {
      process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON = result.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON;
      const dataContext = buildPromotedDataContext({
        baseDataContext: {
          entries: [{ key: "employee.invalid_document", value: "stale-base", source: "test_data", sensitive: false }],
          counts: { total: 1, sensitive: 0, nonSensitive: 1 },
        },
        autoGenerateTestData: false,
      });
      assert.equal(dataContext.entries.find((entry) => entry.key === "employee.invalid_document")?.value, "explicit-value");
      assert.equal(dataContext.entries.find((entry) => entry.key === "employee.invalid_document")?.source, "explicit_runtime_input");
    } finally {
      if (previous === undefined) delete process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON;
      else process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON = previous;
    }
  });
});

test("runtime-only functional values are masked and omitted from promoted manifests", () => {
  const previous = process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON;
  try {
    process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON = JSON.stringify({ "employee.invalid_document": "runtime-only-value" });
    const dataContext = buildPromotedDataContext({
      baseDataContext: { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } },
      autoGenerateTestData: false,
    });
    const manifest = buildPromotedDataManifest({
      steps: [{ index: 1, action: "fill", valueKey: "employee.invalid_document", target: { name: "field" } }],
      requiredData: [{ key: "employee.invalid_document", required: true, sensitive: false }],
    } as any, dataContext);
    const entry = manifest.entries[0];
    assert.equal(entry.source, "explicit_runtime_input");
    assert.equal(entry.value, undefined);
    assert.notEqual(entry.maskedValue, "runtime-only-value");
  } finally {
    if (previous === undefined) delete process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON;
    else process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON = previous;
  }
});
