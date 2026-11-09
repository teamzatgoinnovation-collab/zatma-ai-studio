import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { paginationSchema, type PaginationInput } from '@zatma/validation';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AuditService } from './audit.service.js';

@ApiTags('Audit')
@ApiCookieAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Audit trail of the active organization (newest first)' })
  list(@Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput) {
    return this.audit.list(query);
  }
}
