import { HttpStatus, Injectable } from '@nestjs/common';
import type { Paginated } from '@zatma/types';
import {
  DEFAULT_PIPELINE_STAGES,
  type BoardDto,
  type CreateDealInput,
  type CreatePipelineInput,
  type DealDto,
  type ListDealsInput,
  type MoveDealInput,
  type PipelineDto,
  type StageKind,
  type UpdateDealInput,
} from '@zatma/validation';
import { AppException, notFound } from '../common/errors.js';
import { paginate } from '../common/pagination.js';
import { TenantContext } from '../common/tenant-context.js';
import type { Pipeline, PipelineStage, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AutomationEventsService } from '../automation/automation-events.service.js';
import { CrmContext, dealInclude, ownerScope, positionBetween, searchOr, seesAllRecords, toDealDto, toStageDto } from './crm-common.js';

type PipelineWithStages = Pipeline & { stages: PipelineStage[] };
const SORT: Record<string, string> = { name: 'name', createdAt: 'createdAt', updatedAt: 'updatedAt', value: 'value', expectedCloseAt: 'expectedCloseAt' };

const toPipelineDto = (p: PipelineWithStages): PipelineDto => ({ id: p.id, name: p.name, isDefault: p.isDefault, stages: [...p.stages].sort((a, b) => a.order - b.order).map(toStageDto) });

/** Status, probability and close date implied by a stage. */
function stageEffects(kind: StageKind, probability: number) {
  if (kind === 'WON') return { status: 'WON' as const, probability: 100, closedAt: new Date() };
  if (kind === 'LOST') return { status: 'LOST' as const, probability: 0, closedAt: new Date() };
  return { status: 'OPEN' as const, probability, closedAt: null, lostReason: null };
}

