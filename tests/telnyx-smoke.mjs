import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, sign, createPrivateKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const env=Object.fromEntries(readFileSync('deployment/telnyx/.env','utf8')
  .split('\n').filter(s=>s&&!s.startsWith('#')&&s.includes('='))
  .map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
const base='http://127.0.0.1:8092',auth={Authorization:'Bearer '+env.API_TOKEN};
async function request(path,config={}){return fetch(base+path,config);}

let ok=false;
for(let i=0;i<30;i++){
  try{const r=await request('/healthz');
    if(r.ok){const data=await r.json();
      assert.equal(data.transport,'telnyx-fax-api');
      assert.equal(data.faxEnabled,false);
      ok=true;break;
    }
  }catch{}
  await new Promise(r=>setTimeout(r,1000));
}
assert.ok(ok,'Telnyx pilot backend failed to become healthy');
assert.equal((await request('/api/faxes')).status,401);
assert.equal((await request('/api/faxes',{headers:auth})).status,200);
assert.equal((await request('/api/backup/status')).status,401);
const backupBefore=await request('/api/backup/status',{headers:auth});
assert.equal(backupBefore.status,200);
const emptyBackup=await backupBefore.json();
assert.equal(emptyBackup.configured,false);
assert.deepEqual(emptyBackup.runs,[]);


const noLogin=await request('/api/session');
assert.equal(noLogin.status,200);
assert.equal((await noLogin.json()).authenticated,false);
const incorrect=await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({token:'incorrect'})});
assert.equal(incorrect.status,401);
const signedIn=await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({token:env.API_TOKEN})});
assert.equal(signedIn.status,200);
assert.equal((await signedIn.json()).authenticated,true);
const cookie=signedIn.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie?.startsWith('__Host-faxingpro_session='));
assert.ok(signedIn.headers.get('set-cookie')?.includes('HttpOnly'));
assert.ok(signedIn.headers.get('set-cookie')?.includes('Secure'));
assert.ok(signedIn.headers.get('set-cookie')?.includes('SameSite=Strict'));
const cookieHeader={Cookie:cookie};
assert.equal((await (await request('/api/session',{headers:cookieHeader})).json()).authenticated,true);
assert.equal((await request('/api/faxes',{headers:cookieHeader})).status,200);
const beforeSetup=await (await request('/api/setup',{headers:cookieHeader})).json();
assert.equal(beforeSetup.complete,false);
assert.equal(beforeSetup.configured.apiKey,true);
assert.equal(beforeSetup.configured.phoneNumber,true);
assert.equal(beforeSetup.fromNumber,'+13055551234');
assert.equal(beforeSetup.provider,'Telnyx Programmable Fax');
const invalidSetup=await request('/api/setup',{method:'POST',
  headers:{...cookieHeader,'Content-Type':'application/json'},
  body:JSON.stringify({workspaceName:'X',timezone:'Unknown/Zone'})});
assert.equal(invalidSetup.status,400);
const savedSetup=await request('/api/setup',{method:'POST',
  headers:{...cookieHeader,'Content-Type':'application/json'},
  body:JSON.stringify({workspaceName:'FaxingPro Business',timezone:'America/New_York'})});
assert.equal(savedSetup.status,200);
const setupResult=await savedSetup.json();
assert.equal(setupResult.complete,true);
assert.equal(setupResult.workspaceName,'FaxingPro Business');
assert.equal((await (await request('/api/setup',{headers:cookieHeader})).json()).complete,true);
assert.equal((await request('/api/setup')).status,401);

const headerTokenAction={'X-FaxingPro-Action':'token-manager','Content-Type':'application/json'};
assert.equal((await request('/api/tokens')).status,401);
assert.equal((await request('/api/tokens',{headers:auth})).status,200);
const tokenListBefore=await (await request('/api/tokens',{headers:auth})).json();
assert.equal(tokenListBefore.items.length,0);
assert.equal((await request('/api/tokens',{method:'POST',headers:{...auth,'Content-Type':'application/json'},
  body:JSON.stringify({name:'Readonly Client',scopes:['faxes:read'],expiresInDays:7})})).status,403,
  'Creation must reject requests lacking the anti-CSRF action header');
