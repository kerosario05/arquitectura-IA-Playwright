import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { request } from 'playwright';
import { buildPortalLexisPayload, type LexisResult } from './data-cedulas-portal-lexis';

const escape = (v: string) => v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const parser = () => new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false});
const read = (xml: string) => {
  if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('invalid_xml');
  return parser().parse(xml);
};

/** Recovered from MDWBaseService and the Lexis DTO/enums in BSC.DLL. */
export function buildMdwLexisEnvelope(customer: Record<string, unknown>, clientId: string, date = new Date()): string | null {
  const p = buildPortalLexisPayload(customer);
  if (!p || !clientId) return null;
  const day = date.toLocaleDateString('en-CA',{timeZone:'America/Santo_Domingo'}).replaceAll('-','');
  const headers = {MsgType:'0',TranType:'1',RealDate:day,BussDate:day,Company:'1',Canal:'BPM',TrnCode:'5000',SerialTrn:day};
  const data = {ClientID:clientId,ClientReference:p.clientReference,FirstName:p.firstName,LastName:p.lastName,Title:'',IdentificationType:'Cedula',Genero:p.genero!,TipoCliente:'Persona Fisica',Pais:p.pais};
  const fields = (values: Record<string,string>, tag:string) => Object.entries(values).map(([k,v])=>`<${tag} ${tag==='DField'?'Type="P" ':''}name="${k}" Value="${escape(v)}" />`).join('');
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/"><soapenv:Header/><soapenv:Body><tem:Execute><tem:xmlin><![CDATA[<ExtremeMsg><Header>${fields(headers,'HField')}</Header><Data>${fields(data,'DField')}</Data></ExtremeMsg>]]></tem:xmlin></tem:Execute></soapenv:Body></soapenv:Envelope>`;
}

export function classifyMdwLexisResponse(xml: string, identification: string): LexisResult {
  try {
    const soap = read(xml);
    const reply = read(soap.Envelope.Body.ExecuteResponse.ExecuteResult).ExtremeMsgReply;
    const rawFields = reply.Data.DField;
    const fields = Array.isArray(rawFields) ? rawFields : [rawFields];
    const values = (name: string) => fields.filter((f:any)=>f?.name===name);
    if (values('RetCode').length!==1 || values('RetCode')[0].Value!=='0' || values('Respuesta').length!==1) return 'unavailable';
    const result = read(values('Respuesta')[0].Value).Respuesta?.SearchResults;
    if (!result || result.ClientReference!==identification) return 'unavailable';
    // Observed MDW no-hit reply omits Records. The DLL maps it to null.
    // Require the successful engine envelope before accepting that omission.
    if (!Object.hasOwn(result,'Records')) return result.BlockID && result.SearchEngineVersion ? 'clear' : 'unavailable';
    if (result.Records === '') return 'clear';
    if (result.Records?.ResultRecord) return 'match';
    return 'unavailable';
  } catch { return 'unavailable'; }
}

export async function screenMdwLexis(customer: Record<string, unknown>, database: string): Promise<LexisResult> {
  if (process.env.DATA_CEDULAS_LEXIS_MDW_DATABASE?.toUpperCase()!==database.toUpperCase()) return 'unavailable';
  const endpoint = process.env.DATA_CEDULAS_LEXIS_MDW_URL;
  const envelope = buildMdwLexisEnvelope(customer,process.env.DATA_CEDULAS_LEXIS_MDW_CLIENT_ID||'');
  if (!endpoint || !envelope) return 'unavailable';
  const configured = Number(process.env.DATA_CEDULAS_LEXIS_TIMEOUT_MS || 10000);
  const client = await request.newContext({timeout:Number.isFinite(configured)&&configured>0?configured:10000});
  try {
    const r = await client.post(endpoint,{data:envelope,headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:'http://tempuri.org/MDS/Execute'},maxRedirects:0});
    return r.status()===200 ? classifyMdwLexisResponse(await r.text(),String(customer.Cedula).replace(/\D/g,'')) : 'unavailable';
  } catch {return 'unavailable';} finally {await client.dispose();}
}
