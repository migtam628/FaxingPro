import {useEffect,useState} from 'react';
import {UserPlus,ShieldCheck,RefreshCw,AlertTriangle,Users,LockKeyhole} from 'lucide-react';
import {listTeamMembers,createTeamMember,updateTeamMember,type TeamMember} from './api';

type Props={endpoint:string;administrator:boolean;currentUserId:string|null};
export default function TeamMembers({endpoint,administrator,currentUserId}:Props){
  const [items,setItems]=useState<TeamMember[]>([]);
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [role,setRole]=useState<TeamMember['role']>('viewer');
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [oneTime,setOneTime]=useState<{email:string;password:string;totpSecret:string}|null>(null);
  async function refresh(){
    if(!administrator)return;
    setWorking(true);setError('');
    try{setItems((await listTeamMembers(endpoint)).items);}
    catch(e){setError(e instanceof Error?e.message:'Unable to retrieve team members');}
    finally{setWorking(false);}
  }
  useEffect(()=>{void refresh();},[endpoint,administrator]);
  async function create(e:React.FormEvent){
    e.preventDefault();setWorking(true);setError('');setMessage('');
    try{
      const result=await createTeamMember(endpoint,{name,email,role});
      setOneTime({email:result.user.email,...result.credentials});
      setName('');setEmail('');setRole('viewer');
      setItems((prev)=>[result.user,...prev]);
      setMessage('Member created. Deliver the credentials securely outside FaxingPro.');
    }catch(e){setError(e instanceof Error?e.message:'Member creation failed');}
    finally{setWorking(false);}
  }
  async function change(member:TeamMember,update:{role:TeamMember['role']}|{disabled:boolean}){
    if(!window.confirm('Change access for '+member.email+'? Account access updates apply immediately.'))return;
    setWorking(true);setError('');setOneTime(null);
    try{
      const next=await updateTeamMember(endpoint,member.id,update);
      setItems(old=>old.map(x=>x.id===member.id?{...x,...next}:x));
      setMessage('Team access updated.');
    }catch(e){setError(e instanceof Error?e.message:'Unable to update member');}
    finally{setWorking(false);}
  }
  return <div>
    <div className="page-heading"><div><span className="eyebrow">ACCESS MANAGEMENT</span>
      <h1>Team Members</h1>
      <p>Individual accounts with encrypted authenticator secrets and permissions enforced by the server.</p>
    </div></div>
    {!administrator?<div className="panel"><div className="settings-card"><LockKeyhole size={22}/>
      <div><strong>Administrator access required</strong>
        <p>Only an owner or administrator can manage team accounts.</p></div></div></div>
    :<>
      <section className="panel"><div className="panel-header"><h3><UserPlus size={17}/> Create named account</h3></div>
        <form className="setup-form" onSubmit={e=>void create(e)}>
          <label>Display name<input required minLength={2} maxLength={80} value={name}
            onChange={e=>setName(e.target.value)} placeholder="Full name"/></label>
          <label>Work email<input required type="email" maxLength={254} value={email}
            onChange={e=>setEmail(e.target.value)} placeholder="person@example.com"/></label>
          <label>Role<select value={role} onChange={e=>setRole(e.target.value as TeamMember['role'])}>
            <option value="viewer">Viewer — read faxes and documents</option>
            <option value="operator">Operator — manage faxes and contacts</option>
            <option value="admin">Administrator — account and security management</option>
          </select></label>
          <button type="submit" className="btn primary" disabled={working}><UserPlus size={16}/> Create account</button>
        </form>
      </section>
      {oneTime&&<section className="panel"><div className="panel-header"><h3><LockKeyhole size={17}/> One-time enrollment credentials</h3></div>
        <div className="transport-warning"><AlertTriangle size={18}/>
          These values are shown only now. Deliver through a secure channel. Never paste into chat, email threads or issue trackers.</div>
        <div className="settings-card"><div><strong>Email</strong><p>{oneTime.email}</p>
          <strong>Temporary password</strong><p><code>{oneTime.password}</code></p>
          <strong>Authenticator Base32 key</strong><p><code>{oneTime.totpSecret}</code></p>
          <p>Enroll using TOTP SHA-1, six digits, 30-second interval. The recipient must keep both private.</p>
        </div></div>
        <button className="btn secondary" onClick={()=>setOneTime(null)}>I securely saved these credentials</button>
      </section>}
      <section className="panel"><div className="panel-header"><h3><Users size={18}/> Named accounts</h3>
        <button className="btn secondary" onClick={()=>void refresh()} disabled={working}><RefreshCw size={15}/> Refresh</button></div>
        {items.length===0?<div className="empty">No named team accounts yet.</div>:items.map(member=>
          <div className="settings-card" key={member.id}><ShieldCheck size={22}/><div>
            <strong>{member.name}</strong><p>{member.email}</p><p>{member.disabledAt?'Disabled':'Active'} · {member.role}</p>
          </div>
          <select aria-label={'Role for '+member.email} disabled={working||currentUserId===member.id}
            value={member.role} onChange={e=>void change(member,{role:e.target.value as TeamMember['role']})}>
            <option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option>
          </select>
          <button className="btn secondary" disabled={working||currentUserId===member.id}
            onClick={()=>void change(member,{disabled:!member.disabledAt})}>
              {member.disabledAt?'Enable':'Disable'}
          </button></div>)}
      </section>
    </>}
    {message&&<p role="status">{message}</p>}
    {error&&<div className="transport-warning" role="alert"><AlertTriangle size={18}/>{error}</div>}
  </div>;
}
