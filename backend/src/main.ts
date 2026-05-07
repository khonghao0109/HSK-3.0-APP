import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
    }),
  );

  // FIX 2: CORS — chỉ cho phép origin được cấu hình
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  // FIX 3: Graceful shutdown — NestJS sẽ gọi onApplicationShutdown hooks
  app.enableShutdownHooks();

  // ─── Optional: Helmet (bảo mật HTTP headers) ────────────────────────────
  // Cần install: npm install helmet
  // import helmet from 'helmet';
  // app.use(helmet());

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

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}/api/v1`);
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start application', error);
  process.exit(1);
});
