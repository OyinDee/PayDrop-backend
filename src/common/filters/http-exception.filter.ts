import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

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
    const exceptionResponse = isHttpException
      ? exception.getResponse()
      : 'Internal server error';

    const nonHttpMessage =
      exception instanceof Error
        ? exception.message
        : exception
          ? String(exception)
          : 'Internal server error';

    const message =
      typeof exceptionResponse === 'object' && exceptionResponse && 'message' in exceptionResponse
        ? (exceptionResponse as any).message
        : isHttpException
          ? String(exceptionResponse)
          : isDev
            ? nonHttpMessage
            : 'Internal server error';

    const errorResponse = {
      success: false,
      message: 'Request failed',
      data: null,
      error: Array.isArray(message) ? message.join(', ') : message,
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    this.logger.error(
      `${request.method} ${request.url}`,
      exception instanceof Error
        ? `${JSON.stringify(errorResponse)}\n${exception.stack || ''}`
        : JSON.stringify(errorResponse),
    );

    (response as any).status(status).json(errorResponse);
  }
}
