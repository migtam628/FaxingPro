import { useState } from 'react';
import { ArrowRight, ArrowLeft, Check, CheckCircle2, CircleHelp, FileText,
  LockKeyhole, RefreshCw, ShieldCheck, Server, Settings2, Wifi, Printer,
  AlertTriangle } from 'lucide-react';
import type { SetupState } from './api';

type Props = {
  mode:'checking'|'signin'|'setup';
  endpoint:string; token:string; setToken:(value:string)=>void;
  setup:SetupState|null;
  working:boolean; error:string;
  onConnect:()=>Promise<void>;onReload:()=>Promise<void>;
  onFinish:(name:string,timezone:string)=>Promise<void>;
};
const timezones=[
  ['America/New_York','Eastern (New York / Miami)'],
  ['America/Chicago','Central (Chicago)'],
  ['America/Denver','Mountain (Denver)'],
  ['America/Los_Angeles','Pacific (Los Angeles)'],
  ['America/Phoenix','Arizona'],
  ['UTC','UTC']
] as const;
const steps=['Connect','Check gateway','Workspace'];
export default function SetupWizard({mode,endpoint,token,setToken,setup,working,error,
  onConnect,onReload,onFinish}:Props){
  const [step,setStep]=useState(0);
  const [workspaceName,setWorkspaceName]=useState<string|null>(null);
  const [timezone,setTimezone]=useState<string|null>(null);
  const name=workspaceName??setup?.workspaceName??'FaxingPro';
  const tz=timezone??setup?.timezone??'America/New_York';
  const checks=setup?.configured;
  const ready=!!checks&&Object.values(checks).every(Boolean);
  const supportsServer=!!endpoint;
  return <div className="setup-shell">
    <div className="setup-topbar"><div className="setup-logo"><span><Printer size={23}/></span>
      <div><strong>FaxingPro</strong><small>ATLAS · FIRST-RUN SETUP</small></div></div>
      <span className="setup-private"><ShieldCheck size={15}/> Private workspace</span></div>
    <main className="setup-body">
      <aside className="setup-intro">
        <div className="setup-eyebrow">SELF-HOSTED FAX WORKSPACE</div>
        <h1>Everything in place, from your first fax.</h1>
        <p>Connect your own server, verify your Telnyx gateway, and personalize your workspace.
        Your actual fax records appear after setup — never sample data.</p>
        <div className="setup-highlights">
          <div><LockKeyhole size={18}/><span>Secure 7-day operator session</span></div>
          <div><Wifi size={18}/><span>Telnyx fax transmission</span></div>
          <div><FileText size={18}/><span>Encrypted, private documents</span></div>
        </div>
        <div className="setup-footnote"><CircleHelp size={16}/> Existing faxes and database records are preserved.</div>
      </aside>
      <section className="setup-panel">
        <div className="setup-progress" aria-label="Setup progress">
          {steps.map((label,i)=><div key={label} className={'setup-progress-step '+
            ((mode==='setup' && (i<=step+1)) || (mode==='checking'&&i===0)|| (mode==='signin'&&i===0)?'selected':'')}>
            <span>{mode==='setup'&&i<step+1?<Check size={14}/>:i+1}</span>
            <small>{label}</small></div>)}
        </div>
        {mode==='checking'&&<div className="setup-stage">
          <div className="setup-icon"><RefreshCw size={27}/></div>
          <h2>Checking your workspace</h2>
          <p>Looking for an existing secure session and previously completed setup.</p>
          <div className="setup-loading" role="status">Connecting to your server…</div>
        </div>}
        {mode==='signin'&&<div className="setup-stage">
          <div className="setup-icon"><LockKeyhole size={27}/></div>
          <div className="setup-step-name">STEP 1 OF 3</div>
          <h2>Connect your FaxingPro server</h2>
          <p>Enter the operator token from your VPS once. We exchange it for a secure HttpOnly cookie and never save the token in browser storage.</p>
          {supportsServer?<form onSubmit={e=>{e.preventDefault();void onConnect();}} className="setup-form">
            <label>Server address<input type="url" readOnly value={endpoint}/></label>
            <label>Operator API token<input type="password" autoComplete="off" value={token}
              onChange={e=>setToken(e.target.value)} placeholder="Paste API_TOKEN from deployment/telnyx/.env" required/></label>
            <button className="btn primary setup-cta" disabled={working||!token.trim()} type="submit">
              {working?'Connecting…':'Connect securely'} <ArrowRight size={17}/></button>
          </form>:<div className="setup-warning"><AlertTriangle size={19}/><span>This static client has no backend on its current origin. Open your self-hosted FaxingPro HTTPS website to complete setup. The GitHub Pages site never accepts operator credentials.</span></div>}
          <p className="setup-hint">The operator token is <code>API_TOKEN</code>, not your Telnyx API key.</p>
        </div>}
        {mode==='setup'&&step===0&&<div className="setup-stage">
          <div className="setup-icon"><Server size={27}/></div>
          <div className="setup-step-name">STEP 2 OF 3</div>
          <h2>Verify your Telnyx gateway</h2>
          <p>These checks come from your live VPS configuration. Sensitive credentials are never displayed here.</p>
          <div className="setup-checks">
            {([
              ['Telnyx API key',checks?.apiKey],
              ['Fax application ID',checks?.faxApplication],
              ['Purchased fax number',checks?.phoneNumber],
              ['Webhook verification key',checks?.webhookPublicKey],
              ['Public HTTPS endpoint',checks?.httpsUrl]
            ] as const).map(([label,ok])=><div key={label} className="setup-check">
              {ok?<CheckCircle2 size={18} className="setup-ok"/>:<AlertTriangle size={18} className="setup-notready"/>}
              <span>{label}</span><small>{ok?'Configured':'Not configured'}</small>
            </div>)}
          </div>
          <div className="setup-server-info">
            <span>Fax number: <strong>{setup?.fromNumber||'Not configured'}</strong></span>
            <span>Webhook: <strong>{setup?.webhookUrl||'Not configured'}</strong></span>
            <span>Outbound: <strong>{setup?.outboundEnabled?'Enabled':'Disabled (safe for initial setup)'}</strong></span>
          </div>
          {!ready&&<div className="setup-warning"><AlertTriangle size={19}/><span>Complete missing values in your VPS <code>deployment/telnyx/.env</code>, recreate the API service, then select Recheck. Your existing fax data is safe.</span></div>}
          <div className="setup-actions">
            <button className="btn secondary" disabled={working} onClick={()=>void onReload()}><RefreshCw size={16}/> Recheck</button>
            <button className="btn primary" disabled={!ready||working} onClick={()=>setStep(1)}>Continue <ArrowRight size={16}/></button>
          </div>
        </div>}
        {mode==='setup'&&step===1&&<div className="setup-stage">
          <div className="setup-icon"><Settings2 size={27}/></div>
          <div className="setup-step-name">STEP 3 OF 3</div>
          <h2>Personalize your workspace</h2>
          <p>Set your workspace name and preferred timezone. These preferences are saved in your private PostgreSQL database.</p>
          <form className="setup-form" onSubmit={e=>{e.preventDefault();void onFinish(name,tz);}}>
            <label>Workspace name<input maxLength={80} minLength={2} required value={name}
              onChange={e=>setWorkspaceName(e.target.value)} placeholder="FaxingPro"/></label>
            <label>Timezone<select value={tz} onChange={e=>setTimezone(e.target.value)}>
              {timezones.map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select></label>
            <div className="setup-review"><CheckCircle2 size={18}/> Your existing fax history will appear in the dashboard immediately after setup.</div>
            <div className="setup-actions">
              <button type="button" className="btn secondary" onClick={()=>setStep(0)}><ArrowLeft size={16}/> Back</button>
              <button type="submit" className="btn primary" disabled={working||name.trim().length<2}> {working?'Saving…':'Finish setup'} <ArrowRight size={17}/></button>
            </div>
          </form>
        </div>}
        {error&&<div className="setup-error" role="alert"><AlertTriangle size={17}/>{error}</div>}
      </section>
    </main>
    <footer className="setup-footer">FaxingPro ATLAS · Self-hosted · No sample records</footer>
  </div>;
}
