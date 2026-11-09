import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AUTH } from './auth/auth.module.js';
import type { Auth } from './auth/auth.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

/** Builds the fully configured Nest application (shared by main.ts and e2e tests). */
export async function createApp(options: { logger?: boolean } = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Better Auth must read the raw request stream, so body parsing is registered manually below.
    bodyParser: false,
    bufferLogs: options.logger !== false,
    ...(options.logger === false ? { logger: false } : {}),
  });
  if (options.logger !== false) app.useLogger(app.get(Logger));

  const env = app.get<Env>(ENV);
  const auth = app.get<Auth>(AUTH);

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      // Swagger UI needs inline scripts/styles; the API serves no other HTML.
      contentSecurityPolicy: { directives: { 'script-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:', 'https:'] } },
    }),
  );
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });

  // Better Auth handler: /api/auth/*
  // Registered as a route (not a mounted sub-app) so Better Auth sees the full, unmodified path.
  (app.getHttpAdapter().getInstance() as express.Express).all('/api/auth/{*path}', toNodeHandler(auth));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('ZatGo AI Marketing API')
    .setDescription('Multi-tenant AI Marketing + CRM platform. Authenticate via Better Auth at /api/auth (cookie session).')
    .setVersion('1.0')
    .addCookieAuth('zatma.session_token')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, swagger), { jsonDocumentUrl: 'api/docs-json' });

  return app;
}
