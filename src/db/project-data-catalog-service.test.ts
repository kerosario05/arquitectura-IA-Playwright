import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeCatalogField, resolveProjectDataCatalogMatches, type ProjectDataCatalog } from "./project-data-catalog-service";

const catalogs: ProjectDataCatalog[] = [
  { id: "fenix-account", projectSlug: "fenix", name: "Cuentas", fieldName: "Cuenta de origen", aliases: [], active: true, revision: 2, options: [] },
  { id: "other", projectSlug: "fenix", name: "Cuentas alternas", fieldName: "Cuenta de origen", aliases: [], active: true, revision: 1, options: [] },
  { id: "disabled", projectSlug: "fenix", name: "Legacy", fieldName: "Cuenta de origen", aliases: [], active: false, revision: 1, options: [] },
];

test("catalog matching normalizes accents and separators and does not fuzzy-match", () => {
  assert.equal(normalizeCatalogField("Cuenta_de-ORIGEN"), "cuenta de origen");
  assert.deepEqual(resolveProjectDataCatalogMatches("Cuenta de origen", catalogs).map((item) => item.id), ["fenix-account", "other"]);
  assert.deepEqual(resolveProjectDataCatalogMatches("Cuenta origen", catalogs), []);
  assert.deepEqual(resolveProjectDataCatalogMatches("Cuenta de origen", catalogs.filter((item) => item.projectSlug === "otro")), []);
});

test("SQL Server migration creates project-scoped catalogs and options idempotently", () => {
  const sql = fs.readFileSync("sql/schema/006-project-data-catalog.sql", "utf8");
  assert.match(sql, /IF OBJECT_ID\('dbo\.ProjectDataCatalog', 'U'\) IS NULL/);
  assert.match(sql, /FOREIGN KEY \(projectId\) REFERENCES dbo\.Projects\(id\) ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \(catalogId\) REFERENCES dbo\.ProjectDataCatalog\(id\) ON DELETE CASCADE/);
});
