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
writeFileSync(file,env,{mode:0o600});
writeFileSync('deployment/telnyx/.test-private-key.pem',
  privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
