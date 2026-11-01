import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {normalizeEmail,normalizeName,generateTemporaryPassword,hashPassword,verifyPassword,encryptTeamTotp,decryptTeamTotp,teamRoleAllows} from '../server/team-auth.mjs';
test('names and emails are bounded and canonical',()=>{
  assert.equal(normalizeEmail(' Admin@Example.com '),'admin@example.com');
  assert.equal(normalizeEmail('foo'),null);
  assert.equal(normalizeName(' Ava Patel '),'Ava Patel');
  assert.equal(normalizeName('X'),null);
});
test('generated passwords use salted scrypt and cannot be verified by wrong input',async()=>{
  const p=generateTemporaryPassword(),hash=await hashPassword(p),again=await hashPassword(p);
  assert.ok(p.length>=30);
  assert.notEqual(hash,again);
  assert.equal(await verifyPassword(p,hash),true);
  assert.equal(await verifyPassword('this-is-wrong-password',hash),false);
  assert.equal(await verifyPassword(p,'bad-format'),false);
});
test('TOTP keys are encrypted at rest and reject tampering',()=>{
  const key=randomBytes(32).toString('hex'),cipher=encryptTeamTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',key);
  assert.equal(decryptTeamTotp(cipher,key),'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.notEqual(cipher.slice(-32),'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.throws(()=>decryptTeamTotp(cipher.slice(0,-2)+'ff',key));
});
test('role allowlist is deny-by-default, including sending, PDF and management',()=>{
  const id='123e4567-e89b-42d3-a456-426614174000',doc='/api/faxes/'+id+'/document';
  assert.equal(teamRoleAllows('viewer','GET',doc),true);
  assert.equal(teamRoleAllows('viewer','POST','/api/faxes'),false);
  assert.equal(teamRoleAllows('viewer','GET','/api/security'),false);
  assert.equal(teamRoleAllows('viewer','GET','/api/backup/status'),false);
  assert.equal(teamRoleAllows('operator','POST','/api/faxes'),true);
  assert.equal(teamRoleAllows('operator','PATCH','/api/faxes/'+id+'/read'),true);
  assert.equal(teamRoleAllows('operator','DELETE','/api/contacts/'+id),true);
  assert.equal(teamRoleAllows('operator','POST','/api/team/users'),false);
  assert.equal(teamRoleAllows('operator','GET','/api/tokens'),false);
  assert.equal(teamRoleAllows('operator','GET','/api/security'),false);
  assert.equal(teamRoleAllows('admin','GET','/api/security'),true);
  assert.equal(teamRoleAllows('viewer','GET','/api/unknown'),false);
  assert.equal(teamRoleAllows('superadmin','GET','/api/faxes'),false);
});
