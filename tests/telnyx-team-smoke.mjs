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
const createdAudit=await (await request('/api/security',{headers:master})).json();
const createdEvent=createdAudit.events.find(e=>e.type==='team_user_created'&&e.targetId===id);
assert.equal(createdEvent?.actorKind,'owner','Owner must be attributed for account creation');
assert.equal(createdEvent?.actorName,'Owner');
assert.equal(createdEvent?.targetType,'team_user');
assert.equal(JSON.stringify(createdAudit).includes(data.credentials.totpSecret),false);
assert.equal(JSON.stringify(createdAudit).includes(data.credentials.password),false);
const key=decodeTotpSecret(data.credentials.totpSecret);
const code=totpAtStep(key,Math.floor(Date.now()/30000));
const login=await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({email,password:data.credentials.password,otp:code})});
assert.equal(login.status,200);
const session=await login.json();
assert.equal(session.identity.role,'viewer');
const loginAudit=await (await request('/api/security',{headers:master})).json();
const loggedIn=loginAudit.events.find(e=>e.type==='team_login_success'&&e.actorUserId===id);
assert.equal(loggedIn?.actorKind,'team');
assert.equal(loggedIn?.actorName,'CI Viewer');
assert.equal(loggedIn?.actorRole,'viewer');
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
const updatedAudit=await (await request('/api/security',{headers:master})).json();
const roleEvent=updatedAudit.events.find(e=>e.type==='team_role_changed'&&e.targetId===id);
assert.equal(roleEvent?.actorKind,'owner');
const changePrefs=await request('/api/notifications/preferences',{method:'PATCH',
  headers:{...browser,'Content-Type':'application/json'},body:JSON.stringify({browserEnabled:false})});
assert.equal(changePrefs.status,200,'Operator role upgrade must take effect without re-login');
assert.equal((await request('/api/team/users',{headers:browser})).status,403);
assert.equal((await change({role:'admin'})).status,200);
assert.equal((await request('/api/team/users',{headers:browser})).status,200,
  'Admin promotion should take effect immediately');
const namedAdminAudit=await request('/api/security',{headers:browser});
assert.equal(namedAdminAudit.status,200,'Named administrator can review audit history');
assert.equal((await request('/api/team/users/'+id,{method:'PATCH',
  headers:{...browser,'Content-Type':'application/json','X-FaxingPro-Action':'team-manager'},
  body:JSON.stringify({disabled:true})})).status,403,'Admin cannot disable own account');
const rotated=await request('/api/team/users/'+id+'/reset',{
  method:'POST',headers:{...management}});
assert.equal(rotated.status,200);
const replacement=await rotated.json();
assert.equal((await request('/api/faxes',{headers:browser})).status,401,
  'Credential recovery must revoke the old session immediately');
const oldPassword=await request('/api/session',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({email,password:data.credentials.password,otp:code})});
assert.equal(oldPassword.status,401);
const replacementCode=totpAtStep(decodeTotpSecret(replacement.credentials.totpSecret),Math.floor(Date.now()/30000));
const freshLogin=await request('/api/session',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({email,password:replacement.credentials.password,otp:replacementCode})});
assert.equal(freshLogin.status,200);
const freshCookie=freshLogin.headers.get('set-cookie')?.split(';')[0];
assert.ok(freshCookie);
assert.equal((await request('/api/team/users',{headers:{Cookie:freshCookie}})).status,200);
assert.equal((await change({disabled:true})).status,200);
const finalAudit=await (await request('/api/security',{headers:master})).json();
const disabledEvent=finalAudit.events.find(e=>e.type==='team_user_disabled'&&e.targetId===id);
assert.equal(disabledEvent?.actorKind,'owner');
const rotateEvent=finalAudit.events.find(e=>e.type==='team_credentials_rotated'&&e.targetId===id);
assert.equal(rotateEvent?.actorKind,'owner');
assert.equal((await request('/api/team/users',{headers:{Cookie:freshCookie}})).status,401,
  'Disabled user loses newly rotated sessions');
assert.equal((await request('/api/faxes',{headers:browser})).status,401,'Disabled user sessions must be revoked immediately');
assert.equal((await (await request('/api/session',{headers:browser})).json()).authenticated,false);
assert.equal((await request('/api/team/users',{headers:browser})).status,401);
assert.equal((await request('/api/team/users',{headers:master})).status,200,'Owner recovery remains available');
console.log('PASS: named account creation, one-time private credentials, TOTP replay, viewer/operator/admin access and immediate disable');
