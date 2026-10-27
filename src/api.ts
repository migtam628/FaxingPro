export type Health = { ok:boolean; service:string; transport:string; faxEnabled:boolean };
export type ServerFax = {id:string;direction:'inbound'|'outbound';status:string;from:string;to:string;
  title:string;filename?:string;pages:number;createdAt:string;failureReason?:string;hasDocument:boolean};
export type FaxStats = {received:number;sent:number;pending:number;failed:number};
export type OperatorSession = {authenticated:boolean;expiresAt:string|null};
export type BackupStatus = {configured:boolean;message:string;runs:{name:string;completed_at:string}[]};
export function getBackupStatus(endpoint:string):Promise<BackupStatus>{
  return apiCall<BackupStatus>(endpoint,'','/api/backup/status');
}
export type SetupState = {
  complete:boolean; workspaceName:string; timezone:string; provider:string;
  fromNumber:string|null; publicBaseUrl:string|null; webhookUrl:string|null;
  outboundEnabled:boolean;
  configured:{apiKey:boolean;faxApplication:boolean;phoneNumber:boolean;webhookPublicKey:boolean;httpsUrl:boolean};
};
export function getSetup(endpoint:string):Promise<SetupState>{
  return apiCall<SetupState>(endpoint,'','/api/setup');
}
export function completeSetup(endpoint:string,workspaceName:string,timezone:string):Promise<SetupState>{
  return apiCall<SetupState>(endpoint,'','/api/setup',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({workspaceName,timezone})
  });
}

const withSlash=(endpoint:string)=>endpoint.trim().replace(/\/$/,'');
const headersFor=(token:string,extra?:HeadersInit):Headers=>{
  const h=new Headers(extra);
  if(token)h.set('Authorization','Bearer '+token);
  return h;
};
const apiCall=async <T>(endpoint:string,token:string,path:string,options:RequestInit={}):Promise<T>=>{
  const r=await fetch(withSlash(endpoint)+path,{...options,credentials:'same-origin',
    headers:headersFor(token,options.headers),signal:AbortSignal.timeout(20000)});
  let j:{error?:string}|null=null;try{j=await r.json();}catch{}
  if(!r.ok)throw Error(j?.error||'API returned HTTP '+r.status);
  return j as T;
};
export async function checkApi(endpoint:string):Promise<Health>{
  const r=await fetch(withSlash(endpoint)+'/healthz',{credentials:'same-origin',signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw Error('Server returned HTTP '+r.status);
  return r.json() as Promise<Health>;
}
export function getSession(endpoint:string):Promise<OperatorSession>{
  return apiCall<OperatorSession>(endpoint,'','/api/session');
}
export function createSession(endpoint:string,token:string):Promise<OperatorSession>{
  return apiCall<OperatorSession>(endpoint,'','/api/session',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})
  });
}
export function destroySession(endpoint:string):Promise<OperatorSession>{
  return apiCall<OperatorSession>(endpoint,'','/api/session',{method:'DELETE'});
}
export async function listFaxes(endpoint:string,token=''):Promise<ServerFax[]>{
  const result=await apiCall<{items:ServerFax[]}>(endpoint,token,'/api/faxes');
  return result.items;
}
export async function getStats(endpoint:string,token=''):Promise<FaxStats>{
  return apiCall<FaxStats>(endpoint,token,'/api/stats');
}
export async function submitFax(endpoint:string,token:string,payload:{
  recipient:string;title:string;filename:string;contentBase64:string;requestId?:string;
}):Promise<{id:string;status:string}>{
  return apiCall<{id:string;status:string}>(endpoint,token,'/api/faxes',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
  });
}
export async function downloadFax(endpoint:string,token:string,id:string):Promise<Blob>{
  const r=await fetch(withSlash(endpoint)+'/api/faxes/'+encodeURIComponent(id)+'/document',{
    headers:headersFor(token),credentials:'same-origin',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Document unavailable (HTTP '+r.status+')');
  return r.blob();
}
