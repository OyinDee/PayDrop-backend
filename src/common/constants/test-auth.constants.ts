/**
 * Test-only authentication helpers.
 *
 * Enabled when AUTH_TEST_MODE is explicitly true, or when it is unset and
 * NODE_ENV is not `production`. Set AUTH_TEST_MODE=false to force it off.
 *
 * In test mode:
 *  - request-otp never calls Termii and always accepts TEST_AUTH_OTP
 *  - POST /auth/test-login signs in as one of TEST_ACCOUNTS, creating the
 *    user + wallet on first use (no BVN / Squad virtual account)
 */

export interface TestAccount {
  /** 1-based slot used by POST /auth/test-login { "account": "1" } */
  index: number;
  phone: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
}

export const TEST_AUTH_OTP = process.env.TEST_AUTH_OTP?.trim() || '123456';

export const TEST_ACCOUNTS: readonly TestAccount[] = [
  {
    index: 1,
    phone: '08000000001',
    username: 'test_user_1',
    first_name: 'Test',
    last_name: 'User One',
    email: 'test1@paydrop.test',
  },
  {
    index: 2,
    phone: '08000000002',
    username: 'test_user_2',
    first_name: 'Test',
    last_name: 'User Two',
    email: 'test2@paydrop.test',
  },
  {
    index: 3,
    phone: '08000000003',
    username: 'test_user_3',
    first_name: 'Test',
    last_name: 'User Three',
    email: 'test3@paydrop.test',
  },
] as const;

export function isTestAuthEnabled(): boolean {
  const flag = (process.env.AUTH_TEST_MODE ?? '').trim().toLowerCase();
  if (flag === 'true' || flag === '1' || flag === 'yes') return true;
  if (flag === 'false' || flag === '0' || flag === 'no') return false;
  return process.env.NODE_ENV !== 'production';
}

/** Resolve a test account by slot ("1".."3"), phone, or username. Defaults to slot 1. */
export function resolveTestAccount(account?: string): TestAccount | undefined {
  const key = (account ?? '').trim().toLowerCase();
  if (!key || key === '1' || key === 'default') return TEST_ACCOUNTS[0];

  return TEST_ACCOUNTS.find(
    (candidate) =>
      String(candidate.index) === key ||
      candidate.phone === key ||
      candidate.username.toLowerCase() === key,
  );
}
