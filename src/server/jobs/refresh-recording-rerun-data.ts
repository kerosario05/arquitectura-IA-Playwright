import type {RerunPrepareResult} from './rerun-runner';
import {loadScenarios} from '../../recording/recording-store';
import {applyRuntimeDatasetValues,toSharedMcpScenario} from '../../recording/canonical-recording-contract';
import {freshRecordingCedulas} from '../services/recording-fresh-cedulas';

export async function refreshRecordingRerunData(prepared:Extract<RerunPrepareResult,{ok:true;jobType:'scenario-preview'}>,
  deps={load:loadScenarios,generate:freshRecordingCedulas},
  onLiveLog?:(line:string)=>void) {
  const specValues:Record<string,Record<string,string>>={};
  for(const entry of prepared.promotedSpecReuse) {
    const canonicalId=entry.canonicalScenarioId ?? entry.scenarioId;
    const source=prepared.scenarios.find(s=>s.scenarioId===entry.scenarioId || s.recordedScenarioId===canonicalId);
    const selection=prepared.recordingSelections?.find(s=>s.scenarioIds.includes(canonicalId));
    const recordingId=selection?.recordingId ?? source?.recordingId ?? prepared.recordingId;
    const appSlug=selection?.appSlug ?? source?.appSlug ?? prepared.appSlug;
    if(!recordingId) continue; // Non-Recording jobs retain their existing data policy.
    const canonical=deps.load(appSlug,recordingId).find(s=>s.scenarioId===canonicalId);
    if(!canonical) continue;
    const fresh=await deps.generate(appSlug,canonical,!entry.reuse);
    if(!Object.keys(fresh.values).length) continue;
    for(const [key,discoveryValue] of Object.entries(fresh.values)) {
      const specValue=fresh.specValues[key];
      onLiveLog?.(entry.reuse
        ? `[recording-rerun-data] scenarioId=${entry.scenarioId} field=${key} promotedSpecCedula=${discoveryValue}`
        : `[recording-rerun-data] scenarioId=${entry.scenarioId} field=${key} discoveryCedula=${discoveryValue} specCedula=${specValue ?? 'missing'} distinct=${Boolean(specValue && discoveryValue!==specValue)}`);
    }
    if(!entry.reuse) {
      const updated=applyRuntimeDatasetValues(canonical,fresh.values);
      // The re-derived dataset is the authority; the persisted copy in entry.runtimeValues can carry
      // values a later fix invalidated (e.g. from a step the QA has since deleted).
      entry.runtimeValues={...entry.runtimeValues,...updated.runtimeDataset?.resolvedValues,...fresh.values};
      const converted=toSharedMcpScenario(updated,appSlug,entry.runtimeValues);
      const index=prepared.scenarios.findIndex(s=>s.scenarioId===entry.scenarioId || s.recordedScenarioId===canonicalId);
      if(index<0) throw new Error('No se encontró el escenario de discovery para renovar sus datos');
      prepared.scenarios[index]={...prepared.scenarios[index],...converted,scenarioId:prepared.scenarios[index].scenarioId ?? entry.scenarioId};
      specValues[entry.scenarioId]=fresh.specValues;
      specValues[`${recordingId}\u0000${canonicalId}`]=fresh.specValues;
    } else entry.runtimeValues={...entry.runtimeValues,...fresh.values};
  }
  return specValues;
}
