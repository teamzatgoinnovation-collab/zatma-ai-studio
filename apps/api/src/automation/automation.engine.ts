import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { fromAuthRole, permissionsForRole, toAuthRole, type Permission } from '@zatma/types';
import {
  ACTION_INFO,
  delayMs,
  evaluateCondition,
  MAX_DELAY_MS,
  MAX_NODES,
  nodeLabel,
  renderMerge,
  requiredPermissions,
  workflowSettingsSchema,
  type ActionKind,
  type ConditionKind,
  type DelayConfig,
  type EntityType,
  type TestRunResult,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowSettings,
} from '@zatma/validation';
import { AuditService } from '../audit/audit.service.js';
import { UsageService } from '../billing/usage.service.js';
import { AppException } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EmailService } from '../email/email.service.js';
import { emailTemplates } from '../email/templates.js';
import type { AutomationRun, AutomationWorkflow, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';
import { AutomationActions, isTransient } from './automation-actions.js';
import { AUTOMATION_RUNS_QUEUE, MAX_AUTOMATION_DEPTH, type AutomationEvent } from './automation-events.service.js';
import { loadFacts, loadSubject, mergeValues } from './automation-subject.js';
import { matchesTrigger } from './triggers.js';

export type RunJob = { runId: string };
/** A workflow that fails this many runs in a row is paused so it stops doing harm. */
export const AUTO_PAUSE_AFTER_FAILURES = 10;
const ONE_HOUR = 3_600_000;
const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

type SkipReason = 'LOOP_DEPTH' | 'LOOP_SELF' | 'COOLDOWN' | 'RATE_LIMIT' | 'QUOTA';
const SKIP_TEXT: Record<SkipReason, string> = {
  LOOP_DEPTH: 'Skipped to prevent a loop: automations started by automations can only go three levels deep',
  LOOP_SELF: "Skipped to prevent a loop: this automation's own change started it again",
  COOLDOWN: 'Skipped: this automation already ran for this record recently',
  RATE_LIMIT: "Skipped: this automation reached its hourly run limit",
  QUOTA: "Skipped: your plan's monthly automation runs are used up",
};

@Injectable()
export class AutomationEngine {
  private readonly logger = new Logger(AutomationEngine.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly actions: AutomationActions,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    @InjectQueue(AUTOMATION_RUNS_QUEUE) private readonly runs: Queue<RunJob>,
  ) {}

  // ───────────── Dispatch: an event becomes zero or more runs ─────────────

  async dispatch(event: AutomationEvent): Promise<number> {
    return TenantContext.run({ organizationId: event.organizationId }, async () => {
      const db = this.prisma.tenant;
      const workflows = await db.automationWorkflow.findMany({ where: { status: 'ACTIVE', triggerKind: event.kind, deletedAt: null, ...(event.workflowId ? { id: event.workflowId } : {}) } });
      let started = 0;
      for (const wf of workflows) {
        const graph = wf.graph as unknown as WorkflowGraph;
        const trigger = graph.nodes.find((n) => n.type === 'trigger');
        if (!trigger || !matchesTrigger(event.kind, trigger.config, event.payload)) continue;
        const settings = workflowSettingsSchema.parse(wf.settings ?? {});
        const depth = event.origin ? event.origin.depth + 1 : 0;
        const skip = await this.skipReason(wf, event, depth, settings);
        if (skip && !(await this.shouldRecordSkip(wf.id, skip))) continue;
        let run: AutomationRun;
        try {
          run = await db.automationRun.create({
            data: {
              workflowId: wf.id,
              version: wf.version,
              graphSnapshot: wf.graph as Prisma.InputJsonValue,
              triggerKind: event.kind,
              entityType: event.entityType,
              entityId: event.entityId,
              payload: event.payload as Prisma.InputJsonValue,
              dedupeKey: event.eventKey,
              depth,
              status: skip ? 'SKIPPED' : 'RUNNING',
              skipReason: skip ? `${skip}: ${SKIP_TEXT[skip]}` : null,
              finishedAt: skip ? new Date() : null,
            } as Prisma.AutomationRunUncheckedCreateInput,
          });
        } catch (e) {
          if ((e as { code?: string }).code === 'P2002') continue; // this event already started this workflow (a retried job)
          throw e;
        }
        if (skip === 'QUOTA') await this.notifyQuota(event.organizationId);
        if (skip) continue;
        started++;
        await this.enqueue(run.id, 0);
      }
      return started;
    });
  }

  private async skipReason(wf: AutomationWorkflow, event: AutomationEvent, depth: number, settings: WorkflowSettings): Promise<SkipReason | null> {
    const db = this.prisma.tenant;
    if (depth >= MAX_AUTOMATION_DEPTH) return 'LOOP_DEPTH';
    if (event.origin?.workflowId === wf.id) return 'LOOP_SELF';
    const now = Date.now();
    if (settings.reentryCooldownMinutes > 0) {
      const recent = await db.automationRun.findFirst({
        where: { workflowId: wf.id, entityType: event.entityType, entityId: event.entityId, status: { not: 'SKIPPED' }, startedAt: { gt: new Date(now - settings.reentryCooldownMinutes * 60_000) } },
        select: { id: true },
      });
      if (recent) return 'COOLDOWN';
    }
    const lastHour = await db.automationRun.count({ where: { workflowId: wf.id, status: { not: 'SKIPPED' }, startedAt: { gt: new Date(now - ONE_HOUR) } } });
    if (lastHour >= settings.maxRunsPerHour) return 'RATE_LIMIT';
    const limit = (await this.usage.limits(event.organizationId)).automationRuns;
    if (limit !== undefined && limit !== -1) {
      const used = await db.automationRun.count({ where: { status: { not: 'SKIPPED' }, startedAt: { gte: monthStart() } } });
      if (used >= limit) return 'QUOTA';
    }
    return null;
  }

  /** Rate and quota skips repeat for every event; keep one row per hour so the log stays readable. */
  private async shouldRecordSkip(workflowId: string, reason: SkipReason): Promise<boolean> {
    if (reason !== 'RATE_LIMIT' && reason !== 'QUOTA') return true;
    const seen = await this.prisma.tenant.automationRun.findFirst({ where: { workflowId, status: 'SKIPPED', skipReason: { startsWith: reason }, startedAt: { gt: new Date(Date.now() - ONE_HOUR) } }, select: { id: true } });
    return !seen;
  }

  /** Owners and Admins are told once a day when the monthly quota stops runs. */
  private async notifyQuota(organizationId: string) {
    const key = `auto:quota:${organizationId}:${new Date().toISOString().slice(0, 10)}`;
    if ((await this.redis.set(key, '1', 'EX', 90_000, 'NX')) !== 'OK') return;
    for (const p of await this.admins(organizationId)) {
      const t = emailTemplates.automationNotice({ name: p.name, workflow: 'Automation limit', heading: 'Automations paused by your plan limit', message: "Your plan's monthly automation runs are used up, so new runs are being skipped until next month. Upgrade your plan to keep automations running.", url: `${this.env.WEB_URL}/billing` });
      await this.email.send({ to: p.email, subject: t.subject, html: t.html, text: t.text, tag: t.tag, organizationId }).catch(() => undefined);
    }
  }

  private async admins(organizationId: string, extraUserId?: string | null) {
    const rows = await this.prisma.system.member.findMany({
      where: { organizationId, OR: [{ role: { in: [toAuthRole('ORGANIZATION_OWNER'), toAuthRole('ADMIN')] } }, ...(extraUserId ? [{ userId: extraUserId }] : [])] },
      include: { user: { select: { name: true, email: true } } },
    });
    return rows.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email }));
  }

  private async enqueue(runId: string, delay: number, suffix = '') {
    await this.runs.add('run', { runId }, { jobId: `run_${runId}${suffix}`, delay, attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: 100 });
  }

  /** Re-runs a failed run from the step that failed. Completed steps are never repeated. */
  async retry(runId: string): Promise<void> {
    const db = this.prisma.tenant;
    const run = await db.automationRun.findFirst({ where: { id: runId }, include: { steps: { where: { status: 'FAILED' }, take: 1 } } });
    if (!run) throw new AppException(404, 'NOT_FOUND', 'Run not found');
    if (run.status !== 'FAILED') throw new AppException(409, 'INVALID_STATUS', 'Only failed runs can be retried');
    const wf = await db.automationWorkflow.findFirst({ where: { id: run.workflowId, deletedAt: null } });
    if (!wf || wf.status !== 'ACTIVE') throw new AppException(409, 'AUTOMATION_NOT_ACTIVE', 'Activate the automation before retrying its runs');
    await db.automationRun.update({ where: { id: runId }, data: { status: 'RUNNING', error: null, finishedAt: null, resumeNodeId: run.steps[0]?.nodeId ?? run.resumeNodeId } });
    await this.enqueue(runId, 0, `_retry${Date.now()}`);
  }

  // ───────────── Execution ─────────────

  /** Runs (or resumes) one run. Returns 'retry' when a transient error should be retried by the queue. */
  async execute(runId: string, finalAttempt: boolean): Promise<'done' | 'retry'> {
    const run = await this.prisma.system.automationRun.findUnique({ where: { id: runId }, include: { workflow: true } });
    if (!run || !['RUNNING', 'WAITING'].includes(run.status)) return 'done';
    const wf = run.workflow;
    return TenantContext.run({ organizationId: run.organizationId }, async () => {
      const db = this.prisma.tenant;
      if (wf.deletedAt || wf.status !== 'ACTIVE') {
        await db.automationRun.update({ where: { id: run.id }, data: { status: 'CANCELLED', error: 'The automation was paused or deleted', finishedAt: new Date() } });
        return 'done';
      }
      // The workflow runs with its owner's permissions, checked again now in case their role changed.
      const graph = run.graphSnapshot as unknown as WorkflowGraph;
      const member = wf.ownerId ? await this.prisma.system.member.findFirst({ where: { organizationId: run.organizationId, userId: wf.ownerId } }) : null;
      const role = fromAuthRole(member?.role);
      const granted = permissionsForRole(role);
      const missing = requiredPermissions(graph).filter((p) => !granted.includes(p as Permission));
      if (!member || missing.length) {
        await this.failRun(run, wf, `OWNER_PERMISSION_LOST: the person this automation runs as ${member ? `no longer has ${missing.join(', ')}` : 'is no longer on the team'}. Activate it again as someone with access.`, true);
        return 'done';
      }
      return TenantContext.run({ organizationId: run.organizationId, userId: wf.ownerId!, role: role ?? undefined, permissions: granted, automation: { runId: run.id, workflowId: wf.id, depth: run.depth } }, () => this.walk(run, wf, graph, finalAttempt));
    });
  }

  private async recordStep(run: AutomationRun, node: WorkflowNode, status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'WAITING', extra: { output?: Record<string, unknown>; error?: string; attempts?: number } = {}) {
    const data = { status, label: nodeLabel(node.type, node.kind).slice(0, 120), output: (extra.output ?? undefined) as Prisma.InputJsonValue | undefined, error: extra.error?.slice(0, 500) ?? null, attempts: extra.attempts ?? 1, finishedAt: status === 'WAITING' ? null : new Date() };
    await this.prisma.tenant.automationRunStep.upsert({
      where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
      create: { organizationId: run.organizationId, runId: run.id, nodeId: node.id, nodeType: node.type, kind: node.kind, ...data },
      update: data,
    });
  }

  private async walk(run: AutomationRun, wf: AutomationWorkflow, graph: WorkflowGraph, finalAttempt: boolean): Promise<'done' | 'retry'> {
    const db = this.prisma.tenant;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const next = (from: string, handle: 'next' | 'yes' | 'no') => graph.edges.find((e) => e.source === from && e.sourceHandle === handle)?.target ?? null;
    const done = new Map((await db.automationRunStep.findMany({ where: { runId: run.id } })).map((s) => [s.nodeId, s]));
    const trigger = graph.nodes.find((n) => n.type === 'trigger')!;
    const org = await this.prisma.system.organization.findUnique({ where: { id: run.organizationId }, select: { timezone: true } });
    let current: string | null = run.resumeNodeId && byId.has(run.resumeNodeId) ? run.resumeNodeId : trigger.id;
    // Resuming at a delay (its time has come) or at a step that failed.
    if (run.status === 'WAITING') await db.automationRun.update({ where: { id: run.id }, data: { status: 'RUNNING' } });
    for (let guard = 0; current && guard <= MAX_NODES; guard++) {
      const node = byId.get(current)!;
      const prior = done.get(node.id);
      if (node.type === 'trigger') {
        if (!prior) await this.recordStep(run, node, 'SUCCEEDED', { output: { entityType: run.entityType } });
        current = next(node.id, 'next');
      } else if (node.type === 'condition') {
        let branch: 'yes' | 'no';
        if (prior?.status === 'SUCCEEDED') branch = (prior.output as { branch: 'yes' | 'no' }).branch;
        else {
          const subject = await loadSubject(db, run.entityType as EntityType, run.entityId);
          const facts = await loadFacts(db, subject);
          branch = facts && evaluateCondition(node.kind as ConditionKind, node.config, facts, new Date(), org?.timezone ?? 'Asia/Kolkata') ? 'yes' : 'no';
          await this.recordStep(run, node, 'SUCCEEDED', { output: { branch } });
        }
        current = next(node.id, branch);
      } else if (node.type === 'delay') {
        if (prior?.status === 'SUCCEEDED') current = next(node.id, 'next');
        else if (prior?.status === 'WAITING' && run.resumeNodeId === node.id) {
          await this.recordStep(run, node, 'SUCCEEDED');
          current = next(node.id, 'next');
        } else {
          const ms = Math.min(delayMs(node.config as unknown as DelayConfig), MAX_DELAY_MS);
          await this.recordStep(run, node, 'WAITING', { output: { until: new Date(Date.now() + ms).toISOString() } });
          await db.automationRun.update({ where: { id: run.id }, data: { status: 'WAITING', resumeNodeId: node.id } });
          await this.enqueue(run.id, ms, `_${node.id}`);
          return 'done';
        }
      } else {
        if (prior && (prior.status === 'SUCCEEDED' || prior.status === 'SKIPPED')) {
          current = next(node.id, 'next');
          continue;
        }
        const attempts = (prior?.attempts ?? 0) + 1;
        try {
          const res = await this.actions.execute(node, { organizationId: run.organizationId, workflowId: wf.id, workflowName: wf.name, runId: run.id, entityType: run.entityType as EntityType, entityId: run.entityId, runAs: wf.ownerId! });
          await this.recordStep(run, node, res.skipped ? 'SKIPPED' : 'SUCCEEDED', { output: res.skipped ? { reason: res.skipped } : res.output, attempts });
          current = next(node.id, 'next');
        } catch (e) {
          const message = e instanceof AppException ? ((e.getResponse() as { message?: string }).message ?? e.message) : (e as Error).message;
          await this.recordStep(run, node, 'FAILED', { error: message, attempts });
          if (isTransient(e) && !finalAttempt) {
            await db.automationRun.update({ where: { id: run.id }, data: { resumeNodeId: node.id } });
            return 'retry';
          }
          await this.failRun(run, wf, `${nodeLabel('action', node.kind)}: ${message}`, false);
          return 'done';
        }
      }
    }
    await db.automationRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', finishedAt: new Date(), resumeNodeId: null, error: null } });
    await db.automationWorkflow.update({ where: { id: wf.id }, data: { consecutiveFailures: 0 } });
    return 'done';
  }

  // ───────────── Failure handling ─────────────

  private async failRun(run: AutomationRun, wf: AutomationWorkflow, message: string, pauseNow: boolean) {
    const db = this.prisma.tenant;
    await db.automationRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: message.slice(0, 500), finishedAt: new Date() } });
    const updated = await db.automationWorkflow.update({ where: { id: wf.id }, data: { consecutiveFailures: { increment: 1 } } });
    const pause = pauseNow || updated.consecutiveFailures >= AUTO_PAUSE_AFTER_FAILURES;
    if (pause) await db.automationWorkflow.update({ where: { id: wf.id }, data: { status: 'PAUSED', pausedReason: (pauseNow ? message : `Paused automatically after ${AUTO_PAUSE_AFTER_FAILURES} failed runs in a row`).slice(0, 300) } });
    await this.audit.record('automation.run_failed', 'automation_workflow', wf.id, { runId: run.id, error: message.slice(0, 200), paused: pause }).catch(() => undefined);
    // At most one failure email an hour per workflow.
    const last = updated.lastFailureEmailAt?.getTime() ?? 0;
    if (Date.now() - last < ONE_HOUR) return;
    await db.automationWorkflow.update({ where: { id: wf.id }, data: { lastFailureEmailAt: new Date() } });
    for (const p of await this.admins(run.organizationId, wf.ownerId)) {
      const t = emailTemplates.automationFailed({ name: p.name, workflow: wf.name, error: message.slice(0, 300), paused: pause, url: `${this.env.WEB_URL}/marketing/automation/${wf.id}` });
      await this.email.send({ to: p.email, subject: t.subject, html: t.html, text: t.text, tag: t.tag, organizationId: run.organizationId }).catch(() => undefined);
    }
  }

  // ───────────── Dry run ─────────────

  /** Walks the workflow against a real record and reports the path, without writing, emailing or calling AI. */
  async dryRun(graph: WorkflowGraph, entityType: EntityType, entityId: string): Promise<TestRunResult> {
    const db = this.prisma.tenant;
    const subject = await loadSubject(db, entityType, entityId);
    if (!subject.primary) throw new AppException(404, 'NOT_FOUND', 'That record was not found');
    const facts = (await loadFacts(db, subject))!;
    const org = await this.prisma.system.organization.findUnique({ where: { id: TenantContext.requireOrganizationId() }, select: { timezone: true, name: true } });
    const values = mergeValues(subject, org?.name ?? '', null);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const next = (from: string, handle: 'next' | 'yes' | 'no') => graph.edges.find((e) => e.source === from && e.sourceHandle === handle)?.target ?? null;
    const out: TestRunResult = { path: [], wouldWrite: [] };
    let current: string | null = graph.nodes.find((n) => n.type === 'trigger')?.id ?? null;
    for (let guard = 0; current && guard <= MAX_NODES; guard++) {
      const node = byId.get(current)!;
      const label = nodeLabel(node.type, node.kind);
      if (node.type === 'trigger') {
        out.path.push({ nodeId: node.id, label, outcome: 'run' });
        current = next(node.id, 'next');
      } else if (node.type === 'condition') {
        const yes = evaluateCondition(node.kind as ConditionKind, node.config, facts, new Date(), org?.timezone ?? 'Asia/Kolkata');
        out.path.push({ nodeId: node.id, label, outcome: yes ? 'yes' : 'no' });
        const target = next(node.id, yes ? 'yes' : 'no');
        if (!target) out.path.push({ nodeId: node.id, label: 'The workflow ends here', outcome: 'stop' });
        current = target;
      } else if (node.type === 'delay') {
        const c = node.config as unknown as DelayConfig;
        out.path.push({ nodeId: node.id, label, outcome: 'would_wait', detail: `${c.amount} ${c.unit}` });
        current = next(node.id, 'next');
      } else {
        const c = node.config as Record<string, unknown>;
        const info = ACTION_INFO[node.kind as ActionKind];
        const detail = node.kind === 'create_task' ? `“${renderMerge(String(c.subject ?? ''), values)}” due in ${c.dueInHours} h` : node.kind === 'add_tag' || node.kind === 'remove_tag' ? `“${String(c.tag)}”` : node.kind === 'set_lead_status' ? String(c.status) : undefined;
        out.path.push({ nodeId: node.id, label, outcome: 'run', ...(detail ? { detail } : {}) });
        out.wouldWrite.push(`${info?.label ?? node.kind}${detail ? `: ${detail}` : ''}`);
        current = next(node.id, 'next');
      }
    }
    return out;
  }
}
