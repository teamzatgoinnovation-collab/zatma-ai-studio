import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWorkspaceSchema,
  paginationSchema,
  updateWorkspaceSchema,
  type CreateWorkspaceInput,
  type PaginationInput,
  type UpdateWorkspaceInput,
} from '@zatma/validation';
import { Audit } from '../audit/audit.decorator.js';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { WorkspacesService } from './workspaces.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

@ApiTags('Workspaces')
@ApiCookieAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @RequirePermissions('workspace:read')
  @ApiOperation({ summary: 'List workspaces in the active organization' })
  list(@Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput) {
    return this.workspaces.list(query);
  }

  @Get(':id')
  @RequirePermissions('workspace:read')
  @ApiOperation({ summary: 'Get a workspace (404 if it belongs to another organization)' })
  get(@Param('id', uuid) id: string) {
    return this.workspaces.get(id);
  }

  @Post()
  @RequirePermissions('workspace:create')
  @Audit('workspace.created', 'workspace', 'response')
  @ApiOperation({ summary: 'Create a workspace' })
  create(@Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspaceInput) {
    return this.workspaces.create(body);
  }

  @Patch(':id')
  @RequirePermissions('workspace:update')
  @Audit('workspace.updated', 'workspace')
  @ApiOperation({ summary: 'Update a workspace' })
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspaceInput) {
    return this.workspaces.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('workspace:delete')
  @Audit('workspace.deleted', 'workspace')
  @ApiOperation({ summary: 'Delete a workspace (the default workspace cannot be deleted)' })
  remove(@Param('id', uuid) id: string) {
    return this.workspaces.remove(id);
  }
}
