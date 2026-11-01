import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeTotpSecret,totpAtStep} from '../server/operator-totp.mjs';
assert.equal(process.env.CI,'true');
assert.equal(process.env.GITHUB_ACTIONS,'true');
const cfg=Object.fromEntries(readFileSync('deployment/telnyx/.env','utf8')
  .split('\n').filter(v=>v&&!v.startsWith('#')&&v.includes('='))
  .map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
assert.equal(cfg.SEND_ENABLED,'false');
const base='http://127.0.0.1:8092';
const request=(p,options={})=>fetch(base+p,options);
const master={Authorization:'Bearer '+cfg.API_TOKEN};
const management={...master,'Content-Type':'application/json','X-FaxingPro-Action':'team-manager'};
const email='viewer-ci@example.invalid';
assert.equal((await request('/api/team/users')).status,401);
const created=await request('/api/team/users',{method:'POST',headers:management,
  body:JSON.stringify({name:'CI Viewer',email,role:'viewer'})});
assert.equal(created.status,201);
const data=await created.json();
assert.equal(data.user.role,'viewer');
assert.equal(data.user.email,email);
assert.ok(data.credentials.password.length>=30);
assert.match(data.credentials.totpSecret,/^[A-Z2-7]{32}$/);
const listed=await request('/api/team/users',{headers:master});
assert.equal(listed.status,200);
assert.ok((await listed.text()).includes(email));
const id=data.user.id;
const key=decodeTotpSecret(data.credentials.totpSecret);
const code=totpAtStep(key,Math.floor(Date.now()/30000));
const login=await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({email,password:data.credentials.password,otp:code})});
assert.equal(login.status,200);
const session=await login.json();
assert.equal(session.identity.role,'viewer');
const cookie=login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie?.startsWith('__Host-faxingpro_session='));
const browser={Cookie:cookie};
assert.equal((await request('/api/faxes',{headers:browser})).status,200);
assert.equal((await request('/api/reports/daily',{headers:browser})).status,200);
assert.equal((await request('/api/team/users',{headers:browser})).status,403);
assert.equal((await request('/api/security',{headers:browser})).status,403);
assert.equal((await request('/api/faxes',{method:'POST',headers:browser})).status,403);
assert.equal((await request('/api/backup/status',{headers:browser})).status,403);
assert.equal((await request('/api/contacts',{method:'POST',headers:browser})).status,403);
const replay=await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({email,password:data.credentials.password,otp:code})});
assert.equal(replay.status,401,'One-time code cannot be used twice');
const change=(payload)=>request('/api/team/users/'+id,{method:'PATCH',headers:management,body:JSON.stringify(payload)});
assert.equal((await change({role:'operator'})).status,200);
const changePrefs=await request('/api/notification-preferences',{method:'PATCH',
  headers:{...browser,'Content-Type':'application/json'},body:JSON.stringify({browserEnabled:false})});
assert.equal(changePrefs.status,200,'Operator role upgrade must take effect without re-login');
assert.equal((await request('/api/team/users',{headers:browser})).status,403);
assert.equal((await change({role:'admin'})).status,200);
assert.equal((await request('/api/team/users',{headers:browser})).status,200,
  'Admin promotion should take effect immediately');
assert.equal((await request('/api/team/users/'+id,{method:'PATCH',
  headers:{...browser,'Content-Type':'application/json','X-FaxingPro-Action':'team-manager'},
  body:JSON.stringify({disabled:true})})).status,403,'Admin cannot disable own account');
assert.equal((await change({disabled:true})).status,200);
assert.equal((await request('/api/faxes',{headers:browser})).status,401,'Disabled user sessions must be revoked immediately');
assert.equal((await (await request('/api/session',{headers:browser})).json()).authenticated,false);
assert.equal((await request('/api/team/users',{headers:browser})).status,401);
assert.equal((await request('/api/team/users',{headers:master})).status,200,'Owner recovery remains available');
console.log('PASS: named account creation, one-time private credentials, TOTP replay, viewer/operator/admin access and immediate disable');
