import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import type { HealthStatus } from '@zatma/types';
import { Public } from '../common/decorators/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';

const withTimeout = <T>(p: Promise<T>, ms = 2000) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness and dependency health (PostgreSQL, Redis)' })
  async check(): Promise<HealthStatus> {
    const [db, redis] = await Promise.allSettled([withTimeout(this.prisma.system.$queryRaw`SELECT 1`), withTimeout(this.redis.ping())]);
    const checks = {
      database: db.status === 'fulfilled' ? ('up' as const) : ('down' as const),
      redis: redis.status === 'fulfilled' && redis.value === 'PONG' ? ('up' as const) : ('down' as const),
    };
    return {
      status: checks.database === 'up' && checks.redis === 'up' ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }
}
