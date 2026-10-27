import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const env=Object.fromEntries(readFileSync('deployment/telnyx/.env','utf8')
  .split('\n').filter(s=>s&&!s.startsWith('#')&&s.includes('='))
  .map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
const result=await fetch('http://127.0.0.1:8092/api/backup/status',{
  headers:{Authorization:'Bearer '+env.API_TOKEN}});
assert.equal(result.status,200);
const body=await result.json();
assert.equal(body.offsiteProvider,'Google Drive');
assert.equal(body.offsiteFreshness,'current');
assert.equal(body.offsiteVerified,true);
assert.ok(body.runs[0].drive_verified_at);
assert.equal(body.scheduleVerified,false);
console.log('PASS: Google Drive upload status reflects the newest archive verification');
