import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const env=Object.fromEntries(readFileSync('deployment/telnyx/.env','utf8')
  .split('\n').filter(s=>s&&!s.startsWith('#')&&s.includes('='))
  .map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
const response=await fetch('http://127.0.0.1:8092/api/backup/status',{
  headers:{Authorization:'Bearer '+env.API_TOKEN}});
assert.equal(response.status,200);
const body=await response.json();
assert.equal(body.configured,true);
assert.equal(body.offsiteProvider,'Google Drive');
assert.equal(body.offsiteVerified,false,'Unverified latest snapshot must not show offsite success');
assert.equal(body.offsiteFreshness,'pending','Latest failed check remains pending until verified');
assert.equal(body.runs.length,2);
assert.equal(body.runs[0].drive_verified_at,null);
assert.ok(body.runs[1].drive_verified_at,'Prior snapshot remains verified');
console.log('PASS: failed remote checksum does not create a false latest offsite success');
