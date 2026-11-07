import {loadPromotedAppConfigSync} from '../../automations/app-profile';
import {findNextDataCedulasCustomers,validateDataCedulasDatabase} from './data-cedulas-new-customer';
import {createSessionCedulaReleaser,dataCedulasReuseEnabled,portalLoginFromRequirements} from './data-cedulas-reuse';
import type {RecordedScenario} from '../../recording/trace-to-scenario';
import {materializeRuntimeInputRequirements} from '../../recording/canonical-recording-contract';
const issuedByProject = new Map<string,string[]>();

function runtimeRequirementsFor(scenario: RecordedScenario) {
  // Match the canonical dataset builder: a persisted empty array is not authoritative and
  // older/partially hydrated recordings still need requirements materialized from requiredData.
  return scenario.runtimeInputRequirements?.length
    ? scenario.runtimeInputRequirements
    : materializeRuntimeInputRequirements(scenario);
}

function identificationKeysFromRequirements(requirements: ReturnType<typeof runtimeRequirementsFor>): string[] {
  return [...new Set(requirements.filter(requirement => {
    const label = `${requirement.semanticField ?? ''} ${requirement.valueKey}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return requirement.valueRole === 'action_input' && !requirement.sensitive
      && /cedula|identificaci[o?]n|\bid\b/i.test(label);
  }).map(requirement=>requirement.valueKey))];
}

export function identificationInputKeys(scenario: RecordedScenario): string[] {
  return identificationKeysFromRequirements(runtimeRequirementsFor(scenario));
}

/**
 * Optional floor derived from the largest income-like amount the recording declares (e.g.
 * "$80,000.00 mensual"), as a ratio set in DATA_CEDULAS_INCOME_TO_DECLARED_RATIO. Off by default:
 * calibration against the engine showed it does not compare the estimator to the declared income
 * (its own minimum is 60000), so this would only discard valid customers.
 */
export function declaredIncomeFloor(requirements: ReturnType<typeof runtimeRequirementsFor>, env: NodeJS.ProcessEnv = process.env): number {
  const ratio = Number(env.DATA_CEDULAS_INCOME_TO_DECLARED_RATIO ?? 0);
  const amounts = requirements.flatMap(requirement => {
    const label = `${requirement.semanticField ?? ''} ${requirement.valueKey}`.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
    if (!/salario|ingreso/.test(label) || /seleccion|fecha|tipo_de|tipo de|actividad/.test(label) || typeof requirement.value !== 'string') return [];
    const amount = Number(requirement.value.replace(/[^\d.]/g,''));
    return Number.isFinite(amount) && amount > 0 ? [amount] : [];
  });
  return amounts.length && Number.isFinite(ratio) && ratio > 0 ? Math.floor(Math.max(...amounts) * ratio) : 0;
}

/** Ids from DATA_CEDULAS_FORCED_IDS (comma separated, digits only), used before any generated one. */
export function forcedIdentifications(env:NodeJS.ProcessEnv=process.env): string[] {
  return (env.DATA_CEDULAS_FORCED_IDS ?? '').split(',').map(id=>id.replace(/\D/g,'')).filter(Boolean);
}

export async function freshRecordingCedulas(appSlug:string, scenario:RecordedScenario, needsSpec:boolean,
  deps = {config:loadPromotedAppConfigSync,generate:findNextDataCedulasCustomers,issued:issuedByProject}) {
  const service=deps.config({appSlug})?.dataServices?.dataCedulas;
  const requirements=runtimeRequirementsFor(scenario);
  const keys=identificationKeysFromRequirements(requirements);
  const values:Record<string,string>={};const specValues:Record<string,string>={};
  if (!service?.enabled) {
    console.log(`[recording-rerun-data] appSlug=${appSlug} enabled=false`);
    return {values,specValues};
  }
  if (!keys.length) {
    console.log(`[recording-rerun-data] appSlug=${appSlug} enabled=true identificationFields=0`);
    return {values,specValues};
  }
  const historyKey=`${appSlug}:${service.database}`;
  // With reuse on, ids issued before (or recorded in the scenario) stay eligible: the generator
  // frees them by cancelling their active Portal cases. Only ids of this call are kept distinct.
  const excluded=dataCedulasReuseEnabled() ? [] : [...(deps.issued.get(historyKey) ?? []),...Object.values(scenario.runtimeDataset?.resolvedValues ?? {}),...requirements.map(requirement=>requirement.value).filter((value):value is string=>typeof value==='string')];
  const pinnedPool=forcedIdentifications();
  for(const key of keys) {
    const count=needsSpec?2:1;
    // Operator-pinned ids (known to pass the credit engine) are used first and trusted as-is.
    const pinned=pinnedPool.splice(0,count);
    const needed=count-pinned.length;
    const minIncomeEstimator=declaredIncomeFloor(requirements);
    const portalLogin=portalLoginFromRequirements(requirements,(deps.config({appSlug}) as any)?.baseUrl);
    // A pinned id skips the generator's own release step, so free it here: an open Portal case would block "Depurar".
    const releasePinned=pinned.length&&portalLogin?createSessionCedulaReleaser(portalLogin):undefined;
    if(releasePinned) for(const id of pinned) {
      const outcome=await releasePinned(id);
      console.log(`[recording-rerun-data] pinnedRelease=${outcome}`);
      if(outcome==='blocked') throw new Error('No se pudo liberar la cédula fijada: tiene solicitudes abiertas que no se pueden cancelar');
    }
    const result=needed>0 ? await deps.generate(validateDataCedulasDatabase(service.database),needed,excluded,{minIncomeEstimator,...(portalLogin?{portalLogin}:{})}) : null;
    if(minIncomeEstimator) console.log(`[recording-rerun-data] declaredIncomeFloor=${minIncomeEstimator}`);
    if(pinned.length) console.log(`[recording-rerun-data] pinnedIdentifications=${pinned.length}`);
    const generated=result?.customers.map(customer=>customer.Cedula) ?? [];
    const ids=[...pinned,...generated];
    if(generated.length<needed || new Set(ids).size!==ids.length || generated.some(id=>excluded.includes(id))) throw new Error('No se pudieron obtener identificaciones frescas para la grabación');
    values[key]=ids[0];if(needsSpec) specValues[key]=ids[1];
    excluded.push(...ids);
    deps.issued.set(historyKey,[...(deps.issued.get(historyKey) ?? []),...ids].slice(-1024));
  }
  console.log(`[recording-rerun-data] appSlug=${appSlug} enabled=true identificationFields=${keys.length} discoveryValues=${Object.keys(values).length} specValues=${Object.keys(specValues).length}`);
  return {values,specValues};
}
