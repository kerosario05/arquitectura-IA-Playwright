import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyLaunchDataOverridesToRuntimeEntries, buildJiraSemanticChildDataOverrides, writeRuntimeContextIfPresent } from "./discovery-batch-runner";

const publishedCases = [
  { scenarioId: "SC-1", caseId: 100, title: "a", sourceType: "jira_preview" },
  { scenarioId: "SC-2", caseId: 200, title: "b", launchScenarioId: "LAUNCH-2", sourceType: "jira_preview" },
];

const never = async () => {
  throw new Error("linkage must not be consulted");
};

test("launch dataOverrides reach the per-case runtime context by published-case mapping", async () => {
  const params = await applyLaunchDataOverridesToRuntimeEntries({
    caseIds: [100, 200],
    publishedCases,
    dataOverrides: { "SC-1": { "Clave": "v1", "otp": "v2" }, "LAUNCH-2": { monto: "v3" }, "UNMAPPED": { x: "y" } },
    runtimeEntriesByCase: { "100": [{ key: "clave", value: "explicit", source: "explicit_runtime_input", sensitive: false }] },
  } as any, never);
  const byCase = params.runtimeEntriesByCase!;
  assert.equal(byCase["100"].find((e) => e.key === "clave")?.value, "explicit"); // explicit wins
  assert.equal(byCase["100"].some((e) => e.key === "Clave"), false);
  assert.equal(byCase["100"].find((e) => e.key === "otp")?.source, "user_provided_qa_credentials");
  assert.deepEqual(byCase["200"].map((e) => [e.key, e.value]), [["monto", "v3"]]);
  assert.equal(Object.keys(byCase).length, 2); // no cross-case or unmapped leakage

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovr-"));
  try {
    const file = writeRuntimeContextIfPresent("ovr-job", params, dir)!;
    assert.equal(JSON.parse(fs.readFileSync(file, "utf-8"))["200"][0].value, "v3");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Jira semantic child receives mapped inputs scoped to its source scenario", async () => {
  const entries = await applyLaunchDataOverridesToRuntimeEntries({
    appSlug: "web-test",
    caseIds: [100, 200],
    publishedCases: [
      { scenarioId: "TR-100", launchScenarioId: "LAUNCH-100", caseId: 100, title: "a", sourceType: "jira_preview" },
      { scenarioId: "TR-200", launchScenarioId: "LAUNCH-200", caseId: 200, title: "b", sourceType: "jira_preview" },
    ],
    dataOverrides: {
      "LAUNCH-100": { account_number: "synthetic-account-100" },
      "LAUNCH-200": { account_number: "synthetic-account-200" },
      "SOURCE-100": { note: "direct-scenario-value" },
    },
  } as any, never);

  assert.deepEqual(buildJiraSemanticChildDataOverrides(entries, { scenarioId: "SOURCE-100" }, {
    scenarioId: "TR-100", launchScenarioId: "LAUNCH-100", caseId: 100, title: "a", sourceType: "jira_preview",
  }), {
    "SOURCE-100": {
      note: "direct-scenario-value",
      account_number: "synthetic-account-100",
    },
  });
});

const rerun = (over: Record<string, unknown> = {}) => ({
  appSlug: "fenix",
  caseIds: [300],
  publishedCases: [{ scenarioId: "SC-9", caseId: 300, title: "c", sourceType: "testrail_case" }],
  dataOverrides: { "SC-9": { clave: "v" } },
  ...over,
}) as any;

test("verified Jira-generated testrail_case rerun receives overrides", async () => {
  const calls: Array<[string, number]> = [];
  const out = await applyLaunchDataOverridesToRuntimeEntries(rerun(), async (slug, id) => {
    calls.push([slug, id]);
    return true;
  });
  assert.deepEqual(calls, [["fenix", 300]]);
  assert.deepEqual(out.runtimeEntriesByCase!["300"].map((e) => [e.key, e.value]), [["clave", "v"]]);
});

test("testrail_case without Jira linkage, resolver error, or appSlug stays unchanged", async () => {
  const noLink = rerun();
  assert.equal(await applyLaunchDataOverridesToRuntimeEntries(noLink, async () => false), noLink);
  const boom = rerun();
  assert.equal(await applyLaunchDataOverridesToRuntimeEntries(boom, async () => { throw new Error("x"); }), boom);
  const noApp = rerun({ appSlug: undefined });
  assert.equal(await applyLaunchDataOverridesToRuntimeEntries(noApp, never), noApp);
});

test("ambiguous ownership fails closed for testrail_case", async () => {
  const yes = async () => true;
  const dupCase = rerun({
    publishedCases: [
      { scenarioId: "SC-9", caseId: 300, title: "c", sourceType: "testrail_case" },
      { scenarioId: "SC-10", caseId: 300, title: "d", sourceType: "testrail_case" },
    ],
  });
  assert.equal(await applyLaunchDataOverridesToRuntimeEntries(dupCase, yes), dupCase);
  const sharedId = rerun({
    caseIds: [300, 301],
    publishedCases: [
      { scenarioId: "SC-9", caseId: 300, title: "c", sourceType: "testrail_case" },
      { scenarioId: "SC-9", caseId: 301, title: "d", sourceType: "testrail_case" },
    ],
  });
  assert.equal(await applyLaunchDataOverridesToRuntimeEntries(sharedId, yes), sharedId);
  const conflicting = rerun({
    publishedCases: [{ scenarioId: "SC-9", launchScenarioId: "L-9", caseId: 300, title: "c", sourceType: "testrail_case" }],
    dataOverrides: { "SC-9": { clave: "a" }, "L-9": { clave: "b" } },
  });
  assert.equal(await applyLaunchDataOverridesToRuntimeEntries(conflicting, yes), conflicting);
});

test("untyped and recording published entries are never touched", async () => {
  for (const sourceType of [undefined, "recording"]) {
    const base = rerun({ publishedCases: [{ scenarioId: "SC-9", caseId: 300, title: "c", sourceType }] });
    assert.equal(await applyLaunchDataOverridesToRuntimeEntries(base, never), base);
  }
});

const existingCases = (ids: number[]) => ids.map((caseId) => ({
  scenarioId: `auto-${caseId}`, caseId, title: `t${caseId}`, sourceType: "testrail_case", launchScenarioId: `TR-CASE-${caseId}`, appSlug: "fenix",
}));

test("existing TestRail cases receive overrides keyed by caseId or launch scenarioId, without cross-case leakage", async () => {
  const out = await applyLaunchDataOverridesToRuntimeEntries({
    appSlug: "fenix",
    caseIds: [54723, 54724, 54725, 54726],
    publishedCases: existingCases([54723, 54724, 54725, 54726]),
    dataOverrides: {
      "54723": { clave: "a" },
      "TR-CASE-54724": { clave: "b" },
      "54725": { clave: "c" },
      "TR-CASE-54725": { clave: "c" }, // equal values under two keys of the same case merge
    },
  } as any, async () => true);
  const byCase = out.runtimeEntriesByCase!;
  const vals = (id: string) => byCase[id]?.map((e) => e.value);
  assert.deepEqual(vals("54723"), ["a"]);
  assert.deepEqual(vals("54724"), ["b"]);
  assert.deepEqual(vals("54725"), ["c"]);
  assert.equal(byCase["54726"], undefined);
});

test("Jira TestRail-only manifest shape (slug scenarioId, no launch/execution/custom ids) maps by caseId per case", async () => {
  const slugs = ["aa-111-jira-1-a", "aa-111-jira-2-b", "aa-111-jira-3-c", "aa-111-jira-4-d"];
  const ids = [54723, 54724, 54725, 54726];
  const out = await applyLaunchDataOverridesToRuntimeEntries({
    appSlug: "jira-regression-lab",
    caseIds: ids,
    publishedCases: ids.map((caseId, i) => ({ scenarioId: slugs[i], caseId, title: `t${i}`, sourceType: "testrail_case", appSlug: "jira-regression-lab" })),
    dataOverrides: { "54723": { clave: "a" }, "54725": { clave: "c" }, [slugs[1]]: { clave: "b" } },
  } as any, async () => true);
  const byCase = out.runtimeEntriesByCase!;
  assert.deepEqual(["54723", "54724", "54725"].map((id) => byCase[id]?.map((e) => e.value)), [["a"], ["b"], ["c"]]);
  assert.equal(byCase["54726"], undefined);
});

test("caseId key does not own jira_preview entries; differing values under two keys fail closed", async () => {
  const preview = { appSlug: "fenix", publishedCases: [{ scenarioId: "SC-1", caseId: 100, title: "a", sourceType: "jira_preview" }], dataOverrides: { "100": { x: "y" } } } as any;
  assert.equal(await applyLaunchDataOverridesToRuntimeEntries(preview, never), preview);
  const conflicting = { appSlug: "fenix", publishedCases: existingCases([1]), dataOverrides: { "1": { k: "a" }, "TR-CASE-1": { k: "b" } } } as any;
  assert.equal(await applyLaunchDataOverridesToRuntimeEntries(conflicting, async () => true), conflicting);
});

test("absent or unmapped overrides preserve params unchanged", async () => {
  const base = { caseIds: [100], publishedCases, runtimeEntriesByCase: { "100": [] } } as any;
  assert.equal(await applyLaunchDataOverridesToRuntimeEntries(base, never), base);
  const unmapped = { ...base, dataOverrides: { other: { a: "b" } } };
  assert.equal(await applyLaunchDataOverridesToRuntimeEntries(unmapped, never), unmapped);
});
