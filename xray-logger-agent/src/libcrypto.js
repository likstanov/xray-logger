import { randomBytes, createCipheriv } from 'crypto';

// Encrypts arbitrary JSON payload with AES-256-GCM.
// keyBase64 must decode to 32 bytes.
export function encrypt(payload, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY_BASE64 must decode to 32 bytes');
  const iv = randomBytes(12); // GCM nonce
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv_b64: iv.toString('base64'), tag_b64: tag.toString('base64'), data_b64: ciphertext.toString('base64') };
}
