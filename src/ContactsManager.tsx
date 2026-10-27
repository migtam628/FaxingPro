import {useCallback,useEffect,useMemo,useState} from 'react';
import {BookUser,Search,Plus,Save,Trash2,X,RefreshCw,Pencil,Send} from 'lucide-react';
import {createContact,deleteContact,getContacts,updateContact,type FaxContact,type ContactInput} from './api';

const empty:ContactInput={name:'',number:'',email:'',company:'',notes:''};
export default function ContactsManager({endpoint,onFax}:{endpoint:string;onFax:(number:string)=>void}){
  const [items,setItems]=useState<FaxContact[]>([]);
  const [query,setQuery]=useState('');
  const [editing,setEditing]=useState<string|null>(null);
  const [form,setForm]=useState<ContactInput>(empty);
  const [opened,setOpened]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const load=useCallback(async()=>{
    setLoading(true);
    try{setItems(await getContacts(endpoint));setError('');}
    catch(e){setError(e instanceof Error?e.message:'Unable to retrieve contacts');}
    finally{setLoading(false);}
  },[endpoint]);
  useEffect(()=>{void load();},[load]);
  const filtered=useMemo(()=>items.filter(c=>
    [c.name,c.number,c.email,c.company].join(' ').toLowerCase().includes(query.toLowerCase().trim())),[items,query]);
  function startEdit(contact?:FaxContact){
    setForm(contact?{name:contact.name,number:contact.number,email:contact.email,company:contact.company,notes:contact.notes}:empty);
    setEditing(contact?.id||null);setOpened(true);setError('');setNotice('');
  }
  async function save(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const saved=editing?await updateContact(endpoint,editing,form):await createContact(endpoint,form);
      setItems(prev=>[...prev.filter(x=>x.id!==saved.id),saved].sort((a,b)=>a.name.localeCompare(b.name)));
      setOpened(false);setEditing(null);setForm(empty);setNotice(editing?'Contact updated':'Contact saved');
    }catch(err){setError(err instanceof Error?err.message:'Unable to save contact');}
    finally{setBusy(false);}
  }
  async function remove(c:FaxContact){
    if(!window.confirm('Delete contact '+c.name+'? Existing fax records will be preserved.'))return;
    setBusy(true);setError('');setNotice('');
    try{await deleteContact(endpoint,c.id);setItems(prev=>prev.filter(x=>x.id!==c.id));
      if(editing===c.id){setOpened(false);setEditing(null);}setNotice('Contact deleted. Fax history was not changed.');
    }catch(err){setError(err instanceof Error?err.message:'Unable to delete contact');}
    finally{setBusy(false);}
  }
  return <div className="contact-workspace">
    <div className="page-heading"><div><span className="eyebrow">WORKSPACE DIRECTORY</span><h1>Fax contacts</h1>
      <p>Private, searchable fax directory stored in PostgreSQL. Existing fax records are never modified when contacts change.</p>
      </div><button className="btn primary" onClick={()=>startEdit()}><Plus size={17}/> Add contact</button></div>
    <div className="content-panel">
      <div className="table-toolbar"><div className="tabs"><span className="tab active-tab">All contacts ({items.length})</span></div>
        <div className="table-tools"><label className="search-box"><Search size={16}/>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a name, fax number or company"/></label>
        <button className="subtle-btn" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/> Refresh</button></div></div>
      {error&&<p className="contact-alert" role="alert">{error}</p>}
      {notice&&<p className="contact-notice" role="status">{notice}</p>}
      {loading?<div className="contact-empty">Loading contacts…</div>:filtered.length===0?
        <div className="contact-empty"><BookUser size={32}/><strong>{items.length?'No matching contacts':'Your address book is empty'}</strong>
          <p>{items.length?'Try another search':'Create your first contact using a verified fax number.'}</p></div>:
        <div className="table-scroll"><table className="fax-table"><thead><tr><th>Name</th><th>Company</th><th>Fax number</th><th>Email</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map(c=><tr key={c.id}><td><strong>{c.name}</strong></td><td>{c.company||'—'}</td>
        <td>{c.number}</td><td>{c.email||'—'}</td><td>
          <div className="contact-actions">
            <button className="icon-btn" title="Compose fax" aria-label={'Fax '+c.name} onClick={()=>onFax(c.number)}><Send size={17}/></button>
            <button className="icon-btn" title="Edit contact" aria-label={'Edit '+c.name} onClick={()=>startEdit(c)}><Pencil size={17}/></button>
            <button className="icon-btn" title="Delete contact" aria-label={'Delete '+c.name} disabled={busy} onClick={()=>void remove(c)}><Trash2 size={17}/></button>
          </div></td></tr>)}</tbody></table></div>}
    </div>
    {opened&&<section className="contact-editor panel"><div className="panel-header">
      <h3>{editing?'Edit contact':'New fax contact'}</h3>
      <button className="icon-btn" aria-label="Close editor" onClick={()=>{setOpened(false);setError('');}}><X size={18}/></button></div>
      <form onSubmit={e=>void save(e)} className="contact-form">
        <label>Name <span>*</span><input required minLength={2} maxLength={100} value={form.name}
          onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Contact or business name"/></label>
        <label>Fax number (E.164) <span>*</span><input required type="tel" value={form.number}
          onChange={e=>setForm(p=>({...p,number:e.target.value}))} placeholder="+13055550123"/></label>
        <label>Company<input maxLength={120} value={form.company}
          onChange={e=>setForm(p=>({...p,company:e.target.value}))}/></label>
        <label>Email<input type="email" maxLength={200} value={form.email}
          onChange={e=>setForm(p=>({...p,email:e.target.value}))}/></label>
        <label className="contact-wide">Notes<textarea maxLength={1000} rows={3} value={form.notes}
          onChange={e=>setForm(p=>({...p,notes:e.target.value}))}/></label>
        <div className="contact-wide contact-form-actions">
          <button className="btn secondary" type="button" onClick={()=>setOpened(false)}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}><Save size={16}/>{busy?'Saving...':'Save contact'}</button>
        </div>
      </form><p className="field-help">Saving a contact does not authorize outgoing transmission. The VPS TEST_DESTINATION safety restriction still applies.</p>
    </section>}
  </div>;
}
