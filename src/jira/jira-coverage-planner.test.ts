import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiProvider } from '../ai/ai-provider.types';
import type { JiraIssueSource } from '../scenarios/scenario-types';
import { jiraStoryCoverageWork, planJiraCoverageWork, jiraCoverageRefMatches } from './jira-coverage-planner';
import { generateJiraScenarios } from './jira-scenario-generator';
import { mapJiraScenariosToTestDesign } from '../test-design/test-design-generator';

function story(key:string, domain:string, count=12):JiraIssueSource {
  return {key,summary:domain,description:'',acceptanceCriteria:Array.from({length:count},(_,i)=>`AC${i+1} — Consulta ${i+1}\nSe muestra "${domain} ${i+1}".`).join('\n'),
    labels:[],components:[],status:'Open',issueType:'Story'};
}
function draft(source:JiraIssueSource, clauses:Array<{id:string;text:string}>, broken=false) {
  const targets=clauses.map(clause=>clause.text.match(/"([^"]+)"/)![1]);
  return {sourceIssueKey:source.key,title:targets.join(' / '),preconditions:[],acceptanceCriteriaRefs:clauses.map(c=>c.id),
    steps:['Abrir la aplicación configurada del proyecto',broken?'Resolver mágicamente el expediente':'Presionar "Consultas"',...targets.map(target=>`Validar que se muestre "${target}"`)],
    expectedResult:`Se muestra "${targets.at(-1)}".`};
}
const reply=(scenarios:unknown[])=>({rawText:'',parsedJson:{scenarios},model:'fixture',providerName:'fixture',durationMs:0});

test('concurrent generation preserves coverage and order and coalesces identical active requests',async()=>{
  const source=story('PERF-12','Consulta concurrente');
  const releases:Array<()=>void>=[];
  let calls=0;
  let signalStarted!:()=>void;
  const started=new Promise<void>(resolve=>{signalStarted=resolve;});
  const provider:AiProvider={providerType:'fake',providerName:'concurrency-fixture',model:'fixture',async completeJson(request){
    const payload=JSON.parse(request.messages.find(message=>message.role==='user')!.content);
    const clauses=payload.generationScope.requiredClauses;
    assert.equal(payload.issues[0].acceptanceCriteria,source.acceptanceCriteria,'full source remains available');
    assert.deepEqual(payload.issues[0].acceptanceClauses.map((clause:{id:string})=>clause.id),clauses.map((clause:{id:string})=>clause.id));
    calls++;
    await new Promise<void>(resolve=>{releases.push(resolve);if(calls===3)signalStarted();});
    return reply([draft(source,clauses)]);
  }};
  const first=generateJiraScenarios([source],'parallel-generation-fixture',provider,{loginMode:'no_login',useCache:true});
  await started;
  const second=generateJiraScenarios([source],'parallel-generation-fixture',provider,{loginMode:'no_login',useCache:true});
  // Finish out of order while retaining source order in the resulting cases.
  for(const release of [...releases].reverse())release();
  const [one,two]=await Promise.all([first,second]);
  assert.equal(calls,3,'repeat callers share active work');
  assert.deepEqual(one,two);
  assert.equal(one.coverage?.[0].covered,12);
  assert.deepEqual(one.scenarios.map(scenario=>scenario.acceptanceCriteriaRefs?.[0]),['AC1.1','AC5.1','AC9.1']);
  one.scenarios[0].title='changed by one consumer';
  assert.notEqual(one.scenarios[0].title,two.scenarios[0].title);
});

test('coverage work preserves every source clause and issue ownership without choosing a case count',()=>{
  const sources=[story('INS-12','Póliza'),story('INV-8','Inventario',3)];
  const work=jiraStoryCoverageWork(sources),batches=planJiraCoverageWork(work);
  assert.ok(batches.every(batch=>batch.clauses.length<=4));
  for(const source of sources) assert.deepEqual(batches.filter(batch=>batch.issue.key===source.key).flatMap(batch=>batch.clauses),work.find(w=>w.issue.key===source.key)!.clauses);
});

