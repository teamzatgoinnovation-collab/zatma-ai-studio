import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { BILLING_QUEUE, BillingMaintenanceProcessor } from './billing-maintenance.processor.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PAYMENT_PROVIDER } from './payment-provider.interface.js';
import { DisabledPaymentProvider, RazorpayProvider } from './razorpay.provider.js';

@Module({
  imports: [BullModule.registerQueue({ name: BILLING_QUEUE })],
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingMaintenanceProcessor,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET
          ? new RazorpayProvider({ keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET })
          : new DisabledPaymentProvider(),
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
