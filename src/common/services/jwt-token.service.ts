import { Injectable } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string; // userId
  phone: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtTokenService {
  constructor(
    private jwtService: NestJwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Generate JWT access token
   */
  generateAccessToken(userId: string, phone: string): string {
    const expiresIn = this.configService.get<string>('JWT_ACCESS_EXPIRY', '15m');
    // cast payload to any to avoid mismatched overload typings from jwt lib types
    // cast options to any to avoid strict overload mismatch with underlying jwt lib types
    return this.jwtService.sign({ sub: userId, phone } as any, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET') as string,
      expiresIn,
    } as any);
  }

  /**
   * Generate JWT refresh token
   */
  generateRefreshToken(userId: string, phone: string): string {
    const expiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRY', '7d');
    // cast payload to any to avoid mismatched overload typings from jwt lib types
    // cast options to any to avoid strict overload mismatch with underlying jwt lib types
    return this.jwtService.sign({ sub: userId, phone } as any, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') as string,
      expiresIn,
    } as any);
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): JwtPayload {
    return this.jwtService.verify(token, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * Verify refresh token
   */
  verifyRefreshToken(token: string): JwtPayload {
    return this.jwtService.verify(token, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
    });
  }

  /**
   * Decode token without verification (for inspection)
   */
  decodeToken(token: string): JwtPayload {
    return this.jwtService.decode(token) as JwtPayload;
  }
}