assert.equal((await request('/api/tokens',{method:'POST',headers:{...auth,...headerTokenAction},
  body:JSON.stringify({name:'Unsafe Write',scopes:['faxes:write'],expiresInDays:90})})).status,400);
assert.equal((await request('/api/tokens',{method:'POST',headers:{...auth,...headerTokenAction},
  body:JSON.stringify({name:'Duplicate Scope',scopes:['faxes:read','faxes:read'],expiresInDays:30})})).status,400);
const generated=await request('/api/tokens',{method:'POST',headers:{...cookieHeader,...headerTokenAction},
  body:JSON.stringify({name:'Fax dashboard reader',scopes:['faxes:read'],expiresInDays:7})});
assert.equal(generated.status,201);
const integration=await generated.json();
assert.match(integration.token,/^fpx_[A-Za-z0-9_-]{43}$/);
assert.deepEqual(integration.scopes,['faxes:read']);
assert.ok(integration.prefix.length<=12);
const limited={Authorization:'Bearer '+integration.token};
assert.equal((await request('/api/faxes',{headers:limited})).status,200);
assert.equal((await request('/api/stats',{headers:limited})).status,200);
assert.equal((await request('/api/contacts',{headers:limited})).status,403);
assert.equal((await request('/api/reports/daily',{headers:limited})).status,403);
assert.equal((await request('/api/backup/status',{headers:limited})).status,403);
assert.equal((await request('/api/security',{headers:limited})).status,403);
assert.equal((await request('/api/tokens',{headers:limited})).status,403);
assert.equal((await request('/api/sessions',{method:'DELETE',headers:limited})).status,403);
assert.equal((await request('/api/tokens',{method:'POST',headers:{...limited,...headerTokenAction},
  body:JSON.stringify({name:'Escalation',scopes:['faxes:read'],expiresInDays:7})})).status,403);
assert.equal((await request('/api/faxes',{method:'POST',headers:{
  ...limited,'Content-Type':'application/json'},body:'{}'})).status,403);
assert.equal((await request('/api/faxes',{headers:{...limited,...cookieHeader}})).status,200);
assert.equal((await request('/api/contacts',{headers:{...limited,...cookieHeader}})).status,403,
  'Admin cookie must not elevate explicit restricted Authorization header');
const listAfterCreate=await (await request('/api/tokens',{headers:auth})).json();
assert.equal(listAfterCreate.items.length,1);
assert.equal(listAfterCreate.items[0].name,'Fax dashboard reader');
assert.ok(listAfterCreate.items[0].lastUsedAt);
assert.equal(JSON.stringify(listAfterCreate).includes(integration.token),false,
  'List response must never expose integration secrets');
const revokeId=integration.id;
assert.equal((await request('/api/tokens/'+revokeId,{method:'DELETE',headers:auth})).status,403);
assert.equal((await request('/api/tokens/'+revokeId,{method:'DELETE',
  headers:{...cookieHeader,'X-FaxingPro-Action':'token-manager'}})).status,200);
assert.equal((await request('/api/faxes',{headers:limited})).status,403);
assert.equal((await request('/api/tokens/'+revokeId,{method:'DELETE',
  headers:{...auth,'X-FaxingPro-Action':'token-manager'}})).status,404);
const reportsCreate=await request('/api/tokens',{method:'POST',headers:{...auth,...headerTokenAction},
  body:JSON.stringify({name:'Report service',scopes:['reports:read'],expiresInDays:7})});
assert.equal(reportsCreate.status,201);
const reportToken=await reportsCreate.json();
const reportAuth={Authorization:'Bearer '+reportToken.token};
assert.equal((await request('/api/reports/daily',{headers:reportAuth})).status,200);
assert.equal((await request('/api/faxes',{headers:reportAuth})).status,403);
execFileSync('docker',['compose','-f','deployment/telnyx/compose.yaml',
  '--env-file','deployment/telnyx/.env','exec','-T','db','psql','-U','faxingpro','-d','faxingpro',
  '-v','ON_ERROR_STOP=1','-c',
  "UPDATE api_tokens SET expires_at=now()-interval '1 minute' WHERE id='"+reportToken.id+"'"],
  {stdio:'pipe'});
