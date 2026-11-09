import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../common/decorators/auth.decorators.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../email/email.types.js';
import { CaptureTransport } from '../email/transports.js';

/** Development-only helpers. This module is not registered when NODE_ENV=production. */
@ApiExcludeController()
@Controller('dev')
export class DevController {
  constructor(@Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport) {}

  @Get('emails')
  @Public()
  async emails(@Query('to') to?: string) {
    if (!(this.transport instanceof CaptureTransport)) return { transport: this.transport.name, emails: [] };
    return { transport: 'capture', emails: await this.transport.list(to) };
  }
}
