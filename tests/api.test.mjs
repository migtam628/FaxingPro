import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

test('API is authentication-protected and cannot fake a successful fax', async () => {
  const port=20000+Math.floor(Math.random()*30000);
  const token='safe-test-token-0123456789-abcdefghijklmnopqrstuvwxyz';
  const child=spawn(process.execPath,['server/index.mjs'],{
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',API_TOKEN:token,FAX_TRANSPORT:'disabled'},
    stdio:'ignore'
  });
  try {
    let health;
    for(let i=0;i<40;i++){
      if(child.exitCode!==null)throw new Error('API exited unexpectedly');
      try {const r=await fetch('http://127.0.0.1:'+port+'/healthz');health=await r.json();break;}catch{await sleep(75);}
    }
    assert.equal(health?.ok,true);
    assert.equal(health?.faxEnabled,false);
    const unauth=await fetch('http://127.0.0.1:'+port+'/api/faxes');
    assert.equal(unauth.status,401);
    const disabled=await fetch('http://127.0.0.1:'+port+'/api/faxes',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({recipient:'+15550000000'})
    });
    assert.equal(disabled.status,503);
    const data=await disabled.json();
    assert.match(data.error,/disabled/);
    const list=await fetch('http://127.0.0.1:'+port+'/api/faxes',{headers:{Authorization:'Bearer '+token}});
    assert.deepEqual((await list.json()).items,[]);
  } finally {
    child.kill();
  }
});

test('API refuses to boot with the default/missing secret', async () => {
  const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,API_TOKEN:''}});
  const code=await new Promise(resolve=>child.on('exit',resolve));
  assert.equal(code,1);
});

test('API refuses the public example token even though it is long enough', async () => {
  const child=spawn(process.execPath,['server/index.mjs'],{
    env:{...process.env,API_TOKEN:'REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS'},
    stdio:'ignore'
  });
  const code=await new Promise(resolve=>child.on('exit',resolve));
  assert.equal(code,1);
});