assert.equal((await request('/api/reports/daily',{headers:reportAuth})).status,403,
  'Integration token must become unusable immediately on expiration');
const finalList=await (await request('/api/tokens',{headers:auth})).json();
assert.equal(finalList.items.length,2);
assert.equal(finalList.items.find(t=>t.id===revokeId).revokedAt!==null,true);
assert.equal(JSON.stringify(finalList).includes(reportToken.token),false);



const faxId=randomUUID(),eventId=randomUUID();
const obj={data:{id:eventId,event_type:'fax.receiving.started',
  occurred_at:new Date().toISOString(),
  payload:{fax_id:faxId,direction:'inbound',from:'+13055551234',to:'+13055559876'}}};
const raw=JSON.stringify(obj),ts=String(Math.floor(Date.now()/1000));
const priv=createPrivateKey(readFileSync('deployment/telnyx/.test-private-key.pem','utf8'));
const sig=sign(null,Buffer.from(ts+'|'+raw),priv).toString('base64');
const eventHeaders={'Content-Type':'application/json','telnyx-timestamp':ts,'telnyx-signature-ed25519':sig};
const webhookOptions={method:'POST',headers:eventHeaders,body:raw};
let res=await request('/webhooks/telnyx',webhookOptions);
assert.equal(res.status,200,'Authenticated webhook should succeed');
res=await request('/webhooks/telnyx',webhookOptions);
assert.equal(res.status,200);
assert.equal((await res.json()).duplicate,true,'Duplicate webhook must be idempotent');
// Signed, unique but out-of-order webhook events must not corrupt fax status or
// metadata. A duplicate event is still idempotent, and all unique events remain
// visible in the audit timeline. These are synthetic events in ephemeral CI only.
async function sendSignedEvent(type,occurredAt,extra={},direction='inbound',id=randomUUID()){
  const event={data:{id,event_type:type,occurred_at:occurredAt,
    payload:{fax_id:faxId,direction,from:'+13055551234',to:'+13055559876',...extra}}};
  const content=JSON.stringify(event);
  const stamp=String(Math.floor(Date.now()/1000));
  const signature=sign(null,Buffer.from(stamp+'|'+content),priv).toString('base64');
  return request('/webhooks/telnyx',{method:'POST',headers:{
    'Content-Type':'application/json','telnyx-timestamp':stamp,
    'telnyx-signature-ed25519':signature},body:content});
}
const eventBase=Date.parse(obj.data.occurred_at);
const stale=await sendSignedEvent('fax.failed',new Date(eventBase-1000).toISOString(),
  {page_count:99,failure_reason:'stale failure should be ignored'});
assert.equal(stale.status,200);
const afterStale=(await (await request('/api/faxes',{headers:auth})).json()).items.find(f=>f.telnyxId===faxId);
assert.equal(afterStale.status,'receiving');
assert.equal(afterStale.pages,0,'Stale event cannot inflate page count');
assert.equal(afterStale.failureReason,null,'Stale failure cannot overwrite failure metadata');
const receivedId=randomUUID();
const received=await sendSignedEvent('fax.received',new Date(eventBase+1000).toISOString(),
  {page_count:2},'inbound',receivedId);
assert.equal(received.status,200);
const terminalFailure=await sendSignedEvent('fax.failed',new Date(eventBase+2000).toISOString(),
  {page_count:77,failure_reason:'late failure should not replace received'});
assert.equal(terminalFailure.status,200);
const lateProgress=await sendSignedEvent('fax.receiving.started',new Date(eventBase+3000).toISOString(),
  {page_count:55});
