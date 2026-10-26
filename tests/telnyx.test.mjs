import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { pdfValid, e164US, signMedia, mediaAuthorized, webhookKey, verifyWebhook, safeIncomingUrl, statusFor } from '../server/telnyx-utils.mjs';

test('validates outbound destinations and PDFs', () => {
  assert.equal(e164US('+13055551234'), true);
  assert.equal(e164US('+44123456789'), false);
  assert.equal(pdfValid(Buffer.from('%PDF-1.7\nsome actual pdf bytes')), true);
  assert.equal(pdfValid(Buffer.from('not a PDF')), false);
});
test('media access signatures have expiry and tamper protection', () => {
  const id='123e4567-e89b-12d3-a456-426614174000';
  const exp=Math.floor(Date.now()/1000)+900;
  const sig=signMedia('x'.repeat(64),id,exp);
  assert.equal(mediaAuthorized('x'.repeat(64),id,exp,sig),true);
  assert.equal(mediaAuthorized('y'.repeat(64),id,exp,sig),false);
  assert.equal(mediaAuthorized('x'.repeat(64),id,exp+1,sig),false);
  assert.equal(mediaAuthorized('x'.repeat(64),id,Math.floor(Date.now()/1000)-5,sig),false);
});
test('Ed25519 verification checks exact body, timestamp, signature and key', () => {
  const pair=generateKeyPairSync('ed25519');
  const key=webhookKey(pair.publicKey.export({format:'pem',type:'spki'}).toString());
  const body=Buffer.from(JSON.stringify({data:{event_type:'fax.delivered'}}));
  const ts=String(Math.floor(Date.now()/1000));
  const signature=sign(null,Buffer.concat([Buffer.from(ts+'|'),body]),pair.privateKey).toString('base64');
  const headers={'telnyx-timestamp':ts,'telnyx-signature-ed25519':signature};
  assert.equal(verifyWebhook(body,headers,key),true);
  assert.equal(verifyWebhook(Buffer.from('{"data":{}}'),headers,key),false);
  assert.equal(verifyWebhook(body,{...headers,'telnyx-timestamp':String(Number(ts)-600)},key),false);
});
test('blocks SSRF through unexpected inbound media hosts', () => {
  assert.equal(safeIncomingUrl('https://s3.us-east-1.amazonaws.com/fax.pdf')!==null,true);
  assert.equal(safeIncomingUrl('http://127.0.0.1/metadata'),null);
  assert.equal(safeIncomingUrl('https://amazonaws.com.evil.example/a'),null);
});
test('Telnyx statuses mapped; unknown type never terminal', () => {
  assert.equal(statusFor('fax.delivered'),'delivered');
  assert.equal(statusFor('fax.received'),'received');
  assert.equal(statusFor('fax.unknown'),null);
});
