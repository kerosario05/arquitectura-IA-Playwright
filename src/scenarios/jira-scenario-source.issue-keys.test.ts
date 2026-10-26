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

test("accepts a numeric Jira project id for a project-scoped lookup", () => {
  assert.deepEqual(buildIssueKeysJql("10042", ["AA-82"]), {
    jql: 'project = "10042" AND key in (AA-82) ORDER BY created DESC',
    keys: ["AA-82"],
  });
});

test("rejects malformed project identifiers instead of inserting them into JQL", () => {
  assert.equal(buildIssueKeysJql('AA" OR project = OTHER', ["AA-82"]), null);
  assert.equal(buildIssueKeysJql("0", ["AA-82"]), null);
});