assert.equal(lateProgress.status,200);
const wrongDirection=await sendSignedEvent('fax.failed',new Date(eventBase+4000).toISOString(),
  {page_count:44,failure_reason:'wrong direction'},'outbound');
assert.equal(wrongDirection.status,200);
const replay=await sendSignedEvent('fax.received',new Date(eventBase+1000).toISOString(),
  {page_count:2},'inbound',receivedId);
assert.equal(replay.status,200);
assert.equal((await replay.json()).duplicate,true);
const finalRecord=(await (await request('/api/faxes',{headers:auth})).json()).items.find(f=>f.telnyxId===faxId);
assert.equal(finalRecord.status,'received','Terminal delivery state is immutable');
assert.equal(finalRecord.pages,2,'Late events cannot change terminal page count');
assert.equal(finalRecord.failureReason,null,'Late failures cannot set failure reason on received fax');

const list=await (await request('/api/faxes',{headers:auth})).json();
assert.ok(list.items.some(f=>f.telnyxId===faxId&&f.direction==='inbound'));
const fromCookie=await (await request('/api/faxes',{headers:cookieHeader})).json();
assert.ok(fromCookie.items.some(f=>f.telnyxId===faxId),'Cookie session accesses real fax data');
assert.equal((await request('/api/contacts')).status,401,'Contacts must require authentication');
const badContact=await request('/api/contacts',{method:'POST',
  headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({name:'A',number:'not-a-number'})});
assert.equal(badContact.status,400);
const entry={name:'Test Technician',number:'+13055551234',email:'fax@example.invalid',
  company:'Test Services',notes:'Fax line used only in ephemeral CI'};
const created=await request('/api/contacts',{method:'POST',
  headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(entry)});
assert.equal(created.status,201);
const contact=await created.json();assert.equal(contact.number,entry.number);
const duplicate=await request('/api/contacts',{method:'POST',
  headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(entry)});
assert.equal(duplicate.status,409);
const listed=await (await request('/api/contacts',{headers:cookieHeader})).json();
assert.ok(listed.items.some(c=>c.id===contact.id));
const update=await request('/api/contacts/'+contact.id,{method:'PATCH',
  headers:{...auth,'Content-Type':'application/json'},
  body:JSON.stringify({...entry,name:'Updated Technician'})});
assert.equal(update.status,200);
assert.equal((await update.json()).name,'Updated Technician');
assert.ok((await (await request('/api/contacts?q=Updated',{headers:auth})).json())
  .items.some(c=>c.id===contact.id));
const faxRecord=fromCookie.items.find(f=>f.telnyxId===faxId);
assert.equal((await request('/api/reports/daily')).status,401);
const daily=await request('/api/reports/daily',{headers:auth});
assert.equal(daily.status,200);
const dailyReport=await daily.json();
assert.equal(dailyReport.days.length,30);
assert.equal(dailyReport.timezone,'UTC');
assert.ok(dailyReport.days.some(d=>d.received>=1));
assert.equal((await request('/api/faxes/'+faxRecord.id+'/events')).status,401);
const timeline=await request('/api/faxes/'+faxRecord.id+'/events',{headers:auth});
assert.equal(timeline.status,200);
const timelineEvents=(await timeline.json()).events;
assert.ok(timelineEvents.some(e=>e.type==='fax.receiving.started'));
assert.equal(timelineEvents.filter(e=>e.type==='fax.received').length,1,
  'Replayed signed webhook must not create duplicate event history');
assert.ok(timelineEvents.some(e=>e.type==='fax.failed'),
  'Out-of-order events remain visible for operator reconciliation');


