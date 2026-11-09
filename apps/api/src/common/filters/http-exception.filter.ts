import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorBody } from '@zatma/types';
import type { AuthenticatedRequest } from '../request.js';
import { MissingTenantError, TenantMismatchError } from '../tenant-context.js';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
};

/** Converts every error into the documented error envelope. Never leaks internals for 5xx. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthenticatedRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = STATUS_CODES[status] ?? 'ERROR';
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { code?: string; message?: string | string[]; details?: unknown };
        code = b.code ?? code;
        message = Array.isArray(b.message) ? b.message.join('; ') : (b.message ?? exception.message);
        details = b.details ?? null;
      }
    } else if (exception instanceof MissingTenantError || exception instanceof TenantMismatchError) {
      // A tenant-safety violation is a server bug; surface as 500 but log loudly.
      this.logger.error(`Tenant isolation violation on ${req.method} ${req.url}: ${exception.message}`);
    } else if (isPrismaKnownError(exception)) {
      if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'Resource not found';
      } else if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'CONFLICT';
        message = 'A record with these values already exists';
      }
    }

    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const payload: ApiErrorBody = {
      statusCode: status,
      code,
      message,
      details,
      path: req.originalUrl ?? req.url,
      timestamp: new Date().toISOString(),
      requestId: typeof req.id === 'string' ? req.id : undefined,
    };
    res.status(status).json(payload);
  }
}

function isPrismaKnownError(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'PrismaClientKnownRequestError';
}
