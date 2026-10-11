import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'node:path';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { uploadsRoot } from './products/product-images.service.js';

/**
 * Browser clients served from the dev machine: Admin Web (3001), Customer Web
 * (3002) and Expo Web (8081 default, 8082 when the default port is taken).
 * Only used when `CORS_ORIGIN` is unset so a missing env var fails closed
 * instead of reflecting every origin.
 */
const DEFAULT_DEV_CORS_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:8081',
  'http://localhost:8082',
];

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api/v1');
  // Uploaded product images live in ./uploads (outside dist/), served back at
  // /uploads/... so Admin, Customer and Mobile share one stable URL.
  app.useStaticAssets(join(uploadsRoot(), 'products'), {
    prefix: '/uploads/products/',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const corsOrigin = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    // Never `origin: true` / `'*'`: that would reflect any origin on the
    // Internet. An empty CORS_ORIGIN falls back to the known dev clients only.
    origin: corsOrigin.length > 0 ? corsOrigin : DEFAULT_DEV_CORS_ORIGINS,
    // Auth is a bearer token in the `Authorization` header, not a cookie, so
    // credentialed requests are not needed and stay disabled.
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'Idempotency-Key'],
    // The export endpoints send the download name in `Content-Disposition`;
    // without exposing it the browser cannot read it cross-origin and every
    // file would save as a fallback name.
    exposedHeaders: ['Content-Disposition', 'Content-Length'],
    maxAge: 600,
  });

  const config = new DocumentBuilder()
    .setTitle('AgriMarket API V2')
    .setDescription('Backend API for the AgriMarket agricultural marketplace with traceability')
    .setVersion('2.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`AgriMarket API running on http://localhost:${port}/api/v1 (docs: /docs)`);
}
await bootstrap();
