import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, ShieldCheck } from 'lucide-react';
import { getRetentionPreview, type RetentionImpactPreview } from './api';

const windows=[30,90,180,365,730,1825];

export default function RetentionPreview({endpoint}:{endpoint:string}){
  const [days,setDays]=useState(365);
  const [preview,setPreview]=useState<RetentionImpactPreview|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setPreview(null);setError('');
    getRetentionPreview(endpoint,days).then(result=>{
      if(!cancelled)setPreview(result);
    }).catch(err=>{
      if(!cancelled)setError(err instanceof Error?err.message:'Unable to preview retention impact');
    }).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[endpoint,days]);

  return <section className="backup-history" aria-label="Retention impact preview">
    <h3>Retention impact preview · read-only</h3>
    <p>Review record age before designing a retention policy. This tool never deletes faxes, PDFs or backups.</p>
    <div className="settings-fields">
      <label htmlFor="retention-days">Records older than
        <select id="retention-days" value={days} onChange={event=>setDays(Number(event.target.value))}>
          {windows.map(value=><option key={value} value={value}>{value} days</option>)}
        </select>
      </label>
    </div>
    {loading&&<p role="status">Calculating record counts…</p>}
    {error&&<div className="transport-warning" role="alert"><AlertTriangle size={18}/>{error}</div>}
    {preview&&<div className="settings-card">
      <Archive size={20}/>
      <div>
        <strong>{preview.counts.total} fax records older than {preview.days} days</strong>
        <p>Archived and completed: {preview.counts.archivedTerminal} · Active and completed: {preview.counts.activeTerminal}</p>
        <p>Nonterminal (pending or unknown): {preview.counts.nonterminal} · With stored documents: {preview.counts.withDocuments}</p>
        <p>Cutoff: {new Date(preview.cutoff).toLocaleString()}</p>
        <div className="notice inner"><ShieldCheck size={18}/><div>
          <strong>No retention policy is enabled</strong>
          <span>These are aggregate planning counts only. Even archived, completed faxes are retained unchanged.</span>
        </div></div>
      </div>
    </div>}
  </section>;
}
