import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  brandKitSchema,
  createDesignSchema,
  generateDesignSchema,
  listDesignsSchema,
  saveTemplateSchema,
  saveVersionSchema,
  setThumbnailSchema,
  updateBrandKitSchema,
  updateDesignSchema,
  type BrandKitInput,
  type CreateDesignInput,
  type GenerateDesignInput,
  type ListDesignsInput,
  type SaveTemplateInput,
  type UpdateBrandKitInput,
  type UpdateDesignInput,
} from '@zatma/validation';
import { Audit } from '../audit/audit.decorator.js';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { BrandKitService } from './brand-kit.service.js';
import { DesignService } from './design.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });
const GENERATION_THROTTLE = { default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 10), ttl: 60_000 } };

@ApiTags('Brand kits')
@ApiCookieAuth()
@Controller('brand-kits')
export class BrandKitController {
  constructor(private readonly kits: BrandKitService) {}

  @Get()
  @RequirePermissions('design:read')
  @ApiOperation({ summary: 'Brand kits of the organization (default first)' })
  list() {
    return this.kits.list();
  }

  @Get(':id')
  @RequirePermissions('design:read')
  get(@Param('id', uuid) id: string) {
    return this.kits.get(id);
  }

  @Post()
  @RequirePermissions('design:write')
  @Audit('brand_kit.created', 'brand_kit', 'response')
  @ApiOperation({ summary: 'Create a brand kit (the first one becomes the default)' })
  create(@Body(new ZodValidationPipe(brandKitSchema)) body: BrandKitInput) {
    return this.kits.create(body);
  }

  @Patch(':id')
  @RequirePermissions('design:write')
  @Audit('brand_kit.updated', 'brand_kit')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateBrandKitSchema)) body: UpdateBrandKitInput) {
    return this.kits.update(id, body);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('design:write')
  @Audit('brand_kit.made_default', 'brand_kit')
  setDefault(@Param('id', uuid) id: string) {
    return this.kits.setDefault(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('design:write')
  @Audit('brand_kit.deleted', 'brand_kit')
  remove(@Param('id', uuid) id: string) {
    return this.kits.remove(id);
  }
}

@ApiTags('Designs')
@ApiCookieAuth()
@Controller('designs')
export class DesignController {
  constructor(private readonly designs: DesignService) {}

  @Get()
  @RequirePermissions('design:read')
  @ApiOperation({ summary: 'Design library (newest first; search by title)' })
  list(@Query(new ZodValidationPipe(listDesignsSchema)) query: ListDesignsInput) {
    return this.designs.list(query);
  }

  @Post()
  @RequirePermissions('design:write')
  @Audit('design.created', 'design', 'response')
  @ApiOperation({ summary: 'Create a blank design from a size preset, or from a template' })
  create(@Body(new ZodValidationPipe(createDesignSchema)) body: CreateDesignInput) {
    return this.designs.create(body);
  }

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(GENERATION_THROTTLE)
  @RequirePermissions('design:write', 'ai:generate')
  @Audit('design.generation_started', 'design')
  @ApiOperation({ summary: 'Generate an editable design from a prompt (poll GET /designs/:id until READY)' })
  generate(@Body(new ZodValidationPipe(generateDesignSchema)) body: GenerateDesignInput) {
    return this.designs.startGeneration(body);
  }

  @Get(':id')
  @RequirePermissions('design:read')
  @ApiOperation({ summary: 'Design with its layered document and signed asset URLs' })
  get(@Param('id', uuid) id: string) {
    return this.designs.get(id);
  }

  @Patch(':id')
  @RequirePermissions('design:write')
  @ApiOperation({ summary: 'Save title/document (send the revision you edited; 409 on conflict)' })
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateDesignSchema)) body: UpdateDesignInput) {
    return this.designs.update(id, body);
  }

  @Post(':id/duplicate')
  @RequirePermissions('design:write')
  @Audit('design.duplicated', 'design', 'response')
  duplicate(@Param('id', uuid) id: string) {
    return this.designs.duplicate(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('design:write')
  @Audit('design.deleted', 'design')
  remove(@Param('id', uuid) id: string) {
    return this.designs.remove(id);
  }

  @Put(':id/thumbnail')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('design:write')
  setThumbnail(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(setThumbnailSchema)) body: { fileId: string }) {
    return this.designs.setThumbnail(id, body.fileId);
  }

  @Get(':id/versions')
  @RequirePermissions('design:read')
  versions(@Param('id', uuid) id: string) {
    return this.designs.listVersions(id);
  }

  @Post(':id/versions')
  @RequirePermissions('design:write')
  saveVersion(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(saveVersionSchema)) body: { note?: string }) {
    return this.designs.saveVersion(id, body.note);
  }

  @Post(':id/versions/:versionId/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('design:write')
  @Audit('design.version_restored', 'design')
  restore(@Param('id', uuid) id: string, @Param('versionId', uuid) versionId: string) {
    return this.designs.restoreVersion(id, versionId);
  }

  @Post(':id/save-as-template')
  @RequirePermissions('design:write')
  @Audit('template.created', 'template', 'response')
  saveAsTemplate(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(saveTemplateSchema)) body: SaveTemplateInput) {
    return this.designs.saveAsTemplate(id, body);
  }
}

@ApiTags('Templates')
@ApiCookieAuth()
@Controller('templates')
export class TemplateController {
  constructor(private readonly designs: DesignService) {}

  @Get()
  @RequirePermissions('design:read')
  list() {
    return this.designs.listTemplates();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('design:write')
  @Audit('template.deleted', 'template')
  remove(@Param('id', uuid) id: string) {
    return this.designs.removeTemplate(id);
  }
}
