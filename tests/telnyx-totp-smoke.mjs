import assert from 'node:assert/strict';
import {decodeTotpSecret,totpAtStep} from '../server/operator-totp.mjs';
const base='http://127.0.0.1:8092';
const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // Disposable RFC test seed only.
const fs=await import('node:fs');
const content=fs.readFileSync('deployment/telnyx/.env','utf8');
const operatorToken=content.match(/^API_TOKEN=(.+)$/m)?.[1];
assert.ok(operatorToken?.length>=32);
const request=(path,opts={})=>fetch(base+path,opts);
let required=false;
for(let attempt=0;attempt<25;attempt++){
  try{
    const response=await request('/api/session');
    if(response.ok && (await response.json()).mfaRequired){required=true;break;}
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,700));
}
assert.ok(required,'API must require TOTP after safe test-container recreation');
const json={'Content-Type':'application/json'};
const noCode=await request('/api/session',{method:'POST',headers:json,
  body:JSON.stringify({token:operatorToken})});
assert.equal(noCode.status,401,'Master operator token alone must not produce a new browser session');
const badCode=await request('/api/session',{method:'POST',headers:json,
  body:JSON.stringify({token:operatorToken,otp:'12345x'})});
assert.equal(badCode.status,401);
const key=decodeTotpSecret(secret);
const code=totpAtStep(key,Math.floor(Date.now()/30000));
const signedIn=await request('/api/session',{method:'POST',headers:json,
  body:JSON.stringify({token:operatorToken,otp:code})});
assert.equal(signedIn.status,200);
const state=await signedIn.json();
assert.equal(state.authenticated,true);
assert.equal(state.mfaRequired,true);
const cookie=signedIn.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie?.startsWith('__Host-faxingpro_session='));
assert.equal((await request('/api/faxes',{headers:{Cookie:cookie}})).status,200);
const replay=await request('/api/session',{method:'POST',headers:json,
  body:JSON.stringify({token:operatorToken,otp:code})});
assert.equal(replay.status,401,'Reusing one-time code must not issue a second session');
// This is an intentionally documented limitation of this browser-only milestone.
assert.equal((await request('/api/faxes',{headers:{Authorization:'Bearer '+operatorToken}})).status,200);
const status=await request('/api/security',{headers:{Cookie:cookie}});
assert.equal(status.status,200);
const info=await status.json();
assert.equal(info.mfaEnabled,true);
assert.equal(info.mfaScope,'browser-session-only');
const logout=await request('/api/session',{method:'DELETE',headers:{Cookie:cookie}});
assert.equal(logout.status,200);
assert.equal((await request('/api/faxes',{headers:{Cookie:cookie}})).status,401);
console.log('PASS: TOTP browser challenge, invalid credential rejection, one-time replay prevention, scoped status, logout and legacy master bearer compatibility');
