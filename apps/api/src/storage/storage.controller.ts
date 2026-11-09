import { Body, Controller, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { presignUploadSchema, type PresignUploadInput } from '@zatma/validation';
import { Audit } from '../audit/audit.decorator.js';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { StorageService } from './storage.service.js';

@ApiTags('Storage')
@ApiCookieAuth()
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('uploads')
  @RequirePermissions('file:upload')
  @Audit('file.upload_requested', 'file', 'response')
  @ApiOperation({ summary: 'Get a presigned URL to upload a file directly to object storage' })
  createUpload(@Body(new ZodValidationPipe(presignUploadSchema)) body: PresignUploadInput) {
    return this.storage.createUpload(body).then((u) => ({ ...u, id: u.fileId }));
  }
}
