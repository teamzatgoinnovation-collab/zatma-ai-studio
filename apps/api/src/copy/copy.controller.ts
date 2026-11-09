import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  generateCopySchema,
  listCopyAssetsSchema,
  rewriteCopySchema,
  saveCopyAssetSchema,
  translateCopySchema,
  translateDesignSchema,
  updateCopyAssetSchema,
  type GenerateCopyInput,
  type ListCopyAssetsInput,
  type RewriteCopyInput,
  type SaveCopyAssetInput,
  type TranslateCopyInput,
  type UpdateCopyAssetInput,
} from '@zatma/validation';
import { Audit } from '../audit/audit.decorator.js';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CopyService } from './copy.service.js';
import { DesignTranslationService } from './design-translation.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });
const AI_THROTTLE = { default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 20), ttl: 60_000 } };

@ApiTags('AI Copywriter')
@ApiCookieAuth()
@Controller('copy')
export class CopyController {
  constructor(private readonly copy: CopyService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @Throttle(AI_THROTTLE)
  @RequirePermissions('copy:write', 'ai:generate')
  @ApiOperation({ summary: 'Generate copy variants (not saved until you save one)' })
  generate(@Body(new ZodValidationPipe(generateCopySchema)) body: GenerateCopyInput) {
    return this.copy.generate(body);
  }

  @Post('translate')
  @HttpCode(HttpStatus.OK)
  @Throttle(AI_THROTTLE)
  @RequirePermissions('copy:write', 'ai:generate')
  @ApiOperation({ summary: 'Localise copy into one or more languages' })
  translate(@Body(new ZodValidationPipe(translateCopySchema)) body: TranslateCopyInput) {
    return this.copy.translate(body);
  }

  @Post('rewrite')
  @HttpCode(HttpStatus.OK)
  @Throttle(AI_THROTTLE)
  @RequirePermissions('copy:write', 'ai:generate')
  @ApiOperation({ summary: 'Rewrite copy (shorter, longer, tone, emojis or a custom instruction)' })
  rewrite(@Body(new ZodValidationPipe(rewriteCopySchema)) body: RewriteCopyInput) {
    return this.copy.rewrite(body);
  }
}

@ApiTags('AI Copywriter')
@ApiCookieAuth()
@Controller('copy-assets')
export class CopyAssetController {
  constructor(private readonly copy: CopyService) {}

  @Get()
  @RequirePermissions('copy:read')
  @ApiOperation({ summary: 'Saved copy library' })
  list(@Query(new ZodValidationPipe(listCopyAssetsSchema)) query: ListCopyAssetsInput) {
    return this.copy.list(query);
  }

  @Get(':id')
  @RequirePermissions('copy:read')
  get(@Param('id', uuid) id: string) {
    return this.copy.get(id);
  }

  @Post()
  @RequirePermissions('copy:write')
  @Audit('copy.saved', 'copy_asset', 'response')
  save(@Body(new ZodValidationPipe(saveCopyAssetSchema)) body: SaveCopyAssetInput) {
    return this.copy.save(body);
  }

  @Patch(':id')
  @RequirePermissions('copy:write')
  @Audit('copy.updated', 'copy_asset')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateCopyAssetSchema)) body: UpdateCopyAssetInput) {
    return this.copy.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('copy:write')
  @Audit('copy.deleted', 'copy_asset')
  remove(@Param('id', uuid) id: string) {
    return this.copy.remove(id);
  }
}

@ApiTags('Designs')
@ApiCookieAuth()
@Controller('designs')
export class DesignTranslationController {
  constructor(private readonly translation: DesignTranslationService) {}

  @Post(':id/translate')
  @Throttle(AI_THROTTLE)
  @RequirePermissions('design:write', 'ai:generate')
  @Audit('design.translated', 'design', 'response')
  @ApiOperation({ summary: 'Create a translated copy of a design (text layers localised, layout kept)' })
  translate(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(translateDesignSchema)) body: { language: string }) {
    return this.translation.translate(id, body.language);
  }
}
