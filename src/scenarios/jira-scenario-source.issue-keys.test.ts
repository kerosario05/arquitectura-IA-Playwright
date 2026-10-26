import assert from "node:assert/strict";
import test from "node:test";
import { buildIssueKeysJql } from "./jira-scenario-source";

// Web launches pick HU by key inside the Jira project, with no sprint and no status filter.

test("builds a project-scoped key lookup, normalised and de-duplicated", () => {
  assert.deepEqual(buildIssueKeysJql("AA", [" aa-82", "AA-82", "AA-7"]), {
    jql: 'project = "AA" AND key in (AA-82, AA-7) ORDER BY created DESC',
    keys: ["AA-82", "AA-7"],
  });
});

test("malformed keys never reach the JQL", () => {
  assert.deepEqual(buildIssueKeysJql("AA", ["AA-1) OR project = X", "", "AA-3"])?.keys, ["AA-3"]);
  assert.equal(buildIssueKeysJql("AA", ["not a key", ""]), null);
});
