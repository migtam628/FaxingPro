import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Activity, Archive, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight,
  BookUser, CheckCircle2, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Cloud, Download, FilePlus2, FileText, FolderOpen,
  HardDrive, Inbox, LayoutDashboard, LifeBuoy, LockKeyhole, Menu, MoreHorizontal,
  Phone, Plus, Printer, Search, Send, Server, Settings2, ShieldCheck,
  UploadCloud, Users, X, AlertTriangle, RefreshCw, Eye, Wifi,
  type LucideIcon } from 'lucide-react';
import SetupWizard from './SetupWizard';
import NotificationCenter from './NotificationCenter';
import ReconciliationPanel from './ReconciliationPanel';
import ContactsManager from './ContactsManager';
import PublicLanding from './PublicLanding';
import { checkApi, listFaxes, getStats, getSession, createSession, destroySession, getSetup, completeSetup, getBackupStatus, getSecurityStatus, revokeAllSessions, setFaxFlag, getFaxEvents, getDailyActivity, downloadFax, submitFax, type DailyActivity, type FaxEvent, type Health, type FaxStats, type ServerFax, type SetupState, type BackupStatus, type SecurityStatus } from './api';
import type { Fax, FaxStatus, Page } from './types';

const sections: {group:string;items:{page:Page;label:string;icon:LucideIcon}[]}[] = [
  {group:'WORKSPACE',items:[
    {page:'dashboard',label:'Dashboard',icon:LayoutDashboard},{page:'inbox',label:'Inbox',icon:Inbox},
    {page:'sent',label:'Sent Faxes',icon:Send},{page:'compose',label:'New Fax',icon:FilePlus2},
    {page:'contacts',label:'Contacts',icon:BookUser},{page:'documents',label:'Documents',icon:FolderOpen},
    {page:'archive',label:'Archive',icon:Archive}]},
  {group:'MANAGEMENT',items:[
    {page:'numbers',label:'Fax Numbers',icon:Phone},{page:'team',label:'Team Members',icon:Users},
    {page:'reports',label:'Activity & Reports',icon:Activity}]},
  {group:'SYSTEM',items:[
    {page:'server',label:'Fax Server',icon:Server},{page:'sip',label:'Fax Transport',icon:Wifi},
    {page:'queue',label:'Job Queue',icon:Clock3},{page:'backups',label:'Backup & Recovery',icon:Archive},
    {page:'security',label:'Security',icon:ShieldCheck},
    {page:'settings',label:'Settings',icon:Settings2}]}
];
const titleFor = (p: Page) => p==='viewer' ? 'Document Viewer' : sections.flatMap(s=>s.items).find(s=>s.page===p)?.label || 'FaxHub';
const statusClass = (status:FaxStatus) => 'status status-' + status;
const prettyStatus = (s:FaxStatus) => s[0].toUpperCase()+s.substring(1);
function IconBadge({icon:Icon,kind='blue'}:{icon:LucideIcon;kind?:string}) {return <span className={'icon-badge badge-'+kind}><Icon size={18}/></span>;}
function Status({value}:{value:FaxStatus}) {return <span className={statusClass(value)}><span className="status-dot"/>{prettyStatus(value)}</span>;}
function Panel({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}) {return <section className="panel"><div className="panel-header"><h3>{title}</h3>{action}</div>{children}</section>;}
function Empty({label}:{label:string}) {return <div className="empty"><FileText size={30}/><strong>Nothing here yet</strong><span>{label}</span></div>;}
function serverToFax(s:ServerFax):Fax{
  const status:FaxStatus=s.status==='delivered'?'sent':s.status==='received'?'received':
    s.status==='failed'?'failed':'queued';
  return {id:s.id,title:s.title||s.filename||'Fax',contact:s.direction==='inbound'?s.from:s.to,
    number:s.direction==='inbound'?s.from:s.to,pages:s.pages||0,status,direction:s.direction,
    createdAt:new Date(s.createdAt).toLocaleString(),source:'live',hasDocument:s.hasDocument,
    unread:s.direction==='inbound'&&!s.readAt,archived:!!s.archivedAt};
}
function readBase64(file:File):Promise<string> {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Unable to read file'));reader.readAsDataURL(file);});}

export default function App(){
  const [page,setPage]=useState<Page>('dashboard');
  const [mobileNav,setMobileNav]=useState(false);
  const [activeFax,setActiveFax]=useState<Fax|null>(null);
  const [archivedFaxes,setArchivedFaxes]=useState<Fax[]>([]);
  const [faxEvents,setFaxEvents]=useState<FaxEvent[]>([]);
  const [faxEventsError,setFaxEventsError]=useState('');
  const [reportDays,setReportDays]=useState<DailyActivity[]>([]);
  const [reportError,setReportError]=useState('');
  const [unreadOnly,setUnreadOnly]=useState(false);
  const viewerFrame=useRef<HTMLIFrameElement|null>(null);
  const [viewerUrl,setViewerUrl]=useState<string|null>(null);
  const [viewerLoading,setViewerLoading]=useState(false);
  const [viewerError,setViewerError]=useState('');
  const [backupStatus,setBackupStatus]=useState<BackupStatus|null>(null);
  const [backupError,setBackupError]=useState('');
  const [securityStatus,setSecurityStatus]=useState<SecurityStatus|null>(null);
  const [securityError,setSecurityError]=useState('');
  const [boot,setBoot]=useState<'checking'|'signin'|'setup'|'ready'>('checking');
  const [setupInfo,setSetupInfo]=useState<SetupState|null>(null);
  const [setupError,setSetupError]=useState('');
  const [bootRetry,setBootRetry]=useState(0);
  const [filter,setFilter]=useState('');
  const [toast,setToast]=useState('');
  const [recipient,setRecipient]=useState('');
  const [subject,setSubject]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [fileUrl,setFileUrl]=useState<string|null>(null);
  const [cover,setCover]=useState('No cover sheet');
  const [apiEndpoint,setApiEndpoint]=useState(()=>{
    if(window.location.hostname.endsWith('.github.io')||window.location.protocol==='file:')return '';
    return window.location.origin;
  });
  const [apiToken,setApiToken]=useState('');
  const [health,setHealth]=useState<Health|null>(null);
  const [liveFaxes,setLiveFaxes]=useState<Fax[]|null>(null);
  const [stats,setStats]=useState<FaxStats|null>(null);
  const [refreshing,setRefreshing]=useState(false);
  const [testing,setTesting]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [viewTab,setViewTab]=useState('Details');
  const [settingsTab,setSettingsTab]=useState('General');
  const faxes=useMemo(()=>liveFaxes??[],[liveFaxes]);
  const current=useMemo(()=>(page==='archive'?archivedFaxes:faxes).filter(f=>{
    if(page==='inbox' && f.direction!=='inbound')return false;
    if(page==='sent' && f.direction!=='outbound')return false;
    if(page==='queue' && f.status!=='queued' && f.status!=='failed')return false;
    if(unreadOnly && page==='inbox' && !f.unread)return false;
    return (f.title+' '+f.contact+' '+f.number+' '+f.id).toLowerCase().includes(filter.toLowerCase());
  }),[faxes,archivedFaxes,page,filter,unreadOnly]);
  useEffect(()=>{
    // Cookies are scoped to the self-hosted HTTPS origin; never prompt for API_TOKEN on GitHub Pages.
    const endpoint=window.location.origin;
    if(window.location.hostname.endsWith('.github.io')||window.location.protocol==='file:'){
      setBoot('signin');return;
    }
    let cancelled=false;
    (async()=>{
      const session=await getSession(endpoint);
      if(!session.authenticated){
        if(!cancelled)setBoot('signin');
        return;
      }
      const [details,status,items,counters]=await Promise.all([
        getSetup(endpoint),checkApi(endpoint),listFaxes(endpoint),getStats(endpoint)]);
      if(cancelled)return;
      setSetupInfo(details);setHealth(status);setLiveFaxes(items.map(serverToFax));setStats(counters);
      setBoot(details.complete?'ready':'setup');
    })().catch(error=>{
      if(cancelled)return;
      setBoot('signin');
      const reason=error instanceof Error?error.message:'Unknown connection error';
      if(reason.includes('HTTP 404')){
        setSetupError('The FaxingPro API is outdated or its setup endpoint is missing (HTTP 404). Rebuild both API and web containers on the VPS.');
      }else if(reason.includes('HTTP 502')||reason.includes('HTTP 503')){
        setSetupError('The FaxingPro API cannot be reached through Nginx (HTTP 502/503). Check the API container logs on your VPS.');
      }else{
        setSetupError('Server check failed: '+reason+'. Check the API container and try again.');
      }
    });
    return ()=>{cancelled=true;};
  },[bootRetry]);
  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(''),4500);return ()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(!file){setFileUrl(null);return;}const url=URL.createObjectURL(file);setFileUrl(url);return ()=>URL.revokeObjectURL(url);},[file]);
  useEffect(()=>{
    if(page!=='viewer'||!activeFax?.hasDocument||!apiEndpoint)return;
    let cancelled=false,objectUrl='';
    setViewerLoading(true);setViewerError('');setViewerUrl(null);
    downloadFax(apiEndpoint,'',activeFax.id)
      .then(blob=>{
        if(!blob.size||!(blob.type.includes('pdf')||blob.type==='application/octet-stream'))
          throw Error('Server did not return a PDF document');
        objectUrl=URL.createObjectURL(blob);
        if(cancelled)URL.revokeObjectURL(objectUrl);else setViewerUrl(objectUrl);
      })
      .catch(error=>{if(!cancelled)setViewerError(error instanceof Error?error.message:'Unable to preview PDF');})
      .finally(()=>{if(!cancelled)setViewerLoading(false);});
    return ()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[page,activeFax?.id,activeFax?.hasDocument,apiEndpoint]);
  useEffect(()=>{
    if(page!=='backups'||boot!=='ready')return;
    let cancelled=false;
    getBackupStatus(apiEndpoint).then(v=>{if(!cancelled){setBackupStatus(v);setBackupError('');}})
      .catch(e=>{if(!cancelled)setBackupError(e instanceof Error?e.message:'Unable to load backup history');});
    return ()=>{cancelled=true;};
  },[page,boot,apiEndpoint]);
  useEffect(()=>{
    if(page!=='viewer'||!activeFax?.id||boot!=='ready')return;
    let cancelled=false;
    setFaxEvents([]);setFaxEventsError('');
    getFaxEvents(apiEndpoint,activeFax.id).then(events=>{
      if(!cancelled)setFaxEvents(events);
    }).catch(e=>{if(!cancelled)setFaxEventsError(e instanceof Error?e.message:'Event history unavailable');});
    return ()=>{cancelled=true;};
  },[page,activeFax?.id,boot,apiEndpoint]);
  useEffect(()=>{
    if(page!=='reports'||boot!=='ready')return;
    let cancelled=false;
    getDailyActivity(apiEndpoint).then(days=>{
      if(!cancelled){setReportDays(days);setReportError('');}
    }).catch(e=>{if(!cancelled)setReportError(e instanceof Error?e.message:'Daily reporting unavailable');});
    return ()=>{cancelled=true;};
  },[page,boot,apiEndpoint]);
  useEffect(()=>{
    if(page!=='archive'||boot!=='ready')return;
    let cancelled=false;
    listFaxes(apiEndpoint,'',{folder:'archived'}).then(rows=>{
      if(!cancelled)setArchivedFaxes(rows.map(serverToFax));
    }).catch(e=>{if(!cancelled)setToast(e instanceof Error?e.message:'Could not load archived faxes');});
    return ()=>{cancelled=true;};
  },[page,boot,apiEndpoint]);
  useEffect(()=>{
    if(page!=='security'||boot!=='ready')return;
    let cancelled=false;
    getSecurityStatus(apiEndpoint).then(data=>{
      if(!cancelled){setSecurityStatus(data);setSecurityError('');}
    }).catch(error=>{
      if(!cancelled)setSecurityError(error instanceof Error?error.message:'Unable to load security status');
    });
    return ()=>{cancelled=true;};
  },[page,boot,apiEndpoint]);
  async function refreshSecurity(){
    try{setSecurityStatus(await getSecurityStatus(apiEndpoint));setSecurityError('');}
    catch(error){setSecurityError(error instanceof Error?error.message:'Unable to refresh security status');}
  }
  async function signOutEverywhere(){
    if(!window.confirm('Revoke every active FaxingPro session, including this browser? You will need the API_TOKEN to sign in again.'))return;
    try{
      await revokeAllSessions(apiEndpoint);
      setBoot('signin');setApiToken('');setHealth(null);setLiveFaxes(null);
      setStats(null);setSecurityStatus(null);setSecurityError('');
    }catch(error){setSecurityError(error instanceof Error?error.message:'Session revocation failed');}
  }
  async function refreshBackups(){
    try{setBackupStatus(await getBackupStatus(apiEndpoint));setBackupError('');}
    catch(e){setBackupError(e instanceof Error?e.message:'Unable to refresh backups');}
  }
  function printCurrent(){
    if(!viewerUrl)return;
    try{viewerFrame.current?.contentWindow?.focus();viewerFrame.current?.contentWindow?.print();}
    catch{window.open(viewerUrl,'_blank','noopener,noreferrer');}
  }
  async function refreshLive(endpoint=apiEndpoint,token=apiToken){
    if(!endpoint.trim())return;
    setRefreshing(true);
    try{
      const [items,counters]=await Promise.all([listFaxes(endpoint,token),getStats(endpoint,token)]);
      setLiveFaxes(items.map(serverToFax));setStats(counters);
    }catch(error){setToast(error instanceof Error?error.message:'Unable to retrieve live faxes');}
    finally{setRefreshing(false);}
  }
  async function downloadCurrent(){
    if(!activeFax||activeFax.source!=='live'){setToast('Only live records with stored PDFs can be downloaded.');return;}
    try{
      const file=await downloadFax(apiEndpoint,apiToken,activeFax.id);
      const url=URL.createObjectURL(file),a=document.createElement('a');
      a.href=url;a.download=(activeFax.title||'fax').replace(/[^a-z0-9._-]/gi,'_')+'.pdf';a.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){setToast(error instanceof Error?error.message:'Unable to download fax');}
  }
  function navigate(p:Page){setPage(p);setMobileNav(false);setFilter('');setUnreadOnly(false);}
  async function changeFaxFlag(f:Fax,kind:'read'|'archive',enabled:boolean){
    try{
      await setFaxFlag(apiEndpoint,f.id,kind,enabled);
      if(kind==='read'){
        const mutate=(x:Fax)=>x.id===f.id?{...x,unread:!enabled}:x;
        setLiveFaxes(prev=>prev?.map(mutate)??null);
        setActiveFax(prev=>prev?.id===f.id?mutate(prev):prev);
      }else{
        const updated={...f,archived:enabled};
        if(enabled){
          setLiveFaxes(prev=>prev?.filter(x=>x.id!==f.id)??null);
          setArchivedFaxes(prev=>[updated,...prev.filter(x=>x.id!==f.id)]);
        }else{
          setArchivedFaxes(prev=>prev.filter(x=>x.id!==f.id));
          setLiveFaxes(prev=>prev?[updated,...prev.filter(x=>x.id!==f.id)]:null);
        }
        setActiveFax(prev=>prev?.id===f.id?updated:prev);
        setToast(enabled?'Fax archived. Original PDF retained.':'Fax restored to active records.');
      }
    }catch(e){setToast(e instanceof Error?e.message:'Unable to update fax record');}
  }
  function openFax(f:Fax){
    setActiveFax(f);setViewTab('Details');navigate('viewer');
    if(f.direction==='inbound'&&f.unread)void changeFaxFlag(f,'read',true);
  }
  async function openFromNotification(id:string){
    let found=[...faxes,...archivedFaxes].find(f=>f.id===id);
    if(!found){
      try{
        const results=await listFaxes(apiEndpoint,'',{folder:'all',query:id});
        found=results.map(serverToFax).find(x=>x.id===id);
      }catch(error){setToast(error instanceof Error?error.message:'Cannot open notification');return;}
    }
    if(found)openFax(found);
    else setToast('Fax record no longer found. Refresh your inbox.');
  }
  async function searchAllHistory(){
    setRefreshing(true);
    try{
      const archived=page==='archive';
      const rows=await listFaxes(apiEndpoint,'',{folder:archived?'archived':'active',query:filter});
      if(archived)setArchivedFaxes(rows.map(serverToFax));
      else setLiveFaxes(rows.map(serverToFax));
      setToast('Search results loaded from the server (up to 250 records).');
    }catch(e){setToast(e instanceof Error?e.message:'History search failed');}
    finally{setRefreshing(false);}
  }
  async function testConnection(){
    const endpoint=apiEndpoint.trim().replace(/\/$/,'');
    if(!endpoint){setSetupError('Open your self-hosted FaxingPro website to sign in.');return;}
    let site:URL;
    try{site=new URL(endpoint);}catch{setSetupError('Invalid server URL.');return;}
    if(site.origin!==window.location.origin){
      setSetupError('Sign in directly on your FaxingPro HTTPS website.');return;
    }
    setTesting(true);setSetupError('');
    try{
      const status=await checkApi(endpoint);
      const session=apiToken.trim()?await createSession(endpoint,apiToken.trim()):await getSession(endpoint);
      if(!session.authenticated)throw Error('Enter a valid API_TOKEN from your VPS.');
      const [details,items,counters]=await Promise.all([getSetup(endpoint),listFaxes(endpoint),getStats(endpoint)]);
      setApiToken('');
      setSetupInfo(details);setHealth(status);setLiveFaxes(items.map(serverToFax));setStats(counters);
      setBoot(details.complete?'ready':'setup');
      setToast('Connected securely. Your session is retained for seven days.');
    }catch(error){
      setSetupError(error instanceof Error?error.message:'Connection failed');
      setHealth(null);setLiveFaxes(null);setStats(null);
    }finally{setTesting(false);}
  }
  async function recheckSetup(){
    setTesting(true);setSetupError('');
    try{setSetupInfo(await getSetup(apiEndpoint));}
    catch(error){setSetupError(error instanceof Error?error.message:'Gateway validation failed');}
    finally{setTesting(false);}
  }
  async function finishSetup(name:string,timezone:string){
    setTesting(true);setSetupError('');
    try{
      const result=await completeSetup(apiEndpoint,name,timezone);
      setSetupInfo(result);setBoot('ready');
      await refreshLive(apiEndpoint,'');
    }catch(error){setSetupError(error instanceof Error?error.message:'Could not finish setup');}
    finally{setTesting(false);}
  }
  async function signOut(){
    try{await destroySession(apiEndpoint);}
    catch(error){setToast(error instanceof Error?error.message:'Unable to sign out');return;}
    setApiToken('');setHealth(null);setLiveFaxes(null);setStats(null);
    setBoot('signin');setSetupError('');
  }
  async function sendFax(){
    if(!recipient.trim()||!file){setToast('A recipient and PDF document are required.');return;}
    if(!health?.faxEnabled || !apiEndpoint.trim() || liveFaxes===null){setToast('Fax transport is not ready. Check the connection in Settings.');return;}
    if(!/^\+?[0-9 ()-]{7,24}$/.test(recipient)){setToast('Enter a valid telephone number.');return;}
    setSubmitting(true);try{
      const contentBase64=await readBase64(file);
      const result=await submitFax(apiEndpoint,apiToken,{recipient,title:subject||file.name,filename:file.name,contentBase64,requestId:crypto.randomUUID()});
      setToast('Telnyx submission '+result.id+' ('+result.status+'). Delivered only after the provider confirms it.');await refreshLive();navigate('sent');
    }catch(e){setToast(e instanceof Error?e.message:'Failed to submit fax');}finally{setSubmitting(false);}
  }
  function handleFile(event:ChangeEvent<HTMLInputElement>){
    const value=event.target.files?.[0];
    if(value && value.type!=='application/pdf'){setToast('Only PDF files are accepted in this starter version.');return;}
    if(value && value.size>10*1024*1024){setToast('PDF must be 10 MB or smaller.');return;}
    setFile(value||null);
  }
  if(window.location.hostname.endsWith('.github.io'))return <PublicLanding/>;
  if(boot!=='ready'){
    return <SetupWizard mode={boot} endpoint={apiEndpoint}
      token={apiToken} setToken={setApiToken} setup={setupInfo} working={testing}
      error={setupError} onConnect={testConnection} onReload={recheckSetup}
      onRetry={()=>{setBoot('checking');setSetupError('');setBootRetry(n=>n+1);}}
      onFinish={finishSetup}/>;
  }
  const table = (items:Fax[],showCheckbox=true)=><div className="table-scroll"><table className="fax-table"><thead><tr>{showCheckbox&&<th className="check-col"><input aria-label="Select all" type="checkbox" disabled/></th>}<th>Document / Contact</th><th>Fax number</th><th>Status</th><th>Pages</th><th>Date</th><th></th></tr></thead><tbody>{items.map(f=><tr key={f.id} onClick={()=>openFax(f)} className="click-row">{showCheckbox&&<td onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={'Select '+f.id} disabled/></td>}<td><div className="file-cell"><span className="pdf-icon"><FileText size={16}/></span><span><strong>{f.title}</strong><small>{f.contact}</small></span>{f.unread&&<span className="new-dot"/>}</div></td><td>{f.number}</td><td><Status value={f.status}/></td><td>{f.pages}</td><td>{f.createdAt}</td><td><ChevronRight size={17}/></td></tr>)}</tbody></table>{items.length===0&&<Empty label="Try a different search or folder."/>}</div>;
  return <div className="app-shell">
    <aside className={'sidebar '+(mobileNav?'sidebar-open':'')}>
      <div className="brand"><span className="brand-mark"><Printer size={22}/></span><div><strong>FaxingPro</strong><small>ATLAS WORKSPACE</small></div><button className="mobile-close" aria-label="Close menu" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace-switch"><span className="workspace-avatar">FP</span><div><strong>{setupInfo?.workspaceName||'FaxingPro'}</strong><small>Telnyx API connected</small></div></div>
      <div className="nav-groups">{sections.map(section=><div className="nav-group" key={section.group}><div className="nav-heading">{section.group}</div>{section.items.map(({page:p,label,icon:Icon})=><button key={p} className={'nav-item '+(page===p || (page==='viewer'&&p==='documents')?'nav-active':'')} onClick={()=>navigate(p)}><Icon size={18}/><span>{label}</span>{p==='inbox'&&faxes.some(f=>f.unread)&&<span className="nav-count">{faxes.filter(f=>f.unread).length}</span>}</button>)}</div>)}</div>
      <div className="sidebar-bottom"><div className="support"><LifeBuoy size={17}/><span>Help & Support</span><ArrowUpRight size={14}/></div><div className="profile"><span className="profile-avatar">FP</span><div><strong>Local Operator</strong><small>Workspace administrator</small></div><MoreHorizontal size={17}/></div></div>
    </aside>
    {mobileNav&&<button className="nav-backdrop" aria-label="Close sidebar" onClick={()=>setMobileNav(false)}/>}
    <div className="main-area">
      <header className="topbar"><div className="top-left"><button className="mobile-menu icon-btn" aria-label="Open navigation" onClick={()=>setMobileNav(true)}><Menu size={20}/></button><div className="breadcrumbs">Workspace <ChevronRight size={14}/> <strong>{titleFor(page)}</strong></div></div><div className="top-right"><span className="demo-pill"><span className="pulse-dot"/> LIVE RECORDS</span><button className="top-search" onClick={()=>navigate('documents')}><Search size={16}/> Search faxes & documents <span>⌘ K</span></button><button className="icon-btn" aria-label="Help" onClick={()=>setToast('FaxingPro · Telnyx-powered live fax workspace.')}><CircleHelp size={18}/></button><NotificationCenter endpoint={apiEndpoint} onOpen={id=>void openFromNotification(id)}/><span className="top-avatar">FP</span></div></header>
      <main className="content">
      {page==='dashboard'&&<>
        <div className="page-heading"><div><span className="eyebrow">{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).toUpperCase()}</span><h1>Good morning <span className="wave">✳</span></h1><p>Here's what's happening across your fax workspace.</p></div><button className="btn primary" onClick={()=>navigate('compose')}><Plus size={18}/> New Fax</button></div>
        <div className="notice"><ShieldCheck size={19}/><div><strong>Live Telnyx connection</strong><span>All records and counts are read from your private VPS database. Delivery is confirmed only by Telnyx.</span></div><button onClick={()=>navigate('settings')}>Configure server <ArrowRight size={15}/></button></div>
        <div className="kpi-grid">{[
          {label:'Received Faxes',num:String(stats?.received??0),delta:'Actual records',icon:ArrowDownLeft,kind:'green'},
          {label:'Sent Faxes',num:String(stats?.sent??0),delta:'Confirmed deliveries',icon:ArrowUpRight,kind:'blue'},
          {label:'Pending',num:String(stats?.pending??0),delta:'Queue',icon:Clock3,kind:'amber'},
          {label:'Failed',num:String(stats?.failed??0),delta:'Attention',icon:AlertTriangle,kind:'red'}].map(k=><div className="kpi-card" key={k.label}><div className="kpi-head"><IconBadge icon={k.icon} kind={k.kind}/><MoreHorizontal size={20}/></div><div className="kpi-value">{k.num}</div><div className="kpi-bottom"><span>{k.label}</span><small>{k.delta}</small></div></div>)}</div>
        <div className="dashboard-row">
          <Panel title="Fax Activity" action={<button className="subtle-btn" onClick={()=>navigate('reports')}>Reports <ArrowRight size={15}/></button>}>
            <div className="notice inner"><Activity size={18}/><div><strong>Live transmissions</strong>
              <span>{faxes.length} recent fax record{faxes.length===1?'':'s'} loaded. Historical trend charts will appear when reporting is implemented.</span></div></div>
            {faxes.length===0&&<Empty label="Your first fax will appear here after Telnyx confirms its status."/>}
          </Panel>
          <Panel title="Quick Actions"><div className="actions-list">{[
            {icon:Send,title:'Send a fax',sub:'Send a document securely',page:'compose' as Page},
            {icon:Inbox,title:'View inbox',sub:'Review incoming documents',page:'inbox' as Page},
            {icon:BookUser,title:'Manage contacts',sub:'Your fax address book',page:'contacts' as Page},
            {icon:Settings2,title:'Configure server',sub:'Connect your self-hosted API',page:'settings' as Page}
            ].map(x=><button className="action-row" key={x.title} onClick={()=>navigate(x.page)}><IconBadge icon={x.icon}/><span><strong>{x.title}</strong><small>{x.sub}</small></span><ChevronRight size={18}/></button>)}</div></Panel>
        </div>
        <Panel title="Recent Transmissions" action={<button className="link-btn" onClick={()=>navigate('documents')}>View all <ArrowRight size={15}/></button>}>{table(faxes.slice(0,5),false)}</Panel>
      </>}
      {(page==='inbox'||page==='sent'||page==='documents'||page==='queue'||page==='archive')&&<>
        <div className="page-heading"><div><span className="eyebrow">FAX MANAGEMENT</span><h1>{titleFor(page)}</h1><p>{page==='inbox'?'Manage your incoming fax documents.':page==='sent'?'Track your outgoing fax transmissions.':page==='queue'?'Monitor transmissions that need processing or attention.':page==='archive'?'Archived transmissions are retained with their original documents.':'Search and organize real fax history.'}</p></div><button className="btn primary" onClick={()=>navigate('compose')}><Plus size={18}/> New Fax</button></div>
        {page==='queue'&&<ReconciliationPanel endpoint={apiEndpoint}/>}
        <div className="content-panel">
          <div className="table-toolbar"><div className="tabs"><button className={'tab '+(!unreadOnly?'active-tab':'')}
            onClick={()=>setUnreadOnly(false)}>All records</button>
            {page==='inbox'&&<button className={'tab '+(unreadOnly?'active-tab':'')}
            onClick={()=>setUnreadOnly(true)}>Unread ({faxes.filter(f=>f.unread).length})</button>}</div><div className="table-tools"><label className="search-box"><Search size={16}/><input placeholder="Search faxes..." value={filter} onChange={e=>setFilter(e.target.value)}/></label><button className="subtle-btn" onClick={()=>void searchAllHistory()} disabled={refreshing}><Search size={16}/> Search history</button></div></div>
          {table(current)}
          <div className="table-footer"><span>Showing {current.length} records · Live VPS data · Up to 250 per query</span><div><button className="subtle-btn" onClick={()=>refreshLive()} disabled={refreshing}><RefreshCw size={15}/>{refreshing?'Refreshing':'Refresh'}</button><button disabled><ChevronLeft size={17}/></button><strong>1</strong><button disabled><ChevronRight size={17}/></button></div></div>
        </div>
      </>}
      {page==='compose'&&<>
        <div className="page-heading"><div><span className="eyebrow">OUTGOING FAX</span><h1>Compose a new fax</h1><p>Prepare documents for secure delivery to a fax number.</p></div><button className="btn ghost" onClick={()=>navigate('sent')}><ArrowLeft size={17}/> Back to sent</button></div>
        <div className="compose-grid"><div className="compose-primary">
          <section className="panel form-panel"><div className="panel-header"><h3><span className="step-num">1</span> Recipient details</h3></div><div className="fields"><label>Recipient fax number <span>*</span><input value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="+1 (555) 000-0000" inputMode="tel"/></label><label>Subject <span className="optional">Optional</span><input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="e.g. Signed service agreement"/></label></div></section>
          <section className="panel form-panel"><div className="panel-header"><h3><span className="step-num">2</span> Attach documents</h3><span className="muted-label">PDF only · 10 MB max</span></div><div className="upload-zone"><UploadCloud size={28}/><strong>{file?file.name:'Drag a PDF here or choose a file'}</strong><span>{file?'Ready for preview. File is not uploaded until submitted.':'Attach one PDF file to your outgoing fax.'}</span><label className="btn secondary file-label">Browse files<input type="file" accept="application/pdf,.pdf" onChange={handleFile}/></label></div>{file&&<div className="attached"><FileText size={19}/><span>{file.name}<small>{(file.size/1024).toFixed(0)} KB</small></span><button className="icon-btn" aria-label="Remove file" onClick={()=>setFile(null)}><X size={17}/></button></div>}</section>
          <section className="panel form-panel"><div className="panel-header"><h3><span className="step-num">3</span> Delivery options</h3></div><div className="fields two-col"><label>Cover sheet<select value={cover} onChange={e=>setCover(e.target.value)}><option>No cover sheet</option></select></label><label>Delivery time<select disabled><option>Send immediately</option></select></label></div><p className="field-help">Cover sheets and scheduled sends are not implemented. The attached PDF is sent as-is.</p></section>
          <div className="compose-actions"><button className="btn primary" disabled={submitting||!health?.faxEnabled} onClick={sendFax}>{submitting?<RefreshCw size={17}/>:<Send size={17}/>} {submitting?'Submitting...':'Queue Fax'}</button></div>
          {!health?.faxEnabled&&<div className="transport-warning"><AlertTriangle size={18}/> Outbound sending is disabled in your VPS configuration. <button onClick={()=>navigate('settings')}>Server settings</button></div>}
        </div><div className="compose-aside"><Panel title="Document preview"><div className="preview-window">{fileUrl?<iframe className="file-preview" title="Selected PDF preview" src={fileUrl}/>:<Empty label="Attach a PDF to preview the actual document before sending."/>}</div><div className="preview-foot"><Eye size={16}/> {file?'Local PDF preview':'No document selected'}</div></Panel><div className="side-info"><LockKeyhole size={19}/><div><strong>Private workspace</strong><p>Attached PDFs remain on this device until submitted. Sent and received documents are encrypted in the private server volume.</p></div></div></div></div>
      </>}
      {page==='viewer'&&activeFax&&<>
        <div className="page-heading compact"><div><button className="back-link" onClick={()=>navigate('documents')}><ArrowLeft size={16}/> Back to documents</button><h1>{activeFax.title}</h1><p>{activeFax.pages} pages · {activeFax.id} · {activeFax.createdAt}</p></div><div className="heading-actions"><Status value={activeFax.status}/><button className="btn secondary" onClick={()=>void changeFaxFlag(activeFax,'archive',!activeFax.archived)}><Archive size={16}/>{activeFax.archived?'Restore':'Archive'}</button><button className="btn secondary" onClick={downloadCurrent}><Download size={16}/> Download</button><button className="btn primary" onClick={()=>{setRecipient(activeFax.number);navigate('compose');}}><ArrowUpRight size={16}/> Forward</button></div></div>
        <div className="viewer-grid"><div className="viewer-area">
          <div className="viewer-tools"><span><FileText size={16}/> Secure PDF viewer</span>
            <div><span>{activeFax.pages||'—'} reported page{activeFax.pages===1?'':'s'}</span>
              <button disabled={!viewerUrl} aria-label="Print fax" onClick={printCurrent}><Printer size={17}/></button>
              <button aria-label="Download PDF" onClick={downloadCurrent}><Download size={17}/></button></div></div>
          <div className="viewer-canvas real-pdf-canvas">
            {viewerLoading&&<div className="pdf-placeholder"><RefreshCw size={25}/><strong>Loading encrypted fax document…</strong></div>}
            {!viewerLoading&&viewerUrl&&<iframe ref={viewerFrame} className="stored-pdf" title={'PDF document: '+activeFax.title} src={viewerUrl}/>}
            {!viewerLoading&&!viewerUrl&&<div className="pdf-placeholder"><FileText size={35}/>
              <strong>{viewerError||(!activeFax.hasDocument?'Document not stored yet':'PDF preview unavailable')}</strong>
              <span>Use Download PDF to retrieve the original file if it is available.</span>
              {activeFax.hasDocument&&<button className="btn secondary" onClick={downloadCurrent}><Download size={16}/> Download PDF</button>}
            </div>}
          </div></div>
          <aside className="viewer-side"><div className="detail-tabs">{['Details','Activity'].map(t=><button key={t} className={viewTab===t?'current':''} onClick={()=>setViewTab(t)}>{t}</button>)}</div>{viewTab==='Details'?<div className="detail-body"><div className="detail-status"><Status value={activeFax.status}/><span>{activeFax.direction==='inbound'?'Incoming fax':'Outgoing fax'}</span></div>{[['Document',activeFax.title],['From / To',activeFax.contact],['Fax number',activeFax.number],['Pages',String(activeFax.pages)],['Received / Created',activeFax.createdAt],['Transmission ID',activeFax.id],['Source','VPS / Telnyx']].map(([k,v])=><div className="detail-row" key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>:<div className="detail-body"><div className="timeline"><span/><div><strong>Created in FaxingPro</strong><small>{activeFax.createdAt}</small></div></div>
            {faxEvents.map((event,index)=><div className="timeline" key={index}><span/><div>
              <strong>{event.type.replace(/^fax\./,'').replaceAll('.',' ').replaceAll('_',' ')}</strong>
              <small>{new Date(event.occurredAt).toLocaleString()}</small></div></div>)}
            {faxEvents.length===0&&<p className="field-help">No provider webhook events recorded for this fax yet.</p>}
            {faxEventsError&&<p className="field-help">{faxEventsError}</p>}</div>}<div className="viewer-side-actions"><button onClick={downloadCurrent}><Download size={16}/> Download PDF</button><button onClick={()=>{setRecipient(activeFax.number);navigate('compose');}}><ArrowUpRight size={16}/> Forward as fax</button>{activeFax.direction==='inbound'&&<button onClick={()=>void changeFaxFlag(activeFax,'read',!!activeFax.unread)}><Eye size={16}/>{activeFax.unread?'Mark read':'Mark unread'}</button>}
            <button onClick={()=>void changeFaxFlag(activeFax,'archive',!activeFax.archived)}><Archive size={16}/>{activeFax.archived?'Restore from archive':'Archive without deleting'}</button></div></aside></div>
      </>}
      {page==='contacts'&&<ContactsManager endpoint={apiEndpoint} onFax={number=>{setRecipient(number);navigate('compose');}}/>}
      {page==='numbers'&&<>
        <div className="page-heading"><div><span className="eyebrow">PHONE SERVICES</span><h1>Fax Number</h1>
          <p>Your number is managed by Telnyx Mission Control.</p></div></div>
        <Panel title="Telnyx fax line"><div className="settings-card"><Phone size={22}/><div>
          <strong>{setupInfo?.fromNumber||'Not configured'}</strong>
          <p>Assigned in Telnyx; Fax Application and routing are managed in Mission Control.</p>
        </div><span className="status status-received">Configured</span></div></Panel>
      </>}
      {page==='reports'&&<><div className="page-heading"><div><span className="eyebrow">INSIGHTS</span><h1>Activity & Reports</h1><p>Live counters from your private FaxingPro database.</p></div></div>
        <div className="kpi-grid">{[['Successful deliveries',String(stats?.sent??0)],['Received faxes',String(stats?.received??0)],['Pending transmissions',String(stats?.pending??0)],['Failed transmissions',String(stats?.failed??0)]].map(([label,value])=><div className="kpi-card" key={label}><span className="eyebrow">{label}</span><div className="kpi-value">{value}</div></div>)}</div>
        <Panel title="Daily fax activity · last 14 days (UTC)">
          {reportError&&<div className="transport-warning"><AlertTriangle size={18}/>{reportError}</div>}
          {reportDays.length>0?<div className="report-bars">
            {reportDays.slice(-14).map(day=>{
              const total=day.received+day.sent;
              const max=Math.max(1,...reportDays.slice(-14).map(d=>d.received+d.sent));
              return <div className="report-day" key={day.day} title={day.day+': '+day.received+' received, '+day.sent+' sent, '+day.failed+' failed'}>
                <div className="report-bar-track"><span style={{height:Math.max(3,total/max*100)+'%'}}/></div>
                <small>{day.day.slice(5)}</small><strong>{total}</strong>
              </div>;
            })}</div>:<Empty label="No daily transmission data has been loaded yet."/>}
          <p className="field-help">Counts are based on original record creation date, not confirmation date. Times shown in UTC; incoming and outgoing fax records only.</p>
        </Panel>
        <Panel title="Recent transmissions">{table(faxes.slice(0,10),false)}</Panel></>}
      {page==='team'&&<><div className="page-heading"><div><span className="eyebrow">ACCESS MANAGEMENT</span><h1>Team Members</h1><p>Manage team roles and workspace permissions.</p></div><button className="btn primary" onClick={()=>setToast('Team invitations are not yet available. This installation uses a single operator.')}><Users size={16}/> Invite member</button></div><Panel title="Workspace access"><div className="settings-card"><Users size={22}/><div><strong>Local operator</strong><p>Administrator · Secure session</p></div><span className="status status-received">Active</span></div></Panel></>}
      {(page==='settings'||page==='server'||page==='sip'||page==='security'||page==='backups')&&<>
        <div className="page-heading"><div><span className="eyebrow">SYSTEM ADMINISTRATION</span><h1>{titleFor(page)}</h1><p>Configure your self-hosted FaxingPro installation.</p></div></div>
        <div className="settings-layout"><div className="settings-menu">{[['General','settings'],['API Connection','settings'],['Server Health','server'],['SIP & T.38','sip'],['Security','security'],['Backup & Recovery','backups']].map(([name,target])=><button className={(page===target&&(page!=='settings'||settingsTab===name))?'selected':''} key={name} onClick={()=>{setPage(target as Page);setSettingsTab(name);}}>{name}<ChevronRight size={15}/></button>)}</div><div className="settings-content">
          {page==='settings'&&settingsTab==='General'&&<Panel title="Workspace preferences">
            <div className="settings-card"><Settings2 size={22}/><div><strong>{setupInfo?.workspaceName||'FaxingPro'}</strong><p>Workspace name · Setup completed in your private database.</p></div><span className="status status-received">Active</span></div>
            <div className="settings-card"><Cloud size={22}/><div><strong>Timezone</strong><p>{setupInfo?.timezone||'America/New_York'}</p></div></div>
            <div className="settings-card"><HardDrive size={22}/><div><strong>Documents</strong><p>Stored encrypted on the FaxingPro VPS; no sample faxes are used.</p></div></div>
          </Panel>}
          {page==='settings'&&settingsTab==='API Connection'&&<Panel title="Connect your self-hosted server"><div className="settings-fields"><label>API base URL<input placeholder="https://fax.example.com" value={apiEndpoint} onChange={e=>{setApiEndpoint(e.target.value);setHealth(null);setLiveFaxes(null);setStats(null);}}/></label><label>Operator API token (sign in once)<input type="password" autoComplete="off" placeholder={liveFaxes!==null?'Signed in — token not stored in browser':'Enter API_TOKEN from your VPS'} value={apiToken} onChange={e=>setApiToken(e.target.value)}/></label><p>Your API_TOKEN is exchanged once for a secure HttpOnly session cookie valid for 7 days. The token is never saved in browser storage and is cleared from this form after sign-in. Use only your trusted FaxingPro HTTPS website, never the public GitHub Pages demo.</p><button className="btn primary" disabled={testing} onClick={testConnection}><RefreshCw size={17}/>{testing?'Connecting...':liveFaxes!==null?'Refresh connection':'Sign in & connect'}</button>{liveFaxes!==null&&<button className="btn secondary" onClick={signOut}><LockKeyhole size={17}/> Sign out</button>}{health&&<div className="connection-result"><CheckCircle2 size={17}/> Connected: {health.service} · transport: {health.transport} · fax: {health.faxEnabled?'enabled':'disabled'}</div>}</div></Panel>}
          {page==='server'&&<Panel title="Server health"><div className="settings-card"><Server size={22}/><div><strong>FaxingPro API</strong><p>{health?health.service+' is responding':'Not connected. Configure your API connection in Settings.'}</p></div><span className={'status '+(health?'status-received':'status-queued')}>{health?'Online':'Unknown'}</span></div><div className="settings-card"><Cloud size={22}/><div><strong>Transmission provider</strong><p>{health?health.transport:'Not connected'}</p></div></div><button className="btn secondary" onClick={()=>{setPage('settings');setSettingsTab('API Connection');}}>Configure connection <ArrowRight size={16}/></button></Panel>}
          {page==='sip'&&<Panel title="Managed fax transport"><div className="settings-card"><Phone size={22}/><div><strong>{health?.transport==='telnyx-fax-api'?'Telnyx Programmable Fax':'SIP trunk (alternative)'}</strong><p>{health?.transport==='telnyx-fax-api'?'Managed by Telnyx. Verify your Fax Application ID, purchased DID, public webhook, and account permissions on the VPS.':'No self-hosted SIP gateway configured.'}</p></div><span className="status status-received">Connected</span></div><div className="settings-card"><Wifi size={22}/><div><strong>Fax transport</strong><p>{health?.transport==='telnyx-fax-api'?'T.38 and G.711 processing are managed by Telnyx Fax API.':'Self-hosted SIP/T.38 is an optional alternative requiring a separate gateway.'}</p></div></div><div className="notice inner"><AlertTriangle size={18}/><div><strong>{health?.faxEnabled?'Outbound test enabled':'Outbound is locked'}</strong><span>Only Telnyx fax.delivered confirms delivery; API acceptance is not a delivery receipt.</span></div></div></Panel>}
          {page==='backups'&&<Panel title="Backup & Recovery Center">
            <div className="settings-card"><Archive size={22}/><div><strong>Encrypted recovery archives</strong>
              <p>Backups combine the PostgreSQL database, encrypted PDF documents and the protected recovery configuration using an off-VPS age public key.</p></div>
              <span className={'status '+(backupStatus?.freshness==='recent'?'status-received':'status-queued')}>
                {backupStatus?.freshness==='recent'?'Recent local copy':backupStatus?.freshness==='stale'?'Older than 36 h':'No backup recorded'}</span></div>
            {backupError&&<div className="transport-warning"><AlertTriangle size={18}/>{backupError}</div>}
            {backupStatus&&<div className="notice inner"><Activity size={18}/><div>
              <strong>Local backup freshness: {backupStatus.freshness==='recent'?'Recent':backupStatus.freshness==='stale'?'Overdue':'No record'}</strong>
              <span>{backupStatus.message} Scheduling is configured on your VPS, not in ATLAS, and must be checked with systemctl.</span>
            </div></div>}
            <div className="backup-history">
              <h3>Latest local backup records</h3>
              {backupStatus?.runs.length?backupStatus.runs.map(run=><div className="backup-record" key={run.name}>
                <CheckCircle2 size={17}/><strong>{run.name}</strong>
                <span>{new Date(run.completed_at).toLocaleString()}</span>
                <span className={'status '+(run.drive_verified_at?'status-received':'status-queued')}>
                  {run.drive_verified_at?'Google Drive verified':'Drive upload pending'}</span></div>):
                <Empty label="No backup job has reported successful encrypted archive creation yet."/>}
            </div>
            <div className="settings-card"><Cloud size={22}/><div>
              <strong>Google Drive encrypted offsite backup</strong>
              <p>{backupStatus?.offsiteVerified?'The newest locally recorded backup has a successful Google Drive checksum match.':'The latest encrypted backup has not yet been confirmed on Google Drive.'}
              {' '}Checksum matching verifies the copied encrypted files, not full restoration or Google Drive account recovery.</p></div>
              <span className={'status '+(backupStatus?.offsiteVerified?'status-received':'status-queued')}>
                {backupStatus?.offsiteVerified?'Verified':'Not verified'}</span></div>
            <div className="notice inner"><ShieldCheck size={18}/><div><strong>Recovery key remains offline</strong>
              <span>Offsite transfer never sends plaintext fax PDFs. Restore testing and protection of the private age key are separate steps. The backup process does not delete local or Google Drive copies.</span></div></div>
            <div className="backup-actions">
              <button className="btn secondary" onClick={()=>void refreshBackups()}><RefreshCw size={16}/> Refresh status</button>
              <a className="btn secondary" href="https://github.com/migtam628/FaxingPro/blob/main/docs/BACKUP_RECOVERY.md" target="_blank" rel="noopener noreferrer">Backup & recovery guide <ArrowUpRight size={15}/></a>
            </div>
          </Panel>}
          {page==='security'&&<Panel title="Security & Sessions">
            <div className="settings-card"><ShieldCheck size={22}/><div><strong>Single-operator authentication</strong>
              <p>API_TOKEN exchange, secure HttpOnly session cookies and persistent invalid-login throttling (8 invalid attempts per 15 minutes). Valid operator credentials remain accepted during an attack.</p></div>
              <span className="status status-received">Enabled</span></div>
            <div className="settings-card"><LockKeyhole size={22}/><div><strong>Active operator sessions</strong>
              <p>{securityStatus?securityStatus.activeSessions+' active browser session(s)':'Loading session status...'}</p></div>
              <span className="status status-queued">7-day maximum</span></div>
            <div className="settings-card"><AlertTriangle size={22}/><div><strong>Invalid operator logins in last 24 hours</strong>
              <p>{securityStatus?String(securityStatus.failedLogins24h):'Loading audit data...'}</p></div></div>
            <div className="settings-card"><Archive size={22}/><div><strong>Additional security still required</strong>
              <p>MFA, per-user roles, automated abuse monitoring and formal data-retention controls remain future work. Don't treat this as a multi-user or regulated-data-ready release.</p></div></div>
            <div className="backup-history"><h3>Recent operator security events</h3>
              {securityStatus?.events.length?securityStatus.events.map((event,index)=>
                <div className="backup-record" key={index}>
                  <ShieldCheck size={17}/>
                  <strong>{event.type.replaceAll('_',' ')}</strong>
                  <span>{new Date(event.createdAt).toLocaleString()}</span>
                </div>):<Empty label="No security events recorded yet."/>}
            </div>
            {securityError&&<div className="transport-warning"><AlertTriangle size={18}/>{securityError}</div>}
            <div className="backup-actions">
              <button className="btn secondary" onClick={()=>void refreshSecurity()}><RefreshCw size={16}/> Refresh security</button>
              <button className="btn secondary" onClick={()=>void signOutEverywhere()}><LockKeyhole size={16}/> Sign out all sessions</button>
            </div>
          </Panel>}
        </div></div>
      </>}
      <footer className="app-footer"><span>FaxingPro · ATLAS v0.8 · Live backend</span><span><span className="footer-dot"/> {health?.faxEnabled?'Telnyx outbound pilot enabled':'Outbound sending locked'}</span></footer>
      </main>
    </div>
    {toast&&<div className="toast"><span>{toast}</span><button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={17}/></button></div>}
  </div>;
}
