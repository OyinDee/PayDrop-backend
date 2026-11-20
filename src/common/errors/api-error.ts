import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable error codes. The mobile app branches on these
 * instead of parsing prose, so they must not change once published.
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_ATTEMPTS_EXCEEDED'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_EXISTS'
  | 'USERNAME_TAKEN'
  | 'EMAIL_TAKEN'
  | 'PHONE_TAKEN'
  | 'REFRESH_INVALID'
  | 'REALTIME_UNAUTHORIZED'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_IN_USE'
  | 'TOKEN_MALFORMED'
  | 'KYC_REQUIRED'
  | 'KYC_MISMATCH'
  | 'KYC_ALREADY_VERIFIED'
  | 'INSUFFICIENT_FUNDS'
  | 'TRANSFER_BLOCKED'
  | 'TRANSFER_NAME_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SERVICE_UNAVAILABLE';

/**
 * Throw an error whose HTTP body is the shared PayDrop error envelope:
 * { success: false, code, message, details }
 */
export function apiError(
  status: HttpStatus,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown> | null,
): HttpException {
  return new HttpException(
    {
      success: false,
      code,
      message,
      details: details ?? null,
    },
    status,
  );
}

export function isApiErrorBody(value: unknown): value is {
  success: false;
  code: string;
  message: string;
  details?: unknown;
} {
  return (
    !!value &&
    typeof value === 'object' &&
    'code' in (value as Record<string, unknown>) &&
    'message' in (value as Record<string, unknown>)
  );
}
