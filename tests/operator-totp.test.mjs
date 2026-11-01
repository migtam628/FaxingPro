import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTotpSecret,encodeTotpSecret,generateTotpSecret,totpAtStep,matchTotp,fingerprintTotp} from '../server/operator-totp.mjs';

test('RFC 6238 SHA-1 test vectors',()=>{
  const seed=Buffer.from('12345678901234567890','ascii');
  assert.equal(encodeTotpSecret(seed),'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(decodeTotpSecret(encodeTotpSecret(seed)),seed);
  assert.equal(totpAtStep(seed,Math.floor(59/30),8),'94287082');
  assert.equal(totpAtStep(seed,Math.floor(1111111109/30),8),'07081804');
  assert.equal(totpAtStep(seed,Math.floor(1111111111/30),8),'14050471');
  assert.equal(totpAtStep(seed,Math.floor(1234567890/30),8),'89005924');
  assert.equal(totpAtStep(seed,Math.floor(2000000000/30),8),'69279037');
});
test('reject invalid keys and return non-secret time step',()=>{
  for(const bad of ['', 'jbswy3dpehpk3pxpjbswy3dpehpk3pxp','ABCD','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA!']){
    assert.throws(()=>decodeTotpSecret(bad));
  }
  const key=decodeTotpSecret(generateTotpSecret());
  assert.equal(key.length,20);
  const now=1800000000000;
  const step=Math.floor(now/30000);
  assert.equal(matchTotp(key,totpAtStep(key,step),now),step);
  assert.equal(matchTotp(key,totpAtStep(key,step-1),now),step-1);
  assert.equal(matchTotp(key,totpAtStep(key,step+1),now),step+1);
  assert.equal(matchTotp(key,totpAtStep(key,step-2),now),null);
  assert.equal(matchTotp(key,'00000x',now),null);
  assert.equal(matchTotp(key,'9999999',now),null);
  assert.match(fingerprintTotp(key),/^[0-9a-f]{64}$/);
});
