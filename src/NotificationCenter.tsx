import {useCallback,useEffect,useRef,useState} from 'react';
import {Bell,RefreshCw,ShieldCheck,AlertTriangle,FileText,Settings2,X} from 'lucide-react';
import {getNotifications,getNotificationPreferences,setNotificationPreferences,
  type FaxNotification,type FaxNotificationFeed} from './api';

export default function NotificationCenter({endpoint,onOpen}:{endpoint:string;onOpen:(faxId:string)=>void}){
  const [open,setOpen]=useState(false);
  const [feed,setFeed]=useState<FaxNotificationFeed>({items:[],total:0});
  const [browserEnabled,setBrowserEnabled]=useState(false);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const known=useRef<Set<string>|null>(null);
  const preferenceRef=useRef(false);
  useEffect(()=>{preferenceRef.current=browserEnabled;},[browserEnabled]);
  const refresh=useCallback(async()=>{
    try{
      const result=await getNotifications(endpoint);
      const ids=new Set(result.items.map(x=>x.id+':'+x.kind));
      if(known.current&&preferenceRef.current&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
        for(const item of result.items){
          if(known.current.has(item.id+':'+item.kind))continue;
          const alert=new Notification('FaxingPro · '+item.title,{body:item.description+' · '+item.number,tag:'fax-'+item.id});
          alert.onclick=()=>{window.focus();onOpen(item.faxId);alert.close();};
        }
      }
      known.current=ids;setFeed(result);setError('');
    }catch(e){setError(e instanceof Error?e.message:'Unable to retrieve notifications');}
  },[endpoint,onOpen]);
  useEffect(()=>{
    getNotificationPreferences(endpoint).then(p=>setBrowserEnabled(p.browserEnabled)).catch(()=>{});
  },[endpoint]);
  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>void refresh(),60_000);
    return ()=>window.clearInterval(timer);
  },[refresh]);
  async function toggleAlerts(){
    if(saving)return;
    setSaving(true);setError('');
    try{
      const next=!browserEnabled;
      if(next){
        if(typeof Notification==='undefined')throw Error('This browser does not support desktop notifications.');
        const permission=await Notification.requestPermission();
        if(permission!=='granted')throw Error('Allow notifications in browser settings to enable alerts.');
      }
      const result=await setNotificationPreferences(endpoint,next);
      setBrowserEnabled(result.browserEnabled);
    }catch(e){setError(e instanceof Error?e.message:'Could not update preferences');}
    finally{setSaving(false);}
  }
  return <div className="notification-center">
    <button className="icon-btn" aria-label={'Notifications: '+feed.total+' requiring attention'} title="Notifications"
      onClick={()=>{setOpen(v=>!v);void refresh();}}><Bell size={18}/>{feed.total>0&&<span className="notification-dot"/>}</button>
    {open&&<section className="notification-panel" aria-label="Fax notifications">
      <div className="notification-header"><strong>Fax notifications</strong><span>{feed.total} require attention</span>
        <button className="icon-btn" aria-label="Close notifications" onClick={()=>setOpen(false)}><X size={17}/></button></div>
      <div className="notification-scroll">
        {feed.items.length?feed.items.map(item=><button className="notification-item" key={item.id+item.kind}
          onClick={()=>{onOpen(item.faxId);setOpen(false);}}>
          <span className={'notification-kind '+(item.kind==='failed'?'notification-failed':'')}>
            {item.kind==='failed'?<AlertTriangle size={18}/>:<FileText size={18}/>}</span>
          <span><strong>{item.title}</strong><small>{item.description} · {item.number}</small>
            <small>{new Date(item.createdAt).toLocaleString()}</small></span></button>):
          <div className="notification-empty"><ShieldCheck size={25}/>No unread inbound faxes or failed transmissions.</div>}
      </div>
      {error&&<p role="alert" className="notification-error">{error}</p>}
      <div className="notification-footer"><button onClick={()=>{setLoading(true);void refresh().finally(()=>setLoading(false));}}
        disabled={loading}><RefreshCw size={14}/> Refresh</button>
        <button onClick={()=>void toggleAlerts()} disabled={saving}><Settings2 size={14}/>
          {browserEnabled?'Turn off desktop alerts':'Enable desktop alerts'}</button></div>
      <p className="notification-footnote">Based only on saved fax records. Polls every 60 seconds; not a real-time push service. Desktop alerts require your permission.</p>
    </section>}
  </div>;
}
