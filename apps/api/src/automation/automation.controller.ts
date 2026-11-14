import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWorkflowSchema,
  listRunsSchema,
  listWorkflowsSchema,
  testRunSchema,
  updateWorkflowSchema,
  type CreateWorkflowInput,
  type ListRunsQuery,
  type ListWorkflowsQuery,
  type TestRunInput,
  type UpdateWorkflowInput,
} from '@zatma/validation';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AutomationService } from './automation.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

@ApiTags('Automation')
@ApiCookieAuth()
@Controller('automations')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  @RequirePermissions('automation:read')
  list(@Query(new ZodValidationPipe(listWorkflowsSchema)) q: ListWorkflowsQuery) {
    return this.automation.list(q);
  }

  @Get('templates')
  @RequirePermissions('automation:read')
  templates() {
    return this.automation.templates();
  }

  @Get('stats')
  @RequirePermissions('automation:read')
  stats() {
    return this.automation.stats();
  }

  @Get('runs')
  @RequirePermissions('automation:read')
  @ApiOperation({ summary: 'Runs across all automations (filter by status or by the record they ran on)' })
  runs(@Query(new ZodValidationPipe(listRunsSchema)) q: ListRunsQuery) {
    return this.automation.listRuns(null, q);
  }

  @Get('runs/:runId')
  @RequirePermissions('automation:read')
  run(@Param('runId', uuid) runId: string) {
    return this.automation.getRun(runId);
  }

  @Post('runs/:runId/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('automation:write')
  @ApiOperation({ summary: 'Resume a failed run from the step that failed. Completed steps are not repeated.' })
  retry(@Param('runId', uuid) runId: string) {
    return this.automation.retryRun(runId);
  }

  @Post()
  @RequirePermissions('automation:write')
  create(@Body(new ZodValidationPipe(createWorkflowSchema)) body: CreateWorkflowInput) {
    return this.automation.create(body);
  }

  @Get(':id')
  @RequirePermissions('automation:read')
  get(@Param('id', uuid) id: string) {
    return this.automation.get(id);
  }

  @Patch(':id')
  @RequirePermissions('automation:write')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateWorkflowSchema)) body: UpdateWorkflowInput) {
    return this.automation.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('automation:write')
  remove(@Param('id', uuid) id: string) {
    return this.automation.remove(id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('automation:write')
  @ApiOperation({ summary: 'Start running. The automation runs with your permissions, so you need every permission its actions use.' })
  activate(@Param('id', uuid) id: string) {
    return this.automation.activate(id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('automation:write')
  pause(@Param('id', uuid) id: string) {
    return this.automation.pause(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('automation:write')
  @ApiOperation({ summary: 'Dry run against a real record: shows the path and what would change. Writes nothing, sends nothing.' })
  test(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(testRunSchema)) body: TestRunInput) {
    return this.automation.testRun(id, body);
  }

  @Get(':id/runs')
  @RequirePermissions('automation:read')
  workflowRuns(@Param('id', uuid) id: string, @Query(new ZodValidationPipe(listRunsSchema)) q: ListRunsQuery) {
    return this.automation.listRuns(id, q);
  }
}
