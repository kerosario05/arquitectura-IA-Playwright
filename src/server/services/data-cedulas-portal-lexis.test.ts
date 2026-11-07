import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {buildPortalLexisPayload, classifyPortalLexisResponse, screenPortalLexis} from './data-cedulas-portal-lexis';

const customer = { Cedula:'00000000000', PrimerNombre:'TEST', SegundoNombre:'QA', PrimerApellido:'SYNTHETIC', SegundoApellido:'EXAMPLE', Sexo:'MASCULINO', Nacionalidad:'DOMINICANA' };
const body = (records: unknown[]) => ({retCode:'0', searchResults:{clientReference:customer.Cedula,records}});

test('portal Lexis uses structured results, never the echoed identification or retCode alone', () => {
  assert.equal(classifyPortalLexisResponse(body([{record:'1'}]),customer.Cedula),'match');
  assert.equal(classifyPortalLexisResponse(body([]),customer.Cedula),'clear');
  for(const response of [{retCode:'0'}, {retCode:'1',searchResults:body([]).searchResults}, {...body([]),searchResults:{records:[]}}, {match:false}, '<html>login</html>']) {
    assert.equal(classifyPortalLexisResponse(response,customer.Cedula),'unavailable');
  }
});

test('portal payload separates names and uses the observed person type and gender', () => {
  assert.deepEqual(buildPortalLexisPayload(customer), {clientReference:'00000000000', firstName:'TEST QA',lastName:'SYNTHETIC EXAMPLE',genero:'Masculino',pais:'Republica Dominicana',title:'Unset',identificationType:'Cedula',tipoCliente:'PersonaFisica'});
  assert.equal(buildPortalLexisPayload({...customer,Sexo:''}),null);
});

test('real HTTP transport posts portal payload, rejects auth/redirects/errors and checks database binding', async () => {
  const before={...process.env}; let status=200; let response: unknown=body([]); let received:unknown;let calls=0;let delay=0;
  const server=http.createServer((req,res)=>{calls++;let data='';req.on('data',c=>data+=c);req.on('end',()=>{received=JSON.parse(data);setTimeout(()=>{res.writeHead(status,{'Content-Type':'application/json',Location:'/login'});res.end(JSON.stringify(response));},delay);});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as {port:number};
  process.env.DATA_CEDULAS_LEXIS_PORTAL_URL=`http://127.0.0.1:${address.port}/api/proxy/api/Procesos/MDW/LexisNexis`;
  process.env.DATA_CEDULAS_LEXIS_PORTAL_DATABASE='QA1';
  try {
    assert.equal(await screenPortalLexis(customer,'QA1'),'clear');
    assert.deepEqual(received,buildPortalLexisPayload(customer));
    response=body([{record:'1'}]);assert.equal(await screenPortalLexis(customer,'QA1'),'match');
    for(const code of [401,302,500]) {status=code;assert.equal(await screenPortalLexis(customer,'QA1'),'unavailable');}
    const count=calls;assert.equal(await screenPortalLexis(customer,'QA2'),'unavailable');assert.equal(calls,count);
    status=200;response={retCode:'0'};
    assert.equal(await screenPortalLexis(customer,'QA1'),'unavailable');
    response=body([]);delay=150;process.env.DATA_CEDULAS_LEXIS_TIMEOUT_MS='25';
    assert.equal(await screenPortalLexis(customer,'QA1'),'unavailable');
  } finally {
    for(const key of ['DATA_CEDULAS_LEXIS_PORTAL_URL','DATA_CEDULAS_LEXIS_PORTAL_DATABASE','DATA_CEDULAS_LEXIS_TIMEOUT_MS']) {if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
