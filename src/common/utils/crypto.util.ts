import crypto from 'crypto';

/**
 * AES-256-GCM helpers for data we must keep at rest but never return in full
 * (BVN and other KYC payloads).
 *
 * The key comes from KYC_ENCRYPTION_KEY when set; otherwise it is derived from
 * JWT_ACCESS_SECRET so local and test environments keep working. Production
 * should set a dedicated key.
 */
function encryptionKey(): Buffer {
  const material =
    process.env.KYC_ENCRYPTION_KEY ||
    process.env.JWT_ACCESS_SECRET ||
    'paydrop-local-development-key';

  return crypto.createHash('sha256').update(material).digest();
}

export function encryptString(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptString(payload: string): string | null {
  try {
    const [version, ivB64, tagB64, dataB64] = payload.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) return null;

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** *******5678 — the only form of a BVN that may leave the server. */
export function maskBvn(bvn: string): string {
  const digits = String(bvn).replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return '*'.repeat(digits.length - 4) + digits.slice(-4);
}
