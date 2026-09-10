import assert from "node:assert/strict";
import test from "node:test";
import {
  readProjectConfigurationOnConnection,
  type ProjectRow,
} from "./project-reader";
import { buildWebAppConfig } from "./project-materializer";

const project: ProjectRow = {
  id: "project-1",
  slug: "web-project",
  name: "Web project",
  projectType: 1,
  status: 1,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function connectionWithWebRow(ignoreHTTPSErrors: unknown) {
  return {
    query: async (sql: string) => sql.includes("WebProjectConfiguration")
      ? [{
          baseUrl: "https://example.test",
          loginMode: 2,
          username: null,
          passwordSecretRef: null,
          missingInputBehavior: 1,
          testDataJson: null,
          testDataAliasesJson: null,
          extraLoginFieldsJson: null,
          ignoreHTTPSErrors,
        }]
      : [],
  } as any;
}

test("reads and normalizes the project HTTPS option", async () => {
  const enabled = await readProjectConfigurationOnConnection(
    connectionWithWebRow(1),
    project,
  );
  const disabled = await readProjectConfigurationOnConnection(
    connectionWithWebRow(0),
    project,
  );
  const legacy = await readProjectConfigurationOnConnection(
    connectionWithWebRow(null),
    project,
  );

  assert.equal(enabled.web?.ignoreHTTPSErrors, true);
  assert.equal(disabled.web?.ignoreHTTPSErrors, false);
  assert.equal(legacy.web?.ignoreHTTPSErrors, false);
});

test("selects the BIT before NVARCHAR(MAX) columns for ODBC", async () => {
  let sql = "";
  const conn = {
    query: async (statement: string) => {
      if (statement.includes("WebProjectConfiguration")) sql = statement;
      return [{
        baseUrl: "https://example.test",
        loginMode: 2,
        username: null,
        passwordSecretRef: null,
        missingInputBehavior: 1,
        testDataJson: null,
        testDataAliasesJson: null,
        extraLoginFieldsJson: null,
        ignoreHTTPSErrors: 0,
      }];
    },
  } as any;

  await readProjectConfigurationOnConnection(conn, project);
  assert.ok(sql.indexOf("ignoreHTTPSErrors") < sql.indexOf("testDataJson"));
  assert.ok(sql.indexOf("ignoreHTTPSErrors") < sql.indexOf("testDataAliasesJson"));
  assert.ok(sql.indexOf("ignoreHTTPSErrors") < sql.indexOf("extraLoginFieldsJson"));
});

test("materializes the project HTTPS option with a safe legacy default", () => {
  const warnings: string[] = [];
  const base = {
    ...project,
    web: {
      baseUrl: "https://example.test",
      loginMode: 2,
      username: null,
      passwordSecretRef: null,
      testDataJson: null,
      testDataAliasesJson: null,
      missingInputBehavior: 1,
      extraLoginFieldsJson: null,
    },
  } as any;

  assert.equal(buildWebAppConfig({ ...base, web: { ...base.web, ignoreHTTPSErrors: true } }, warnings).ignoreHTTPSErrors, true);
  assert.equal(buildWebAppConfig(base, warnings).ignoreHTTPSErrors, false);
});
