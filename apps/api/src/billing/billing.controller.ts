import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { changePlanSchema, checkoutSchema, paginationSchema, type ChangePlanInput, type CheckoutInput, type PaginationInput } from '@zatma/validation';
import { Audit } from '../audit/audit.decorator.js';
import { Public, RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedRequest } from '../common/request.js';
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
  @ApiOperation({ summary: 'Subscription of the active organization (status, period, trial, pending change)' })
  subscription() {
    return this.billing.subscription();
  }

  @Get('usage')
  @ApiCookieAuth()
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: 'Current usage against plan limits' })
  usage() {
    return this.billing.usageSummary();
  }

  @Get('invoices')
  @ApiCookieAuth()
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: 'Invoices of the active organization' })
  invoices(@Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput) {
    return this.billing.invoices(query);
  }

  @Post('checkout')
  @ApiCookieAuth()
  @RequirePermissions('billing:manage')
  @Audit('billing.checkout_started', 'subscription')
  @ApiOperation({ summary: 'Start a paid subscription (returns Razorpay Checkout parameters)' })
  checkout(@Body(new ZodValidationPipe(checkoutSchema)) body: CheckoutInput) {
    return this.billing.checkout(body.plan, body.interval);
  }

  @Post('change-plan')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @RequirePermissions('billing:manage')
  @Audit('billing.plan_changed', 'subscription')
  @ApiOperation({ summary: 'Upgrade (immediate) or downgrade (at period end) the plan' })
  changePlan(@Body(new ZodValidationPipe(changePlanSchema)) body: ChangePlanInput) {
    return this.billing.changePlan(body.plan, body.interval);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @RequirePermissions('billing:manage')
  @Audit('billing.canceled', 'subscription')
  @ApiOperation({ summary: 'Cancel at period end (paid) or end the trial now' })
  cancel() {
    return this.billing.cancel();
  }

  @Post('webhooks/razorpay')
  @HttpCode(HttpStatus.OK)
  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  webhook(
    @Req() req: AuthenticatedRequest & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    return this.billing.handleWebhook(req.rawBody, signature, eventId);
  }
}
