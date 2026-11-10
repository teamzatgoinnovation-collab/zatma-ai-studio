import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AIProviderModule } from './ai/ai-provider.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingModule } from './billing/billing.module.js';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { requestContextMiddleware } from './common/request-context.middleware.js';
import { ConfigModule, ENV } from './config/config.module.js';
import { loadEnv, type Env } from './config/env.js';
import { CopyModule } from './copy/copy.module.js';
import { CrmModule } from './crm/crm.module.js';
import { DesignModule } from './design/design.module.js';
import { DevModule } from './dev/dev.module.js';
import { EmailModule } from './email/email.module.js';
import { HealthModule } from './health/health.module.js';
import { NotificationModule } from './notifications/notification.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';
import { WorkspaceModule } from './workspaces/workspaces.module.js';

const bootEnv = loadEnv();

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: bootEnv.LOG_LEVEL,
        genReqId: (req, res) => {
          const existing = req.headers['x-request-id'];
          const id = typeof existing === 'string' && existing.length <= 64 ? existing : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
        transport: bootEnv.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ ttl: 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : env.RATE_LIMIT_PER_MINUTE }],
        errorMessage: 'Too many requests, please slow down',
      }),
    }),
    PrismaModule,
    RedisModule,
    NotificationModule,
    EmailModule,
    AuthModule,
    AuditModule,
    HealthModule,
    UsersModule,
    OrganizationsModule,
    WorkspaceModule,
    StorageModule,
    AIProviderModule,
    BillingModule,
    DesignModule,
    CopyModule,
    CrmModule,
    ...(bootEnv.NODE_ENV === 'production' ? [] : [DevModule]),
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('*');
  }
}