test('coverage repair overlaps independent obligations and counts only validated merged results',async()=>{
  const source=story('WAVE-12','Estado observado');
  const releases:Array<()=>void>=[];
  let repairCalls=0;
  let ready!:()=>void;
  const started=new Promise<void>(resolve=>{ready=resolve;});
  const provider:AiProvider={providerType:'fake',providerName:'wave-fixture',model:'fixture',async completeJson(request){
    const payload=JSON.parse(request.messages.find(message=>message.role==='user')!.content);
    if(payload.generationScope)return reply([draft(source,payload.generationScope.requiredClauses.slice(0,1))]);
    const clauses=payload.issues?.[0]?.missingClauses;
    assert.ok(clauses,'only missing coverage needs provider repair');
    repairCalls++;
    await new Promise<void>(resolve=>{releases.push(resolve);if(repairCalls===3)ready();});
    return reply([draft(source,clauses)]);
  }};
  const pending=generateJiraScenarios([source],'parallel-coverage-fixture',provider,{loginMode:'no_login'});
  await started;
  for(const release of [...releases].reverse())release();
  const result=await pending;
  assert.equal(repairCalls,3);
  assert.equal(result.coverage?.[0].covered,12);
  assert.equal(result.coverage?.[0].status,'complete');
  assert.ok(result.scenarios.every(scenario=>scenario.validation.valid));
});

test('coverage planning also reads numbered, bulleted and plain acceptance criteria without AC headings',()=>{
  for(const acceptanceCriteria of ['1. Se muestra Saldo.\n2. Se muestra Comprobante.','- Se muestra Saldo.\n- Se muestra Comprobante.','Se muestra Saldo. Se muestra Comprobante.']){
    const work=jiraStoryCoverageWork([{...story('FORMAT-1','Formato',1),acceptanceCriteria}]);
    assert.equal(work[0].clauses.length,2);
    assert.match(work[0].clauses[0].text,/Saldo/);
    assert.match(work[0].clauses[1].text,/Comprobante/);
  }
});

test('a generated alternative is accepted for its exact source clause without claiming sibling criteria',()=>{
  assert.equal(jiraCoverageRefMatches('AC4.1.2','AC4.1'),true);
  assert.equal(jiraCoverageRefMatches('AC4.1','AC4.1'),true);
  assert.equal(jiraCoverageRefMatches('AC4','AC4.1'),false);
  assert.equal(jiraCoverageRefMatches('AC4.10','AC4.1'),false);
  assert.equal(jiraCoverageRefMatches('AC4.2.1','AC4.1'),false);
});

test('coverage repair retains distinct executable alternatives returned with branch references',async()=>{
  const source={...story('ROLE-1','Roles',1),acceptanceCriteria:'AC1 — Roles\nPermite elegir Operador o Administrador'};
  const role=(name:string,ref:string)=>({sourceIssueKey:source.key,title:`Elegir ${name}`,preconditions:[],steps:[
    'Abrir la aplicación configurada del proyecto',`Presionar "${name}"`,`Validar que se muestre "${name}"`],expectedResult:`Se muestra "${name}".`,acceptanceCriteriaRefs:[ref]});
  let calls=0;
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){
    return reply(++calls===1?[role('Operador','AC1.1.1')]:[role('Administrador','AC1.1.2')]);
  }};
  const result=await generateJiraScenarios([source],'roles-fixture',provider,{loginMode:'no_login'});
  assert.equal(result.scenarios.length,2);
  assert.equal(result.coverage?.[0].status,'complete');
  assert.ok(result.scenarios.every(s=>s.validation.valid));
});

