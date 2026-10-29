import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {CheckCircle2,Copy,KeyRound,Plus,RefreshCw,ShieldCheck,Trash2,X} from 'lucide-react';
import {createIntegrationToken,listIntegrationTokens,revokeIntegrationToken,
  type IntegrationScope,type IntegrationToken,type NewIntegrationToken} from './api';
import './token-manager.css';

const scopes: {value:IntegrationScope;label:string;details:string}[]=[
  {value:'faxes:read',label:'Fax metadata',details:'List faxes, statuses, summaries and events. No document downloads.'},
  {value:'contacts:read',label:'Contacts',details:'Search and list saved contacts. Cannot modify contacts.'},
  {value:'reports:read',label:'Reports',details:'Read 30-day daily transmission totals.'}
];
const formatDate=(date:string|null)=>date?new Date(date).toLocaleString():'Never';

export default function ApiTokenManager({endpoint}:{endpoint:string}){
  const [items,setItems]=useState<IntegrationToken[]>([]);
  const [name,setName]=useState('');
  const [expiry,setExpiry]=useState<7|30|90>(30);
  const [selected,setSelected]=useState<IntegrationScope[]>(['faxes:read']);
  const [created,setCreated]=useState<NewIntegrationToken|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const load=useCallback(async()=>{
    try{
      const result=await listIntegrationTokens(endpoint);
      setItems(result.items);setError('');
    }catch(e){setError(e instanceof Error?e.message:'Unable to load integration tokens');}
    finally{setLoading(false);}
  },[endpoint]);
  useEffect(()=>{void load();},[load]);
  function toggle(scope:IntegrationScope,checked:boolean){
    setSelected(prev=>checked?[...prev.filter(s=>s!==scope),scope]:prev.filter(s=>s!==scope));
  }
  async function create(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');setNotice('');
    // Never hide an unrecorded secret by creating another before user confirms storage.
    if(created){setBusy(false);setError('Save or dismiss the newly generated token first.');return;}
    try{
      const token=await createIntegrationToken(endpoint,{name:name.trim(),scopes:selected,expiresInDays:expiry});
      setCreated(token);
      setItems(prev=>[token,...prev]);setName('');
      setNotice('Integration credential generated. Copy it now; it cannot be displayed again.');
    }catch(e){setError(e instanceof Error?e.message:'Token could not be created');}
    finally{setBusy(false);}
  }
  async function revoke(item:IntegrationToken){
    if(!window.confirm('Revoke '+item.name+'? Any integration using this credential will immediately lose access.'))return;
    setBusy(true);setError('');setNotice('');
    try{
      await revokeIntegrationToken(endpoint,item.id);
      setItems(prev=>prev.map(t=>t.id===item.id?{...t,revokedAt:new Date().toISOString()}:t));
      setNotice('Integration token revoked.');
    }catch(e){setError(e instanceof Error?e.message:'Could not revoke credential');}
    finally{setBusy(false);}
  }
  async function copy(){
    if(!created)return;
    try{await navigator.clipboard.writeText(created.token);setNotice('Copied. Save the credential in a trusted password manager.');}
    catch{setError('Clipboard blocked. Select and copy the token manually.');}
  }
  const active=items.filter(t=>!t.revokedAt&&new Date(t.expiresAt).getTime()>Date.now());
  return <section className="api-token-manager" aria-label="API integration token manager">
    <div className="api-token-heading"><div><span className="eyebrow">INTEGRATION ACCESS</span>
      <h3>API tokens</h3><p>Create limited read-only credentials without sharing your administrator API_TOKEN.</p></div>
      <button className="btn secondary" disabled={loading} onClick={()=>void load()}><RefreshCw size={16}/> Refresh</button>
    </div>
    <div className="api-token-warning"><ShieldCheck size={18}/><span>
      Integration tokens cannot sign in to ATLAS, send faxes, download PDFs, change settings or create other credentials.
      The master administrator token stays in your VPS configuration.</span></div>
    {error&&<p className="api-token-error" role="alert">{error}</p>}
    {notice&&<p className="api-token-notice" role="status">{notice}</p>}
    {created&&<div className="api-token-reveal"><div className="api-token-reveal-title">
      <CheckCircle2 size={19}/><strong>Copy this token now — shown only once</strong>
      <button className="icon-btn" title="Dismiss and forget token" aria-label="Dismiss generated token"
        onClick={()=>{setCreated(null);setNotice('');}}><X size={17}/></button></div>
      <input type="text" readOnly aria-label="New API token secret" value={created.token} onFocus={e=>e.currentTarget.select()}/>
      <button className="btn secondary" type="button" onClick={()=>void copy()}><Copy size={15}/> Copy token</button>
      <small>Store it in a password manager. The server stores a hash, so the original secret cannot be recovered.</small>
    </div>}
    <form className="api-token-form" onSubmit={e=>void create(e)}>
      <div className="api-token-form-row">
        <label>Token name<input required minLength={2} maxLength={64} pattern="[A-Za-z0-9 ._()\\-]+"
          placeholder="Reporting integration" value={name} onChange={e=>setName(e.target.value)}/></label>
        <label>Expires in<select value={expiry} onChange={e=>setExpiry(Number(e.target.value) as 7|30|90)}>
          <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
        </select></label>
      </div>
      <div className="api-token-scope-grid">{scopes.map(scope=><label key={scope.value} className="api-token-scope">
        <input type="checkbox" checked={selected.includes(scope.value)}
          onChange={e=>toggle(scope.value,e.target.checked)}/>
        <span><strong>{scope.label}</strong><small>{scope.details}</small></span>
      </label>)}</div>
      <button className="btn primary" type="submit" disabled={busy||!!created||selected.length===0||active.length>=10}>
        <Plus size={16}/>{busy?'Working...':'Generate read-only token'}</button>
      {active.length>=10&&<small>Maximum 10 active integration tokens. Revoke one to create another.</small>}
    </form>
    <div className="api-token-list-heading"><h4>Existing integration tokens</h4><span>{active.length} active</span></div>
    {loading?<p>Loading credentials…</p>:items.length===0?<div className="api-token-empty"><KeyRound size={25}/>
      <p>No integration credentials created yet.</p></div>:
      <div className="api-token-list">{items.map(item=>{
        const expired=new Date(item.expiresAt).getTime()<Date.now();
        const status=item.revokedAt?'Revoked':expired?'Expired':'Active';
        return <div className="api-token-row" key={item.id}>
          <KeyRound size={19}/><div><strong>{item.name}</strong>
            <small>Prefix: {item.prefix}… · Scopes: {item.scopes.join(', ')}</small>
            <small>Created: {formatDate(item.createdAt)} · Expires: {formatDate(item.expiresAt)}</small>
            <small>Last used: {formatDate(item.lastUsedAt)}</small></div>
          <span className={'status '+(status==='Active'?'status-received':'status-queued')}>{status}</span>
          {status==='Active'&&<button className="btn secondary" disabled={busy}
            onClick={()=>void revoke(item)}><Trash2 size={15}/> Revoke</button>}
        </div>;
      })}</div>}
  </section>;
}
