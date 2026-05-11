import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        if (
          data &&
          typeof data === 'object' &&
          'success' in data &&
          'message' in data &&
          'data' in data
        ) {
          return {
            ...(data as any),
            data: normalizeForJson((data as any).data),
          };
        }

        return {
          success: true,
          message: 'Request successful',
          data: normalizeForJson(data ?? null),
        };
      }),
    );
  }
}

function normalizeForJson(value: any): any {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((v) => normalizeForJson(v));
  }

  if (value && typeof value === 'object') {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Buffer.isBuffer(value)) {
      return value.toString('base64');
    }

    const isPlainObject =
      Object.prototype.toString.call(value) === '[object Object]';
    if (!isPlainObject) {
      return value;
    }

    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeForJson(v);
    }
    return out;
  }

  return value;
}
