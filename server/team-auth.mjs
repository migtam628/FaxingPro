import {randomBytes,createCipheriv,createDecipheriv,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const roles=Object.freeze(['admin','operator','viewer']);
export function normalizeEmail(value){
  if(typeof value!=='string')return null;
  const v=value.trim().toLowerCase();
  return v.length>=5&&v.length<=254&&/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)?v:null;
}
export function normalizeName(value){
  if(typeof value!=='string')return null;
  const v=value.trim();
  return v.length>=2&&v.length<=80&&/^[^\u0000-\u001f\u007f<>]+$/.test(v)?v:null;
}
export function generateTemporaryPassword(){return randomBytes(24).toString('base64url');}
export async function hashPassword(value){
  if(typeof value!=='string'||value.length<16||value.length>256)throw Error('Password length invalid');
  const salt=randomBytes(16);
  const key=await scrypt(value,salt,64);
  return 'scrypt-v1$'+salt.toString('hex')+'$'+key.toString('hex');
}
export async function verifyPassword(value,encoded){
  if(typeof value!=='string'||value.length>256||typeof encoded!=='string')return false;
  const parts=encoded.split('$');
  if(parts.length!==3||parts[0]!=='scrypt-v1'||!/^[0-9a-f]{32}$/.test(parts[1])||
      !/^[0-9a-f]{128}$/.test(parts[2]))return false;
  const actual=await scrypt(value,Buffer.from(parts[1],'hex'),64);
  return timingSafeEqual(actual,Buffer.from(parts[2],'hex'));
}
// Secret encrypted under the existing AES-256-GCM storage key; never expose DB ciphertext
// as a QR link or via read APIs.
export function encryptTeamTotp(value,key){
  const nonce=randomBytes(12),enc=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),nonce);
  const data=Buffer.concat([enc.update(value,'utf8'),enc.final()]);
  return Buffer.concat([nonce,enc.getAuthTag(),data]).toString('hex');
}
export function decryptTeamTotp(value,key){
  if(typeof value!=='string'||!/^[0-9a-f]+$/.test(value)||value.length<58)throw Error('Invalid TOTP ciphertext');
  const raw=Buffer.from(value,'hex'),dec=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),raw.subarray(0,12));
  dec.setAuthTag(raw.subarray(12,28));
  return Buffer.concat([dec.update(raw.subarray(28)),dec.final()]).toString('utf8');
}
// An explicit allowlist: unknown paths and methods are DENIED for named non-admin roles.
// Do not rely on hidden frontend navigation for authorization.
export function teamRoleAllows(role,method,path){
  if(!roles.includes(role)||typeof path!=='string')return false;
  if(role==='admin')return true;
  const uuid='[0-9a-f-]{36}';
  const read=[
    '/api/faxes','/api/stats','/api/reports/daily','/api/contacts','/api/notifications',
    '/api/notifications/preferences','/api/reconciliation',
  ];
  if(method==='GET'&&(read.includes(path)||
      new RegExp('^/api/faxes/'+uuid+'/(document|events)$','i').test(path)))return true;
  if(role==='viewer')return false;
  if(method==='POST'&&['/api/faxes','/api/contacts'].includes(path))return true;
  if(method==='PATCH'&&(path==='/api/notifications/preferences'||
      new RegExp('^/api/faxes/'+uuid+'/(read|archive)$','i').test(path)||
      new RegExp('^/api/contacts/'+uuid+'$','i').test(path)))return true;
  if(method==='DELETE'&&new RegExp('^/api/contacts/'+uuid+'$','i').test(path))return true;
  return false;
}
