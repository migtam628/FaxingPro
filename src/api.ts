export type Health = { ok:boolean; service:string; transport:string; faxEnabled:boolean };
export type ServerFax = {id:string;direction:'inbound'|'outbound';status:string;from:string;to:string;
  title:string;filename?:string;pages:number;createdAt:string;failureReason?:string;hasDocument:boolean;
  readAt:string|null;archivedAt:string|null};
export type FaxStats = {received:number;sent:number;pending:number;failed:number};
export type FaxNotification = {id:string;faxId:string;kind:'incoming'|'failed';title:string;description:string;number:string;createdAt:string};
export type FaxNotificationFeed = {items:FaxNotification[];total:number};
export function getNotifications(endpoint:string):Promise<FaxNotificationFeed>{
  return apiCall<FaxNotificationFeed>(endpoint,'','/api/notifications');
}
export function getNotificationPreferences(endpoint:string):Promise<{browserEnabled:boolean}>{
  return apiCall<{browserEnabled:boolean}>(endpoint,'','/api/notifications/preferences');
}
export function setNotificationPreferences(endpoint:string,browserEnabled:boolean):Promise<{browserEnabled:boolean}>{
  return apiCall<{browserEnabled:boolean}>(endpoint,'','/api/notifications/preferences',
    {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({browserEnabled})});
}

export type DailyActivity = {day:string;received:number;sent:number;failed:number};
export async function getDailyActivity(endpoint:string):Promise<DailyActivity[]>{
  return (await apiCall<{days:DailyActivity[]}>(endpoint,'','/api/reports/daily')).days;
}
export type FaxEvent = {type:string;occurredAt:string};
export async function getFaxEvents(endpoint:string,id:string):Promise<FaxEvent[]>{
  return (await apiCall<{events:FaxEvent[]}>(endpoint,'','/api/faxes/'+encodeURIComponent(id)+'/events')).events;
}

export type ReconciliationEvent = {type:string;occurredAt:string;receivedAt:string};
export type ReconciliationItem = {
  id:string;telnyxId:string|null;clientKey:string|null;status:string;title:string;
  from:string;to:string;createdAt:string;updatedAt:string;lastEventAt:string|null;
  failureReason:string|null;reviewReason:string;events:ReconciliationEvent[];
};
export type ReconciliationFeed = {
  readOnly:true;staleAfterMinutes:number;limit:number;notice:string;items:ReconciliationItem[];
};
export function getReconciliation(endpoint:string):Promise<ReconciliationFeed>{
  return apiCall<ReconciliationFeed>(endpoint,'','/api/reconciliation');
}

export type FaxContact = {id:string;name:string;number:string;email:string;company:string;notes:string;createdAt:string;updatedAt:string};
export type ContactInput = Pick<FaxContact,'name'|'number'|'email'|'company'|'notes'>;
export async function getContacts(endpoint:string,query=''):Promise<FaxContact[]>{
  const path='/api/contacts'+(query?'?q='+encodeURIComponent(query):'');
  return (await apiCall<{items:FaxContact[]}>(endpoint,'',path)).items;
}
export function createContact(endpoint:string,input:ContactInput):Promise<FaxContact>{
  return apiCall<FaxContact>(endpoint,'','/api/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
}
export function updateContact(endpoint:string,id:string,input:ContactInput):Promise<FaxContact>{
  return apiCall<FaxContact>(endpoint,'','/api/contacts/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
}
export function deleteContact(endpoint:string,id:string):Promise<{deleted:boolean}>{
  return apiCall<{deleted:boolean}>(endpoint,'','/api/contacts/'+encodeURIComponent(id),{method:'DELETE'});
}
export type FaxUpdate = Pick<ServerFax,'id'|'readAt'|'archivedAt'>;
export function setFaxFlag(endpoint:string,id:string,field:'read'|'archive',enabled:boolean):Promise<ServerFax>{
  return apiCall<ServerFax>(endpoint,'','/api/faxes/'+encodeURIComponent(id)+'/'+field,{
    method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})
  });
}

export type OperatorSession = {authenticated:boolean;expiresAt:string|null};
// Integration credentials are generated once and NEVER persisted by the browser.
export type IntegrationScope = 'faxes:read'|'contacts:read'|'reports:read';
export type IntegrationToken = {
  id:string;name:string;prefix:string;scopes:IntegrationScope[];
  createdAt:string;expiresAt:string;lastUsedAt:string|null;revokedAt:string|null;
};
export type NewIntegrationToken = IntegrationToken&{token:string};
export function listIntegrationTokens(endpoint:string):Promise<{items:IntegrationToken[]}>{
  return apiCall<{items:IntegrationToken[]}>(endpoint,'','/api/tokens');
}
export function createIntegrationToken(endpoint:string,fields:{
  name:string;scopes:IntegrationScope[];expiresInDays:7|30|90;
}):Promise<NewIntegrationToken>{
  return apiCall<NewIntegrationToken>(endpoint,'','/api/tokens',{
    method:'POST',headers:{'Content-Type':'application/json','X-FaxingPro-Action':'token-manager'},
    body:JSON.stringify(fields)
  });
}
export function revokeIntegrationToken(endpoint:string,id:string):Promise<{revoked:boolean}>{
  return apiCall<{revoked:boolean}>(endpoint,'','/api/tokens/'+encodeURIComponent(id),{
    method:'DELETE',headers:{'X-FaxingPro-Action':'token-manager'}
  });
}

export type SecurityStatus = {
  activeSessions:number;failedLogins24h:number;
  events:{type:string;createdAt:string}[];
  mode:'single-operator';mfaEnabled:false;
};
export function getSecurityStatus(endpoint:string):Promise<SecurityStatus>{
  return apiCall<SecurityStatus>(endpoint,'','/api/security');
}
export function revokeAllSessions(endpoint:string):Promise<{revoked:number}>{
  return apiCall<{revoked:number}>(endpoint,'','/api/sessions',{method:'DELETE'});
}
export type BackupStatus = {
  configured:boolean;message:string;runs:{name:string;completed_at:string;drive_verified_at:string|null}[];
  lastSuccessfulAt:string|null;ageHours:number|null;freshness:'recent'|'stale'|'missing';
  scheduleVerified:boolean;offsiteVerified:boolean;
  offsiteProvider:'Google Drive';offsiteFreshness:'current'|'pending'|'missing';
};
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
export async function listFaxes(endpoint:string,token='',options:{folder?:'active'|'archived'|'all';query?:string;offset?:number;limit?:number}={}):Promise<ServerFax[]>{
  const params=new URLSearchParams();
  if(options.folder)params.set('folder',options.folder);
  if(options.query)params.set('q',options.query);
  if(options.offset)params.set('offset',String(options.offset));
  params.set('limit',String(options.limit||250));
  const result=await apiCall<{items:ServerFax[]}>(endpoint,token,'/api/faxes?'+params);
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
