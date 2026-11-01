import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMasterBearerMode,masterBearerAllowed} from '../server/operator-auth-policy.mjs';
test('legacy compatibility is default and explicitly selectable',()=>{
  assert.equal(parseMasterBearerMode(undefined,false),'legacy');
  assert.equal(parseMasterBearerMode('',true),'legacy');
  assert.equal(parseMasterBearerMode('legacy',false),'legacy');
  assert.equal(masterBearerAllowed('legacy'),true);
});
test('lockdown requires configured TOTP and rejects typos/fail-open modes',()=>{
  assert.throws(()=>parseMasterBearerMode('disabled',false),/requires OPERATOR_TOTP_SECRET/);
  assert.equal(parseMasterBearerMode('disabled',true),'disabled');
  assert.equal(masterBearerAllowed('disabled'),false);
  for(const bad of ['DISABLED','false','off','enabled','disable','disabled '])
    assert.throws(()=>parseMasterBearerMode(bad,true),/Invalid OPERATOR_BEARER_MODE/);
});
