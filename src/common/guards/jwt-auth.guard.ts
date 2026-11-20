import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    const headerDeviceId = request.headers['x-device-id'];
    const deviceId =
      typeof headerDeviceId === 'string' && headerDeviceId.trim().length > 0
        ? headerDeviceId.trim()
        : null;

    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    try {
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const payload: any = this.jwtService.verify(token, { secret });

      // A token bound to a device stays bound to it: presenting the header
      // with a different value is rejected. The header is otherwise optional so
      // a plain Bearer token is enough (no x-device-id requirement).
      if (deviceId && payload.did && String(payload.did) !== deviceId) {
        throw new UnauthorizedException(
          'Token was issued for a different device',
        );
      }

      request.user = payload;
      request.device_id = deviceId ?? payload.did ?? null;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: any): string | null {
    const authHeader = request.headers['authorization'];
    if (!authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1];
  }
}
