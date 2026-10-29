import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { getReconciliation, type ReconciliationFeed } from './api';

const when = (date:string|null) => date ? new Date(date).toLocaleString() : 'Not recorded';

export default function ReconciliationPanel({endpoint}:{endpoint:string}){
  const [feed,setFeed]=useState<ReconciliationFeed|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  async function refresh(){
    setLoading(true);
    try{setFeed(await getReconciliation(endpoint));setError('');}
    catch(err){setError(err instanceof Error?err.message:'Unable to load reconciliation records');}
    finally{setLoading(false);}
  }
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    getReconciliation(endpoint).then(data=>{
      if(!cancelled){setFeed(data);setError('');}
    }).catch(err=>{
      if(!cancelled)setError(err instanceof Error?err.message:'Unable to load reconciliation records');
    }).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[endpoint]);

  return <section className="panel" aria-label="Manual fax reconciliation">
    <div className="panel-header">
      <h3>Manual reconciliation · read-only</h3>
      <button className="subtle-btn" type="button" onClick={()=>void refresh()} disabled={loading}>
        <RefreshCw size={16}/>{loading?'Checking':'Refresh'}
      </button>
    </div>
    <div className="notice inner"><ShieldCheck size={18}/><div>
      <strong>No automatic retries or status changes</strong>
      <span>Unknown submissions and outbound jobs without updates for 30 minutes appear here.
        Check the Telnyx portal using the provider ID, recipient and time before deciding on any new, separately authorized fax.</span>
    </div></div>
    {error&&<div className="transport-warning" role="alert"><AlertTriangle size={18}/>{error}</div>}
    {loading&&!feed&&<p>Loading provider reconciliation records…</p>}
    {!loading&&feed?.items.length===0&&<p>No unknown or stalled outbound transmissions in the latest review.</p>}
    {feed?.items.map(item=><div className="settings-card" key={item.id}>
      <AlertTriangle size={20}/>
      <div>
        <strong>{item.title} <span className="status status-queued">{item.status}</span></strong>
        <p>{item.reviewReason}</p>
        <p>To: {item.to} · Created: {when(item.createdAt)} · Last update: {when(item.updatedAt)}</p>
        <p>FaxingPro ID: <code>{item.id}</code></p>
        <p>Telnyx ID: <code>{item.telnyxId||'Not yet correlated'}</code></p>
        {item.failureReason&&<p>Recorded note: {item.failureReason}</p>}
        <details>
          <summary>Signed webhook history ({item.events.length} most recent, up to 20)</summary>
          {item.events.length===0?<p>No signed provider events are correlated with this transmission.</p>:
            <ul>{item.events.map((event,index)=><li key={event.type+event.occurredAt+index}>
              {event.type} · Provider time: {when(event.occurredAt)} · Received: {when(event.receivedAt)}
            </li>)}</ul>}
        </details>
      </div>
    </div>)}
    {feed&&<p className="muted-label">Showing up to {feed.limit} review candidates. This list is not a live Telnyx status lookup and does not establish delivery or failure.</p>}
  </section>;
}
