import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { OBJECT_STORAGE, S3ObjectStorage } from './object-storage.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  controllers: [StorageController],
  providers: [StorageService, { provide: OBJECT_STORAGE, inject: [ENV], useFactory: (env: Env) => new S3ObjectStorage(env) }],
  exports: [StorageService],
})
export class StorageModule {}
