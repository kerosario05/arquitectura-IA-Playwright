import { test, expect } from "@playwright/test";
import { resolveEntityWithinContainerAssertion, resolveRowScopedAssertion } from "../src/discovery/assertion-resolver";

test("matches an exact value only inside the declared row", async ({ page }) => {
  await page.setContent(`
    <table>
      <thead><tr><th>Name</th><th>Birth date</th></tr></thead>
      <tbody>
        <tr><td>first</td><td>16/08/1995</td></tr>
        <tr><td>first</td><td>01/01/2000</td></tr>
      </tbody>
    </table>
  `);

  const result = await resolveRowScopedAssertion(page, {
    index: 1,
    action: "validate row",
    target: "que el name sea [expected]",
    source: "action",
    rowScope: 2,
    expectedValueKey: "expected",
  }, { expectedValue: "first", expectedValueSource: "explicit_runtime_input", expectedValueVerified: true });
  expect(result.status).toBe("passed");
  expect(result.reason).toBe("row_scoped_exact_match");
});

test("normalizes an unambiguous date representation without global fallback", async ({ page }) => {
  await page.setContent(`
    <table><thead><tr><th>Birth date</th></tr></thead>
      <tbody><tr><td>16/08/1995</td></tr></tbody>
    </table>
  `);
  const result = await resolveRowScopedAssertion(page, {
    index: 1,
    action: "validate row",
    target: "que la birth date sea [expected]",
    source: "action",
    rowScope: 1,
    expectedValueKey: "expected",
  }, { expectedValue: "1995-08-16", expectedValueSource: "explicit_runtime_input", expectedValueVerified: true });
  expect(result.status).toBe("passed");
  expect(result.reason).toBe("row_scoped_date_normalized_match");
});

test("rejects an unverified synthetic exact oracle", async ({ page }) => {
  await page.setContent(`<table><thead><tr><th>nombre</th></tr></thead><tbody><tr><td>first</td></tr></tbody></table>`);
  const result = await resolveRowScopedAssertion(page, {
    index: 1,
    action: "validate row",
    target: "que el nombre sea [expected]",
    source: "action",
    rowScope: 1,
    expectedValueKey: "expected",
  }, { expectedValue: "first", expectedValueSource: "deterministic_synthetic", expectedValueVerified: false });
  expect(result.status).toBe("needs_assertion_resolution");
  expect(result.reason).toBe("ORACLE_AUTHORITY_MISSING");
});

test("accepts an explicit oracle even when verified metadata is absent", async ({ page }) => {
  await page.setContent(`<table><thead><tr><th>nombre</th></tr></thead><tbody><tr><td>first</td></tr></tbody></table>`);
  const result = await resolveRowScopedAssertion(page, {
    index: 1, action: "validate row", target: "que el nombre sea [expected]", source: "action", rowScope: 1, expectedValueKey: "expected",
  }, { expectedValue: "first", expectedValueSource: "user_entered", expectedValueVerified: false });
  expect(result.status).toBe("passed");
});

test("requires structural containment instead of independent global text matches", async ({ page }) => {
  await page.setContent(`<section><h2>Group A</h2><div>entity-a</div></section><section><h2>Group B</h2><div>entity-b</div></section>`);
  const result = await resolveEntityWithinContainerAssertion(page, {
    index: 1, action: "validate containment", target: "entity [entity] inside section [section]", source: "action",
  }, { entityValue: "entity-b", containerValue: "Group B", entitySource: "explicit_runtime_input", containerSource: "explicit_runtime_input" });
  expect(result.status).toBe("passed");
  expect(result.reason).toBe("entity_within_container");
});
