import "dotenv/config";
import { loadScenarios } from "../src/recording/recording-store";
import { loadPromotedAppConfigSync } from "../src/automations/app-profile";
import { materializeRuntimeInputRequirements } from "../src/recording/canonical-recording-contract";
import { portalLoginFromRequirements, withPortalSession } from "../src/server/services/data-cedulas-reuse";
import { buildFicoRequest, FICO_ENDPOINT, summarizeFicoResponse } from "../src/server/services/fico-engine-probe";

// Usage: npx tsx scripts/fico-probe.ts <recordingId> <numeroSolicitud> <cedula> [cedula...]
// Signs in with the recording's own login values and asks the credit engine for each cédula.
// Every call is a real bureau consultation: keep the list short.
(async () => {
  const [recordingId, numeroSolicitud, ...ids] = process.argv.slice(2);
  if (!recordingId || !numeroSolicitud || !ids.length) throw new Error("Uso: fico-probe <recordingId> <numeroSolicitud> <cedula...>");
  const log = console.log;
  console.log = () => undefined; console.info = () => undefined; console.warn = () => undefined;
  const [scenario] = loadScenarios("portal-comercial", recordingId) as any[];
  const requirements = scenario.runtimeInputRequirements?.length ? scenario.runtimeInputRequirements : materializeRuntimeInputRequirements(scenario);
  const baseUrl = (loadPromotedAppConfigSync({ appSlug: "portal-comercial" }) as any)?.baseUrl;
  const login = portalLoginFromRequirements(requirements, baseUrl);
  if (!login) throw new Error("No hay usuario y contraseña en la grabación");
  await withPortalSession(login, async (http) => {
    for (const id of ids) {
      const response = await http("POST", FICO_ENDPOINT, { body: buildFicoRequest(id, { numeroSolicitud }) });
      if (response.status !== 200) { log(`${id} HTTP ${response.status} body=${JSON.stringify(response.body).slice(0, 300)}`); continue; }
      const summary = summarizeFicoResponse(response.body);
      log(`${id} approved=${summary.approved} final=${summary.finalDecision} cvIncome=${summary.cvIncomeEstimator}`);
      for (const product of summary.products) {
        log(`  ${product.product.padEnd(18)} ${product.decision.padEnd(10)} capNow=${product.capacityNow?.toFixed(1)} capFut=${product.capacityFuture?.toFixed(1)} ${product.allDecisions.join(" | ")}`);
      }
      if (summary.participantDecisions.length) log(`  participante: ${summary.participantDecisions.join(" | ")}`);
    }
  });
})().catch((error) => console.log("FICO_PROBE_ERR", error instanceof Error ? error.message : error));
