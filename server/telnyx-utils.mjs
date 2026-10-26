import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

export const e164US = value => typeof value === 'string' && /^\+1[2-9]\d{9}$/.test(value);
export const pdfValid = buf => Buffer.isBuffer(buf) && buf.length >= 20 &&
  buf.length <= 10 * 1024 * 1024 && buf.subarray(0, 5).toString() === '%PDF-';
export const cleanName = value => String(value || 'fax.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
export const statusFor = type => ({
  'fax.queued': 'queued',
  'fax.media.processed': 'processing',
  'fax.sending.started': 'sending',
  'fax.delivered': 'delivered',
  'fax.failed': 'failed',
  'fax.receiving.started': 'receiving',
  'fax.media.processing.started': 'processing',
  'fax.received': 'received'
})[type] || null;

export function signMedia(secret, id, expires) {
  return createHmac('sha256', secret).update(id + ':' + expires).digest('hex');
}
export function mediaAuthorized(secret, id, expires, sig, now = Date.now()) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{10,13}$/.test(String(expires)) ||
      !/^[0-9a-f]{64}$/i.test(String(sig))) return false;
  if (Number(expires) * 1000 < now || Number(expires) * 1000 > now + 2 * 3600 * 1000) return false;
  const expected = Buffer.from(signMedia(secret, id, expires), 'hex');
  const supplied = Buffer.from(sig, 'hex');
  return timingSafeEqual(expected, supplied);
}

export function webhookKey(publicKey) {
  if (publicKey.includes('BEGIN PUBLIC KEY')) return createPublicKey(publicKey);
  const hex = publicKey.replace(/\s+/g, '');
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('TELNYX_PUBLIC_KEY must be a 32-byte hex Ed25519 key or PEM public key');
  return createPublicKey({key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')
  ]), format: 'der', type: 'spki'});
}
export function verifyWebhook(body, headers, key, now = Date.now()) {
  const stamp = headers['telnyx-timestamp'];
  const signature = headers['telnyx-signature-ed25519'];
  if (!/^\d{10}$/.test(String(stamp)) ||
      Math.abs(now / 1000 - Number(stamp)) > 300 ||
      !/^[A-Za-z0-9+/]{86}==$/.test(String(signature))) return false;
  const message = Buffer.concat([Buffer.from(stamp + '|'), body]);
  try { return verify(null, message, key, Buffer.from(signature, 'base64')); }
  catch { return false; }
}
export function safeIncomingUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const permitted = ['amazonaws.com', 'telnyx.com', 'telnyxcloudstorage.com'];
    if (!permitted.some(root => host === root || host.endsWith('.' + root))) return null;
    return url.href;
  } catch { return null; }
}
export const terminal = state => ['delivered', 'received', 'failed'].includes(state);
