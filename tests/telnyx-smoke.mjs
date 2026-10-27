import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, sign, createPrivateKey } from 'node:crypto';

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
const list=await (await request('/api/faxes',{headers:auth})).json();
assert.ok(list.items.some(f=>f.telnyxId===faxId&&f.direction==='inbound'));
const fromCookie=await (await request('/api/faxes',{headers:cookieHeader})).json();
assert.ok(fromCookie.items.some(f=>f.telnyxId===faxId),'Cookie session accesses real fax data');
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
console.log('PASS: backups, security audit, login throttling, revoke-all sessions, health, Telnyx signed webhooks, database persistence and outbound restrictions');
