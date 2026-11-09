import { HttpException, HttpStatus } from '@nestjs/common';

/** HttpException carrying a stable machine-readable `code` for clients. */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (resource: string) => new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${resource} not found`);
