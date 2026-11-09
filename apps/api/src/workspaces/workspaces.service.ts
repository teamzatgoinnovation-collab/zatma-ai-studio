import { HttpStatus, Injectable } from '@nestjs/common';
import type { Paginated, Workspace } from '@zatma/types';
import type { CreateWorkspaceInput, PaginationInput, UpdateWorkspaceInput } from '@zatma/validation';
import type { Workspace as WorkspaceRow } from '../generated/prisma/client.js';
import { AppException, notFound } from '../common/errors.js';
import { paginate, toSkipTake } from '../common/pagination.js';
import { TenantContext } from '../common/tenant-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../billing/usage.service.js';

const toDto = (w: WorkspaceRow): Workspace => ({
  id: w.id,
  organizationId: w.organizationId,
  name: w.name,
  description: w.description,
  isDefault: w.isDefault,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});

/** All queries go through `prisma.tenant`, which confines them to the active organization. */
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  async list(pagination: PaginationInput): Promise<Paginated<Workspace>> {
    const [rows, total] = await Promise.all([
      this.db.workspace.findMany({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], ...toSkipTake(pagination) }),
      this.db.workspace.count(),
    ]);
    return paginate(rows.map(toDto), total, pagination);
  }

  async get(id: string): Promise<Workspace> {
    const row = await this.db.workspace.findFirst({ where: { id } });
    if (!row) throw notFound('Workspace');
    return toDto(row);
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    await this.usage.assertWithinLimit(TenantContext.requireOrganizationId(), 'workspaces');
    const row = await this.db.workspace.create({
      data: { organizationId: TenantContext.requireOrganizationId(), name: input.name, description: input.description ?? null },
    });
    return toDto(row);
  }

  async update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    await this.get(id);
    const row = await this.db.workspace.update({ where: { id }, data: input });
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    const ws = await this.get(id);
    if (ws.isDefault) {
      throw new AppException(HttpStatus.CONFLICT, 'DEFAULT_WORKSPACE', 'The default workspace cannot be deleted');
    }
    await this.db.workspace.delete({ where: { id } });
  }
}