test('complex stories generate coverage in bounded batches across unrelated profiles and allow compatible checks in one case',async()=>{
  for(const [key,domain,profile] of [['INS-12','Póliza','insurance-fixture'],['INV-12','Inventario','inventory-fixture']]){
    const source=story(key,domain);let calls=0;
    const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(request){
      calls++;const payload=JSON.parse(request.messages.find(m=>m.role==='user')!.content);
      assert.ok(payload.generationScope,'generation should be planned before a massive repair is needed');
      const clauses=payload.generationScope.requiredClauses;
      assert.ok(clauses.length<=4);
      assert.match(request.messages[0].content,/roles, data alternatives, rejection paths and state transitions/);
      return reply([draft(source,clauses)]);
    }};
    const result=await generateJiraScenarios([source],profile,provider,{loginMode:'no_login'});
    assert.equal(calls,3);assert.equal(result.scenarios.length,3);
    assert.equal(result.coverage?.[0].covered,12);
    assert.equal(result.coverage?.[0].status,'complete');
    assert.ok(result.scenarios.every(s=>s.validation.valid));
  }
});

test('failed initial batch gets a bounded retry and later obligations keep editable drafts',async()=>{
  const source=story('OPS-12','Expediente');let generated=0;const attempted:string[]=[];
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(request){
    const payload=JSON.parse(request.messages.find(m=>m.role==='user')!.content);
    if(payload.generationScope){
      generated++;
      if(generated===2)throw new Error('fixture batch unavailable');
      return reply([draft(source,payload.generationScope.requiredClauses.slice(0,1))]);
    }
    if(payload.issues?.[0]?.missingClauses){
      const clauses=payload.issues[0].missingClauses;
      assert.ok(clauses.length<=4);attempted.push(...clauses.map((c:{id:string})=>c.id));
      return reply([draft(source,clauses,attempted.length<=4)]);
    }
    // A failed technical repair leaves the original available for authoring.
    return reply(payload.scenarios??[]);
  }};
  const result=await generateJiraScenarios([source],'operations-fixture',provider,{loginMode:'no_login'});
  assert.ok(attempted.includes('AC12.1'),'later obligations must still receive a generation attempt');
  assert.equal(new Set(attempted).size,10);
  assert.ok(result.scenarios.length>2);
  assert.ok(result.scenarios.some(s=>!s.validation.valid));
  assert.ok(result.scenarios.some(s=>s.validation.valid));
  assert.ok(result.scenarios.every(s=>!s.validation.errors.some(error=>error.startsWith('JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:'))));
  assert.equal(result.coverage?.[0].status,'complete');
  const mapped=mapJiraScenariosToTestDesign(result.scenarios);
  assert.equal(mapped.length,result.scenarios.length);
  const blockedIndex=result.scenarios.findIndex(s=>!s.validation.valid);
  assert.equal(mapped[blockedIndex].selectedForTestRail,false);
  assert.ok(mapped[blockedIndex].generationWarnings?.length);
  assert.deepEqual(JSON.parse(JSON.stringify(result.coverage)),result.coverage);
});

test('empty repair deltas preserve blocked drafts and never fabricate successful coverage',async()=>{
  const source=story('NOCHANGE-12','Resultado pendiente');
  const repairRequests:unknown[]=[];
  const sharedFallbackRequests:unknown[]=[];
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(request){
    const payload=JSON.parse(request.messages.find(message=>message.role==='user')!.content);
    if(request.jsonSchema?.name==='jira_scenario_repair'){
      repairRequests.push(payload);
      assert.match(request.messages[0].content,/Omit unchanged or unrepairable drafts/);
      return reply([]);
    }
    if(Array.isArray(payload.syntaxFailures)){
      sharedFallbackRequests.push(payload);
      return reply([]);
    }
    const clauses=payload.generationScope?.requiredClauses??payload.issues[0].missingClauses;
    return reply([draft(source,clauses,true)]);
  }};
  const result=await generateJiraScenarios([source],'empty-repair-fixture',provider,{loginMode:'no_login'});
  assert.ok(repairRequests.length);
  assert.ok(sharedFallbackRequests.length,'unresolved scoped drafts receive one shared repair attempt before remaining blocked');
  assert.ok(result.scenarios.length);
  assert.ok(result.scenarios.every(scenario=>!scenario.validation.valid));
  assert.equal(result.coverage?.[0].covered,0);
  assert.equal(result.coverage?.[0].status,'incomplete');
  assert.ok(result.scenarios.every(scenario=>scenario.steps.includes('Resolver mágicamente el expediente')));
});
