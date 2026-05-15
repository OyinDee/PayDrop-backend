import { SQUAD_GT_BANK_NIP_CODE } from '../constants/squad.constants';

/**
 * Squad virtual-account creation often returns a short bank code (e.g. "058" for GTBank).
 * Payout account lookup requires a 6-digit NIP bank_code (e.g. "000013").
 */
const SQUAD_SHORT_CODE_TO_NIP: Record<string, string> = {
  '058': SQUAD_GT_BANK_NIP_CODE,
  '050': SQUAD_GT_BANK_NIP_CODE,
  '013': SQUAD_GT_BANK_NIP_CODE,
  '057': '000015', // Zenith
  '033': '000004', // UBA
  '011': '000016', // First Bank
  '032': '000003', // FCMB
  '035': '000014', // Access
};

export function mapSquadBankCodeToNip(
  code: string | null | undefined,
): string | null {
  const raw = code?.trim();
  if (!raw) return null;
  if (/^\d{6}$/.test(raw)) return raw;
  return SQUAD_SHORT_CODE_TO_NIP[raw] ?? null;
}

export function resolvePayoutNipCode(options: {
  requestOverride?: string;
  squadBankCodeStored?: string | null;
  defaultNip?: string;
}): { nip: string; source: string } {
  const defaultNip = options.defaultNip ?? SQUAD_GT_BANK_NIP_CODE;
  const override = options.requestOverride?.trim();
  if (override && /^\d{6}$/.test(override)) {
    return { nip: override, source: 'request_override' };
  }

  const fromStored = mapSquadBankCodeToNip(options.squadBankCodeStored);
  if (fromStored) {
    return { nip: fromStored, source: 'va_stored_bank_code' };
  }

  return { nip: defaultNip, source: 'default_gt' };
}