// The reconciliation queue is read-only and must not infer that an unknown
// provider response failed. Synthetic rows exist only in this isolated CI DB.
assert.equal((await request('/api/reconciliation')).status,401);
const emptyReview=await request('/api/reconciliation',{headers:auth});
assert.equal(emptyReview.status,200);
assert.deepEqual((await emptyReview.json()).items,[]);
const unknownId=randomUUID(),stalledId=randomUUID(),recentId=randomUUID();
const deliveredId=randomUUID(),unknownProviderId=randomUUID();
const insertSql=`INSERT INTO faxes(id,telnyx_id,direction,status,from_number,to_number,title,updated_at,last_event_at)
 VALUES
 ('${unknownId}','${unknownProviderId}','outbound','unknown','+13055551234','+13055559876','Unknown CI fax',now(),now()),
 ('${stalledId}',NULL,'outbound','queued','+13055551234','+13055559876','Stalled CI fax',now()-interval '45 minutes',now()-interval '45 minutes'),
 ('${recentId}',NULL,'outbound','queued','+13055551234','+13055559876','Recent CI fax',now(),now()),
 ('${deliveredId}',NULL,'outbound','delivered','+13055551234','+13055559876','Delivered CI fax',now()-interval '45 minutes',now()-interval '45 minutes')`;
execFileSync('docker',['compose','-f','deployment/telnyx/compose.yaml','--env-file','deployment/telnyx/.env',
  'exec','-T','db','psql','-U','faxingpro','-d','faxingpro','-v','ON_ERROR_STOP=1','-c',insertSql],
  {stdio:'pipe'});
const correlated=await sendSignedEvent('fax.queued',new Date(Date.now()-3600000).toISOString(),
  {fax_id:unknownProviderId},'outbound');
assert.equal(correlated.status,200);
const reviewResponse=await request('/api/reconciliation',{headers:cookieHeader});
assert.equal(reviewResponse.status,200);
const review=await reviewResponse.json();
assert.equal(review.readOnly,true);
assert.equal(review.staleAfterMinutes,30);
assert.equal(review.limit,50);
assert.ok(review.items.some(x=>x.id===unknownId&&x.status==='unknown'));
assert.ok(review.items.some(x=>x.id===stalledId));
assert.ok(!review.items.some(x=>x.id===recentId));
assert.ok(!review.items.some(x=>x.id===deliveredId));
const unknownReview=review.items.find(x=>x.id===unknownId);
assert.equal(unknownReview.telnyxId,unknownProviderId);
assert.equal(unknownReview.events.length,1);
assert.equal(unknownReview.events[0].type,'fax.queued');
assert.ok(unknownReview.events[0].receivedAt);
assert.equal((await request('/api/reconciliation',{method:'POST',headers:auth})).status,405);
const stillUnknown=(await (await request('/api/faxes?folder=all',{headers:auth})).json())
  .items.find(x=>x.id===unknownId);
assert.equal(stillUnknown.status,'unknown','Reconciliation must not change fax status');

assert.equal(faxRecord.readAt,null);
assert.equal((await request('/api/notifications')).status,401);
assert.equal((await request('/api/notifications/preferences')).status,401);
const preferences=await request('/api/notifications/preferences',{headers:auth});
assert.equal(preferences.status,200);
assert.equal((await preferences.json()).browserEnabled,false);
const invalidPreference=await request('/api/notifications/preferences',{method:'PATCH',
  headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({browserEnabled:'yes'})});
assert.equal(invalidPreference.status,400);
const enabledPreference=await request('/api/notifications/preferences',{method:'PATCH',
  headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({browserEnabled:true})});
assert.equal(enabledPreference.status,200);
assert.equal((await enabledPreference.json()).browserEnabled,true);
const notificationBefore=await (await request('/api/notifications',{headers:auth})).json();
assert.ok(notificationBefore.items.some(n=>n.faxId===faxRecord.id&&n.kind==='incoming'));
assert.ok(notificationBefore.total>=1);

assert.equal(faxRecord.archivedAt,null);
assert.equal((await request('/api/faxes/'+faxRecord.id+'/read',{method:'PATCH',
  headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({enabled:true})})).status,200);
const afterRead=await (await request('/api/faxes?folder=active',{headers:auth})).json();
assert.ok(afterRead.items.some(f=>f.id===faxRecord.id&&f.readAt));
assert.ok(!(await (await request('/api/notifications',{headers:auth})).json())
  .items.some(n=>n.faxId===faxRecord.id&&n.kind==='incoming'),
  'Marking the fax read removes unread notification');

