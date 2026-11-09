import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppException } from '../errors.js';

/** Validates and transforms input with a shared Zod schema. Usage: `@Body(new ZodValidationPipe(schema))`. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Request validation failed',
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
      );
    }
    return result.data;
  }
}
