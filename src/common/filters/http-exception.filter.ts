import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { isApiErrorBody } from '../errors/api-error';

/** Fallback code for exceptions that do not carry one (framework-internal throws). */
function defaultCodeFor(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 410:
      return 'GONE';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isHttpException = exception instanceof HttpException;
    const isDev = process.env.NODE_ENV !== 'production';

    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload = isHttpException ? exception.getResponse() : null;
    const body =
      typeof payload === 'object' && payload ? (payload as any) : null;

    // Already-shaped API error: pass code/details/message through untouched.
    if (isApiErrorBody(body)) {
      return this.send(response, request, status, {
        code: String(body.code),
        message: String(body.message),
        details: (body as any).details ?? null,
      });
    }

    // class-validator / ValidationPipe: message is an array of field errors.
    const rawMessage =
      body && 'message' in body
        ? (body as any).message
        : isHttpException
          ? payload
          : isDev && exception instanceof Error
            ? exception.message
            : 'Internal server error';

    const fieldErrors = Array.isArray(rawMessage)
      ? rawMessage.map((m) => String(m))
      : null;
    const message = Array.isArray(rawMessage)
      ? String(rawMessage[0] ?? 'Request failed')
      : String(rawMessage ?? 'Request failed');

    const isValidation = status === 400 && fieldErrors !== null;

    this.send(response, request, status, {
      code: isValidation ? 'VALIDATION_ERROR' : defaultCodeFor(status),
      message,
      details: fieldErrors ? { fields: fieldErrors } : null,
    });
  }

  private send(
    response: Response,
    request: Request,
    status: number,
    body: { code: string; message: string; details: unknown },
  ) {
    const errorResponse = {
      success: false,
      code: body.code,
      message: body.message,
      details: body.details ?? null,
      statusCode: status,
      path: request?.url,
      timestamp: new Date().toISOString(),
    };

    const line = `${request?.method} ${request?.url} -> ${status} ${body.code}`;

    if (status >= 500) {
      this.logger.error(line);
    } else {
      this.logger.warn(line);
    }

    (response as any).status(status).json(errorResponse);
  }
}
