import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeJiraRoute, saveJiraRoute, loadJiraRoutes, invalidateJiraRoute, shouldInvalidateJiraLearnedRoute, type JiraLearnedRoute } from './jira-knowledge-repository';
import { jiraGenerationKnowledge } from './jira-generation-knowledge';
import type { DbConnection } from '../db/db-connection';

const route: JiraLearnedRoute = {schemaVersion:1,engine:'jira_semantic',appSlug:'app-one',id:'route-1',
  profileRevision:'rev1',sourceIssueKey:'HU-1',scenarioId:'S1',jobId:'J1',validatedAt:new Date().toISOString(),
  startsFrom:'project_entry',actions:[{action:'click',field:'Transferencias'}],evidenceRefs:['step-2.png']};

test('Jira updates its route while preserving legacy/Recording knowledge exactly', () => {
  const legacy={id:'recording-route',steps:['existing'],trustedForReuse:true};
  const root={items:[legacy],version:1,jiraRoutes:[route]};
  const updated=mergeJiraRoute(root,{...route,jobId:'J2',actions:[{action:'click',field:'Nueva pantalla'}]});
  assert.deepEqual(updated.items,root.items);
  assert.deepEqual(updated.jiraRoutes,[{...route,jobId:'J2',actions:[{action:'click',field:'Nueva pantalla'}]}]);
  assert.deepEqual(root.jiraRoutes,[route]);
});

test('learning waits for SQL confirmation and inserts a missing knowledge row', async () => {
  const calls: string[]=[];
  let finish!: () => void;
  const gate=new Promise<void>(resolve=>{finish=resolve;});
  const conn={query:async (sql:string)=>{
    calls.push(sql);
    if(sql.includes('FROM dbo.Projects')) return [{id:'P1'}];
    if(sql.startsWith('SELECT')) return [];
    await gate; return [];
  }} as unknown as DbConnection;
  let completed=false;
  const transaction: typeof import('../db/sql-connection').withTransaction = async fn=>fn(conn);
  const appsRoot=fs.mkdtempSync(path.join(os.tmpdir(),'jira-knowledge-'));
  const appDir=path.join(appsRoot,route.appSlug); fs.mkdirSync(appDir,{recursive:true});
  fs.writeFileSync(path.join(appDir,'app.knowledge.json'),JSON.stringify({version:1,appSlug:route.appSlug,items:[{id:'keep-me'}]}));
  const saved=saveJiraRoute(route,transaction,appsRoot).then(()=>{completed=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(completed,false);
  assert.ok(calls.some(sql=>sql.startsWith('INSERT INTO dbo.ProjectKnowledge')));
  finish(); await saved; assert.equal(completed,true);
  const projected=JSON.parse(fs.readFileSync(path.join(appDir,'app.knowledge.json'),'utf8'));
  assert.deepEqual(projected.items,[{id:'keep-me'}]);
  assert.equal(projected.jiraRoutes[0].id,route.id);
  assert.equal(projected.jiraRoutes[0].appSlug,route.appSlug);
  assert.doesNotMatch(JSON.stringify(projected.jiraRoutes),/#synthetic|password|secret-value/i);
  fs.rmSync(appsRoot,{recursive:true,force:true});
  await assert.rejects(saveJiraRoute(route,async()=>{throw new Error('storage unavailable');}),/storage unavailable/);
});

test('a successful HU supplies navigation to another HU only in the same project', async () => {
  const appsRoot=fs.mkdtempSync(path.join(os.tmpdir(),'jira-knowledge-scope-'));
  try {
    for (const appSlug of ['app-one','app-two']) {
      const root=mergeJiraRoute({items:[{engine:'recording_replay',steps:['unrelated']}]},{...route,appSlug});
      const connection: typeof import('../db/sql-connection').withConnection = async fn=>fn({query:async()=>[
        {knowledgeJson:JSON.stringify(root)}]} as unknown as DbConnection);
      const loaded=await loadJiraRoutes(appSlug,connection,appsRoot);
      const issue={key:'HU-2',summary:'Transferencias',description:'Permitir transferencias.',acceptanceCriteria:null,
        labels:[],components:[],status:'Open',issueType:'Story'};
      assert.equal(jiraGenerationKnowledge(appSlug,[issue],loaded,'rev1')[0].routes.length,1);
      assert.deepEqual(await loadJiraRoutes('other-project',connection,appsRoot),[]);
    }
  } finally { fs.rmSync(appsRoot,{recursive:true,force:true}); }
});

test('generation can consume the per-app knowledge projection when SQL has no route', async () => {
  const appsRoot=fs.mkdtempSync(path.join(os.tmpdir(),'jira-knowledge-file-'));
  const appDir=path.join(appsRoot,route.appSlug); fs.mkdirSync(appDir,{recursive:true});
  fs.writeFileSync(path.join(appDir,'app.knowledge.json'),JSON.stringify({version:1,appSlug:route.appSlug,items:[],jiraRoutes:[route]}));
  const connection: typeof import('../db/sql-connection').withConnection = async fn=>fn({query:async()=>[
    {knowledgeJson:JSON.stringify({items:[]})}]} as unknown as DbConnection);
  const loaded=await loadJiraRoutes(route.appSlug,connection,appsRoot);
  const hint=jiraGenerationKnowledge(route.appSlug,[{key:'HU-2',summary:'Transferencias',description:'El cliente consulta transferencias.',
    acceptanceCriteria:null,labels:[],components:[],status:'Open',issueType:'Story'}],loaded,'rev1')[0];
  assert.equal(hint.routes.length,1);
  assert.equal(hint.routes[0].sourceIssueKey,'HU-1');
  fs.rmSync(appsRoot,{recursive:true,force:true});
});

test('a failed Jira scenario invalidates only its own route and a later success replaces it', async () => {
  const root={items:[{id:'legacy',trustedForReuse:true}],jiraRoutes:[route,{...route,id:'route-2',scenarioId:'S2'}]};
  let written: typeof root | undefined;
  const conn={query:async (sql:string,params?:unknown[])=>{
    if(sql.includes('FROM dbo.Projects')) return [{id:'P1'}];
    if(sql.startsWith('SELECT')) return [{knowledgeJson:JSON.stringify(root)}];
    written=JSON.parse(Buffer.isBuffer(params?.[0]) ? params[0].toString('utf16le') : String(params?.[0])); return [];
  }} as unknown as DbConnection;
  await invalidateJiraRoute('app-one','S1',async fn=>fn(conn));
  assert.ok(written);
  assert.deepEqual(written.items,root.items);
  assert.ok((written.jiraRoutes[0] as JiraLearnedRoute).invalidatedAt);
  assert.equal((written.jiraRoutes[1] as JiraLearnedRoute).invalidatedAt,undefined);
  assert.deepEqual(mergeJiraRoute(written,route).jiraRoutes,[root.jiraRoutes[1],route]);
});

test('only concrete action and route failures invalidate previously learned navigation', () => {
  for (const code of ['JIRA_DURABLE_TARGET_UNRESOLVED','JIRA_ACTION_DISPATCH_FAILED','JIRA_FILL_NOT_CONFIRMED','JIRA_SELECTION_NOT_CONFIRMED']) {
    assert.equal(shouldInvalidateJiraLearnedRoute(code),true,code);
  }
  for (const code of ['JIRA_ASSERTION_NOT_SATISFIED','JIRA_REQUIRED_DATA_MISSING','JIRA_CONDITION_ASSERTION_MISSING','JIRA_SPEC_VERIFICATION_NOT_PASSED']) {
    assert.equal(shouldInvalidateJiraLearnedRoute(code),false,code);
  }
});
