import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiProvider } from '../ai/ai-provider.types';
import type { JiraIssueSource } from '../scenarios/scenario-types';
import { alignRepairedNegativeExpectedResult, auditGeneratedJiraSyntax, generateJiraScenarios,
  linkConditionalAbsenceCoverage, uncoveredAcceptanceClauses } from './jira-scenario-generator';
import { mapJiraScenariosToTestDesign, testDesignReviewWarning } from '../test-design/test-design-generator';

function fixture(operation: string, field: string, outcome: string) {
 const source = {key:'QA-1',summary:'Rechazo controlado',description:`AC1 — Errores\nSi el ${field} no es válido, se informa el problema. Si la ${operation} no se completa, tampoco debe mostrarse un ${outcome}.`,acceptanceCriteria:null} as JiraIssueSource;
 const draft = {sourceIssueKey:source.key,title:`Rechazo de ${operation}`,acceptanceCriteriaRefs:['AC1.1'],preconditions:[],
  steps:['Abrir la aplicación configurada del proyecto',`Ingresar un valor inválido en "${field}"`,
   `Presionar "Autorizar ${operation}"`,`Validar que el campo "${field}" muestre un error de validación`,
   `Validar que no se muestre "${outcome}"`],expectedResult:`No se muestra "${outcome}"`};
 return {source,draft};
}

test('related conditional absence reuses only a source-backed rejection in two project vocabularies', async()=>{
 for(const [operation,field,outcome] of [['transferencia','Token','comprobante exitoso'],['solicitud','Código de aprobación','acuse definitivo']]){
  const {source,draft}=fixture(operation,field,outcome);
  assert.deepEqual(await auditGeneratedJiraSyntax([draft],[source]),[]);
  linkConditionalAbsenceCoverage([source],[draft]);
  assert.deepEqual(draft.acceptanceCriteriaRefs,['AC1.1','AC1.2']);
  assert.deepEqual(uncoveredAcceptanceClauses(source,[draft]),[]);
  let calls=0;
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){calls++;return {parsedJson:{scenarios:[{...draft,acceptanceCriteriaRefs:['AC1.1']}]},rawText:'',model:'fixture',providerName:'fixture',durationMs:0};}};
  const result=await generateJiraScenarios([source],`fixture-${operation}`,provider);
  assert.equal(calls,1);
  assert.deepEqual(result.scenarios[0].validation.errors,[]);
  const design=mapJiraScenariosToTestDesign(result.scenarios);
  assert.equal(testDesignReviewWarning(design),null);
  assert.deepEqual(design[0].steps.map(step=>step.action),result.scenarios[0].steps);
 }
});

test('absence coverage cannot be claimed by another operation, outcome, valid data or missing field rejection',()=>{
 const {source,draft}=fixture('solicitud','Código','acuse definitivo');
 for(const steps of [
  draft.steps.map(step=>step.replace('Autorizar solicitud','Iniciar sesión')),
  draft.steps.map(step=>step.replace('acuse definitivo','otro resultado')),
  draft.steps.map(step=>step.replace('valor inválido','valor válido')),
  draft.steps.filter(step=>!step.includes('error de validación')),
 ]){
  const candidate={...draft,steps,acceptanceCriteriaRefs:['AC1.1']};
  linkConditionalAbsenceCoverage([source],[candidate]);
  assert.deepEqual(candidate.acceptanceCriteriaRefs,['AC1.1']);
 }
});

test('negative expected prose with a temporal qualifier binds to the same authored absence without extra oracle',async()=>{
 const {source,draft}=fixture('solicitud','Código','resumen de productos');
 const prose={...draft,expectedResult:'No se muestra el resumen de productos después del intento de autorización con código inválido.'};
 const expectedResult=alignRepairedNegativeExpectedResult(prose,source);
 assert.notEqual(expectedResult,prose.expectedResult);
 assert.deepEqual(await auditGeneratedJiraSyntax([{...prose,expectedResult}],[source]),[]);
 assert.equal(alignRepairedNegativeExpectedResult({...prose,expectedResult:'No se muestra el saldo disponible después del intento.'},source),'No se muestra el saldo disponible después del intento.');
});
