import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any, context: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Invalid or expired token');
    }
    const request = context?.switchToHttp?.().getRequest?.();
    const deviceId = request?.headers?.['x-device-id'];
    if (!deviceId || String(deviceId).trim().length === 0) {
      throw new UnauthorizedException('Missing x-device-id header');
    }
    request.device_id = String(deviceId);
    return user;
  }
}
