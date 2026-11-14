import { HttpStatus, Injectable } from '@nestjs/common';
import type { Paginated } from '@zatma/types';
import {
  DEFAULT_WORKFLOW_SETTINGS,
  nodeLabel,
  parseNodeConfig,
  requiredPermissions,
  stableStringify,
  TRIGGER_INFO,
  TRIGGER_KINDS,
  validateWorkflow,
  workflowSettingsSchema,
  WORKFLOW_TEMPLATES,
  type AutomationStatsDto,
  type CreateWorkflowInput,
  type EntityType,
  type ListRunsQuery,
  type ListWorkflowsQuery,
  type RunDto,
  type RunStatus,
  type RunStepDto,
  type TestRunInput,
  type TestRunResult,
  type TriggerKind,
  type UpdateWorkflowInput,
  type WorkflowDto,
  type WorkflowGraph,
} from '@zatma/validation';
import { AuditService } from '../audit/audit.service.js';
import { UsageService } from '../billing/usage.service.js';
import { AppException, notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import type { AutomationRun, AutomationRunStep, AutomationWorkflow, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AutomationEngine } from './automation.engine.js';

type WorkflowRow = AutomationWorkflow & { owner: { id: string; name: string } | null; createdBy: { id: string; name: string } | null };
const INCLUDE = { owner: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } } as const;
const monthStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly engine: AutomationEngine,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  private perms() {
    return TenantContext.get()?.permissions ?? [];
  }

  // ───────────── Reading ─────────────

  private async row(id: string): Promise<WorkflowRow> {
    const w = await this.db.automationWorkflow.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
    if (!w) throw notFound('Automation');
    return w;
  }

  private async toDtos(rows: WorkflowRow[]): Promise<WorkflowDto[]> {
    const ids = rows.map((r) => r.id);
    const [counts, last] = ids.length
      ? await Promise.all([
          this.db.automationRun.groupBy({ by: ['workflowId', 'status'], where: { workflowId: { in: ids }, status: { not: 'SKIPPED' }, startedAt: { gte: monthStart() } }, _count: { _all: true } }),
          this.db.automationRun.findMany({ where: { workflowId: { in: ids } }, orderBy: { startedAt: 'desc' }, distinct: ['workflowId'], select: { workflowId: true, startedAt: true, status: true } }),
        ])
      : [[], []];
    return rows.map((r) => {
      const graph = r.graph as unknown as WorkflowGraph;
      const mine = counts.filter((c) => c.workflowId === r.id);
      const l = last.find((x) => x.workflowId === r.id);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        status: r.status,
        triggerKind: (r.triggerKind as TriggerKind | null) ?? null,
        graph,
        version: r.version,
        settings: workflowSettingsSchema.parse(r.settings ?? {}),
        owner: r.owner,
        activatedAt: iso(r.activatedAt),
        pausedReason: r.pausedReason,
        stats: { runsThisMonth: mine.reduce((n, c) => n + c._count._all, 0), failuresThisMonth: mine.filter((c) => c.status === 'FAILED').reduce((n, c) => n + c._count._all, 0), lastRunAt: iso(l?.startedAt), lastStatus: (l?.status as RunStatus | undefined) ?? null },
        issues: validateWorkflow(graph),
        requiredPermissions: requiredPermissions(graph),
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async get(id: string): Promise<WorkflowDto> {
    return (await this.toDtos([await this.row(id)]))[0]!;
  }

  async list(q: ListWorkflowsQuery): Promise<Paginated<WorkflowDto>> {
    const where: Prisma.AutomationWorkflowWhereInput = { deletedAt: null, ...(q.status ? { status: q.status } : {}), ...(q.trigger ? { triggerKind: q.trigger } : {}), ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([this.db.automationWorkflow.findMany({ where, include: INCLUDE, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), this.db.automationWorkflow.count({ where })]);
    return { data: await this.toDtos(rows), meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
  }

  templates() {
    return WORKFLOW_TEMPLATES;
  }

  // ───────────── Writing ─────────────

  private triggerOf(graph: WorkflowGraph): TriggerKind | null {
    const k = graph.nodes.find((n) => n.type === 'trigger')?.kind;
    return (TRIGGER_KINDS as readonly string[]).includes(k ?? '') ? (k as TriggerKind) : null;
  }

  async create(input: CreateWorkflowInput): Promise<WorkflowDto> {
    const w = await this.db.automationWorkflow.create({
      data: {
        name: input.name,
        description: input.description,
        graph: input.graph as Prisma.InputJsonValue,
        triggerKind: this.triggerOf(input.graph),
        settings: { ...DEFAULT_WORKFLOW_SETTINGS, ...(input.settings ?? {}) } as Prisma.InputJsonValue,
        createdById: TenantContext.get()?.userId ?? null,
      } as Prisma.AutomationWorkflowUncheckedCreateInput,
      include: INCLUDE,
    });
    await this.audit.record('automation.created', 'automation_workflow', w.id, { name: w.name });
    return (await this.toDtos([w]))[0]!;
  }

  async update(id: string, input: UpdateWorkflowInput): Promise<WorkflowDto> {
    const w = await this.row(id);
    const graphChanged = input.graph !== undefined && stableStringify(input.graph) !== stableStringify(w.graph);
    const graph = (input.graph ?? w.graph) as unknown as WorkflowGraph;
    const live = w.status === 'ACTIVE' && graphChanged;
    // Changing a running automation is a new activation: it must be valid and the editor must be allowed to run it.
    if (live) await this.assertActivatable(graph);
    const updated = await this.db.automationWorkflow.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.settings !== undefined ? { settings: { ...(w.settings as object), ...input.settings } as Prisma.InputJsonValue } : {}),
        ...(graphChanged ? { graph: graph as unknown as Prisma.InputJsonValue, version: { increment: 1 }, triggerKind: this.triggerOf(graph) } : {}),
        ...(live ? { ownerId: TenantContext.get()?.userId ?? w.ownerId } : {}),
      },
      include: INCLUDE,
    });
    await this.audit.record('automation.updated', 'automation_workflow', id, { graphChanged });
    return (await this.toDtos([updated]))[0]!;
  }

  async remove(id: string): Promise<void> {
    const w = await this.row(id);
    await this.db.automationWorkflow.update({ where: { id }, data: { deletedAt: new Date(), status: 'PAUSED' } });
    await this.audit.record('automation.deleted', 'automation_workflow', id, { name: w.name });
  }

  /** What must hold before a workflow may run: a valid graph, permissions for each action, and existing people and campaigns. */
  private async assertActivatable(graph: WorkflowGraph) {
    const errors = validateWorkflow(graph).filter((i) => i.level === 'error');
    if (errors.length) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'AUTOMATION_INVALID', errors[0]!.message, { issues: errors });
    if (!graph.nodes.some((n) => n.type === 'action')) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'AUTOMATION_INVALID', 'Add at least one action before activating');
    const granted = this.perms();
    const missing = requiredPermissions(graph).filter((p) => !granted.includes(p as never));
    if (missing.length) throw new AppException(HttpStatus.FORBIDDEN, 'AUTOMATION_PERMISSION_MISSING', `You need ${missing.join(', ')} to run this automation, because it runs with your permissions`, { missing });
    const users = new Set<string>();
    const campaigns = new Set<string>();
    for (const n of graph.nodes) {
      const parsed = parseNodeConfig(n.type, n.type === 'delay' ? 'delay' : n.kind, n.config);
      if (!parsed.ok) continue;
      const c = parsed.config;
      for (const u of (c.userIds as string[] | undefined) ?? []) users.add(u);
      if (typeof c.assigneeId === 'string') users.add(c.assigneeId);
      if (typeof c.campaignId === 'string' && c.campaignId) campaigns.add(c.campaignId);
    }
    const organizationId = TenantContext.requireOrganizationId();
    if (users.size) {
      const found = await this.prisma.system.member.count({ where: { organizationId, userId: { in: [...users] } } });
      if (found !== users.size) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'AUTOMATION_INVALID', 'A person chosen in this automation is not on the team');
    }
    if (campaigns.size) {
      const found = await this.db.campaign.count({ where: { id: { in: [...campaigns] }, deletedAt: null } });
      if (found !== campaigns.size) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'AUTOMATION_INVALID', 'A campaign chosen in this automation no longer exists');
    }
  }

  async activate(id: string): Promise<WorkflowDto> {
    const w = await this.row(id);
    await this.assertActivatable(w.graph as unknown as WorkflowGraph);
    const updated = await this.db.automationWorkflow.update({ where: { id }, data: { status: 'ACTIVE', ownerId: TenantContext.get()?.userId ?? null, activatedAt: new Date(), pausedReason: null, consecutiveFailures: 0 }, include: INCLUDE });
    await this.audit.record('automation.activated', 'automation_workflow', id, { name: w.name, permissions: requiredPermissions(w.graph as unknown as WorkflowGraph) });
    return (await this.toDtos([updated]))[0]!;
  }

  async pause(id: string): Promise<WorkflowDto> {
    const w = await this.row(id);
    if (w.status !== 'ACTIVE') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'Only active automations can be paused');
    const updated = await this.db.automationWorkflow.update({ where: { id }, data: { status: 'PAUSED', pausedReason: 'Paused by a person' }, include: INCLUDE });
    await this.audit.record('automation.paused', 'automation_workflow', id, { name: w.name });
    return (await this.toDtos([updated]))[0]!;
  }

  async testRun(id: string, input: TestRunInput): Promise<TestRunResult> {
    const w = await this.row(id);
    const graph = w.graph as unknown as WorkflowGraph;
    const kind = this.triggerOf(graph);
    if (kind && TRIGGER_INFO[kind].entity !== input.entityType) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'WRONG_RECORD_TYPE', `This automation starts from a ${TRIGGER_INFO[kind].entity}; choose a ${TRIGGER_INFO[kind].entity} to test with`);
    return this.engine.dryRun(graph, input.entityType as EntityType, input.entityId);
  }

  // ───────────── Runs ─────────────

  private async labels(runs: AutomationRun[]): Promise<Map<string, string>> {
    const ids = (type: string) => [...new Set(runs.filter((r) => r.entityType === type).map((r) => r.entityId))];
    const [leads, contacts, deals, acts] = await Promise.all([
      this.db.lead.findMany({ where: { id: { in: ids('lead') } }, select: { id: true, firstName: true, lastName: true } }),
      this.db.contact.findMany({ where: { id: { in: ids('contact') } }, select: { id: true, firstName: true, lastName: true } }),
      this.db.deal.findMany({ where: { id: { in: ids('deal') } }, select: { id: true, name: true } }),
      this.db.activity.findMany({ where: { id: { in: ids('activity') } }, select: { id: true, subject: true } }),
    ]);
    const m = new Map<string, string>();
    for (const x of [...leads, ...contacts]) m.set(x.id, [x.firstName, x.lastName].filter(Boolean).join(' '));
    for (const x of deals) m.set(x.id, x.name);
    for (const x of acts) m.set(x.id, x.subject);
    return m;
  }

  private stepDto(s: AutomationRunStep): RunStepDto {
    return { id: s.id, nodeId: s.nodeId, kind: s.kind, type: s.nodeType as RunStepDto['type'], label: s.label || nodeLabel(s.nodeType as never, s.kind), status: s.status, attempts: s.attempts, output: (s.output as Record<string, unknown> | null) ?? null, error: s.error, startedAt: s.startedAt.toISOString(), finishedAt: iso(s.finishedAt) };
  }

  private runDto(r: AutomationRun & { workflow: { name: string } }, labels: Map<string, string>, steps?: AutomationRunStep[]): RunDto {
    return {
      id: r.id,
      workflowId: r.workflowId,
      workflowName: r.workflow.name,
      version: r.version,
      status: r.status,
      skipReason: r.skipReason,
      trigger: { kind: r.triggerKind as TriggerKind, entityType: r.entityType as EntityType, entityId: r.entityId, entityLabel: labels.get(r.entityId) ?? null },
      depth: r.depth,
      error: r.error,
      startedAt: r.startedAt.toISOString(),
      finishedAt: iso(r.finishedAt),
      ...(steps ? { steps: steps.map((s) => this.stepDto(s)) } : {}),
    };
  }

  async listRuns(workflowId: string | null, q: ListRunsQuery): Promise<Paginated<RunDto>> {
    if (workflowId) await this.row(workflowId);
    const where: Prisma.AutomationRunWhereInput = { ...(workflowId ? { workflowId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) };
    const [rows, total] = await Promise.all([
      this.db.automationRun.findMany({ where, include: { workflow: { select: { name: true } } }, orderBy: { startedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.automationRun.count({ where }),
    ]);
    const labels = await this.labels(rows);
    return { data: rows.map((r) => this.runDto(r, labels)), meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
  }

  async getRun(runId: string): Promise<RunDto> {
    const r = await this.db.automationRun.findFirst({ where: { id: runId }, include: { workflow: { select: { name: true } }, steps: { orderBy: { startedAt: 'asc' } } } });
    if (!r) throw notFound('Run');
    return this.runDto(r, await this.labels([r]), r.steps);
  }

  async retryRun(runId: string): Promise<RunDto> {
    await this.engine.retry(runId);
    await this.audit.record('automation.run_retried', 'automation_run', runId, {});
    return this.getRun(runId);
  }

  async stats(): Promise<AutomationStatsDto> {
    const organizationId = TenantContext.requireOrganizationId();
    const since = new Date(Date.now() - 13 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const [month, recent, limits] = await Promise.all([
      this.db.automationRun.groupBy({ by: ['status'], where: { startedAt: { gte: monthStart() } }, _count: { _all: true } }),
      this.db.automationRun.findMany({ where: { startedAt: { gte: since }, status: { not: 'SKIPPED' } }, select: { startedAt: true, status: true }, take: 50_000 }),
      this.usage.limits(organizationId),
    ]);
    const n = (s: RunStatus) => month.find((m) => m.status === s)?._count._all ?? 0;
    const days = new Map<string, { runs: number; failed: number }>();
    for (let i = 0; i < 14; i++) days.set(new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10), { runs: 0, failed: 0 });
    for (const r of recent) {
      const d = days.get(r.startedAt.toISOString().slice(0, 10));
      if (d) {
        d.runs++;
        if (r.status === 'FAILED') d.failed++;
      }
    }
    return { runsThisMonth: month.filter((m) => m.status !== 'SKIPPED').reduce((a, m) => a + m._count._all, 0), runLimit: limits.automationRuns ?? -1, succeeded: n('SUCCEEDED'), failed: n('FAILED'), skipped: n('SKIPPED'), daily: [...days.entries()].map(([date, v]) => ({ date, ...v })) };
  }
}
