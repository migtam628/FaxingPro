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
const bad=await request('/webhooks/telnyx',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});
assert.equal(bad.status,401);
const send=await request('/api/faxes',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:'{}'});
assert.equal(send.status,503,'Outbound must remain locked');
console.log('PASS: health, auth, signed webhook, idempotency, database persistence, outbound lock');
