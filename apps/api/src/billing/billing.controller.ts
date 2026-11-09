import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, RequirePermissions } from '../common/decorators/auth.decorators.js';
import { BillingService } from './billing.service.js';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  @Public()
  @ApiOperation({ summary: 'Public plan catalogue' })
  plans() {
    return this.billing.plans();
  }

  @Get('subscription')
  @ApiCookieAuth()
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: 'Subscription of the active organization' })
  subscription() {
    return this.billing.subscription();
  }
}
