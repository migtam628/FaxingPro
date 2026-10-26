export type Health = { ok:boolean; service:string; transport:string; faxEnabled:boolean };
export type ServerFax = {id:string;direction:'inbound'|'outbound';status:string;from:string;to:string;
  title:string;filename?:string;pages:number;createdAt:string;failureReason?:string;hasDocument:boolean};
export type FaxStats = {received:number;sent:number;pending:number;failed:number};
const withSlash=(endpoint:string)=>endpoint.trim().replace(/\/$/,'');
const apiCall=async <T>(endpoint:string,token:string,path:string,options:RequestInit={}):Promise<T>=>{
  const r=await fetch(withSlash(endpoint)+path,{...options,headers:{...options.headers,Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(20000)});
  let j:{error?:string}|null=null;try{j=await r.json();}catch{}
  if(!r.ok)throw Error(j?.error||'API returned HTTP '+r.status);
  return j as T;
};
export async function checkApi(endpoint:string):Promise<Health>{
  const r=await fetch(withSlash(endpoint)+'/healthz',{signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw Error('Server returned HTTP '+r.status);
  return r.json() as Promise<Health>;
}
export async function listFaxes(endpoint:string,token:string):Promise<ServerFax[]>{
  const result=await apiCall<{items:ServerFax[]}>(endpoint,token,'/api/faxes');
  return result.items;
}
export async function getStats(endpoint:string,token:string):Promise<FaxStats>{
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
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Document unavailable (HTTP '+r.status+')');
  return r.blob();
}
