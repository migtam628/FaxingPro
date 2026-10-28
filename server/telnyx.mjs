import http from 'node:http';
import {randomUUID,timingSafeEqual,randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {e164US,pdfValid,cleanName,statusFor,webhookKey,verifyWebhook,
  signMedia,mediaAuthorized,safeIncomingUrl,encryptPdf,decryptPdf} from './telnyx-utils.mjs';

const e=process.env, port=Number(e.PORT||8088), dir=e.FILE_DIR||'/data/files';
const secret=e.API_TOKEN||'', mediaSecret=e.MEDIA_SIGNING_SECRET||'', storageKey=e.STORAGE_ENCRYPTION_KEY||'';
const base=(e.TELNYX_PUBLIC_BASE_URL||'').replace(/\/$/,'');
const faxApp=e.TELNYX_FAX_APP_ID||'',did=e.TELNYX_FROM_NUMBER||'';
const sending=e.SEND_ENABLED==='true',destination=e.TEST_DESTINATION||'';
if(!e.DATABASE_URL||secret.length<32||mediaSecret.length<32||!e.TELNYX_PUBLIC_KEY||
  !/^[a-f0-9]{64}$/i.test(storageKey)||
  /^(REPLACE_|PASTE_|YOUR_)/i.test(secret))throw Error('Missing safe backend configuration');
if(sending&&(!e.TELNYX_API_KEY||!faxApp||!e164US(did)||!e164US(destination)||
  !base.startsWith('https://')))throw Error('Enable sending only with Telnyx credentials, US DID, test destination and HTTPS origin');
const key=webhookKey(e.TELNYX_PUBLIC_KEY);
const db=new pg.Pool({connectionString:e.DATABASE_URL,max:5,connectionTimeoutMillis:5000});
const output=(r,s,data,headers={})=>{r.writeHead(s,{'Content-Type':'application/json','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',...headers});r.end(JSON.stringify(data));};
const tokenMatches=value=>{
  if(typeof value!=='string')return false;
  const supplied=Buffer.from(value),expected=Buffer.from(secret);
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
};
const tokenFingerprint=createHash('sha256').update(secret).digest('hex');
// Login throttling is intentionally global to this single-operator workspace.
// Reverse proxy topology does not currently provide a trustworthy end-client IP.
// Correct API tokens remain usable even while invalid attempts are throttled.
const maxFailedLogins=8;
const auditSecurity=async event=>
  db.query('INSERT INTO operator_security_events(event_type) VALUES($1)',[event]);
const failedLogin=async()=>{
  const {rows}=await db.query(
    "INSERT INTO operator_login_failures(id,failed_count,window_start) VALUES(1,1,now()) "+
    "ON CONFLICT(id) DO UPDATE SET "+
    "failed_count=CASE WHEN operator_login_failures.window_start<now()-interval '15 minutes' "+
    "THEN 1 ELSE operator_login_failures.failed_count+1 END,"+
    "window_start=CASE WHEN operator_login_failures.window_start<now()-interval '15 minutes' "+
    "THEN now() ELSE operator_login_failures.window_start END "+
    "RETURNING failed_count");
  return rows[0].failed_count;
};
const cookieName='__Host-faxingpro_session';
const cookieBase='Path=/; HttpOnly; Secure; SameSite=Strict';
const cookieClear=cookieName+'=; '+cookieBase+'; Max-Age=0';
const sessionHash=raw=>createHash('sha256').update(raw).digest('hex');
const sessionCookie=req=>{
  const line=req.headers.cookie||'';
  const match=line.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));
  const raw=match?.slice(cookieName.length+1)||'';
  return /^[A-Za-z0-9_-]{43}$/.test(raw)?raw:null;
};
const currentSession=async req=>{
  const raw=sessionCookie(req);
  if(!raw)return null;
  const {rows}=await db.query('SELECT expires_at FROM operator_sessions WHERE token_hash=$1 AND token_fingerprint=$2 AND expires_at>now()',
    [sessionHash(raw),tokenFingerprint]);
  return rows[0]||null;
};
const authed=async req=>{
  if(tokenMatches((req.headers.authorization||'').replace(/^Bearer\s+/i,'')))return true;
  return !!(await currentSession(req));
};
const operatorSession=async(req,res)=>{
  if(req.method==='GET'){
    const active=await currentSession(req);
    return output(res,200,{authenticated:!!active,expiresAt:active?.expires_at||null});
  }
  if(req.method==='DELETE'){
    const raw=sessionCookie(req);
    if(raw){
      const result=await db.query('DELETE FROM operator_sessions WHERE token_hash=$1',[sessionHash(raw)]);
      if(result.rowCount)await auditSecurity('logout');
    }
    return output(res,200,{authenticated:false},{'Set-Cookie':cookieClear});
  }
  if(req.method!=='POST')return output(res,405,{error:'Method not allowed'},{Allow:'GET, POST, DELETE'});
  if(!(req.headers['content-type']||'').startsWith('application/json'))
    return output(res,415,{error:'Content-Type must be application/json'});
  let payload;
  try{payload=JSON.parse((await body(req,4096)).toString('utf8'));}
  catch{return output(res,400,{error:'Invalid request'});}
  if(!tokenMatches(payload?.token)){
    const count=await failedLogin();
    if(count<=maxFailedLogins)await auditSecurity('login_failure');
    if(count>=maxFailedLogins)
      return output(res,429,{error:'Too many invalid sign-in attempts. Retry later or use the correct operator token.'},
        {'Retry-After':'900'});
    return output(res,401,{error:'Invalid operator token'});
  }
  await db.query('DELETE FROM operator_login_failures WHERE id=1');
  const raw=randomBytes(32).toString('base64url');
  const expires=new Date(Date.now()+7*24*60*60*1000);
  await db.query('INSERT INTO operator_sessions(token_hash,token_fingerprint,expires_at) VALUES($1,$2,$3)',
    [sessionHash(raw),tokenFingerprint,expires]);
  await auditSecurity('login_success');
  const cookie=cookieName+'='+raw+'; '+cookieBase+'; Max-Age=604800';
  return output(res,200,{authenticated:true,expiresAt:expires.toISOString()},{'Set-Cookie':cookie});
};
const body=async(req,limit)=>{let len=0;const chunks=[];for await(const c of req){len+=c.length;
  if(len>limit)throw Error('Body exceeds size limit');chunks.push(c);}return Buffer.concat(chunks);};
