import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const env=Object.fromEntries(readFileSync('deployment/telnyx/.env','utf8')
  .split('\n').filter(s=>s&&!s.startsWith('#')&&s.includes('='))
  .map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
const base='http://127.0.0.1:8092';
const result=await fetch(base+'/api/backup/status',{headers:{Authorization:'Bearer '+env.API_TOKEN}});
assert.equal(result.status,200);
const info=await result.json();
assert.equal(info.configured,true);
assert.equal(info.freshness,'recent');
assert.ok(info.lastSuccessfulAt);
assert.ok(info.ageHours>=0&&info.ageHours<=1);
assert.equal(info.scheduleVerified,false);
assert.equal(info.offsiteVerified,false);
assert.equal(info.runs.length,1);
console.log('PASS: encrypted archive creation is recorded and recent, without misreporting timer or offsite status');
