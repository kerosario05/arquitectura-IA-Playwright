/**
 * AI Routing Validation Script
 *
 * Verifica que la configuración de AI se resuelve correctamente sin invocar los modelos reales.
 * Útil para validar routing local sin gastar tokens.
 */

import { resolveScenarioAiConfig, resolveRepairAiConfig, resolveGeneralAiConfig } from "../src/ai/ai-config-resolver";

async function testAiRouting(): Promise<void> {
  console.log("\n===== AI Provider Routing Validation =====\n");

  try {
    // Test scenario generation config
    console.log("[Scenario Generation]");
    try {
      const scenarioConfig = resolveScenarioAiConfig();
      console.log(`[ai-provider] purpose=scenario_generation provider=${scenarioConfig.provider} model=${scenarioConfig.model} timeoutMs=${scenarioConfig.timeoutMs} maxAttempts=${scenarioConfig.maxAttempts ?? 1}`);
    } catch (error) {
      console.error(`[ai-provider] purpose=scenario_generation ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log("");

    // Test repair config
    console.log("[Repair]");
    try {
      const repairConfig = resolveRepairAiConfig();
      console.log(`[ai-provider] purpose=repair provider=${repairConfig.provider} model=${repairConfig.model} timeoutMs=${repairConfig.timeoutMs} maxAttempts=${repairConfig.maxAttempts ?? 1}`);
    } catch (error) {
      console.error(`[ai-provider] purpose=repair ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log("");

    // Test general config
    console.log("[General]");
    try {
      const generalConfig = resolveGeneralAiConfig();
      console.log(`[ai-provider] purpose=general provider=${generalConfig.provider} model=${generalConfig.model} timeoutMs=${generalConfig.timeoutMs} maxAttempts=${generalConfig.maxAttempts ?? 1}`);
    } catch (error) {
      console.error(`[ai-provider] purpose=general ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log("\n===== Validation Complete =====\n");
    process.exit(0);
  } catch (error) {
    console.error("\n===== Validation Failed =====");
    console.error(error);
    process.exit(1);
  }
}

testAiRouting();
