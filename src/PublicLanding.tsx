import {Archive,ArrowRight,BookUser,CheckCircle2,Cloud,FileText,LockKeyhole,
  Printer,Server,ShieldCheck,Download,ExternalLink} from 'lucide-react';
import './public.css';
const source='https://github.com/migtam628/FaxingPro';
export default function PublicLanding(){
  return <div className="public-site">
    <header className="public-nav"><a href="#top" className="public-logo"><span className="public-logo-symbol"><Printer size={21}/></span><span>FaxingPro <small>ATLAS</small></span></a>
      <nav aria-label="Public navigation"><a href="#features">Capabilities</a><a href="#architecture">Deployment</a>
        <a href={source+'/releases'} target="_blank" rel="noopener noreferrer">Releases</a></nav>
      <a className="public-small-button" href={source} target="_blank" rel="noopener noreferrer">GitHub <ExternalLink size={15}/></a></header>
    <main id="top">
      <section className="public-hero"><div className="public-hero-copy">
        <span className="public-kicker"><span/> SELF-HOSTED FAX MANAGEMENT</span>
        <h1>Your fax workspace.<br/><em>In your control.</em></h1>
        <p>ATLAS is a focused fax management interface backed by Telnyx, PostgreSQL, encrypted document storage and a self-hosted API. Keep your documents on infrastructure you control.</p>
        <div className="public-cta">
          <a className="public-main-button" href={source+'/releases'}>View desktop builds <ArrowRight size={18}/></a>
          <a className="public-outline-button" href={source+'#readme'}>Read documentation <ExternalLink size={17}/></a>
        </div>
        <div className="public-proof"><span><CheckCircle2 size={17}/> Real fax records</span><span><CheckCircle2 size={17}/> Encrypted PDFs</span><span><CheckCircle2 size={17}/> No sample transactions</span></div>
      </div>
      <div className="public-interface" aria-label="Illustration of the ATLAS workspace">
        <div className="public-preview-sidebar"><div className="public-preview-brand"><Printer size={22}/> ATLAS</div><div>Workspace</div>
          <span className="public-preview-selected">▣ Dashboard</span><span>▧ Inbox</span><span>⇧ Sent faxes</span><span>▤ Contacts</span><span>▦ Documents</span>
          <div>System</div><span>◈ Security</span><span>☁ Backup & Recovery</span></div>
        <div className="public-preview-main">
          <div className="public-preview-top">Workspace / Overview <span>● SECURE</span></div>
          <h3>All your faxes. One workspace.</h3><p>Operational dashboard — representative layout only</p>
          <div className="public-preview-kpis"><div><strong>Inbox</strong><FileText size={22}/><small>Receive securely</small></div><div><strong>Delivery</strong><ArrowRight size={22}/><small>Track transmissions</small></div><div><strong>Records</strong><Archive size={22}/><small>Encrypted originals</small></div></div>
          <div className="public-preview-table"><div><span>DOCUMENTS</span><span>STATUS</span></div><div><span><FileText size={17}/> Real transmissions appear here</span><span>Telnyx API</span></div><div><span><ShieldCheck size={17}/> Storage remains encrypted</span><span>Protected</span></div><div><span><Cloud size={17}/> Encrypted offsite recovery</span><span>Optional</span></div></div>
        </div>
      </div></section>
      <section id="features" className="public-section"><div className="public-section-heading"><span>PLATFORM CAPABILITIES</span><h2>Everything your fax operation needs to stay organized.</h2><p>Built around a real API and explicit operational controls—never fabricated demo records.</p></div>
        <div className="public-feature-grid">
          {[
            {icon:FileText,title:'Fax inbox and document viewer',text:'Review original stored PDFs, including multi-page documents, with authenticated access.'},
            {icon:Server,title:'Telnyx integration',text:'Send and receive using Telnyx Programmable Fax, with signed webhooks and destination safeguards.'},
            {icon:LockKeyhole,title:'Private document storage',text:'AES-256-GCM encrypted fax files on your persistent server volume.'},
            {icon:BookUser,title:'Contacts and organization',text:'PostgreSQL-backed contact directory, search, read status and reversible archiving.'},
            {icon:Cloud,title:'Encrypted Google Drive backups',text:'Age-encrypted database, document and configuration archives with offsite integrity checks.'},
            {icon:ShieldCheck,title:'Security and visibility',text:'HttpOnly operator sessions, failed-login throttling and operator security-event history.'}
          ].map(({icon:Icon,title,text})=><article key={title}><div className="public-feature-icon"><Icon size={23}/></div><h3>{title}</h3><p>{text}</p></article>)}
        </div></section>
      <section id="architecture" className="public-arch"><div><span>DEPLOY WITH CONFIDENCE</span><h2>Designed for your own server.</h2><p>Docker Compose, Node.js, PostgreSQL, and an existing HTTPS reverse proxy. Your production fax data remains on the self-hosted deployment; this GitHub Pages site is informational only.</p>
        <a className="public-main-button" href={source+'/blob/main/docs/TELNYX_API_DEPLOYMENT.md'} target="_blank" rel="noopener noreferrer">Deployment documentation <ArrowRight size={17}/></a></div>
        <div className="public-arch-list"><div><Server size={21}/> VPS or dedicated server</div><div><ShieldCheck size={21}/> Signed Telnyx webhooks</div><div><Archive size={21}/> PostgreSQL + encrypted PDFs</div><div><Cloud size={21}/> Encrypted offsite recovery</div></div></section>
      <section className="public-bottom"><h2>Explore FaxingPro.</h2><p>Browse the source, preview builds and detailed deployment guide.</p>
        <div className="public-cta"><a className="public-main-button" href={source+'/releases'}>GitHub Releases <Download size={18}/></a>
          <a className="public-outline-button" href={source}>Browse the repository <ExternalLink size={17}/></a></div>
        <small>Current release channel: unsigned preview installers. This single-operator pilot is not a certified regulated-document service.</small>
      </section>
    </main><footer className="public-footer"><strong>FaxingPro <span>ATLAS</span></strong><span>Self-hosted fax management</span><a href={source}>Source on GitHub</a></footer>
  </div>;
}
