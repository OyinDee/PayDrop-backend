import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

/**
 * Guards internal troubleshooting endpoints.
 *
 * Enabled by default outside production so local and test environments keep
 * working. Set ENABLE_DEBUG_ENDPOINTS=true to force on, or =false to force off.
 * Production (NODE_ENV=production) is denied unless explicitly enabled.
 */
export function isDebugEndpointsEnabled(): boolean {
  const flag = (process.env.ENABLE_DEBUG_ENDPOINTS ?? '').trim().toLowerCase();
  if (flag === 'true' || flag === '1' || flag === 'yes') return true;
  if (flag === 'false' || flag === '0' || flag === 'no') return false;

  const env = (process.env.NODE_ENV ?? '').trim().toLowerCase();
  return env !== 'production';
}

@Injectable()
export class DebugEndpointsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (isDebugEndpointsEnabled()) return true;
    // 404 rather than 403 so the endpoint is not advertised.
    throw new NotFoundException('Not found');
  }
}
