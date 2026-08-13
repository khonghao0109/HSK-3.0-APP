import { NestFactory } from '@nestjs/core';
import {
  ConsoleLogger,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { createSafeValidationException } from './common/validation/safe-validation-exception.factory';
import { handleBootstrapFailure } from './config/bootstrap-failure';
import { configureApiEdgeSecurity } from './config/runtime-security';
import { MediaMetricsServer } from './infrastructure/observability/media-metrics.server';

async function bootstrap() {
  let app: INestApplication | undefined;
  try {
    // Nest's default initialization zone logs the raw error object before the
    // outer bootstrap handler can sanitize it. Configuration validation errors
    // can carry the rejected environment in `_original`, so initialization is
    // deliberately silent and rethrows instead of aborting the process.
    app = await NestFactory.create(AppModule, {
      abortOnError: false,
      logger: false,
    });
    // Restore normal application logging only after dependency construction and
    // configuration validation have completed successfully.
    app.useLogger(new ConsoleLogger());
    const config = app.get(ConfigService);

    // Global prefix
    app.setGlobalPrefix('api/v1');

    // FIX 1: Global ValidationPipe — reject unknown fields, auto-transform types
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true, // strip fields không có trong DTO
        forbidNonWhitelisted: true, // throw 400 nếu có field lạ
        transform: true, // tự convert string -> number cho @Param, @Query
        transformOptions: {
          enableImplicitConversion: true,
        },
        exceptionFactory: createSafeValidationException,
      }),
    );

    // FIX 2: CORS — chỉ cho phép origin được cấu hình
    configureApiEdgeSecurity(app, config);

    // FIX 3: Graceful shutdown — NestJS sẽ gọi onApplicationShutdown hooks
    app.enableShutdownHooks();

    // ─── Optional: Swagger / OpenAPI ─────────────────────────────────────────
    // Cần install: npm install @nestjs/swagger
    // import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
    // const swaggerConfig = new DocumentBuilder()
    //   .setTitle('HSK System API')
    //   .setDescription('API cho nền tảng ôn luyện HSK 9 cấp')
    //   .setVersion('1.0')
    //   .addBearerAuth()
    //   .build();
    // const document = SwaggerModule.createDocument(app, swaggerConfig);
    // SwaggerModule.setup('api/docs', app, document);

    const port = config.getOrThrow<number>('app.port');
    // Initialize the dependency graph first, then bind the private listener.
    // The public API is not exposed if the private metrics boundary fails.
    await app.init();
    await app.get(MediaMetricsServer).listen();
    await app.listen(port);
    console.log(`🚀 Server running on http://localhost:${port}/api/v1`);
  } catch (error: unknown) {
    await app?.close().catch(() => undefined);
    throw error;
  }
}

bootstrap().catch((error: unknown) => {
  handleBootstrapFailure(error);
});
