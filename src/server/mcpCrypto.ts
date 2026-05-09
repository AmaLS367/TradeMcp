import crypto from 'crypto';

export const ALGORITHM = 'aes-256-gcm';

export function getEncryptionKey() {
  return process.env.ENCRYPTION_KEY || '';
}

export function encrypt(text: string) {
  const keyStr = getEncryptionKey();
  if (!keyStr || keyStr.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
  }

  const iv = crypto.randomBytes(12);
  const key = Buffer.from(keyStr, 'hex');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string) {
  const keyStr = getEncryptionKey();
  if (!keyStr || keyStr.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
  }

  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid ciphertext format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = Buffer.from(keyStr, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