@Injectable()
export class PipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmContext,
    private readonly events: AutomationEventsService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  // ───────────── Pipelines ─────────────

  /** All pipelines; the default one is created on first use. */
  async list(): Promise<PipelineDto[]> {
    let rows = await this.db.pipeline.findMany({ include: { stages: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    if (rows.length === 0) rows = [await this.createDefault()];
    return rows.map(toPipelineDto);
  }

  private async createDefault(): Promise<PipelineWithStages> {
    const organizationId = TenantContext.requireOrganizationId();
    return this.db.pipeline.create({
      data: { organizationId, name: 'Sales pipeline', isDefault: true, stages: { create: DEFAULT_PIPELINE_STAGES.map((s, order) => ({ ...s, order, organizationId })) } },
      include: { stages: true },
    });
  }

  async getOrDefault(id?: string): Promise<PipelineWithStages> {
    if (id) {
      const p = await this.db.pipeline.findFirst({ where: { id }, include: { stages: { orderBy: { order: 'asc' } } } });
      if (!p) throw notFound('Pipeline');
      return p;
    }
    await this.list();
    const p = await this.db.pipeline.findFirstOrThrow({ where: { isDefault: true }, include: { stages: { orderBy: { order: 'asc' } } } });
    return p;
  }

  async create(input: CreatePipelineInput): Promise<PipelineDto> {
    const organizationId = TenantContext.requireOrganizationId();
    if ((await this.db.pipeline.count()) >= 10) throw new AppException(HttpStatus.CONFLICT, 'LIMIT_REACHED', 'An organization can have up to 10 pipelines');
    const stages = input.stages ?? DEFAULT_PIPELINE_STAGES;
    const p = await this.db.pipeline.create({
      data: { organizationId, name: input.name, isDefault: (await this.db.pipeline.count()) === 0, stages: { create: stages.map((s, order) => ({ ...s, order, organizationId })) } },
      include: { stages: true },
    });
    return toPipelineDto(p);
  }

  async update(id: string, input: { name?: string; isDefault?: true }): Promise<PipelineDto> {
    await this.getOrDefault(id);
    if (input.isDefault) await this.db.pipeline.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    const p = await this.db.pipeline.update({ where: { id }, data: input, include: { stages: true } });
    return toPipelineDto(p);
  }

  async remove(id: string): Promise<void> {
    const p = await this.getOrDefault(id);
    if (p.isDefault) throw new AppException(HttpStatus.CONFLICT, 'DEFAULT_PIPELINE', 'Make another pipeline the default before deleting this one');
    if (await this.db.deal.count({ where: { pipelineId: id, deletedAt: null } })) throw new AppException(HttpStatus.CONFLICT, 'PIPELINE_NOT_EMPTY', 'Move or delete the deals in this pipeline first');
    await this.db.pipeline.delete({ where: { id } });
  }

  async addStage(pipelineId: string, input: { name: string; probability: number; kind: StageKind }): Promise<PipelineDto> {
    const p = await this.getOrDefault(pipelineId);
    if (p.stages.length >= 20) throw new AppException(HttpStatus.CONFLICT, 'LIMIT_REACHED', 'A pipeline can have up to 20 stages');
    // New open stages go before the first closed (won/lost) stage.
    const firstClosed = p.stages.find((s) => s.kind !== 'OPEN');
    const order = input.kind === 'OPEN' && firstClosed ? firstClosed.order : p.stages.length;
    await this.db.$transaction(async (tx) => {
      await tx.pipelineStage.updateMany({ where: { pipelineId, order: { gte: order } }, data: { order: { increment: 1 } } });
      await tx.pipelineStage.create({ data: { ...input, order, pipelineId, organizationId: p.organizationId } });
    });
    return toPipelineDto(await this.getOrDefault(pipelineId));
  }

  async updateStage(pipelineId: string, stageId: string, input: { name?: string; probability?: number; kind?: StageKind }): Promise<PipelineDto> {
    const p = await this.getOrDefault(pipelineId);
    if (!p.stages.some((s) => s.id === stageId)) throw notFound('Stage');
    await this.db.pipelineStage.update({ where: { id: stageId }, data: input });
    return toPipelineDto(await this.getOrDefault(pipelineId));
  }

  async reorderStages(pipelineId: string, stageIds: string[]): Promise<PipelineDto> {
    const p = await this.getOrDefault(pipelineId);
    const current = new Set(p.stages.map((s) => s.id));
    if (stageIds.length !== current.size || !stageIds.every((id) => current.has(id))) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_ORDER', 'Send every stage of the pipeline exactly once');
    }
    await this.db.$transaction(stageIds.map((id, order) => this.db.pipelineStage.update({ where: { id }, data: { order } })));
    return toPipelineDto(await this.getOrDefault(pipelineId));
  }

  async removeStage(pipelineId: string, stageId: string, moveDealsTo?: string): Promise<PipelineDto> {
    const p = await this.getOrDefault(pipelineId);
    const stage = p.stages.find((s) => s.id === stageId);
    if (!stage) throw notFound('Stage');
    if (p.stages.length <= 2) throw new AppException(HttpStatus.CONFLICT, 'STAGE_REQUIRED', 'A pipeline needs at least two stages');
    const deals = await this.db.deal.count({ where: { stageId, deletedAt: null } });
    if (deals > 0) {
      const target = moveDealsTo ? p.stages.find((s) => s.id === moveDealsTo && s.id !== stageId) : undefined;
      if (!target) throw new AppException(HttpStatus.CONFLICT, 'STAGE_NOT_EMPTY', `This stage has ${deals} deal(s). Choose a stage to move them to.`, { deals });
      await this.db.deal.updateMany({ where: { stageId }, data: { stageId: target.id, ...stageEffects(target.kind, target.probability) } });
    }
    await this.db.$transaction(async (tx) => {
      // Soft-deleted deals keep a stage reference; move them too so the stage row can go.
      const fallback = p.stages.find((s) => s.id !== stageId)!;
      await tx.deal.updateMany({ where: { stageId }, data: { stageId: fallback.id } });
      await tx.pipelineStage.delete({ where: { id: stageId } });
      await tx.pipelineStage.updateMany({ where: { pipelineId, order: { gt: stage.order } }, data: { order: { decrement: 1 } } });
    });
    return toPipelineDto(await this.getOrDefault(pipelineId));
  }

  // ───────────── Deals ─────────────

  async getDealEntity(id: string) {
    const d = await this.db.deal.findFirst({ where: { id, deletedAt: null, ...ownerScope() }, include: dealInclude });
    if (!d) throw notFound('Deal');
    return d;
  }

  async listDeals(q: ListDealsInput): Promise<Paginated<DealDto>> {
    const where: Prisma.DealWhereInput = {
      deletedAt: null,
      ...ownerScope(),
      ...(q.status ? { status: q.status } : {}),
      ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
      ...(q.stageId ? { stageId: q.stageId } : {}),
      ...(q.contactId ? { contactId: q.contactId } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.ownerId && seesAllRecords() ? { ownerId: q.ownerId } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...searchOr(q.q, ['name']),
    };
    const [rows, total] = await Promise.all([
      this.db.deal.findMany({ where, include: dealInclude, orderBy: { [SORT[q.sort] ?? 'createdAt']: q.order }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.deal.count({ where }),
    ]);
    return paginate(rows.map(toDealDto), total, q);
  }

  async getDeal(id: string): Promise<DealDto> {
    return toDealDto(await this.getDealEntity(id));
  }

  private async assertLinks(input: { contactId?: string | null; companyId?: string | null }) {
    if (input.contactId && !(await this.db.contact.findFirst({ where: { id: input.contactId, deletedAt: null, ...ownerScope() } }))) throw notFound('Contact');
    if (input.companyId && !(await this.db.company.findFirst({ where: { id: input.companyId, deletedAt: null } }))) throw notFound('Company');
  }

  async createDeal(input: CreateDealInput): Promise<DealDto> {
    const organizationId = TenantContext.requireOrganizationId();
    await this.assertLinks(input);
    const pipeline = await this.getOrDefault(input.pipelineId);
    const stage = input.stageId ? pipeline.stages.find((s) => s.id === input.stageId) : pipeline.stages.find((s) => s.kind === 'OPEN');
    if (!stage) throw notFound('Stage');
    const last = await this.db.deal.findFirst({ where: { stageId: stage.id, deletedAt: null }, orderBy: { position: 'desc' } });
    const { ownerId, expectedCloseAt, pipelineId: _p, stageId: _s, ...data } = input;
    const effects = stageEffects(stage.kind, input.probability ?? stage.probability);
    const d = await this.db.deal.create({
      data: {
        ...data,
        organizationId,
        currency: input.currency ?? (await this.crm.currency()),
        pipelineId: pipeline.id,
        stageId: stage.id,
        position: (last?.position ?? 0) + 1000,
        ...effects,
        expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : null,
        ownerId: await this.crm.resolveOwner(ownerId),
      },
      include: dealInclude,
    });
    await this.announceClose(d, null);
    return toDealDto(d);
  }

  async updateDeal(id: string, input: UpdateDealInput): Promise<DealDto> {
    const current = await this.getDealEntity(id);
    await this.assertLinks(input);
    const { ownerId, expectedCloseAt, ...data } = input;
    const d = await this.db.deal.update({
      where: { id },
      data: {
        ...data,
        ...(expectedCloseAt !== undefined ? { expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : null } : {}),
        ...(ownerId !== undefined ? { ownerId: await this.crm.resolveOwner(ownerId, current.ownerId) } : {}),
      },
      include: dealInclude,
    });
    await this.announceClose(d, current.status);
    return toDealDto(d);
  }

  async removeDeal(id: string): Promise<void> {
    await this.getDealEntity(id);
    await this.db.deal.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Winning a deal makes its contact a customer. Returns whether the contact just became one. */
  private async markCustomer(contactId: string): Promise<boolean> {
    return (await this.db.contact.updateMany({ where: { id: contactId, lifecycle: { in: ['LEAD', 'PROSPECT'] } }, data: { lifecycle: 'CUSTOMER' } })).count > 0;
  }

  /** Tells automations a deal was won or lost (and that a contact became a customer), once the write is done. */
  private async announceClose(d: { id: string; status: string; value: unknown; contactId: string | null }, previousStatus: string | null) {
    if (d.status === previousStatus) return;
    if (d.status === 'WON') {
      const becameCustomer = d.contactId ? await this.markCustomer(d.contactId) : false;
      void this.events.emit({ kind: 'deal.won', entityType: 'deal', entityId: d.id, payload: { value: Number(d.value) } });
      if (becameCustomer) void this.events.emit({ kind: 'contact.became_customer', entityType: 'contact', entityId: d.contactId! });
    } else if (d.status === 'LOST') {
      void this.events.emit({ kind: 'deal.lost', entityType: 'deal', entityId: d.id, payload: { value: Number(d.value) } });
    }
  }

  /** Moves a card to a stage (before `beforeId`, or to the end). Won/lost stages close the deal. */
  async moveDeal(id: string, input: MoveDealInput): Promise<DealDto> {
    const deal = await this.getDealEntity(id);
    const pipeline = await this.getOrDefault(deal.pipelineId);
    const stage = pipeline.stages.find((s) => s.id === input.stageId);
    if (!stage) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_STAGE', 'The stage belongs to another pipeline');
    if (stage.kind === 'LOST' && !input.lostReason && deal.status !== 'LOST') throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'LOST_REASON_REQUIRED', 'Say why the deal was lost');

    const column = await this.db.deal.findMany({ where: { stageId: stage.id, deletedAt: null, id: { not: id } }, orderBy: { position: 'asc' }, select: { id: true, position: true } });
    let idx = input.beforeId ? column.findIndex((c) => c.id === input.beforeId) : column.length;
    if (idx === -1) idx = column.length;
    let position = positionBetween(column[idx - 1]?.position ?? null, column[idx]?.position ?? null);
    if (position === null) {
      // Gap exhausted: renumber the column, then place the card.
      await this.db.$transaction(column.map((c, i) => this.db.deal.update({ where: { id: c.id }, data: { position: (i + 1) * 1000 } })));
      position = idx * 1000 + 500;
    }
    const sameStage = stage.id === deal.stageId;
    const d = await this.db.deal.update({
      where: { id },
      data: {
        stageId: stage.id,
        position,
        ...(sameStage ? {} : stageEffects(stage.kind, stage.probability)),
        ...(stage.kind === 'LOST' && input.lostReason ? { lostReason: input.lostReason } : {}),
      },
      include: dealInclude,
    });
    if (!sameStage) await this.announceClose(d, deal.status);
    return toDealDto(d);
  }

  async board(pipelineId: string | undefined, q: { ownerId?: string; q?: string }): Promise<BoardDto> {
    const pipeline = await this.getOrDefault(pipelineId);
    const deals = await this.db.deal.findMany({
      where: {
        pipelineId: pipeline.id,
        deletedAt: null,
        ...ownerScope(),
        ...(q.ownerId && seesAllRecords() ? { ownerId: q.ownerId } : {}),
        ...searchOr(q.q, ['name']),
      },
      include: dealInclude,
      orderBy: { position: 'asc' },
      take: 2000,
    });
    const dto = toPipelineDto(pipeline);
    return {
      pipeline: dto,
      currency: await this.crm.currency(),
      columns: dto.stages.map((stage) => {
        const items = deals.filter((d) => d.stageId === stage.id).map(toDealDto);
        return { stage, deals: items, count: items.length, total: Math.round(items.reduce((s, d) => s + d.value, 0) * 100) / 100 };
      }),
    };
  }
}
