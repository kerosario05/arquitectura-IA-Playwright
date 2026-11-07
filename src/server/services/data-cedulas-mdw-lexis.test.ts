import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {buildMdwLexisEnvelope,classifyMdwLexisResponse,screenMdwLexis} from './data-cedulas-mdw-lexis';
const esc=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const id='00000000000';
function response(records:string,code='0',reference=id) {
  const answer=`<Respuesta><SearchResults><ClientReference>${reference}</ClientReference>${records}</SearchResults></Respuesta>`;
  const inner=`<ExtremeMsgReply><Data><DField name="RetCode" Value="${code}"/><DField name="Respuesta" Value="${esc(answer)}"/></Data></ExtremeMsgReply>`;
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><ExecuteResponse><ExecuteResult>${esc(inner)}</ExecuteResult></ExecuteResponse></s:Body></s:Envelope>`;
}
test('MDW reproduces DLL codes, header and SOAP action input with safe XML attributes',()=>{
  const xml=buildMdwLexisEnvelope({Cedula:id,PrimerNombre:'QA & TEST',PrimerApellido:'EXAMPLE',Sexo:'F',Nacionalidad:'DOMINICANA'},'client',new Date('2026-10-31T12:00:00Z'))!;
  for(const part of ['name="TrnCode" Value="5000"','name="Canal" Value="BPM"','name="Title" Value=""','name="TipoCliente" Value="Persona Fisica"','name="FirstName" Value="QA &amp; TEST"','20261031','<![CDATA[<ExtremeMsg>'])assert.ok(xml.includes(part));
});
test('MDW only accepts explicit empty records and rejects failures or mismatched identity',()=>{
  assert.equal(classifyMdwLexisResponse(response('<Records/>'),id),'clear');
  assert.equal(classifyMdwLexisResponse(response('<BlockID>test</BlockID><SearchEngineVersion>5.101</SearchEngineVersion>'),id),'clear');
  assert.equal(classifyMdwLexisResponse(response('<Records><ResultRecord><Record>1</Record></ResultRecord></Records>'),id),'match');
  for(const xml of [response(''),response('<Records/>','96'),response('<Records/>','0','11111111111'),'<html>error</html>',response('<Records><Unknown/></Records>')])assert.equal(classifyMdwLexisResponse(xml,id),'unavailable');
});

test('MDW HTTP transport sends SOAPAction, rejects HTTP errors and never crosses database aliases',async()=>{
  const keys=['DATA_CEDULAS_LEXIS_MDW_DATABASE','DATA_CEDULAS_LEXIS_MDW_URL','DATA_CEDULAS_LEXIS_MDW_CLIENT_ID'];
  const before={...process.env};let status=200;let calls=0;
  const server=http.createServer((req,res)=>{calls++;assert.equal(req.headers.soapaction,'http://tempuri.org/MDS/Execute');let text='';req.on('data',c=>text+=c);req.on('end',()=>{assert.ok(text.includes('name="TrnCode" Value="5000"'));res.writeHead(status,{'Content-Type':'text/xml'});res.end(response('<Records/>'));});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.DATA_CEDULAS_LEXIS_MDW_DATABASE='QA1';process.env.DATA_CEDULAS_LEXIS_MDW_CLIENT_ID='synthetic';
  process.env.DATA_CEDULAS_LEXIS_MDW_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}/ExtremeMediator/Service`;
  const customer={Cedula:id,PrimerNombre:'QA',PrimerApellido:'SYNTHETIC',Sexo:'M',Nacionalidad:'DOMINICANA'};
  try{assert.equal(await screenMdwLexis(customer,'QA1'),'clear');status=500;assert.equal(await screenMdwLexis(customer,'QA1'),'unavailable');const n=calls;assert.equal(await screenMdwLexis(customer,'QA2'),'unavailable');assert.equal(calls,n);}finally{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