assert.equal((await request('/api/faxes/'+faxRecord.id+'/archive',{method:'PATCH',
  headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({enabled:true})})).status,200);
assert.ok(!(await (await request('/api/faxes?folder=active',{headers:auth})).json())
  .items.some(f=>f.id===faxRecord.id),'Archived fax hidden from active records');
assert.ok((await (await request('/api/faxes?folder=archived&q=13055551234',{headers:auth})).json())
  .items.some(f=>f.id===faxRecord.id),'Archived fax searchable server-side');
assert.equal((await request('/api/faxes/'+faxRecord.id+'/archive',{method:'PATCH',
  headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({enabled:false})})).status,200);
assert.ok((await (await request('/api/faxes?folder=active',{headers:auth})).json())
  .items.some(f=>f.id===faxRecord.id),'Fax can be restored without deletion');
assert.equal((await request('/api/contacts/'+contact.id,{method:'DELETE',headers:auth})).status,200);
assert.equal((await request('/api/contacts/'+contact.id,{method:'PATCH',
  headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(entry)})).status,404);
assert.ok((await (await request('/api/faxes?folder=active',{headers:auth})).json())
  .items.some(f=>f.id===faxRecord.id),'Deleting contact never deletes associated fax');

const logout=await request('/api/session',{method:'DELETE',headers:cookieHeader});
assert.equal(logout.status,200);
assert.equal((await (await request('/api/session',{headers:cookieHeader})).json()).authenticated,false,
  'Revoked session must not be reusable');
assert.equal((await request('/api/faxes',{headers:cookieHeader})).status,401);
assert.equal((await request('/api/security')).status,401);
const securityBefore=await request('/api/security',{headers:auth});
assert.equal(securityBefore.status,200);
assert.equal((await securityBefore.json()).mode,'single-operator');
assert.equal((await request('/api/sessions',{method:'DELETE'})).status,401);

// Eight failed attempts inside the rolling 15-minute window trigger a shared throttle.
// The real operator token must still work even if an attacker floods bad attempts.
for(let i=1;i<=9;i++){
  const response=await request('/api/session',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:'definitely-wrong-'+i})
  });
  assert.equal(response.status,i>=8?429:401);
  if(i>=8)assert.equal(response.headers.get('retry-after'),'900');
}
const audit=await (await request('/api/security',{headers:auth})).json();
assert.ok(audit.failedLogins24h>=8,'Failed logins recorded in operator audit');
assert.ok(audit.events.some(event=>event.type==='login_failure'));
const validDespiteThrottle=await request('/api/session',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({token:env.API_TOKEN})
});
assert.equal(validDespiteThrottle.status,200,'Real operator remains able to login under throttle');
const secondCookie=validDespiteThrottle.headers.get('set-cookie')?.split(';')[0];
assert.ok(secondCookie?.startsWith('__Host-faxingpro_session='));
const securityAfterLogin=await (await request('/api/security',{headers:auth})).json();
assert.ok(securityAfterLogin.activeSessions>=1);
const revokeAll=await request('/api/sessions',{method:'DELETE',headers:auth});
assert.equal(revokeAll.status,200);
assert.ok((await revokeAll.json()).revoked>=1);
assert.equal((await (await request('/api/session',{headers:{Cookie:secondCookie}})).json()).authenticated,false);
assert.equal((await request('/api/faxes',{headers:{Cookie:secondCookie}})).status,401);
assert.equal((await request('/api/faxes',{headers:auth})).status,200,'Script bearer-token still functions');
const bad=await request('/webhooks/telnyx',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});
assert.equal(bad.status,401);
const send=await request('/api/faxes',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:'{}'});
assert.equal(send.status,503,'Outbound must remain locked');
console.log('PASS: read-only integration scopes, token revocation, expiration, secret safety, outbound reconciliation, webhook replay/out-of-order/terminal metadata safety, authenticated notification preferences, real unread alerts, contacts, fax archives, signed events, 30-day reports, backups, login throttling and safety restrictions');
