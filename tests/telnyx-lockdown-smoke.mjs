import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {decodeTotpSecret,totpAtStep} from '../server/operator-totp.mjs';

// Runs exclusively against synthetic CI credentials/volumes with sending disabled.
assert.equal(process.env.CI,'true','Do not run lockdown smoke test on a live server');
assert.equal(process.env.GITHUB_ACTIONS,'true','Disposable GitHub Actions runner required');
const env=Object.fromEntries(readFileSync('deployment/telnyx/.env','utf8').split('\n')
  .filter(x=>x&&!x.startsWith('#')&&x.includes('='))
  .map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
assert.equal(env.SEND_ENABLED,'false');
assert.equal(env.OPERATOR_BEARER_MODE,'disabled');
const testSecret='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
assert.equal(env.OPERATOR_TOTP_SECRET,testSecret);
const base='http://127.0.0.1:8092';
const request=(p,options={})=>fetch(base+p,options);
let ready=false;
for(let i=0;i<35;i++){
  try{
    const response=await request('/api/session');
    if(response.ok){
      const data=await response.json();
      if(data.mfaRequired===true && data.masterBearerEnabled===false){
        ready=true; break;
      }
    }
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
}
assert.ok(ready,'Strict-mode API did not become ready');
const master={Authorization:'Bearer '+env.API_TOKEN};
assert.equal((await request('/api/faxes',{headers:master})).status,403);
assert.equal((await request('/api/security',{headers:master})).status,403);
assert.equal((await request('/api/tokens',{headers:master})).status,403);
assert.equal((await request('/api/faxes',{method:'POST',headers:master})).status,403);
const json={'Content-Type':'application/json'};
assert.equal((await request('/api/session',{method:'POST',headers:json,
  body:JSON.stringify({token:env.API_TOKEN})})).status,401);
const key=decodeTotpSecret(testSecret);
const otp=totpAtStep(key,Math.floor(Date.now()/30000));
const login=await request('/api/session',{method:'POST',headers:json,
  body:JSON.stringify({token:env.API_TOKEN,otp})});
assert.equal(login.status,200);
const loginData=await login.json();
assert.equal(loginData.authenticated,true);
assert.equal(loginData.masterBearerEnabled,false);
const cookie=login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie?.startsWith('__Host-faxingpro_session='));
assert.equal((await request('/api/faxes',{headers:{Cookie:cookie}})).status,200);
assert.equal((await request('/api/faxes',{headers:{...master,Cookie:cookie}})).status,403,
  'Supplying the blocked master bearer must never fall back to a valid operator cookie');
const sec=await (await request('/api/security',{headers:{Cookie:cookie}})).json();
assert.equal(sec.masterBearerEnabled,false);
assert.equal(sec.mfaEnabled,true);
assert.equal(sec.mfaScope,'operator-session-required');
const invalidRaw=randomBytes(32).toString('base64url');
const invalidHash=createHash('sha256').update(invalidRaw).digest('hex');
const fingerprint=createHash('sha256').update(env.API_TOKEN).digest('hex');
// Simulate a pre-hardening session with no TOTP assurance in disposable CI DB.
const sql="INSERT INTO operator_sessions(token_hash,token_fingerprint,expires_at,assurance_fingerprint) "+
  "VALUES('"+invalidHash+"','"+fingerprint+"',now()+interval '1 day',NULL)";
execFileSync('docker',['compose','-f','deployment/telnyx/compose.yaml','--env-file',
  'deployment/telnyx/.env','exec','-T','db','psql','-U','faxingpro','-d',
  'faxingpro','-v','ON_ERROR_STOP=1','-c',sql],{stdio:'pipe'});
const legacyCookie='__Host-faxingpro_session='+invalidRaw;
assert.equal((await (await request('/api/session',{headers:{Cookie:legacyCookie}})).json()).authenticated,false,
  'Legacy session with missing MFA assurance must be invalidated');
assert.equal((await request('/api/faxes',{headers:{Cookie:legacyCookie}})).status,401);
const created=await request('/api/tokens',{method:'POST',
  headers:{Cookie:cookie,'Content-Type':'application/json','X-FaxingPro-Action':'token-manager'},
  body:JSON.stringify({name:'CI read-only lockdown',scopes:['faxes:read'],expiresInDays:7})});
assert.equal(created.status,201,'TOTP-assured operator should still manage scoped integration tokens');
const integration=await created.json();
const restricted={Authorization:'Bearer '+integration.token};
assert.equal((await request('/api/faxes',{headers:restricted})).status,200);
assert.equal((await request('/api/tokens',{headers:restricted})).status,403);
assert.equal((await request('/api/faxes',{method:'POST',headers:restricted})).status,403);
const replay=await request('/api/session',{method:'POST',headers:json,
  body:JSON.stringify({token:env.API_TOKEN,otp})});
assert.equal(replay.status,401,'TOTP time-step must remain non-replayable under lockdown');
await request('/api/session',{method:'DELETE',headers:{Cookie:cookie}});
assert.equal((await request('/api/faxes',{headers:{Cookie:cookie}})).status,401);
console.log('PASS: strict master bearer rejection, TOTP operator cookie, session assurance migration, anti-cookie fallback, scoped integrations and replay protection');
