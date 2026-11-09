import { Injectable, Logger } from '@nestjs/common';
import type { AuditLogEntry, Paginated } from '@zatma/types';
import type { PaginationInput } from '@zatma/validation';
import type { Prisma } from '../generated/prisma/client.js';
import { paginate, toSkipTake } from '../common/pagination.js';
import { TenantContext } from '../common/tenant-context.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort: an audit failure is logged but never fails the user's request. */
  async record(action: string, resourceType: string, resourceId: string | null, metadata?: Prisma.InputJsonValue): Promise<void> {
    const ctx = TenantContext.get();
    if (!ctx?.organizationId) return;
    try {
      await this.prisma.tenant.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          actorId: ctx.userId ?? null,
          action,
          resourceType,
          resourceId,
          metadata,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent?.slice(0, 512) ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log ${action}: ${(err as Error).message}`);
    }
  }

  async list(pagination: PaginationInput): Promise<Paginated<AuditLogEntry>> {
    const [rows, total] = await Promise.all([
      this.prisma.tenant.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { name: true } } },
        ...toSkipTake(pagination),
      }),
      this.prisma.tenant.auditLog.count(),
    ]);
    return paginate(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        actorId: r.actorId,
        actorName: r.actor?.name ?? null,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      pagination,
    );
  }
}
