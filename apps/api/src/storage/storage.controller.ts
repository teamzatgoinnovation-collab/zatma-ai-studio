import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { presignUploadSchema, type PresignUploadInput } from '@zatma/validation';
import { Audit } from '../audit/audit.decorator.js';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { StorageService } from './storage.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

@ApiTags('Storage')
@ApiCookieAuth()
@Controller()
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('storage/uploads')
  @RequirePermissions('file:upload')
  @Audit('file.upload_requested', 'file', 'response')
  @ApiOperation({ summary: 'Get a presigned URL to upload a file directly to object storage' })
  createUpload(@Body(new ZodValidationPipe(presignUploadSchema)) body: PresignUploadInput) {
    return this.storage.createUpload(body).then((u) => ({ ...u, id: u.fileId }));
  }

  @Post('storage/uploads/:id/complete')
  @RequirePermissions('file:upload')
  @ApiOperation({ summary: 'Confirm a presigned upload finished (verifies size and type)' })
  complete(@Param('id', uuid) id: string) {
    return this.storage.completeUpload(id);
  }

  @Get('files/:id/url')
  @RequirePermissions('file:read')
  @ApiOperation({ summary: 'Short-lived signed download URL for a file' })
  url(@Param('id', uuid) id: string) {
    return this.storage.downloadUrl(id);
  }
}
