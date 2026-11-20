import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

/**
 * Served at the origin root, outside the /api/v1 prefix. Render (and any
 * uptime probe) hits `/` and `/health`; without these the platform log fills
 * with 404s and the health check looks like a failure.
 */
@ApiExcludeController()
@Controller()
export class AppController {
  private readonly startedAt = Date.now();

  @Get()
  @Header('Cache-Control', 'no-store')
  index() {
    return {
      service: 'PayDrop API',
      status: 'ok',
      version: process.env.npm_package_version ?? '1.0.0',
      api: '/api/v1',
      health: '/health',
      docs: process.env.NODE_ENV === 'production' ? null : '/docs',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  @Header('Cache-Control', 'no-store')
  health() {
    return {
      status: 'ok',
      uptime_seconds: Math.round((Date.now() - this.startedAt) / 1000),
      environment: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
    };
  }
}
