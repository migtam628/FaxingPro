import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
const file='deployment/telnyx/.env';
let env=readFileSync('deployment/telnyx/.env.example','utf8');
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const pub=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
for(const variable of ['DB_PASSWORD','API_TOKEN','MEDIA_SIGNING_SECRET','STORAGE_ENCRYPTION_KEY']){
  env=env.replace(new RegExp('^'+variable+'=.*$','m'),variable+'='+randomBytes(32).toString('hex'));
}
env=env.replace(/^TELNYX_PUBLIC_KEY=.*$/m,'TELNYX_PUBLIC_KEY='+pub);
env=env.replace(/^TELNYX_API_KEY=.*$/m,'TELNYX_API_KEY=ci-test-key-not-for-real-calls');
env=env.replace(/^TELNYX_FAX_APP_ID=.*$/m,'TELNYX_FAX_APP_ID=0e14f655-46c8-4769-a8ea-dd954f7b4318');
env=env.replace(/^TELNYX_FROM_NUMBER=.*$/m,'TELNYX_FROM_NUMBER=+13055551234');
env=env.replace(/^TELNYX_PUBLIC_BASE_URL=.*$/m,'TELNYX_PUBLIC_BASE_URL=https://fax.test.example');

writeFileSync(file,env,{mode:0o600});
writeFileSync('deployment/telnyx/.test-private-key.pem',
  privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
