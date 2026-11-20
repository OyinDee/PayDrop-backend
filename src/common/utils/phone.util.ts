/**
 * Normalize Nigerian phone numbers to E.164 digits without the leading '+':
 * 08123456789 / 8123456789 / +2348123456789 all become 2348123456789.
 */
export function normalizeNgPhone(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '');

  if (digits.startsWith('234')) {
    return digits;
  }

  if (digits.startsWith('0') && digits.length === 11) {
    return '234' + digits.slice(1);
  }

  // The app may send the number without the trunk zero (10 digits).
  if (digits.length === 10) {
    return '234' + digits;
  }

  return '234' + digits;
}

/** E.164 form with the leading '+', as the requirements document specifies. */
export function toE164(phone: string): string {
  return '+' + normalizeNgPhone(phone);
}

/** True for a well-formed Nigerian mobile number. */
export function isValidNgPhone(phone: string): boolean {
  return /^234[789]\d{9}$/.test(normalizeNgPhone(phone));
}
