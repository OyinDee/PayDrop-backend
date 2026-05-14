/** Normalize Nigerian phone numbers to E.164-style digits without + (234…). */
export function normalizeNgPhone(phone: string): string {
  let normalized = phone.replace(/\D/g, '');

  if (normalized.startsWith('234')) {
    return normalized;
  }

  if (normalized.startsWith('0')) {
    return '234' + normalized.slice(1);
  }

  if (normalized.length === 10) {
    return '234' + normalized.slice(1);
  }

  return '234' + normalized;
}