const row=r=>({id:r.id,telnyxId:r.telnyx_id,direction:r.direction,status:r.status,
  from:r.from_number,to:r.to_number,title:r.title,filename:r.filename,pages:r.pages,
  createdAt:r.created_at,updatedAt:r.updated_at,failureReason:r.failure_reason,
  hasDocument:!!r.file_name,readAt:r.read_at||null,archivedAt:r.archived_at||null});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const contactNumber=/^\+[1-9]\d{7,14}$/;
const contactData=v=>{
  const name=typeof v?.name==='string'?v.name.trim():'';
  const number=typeof v?.number==='string'?v.number.replace(/[\s().-]/g,''):'';
  const email=typeof v?.email==='string'?v.email.trim():'';
  const company=typeof v?.company==='string'?v.company.trim():'';
  const notes=typeof v?.notes==='string'?v.notes.trim():'';
  if(name.length<2||name.length>100||!contactNumber.test(number)||
     email.length>200||(email!==''&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||
     company.length>120||notes.length>1000) return null;
  return {name,number,email,company,notes};
};
const contactRow=r=>({id:r.id,name:r.name,number:r.number,email:r.email,
  company:r.company,notes:r.notes,createdAt:r.created_at,updatedAt:r.updated_at});
const setup=async()=>{
  await mkdir(dir,{recursive:true,mode:0o700});
  await db.query("CREATE TABLE IF NOT EXISTS faxes ("+
    "id UUID PRIMARY KEY,telnyx_id TEXT UNIQUE,client_key TEXT UNIQUE,"+
    "direction TEXT NOT NULL,status TEXT NOT NULL,from_number TEXT NOT NULL,to_number TEXT NOT NULL,"+
    "title TEXT NOT NULL,filename TEXT,file_name TEXT,pages INTEGER NOT NULL DEFAULT 0,"+
    "media_url TEXT,download_state TEXT,failure_reason TEXT,"+
    "last_event_at TIMESTAMPTZ DEFAULT now(),created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now())");
  await db.query("CREATE TABLE IF NOT EXISTS webhook_events ("+
    "id TEXT PRIMARY KEY,fax_id TEXT,event_type TEXT,occurred_at TIMESTAMPTZ,received_at TIMESTAMPTZ DEFAULT now())");
  await db.query("CREATE INDEX IF NOT EXISTS faxes_created_at_idx ON faxes(created_at DESC)");
  await db.query('ALTER TABLE faxes ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ');
  await db.query('ALTER TABLE faxes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ');
  await db.query("CREATE TABLE IF NOT EXISTS contacts ("+
    "id UUID PRIMARY KEY,name TEXT NOT NULL,number TEXT NOT NULL UNIQUE,"+
    "email TEXT NOT NULL DEFAULT '',company TEXT NOT NULL DEFAULT '',"+
    "notes TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"+
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await db.query("CREATE INDEX IF NOT EXISTS contacts_name_idx ON contacts(lower(name))");
  await db.query("CREATE TABLE IF NOT EXISTS notification_preferences ("+
    "id INTEGER PRIMARY KEY CHECK(id=1),browser_enabled BOOLEAN NOT NULL DEFAULT FALSE,"+
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await db.query("INSERT INTO notification_preferences(id) VALUES(1) ON CONFLICT(id) DO NOTHING");
  await db.query("CREATE TABLE IF NOT EXISTS operator_sessions ("+
    "token_hash TEXT PRIMARY KEY,token_fingerprint TEXT NOT NULL,"+
    "expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ DEFAULT now())");
  await db.query("CREATE TABLE IF NOT EXISTS operator_login_failures ("+
    "id INTEGER PRIMARY KEY CHECK(id=1),failed_count INTEGER NOT NULL,"+
    "window_start TIMESTAMPTZ NOT NULL DEFAULT now())");
  await db.query("CREATE TABLE IF NOT EXISTS operator_security_events ("+
    "id BIGSERIAL PRIMARY KEY,event_type TEXT NOT NULL,"+
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await db.query("CREATE INDEX IF NOT EXISTS operator_security_events_recent_idx "+
    "ON operator_security_events(created_at DESC)");
  await db.query("CREATE TABLE IF NOT EXISTS app_settings ("+
    "id INTEGER PRIMARY KEY CHECK(id=1),workspace_name TEXT NOT NULL DEFAULT 'FaxingPro',"+
    "timezone TEXT NOT NULL DEFAULT 'America/New_York',"+
    "completed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await db.query("INSERT INTO app_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING");
  await db.query("CREATE TABLE IF NOT EXISTS backup_runs ("+
    "name TEXT PRIMARY KEY,completed_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await db.query("CREATE TABLE IF NOT EXISTS backup_offsite_uploads ("+
    "name TEXT NOT NULL REFERENCES backup_runs(name),"+
    "provider TEXT NOT NULL,destination TEXT NOT NULL,"+
    "verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),"+
    "PRIMARY KEY (name,provider))");
};
const setupSettings=async(req,res)=>{
  if(req.method==='GET'){
    const {rows}=await db.query('SELECT workspace_name,timezone,completed_at FROM app_settings WHERE id=1');
    const v=rows[0];
    const configured={
      apiKey:!!e.TELNYX_API_KEY,
      faxApplication:!!faxApp,
      phoneNumber:e164US(did),
      webhookPublicKey:!!e.TELNYX_PUBLIC_KEY,
      httpsUrl:base.startsWith('https://')
    };
    return output(res,200,{
      complete:!!v.completed_at,
      workspaceName:v.workspace_name,timezone:v.timezone,
      provider:'Telnyx Programmable Fax',fromNumber:did||null,
      publicBaseUrl:base||null,webhookUrl:base?base+'/webhooks/telnyx':null,
      outboundEnabled:sending,configured
    });
  }
  if(req.method!=='POST')return output(res,405,{error:'Method not allowed'},{Allow:'GET, POST'});
  if(!(req.headers['content-type']||'').startsWith('application/json'))
    return output(res,415,{error:'Expected JSON body'});
  let values;
  try{values=JSON.parse((await body(req,8192)).toString('utf8'));}
  catch{return output(res,400,{error:'Invalid configuration request'});}
  const name=typeof values?.workspaceName==='string'?values.workspaceName.trim():'';
  const zone=typeof values?.timezone==='string'?values.timezone:'';
  if(name.length<2||name.length>80||!['America/New_York','America/Chicago','America/Denver',
    'America/Los_Angeles','America/Phoenix','UTC'].includes(zone))
    return output(res,400,{error:'Enter a workspace name (2–80 characters) and a supported timezone'});
  if(!(e.TELNYX_API_KEY&&faxApp&&e164US(did)&&e.TELNYX_PUBLIC_KEY&&base.startsWith('https://')))
    return output(res,409,{error:'Complete the required Telnyx VPS environment configuration before finishing setup'});
  await db.query("UPDATE app_settings SET workspace_name=$1,timezone=$2,completed_at=COALESCE(completed_at,now()),updated_at=now() WHERE id=1",
    [name,zone]);
  return setupSettings({method:'GET'},res);
};
const telnyx=async(record,link)=>{
  const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),15000);
  try{
    const r=await fetch('https://api.telnyx.com/v2/faxes',{method:'POST',signal:ctl.signal,
      headers:{Authorization:'Bearer '+e.TELNYX_API_KEY,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({connection_id:faxApp,from:did,to:record.to,media_url:link,
        client_state:Buffer.from(record.id).toString('base64')})});
    if(r.status!==202)throw Error('Telnyx returned HTTP '+r.status);
    return (await r.json()).data||{};
  }finally{clearTimeout(timeout);}
};
const postFax=async(req,res)=>{
  if(!sending)return output(res,503,{error:'Outbound fax is locked until SEND_ENABLED=true and the first test is approved'});
  let v;try{v=JSON.parse((await body(req,14*1024*1024+2048)).toString());}
  catch{return output(res,400,{error:'Invalid or oversized JSON body'});}
  if(!e164US(v.recipient)||v.recipient!==destination)
    return output(res,403,{error:'Destination must match the authorized TEST_DESTINATION'});
  if(typeof v.contentBase64!=='string'||v.contentBase64.length>14*1024*1024||
    !/^[a-zA-Z0-9+/]+={0,2}$/.test(v.contentBase64))
    return output(res,400,{error:'Invalid PDF encoding'});
  const data=Buffer.from(v.contentBase64,'base64');
  if(!pdfValid(data))return output(res,400,{error:'PDF must be valid and no more than 10 MB'});
  const id=randomUUID(),reqId=typeof v.requestId==='string'&&/^[0-9a-f-]{36}$/i.test(v.requestId)?v.requestId:id;
  const old=await db.query('SELECT * FROM faxes WHERE client_key=$1',[reqId]);
  if(old.rows.length)return output(res,200,row(old.rows[0]));
  const filename=cleanName(v.filename||'document.pdf'),title=String(v.title||filename).slice(0,160);
  const file=id+'.pdf';await writeFile(path.join(dir,file),encryptPdf(data,storageKey),{mode:0o600,flag:'wx'});
  try{await db.query("INSERT INTO faxes(id,client_key,direction,status,from_number,to_number,title,filename,file_name)"+
    " VALUES($1,$2,'outbound','submitting',$3,$4,$5,$6,$7)",[id,reqId,did,v.recipient,title,filename,file]);}
  catch(err){await unlink(path.join(dir,file)).catch(()=>{});throw err;}
  const expires=Math.floor(Date.now()/1000)+3600;
  const link=base+'/media/outbound/'+id+'?exp='+expires+'&sig='+signMedia(mediaSecret,id,expires);
  try{
    const result=await telnyx({id,to:v.recipient},link);
    await db.query("UPDATE faxes SET telnyx_id=COALESCE(telnyx_id,$2),"+
      "status=CASE WHEN status='submitting' THEN 'queued' ELSE status END,updated_at=now() WHERE id=$1",
      [id,result.id||null]);
    const cur=await db.query('SELECT * FROM faxes WHERE id=$1',[id]);
    return output(res,202,row(cur.rows[0]));
  }catch{
    // Telnyx may accept a request even if the HTTPS response is lost. Do not retry automatically.
    await db.query("UPDATE faxes SET status='unknown',"+
      "failure_reason='Check Telnyx before resubmitting',updated_at=now()"+
      " WHERE id=$1 AND status='submitting'",[id]);
    return output(res,502,{error:'Submission outcome unknown. Reconcile in Telnyx before retrying.',id});
  }
};
const webhook=async(req,res)=>{
  const raw=await body(req,512*1024);
  if(!verifyWebhook(raw,req.headers,key))return output(res,401,{error:'Invalid webhook signature'});
  let incoming;try{incoming=JSON.parse(raw.toString());}catch{return output(res,400,{error:'Invalid webhook JSON'});}
  const event=incoming.data||incoming, payload=event.payload||{};
  const state=statusFor(event.event_type),eventId=event.id,faxId=payload.fax_id;
  if(!state||typeof eventId!=='string'||typeof faxId!=='string'||
    !['inbound','outbound'].includes(payload.direction))
    return output(res,200,{ok:true,ignored:true});
  if(faxApp&&payload.connection_id&&payload.connection_id!==faxApp)
    return output(res,200,{ok:true,ignored:true});
  let clientId=null;
  try{const id=Buffer.from(payload.client_state||'','base64').toString();
    if(uuid.test(id))clientId=id;}catch{}
  const eventAt=!Number.isNaN(Date.parse(event.occurred_at))?new Date(event.occurred_at):new Date();
  const conn=await db.connect();
  try{
    await conn.query('BEGIN');
    const inserted=await conn.query("INSERT INTO webhook_events(id,fax_id,event_type,occurred_at)"+
      " VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",
      [eventId,faxId,event.event_type,eventAt]);
    if(!inserted.rowCount){await conn.query('COMMIT');return output(res,200,{ok:true,duplicate:true});}
    const media=event.event_type==='fax.received'?String(payload.media_url||''):'';
    if(payload.direction==='inbound'){
      await conn.query("INSERT INTO faxes(id,telnyx_id,direction,status,from_number,to_number,title,pages,media_url,download_state,last_event_at,failure_reason)"+
        " VALUES($1,$2,'inbound',$3,$4,$5,'Incoming fax',$6,$7,$8,$9,$10) ON CONFLICT(telnyx_id) DO NOTHING",
        [randomUUID(),faxId,state,String(payload.from||''),String(payload.to||''),
          Number(payload.page_count)||0,media||null,media?'pending':null,eventAt,
          state==='failed'?String(payload.failure_reason||''):null]);
    }
    // Signed events may arrive late or out of order. Preserve the first terminal
    // result and all associated metadata; still retain every unique event in the timeline.
    // Correlation is permitted independently so a late client_state can link an
    // outbound record without changing its confirmed delivery outcome.
    const applicable="last_event_at<=$2 AND status NOT IN ('delivered','received','failed')";
    await conn.query("UPDATE faxes SET "+
      "status=CASE WHEN "+applicable+" THEN $3 ELSE status END,"+
      "pages=CASE WHEN "+applicable+" THEN GREATEST(pages,$4) ELSE pages END,"+
      "failure_reason=CASE WHEN "+applicable+" AND $3='failed' THEN $5 ELSE failure_reason END,"+
      "media_url=CASE WHEN "+applicable+" AND $3='received' AND $6<>'' THEN $6 ELSE media_url END,"+
      "download_state=CASE WHEN "+applicable+" AND $3='received' AND $6<>'' AND file_name IS NULL THEN 'pending' ELSE download_state END,"+
      "last_event_at=CASE WHEN "+applicable+" THEN $2 ELSE last_event_at END,"+
      "updated_at=CASE WHEN "+applicable+" THEN now() ELSE updated_at END,"+
      "telnyx_id=COALESCE(telnyx_id,$1)"+
      " WHERE (telnyx_id=$1 OR ($7::uuid IS NOT NULL AND id=$7::uuid)) AND direction=$8",
      [faxId,eventAt,state,Number(payload.page_count)||0,String(payload.failure_reason||''),media,clientId,payload.direction]);
    await conn.query('COMMIT');
  }catch(err){await conn.query('ROLLBACK');throw err;}finally{conn.release();}
  return output(res,200,{ok:true});
};
let fetching=false;
const capture=async()=>{
  if(fetching)return;fetching=true;
  try{
    const {rows}=await db.query("SELECT id,media_url FROM faxes WHERE direction='inbound'"+
      " AND download_state='pending' AND media_url IS NOT NULL AND media_url<>'' ORDER BY created_at LIMIT 4");
    for(const item of rows){
      const url=safeIncomingUrl(item.media_url);
      if(!url){await db.query("UPDATE faxes SET download_state='blocked' WHERE id=$1",[item.id]);continue;}
      try{
        const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),10000);
        let response;try{response=await fetch(url,{redirect:'error',signal:ctl.signal});}finally{clearTimeout(timer);}
        if(!response.ok||Number(response.headers.get('content-length')||0)>10*1024*1024)throw Error('Invalid media response');
        const pdf=Buffer.from(await response.arrayBuffer());
        if(!pdfValid(pdf))throw Error('Invalid inbound PDF');
        const name=item.id+'.pdf';
        await writeFile(path.join(dir,name),encryptPdf(pdf,storageKey),{mode:0o600,flag:'wx'}).catch(err=>{if(err.code!=='EEXIST')throw err;});
        await db.query("UPDATE faxes SET file_name=$2,filename='received.pdf',"+
          "download_state='saved',media_url=NULL,updated_at=now() WHERE id=$1",[item.id,name]);
      }catch(err){console.error('Inbound PDF capture pending: '+item.id+' ('+err.message+')');}
    }
  }catch(err){console.error('Inbound worker:',err.message);}finally{fetching=false;}
};
const app=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/','http://localhost'),p=url.pathname;
  const origin=req.headers.origin;
  const allowed=[base,'http://localhost:8092','http://127.0.0.1:8092'];
  if(origin&&!allowed.includes(origin))return output(res,403,{error:'Origin is not permitted'});
  try{
    if(req.method==='GET'&&p==='/healthz'){
      await db.query('SELECT 1');
      return output(res,200,{ok:true,service:'FaxingPro Telnyx API',transport:'telnyx-fax-api',faxEnabled:sending});
    }
    if(req.method==='POST'&&p==='/webhooks/telnyx')return await webhook(req,res);
    if(p==='/api/session')return await operatorSession(req,res);
    const media=p.match(/^\/media\/outbound\/([0-9a-f-]{36})$/i);
    if(req.method==='GET'&&media){
      if(!mediaAuthorized(mediaSecret,media[1],url.searchParams.get('exp'),url.searchParams.get('sig')))
        return output(res,403,{error:'Media link expired or invalid'});
      const {rows}=await db.query("SELECT file_name FROM faxes WHERE id=$1 AND direction='outbound'",[media[1]]);
      if(!rows[0]?.file_name)return output(res,404,{error:'Not found'});
      const pdf=decryptPdf(await readFile(path.join(dir,rows[0].file_name)),storageKey);
      res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff'});return res.end(pdf);
    }
    if(p.startsWith('/api/')){
      if(!(await authed(req)))return output(res,401,{error:'Unauthorized'});
      if(p==='/api/setup')return await setupSettings(req,res);
      if(req.method==='GET'&&p==='/api/security'){
        const [sessionData,eventsData,failuresData]=await Promise.all([
          db.query('SELECT count(*)::int AS count FROM operator_sessions WHERE expires_at>now() AND token_fingerprint=$1',[tokenFingerprint]),
          db.query('SELECT event_type AS type,created_at AS "createdAt" FROM operator_security_events ORDER BY created_at DESC LIMIT 20'),
          db.query("SELECT count(*)::int AS count FROM operator_security_events WHERE event_type='login_failure' "+
            "AND created_at>now()-interval '24 hours'")
        ]);
        return output(res,200,{
          activeSessions:sessionData.rows[0].count,
          failedLogins24h:failuresData.rows[0].count,
          events:eventsData.rows,
          mode:'single-operator',mfaEnabled:false
        });
      }
      if(req.method==='DELETE'&&p==='/api/sessions'){
        const result=await db.query('DELETE FROM operator_sessions');
        await auditSecurity('all_sessions_revoked');
        return output(res,200,{revoked:result.rowCount},{'Set-Cookie':cookieClear});
      }
      if(req.method==='GET'&&p==='/api/backup/status'){
        const {rows}=await db.query(
          "SELECT b.name,b.completed_at,u.verified_at AS drive_verified_at "+
          "FROM backup_runs b LEFT JOIN backup_offsite_uploads u "+
          "ON u.name=b.name AND u.provider='google-drive' "+
          "ORDER BY b.completed_at DESC LIMIT 5");
        const last=rows[0]?.completed_at||null;
        const ageHours=last?Math.round(((Date.now()-new Date(last).getTime())/3600000)*10)/10:null;
        const freshness=last?(ageHours<=36?'recent':'stale'):'missing';
        const offsiteVerified=!!rows[0]?.drive_verified_at;
        const offsiteFreshness=!last?'missing':offsiteVerified?'current':'pending';
        return output(res,200,{runs:rows,configured:rows.length>0,
          lastSuccessfulAt:last,ageHours,freshness,
          scheduleVerified:false,offsiteVerified,offsiteProvider:'Google Drive',offsiteFreshness,
          message:freshness==='recent'?'Recent encrypted local archive creation recorded.':
            freshness==='stale'?'Most recent local backup record is over 36 hours old. Check the VPS timer and journald.':
            'No encrypted local backup has been recorded. Run the VPS backup script first.'});
        // The Google Drive verified_at record means the encrypted files matched on rclone check,
        // NOT that an offline decrypt / full database restoration has succeeded.
      }
      if(req.method==='GET'&&p==='/api/capabilities')
        return output(res,200,{transport:'telnyx-fax-api',inbound:true,outbound:sending});
      if(p==='/api/notifications/preferences'){
        if(req.method==='GET'){
          const {rows}=await db.query('SELECT browser_enabled FROM notification_preferences WHERE id=1');
          return output(res,200,{browserEnabled:!!rows[0].browser_enabled});
        }
        if(req.method==='PATCH'){
          if(!(req.headers['content-type']||'').startsWith('application/json'))
            return output(res,415,{error:'Expected application/json'});
          let payload;try{payload=JSON.parse((await body(req,2048)).toString());}
          catch{return output(res,400,{error:'Invalid preference request'});}
          if(typeof payload?.browserEnabled!=='boolean')
            return output(res,400,{error:'browserEnabled must be boolean'});
          await db.query('UPDATE notification_preferences SET browser_enabled=$1,updated_at=now() WHERE id=1',
            [payload.browserEnabled]);
          return output(res,200,{browserEnabled:payload.browserEnabled});
        }
        return output(res,405,{error:'Method not allowed'},{Allow:'GET, PATCH'});
      }
      if(req.method==='GET'&&p==='/api/notifications'){
        const [records,count]=await Promise.all([
          db.query("SELECT id,title,direction,status,from_number,to_number,created_at FROM faxes "+
            "WHERE archived_at IS NULL AND ((direction='inbound' AND read_at IS NULL) "+
            "OR status='failed') ORDER BY created_at DESC LIMIT 30"),
          db.query("SELECT count(*)::int AS total FROM faxes WHERE archived_at IS NULL AND "+
            "((direction='inbound' AND read_at IS NULL) OR status='failed')")
        ]);
        const items=records.rows.map(r=>({
          id:r.id,faxId:r.id,
          kind:r.status==='failed'?'failed':'incoming',
          title:r.status==='failed'?'Fax delivery failed':'New incoming fax',
          description:r.title||'Fax',
          number:r.direction==='inbound'?r.from_number:r.to_number,
          createdAt:r.created_at
        }));
        return output(res,200,{items,total:count.rows[0].total});
      }
      if(p==='/api/contacts'){
        if(req.method==='GET'){
          const search=String(url.searchParams.get('q')||'').trim().slice(0,100);
          const {rows}=await db.query(
            "SELECT * FROM contacts WHERE ($1='' OR name ILIKE '%'||$1||'%'"+
            " OR number ILIKE '%'||$1||'%' OR company ILIKE '%'||$1||'%') "+
            "ORDER BY name ASC,id ASC LIMIT 500",[search]);
          return output(res,200,{items:rows.map(contactRow)});
        }
        if(req.method==='POST'){
          if(!(req.headers['content-type']||'').startsWith('application/json'))
            return output(res,415,{error:'Expected application/json'});
          let payload;try{payload=JSON.parse((await body(req,8192)).toString());}
          catch{return output(res,400,{error:'Invalid contact request'});}
          const info=contactData(payload);
          if(!info)return output(res,400,{error:'Contact requires name (2-100 chars), valid E.164 number, optional email/company/notes'});
          const exists=await db.query('SELECT id FROM contacts WHERE number=$1',[info.number]);
          if(exists.rowCount)return output(res,409,{error:'A contact with that fax number already exists'});
          const {rows}=await db.query(
            'INSERT INTO contacts(id,name,number,email,company,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
            [randomUUID(),info.name,info.number,info.email,info.company,info.notes]);
          return output(res,201,contactRow(rows[0]));
        }
        return output(res,405,{error:'Method not allowed'},{Allow:'GET, POST'});
      }
      const contact=p.match(/^\/api\/contacts\/([0-9a-f-]{36})$/i);
      if(contact){
        if(!uuid.test(contact[1]))return output(res,400,{error:'Invalid contact ID'});
        if(req.method==='DELETE'){
          const result=await db.query('DELETE FROM contacts WHERE id=$1',[contact[1]]);
          return output(res,result.rowCount?200:404,result.rowCount?{deleted:true}:{error:'Contact not found'});
        }
        if(req.method==='PATCH'){
          if(!(req.headers['content-type']||'').startsWith('application/json'))
            return output(res,415,{error:'Expected application/json'});
          let payload;try{payload=JSON.parse((await body(req,8192)).toString());}
          catch{return output(res,400,{error:'Invalid contact request'});}
          const info=contactData(payload);
          if(!info)return output(res,400,{error:'Invalid contact fields'});
          const {rows}=await db.query(
            "UPDATE contacts SET name=$2,number=$3,email=$4,company=$5,notes=$6,updated_at=now() WHERE id=$1 RETURNING *",
            [contact[1],info.name,info.number,info.email,info.company,info.notes]);
          return output(res,rows.length?200:404,rows.length?contactRow(rows[0]):{error:'Contact not found'});
        }
        return output(res,405,{error:'Method not allowed'},{Allow:'PATCH, DELETE'});
      }
      if(req.method==='GET'&&p==='/api/faxes'){
        const limit=Math.min(250,Math.max(1,Number(url.searchParams.get('limit')||100)||100));
        const offset=Math.min(100000,Math.max(0,Number(url.searchParams.get('offset')||0)||0));
        const search=String(url.searchParams.get('q')||'').trim().slice(0,120);
        const folder=String(url.searchParams.get('folder')||'active');
        if(!['active','archived','all'].includes(folder))return output(res,400,{error:'Invalid folder'});
        const {rows}=await db.query(
          "SELECT * FROM faxes WHERE ($1='all' OR ($1='archived' AND archived_at IS NOT NULL) "+
          "OR ($1='active' AND archived_at IS NULL)) AND "+
          "($2='' OR title ILIKE '%'||$2||'%' OR from_number ILIKE '%'||$2||'%' "+
          "OR to_number ILIKE '%'||$2||'%' OR id::text ILIKE '%'||$2||'%') "+
          "ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4",[folder,search,limit,offset]);
        return output(res,200,{items:rows.map(row),limit,offset});
      }
      const faxAction=p.match(/^\/api\/faxes\/([0-9a-f-]{36})\/(read|archive)$/i);
      if(faxAction&&req.method==='PATCH'){
        const [,id,action]=faxAction;
        if(!uuid.test(id))return output(res,400,{error:'Invalid fax ID'});
        if(!(req.headers['content-type']||'').startsWith('application/json'))
          return output(res,415,{error:'Expected application/json'});
        let v;try{v=JSON.parse((await body(req,2048)).toString());}
        catch{return output(res,400,{error:'Invalid fax operation'});}
        if(typeof v?.enabled!=='boolean')return output(res,400,{error:'Expected enabled boolean'});
        if(action==='read'){
          const {rows}=await db.query(
            "UPDATE faxes SET read_at=CASE WHEN $2 THEN now() ELSE NULL END,updated_at=now() "+
            "WHERE id=$1 AND direction='inbound' RETURNING *",[id,v.enabled]);
          return output(res,rows.length?200:404,rows.length?row(rows[0]):{error:'Incoming fax not found'});
        }
        const {rows}=await db.query(
          "UPDATE faxes SET archived_at=CASE WHEN $2 THEN now() ELSE NULL END,updated_at=now() "+
          "WHERE id=$1 RETURNING *",[id,v.enabled]);
        return output(res,rows.length?200:404,rows.length?row(rows[0]):{error:'Fax not found'});
      }
      if(req.method==='GET'&&p==='/api/stats'){
        const {rows}=await db.query("SELECT "+
          "count(*) FILTER(WHERE direction='inbound' AND status='received')::int received,"+
          "count(*) FILTER(WHERE direction='outbound' AND status='delivered')::int sent,"+
          "count(*) FILTER(WHERE direction='outbound' AND status NOT IN ('delivered','failed'))::int pending,"+
          "count(*) FILTER(WHERE status='failed')::int failed FROM faxes");
        return output(res,200,rows[0]);
      }
      if(req.method==='GET'&&p==='/api/reports/daily'){
        const {rows}=await db.query(
          "SELECT to_char(d.day,'YYYY-MM-DD') AS day, "+
          "count(f.id) FILTER(WHERE f.direction='inbound')::int AS received, "+
          "count(f.id) FILTER(WHERE f.direction='outbound')::int AS sent, "+
          "count(f.id) FILTER(WHERE f.status='failed')::int AS failed "+
          "FROM generate_series((now() AT TIME ZONE 'UTC')::date-29,"+
          "(now() AT TIME ZONE 'UTC')::date,interval '1 day') AS d(day) "+
          "LEFT JOIN faxes f ON (f.created_at AT TIME ZONE 'UTC')::date=d.day::date "+
          "GROUP BY d.day ORDER BY d.day");
        return output(res,200,{days:rows,timezone:'UTC',windowDays:30});
      }
      const history=p.match(/^\/api\/faxes\/([0-9a-f-]{36})\/events$/i);
      if(req.method==='GET'&&history){
        if(!uuid.test(history[1]))return output(res,400,{error:'Invalid fax ID'});
        const found=await db.query('SELECT telnyx_id,created_at,direction,status FROM faxes WHERE id=$1',[history[1]]);
        if(!found.rowCount)return output(res,404,{error:'Fax not found'});
        const fax=found.rows[0];
        const {rows}=await db.query(
          "SELECT event_type AS type,occurred_at AS \"occurredAt\" "+
          "FROM webhook_events WHERE fax_id=$1 ORDER BY occurred_at ASC LIMIT 100",
          [fax.telnyx_id||'']);
        return output(res,200,{events:rows,createdAt:fax.created_at,
          direction:fax.direction,status:fax.status});
      }
      if(req.method==='POST'&&p==='/api/faxes')return await postFax(req,res);
      const doc=p.match(/^\/api\/faxes\/([0-9a-f-]{36})\/document$/i);
      if(req.method==='GET'&&doc){
        const {rows}=await db.query('SELECT file_name,filename FROM faxes WHERE id=$1',[doc[1]]);
        if(!rows[0]?.file_name)return output(res,404,{error:'Document not stored'});
        const pdf=decryptPdf(await readFile(path.join(dir,rows[0].file_name)),storageKey);
        res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'private,no-store',
          'Content-Disposition':(url.searchParams.get('view')==='inline'?'inline':'attachment')+
            '; filename="'+cleanName(rows[0].filename)+'"',
          'X-Content-Type-Options':'nosniff'});return res.end(pdf);
      }
    }
    return output(res,404,{error:'Unknown endpoint'});
  }catch(err){console.error('Request error:',err.message);if(!res.headersSent)output(res,500,{error:'Internal server error'});else res.end();}
});
app.requestTimeout=30000;app.headersTimeout=10000;
await setup();
app.listen(Number(e.PORT||8088),'0.0.0.0',()=>console.log('FaxingPro Telnyx API started (sending: '+sending+')'));
setInterval(capture,5000).unref();
setInterval(()=>db.query('DELETE FROM operator_sessions WHERE expires_at<now()').catch(err=>
  console.error('Session cleanup failed:',err.message)),3600000).unref();
