import {createHmac, createHash, timingSafeEqual, randomBytes} from 'node:crypto';

// RFC 6238 SHA-1 TOTP. Strict unpadded RFC 4648 Base32, minimum 160-bit key.
export function decodeTotpSecret(value) {
  if(typeof value!=='string' || !/^[A-Z2-7]{32,128}$/.test(value) ||
    value.length % 8!==0) throw Error('Invalid TOTP secret: use 32-128 unpadded uppercase Base32 characters');
  let bits=0,acc=0;
  const bytes=[];
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  for(const ch of value){
    acc=(acc<<5)|alphabet.indexOf(ch);
    bits+=5;
    if(bits>=8){bits-=8;bytes.push((acc>>bits)&255);acc&=(1<<bits)-1;}
  }
  if(bits>0&&acc!==0)throw Error('Invalid nonzero TOTP trailing bits');
  if(bytes.length<20)throw Error('TOTP secret must contain at least 160 bits');
  return Buffer.from(bytes);
}
export function encodeTotpSecret(bytes) {
  if(!Buffer.isBuffer(bytes) || bytes.length<20)throw Error('TOTP key too short');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits=0,acc=0,out='';
  for(const byte of bytes){
    acc=(acc<<8)|byte;bits+=8;
    while(bits>=5){bits-=5;out+=alphabet[(acc>>bits)&31];acc&=(1<<bits)-1;}
  }
  if(bits>0)out+=alphabet[(acc<<(5-bits))&31];
  return out;
}
export function generateTotpSecret() {return encodeTotpSecret(randomBytes(20));}

export function totpAtStep(secret,step,digits=6) {
  if(!Buffer.isBuffer(secret)||secret.length<20 || !Number.isSafeInteger(step)||step<0 ||
    ![6,8].includes(digits))throw Error('Invalid TOTP input');
  const message=Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const mac=createHmac('sha1',secret).update(message).digest();
  const offset=mac[19]&15;
  const n=(mac.readUInt32BE(offset)&0x7fffffff)%(10**digits);
  return String(n).padStart(digits,'0');
}
// Return the accepted time-step, never the supplied code. Replay guard belongs
// in the caller's persistent database and must be atomic across API instances.
export function matchTotp(secret,code,now=Date.now(),window=1) {
  if(!/^[0-9]{6}$/.test(code)||!Number.isFinite(now)||now<0||
    !Number.isInteger(window)||window<0||window>1)return null;
  const current=Math.floor(now/30000);
  let accepted=null;
  for(let step=Math.max(0,current-window);step<=current+window;step++){
    const expected=Buffer.from(totpAtStep(secret,step));
    const supplied=Buffer.from(code);
    if(timingSafeEqual(expected,supplied))accepted=step;
  }
  return accepted;
}
export function fingerprintTotp(secret) {
  if(!Buffer.isBuffer(secret)||secret.length<20)throw Error('Invalid TOTP key');
  return createHash('sha256').update(secret).digest('hex');
}
