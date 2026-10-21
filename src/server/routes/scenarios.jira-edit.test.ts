import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {scenariosRouter} from './scenarios';
import {JiraClient} from '../../clients/jira.client';

test('Jira edit route rejects bad requests and reviews unsupported edits without publication or execution',async()=>{
 const original=JiraClient.prototype.getIssue;
 let reads=0;
 JiraClient.prototype.getIssue=async()=>{reads++;return {id:'7',key:'HU-7',fields:{summary:'Consulta',description:'AC1 — Consulta\nMostrar Resultado.'}} as any;};
 const app=express();app.use(express.json());app.use('/api/scenarios',scenariosRouter);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address() as {port:number};
 const send=(body:unknown)=>fetch(`http://127.0.0.1:${address.port}/api/scenarios/jira/review-edit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await send({})).status,400);assert.equal(reads,0);
  const scenario={scenarioId:'HU-7:jira:1',sourceIssueKey:'HU-7',title:'Consulta',steps:['Abrir la aplicación configurada del proyecto','Validar que se muestre "Resultado"'],expectedResult:'Resultado',acceptanceCriteriaRefs:['AC1.1']};
  const response=await send({issueKey:'HU-7',appSlug:'default',scenarios:[scenario],scenarioId:scenario.scenarioId,patch:{title:scenario.title,steps:['Hacer todo automáticamente'],expectedResult:scenario.expectedResult}});
  assert.equal(response.status,200);
  const body=await response.json() as any;
  assert.equal(body.ok,true);assert.equal(body.scenarios[0].validation.valid,false);
  assert.match(body.scenarios[0].scenarioId,/:edited-/);
  assert.equal(reads,1);
 }finally{JiraClient.prototype.getIssue=original;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
