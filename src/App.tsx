import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Activity, Archive, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Bell,
  BookUser, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Cloud, Download, FilePlus2, FileText, Filter, FolderOpen,
  HardDrive, Inbox, LayoutDashboard, LifeBuoy, LockKeyhole, Menu, MoreHorizontal,
  Phone, Plus, Printer, Search, Send, Server, Settings2, ShieldCheck,
  Trash2, UploadCloud, Users, X, AlertTriangle, RefreshCw, Eye, Wifi,
  type LucideIcon } from 'lucide-react';
import { demoFaxes, contacts } from './demo';
import { checkApi, listFaxes, getStats, downloadFax, submitFax, type Health, type FaxStats, type ServerFax } from './api';
import type { Fax, FaxStatus, Page } from './types';

const sections: {group:string;items:{page:Page;label:string;icon:LucideIcon}[]}[] = [
  {group:'WORKSPACE',items:[
    {page:'dashboard',label:'Dashboard',icon:LayoutDashboard},{page:'inbox',label:'Inbox',icon:Inbox},
    {page:'sent',label:'Sent Faxes',icon:Send},{page:'compose',label:'New Fax',icon:FilePlus2},
    {page:'contacts',label:'Contacts',icon:BookUser},{page:'documents',label:'Documents',icon:FolderOpen}]},
  {group:'MANAGEMENT',items:[
    {page:'numbers',label:'Fax Numbers',icon:Phone},{page:'team',label:'Team Members',icon:Users},
    {page:'reports',label:'Activity & Reports',icon:Activity}]},
  {group:'SYSTEM',items:[
    {page:'server',label:'Fax Server',icon:Server},{page:'sip',label:'SIP & T.38',icon:Wifi},
    {page:'queue',label:'Job Queue',icon:Clock3},{page:'security',label:'Security',icon:ShieldCheck},
    {page:'settings',label:'Settings',icon:Settings2}]}
];
const titleFor = (p: Page) => p==='viewer' ? 'Document Viewer' : sections.flatMap(s=>s.items).find(s=>s.page===p)?.label || 'FaxHub';
const statusClass = (status:FaxStatus) => 'status status-' + status;
const prettyStatus = (s:FaxStatus) => s[0].toUpperCase()+s.substring(1);
const demoBars = [30,43,37,52,44,65,51,72,58,79,64,89,76,67,81,59,85,70,90,76,94,82,73,88,70,91,84,69];
function IconBadge({icon:Icon,kind='blue'}:{icon:LucideIcon;kind?:string}) {return <span className={'icon-badge badge-'+kind}><Icon size={18}/></span>;}
function Status({value}:{value:FaxStatus}) {return <span className={statusClass(value)}><span className="status-dot"/>{prettyStatus(value)}</span>;}
function Panel({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}) {return <section className="panel"><div className="panel-header"><h3>{title}</h3>{action}</div>{children}</section>;}
function Empty({label}:{label:string}) {return <div className="empty"><FileText size={30}/><strong>Nothing here yet</strong><span>{label}</span></div>;}
const localKey='faxingpro-atlas-drafts-v1';
function loadDrafts():Fax[] {try {const v=JSON.parse(localStorage.getItem(localKey)||'[]') as Fax[];return Array.isArray(v)?v:[];} catch {return [];}}
function serverToFax(s:ServerFax):Fax{
  const status:FaxStatus=s.status==='delivered'?'sent':s.status==='received'?'received':
    s.status==='failed'?'failed':'queued';
  return {id:s.id,title:s.title||s.filename||'Fax',contact:s.direction==='inbound'?s.from:s.to,
    number:s.direction==='inbound'?s.from:s.to,pages:s.pages||0,status,direction:s.direction,
    createdAt:new Date(s.createdAt).toLocaleString(),source:'live'};
}
function formatNow(){return new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
function readBase64(file:File):Promise<string> {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Unable to read file'));reader.readAsDataURL(file);});}

export default function App(){
  const [page,setPage]=useState<Page>('dashboard');
  const [mobileNav,setMobileNav]=useState(false);
  const [drafts,setDrafts]=useState<Fax[]>(loadDrafts);
  const [activeFax,setActiveFax]=useState<Fax>(demoFaxes[0]);
  const [filter,setFilter]=useState('');
  const [toast,setToast]=useState('');
  const [recipient,setRecipient]=useState('');
  const [subject,setSubject]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [fileUrl,setFileUrl]=useState<string|null>(null);
  const [cover,setCover]=useState('Professional cover');
  const [apiEndpoint,setApiEndpoint]=useState('');
  const [apiToken,setApiToken]=useState('');
  const [health,setHealth]=useState<Health|null>(null);
  const [liveFaxes,setLiveFaxes]=useState<Fax[]|null>(null);
  const [stats,setStats]=useState<FaxStats|null>(null);
  const [refreshing,setRefreshing]=useState(false);
  const [testing,setTesting]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [folder,setFolder]=useState('All inbox');
  const [viewTab,setViewTab]=useState('Details');
  const [settingsTab,setSettingsTab]=useState('General');
  const faxes=useMemo(()=>liveFaxes===null?[...drafts,...demoFaxes]:liveFaxes,
    [drafts,liveFaxes]);
  const current=useMemo(()=>faxes.filter(f=>{
    if(page==='inbox' && f.direction!=='inbound')return false;
    if(page==='sent' && f.direction!=='outbound')return false;
    if(page==='documents' && f.status==='draft')return false;
    if(page==='queue' && f.status!=='queued' && f.status!=='failed')return false;
    if(folder==='Unread' && page==='inbox' && !f.unread)return false;
    if(folder==='Drafts' && page==='sent' && f.status!=='draft')return false;
    return (f.title+' '+f.contact+' '+f.number+' '+f.id).toLowerCase().includes(filter.toLowerCase());
  }),[faxes,page,filter,folder]);
  useEffect(()=>{localStorage.setItem(localKey,JSON.stringify(drafts));},[drafts]);
  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(''),4500);return ()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(!file){setFileUrl(null);return;}const url=URL.createObjectURL(file);setFileUrl(url);return ()=>URL.revokeObjectURL(url);},[file]);
  async function refreshLive(endpoint=apiEndpoint,token=apiToken){
    if(!endpoint.trim()||!token.trim())return;
    setRefreshing(true);
    try{
      const [items,counters]=await Promise.all([listFaxes(endpoint,token),getStats(endpoint,token)]);
      setLiveFaxes(items.map(serverToFax));setStats(counters);
    }catch(error){setToast(error instanceof Error?error.message:'Unable to retrieve live faxes');}
    finally{setRefreshing(false);}
  }
  async function downloadCurrent(){
    if(activeFax.source!=='live'||!apiToken){setToast('Only live records with stored PDFs can be downloaded.');return;}
    try{
      const file=await downloadFax(apiEndpoint,apiToken,activeFax.id);
      const url=URL.createObjectURL(file),a=document.createElement('a');
      a.href=url;a.download=(activeFax.title||'fax').replace(/[^a-z0-9._-]/gi,'_')+'.pdf';a.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){setToast(error instanceof Error?error.message:'Unable to download fax');}
  }
  function navigate(p:Page){setPage(p);setMobileNav(false);setFilter('');setFolder('All inbox');}
  function openFax(f:Fax){setActiveFax(f);setViewTab('Details');navigate('viewer');}
  function saveDraft(){
    if(!recipient.trim() && !file) {setToast('Add a recipient or document before saving.');return;}
    const fax:Fax={id:'DRAFT-'+Date.now(),title:file?.name||subject||'Untitled draft',contact:recipient||'No recipient',number:recipient||'Not set',pages:1,status:'draft',direction:'outbound',createdAt:formatNow(),source:'local'};
    setDrafts(d=>[fax,...d]);setToast('Draft saved locally. Attached file bytes are not persisted in demo mode.');navigate('sent');
  }
  async function testConnection(){
    if(!apiEndpoint.trim()){setToast('Enter an API server URL first.');return;}
    setTesting(true);try{const res=await checkApi(apiEndpoint);setHealth(res);
      if(apiToken.trim()){
        try{const [items,counters]=await Promise.all([listFaxes(apiEndpoint,apiToken),getStats(apiEndpoint,apiToken)]);
          setLiveFaxes(items.map(serverToFax));setStats(counters);}
        catch(error){setHealth(null);setLiveFaxes(null);setStats(null);throw error;}
      }else{setToast('Server online. Enter the operator API token to load real fax records.');return;}
      setToast(res.faxEnabled?'Connected to Telnyx Fax API. Outbound pilot enabled.':'Connected to live records; outbound fax sending is locked.');}catch(e){setHealth(null);setLiveFaxes(null);setStats(null);setToast(e instanceof Error?e.message:'Could not connect to API');}finally{setTesting(false);}
  }
  async function sendFax(){
    if(!recipient.trim()||!file){setToast('A recipient and PDF document are required.');return;}
    if(!health?.faxEnabled || !apiEndpoint.trim() || liveFaxes===null){setToast('Fax transport is not configured. Save a local draft instead.');return;}
    if(!apiToken){setToast('Enter your server API token in Settings.');return;}
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
  const table = (items:Fax[],showCheckbox=true)=><div className="table-scroll"><table className="fax-table"><thead><tr>{showCheckbox&&<th className="check-col"><input aria-label="Select all" type="checkbox" disabled/></th>}<th>Document / Contact</th><th>Fax number</th><th>Status</th><th>Pages</th><th>Date</th><th></th></tr></thead><tbody>{items.map(f=><tr key={f.id} onClick={()=>openFax(f)} className="click-row">{showCheckbox&&<td onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={'Select '+f.id} disabled/></td>}<td><div className="file-cell"><span className="pdf-icon"><FileText size={16}/></span><span><strong>{f.title}</strong><small>{f.contact}</small></span>{f.unread&&<span className="new-dot"/>}</div></td><td>{f.number}</td><td><Status value={f.status}/></td><td>{f.pages}</td><td>{f.createdAt}</td><td><ChevronRight size={17}/></td></tr>)}</tbody></table>{items.length===0&&<Empty label="Try a different search or folder."/>}</div>;
  return <div className="app-shell">
    <aside className={'sidebar '+(mobileNav?'sidebar-open':'')}>
      <div className="brand"><span className="brand-mark"><Printer size={22}/></span><div><strong>FaxingPro</strong><small>ATLAS WORKSPACE</small></div><button className="mobile-close" aria-label="Close menu" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace-switch"><span className="workspace-avatar">FP</span><div><strong>My Workspace</strong><small>{liveFaxes!==null?'Telnyx API connected':'Local preview'}</small></div><ChevronDown size={15}/></div>
      <div className="nav-groups">{sections.map(section=><div className="nav-group" key={section.group}><div className="nav-heading">{section.group}</div>{section.items.map(({page:p,label,icon:Icon})=><button key={p} className={'nav-item '+(page===p || (page==='viewer'&&p==='documents')?'nav-active':'')} onClick={()=>navigate(p)}><Icon size={18}/><span>{label}</span>{p==='inbox'&&<span className="nav-count">2</span>}</button>)}</div>)}</div>
      <div className="sidebar-bottom"><div className="support"><LifeBuoy size={17}/><span>Help & Support</span><ArrowUpRight size={14}/></div><div className="profile"><span className="profile-avatar">FP</span><div><strong>Local Operator</strong><small>Workspace administrator</small></div><MoreHorizontal size={17}/></div></div>
    </aside>
    {mobileNav&&<button className="nav-backdrop" aria-label="Close sidebar" onClick={()=>setMobileNav(false)}/>}
    <div className="main-area">
      <header className="topbar"><div className="top-left"><button className="mobile-menu icon-btn" aria-label="Open navigation" onClick={()=>setMobileNav(true)}><Menu size={20}/></button><div className="breadcrumbs">Workspace <ChevronRight size={14}/> <strong>{titleFor(page)}</strong></div></div><div className="top-right"><span className="demo-pill"><span className="pulse-dot"/> {liveFaxes!==null?'LIVE RECORDS':'DEMO DATA'}</span><button className="top-search" onClick={()=>navigate('documents')}><Search size={16}/> Search faxes & documents <span>⌘ K</span></button><button className="icon-btn" aria-label="Help" onClick={()=>setToast('FaxingPro v0.1 — UI preview and gateway starter.')}><CircleHelp size={18}/></button><button className="icon-btn" aria-label="Notifications" onClick={()=>setToast('There are no real notifications in preview mode.')}><Bell size={18}/></button><span className="top-avatar">FP</span></div></header>
      <main className="content">
      {page==='dashboard'&&<>
        <div className="page-heading"><div><span className="eyebrow">{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).toUpperCase()}</span><h1>Good morning <span className="wave">✳</span></h1><p>Here's what's happening across your fax workspace.</p></div><button className="btn primary" onClick={()=>navigate('compose')}><Plus size={18}/> New Fax</button></div>
        <div className="notice"><ShieldCheck size={19}/><div><strong>{liveFaxes!==null?'Live Telnyx records':'ATLAS preview environment'}</strong><span>{liveFaxes!==null?'These are persisted fax records from your private VPS. Delivery is confirmed only by Telnyx.':'All statistics and received/sent examples are illustrative. No fax has been sent or received.'}</span></div><button onClick={()=>navigate('settings')}>Configure server <ArrowRight size={15}/></button></div>
        <div className="kpi-grid">{[
          {label:'Received Faxes',num:String(stats?.received??128),delta:stats?'Actual records':'+12.5%',icon:ArrowDownLeft,kind:'green'},
          {label:'Sent Faxes',num:String(stats?.sent??342),delta:stats?'Confirmed deliveries':'+8.2%',icon:ArrowUpRight,kind:'blue'},
          {label:'Pending',num:String(stats?.pending??4),delta:'Queue',icon:Clock3,kind:'amber'},
          {label:'Failed',num:String(stats?.failed??2),delta:'Attention',icon:AlertTriangle,kind:'red'}].map(k=><div className="kpi-card" key={k.label}><div className="kpi-head"><IconBadge icon={k.icon} kind={k.kind}/><MoreHorizontal size={20}/></div><div className="kpi-value">{k.num}</div><div className="kpi-bottom"><span>{k.label}</span><small>{k.delta}</small></div></div>)}</div>
        <div className="dashboard-row">
          <Panel title="Fax Activity" action={<button className="subtle-btn" onClick={()=>navigate('reports')}>Last 30 days <ChevronDown size={15}/></button>}>{liveFaxes!==null?<div className="notice inner"><Activity size={18}/><div><strong>Activity data</strong><span>Real transmission counts are shown above. Historical graphing is not yet available.</span></div></div>:<><div className="chart-legend"><span><i className="legend-in"/> Received</span><span><i className="legend-out"/> Sent</span></div><div className="chart-wrap"><div className="chart-grid">{[80,60,40,20,0].map(n=><span key={n}>{n}</span>)}</div><div className="bar-chart">{demoBars.map((n,i)=><div key={i} className="bar-pair"><span className="bar in" style={{height:n+'%'}}/><span className="bar out" style={{height:Math.max(12,Math.round(n*(i%3===0?.58:.77)))+'%'}}/></div>)}</div></div><div className="axis"><span>Oct 1</span><span>Oct 8</span><span>Oct 15</span><span>Oct 22</span><span>Oct 30</span></div></>}</Panel>
          <Panel title="Quick Actions"><div className="actions-list">{[
            {icon:Send,title:'Send a fax',sub:'Send a document securely',page:'compose' as Page},
            {icon:Inbox,title:'View inbox',sub:'Review incoming documents',page:'inbox' as Page},
            {icon:BookUser,title:'Manage contacts',sub:'Your fax address book',page:'contacts' as Page},
            {icon:Settings2,title:'Configure server',sub:'Connect your self-hosted API',page:'settings' as Page}
            ].map(x=><button className="action-row" key={x.title} onClick={()=>navigate(x.page)}><IconBadge icon={x.icon}/><span><strong>{x.title}</strong><small>{x.sub}</small></span><ChevronRight size={18}/></button>)}</div></Panel>
        </div>
        <Panel title="Recent Transmissions" action={<button className="link-btn" onClick={()=>navigate('documents')}>View all <ArrowRight size={15}/></button>}>{table(faxes.slice(0,5),false)}</Panel>
      </>}
      {(page==='inbox'||page==='sent'||page==='documents'||page==='queue')&&<>
        <div className="page-heading"><div><span className="eyebrow">FAX MANAGEMENT</span><h1>{titleFor(page)}</h1><p>{page==='inbox'?'Manage your incoming fax documents.':page==='sent'?'Track outgoing faxes and draft documents.':page==='queue'?'Monitor transmissions that need processing or attention.':'Your searchable document activity.'}</p></div><button className="btn primary" onClick={()=>navigate('compose')}><Plus size={18}/> New Fax</button></div>
        <div className="content-panel">
          <div className="table-toolbar"><div className="tabs">{(page==='inbox'?['All inbox','Unread']:page==='sent'?['All inbox','Drafts']:['All inbox']).map(t=><button key={t} className={folder===t?'tab active-tab':'tab'} onClick={()=>setFolder(t)}>{t}{t==='Unread'&&<span>2</span>}</button>)}</div><div className="table-tools"><label className="search-box"><Search size={16}/><input placeholder="Search faxes..." value={filter} onChange={e=>setFilter(e.target.value)}/></label><button className="subtle-btn" onClick={()=>setToast('Search by document name, number, ID, or contact.')}><Filter size={16}/> Filters</button></div></div>
          {table(current)}
          <div className="table-footer"><span>Showing {current.length} records · {liveFaxes!==null?'Live VPS data':'Demo records are illustrative'}</span><div>{liveFaxes!==null&&<button className="subtle-btn" onClick={()=>refreshLive()} disabled={refreshing}><RefreshCw size={15}/>{refreshing?'Refreshing':'Refresh'}</button>}<button disabled><ChevronLeft size={17}/></button><strong>1</strong><button disabled><ChevronRight size={17}/></button></div></div>
        </div>
      </>}
      {page==='compose'&&<>
        <div className="page-heading"><div><span className="eyebrow">OUTGOING FAX</span><h1>Compose a new fax</h1><p>Prepare documents for secure delivery to a fax number.</p></div><button className="btn ghost" onClick={()=>navigate('sent')}><ArrowLeft size={17}/> Back to sent</button></div>
        <div className="compose-grid"><div className="compose-primary">
          <section className="panel form-panel"><div className="panel-header"><h3><span className="step-num">1</span> Recipient details</h3></div><div className="fields"><label>Recipient fax number <span>*</span><input value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="+1 (555) 000-0000" inputMode="tel"/></label><label>Subject <span className="optional">Optional</span><input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="e.g. Signed service agreement"/></label></div></section>
          <section className="panel form-panel"><div className="panel-header"><h3><span className="step-num">2</span> Attach documents</h3><span className="muted-label">PDF only · 10 MB max</span></div><div className="upload-zone"><UploadCloud size={28}/><strong>{file?file.name:'Drag a PDF here or choose a file'}</strong><span>{file?'Ready for preview. File is not uploaded until submitted.':'Attach one PDF file to your outgoing fax.'}</span><label className="btn secondary file-label">Browse files<input type="file" accept="application/pdf,.pdf" onChange={handleFile}/></label></div>{file&&<div className="attached"><FileText size={19}/><span>{file.name}<small>{(file.size/1024).toFixed(0)} KB</small></span><button className="icon-btn" aria-label="Remove file" onClick={()=>setFile(null)}><X size={17}/></button></div>}</section>
          <section className="panel form-panel"><div className="panel-header"><h3><span className="step-num">3</span> Delivery options</h3></div><div className="fields two-col"><label>Cover sheet<select value={cover} onChange={e=>setCover(e.target.value)}><option>Professional cover</option><option>No cover sheet</option><option>Simple cover</option></select></label><label>Delivery time<select disabled><option>Send immediately</option></select></label></div><p className="field-help">Cover sheet generation and scheduled sends are planned for the live transport integration.</p></section>
          <div className="compose-actions"><button className="btn secondary" onClick={saveDraft}>Save local draft</button><button className="btn primary" disabled={submitting||!health?.faxEnabled} onClick={sendFax}>{submitting?<RefreshCw size={17}/>:<Send size={17}/>} {submitting?'Submitting...':'Queue Fax'}</button></div>
          {!health?.faxEnabled&&<div className="transport-warning"><AlertTriangle size={18}/> Real sending is disabled until a self-hosted fax transport is connected. <button onClick={()=>navigate('settings')}>Server settings</button></div>}
        </div><div className="compose-aside"><Panel title="Document preview"><div className="preview-window">{fileUrl?<iframe className="file-preview" title="Selected PDF preview" src={fileUrl}/>:<div className="paper-preview"><div className="paper-brand">FAXINGPRO <span>ATLAS</span></div><div className="paper-title">Fax Cover Sheet</div><div className="paper-line"/><div className="paper-row"><strong>TO</strong><span>{recipient||'Recipient fax number'}</span></div><div className="paper-row"><strong>SUBJECT</strong><span>{subject||'Document subject'}</span></div><div className="paper-line"/><p>This is a visual example, not a generated fax cover.</p><div className="paper-filler"/></div>}</div><div className="preview-foot"><Eye size={16}/> {file?'Local PDF preview':'Illustrative cover sheet'}</div></Panel><div className="side-info"><LockKeyhole size={19}/><div><strong>Private workspace</strong><p>Documents stay local in preview mode. A live connection requires your own server and credentials.</p></div></div></div></div>
      </>}
      {page==='viewer'&&<>
        <div className="page-heading compact"><div><button className="back-link" onClick={()=>navigate('documents')}><ArrowLeft size={16}/> Back to documents</button><h1>{activeFax.title}</h1><p>{activeFax.pages} pages · {activeFax.id} · {activeFax.createdAt}</p></div><div className="heading-actions"><Status value={activeFax.status}/><button className="btn secondary" onClick={downloadCurrent}><Download size={16}/> Download</button><button className="btn primary" onClick={()=>{setRecipient(activeFax.number);navigate('compose');}}><ArrowUpRight size={16}/> Forward</button></div></div>
        <div className="viewer-grid"><div className="viewer-area"><div className="viewer-tools"><span><FileText size={16}/> Document preview</span><div><button aria-label="Previous page" disabled><ChevronLeft size={17}/></button><span>1 / {activeFax.pages}</span><button aria-label="Next page" disabled><ChevronRight size={17}/></button><button aria-label="Download PDF" onClick={downloadCurrent}><Download size={17}/></button></div></div><div className="viewer-canvas"><div className="paper-page"><div className="document-top"><span>FAXINGPRO</span><small>DOCUMENT PREVIEW</small></div><div className="document-heading">{activeFax.source==='live'?'Stored fax document':'Preview unavailable'}</div><p>{activeFax.source==='live'?'Use Download PDF to retrieve your authenticated document from your VPS. Inline previews of private documents are not automatically loaded.':'This record is sample data used to demonstrate the ATLAS document viewer.'}</p><div className="sample-block"/><div className="sample-block short"/><div className="sample-block"/><div className="sample-block mid"/><div className="sample-line"/><p className="watermark">{activeFax.source==='live'?'PRIVATE DOCUMENT — DOWNLOAD TO VIEW':'ILLUSTRATIVE DOCUMENT — NOT A REAL FAX'}</p></div></div></div>
          <aside className="viewer-side"><div className="detail-tabs">{['Details','Activity'].map(t=><button key={t} className={viewTab===t?'current':''} onClick={()=>setViewTab(t)}>{t}</button>)}</div>{viewTab==='Details'?<div className="detail-body"><div className="detail-status"><Status value={activeFax.status}/><span>{activeFax.direction==='inbound'?'Incoming fax':'Outgoing fax'}</span></div>{[['Document',activeFax.title],['From / To',activeFax.contact],['Fax number',activeFax.number],['Pages',String(activeFax.pages)],['Received / Created',activeFax.createdAt],['Transmission ID',activeFax.id],['Source',activeFax.source==='demo'?'Illustrative sample':activeFax.source==='live'?'VPS / Telnyx':'Local draft']].map(([k,v])=><div className="detail-row" key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>:<div className="detail-body"><div className="timeline"><span/><div><strong>Sample record created</strong><small>{activeFax.createdAt}</small></div></div><p className="field-help">Live transmission event history will require server connectivity.</p></div>}<div className="viewer-side-actions"><button onClick={downloadCurrent}><Download size={16}/> Download PDF</button><button onClick={()=>{setRecipient(activeFax.number);navigate('compose');}}><ArrowUpRight size={16}/> Forward as fax</button><button onClick={()=>setToast('Demo records cannot be deleted.')}><Trash2 size={16}/> Delete</button></div></aside></div>
      </>}
      {page==='contacts'&&<>
        <div className="page-heading"><div><span className="eyebrow">DIRECTORY</span><h1>Contacts</h1><p>People and organizations you fax most often.</p></div><button className="btn primary" onClick={()=>setToast('Contact editing is planned for the next milestone.')}><Plus size={17}/> Add Contact</button></div>
        <Panel title="Contact directory" action={<span className="muted-label">Illustrative contacts</span>}><div className="contact-list">{contacts.map(c=><div className="contact-row" key={c.name}><div className="contact-avatar">{c.initials}</div><div><strong>{c.name}</strong><small>{c.company}</small></div><span>{c.number}</span><button className="btn secondary small" onClick={()=>{setRecipient(c.number);navigate('compose');}}><Send size={15}/> Fax</button></div>)}</div></Panel>
      </>}
      {page==='numbers'&&<>
        <div className="page-heading"><div><span className="eyebrow">PHONE SERVICES</span><h1>Fax Numbers</h1><p>Assign inbound numbers and control routing.</p></div><button className="btn primary" onClick={()=>setToast('Numbers must be purchased or ported through a SIP provider.')}><Plus size={17}/> Add number</button></div>
        <div className="notice"><Phone size={19}/><div><strong>No real phone numbers configured</strong><span>The rows below are examples. Connect your SIP provider before accepting incoming calls.</span></div></div><Panel title="Number inventory"><div className="table-scroll"><table className="fax-table"><thead><tr><th>Number</th><th>Label</th><th>Routing</th><th>Status</th></tr></thead><tbody>{[['+1 (555) 100-1234','Main Office','General Inbox'],['+1 (555) 100-0678','Support','Support Inbox'],['+1 (555) 100-9012','Billing','Billing Inbox']].map(([n,l,r])=><tr key={n}><td>{n}</td><td>{l}</td><td>{r}</td><td><span className="status">Example only</span></td></tr>)}</tbody></table></div></Panel>
      </>}
      {page==='reports'&&<><div className="page-heading"><div><span className="eyebrow">INSIGHTS</span><h1>Activity & Reports</h1><p>Reporting will reflect live fax events after a server is connected.</p></div></div><div className="notice"><Activity size={19}/><div><strong>Illustrative reporting</strong><span>Metrics on this page are demonstration data and should not be used as transmission evidence.</span></div></div><div className="kpi-grid">{[['Successful deliveries','342'],['Incoming pages','128'],['Delivery rate','99.2%'],['Avg. duration','1m 34s']].map(([label,value])=><div className="kpi-card" key={label}><span className="eyebrow">{label}</span><div className="kpi-value">{value}</div></div>)}</div><Panel title="Sample activity log">{table(faxes.slice(0,6),false)}</Panel></>}
      {page==='team'&&<><div className="page-heading"><div><span className="eyebrow">ACCESS MANAGEMENT</span><h1>Team Members</h1><p>Manage team roles and workspace permissions.</p></div><button className="btn primary" onClick={()=>setToast('Team invitations are not available in the current demo.')}><Users size={16}/> Invite member</button></div><Panel title="Workspace access"><div className="settings-card"><Users size={22}/><div><strong>Local operator</strong><p>Administrator · Preview session</p></div><span className="status status-received">Active</span></div></Panel></>}
      {(page==='settings'||page==='server'||page==='sip'||page==='security')&&<>
        <div className="page-heading"><div><span className="eyebrow">SYSTEM ADMINISTRATION</span><h1>{titleFor(page)}</h1><p>Configure your self-hosted FaxingPro installation.</p></div></div>
        <div className="settings-layout"><div className="settings-menu">{[['General','settings'],['API Connection','settings'],['Server Health','server'],['SIP & T.38','sip'],['Security','security']].map(([name,target])=><button className={(page===target&&(page!=='settings'||settingsTab===name))?'selected':''} key={name} onClick={()=>{setPage(target as Page);setSettingsTab(name);}}>{name}<ChevronRight size={15}/></button>)}</div><div className="settings-content">
          {page==='settings'&&settingsTab==='General'&&<Panel title="Workspace preferences"><div className="settings-card"><Settings2 size={22}/><div><strong>ATLAS design system</strong><p>Premium enterprise layout, midnight navigation, and teal accents.</p></div><span className="status status-received">Enabled</span></div><div className="settings-card"><Cloud size={22}/><div><strong>Local preview mode</strong><p>Sample data is bundled with the desktop and web interface.</p></div><span className="status status-queued">Demo</span></div><div className="settings-card"><HardDrive size={22}/><div><strong>Draft persistence</strong><p>Only draft metadata is saved to local storage. Files are not persisted.</p></div></div></Panel>}
          {page==='settings'&&settingsTab==='API Connection'&&<Panel title="Connect your self-hosted server"><div className="settings-fields"><label>API base URL<input placeholder="https://fax.example.com" value={apiEndpoint} onChange={e=>{setApiEndpoint(e.target.value);setHealth(null);setLiveFaxes(null);setStats(null);}}/></label><label>API bearer token<input type="password" placeholder="Enter API_TOKEN from your server" value={apiToken} onChange={e=>setApiToken(e.target.value)}/></label><p>Credentials stay in memory, not local storage. Only connect to a private trusted HTTPS FaxingPro installation or local SSH tunnel. Never enter a live operator token on the public GitHub Pages demo.</p><button className="btn primary" disabled={testing} onClick={testConnection}><RefreshCw size={17}/>{testing?'Checking...':'Test connection'}</button>{health&&<div className="connection-result"><CheckCircle2 size={17}/> Connected: {health.service} · transport: {health.transport} · fax: {health.faxEnabled?'enabled':'disabled'}</div>}</div></Panel>}
          {page==='server'&&<Panel title="Server health"><div className="settings-card"><Server size={22}/><div><strong>FaxingPro API</strong><p>{health?health.service+' is responding':'Not connected. Configure your API connection in Settings.'}</p></div><span className={'status '+(health?'status-received':'status-queued')}>{health?'Online':'Unknown'}</span></div><div className="settings-card"><Cloud size={22}/><div><strong>Transmission provider</strong><p>{health?health.transport:'No FreeSWITCH transport configured'}</p></div></div><button className="btn secondary" onClick={()=>{setPage('settings');setSettingsTab('API Connection');}}>Configure connection <ArrowRight size={16}/></button></Panel>}
          {page==='sip'&&<Panel title="SIP trunk & fax transport"><div className="settings-card"><Phone size={22}/><div><strong>SIP trunk</strong><p>No provider credentials or DID numbers configured.</p></div><span className="status status-failed">Not configured</span></div><div className="settings-card"><Wifi size={22}/><div><strong>T.38 / G.711</strong><p>Requires FreeSWITCH + SpanDSP integration, NAT and RTP testing.</p></div></div><div className="notice inner"><AlertTriangle size={18}/><div><strong>Transmission is disabled by design</strong><span>Do not assume a fax is delivered until a real engine reports confirmation.</span></div></div></Panel>}
          {page==='security'&&<Panel title="Security posture"><div className="settings-card"><ShieldCheck size={22}/><div><strong>API token</strong><p>Server calls require an operator-generated secret.</p></div></div><div className="settings-card"><LockKeyhole size={22}/><div><strong>HTTPS</strong><p>Use a trusted reverse proxy; never expose the API token over HTTP.</p></div></div><div className="settings-card"><Archive size={22}/><div><strong>Encrypted storage & roles</strong><p>Planned for the production database and file storage milestone.</p></div></div></Panel>}
        </div></div>
      </>}
      <footer className="app-footer"><span>FaxingPro · ATLAS v0.2 · {liveFaxes!==null?'Live backend':'Preview build'}</span><span><span className="footer-dot"/> {liveFaxes!==null?(health?.faxEnabled?'Telnyx outbound pilot enabled':'Outbound sending locked'):'Demo data only'}</span></footer>
      </main>
    </div>
    {toast&&<div className="toast"><span>{toast}</span><button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={17}/></button></div>}
  </div>;
}
