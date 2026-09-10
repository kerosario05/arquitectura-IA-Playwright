import { config } from "../config/env";
import { buildDataContext } from "../data";
import type { DataContextEntry } from "../data/data-context";

function isConfiguredJsonLike(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return false;
  }

  return trimmed !== "{}";
}

function countBySource(entries: DataContextEntry[]): Record<DataContextEntry["source"], number> {
  const counts: Record<DataContextEntry["source"], number> = {
    explicit_runtime_input: 0,
    runtime_context: 0,
    user_provided_qa_credentials: 0,
    app_username: 0,
    app_password: 0,
    extra_login_field: 0,
    test_data: 0,
    test_data_alias: 0,
    promoted_manifest: 0,
    auto_generated: 0,
    fixture: 0,
    environment_variable: 0,
    data_override: 0,
    suggested_value: 0,
    qa_dataset: 0,
    project_config: 0
  };

  for (const entry of entries) {
    counts[entry.source] += 1;
  }

  return counts;
}

function formatConfigured(value: boolean): string {
  return value ? "configured" : "not configured";
}

function runInspection(): void {
  const dataContext = buildDataContext(config);
  const sourceCounts = countBySource(dataContext.entries);

  const extraLoginConfigured = isConfiguredJsonLike(process.env.APP_EXTRA_LOGIN_FIELDS_JSON);
  const testDataConfigured = isConfiguredJsonLike(process.env.APP_TEST_DATA_JSON);
  const aliasesConfigured = isConfiguredJsonLike(process.env.APP_TEST_DATA_ALIASES_JSON);

  console.log("DataContext inspection");
  console.log("----------------------");
  console.log(`Total entries: ${dataContext.counts.total}`);
  console.log(`Sensitive entries: ${dataContext.counts.sensitive}`);
  console.log(`Non-sensitive entries: ${dataContext.counts.nonSensitive}`);
  console.log("");
  console.log("Sources:");
  console.log(`- app_username: ${sourceCounts.app_username}`);
  console.log(`- app_password: ${sourceCounts.app_password}`);
  console.log(`- extra_login_field: ${sourceCounts.extra_login_field}`);
  console.log(`- test_data: ${sourceCounts.test_data}`);
  console.log(`- test_data_alias: ${sourceCounts.test_data_alias}`);
  console.log(`- promoted_manifest: ${sourceCounts.promoted_manifest}`);
  console.log(`- auto_generated: ${sourceCounts.auto_generated}`);
  console.log(`- fixture: ${sourceCounts.fixture}`);
  console.log(`- environment_variable: ${sourceCounts.environment_variable}`);
  console.log(`- data_override: ${sourceCounts.data_override}`);
  console.log(`- suggested_value: ${sourceCounts.suggested_value}`);
  console.log("");
  console.log(`Dynamic aliases groups: ${Object.keys(config.app.testDataAliases).length}`);
  console.log(`Missing input behavior: ${config.app.missingInputBehavior}`);
  console.log("");
  console.log("Config parsing:");
  console.log(`- APP_EXTRA_LOGIN_FIELDS_JSON: ${formatConfigured(extraLoginConfigured)}`);
  console.log(`- APP_TEST_DATA_JSON: ${formatConfigured(testDataConfigured)}`);
  console.log(`- APP_TEST_DATA_ALIASES_JSON: ${formatConfigured(aliasesConfigured)}`);
  console.log("");
  console.log("No sensitive values were printed.");
}

try {
  runInspection();
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[data:inspect] Configuration error: ${message}`);
  process.exitCode = 1;
}
