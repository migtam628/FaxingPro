import { createHmac, createPublicKey, timingSafeEqual, verify, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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
  if (typeof publicKey !== 'string') throw new Error('TELNYX_PUBLIC_KEY is required');
  const trimmed = publicKey.trim();
  if (trimmed.includes('BEGIN PUBLIC KEY')) return createPublicKey(trimmed);
  // Telnyx Mission Control displays an Ed25519 public key as Base64 (32 raw bytes).
  // Hex and PEM formats remain accepted for existing deployments.
  const keyBytes = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : /^[A-Za-z0-9+/]{43}=$/.test(trimmed)
      ? Buffer.from(trimmed, 'base64')
      : null;
  if (!keyBytes || keyBytes.length !== 32) {
    throw new Error('TELNYX_PUBLIC_KEY must be 32-byte Base64, hex, or PEM Ed25519 public key');
  }
  return createPublicKey({key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), keyBytes
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

export function encryptPdf(buffer,keyHex) {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('STORAGE_ENCRYPTION_KEY must be 32 bytes hex');
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),nonce);
  const content=Buffer.concat([cipher.update(buffer),cipher.final()]);
  return Buffer.concat([Buffer.from('FP01'),nonce,cipher.getAuthTag(),content]);
}
export function decryptPdf(encrypted,keyHex) {
  if (!/^[0-9a-f]{64}$/i.test(keyHex) || encrypted.subarray(0,4).toString()!=='FP01')
    throw new Error('Unrecognized fax storage format or encryption key');
  const dec=createDecipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),
    encrypted.subarray(4,16));
  dec.setAuthTag(encrypted.subarray(16,32));
  return Buffer.concat([dec.update(encrypted.subarray(32)),dec.final()]);
}
